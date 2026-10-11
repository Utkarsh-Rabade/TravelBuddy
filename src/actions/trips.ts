'use server';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import type { BookingStatus } from '@/lib/booking-types';
import type { TripRequestStatus } from '@/lib/trip-request-types';
import type {
  TripActionError,
  TripDTO,
  TripErrorCode,
  TripLifecycleStatus,
  TripListResult,
  TripResult,
} from '@/lib/trip-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKING_COLUMNS = 'id, trip_request_id, companion_id, status';
const REQUEST_COLUMNS = [
  'id', 'family_id', 'origin_airport', 'destination_airport',
  'departure_date', 'return_date', 'status',
].join(', ');
const TRIP_COLUMNS = 'id, booking_id, start_time, end_time, last_check_in, created_at, updated_at';

const BOOKING_STATUSES = new Set<BookingStatus>([
  'confirmed', 'cancelled_by_family', 'cancelled_by_companion', 'completed',
]);
const REQUEST_STATUSES = new Set<TripRequestStatus>([
  'draft', 'searching', 'matched', 'booked', 'in_progress', 'completed', 'cancelled', 'expired',
]);
const VISIBLE_REQUEST_STATUSES = new Set<TripRequestStatus>([
  'booked', 'in_progress', 'completed', 'cancelled',
]);
const UUID_NAMESPACE = 'trip-row:';

type Row = Record<string, unknown>;
type Database = SupabaseClient;
type Role = 'family' | 'companion';
type Context = {
  database: Database;
  role: Role;
  familyId?: string;
  companionId?: string;
};
type BookingWithRequest = {
  booking: Row;
  request: Row;
};

function failure(code: TripErrorCode, error: string): TripActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is TripActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && BOOKING_STATUSES.has(value as BookingStatus);
}

