'use server';

import { getCurrentUser } from '@/lib/auth/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import { decryptServerJSON } from '@/lib/traveler-sensitive-fields';
import type {
  ListNotificationsInput,
  MarkNotificationReadInput,
  NotificationActionError,
  NotificationDTO,
  NotificationListResult,
  NotificationResult,
  NotificationType,
} from '@/lib/notification-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_TYPES = new Set<NotificationType>([
  'trip_update', 'payment', 'sos', 'reminder', 'promotional', 'system',
]);
const NOTIFICATION_COLUMNS = 'id, user_clerk_id, type, title, body, data, is_read, read_at, created_at';

type Row = Record<string, unknown>;

function failure(code: NotificationActionError['code'], error: string): NotificationActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function readLimit(value: unknown): number | null {
  if (value === undefined) return 100;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) return null;
  return value;
}

function safeData(value: unknown): Record<string, unknown> | null {
  const decoded = decryptServerJSON(value);
  return isRecord(decoded) ? decoded : null;
}

function safeBody(value: unknown): string | null {
  const decoded = decryptServerJSON(value);
  return typeof decoded === 'string' ? decoded : null;
}

function notificationDTO(row: Row): NotificationDTO | null {
  if (!validUuid(row.id) || !NOTIFICATION_TYPES.has(row.type as NotificationType) ||
      typeof row.title !== 'string' || typeof row.is_read !== 'boolean' || !isTimestamp(row.created_at) ||
      (row.read_at !== null && !isTimestamp(row.read_at))) return null;
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: safeBody(row.body),
    data: safeData(row.data),
    is_read: row.is_read,
    read_at: row.read_at as string | null,
    created_at: row.created_at,
  };
}

async function currentUserId(): Promise<string | NotificationActionError> {
  try {
    const user = await getCurrentUser();
    if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
    return user.id;
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
}

export async function listNotifications(input: ListNotificationsInput = {}): Promise<NotificationListResult> {
  const limit = readLimit(input?.limit);
  if (limit === null) return failure('INVALID_INPUT', 'Notification limit is invalid.');
  const userId = await currentUserId();
  if (typeof userId !== 'string') return userId;
  try {
    const database = await createAuthenticatedDatabaseClient();
    let query = database.from('notifications').select(NOTIFICATION_COLUMNS)
      .eq('user_clerk_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (input?.unreadOnly !== undefined) {
      if (typeof input.unreadOnly !== 'boolean') return failure('INVALID_INPUT', 'Unread filter is invalid.');
      if (input.unreadOnly) query = query.eq('is_read', false);
    }
    const { data, error } = await query;
    if (error) return failure('PERSISTENCE', 'Unable to load notifications.');
    const notifications: NotificationDTO[] = [];
    for (const row of data ?? []) {
      if (!isRecord(row)) return failure('PERSISTENCE', 'Unable to read notifications.');
      const dto = notificationDTO(row);
      if (!dto) return failure('PERSISTENCE', 'Unable to read notifications.');
      notifications.push(dto);
    }
    return { success: true, notifications };
  } catch {
    return failure('PERSISTENCE', 'Unable to load notifications.');
  }
}

export async function markNotificationRead(input: MarkNotificationReadInput | string): Promise<NotificationResult> {
  const notificationId = typeof input === 'string' ? input : input?.notificationId;
  if (!validUuid(notificationId)) return failure('INVALID_INPUT', 'Notification ID is invalid.');
  const userId = await currentUserId();
  if (typeof userId !== 'string') return userId;
  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data: existing, error: readError } = await database.from('notifications').select(NOTIFICATION_COLUMNS)
      .eq('id', notificationId).eq('user_clerk_id', userId).maybeSingle();
    if (readError) return failure('PERSISTENCE', 'Unable to load the notification.');
    if (!existing || !isRecord(existing)) return failure('NOT_FOUND', 'Notification not found.');
    if (existing.is_read === true) {
      const notification = notificationDTO(existing);
      return notification ? { success: true, notification } : failure('PERSISTENCE', 'Unable to read the notification.');
    }
    const readAt = new Date().toISOString();
    const { data: updated, error: updateError } = await database.from('notifications').update({
      is_read: true,
      read_at: readAt,
    }).eq('id', notificationId).eq('user_clerk_id', userId).eq('is_read', false)
      .select(NOTIFICATION_COLUMNS).maybeSingle();
    if (updateError || !updated || !isRecord(updated)) {
      // Another request may have marked it first. Re-read the owner-scoped row
      // so concurrent mark-read requests converge instead of reporting failure.
      const repeated = await database.from('notifications').select(NOTIFICATION_COLUMNS)
        .eq('id', notificationId).eq('user_clerk_id', userId).maybeSingle();
      if (!repeated.error && repeated.data && isRecord(repeated.data) && repeated.data.is_read === true) {
        const notification = notificationDTO(repeated.data);
        return notification ? { success: true, notification } : failure('PERSISTENCE', 'Unable to read the notification.');
      }
      return failure('PERSISTENCE', 'Unable to mark the notification as read.');
    }
    const notification = notificationDTO(updated);
    return notification ? { success: true, notification } : failure('PERSISTENCE', 'Unable to read the updated notification.');
  } catch {
    return failure('PERSISTENCE', 'Unable to mark the notification as read.');
  }
}
