'use server';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import {
  assertTravelerEncryptionConfigured,
  decryptServerJSON,
  encryptServerJSON,
} from '@/lib/traveler-sensitive-fields';
import type {
  AcknowledgeSosInput,
  ConsentLookupResult,
  ConsentResult,
  CreateSosInput,
  GrantLocationConsentInput,
  ListSosEventsInput,
  ListTripLocationsInput,
  LocationInput,
  LocationListResult,
  LocationResult,
  RecordTripLocationInput,
  ResolveSosInput,
  RevokeLocationConsentInput,
  SafetyActionError,
  SosEventDTO,
  SosListResult,
  SosResult,
  SosStatus,
  TripConsentDTO,
  TripLocationDTO,
} from '@/lib/safety-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSENT_COLUMNS = 'id, trip_id, data_type, granted_by_clerk_id, granted_at, expires_at, revoked_at, notes';
const LOCATION_COLUMNS = 'id, trip_id, latitude, longitude, accuracy, recorded_at';
const SOS_COLUMNS = 'id, trip_id, triggered_by_clerk_id, triggered_at, location, status, acknowledged_by_clerk_id, acknowledged_at, resolved_by_clerk_id, resolved_at, resolution_note';

type Row = Record<string, unknown>;
type Database = SupabaseClient;
type Role = 'family' | 'companion';
type ParticipantContext = {
  trip: Row;
  booking: Row;
  request: Row;
  familyUserId: string;
  companionUserId: string;
  role: Role;
  actorId: string;
};

function failure(code: SafetyActionError['code'], error: string): SafetyActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is SafetyActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateLocation(value: unknown): value is LocationInput {
  if (!isRecord(value) || !finiteNumber(value.latitude) || !finiteNumber(value.longitude) ||
      !Number.isInteger(value.accuracy)) return false;
  const latitude = value.latitude;
  const longitude = value.longitude;
  const accuracy = value.accuracy as number;
  return latitude >= -90 && latitude <= 90 && longitude >= -180 &&
    longitude <= 180 && accuracy >= 0 && accuracy <= 10000;
}

function validDateOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || timestamp(value);
}

function activeTripState(requestStatus: unknown, bookingStatus: unknown, endTime: unknown): boolean {
  return bookingStatus === 'confirmed' && requestStatus === 'in_progress' && endTime === null;
}

function sosTripState(requestStatus: unknown, bookingStatus: unknown, endTime: unknown): boolean {
  return bookingStatus === 'confirmed' &&
    (requestStatus === 'booked' || requestStatus === 'in_progress') && endTime === null;
}

