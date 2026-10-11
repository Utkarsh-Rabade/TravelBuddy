'use server';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { encryptServerJSON } from '@/lib/traveler-sensitive-fields';
import type {
  ListMessagesInput,
  MarkMessageReadInput,
  MessageActionError,
  MessageDTO,
  MessageListResult,
  MessageResult,
  MessageType,
  SendMessageInput,
} from '@/lib/message-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_TYPES = new Set<MessageType>(['text', 'image', 'location']);
const ACTIVE_REQUEST_STATUSES = new Set(['booked', 'in_progress']);
const MESSAGE_COLUMNS = 'id, trip_id, sender_clerk_id, content, image_storage_path, message_type, read_by, created_at';

type Row = Record<string, unknown>;
type Database = SupabaseClient;
type Participants = { familyUserId: string; companionUserId: string; requestStatus: string; endTime: unknown };
type Access = { database: Database; userId: string; participants: Participants };

function failure(code: MessageActionError['code'], error: string): MessageActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is MessageActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function deterministicUuid(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function normalizeContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const content = value.trim();
  return content.length > 0 && content.length <= 2000 ? content : null;
}

function readLimit(value: unknown): number | null {
  if (value === undefined) return 100;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) return null;
  return value;
}

async function resolveParticipants(database: Database, tripId: string): Promise<Participants | null | MessageActionError> {
  const { data: trip, error: tripError } = await database.from('trips')
    .select('id, booking_id, end_time').eq('id', tripId).maybeSingle();
  if (tripError) return failure('PERSISTENCE', 'Unable to load the trip.');
  if (!trip || !isRecord(trip) || !validUuid(trip.booking_id)) return null;

  const { data: booking, error: bookingError } = await database.from('bookings')
    .select('id, trip_request_id, companion_id, status').eq('id', trip.booking_id).maybeSingle();
  if (bookingError) return failure('PERSISTENCE', 'Unable to load the trip booking.');
  if (!booking || !isRecord(booking) || !validUuid(booking.trip_request_id) || !validUuid(booking.companion_id)) return null;

  const { data: request, error: requestError } = await database.from('trip_requests')
    .select('id, family_id, status').eq('id', booking.trip_request_id).maybeSingle();
  if (requestError) return failure('PERSISTENCE', 'Unable to load the trip request.');
  if (!request || !isRecord(request) || !validUuid(request.family_id) || typeof request.status !== 'string') return null;

  const [{ data: family, error: familyError }, { data: companion, error: companionError }] = await Promise.all([
    database.from('families').select('family_member_clerk_id').eq('id', request.family_id).maybeSingle(),
    database.from('companions').select('user_clerk_id').eq('id', booking.companion_id).maybeSingle(),
  ]);
  if (familyError || companionError) return failure('PERSISTENCE', 'Unable to verify trip participants.');
  if (!family || !isRecord(family) || typeof family.family_member_clerk_id !== 'string' ||
      !companion || !isRecord(companion) || typeof companion.user_clerk_id !== 'string') return null;

  return {
    familyUserId: family.family_member_clerk_id,
    companionUserId: companion.user_clerk_id,
    requestStatus: request.status,
    endTime: trip.end_time,
  };
}

function isActiveTrip(participants: Participants): boolean {
  return ACTIVE_REQUEST_STATUSES.has(participants.requestStatus) && participants.endTime === null;
}

function isViewableTrip(participants: Participants): boolean {
  return isActiveTrip(participants) || (participants.requestStatus === 'completed' && participants.endTime !== null);
}

