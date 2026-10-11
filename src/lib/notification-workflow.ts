import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth/server';
import { encryptServerJSON } from '@/lib/traveler-sensitive-fields';
import type { NotificationActionError, TripNotificationResult } from '@/lib/notification-types';

type Row = Record<string, unknown>;
type Participants = { familyUserId: string; companionUserId: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code: NotificationActionError['code'], error: string): NotificationActionError {
  return { success: false, code, error };
}
function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isFailure(value: unknown): value is NotificationActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
function deterministicUuid(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function resolveParticipants(database: SupabaseClient, tripId: string): Promise<Participants | null | NotificationActionError> {
  const { data: trip, error: tripError } = await database.from('trips')
    .select('id, booking_id').eq('id', tripId).maybeSingle();
  if (tripError) return failure('PERSISTENCE', 'Unable to load the trip.');
  if (!trip || !isRecord(trip) || !validUuid(trip.booking_id)) return null;
  const { data: booking, error: bookingError } = await database.from('bookings')
    .select('id, trip_request_id, companion_id').eq('id', trip.booking_id).maybeSingle();
  if (bookingError) return failure('PERSISTENCE', 'Unable to load the trip booking.');
  if (!booking || !isRecord(booking) || !validUuid(booking.trip_request_id) || !validUuid(booking.companion_id)) return null;
  const { data: request, error: requestError } = await database.from('trip_requests')
    .select('id, family_id').eq('id', booking.trip_request_id).maybeSingle();
  if (requestError) return failure('PERSISTENCE', 'Unable to load the trip request.');
  if (!request || !isRecord(request) || !validUuid(request.family_id)) return null;
  const [{ data: family, error: familyError }, { data: companion, error: companionError }] = await Promise.all([
    database.from('families').select('family_member_clerk_id').eq('id', request.family_id).maybeSingle(),
    database.from('companions').select('user_clerk_id').eq('id', booking.companion_id).maybeSingle(),
  ]);
  if (familyError || companionError) return failure('PERSISTENCE', 'Unable to verify trip participants.');
  if (!family || !isRecord(family) || typeof family.family_member_clerk_id !== 'string' ||
      !companion || !isRecord(companion) || typeof companion.user_clerk_id !== 'string') return null;
  return { familyUserId: family.family_member_clerk_id, companionUserId: companion.user_clerk_id };
}

/**
 * Trusted fan-out helper, deliberately outside a use-server action module.
 * The supplied privileged client never crosses a browser action boundary.
 * Verified native role and trip participation gate recipients before writes.
 */
export async function createTripUpdateNotifications(
  database: SupabaseClient,
  tripId: string,
  title: string,
  data: Record<string, unknown> = {},
): Promise<TripNotificationResult> {
  if (!validUuid(tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  tripId = tripId.toLowerCase();
  if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 200) return failure('INVALID_INPUT', 'Notification title is invalid.');
  if (!isRecord(data)) return failure('INVALID_INPUT', 'Notification data is invalid.');
  try {
    const user = await getCurrentUser();
    if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
    if (user.role !== 'family' && user.role !== 'companion') return failure('FORBIDDEN', 'Trip participation is required.');
    const participants = await resolveParticipants(database, tripId);
    if (isFailure(participants)) return participants;
    if (!participants) return failure('NOT_FOUND', 'Trip not found.');
    if (user.id !== (user.role === 'family' ? participants.familyUserId : participants.companionUserId)) return failure('FORBIDDEN', 'Trip participation is required.');
    const recipients = [...new Set([participants.familyUserId, participants.companionUserId])];
    const eventKey = canonicalJson(data);
    const notificationIds: string[] = [];
    for (const recipient of recipients) {
      const id = deterministicUuid(`trip-update:${tripId}:${recipient}:${title.trim()}:${eventKey}`);
      const { error } = await database.from('notifications').insert({
        id, user_clerk_id: recipient, type: 'trip_update', title: title.trim(),
        body: null, data: encryptServerJSON({ ...data, tripId }),
      });
      if (error && error.code !== '23505') return failure('PERSISTENCE', 'Unable to create trip notifications.');
      notificationIds.push(id);
    }
    return { success: true, notificationIds };
  } catch {
    return failure('PERSISTENCE', 'Unable to create trip notifications.');
  }
}