function deterministicUuid(seed: string): string {
  const digest = createHash('sha256').update(seed, 'utf8').digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function canonicalKey(value: string): string {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
}

function consentStatus(row: Row, now = Date.now()): TripConsentDTO['status'] {
  if (row.revoked_at !== null) return 'revoked';
  if (row.expires_at !== null && timestamp(row.expires_at) && Date.parse(row.expires_at) <= now) return 'expired';
  return 'active';
}

function consentDTO(row: Row): TripConsentDTO | null {
  if (!validUuid(row.id) || !validUuid(row.trip_id) || row.data_type !== 'location' ||
      typeof row.granted_by_clerk_id !== 'string' || !timestamp(row.granted_at) ||
      !validDateOrNull(row.expires_at) || !validDateOrNull(row.revoked_at) ||
      (row.notes !== null && typeof row.notes !== 'string')) return null;
  return {
    id: row.id,
    trip_id: row.trip_id,
    data_type: 'location',
    granted_by_clerk_id: row.granted_by_clerk_id,
    granted_at: row.granted_at,
    expires_at: row.expires_at as string | null,
    revoked_at: row.revoked_at as string | null,
    notes: row.notes as string | null,
    status: consentStatus(row),
  };
}

function locationDTO(row: Row): TripLocationDTO | null {
  if (!validUuid(row.id) || !validUuid(row.trip_id) || !validateLocation(row) || !timestamp(row.recorded_at)) return null;
  return {
    id: row.id,
    trip_id: row.trip_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    recorded_at: row.recorded_at,
  };
}

function decodeLocation(value: unknown): LocationInput | null {
  const decoded = decryptServerJSON(value);
  if (!isRecord(decoded)) return null;
  if (validateLocation(decoded)) return decoded;
  if (isRecord(decoded.location) && validateLocation(decoded.location)) return decoded.location;
  if (finiteNumber(decoded.lat) && finiteNumber(decoded.lng) && Number.isInteger(decoded.accuracy) &&
      decoded.lat >= -90 && decoded.lat <= 90 && decoded.lng >= -180 && decoded.lng <= 180 &&
      (decoded.accuracy as number) >= 0 && (decoded.accuracy as number) <= 10000) {
    return { latitude: decoded.lat, longitude: decoded.lng, accuracy: decoded.accuracy as number };
  }
  return null;
}

function sosDTO(row: Row): SosEventDTO | null {
  const statuses: SosStatus[] = ['active', 'acknowledged', 'resolved'];
  if (!validUuid(row.id) || !validUuid(row.trip_id) || typeof row.triggered_by_clerk_id !== 'string' ||
      !timestamp(row.triggered_at) || !statuses.includes(row.status as SosStatus) ||
      (row.acknowledged_by_clerk_id !== null && typeof row.acknowledged_by_clerk_id !== 'string') ||
      (row.resolved_by_clerk_id !== null && typeof row.resolved_by_clerk_id !== 'string') ||
      !validDateOrNull(row.acknowledged_at) || !validDateOrNull(row.resolved_at) ||
      (row.resolution_note !== null && typeof row.resolution_note !== 'string')) return null;
  return {
    id: row.id,
    trip_id: row.trip_id,
    triggered_by_clerk_id: row.triggered_by_clerk_id,
    triggered_at: row.triggered_at,
    location: decodeLocation(row.location),
    status: row.status as SosStatus,
    acknowledged_by_clerk_id: row.acknowledged_by_clerk_id as string | null,
    acknowledged_at: row.acknowledged_at as string | null,
    resolved_by_clerk_id: row.resolved_by_clerk_id as string | null,
    resolved_at: row.resolved_at as string | null,
    resolution_note: row.resolution_note as string | null,
  };
}

async function currentUser(): Promise<{ id: string; role: Role } | SafetyActionError> {
  try {
    const user = await getCurrentUser();
    if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
    if (user.role !== 'family' && user.role !== 'companion') return failure('FORBIDDEN', 'You are not allowed to perform safety actions.');
    return { id: user.id, role: user.role };
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
}

/** Resolve the complete ownership chain from the authenticated actor. */
async function participantContext(database: Database, tripId: string): Promise<ParticipantContext | SafetyActionError | null> {
  const actor = await currentUser();
  if (isFailure(actor)) return actor;
  const { data: trip, error: tripError } = await database.from('trips')
    .select('id, booking_id, end_time, current_location, sos_triggered').eq('id', tripId).maybeSingle();
  if (tripError) return failure('PERSISTENCE', 'Unable to load the trip.');
  if (!trip || !isRecord(trip) || !validUuid(trip.booking_id)) return null;

  const { data: booking, error: bookingError } = await database.from('bookings')
    .select('id, trip_request_id, companion_id, status').eq('id', trip.booking_id).maybeSingle();
  if (bookingError) return failure('PERSISTENCE', 'Unable to load the trip booking.');
  if (!booking || !isRecord(booking) || !validUuid(booking.trip_request_id) || !validUuid(booking.companion_id)) return null;

  const { data: request, error: requestError } = await database.from('trip_requests')
    .select('id, family_id, status').eq('id', booking.trip_request_id).maybeSingle();
  if (requestError) return failure('PERSISTENCE', 'Unable to load the trip request.');
  if (!request || !isRecord(request) || !validUuid(request.family_id)) return null;

  const [{ data: family, error: familyError }, { data: companion, error: companionError }] = await Promise.all([
    database.from('families').select('family_member_clerk_id').eq('id', request.family_id).maybeSingle(),
    database.from('companions').select('user_clerk_id').eq('id', booking.companion_id).maybeSingle(),
  ]);
  if (familyError || companionError) return failure('PERSISTENCE', 'Unable to verify trip participants.');
  if (!family || !isRecord(family) || typeof family.family_member_clerk_id !== 'string' ||
      !companion || !isRecord(companion) || typeof companion.user_clerk_id !== 'string') return null;

  const familyUserId = family.family_member_clerk_id;
  const companionUserId = companion.user_clerk_id;
  if ((actor.role === 'family' && actor.id !== familyUserId) ||
      (actor.role === 'companion' && actor.id !== companionUserId)) return null;
  return { trip, booking, request, familyUserId, companionUserId, role: actor.role, actorId: actor.id };
}

async function requireParticipant(database: Database, tripId: string): Promise<ParticipantContext | SafetyActionError> {
  const context = await participantContext(database, tripId);
  if (isFailure(context)) return context;
  return context ?? failure('NOT_FOUND', 'Trip not found.');
}

async function activeLocationConsent(database: Database, tripId: string, ownerId: string): Promise<TripConsentDTO | SafetyActionError | null> {
  const { data, error } = await database.from('trip_consents').select(CONSENT_COLUMNS)
    .eq('trip_id', tripId).eq('data_type', 'location').eq('granted_by_clerk_id', ownerId)
    .is('revoked_at', null).order('granted_at', { ascending: false }).limit(20);
  if (error) return failure('PERSISTENCE', 'Unable to load location consent.');
  const now = Date.now();
  for (const row of data ?? []) {
    if (!isRecord(row)) continue;
    const consent = consentDTO(row);
    if (consent && consent.status === 'active' && (consent.expires_at === null || Date.parse(consent.expires_at) > now)) return consent;
  }
  return null;
}

export async function getLocationConsent(input: { tripId: string }): Promise<ConsentLookupResult> {
  if (!isRecord(input) || !validUuid(input.tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  try {
    // Trusted safety access: requireParticipant verifies role and the complete
    // trip ownership chain before any consent read or write.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    const { data, error } = await database.from('trip_consents').select(CONSENT_COLUMNS)
      .eq('trip_id', input.tripId).eq('data_type', 'location')
      .eq('granted_by_clerk_id', context.familyUserId)
      .order('granted_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to load location consent.');
    if (!data) return { success: true, consent: null };
    if (!isRecord(data)) return failure('PERSISTENCE', 'Unable to read location consent.');
    const consent = consentDTO(data);
    return consent ? { success: true, consent } : failure('PERSISTENCE', 'Unable to read location consent.');
  } catch {
    return failure('PERSISTENCE', 'Unable to load location consent.');
  }
}

function requireConfiguredEncryption(): SafetyActionError | null {
  try {
    assertTravelerEncryptionConfigured();
    return null;
  } catch {
    return failure('CONFIGURATION', 'Safety encryption is not configured.');
  }
}

function encryptedJSON(value: unknown): string | SafetyActionError {
  const configurationError = requireConfiguredEncryption();
  if (configurationError) return configurationError;
  const encrypted = encryptServerJSON(value);
  return encrypted ?? failure('CONFIGURATION', 'Safety encryption is not configured.');
}

export async function grantLocationConsent(input: GrantLocationConsentInput): Promise<ConsentResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || !validDateOrNull(input.expiresAt) ||
      (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') ||
      (typeof input.notes === 'string' && input.notes.length > 1000)) return failure('INVALID_INPUT', 'Consent input is invalid.');
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) return failure('INVALID_INPUT', 'Consent expiry must be in the future.');
  const actor = await currentUser();
  if (isFailure(actor)) return actor;
  if (actor.role !== 'family') return failure('FORBIDDEN', 'Only the family owner can grant location consent.');
  try {
    // Consent writes are trusted; verified family role and requireParticipant
    // bind the grant to the actual family owner before persistence.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    if (context.role !== 'family') return failure('FORBIDDEN', 'Only the family owner can grant location consent.');
    if (!sosTripState(context.request.status, context.booking.status, context.trip.end_time)) return failure('INVALID_STATE', 'Consent is unavailable for a completed or cancelled trip.');
    const { data, error } = await database.from('trip_consents').insert({
      trip_id: input.tripId,
      data_type: 'location',
      granted_by_clerk_id: context.familyUserId,
      expires_at: input.expiresAt ?? null,
      notes: input.notes ?? null,
    }).select(CONSENT_COLUMNS).single();
    if (error || !data || !isRecord(data)) return failure('PERSISTENCE', 'Unable to grant location consent.');
    const consent = consentDTO(data);
    return consent ? { success: true, consent } : failure('PERSISTENCE', 'Unable to read granted consent.');
  } catch {
    return failure('PERSISTENCE', 'Unable to grant location consent.');
  }
}

export async function revokeLocationConsent(input: RevokeLocationConsentInput): Promise<ConsentResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || (input.consentId !== undefined && !validUuid(input.consentId))) return failure('INVALID_INPUT', 'Consent input is invalid.');
  const actor = await currentUser();
  if (isFailure(actor)) return actor;
  if (actor.role !== 'family') return failure('FORBIDDEN', 'Only the family owner can revoke location consent.');
  try {
    // Consent revocation is trusted and gated by verified family ownership.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    if (context.role !== 'family') return failure('FORBIDDEN', 'Only the family owner can revoke location consent.');
    let query = database.from('trip_consents').select(CONSENT_COLUMNS)
      .eq('trip_id', input.tripId).eq('data_type', 'location').eq('granted_by_clerk_id', context.familyUserId);
    if (input.consentId) query = query.eq('id', input.consentId);
    const { data: existing, error: readError } = await query.order('granted_at', { ascending: false }).limit(1).maybeSingle();
    if (readError) return failure('PERSISTENCE', 'Unable to load location consent.');
    if (!existing || !isRecord(existing)) return failure('NOT_FOUND', 'Location consent not found.');
    if (existing.revoked_at !== null) {
      const consent = consentDTO(existing);
      return consent ? { success: true, consent } : failure('PERSISTENCE', 'Unable to read consent.');
    }
    const revokedAt = new Date().toISOString();
    const { data, error } = await database.from('trip_consents').update({ revoked_at: revokedAt })
      .eq('id', existing.id as string).eq('trip_id', input.tripId).is('revoked_at', null).select(CONSENT_COLUMNS).maybeSingle();
    if (error || !data || !isRecord(data)) return failure('PERSISTENCE', 'Unable to revoke location consent.');
    const consent = consentDTO(data);
    return consent ? { success: true, consent } : failure('PERSISTENCE', 'Unable to read revoked consent.');
  } catch {
    return failure('PERSISTENCE', 'Unable to revoke location consent.');
  }
}