async function requireAccess(tripId: string, allowCompleted = false): Promise<Access | MessageActionError> {
  if (!validUuid(tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family' && user.role !== 'companion') return failure('FORBIDDEN', 'You are not allowed to access messages.');

  try {
    // Chat participant projections, read markers and recipient fan-out require
    // trusted access. Verified role and resolveParticipants' full relationship
    // chain gate all message reads/writes and notification recipients.
    const database = createServiceRoleClient();
    const participants = await resolveParticipants(database, tripId);
    if (isFailure(participants)) return participants;
    if (!participants || (allowCompleted ? !isViewableTrip(participants) : !isActiveTrip(participants))) {
      return failure('NOT_FOUND', allowCompleted ? 'Trip conversation not found.' : 'Active trip not found.');
    }
    const participant = user.role === 'family'
      ? user.id === participants.familyUserId
      : user.id === participants.companionUserId;
    if (!participant) return failure('NOT_FOUND', 'Active trip not found.');
    return { database, userId: user.id, participants };
  } catch {
    return failure('PERSISTENCE', 'Unable to load the current trip.');
  }
}

function messageDTO(row: Row, currentUserId: string): MessageDTO | null {
  const readBy = Array.isArray(row.read_by) ? row.read_by.filter((value): value is string => typeof value === 'string') : [];
  if (!validUuid(row.id) || !validUuid(row.trip_id) || typeof row.sender_clerk_id !== 'string' ||
      typeof row.content !== 'string' || (row.image_storage_path !== null && typeof row.image_storage_path !== 'string') ||
      !MESSAGE_TYPES.has(row.message_type as MessageType) || !isTimestamp(row.created_at)) return null;
  return {
    id: row.id,
    trip_id: row.trip_id,
    sender_clerk_id: row.sender_clerk_id,
    content: row.content,
    image_storage_path: row.image_storage_path as string | null,
    message_type: row.message_type as MessageType,
    created_at: row.created_at,
    is_read: readBy.includes(currentUserId),
  };
}

async function notifyOtherParticipant(
  database: Database,
  tripId: string,
  senderId: string,
  messageId: string,
): Promise<void> {
  const participants = await resolveParticipants(database, tripId);
  if (!participants || isFailure(participants)) return;
  const recipient = participants.familyUserId === senderId ? participants.companionUserId : participants.familyUserId;
  if (!recipient || recipient === senderId) return;
  const notificationId = deterministicUuid(`message-notification:${messageId}:${recipient}`);
  const { error } = await database.from('notifications').insert({
    id: notificationId,
    user_clerk_id: recipient,
    type: 'trip_update',
    title: 'New trip message',
    body: null,
    data: encryptServerJSON({ tripId, messageId }),
  });
  if (error && error.code !== '23505') console.error('Unable to create message notification:', error);
}

export async function listMessages(input: ListMessagesInput | string): Promise<MessageListResult> {
  const requestedTripId = typeof input === 'string' ? input : input?.tripId;
  const tripId = typeof requestedTripId === 'string' ? requestedTripId.toLowerCase() : requestedTripId;
  const limit = typeof input === 'string' ? 100 : readLimit(input?.limit);
  if (limit === null) return failure('INVALID_INPUT', 'Message limit is invalid.');
  const access = await requireAccess(tripId, true);
  if (isFailure(access)) return access;
  try {
    let query = access.database.from('messages').select(MESSAGE_COLUMNS)
      .eq('trip_id', tripId).order('created_at', { ascending: true }).limit(limit);
    if (typeof input !== 'string' && input.before !== undefined) {
      if (!isTimestamp(input.before)) return failure('INVALID_INPUT', 'Message cursor is invalid.');
      query = query.lt('created_at', input.before);
    }
    const { data, error } = await query;
    if (error) return failure('PERSISTENCE', 'Unable to load messages.');
    const messages: MessageDTO[] = [];
    for (const row of data ?? []) {
      if (!isRecord(row)) return failure('PERSISTENCE', 'Unable to read messages.');
      const dto = messageDTO(row, access.userId);
      if (!dto) return failure('PERSISTENCE', 'Unable to read messages.');
      messages.push(dto);
    }
    return { success: true, messages };
  } catch {
    return failure('PERSISTENCE', 'Unable to load messages.');
  }
}

export async function sendMessage(input: SendMessageInput): Promise<MessageResult> {
  if (!input || !validUuid(input.tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  const tripId = input.tripId.toLowerCase();
  const content = normalizeContent(input.content);
  if (!content) return failure('INVALID_INPUT', 'Message content must be between 1 and 2000 characters.');
  const messageType = input.messageType ?? 'text';
  if (!MESSAGE_TYPES.has(messageType)) return failure('INVALID_INPUT', 'Message type is unsupported.');
  if (input.imageStoragePath !== undefined && input.imageStoragePath !== null && typeof input.imageStoragePath !== 'string') {
    return failure('INVALID_INPUT', 'Image storage path is invalid.');
  }
  if (input.idempotencyKey !== undefined &&
      (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0 || input.idempotencyKey.length > 256)) {
    return failure('INVALID_INPUT', 'Idempotency key is invalid.');
  }

  const access = await requireAccess(tripId);
  if (isFailure(access)) return access;
  const key = input.idempotencyKey?.trim();
  const bucket = Math.floor(Date.now() / 5000);
  const seed = key
    ? `message:${tripId}:${access.userId}:${key}`
    : `message:${tripId}:${access.userId}:${content}:${bucket}`;
  const messageId = deterministicUuid(seed);
  const createdAt = new Date().toISOString();

  try {
    const { data, error } = await access.database.from('messages').insert({
      id: messageId,
      trip_id: tripId,
      sender_clerk_id: access.userId,
      content,
      image_storage_path: input.imageStoragePath ?? null,
      message_type: messageType,
      read_by: [access.userId],
      created_at: createdAt,
    }).select(MESSAGE_COLUMNS).maybeSingle();

    let row = data as Row | null;
    let created = !error;
    if (error) {
      if (error.code !== '23505') return failure('PERSISTENCE', 'Unable to send the message.');
      const repeated = await access.database.from('messages').select(MESSAGE_COLUMNS).eq('id', messageId).maybeSingle();
      if (repeated.error || !repeated.data || !isRecord(repeated.data)) return failure('PERSISTENCE', 'Unable to read the sent message.');
      row = repeated.data;
      created = false;
    }
    if (!row || !isRecord(row)) return failure('PERSISTENCE', 'Unable to read the sent message.');
    const message = messageDTO(row, access.userId);
    if (!message) return failure('PERSISTENCE', 'Unable to read the sent message.');
    if (created) await notifyOtherParticipant(access.database, tripId, access.userId, message.id);
    return { success: true, message, created };
  } catch {
    return failure('PERSISTENCE', 'Unable to send the message.');
  }
}

export async function markMessageRead(input: MarkMessageReadInput): Promise<MessageResult> {
  if (!input || !validUuid(input.messageId) || (input.tripId !== undefined && !validUuid(input.tripId))) {
    return failure('INVALID_INPUT', 'Message ID or trip ID is invalid.');
  }
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  try {
    if (user.role !== 'family' && user.role !== 'companion') return failure('FORBIDDEN', 'You are not allowed to access messages.');
    // Only locate the message's trip here; requireAccess verifies participant
    // ownership before modifying read_by or returning any message data.
    const database = createServiceRoleClient();
    const { data: existing, error: readError } = await database.from('messages').select(MESSAGE_COLUMNS)
      .eq('id', input.messageId).maybeSingle();
    if (readError) return failure('PERSISTENCE', 'Unable to load the message.');
    if (!existing || !isRecord(existing) || !validUuid(existing.trip_id)) return failure('NOT_FOUND', 'Message not found.');
    if (input.tripId && input.tripId.toLowerCase() !== existing.trip_id) return failure('NOT_FOUND', 'Message not found.');
    const access = await requireAccess(existing.trip_id, true);
    if (isFailure(access)) return access;
    const readBy = Array.isArray(existing.read_by) ? existing.read_by.filter((value): value is string => typeof value === 'string') : [];
    if (!readBy.includes(access.userId)) readBy.push(access.userId);
    const { data: updated, error: updateError } = await database.from('messages').update({ read_by: readBy })
      .eq('id', input.messageId).eq('trip_id', existing.trip_id).select(MESSAGE_COLUMNS).maybeSingle();
    if (updateError || !updated || !isRecord(updated)) return failure('PERSISTENCE', 'Unable to mark the message as read.');
    const message = messageDTO(updated, access.userId);
    return message ? { success: true, message, created: false } : failure('PERSISTENCE', 'Unable to read the updated message.');
  } catch {
    return failure('PERSISTENCE', 'Unable to mark the message as read.');
  }
}