function isRequestStatus(value: unknown): value is TripRequestStatus {
  return typeof value === 'string' && REQUEST_STATUSES.has(value as TripRequestStatus);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function tripLifecycleStatus(status: TripRequestStatus): TripLifecycleStatus | null {
  if (status === 'booked') return 'upcoming';
  if (status === 'in_progress' || status === 'completed' || status === 'cancelled') return status;
  return null;
}

function deterministicTripId(bookingId: string): string {
  const digest = createHash('sha256').update(`${UUID_NAMESPACE}${bookingId.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

async function requireContext(role?: Role): Promise<Context | TripActionError> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family' && user.role !== 'companion') {
    return failure('FORBIDDEN', 'You are not allowed to access trips.');
  }
  if (role && user.role !== role) {
    return failure('FORBIDDEN', 'You are not allowed to perform this trip action.');
  }

  try {
    // Trusted trip creation/lifecycle/check-in writes cannot use ordinary RLS.
    // Verified role + profile ownership precede readOwnedBooking, which checks
    // request/booking participation before writes or safe trip projections.
    const database = createServiceRoleClient();
    if (user.role === 'family') {
      const { data, error } = await database.from('families').select('id')
        .eq('family_member_clerk_id', user.id).maybeSingle();
      if (error || !data || !validUuid(data.id)) return failure('FORBIDDEN', 'Family ownership could not be verified.');
      return { database, role: user.role, familyId: data.id };
    }
    const { data, error } = await database.from('companions').select('id')
      .eq('user_clerk_id', user.id).maybeSingle();
    if (error || !data || !validUuid(data.id)) return failure('FORBIDDEN', 'Companion ownership could not be verified.');
    return { database, role: user.role, companionId: data.id };
  } catch {
    return failure('PERSISTENCE', 'Unable to load the current user.');
  }
}

async function readOwnedBooking(
  context: Context,
  bookingId: string,
): Promise<BookingWithRequest | null | TripActionError> {
  const { data: booking, error: bookingError } = await context.database.from('bookings')
    .select(BOOKING_COLUMNS).eq('id', bookingId).maybeSingle();
  if (bookingError) return failure('PERSISTENCE', 'Unable to load the booking.');
  if (!booking || !isRecord(booking)) return null;
  if (!validUuid(booking.trip_request_id) || !validUuid(booking.companion_id) || !isBookingStatus(booking.status)) {
    return failure('PERSISTENCE', 'Unable to read the booking.');
  }

  const requestQuery = context.database.from('trip_requests').select(REQUEST_COLUMNS)
    .eq('id', booking.trip_request_id);
  const { data: request, error: requestError } = context.role === 'family'
    ? await requestQuery.eq('family_id', context.familyId as string).maybeSingle()
    : await requestQuery.maybeSingle();
  if (requestError) return failure('PERSISTENCE', 'Unable to verify trip ownership.');
  if (!request || !isRecord(request)) return null;
  if (context.role === 'companion' && booking.companion_id !== context.companionId) return null;
  if (request.id !== booking.trip_request_id || !isRequestStatus(request.status)) {
    return failure('PERSISTENCE', 'Unable to read the trip request.');
  }
  return { booking, request };
}

async function readTripRow(database: Database, bookingId: string): Promise<Row | null | TripActionError> {
  const { data, error } = await database.from('trips').select(TRIP_COLUMNS)
    .eq('booking_id', bookingId).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the trip.');
  if (!data || !isRecord(data)) return null;
  return data;
}

/**
 * The trips schema requires start_time, but trip_requests stores a DATE only.
 * The server therefore derives the canonical start at 00:00:00 UTC and never
 * accepts a client-supplied start time.
 */
function serverStartTime(request: Row): string | null {
  if (!isDate(request.departure_date)) return null;
  return `${request.departure_date}T00:00:00.000Z`;
}

async function ensureTripRow(
  database: Database,
  booking: Row,
  request: Row,
  allowCancelledBooking = false,
): Promise<Row | TripActionError> {
  if (!validUuid(booking.id) || !validUuid(booking.trip_request_id) || !isBookingStatus(booking.status)) {
    return failure('PERSISTENCE', 'Unable to read the booking.');
  }
  if (!allowCancelledBooking && booking.status !== 'confirmed') {
    return failure('INVALID_STATE', 'A trip row can only be created for a confirmed booking.');
  }
  const startTime = serverStartTime(request);
  if (!startTime) return failure('PERSISTENCE', 'Unable to derive the trip start time.');

  const existing = await readTripRow(database, booking.id);
  if (isFailure(existing)) return existing;
  if (existing) return existing;

  const tripId = deterministicTripId(booking.id);
  const { data, error } = await database.from('trips').insert({
    id: tripId,
    booking_id: booking.id,
    start_time: startTime,
  }).select(TRIP_COLUMNS).single();
  if (!error && data && isRecord(data)) return data;

  // The deterministic primary key makes concurrent retries converge even
  // though the deployed schema does not have a unique booking_id constraint.
  if (error?.code === '23505') {
    const repeated = await readTripRow(database, booking.id);
    if (isFailure(repeated)) return repeated;
    if (repeated) return repeated;
  }
  return failure('PERSISTENCE', 'Unable to create the trip.');
}

function tripDTO(booking: Row, request: Row, trip: Row): TripDTO | TripActionError {
  const requestStatus = request.status;
  const lifecycle = isRequestStatus(requestStatus) ? tripLifecycleStatus(requestStatus) : null;
  if (!validUuid(booking.id) || !validUuid(booking.trip_request_id) || !isBookingStatus(booking.status) ||
      !validUuid(request.id) || request.id !== booking.trip_request_id || !isRequestStatus(requestStatus) ||
      !lifecycle || !validUuid(trip.id) || trip.booking_id !== booking.id ||
      !isTimestamp(trip.start_time) ||
      (trip.end_time !== null && !isTimestamp(trip.end_time)) ||
      (trip.last_check_in !== null && !isTimestamp(trip.last_check_in)) ||
      typeof request.origin_airport !== 'string' || typeof request.destination_airport !== 'string' ||
      !isDate(request.departure_date) || (request.return_date !== null && !isDate(request.return_date))) {
    return failure('PERSISTENCE', 'Unable to read the trip.');
  }
  return {
    id: trip.id,
    booking_id: booking.id,
    trip_request_id: request.id,
    status: lifecycle,
    request_status: requestStatus,
    booking_status: booking.status,
    start_time: trip.start_time,
    end_time: trip.end_time as string | null,
    last_check_in: trip.last_check_in as string | null,
    booking: { id: booking.id, status: booking.status },
    trip_request: {
      id: request.id,
      origin_airport: request.origin_airport,
      destination_airport: request.destination_airport,
      departure_date: request.departure_date,
      return_date: request.return_date as string | null,
    },
  };
}

async function resultForOwnedTrip(
  context: Context,
  owned: BookingWithRequest,
  allowCreateForCancelled = false,
): Promise<TripResult> {
  if (!VISIBLE_REQUEST_STATUSES.has(owned.request.status as TripRequestStatus)) {
    return failure('INVALID_STATE', 'This booking does not have an active trip.');
  }
  let trip = await readTripRow(context.database, owned.booking.id as string);
  if (isFailure(trip)) return trip;
  if (!trip && (owned.booking.status === 'confirmed' || allowCreateForCancelled)) {
    trip = await ensureTripRow(context.database, owned.booking, owned.request, allowCreateForCancelled);
    if (isFailure(trip)) return trip;
  }
  if (!trip) return failure('NOT_FOUND', 'Trip not found.');
  const dto = tripDTO(owned.booking, owned.request, trip);
  return isFailure(dto) ? dto : { success: true, trip: dto };
}

export async function getTripForBooking(bookingId: string): Promise<TripResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext();
  if (isFailure(context)) return context;
  try {
    const owned = await readOwnedBooking(context, bookingId);
    if (isFailure(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Trip not found.');
    return resultForOwnedTrip(context, owned);
  } catch {
    return failure('PERSISTENCE', 'Unable to load the trip.');
  }
}

export async function listCurrentUserTrips(): Promise<TripListResult> {
  const context = await requireContext();
  if (isFailure(context)) return context;
  try {
    let bookings: Row[] = [];
    if (context.role === 'companion') {
      const { data, error } = await context.database.from('bookings').select(BOOKING_COLUMNS)
        .eq('companion_id', context.companionId as string).order('created_at', { ascending: false });
      if (error) return failure('PERSISTENCE', 'Unable to load trips.');
      bookings = (data ?? []) as unknown as Row[];
    } else {
      const { data: requests, error: requestError } = await context.database.from('trip_requests')
        .select('id').eq('family_id', context.familyId as string).in('status', [...VISIBLE_REQUEST_STATUSES]);
      if (requestError) return failure('PERSISTENCE', 'Unable to load trips.');
      const requestIds = (requests ?? []).map((row) => row.id).filter(validUuid);
      if (requestIds.length === 0) return { success: true, trips: [] };
      const { data, error } = await context.database.from('bookings').select(BOOKING_COLUMNS)
        .in('trip_request_id', requestIds).order('created_at', { ascending: false });
      if (error) return failure('PERSISTENCE', 'Unable to load trips.');
      bookings = (data ?? []) as unknown as Row[];
    }

    const trips: TripDTO[] = [];
    for (const booking of bookings) {
      if (!validUuid(booking.id)) return failure('PERSISTENCE', 'Unable to read trips.');
      const owned = await readOwnedBooking(context, booking.id);
      if (isFailure(owned)) return owned;
      if (!owned || !VISIBLE_REQUEST_STATUSES.has(owned.request.status as TripRequestStatus)) continue;
      const result = await resultForOwnedTrip(context, owned);
      if (!result.success) {
        if (result.code === 'NOT_FOUND') continue;
        return result;
      }
      trips.push(result.trip);
    }
    return { success: true, trips };
  } catch {
    return failure('PERSISTENCE', 'Unable to load trips.');
  }
}

export async function startTrip(bookingId: string): Promise<TripResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext('companion');
  if (isFailure(context)) return context;
  try {
    const owned = await readOwnedBooking(context, bookingId);
    if (isFailure(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Trip not found.');
    if (owned.booking.status !== 'confirmed' || owned.request.status !== 'booked') {
      return failure('INVALID_STATE', 'Only a confirmed booked trip can be started.');
    }
    const ensured = await ensureTripRow(context.database, owned.booking, owned.request);
    if (isFailure(ensured)) return ensured;
    const { data: updated, error } = await context.database.from('trip_requests').update({
      status: 'in_progress', updated_at: new Date().toISOString(),
    }).eq('id', owned.request.id as string).eq('status', 'booked').select('id').maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to start the trip.');
    if (!updated) {
      const latest = await readOwnedBooking(context, bookingId);
      if (isFailure(latest) || !latest) return failure('CONFLICT', 'The trip changed. Reload it and try again.');
      if (latest.request.status === 'in_progress') return resultForOwnedTrip(context, latest);
      return failure('INVALID_STATE', 'Only a confirmed booked trip can be started.');
    }
    const latest = await readOwnedBooking(context, bookingId);
    if (isFailure(latest) || !latest) return failure('CONFLICT', 'The trip changed. Reload it and try again.');
    return resultForOwnedTrip(context, latest);
  } catch {
    return failure('PERSISTENCE', 'Unable to start the trip.');
  }
}

export async function completeTrip(bookingId: string): Promise<TripResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext('companion');
  if (isFailure(context)) return context;
  try {
    const owned = await readOwnedBooking(context, bookingId);
    if (isFailure(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Trip not found.');
    if (owned.booking.status !== 'confirmed' || owned.request.status !== 'in_progress') {
      return failure('INVALID_STATE', 'Only a confirmed in-progress trip can be completed.');
    }
    const ensured = await ensureTripRow(context.database, owned.booking, owned.request);
    if (isFailure(ensured)) return ensured;
    const completedAt = new Date().toISOString();
    const { data: updatedRequest, error: requestError } = await context.database.from('trip_requests').update({
      status: 'completed', updated_at: completedAt,
    }).eq('id', owned.request.id as string).eq('status', 'in_progress').select('id').maybeSingle();
    if (requestError) return failure('PERSISTENCE', 'Unable to complete the trip.');
    if (!updatedRequest) return failure('CONFLICT', 'The trip changed. Reload it and try again.');

    const { data: updatedTrip, error: tripError } = await context.database.from('trips').update({
      end_time: completedAt, updated_at: completedAt,
    }).eq('id', ensured.id as string).eq('booking_id', bookingId).is('end_time', null)
      .select(TRIP_COLUMNS).maybeSingle();
    if (tripError || !updatedTrip) {
      await context.database.from('trip_requests').update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', owned.request.id as string).eq('status', 'completed');
      return failure('CONFLICT', 'The trip could not be completed safely.');
    }

    const { data: updatedBooking, error: bookingError } = await context.database.from('bookings').update({
      status: 'completed', updated_at: completedAt,
    }).eq('id', bookingId).eq('status', 'confirmed').select('id').maybeSingle();
    if (bookingError || !updatedBooking) {
      await context.database.from('trips').update({ end_time: null, updated_at: new Date().toISOString() })
        .eq('id', ensured.id as string).eq('booking_id', bookingId).eq('end_time', completedAt);
      await context.database.from('trip_requests').update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', owned.request.id as string).eq('status', 'completed');
      return failure('CONFLICT', 'The trip could not be completed safely.');
    }

    const latest = await readOwnedBooking(context, bookingId);
    if (isFailure(latest) || !latest) return failure('PERSISTENCE', 'Unable to read the completed trip.');
    return resultForOwnedTrip(context, latest);
  } catch {
    return failure('PERSISTENCE', 'Unable to complete the trip.');
  }
}

/** Synchronizes a previously cancelled booking with its trip lifecycle. */
export async function cancelTrip(bookingId: string): Promise<TripResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext();
  if (isFailure(context)) return context;
  try {
    const owned = await readOwnedBooking(context, bookingId);
    if (isFailure(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Trip not found.');
    if (owned.booking.status !== 'cancelled_by_family' && owned.booking.status !== 'cancelled_by_companion') {
      return failure('INVALID_STATE', 'The booking must be cancelled before its trip can be cancelled.');
    }
    if (owned.request.status !== 'booked' && owned.request.status !== 'in_progress') {
      return failure('INVALID_STATE', 'Only an upcoming or in-progress trip can be cancelled.');
    }

    // A booking may have been cancelled before anyone first viewed or started
    // the trip, so this action also repairs the required trips row.
    const ensured = await ensureTripRow(context.database, owned.booking, owned.request, true);
    if (isFailure(ensured)) return ensured;
    const previousStatus = owned.request.status;
    const cancelledAt = new Date().toISOString();
    const { data: updatedRequest, error: requestError } = await context.database.from('trip_requests').update({
      status: 'cancelled', updated_at: cancelledAt,
    }).eq('id', owned.request.id as string).in('status', ['booked', 'in_progress']).select('id').maybeSingle();
    if (requestError) return failure('PERSISTENCE', 'Unable to cancel the trip.');
    if (!updatedRequest) return failure('CONFLICT', 'The trip changed. Reload it and try again.');

    const { data: updatedTrip, error: tripError } = await context.database.from('trips').update({
      end_time: cancelledAt, updated_at: cancelledAt,
    }).eq('id', ensured.id as string).eq('booking_id', bookingId).select(TRIP_COLUMNS).maybeSingle();
    if (tripError || !updatedTrip) {
      await context.database.from('trip_requests').update({ status: previousStatus, updated_at: new Date().toISOString() })
        .eq('id', owned.request.id as string).eq('status', 'cancelled');
      return failure('CONFLICT', 'The trip could not be cancelled safely.');
    }
    const latest = await readOwnedBooking(context, bookingId);
    if (isFailure(latest) || !latest) return failure('PERSISTENCE', 'Unable to read the cancelled trip.');
    return resultForOwnedTrip(context, latest);
  } catch {
    return failure('PERSISTENCE', 'Unable to cancel the trip.');
  }
}

export async function companionCheckIn(bookingId: string): Promise<TripResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext('companion');
  if (isFailure(context)) return context;
  try {
    const owned = await readOwnedBooking(context, bookingId);
    if (isFailure(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Trip not found.');
    if (owned.booking.status !== 'confirmed' || owned.request.status !== 'in_progress') {
      return failure('INVALID_STATE', 'Check-in is only available for a confirmed in-progress trip.');
    }
    const existing = await readTripRow(context.database, bookingId);
    if (isFailure(existing)) return existing;
    if (!existing) return failure('NOT_FOUND', 'Trip not found.');
    if (!validUuid(existing.id) || existing.end_time !== null) {
      return failure('INVALID_STATE', 'Completed or cancelled trips cannot receive check-ins.');
    }
    // The schema has no check_ins table: the only supported check-in state is
    // the trips.last_check_in timestamp, always assigned by the server.
    const checkedInAt = new Date().toISOString();
    const { data: updated, error } = await context.database.from('trips').update({
      last_check_in: checkedInAt, updated_at: checkedInAt,
    }).eq('id', existing.id).eq('booking_id', bookingId).is('end_time', null)
      .select(TRIP_COLUMNS).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to save the check-in.');
    if (!updated) return failure('INVALID_STATE', 'Completed or cancelled trips cannot receive check-ins.');
    const dto = tripDTO(owned.booking, owned.request, updated as unknown as Row);
    return isFailure(dto) ? dto : { success: true, trip: dto };
  } catch {
    return failure('PERSISTENCE', 'Unable to save the check-in.');
  }
}