export async function recordTripLocation(input: RecordTripLocationInput): Promise<LocationResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || !validateLocation(input)) return failure('INVALID_INPUT', 'Location input is invalid.');
  try {
    // Location writes are trusted: requireParticipant, active trip state and
    // family consent are required before storing or updating location.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    if (context.role !== 'companion') return failure('FORBIDDEN', 'Only the assigned companion can submit location.');
    if (!activeTripState(context.request.status, context.booking.status, context.trip.end_time)) return failure('INVALID_STATE', 'Location updates require an in-progress trip.');
    const consent = await activeLocationConsent(database, input.tripId, context.familyUserId);
    if (isFailure(consent)) return consent;
    if (!consent) return failure('FORBIDDEN', 'Active family location consent is required.');
    const recordedAt = new Date().toISOString();
    const encrypted = encryptedJSON({ lat: input.latitude, lng: input.longitude, accuracy: input.accuracy, timestamp: recordedAt });
    if (isFailure(encrypted)) return encrypted;
    const { data, error } = await database.from('trip_locations').insert({
      trip_id: input.tripId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      recorded_at: recordedAt,
    }).select(LOCATION_COLUMNS).single();
    if (error || !data || !isRecord(data)) return failure('PERSISTENCE', 'Unable to save location.');
    const { error: currentError } = await database.from('trips').update({ current_location: encrypted, updated_at: recordedAt })
      .eq('id', input.tripId).is('end_time', null);
    if (currentError) return failure('PERSISTENCE', 'Unable to update current location.');
    const location = locationDTO(data);
    return location ? { success: true, location } : failure('PERSISTENCE', 'Unable to read saved location.');
  } catch {
    return failure('PERSISTENCE', 'Unable to save location.');
  }
}

export async function listTripLocations(input: ListTripLocationsInput): Promise<LocationListResult> {
  if (!isRecord(input) || !validUuid(input.tripId) ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500))) return failure('INVALID_INPUT', 'Location list input is invalid.');
  try {
    // Sensitive location reads require the verified participant relationship
    // and active family consent; ordinary table reads cannot enforce this flow.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    const consent = await activeLocationConsent(database, input.tripId, context.familyUserId);
    if (isFailure(consent)) return consent;
    if (!consent) return failure('FORBIDDEN', 'Active family location consent is required.');
    const { data, error } = await database.from('trip_locations').select(LOCATION_COLUMNS)
      .eq('trip_id', input.tripId).order('recorded_at', { ascending: false }).limit(input.limit ?? 100);
    if (error) return failure('PERSISTENCE', 'Unable to load locations.');
    const locations: TripLocationDTO[] = [];
    for (const row of data ?? []) {
      if (!isRecord(row)) return failure('PERSISTENCE', 'Unable to read locations.');
      const location = locationDTO(row);
      if (!location) return failure('PERSISTENCE', 'Unable to read locations.');
      locations.push(location);
    }
    return { success: true, locations };
  } catch {
    return failure('PERSISTENCE', 'Unable to load locations.');
  }
}

export async function createSosEvent(input: CreateSosInput): Promise<SosResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || (input.location !== undefined && input.location !== null && !validateLocation(input.location)) ||
      (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || canonicalKey(input.idempotencyKey).length > 200))) return failure('INVALID_INPUT', 'SOS input is invalid.');
  try {
    // SOS/lifecycle writes and recipient fan-out are trusted. requireParticipant
    // verifies native role and ownership before any event or notification write.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    if (!sosTripState(context.request.status, context.booking.status, context.trip.end_time)) return failure('INVALID_STATE', 'SOS is unavailable for a completed or cancelled trip.');
    const triggeredAt = new Date().toISOString();
    // A missing key deduplicates only rapid retries in a short server bucket;
    // a later, legitimate SOS can therefore create a new event after a prior
    // event has been resolved. Explicit keys remain stable across retries.
    const key = canonicalKey(input.idempotencyKey ?? `auto-${Math.floor(Date.now() / 5000)}`);
    if (!key) return failure('INVALID_INPUT', 'SOS idempotency key is invalid.');
    const eventId = deterministicUuid(`sos:${input.tripId}:${context.actorId}:${key}`);
    const encrypted = encryptedJSON(input.location ? {
      lat: input.location.latitude, lng: input.location.longitude, accuracy: input.location.accuracy, timestamp: triggeredAt,
    } : { location: null, timestamp: triggeredAt });
    if (isFailure(encrypted)) return encrypted;
    const { data: inserted, error: insertError } = await database.from('sos_events').insert({
      id: eventId,
      trip_id: input.tripId,
      triggered_by_clerk_id: context.actorId,
      triggered_at: triggeredAt,
      location: encrypted,
      status: 'active',
    }).select(SOS_COLUMNS).maybeSingle();
    let eventRow = inserted;
    if (insertError && insertError.code !== '23505') return failure('PERSISTENCE', 'Unable to create SOS event.');
    if (!eventRow) {
      const repeated = await database.from('sos_events').select(SOS_COLUMNS).eq('id', eventId).maybeSingle();
      if (repeated.error || !repeated.data) return failure('PERSISTENCE', 'Unable to read SOS event.');
      eventRow = repeated.data;
    }
    if (!isRecord(eventRow)) return failure('PERSISTENCE', 'Unable to read SOS event.');
    const { error: tripError } = await database.from('trips').update({ sos_triggered: true, updated_at: triggeredAt }).eq('id', input.tripId);
    if (tripError) return failure('PERSISTENCE', 'Unable to mark the trip for SOS.');
    const recipient = context.role === 'family' ? context.companionUserId : context.familyUserId;
    const notificationId = deterministicUuid(`sos-notification:${eventId}:${recipient}`);
    const { error: notificationError } = await database.from('notifications').insert({
      id: notificationId,
      user_clerk_id: recipient,
      type: 'sos',
      title: 'Emergency assistance requested',
      body: null,
      data: encryptServerJSON({ tripId: input.tripId, sosEventId: eventId }),
    });
    if (notificationError && notificationError.code !== '23505') return failure('PERSISTENCE', 'Unable to create SOS notification.');
    const event = sosDTO(eventRow);
    return event ? { success: true, event } : failure('PERSISTENCE', 'Unable to read SOS event.');
  } catch {
    return failure('PERSISTENCE', 'Unable to create SOS event.');
  }
}

export async function listSosEvents(input: ListSosEventsInput): Promise<SosListResult> {
  if (!isRecord(input) || !validUuid(input.tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  try {
    // Privileged SOS projections are returned only after requireParticipant
    // verifies the caller against the complete trip relationship.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, input.tripId);
    if (isFailure(context)) return context;
    const { data, error } = await database.from('sos_events').select(SOS_COLUMNS)
      .eq('trip_id', input.tripId).order('triggered_at', { ascending: false });
    if (error) return failure('PERSISTENCE', 'Unable to load SOS events.');
    const events: SosEventDTO[] = [];
    for (const row of data ?? []) {
      if (!isRecord(row)) return failure('PERSISTENCE', 'Unable to read SOS events.');
      const event = sosDTO(row);
      if (!event) return failure('PERSISTENCE', 'Unable to read SOS events.');
      events.push(event);
    }
    return { success: true, events };
  } catch {
    return failure('PERSISTENCE', 'Unable to load SOS events.');
  }
}

export async function acknowledgeSos(input: AcknowledgeSosInput): Promise<SosResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || !validUuid(input.eventId)) return failure('INVALID_INPUT', 'SOS input is invalid.');
  return transitionSos(input.tripId, input.eventId, 'acknowledged');
}

export async function resolveSos(input: ResolveSosInput): Promise<SosResult> {
  if (!isRecord(input) || !validUuid(input.tripId) || !validUuid(input.eventId) ||
      (input.resolutionNote !== undefined && input.resolutionNote !== null && typeof input.resolutionNote !== 'string') ||
      (typeof input.resolutionNote === 'string' && input.resolutionNote.length > 2000)) return failure('INVALID_INPUT', 'SOS input is invalid.');
  return transitionSos(input.tripId, input.eventId, 'resolved', input.resolutionNote ?? null);
}

async function transitionSos(tripId: string, eventId: string, target: 'acknowledged' | 'resolved', resolutionNote?: string | null): Promise<SosResult> {
  try {
    // Trusted SOS transitions are gated by verified participation and the
    // event/trip/status predicates before updating any safety record.
    const database = createServiceRoleClient();
    const context = await requireParticipant(database, tripId);
    if (isFailure(context)) return context;
    const { data: existing, error: readError } = await database.from('sos_events').select(SOS_COLUMNS)
      .eq('id', eventId).eq('trip_id', tripId).maybeSingle();
    if (readError) return failure('PERSISTENCE', 'Unable to load SOS event.');
    if (!existing || !isRecord(existing)) return failure('NOT_FOUND', 'SOS event not found.');
    // Safety workflow is deliberately strict: active -> acknowledged -> resolved.
    // This keeps an unacknowledged alert from being silently closed.
    const expected = target === 'acknowledged' ? 'active' : 'acknowledged';
    if (existing.status !== expected) return failure(existing.status === target ? 'CONFLICT' : 'INVALID_STATE', `SOS event must be ${expected} before it can be ${target}.`);
    const now = new Date().toISOString();
    const update = target === 'acknowledged'
      ? { status: target, acknowledged_by_clerk_id: context.actorId, acknowledged_at: now }
      : { status: target, resolved_by_clerk_id: context.actorId, resolved_at: now, resolution_note: resolutionNote ?? null };
    const { data, error } = await database.from('sos_events').update(update).eq('id', eventId).eq('trip_id', tripId).eq('status', expected).select(SOS_COLUMNS).maybeSingle();
    if (error || !data || !isRecord(data)) return failure('CONFLICT', 'The SOS event changed. Reload and try again.');
    const event = sosDTO(data);
    return event ? { success: true, event } : failure('PERSISTENCE', 'Unable to read updated SOS event.');
  } catch {
    return failure('PERSISTENCE', 'Unable to update SOS event.');
  }
}
