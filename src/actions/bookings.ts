'use server';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import {
  isCompanionEligible,
  type MatchingCompanion,
  type MatchingTripRequest,
} from '@/lib/matching/score-calculator';
import { readExplanation } from '@/lib/matching/explanation-generator';
import type {
  BookingActionError,
  BookingCompanionDTO,
  BookingDTO,
  BookingErrorCode,
  BookingPaymentDTO,
  BookingPaymentState,
  BookingPaymentStatus,
  BookingPaymentType,
  BookingResult,
  BookingStatus,
  BookingTripDTO,
} from '@/lib/booking-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKING_COLUMNS = [
  'id', 'trip_request_id', 'companion_id', 'booking_reference', 'total_amount', 'currency',
  'payment_status', 'status', 'created_at', 'updated_at',
].join(', ');
const TRIP_COLUMNS = [
  'id', 'family_id', 'origin_airport', 'destination_airport', 'departure_date', 'return_date',
  'assistance_level', 'language_requirements', 'status',
].join(', ');
const COMPANION_COLUMNS = [
  'id', 'user_clerk_id', 'first_name', 'last_name', 'languages_spoken',
  'availability_calendar', 'verification_status', 'rating_average', 'total_trips',
].join(', ');
const PAYMENT_COLUMNS = 'id, booking_id, amount_cents, currency, type, status, created_at';

type Row = Record<string, unknown>;
type Database = SupabaseClient;
type Context = { database: Database; userId: string; role: 'family' | 'companion'; familyId?: string; companionId?: string };
type ActionResult<T> = { success: true } & T | BookingActionError;

const BOOKING_STATUSES = new Set<BookingStatus>([
  'confirmed', 'cancelled_by_family', 'cancelled_by_companion', 'completed',
]);
const PAYMENT_STATUSES = new Set<BookingPaymentStatus>([
  'pending', 'paid', 'failed', 'refunded', 'partially_refunded',
]);
const PAYMENT_TYPES = new Set<BookingPaymentType>([
  'platform_fee', 'companion_payout', 'refund', 'charge',
]);
const PAYMENT_STATES = new Set<BookingPaymentState>(['succeeded', 'failed', 'pending']);
const ASSISTANCE_LEVELS = new Set(['minimal', 'moderate', 'maximum']);
const VERIFICATION_STATUSES = new Set(['pending', 'verified', 'expired', 'rejected']);

function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && BOOKING_STATUSES.has(value as BookingStatus);
}

function isPaymentStatus(value: unknown): value is BookingPaymentStatus {
  return typeof value === 'string' && PAYMENT_STATUSES.has(value as BookingPaymentStatus);
}

function isPaymentType(value: unknown): value is BookingPaymentType {
  return typeof value === 'string' && PAYMENT_TYPES.has(value as BookingPaymentType);
}

function isPaymentState(value: unknown): value is BookingPaymentState {
  return typeof value === 'string' && PAYMENT_STATES.has(value as BookingPaymentState);
}

function failure(code: BookingErrorCode, error: string): BookingActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is BookingActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function deterministicUuid(seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function deterministicBookingReference(matchAttemptId: string): string {
  return `TB-${createHash('sha256').update(`booking:${matchAttemptId.toLowerCase()}`).digest('hex').slice(0, 20).toUpperCase()}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

async function requireContext(role: 'family' | 'companion'): Promise<Context | BookingActionError> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== role) return failure('FORBIDDEN', 'You are not allowed to perform this booking action.');

  try {
    // Trusted booking/payment writes are denied by authenticated RLS. The
    // verified role and owner lookup here, then readOwnedBookingRow or
    // readFamilyOwnedAttempt, gate every mutation and cross-participant DTO.
    const database = createServiceRoleClient();
    if (role === 'family') {
      const { data, error } = await database.from('families').select('id')
        .eq('family_member_clerk_id', user.id).maybeSingle();
      if (error || !data || !validUuid(data.id)) return failure('FORBIDDEN', 'Family ownership could not be verified.');
      return { database, userId: user.id, role, familyId: data.id };
    }
    const { data, error } = await database.from('companions').select('id')
      .eq('user_clerk_id', user.id).maybeSingle();
    if (error || !data || !validUuid(data.id)) return failure('FORBIDDEN', 'Companion ownership could not be verified.');
    return { database, userId: user.id, role, companionId: data.id };
  } catch {
    return failure('PERSISTENCE', 'Unable to load the current user.');
  }
}

async function readBookingRow(database: Database, bookingId: string): Promise<Row | null | BookingActionError> {
  const { data, error } = await database.from('bookings').select(BOOKING_COLUMNS)
    .eq('id', bookingId).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the booking.');
  return (data as Row | null) ?? null;
}

async function readOwnedBookingRow(context: Context, bookingId: string): Promise<Row | null | BookingActionError> {
  const booking = await readBookingRow(context.database, bookingId);
  if (isFailure(booking) || !booking) return booking;
  if (!validUuid(booking.trip_request_id) || !validUuid(booking.companion_id)) {
    return failure('PERSISTENCE', 'Unable to read the booking.');
  }
  if (context.role === 'family') {
    const { data, error } = await context.database.from('trip_requests').select('id')
      .eq('id', booking.trip_request_id).eq('family_id', context.familyId as string).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to verify booking ownership.');
    return data ? booking : null;
  }
  return booking.companion_id === context.companionId ? booking : null;
}

async function readTrip(database: Database, tripRequestId: string): Promise<Row | null | BookingActionError> {
  const { data, error } = await database.from('trip_requests').select(TRIP_COLUMNS)
    .eq('id', tripRequestId).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the trip request.');
  return (data as Row | null) ?? null;
}

async function readCompanion(database: Database, companionId: string): Promise<Row | null | BookingActionError> {
  const { data, error } = await database.from('companions').select(COMPANION_COLUMNS)
    .eq('id', companionId).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the companion.');
  return (data as Row | null) ?? null;
}

function tripDTO(row: Row): BookingTripDTO | null {
  if (!validUuid(row.id) || !isDate(row.departure_date) ||
      (row.return_date !== null && !isDate(row.return_date)) ||
      typeof row.origin_airport !== 'string' || typeof row.destination_airport !== 'string' ||
      !ASSISTANCE_LEVELS.has(String(row.assistance_level)) || !Array.isArray(row.language_requirements) ||
      typeof row.status !== 'string') return null;
  const languages = row.language_requirements.filter((item): item is string => typeof item === 'string');
  return {
    id: row.id,
    origin_airport: row.origin_airport,
    destination_airport: row.destination_airport,
    departure_date: row.departure_date,
    return_date: row.return_date as string | null,
    assistance_level: row.assistance_level as BookingTripDTO['assistance_level'],
    language_requirements: languages,
    status: row.status,
  };
}

function companionDTO(row: Row): BookingCompanionDTO | null {
  const rating = numberValue(row.rating_average);
  const trips = numberValue(row.total_trips);
  if (!validUuid(row.id) || typeof row.first_name !== 'string' || typeof row.last_name !== 'string' ||
      !Array.isArray(row.languages_spoken) || !VERIFICATION_STATUSES.has(String(row.verification_status)) ||
      rating === null || trips === null || trips < 0) return null;
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    languages_spoken: row.languages_spoken.filter((item): item is string => typeof item === 'string'),
    verification_status: row.verification_status as BookingCompanionDTO['verification_status'],
    rating_average: rating,
    total_trips: trips,
  };
}

function paymentDTO(row: Row): BookingPaymentDTO | null {
  const amount = numberValue(row.amount_cents);
  if (!validUuid(row.id) || amount === null || !nonEmptyString(row.currency) ||
      !isPaymentType(row.type) || !isPaymentState(row.status) ||
      !isValidTimestamp(row.created_at)) return null;
  return {
    id: row.id,
    amount_cents: amount,
    currency: row.currency,
    type: row.type as BookingPaymentType,
    status: row.status as BookingPaymentState,
    created_at: row.created_at,
  };
}

async function toBookingDTO(database: Database, row: Row): Promise<BookingDTO | null> {
  const amount = numberValue(row.total_amount);
  if (!validUuid(row.id) || !validUuid(row.trip_request_id) || !validUuid(row.companion_id) ||
      !nonEmptyString(row.booking_reference) || amount === null || !nonEmptyString(row.currency) ||
      !isPaymentStatus(row.payment_status) || !isBookingStatus(row.status) ||
      !isValidTimestamp(row.created_at) || !isValidTimestamp(row.updated_at)) return null;
  const trip = await readTrip(database, row.trip_request_id);
  const companion = await readCompanion(database, row.companion_id);
  if (isFailure(trip) || isFailure(companion) || !trip || !companion) return null;
  const tripSafe = tripDTO(trip);
  const companionSafe = companionDTO(companion);
  if (!tripSafe || !companionSafe) return null;
  const { data: paymentRows, error } = await database.from('payments').select(PAYMENT_COLUMNS)
    .eq('booking_id', row.id).order('created_at', { ascending: true });
  if (error) return null;
  const payments = (paymentRows ?? []).map((payment) => paymentDTO(payment as unknown as Row));
  if (payments.some((payment) => payment === null)) return null;
  return {
    id: row.id,
    trip_request_id: row.trip_request_id,
    companion_id: row.companion_id,
    booking_reference: row.booking_reference,
    total_amount: amount,
    currency: row.currency,
    payment_status: row.payment_status as BookingPaymentStatus,
    status: row.status as BookingStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
    trip_request: tripSafe,
    trip: tripSafe,
    companion: companionSafe,
    payments: payments as BookingPaymentDTO[],
  };
}

async function resultForOwnedRow(context: Context, row: Row): Promise<BookingResult> {
  const dto = await toBookingDTO(context.database, row);
  return dto ? { success: true, booking: dto } : failure('PERSISTENCE', 'Unable to read the booking.');
}

async function readExistingLogicalBooking(database: Database, tripRequestId: string, companionId: string): Promise<Row | null | BookingActionError> {
  const { data, error } = await database.from('bookings').select(BOOKING_COLUMNS)
    .eq('trip_request_id', tripRequestId).eq('companion_id', companionId).limit(1).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to check existing bookings.');
  return (data as Row | null) ?? null;
}

function acceptedStructuredMatch(row: Row): boolean {
  return row.matched === true && isRecord(row.explanation) &&
    readExplanation(row.explanation, false).status === 'accepted';
}

function eligibleForBooking(trip: Row, companion: Row): boolean {
  const request: MatchingTripRequest = {
    departure_date: String(trip.departure_date),
    return_date: trip.return_date === null ? null : String(trip.return_date),
    language_requirements: trip.language_requirements,
  };
  const candidate: MatchingCompanion = {
    verification_status: companion.verification_status,
    languages_spoken: companion.languages_spoken,
    availability_calendar: companion.availability_calendar,
    rating_average: companion.rating_average,
    total_trips: companion.total_trips,
  };
  return isCompanionEligible(request, candidate);
}

async function readFamilyOwnedAttempt(database: Database, familyId: string, matchAttemptId: string): Promise<Row | null | BookingActionError> {
  const { data: attempt, error } = await database.from('match_attempts')
    .select('id, trip_request_id, companion_id, explanation, matched')
    .eq('id', matchAttemptId).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the match attempt.');
  if (!attempt || !validUuid(attempt.trip_request_id) || !validUuid(attempt.companion_id)) return null;
  const { data: trip, error: tripError } = await database.from('trip_requests').select('id, family_id')
    .eq('id', attempt.trip_request_id).eq('family_id', familyId).maybeSingle();
  if (tripError) return failure('PERSISTENCE', 'Unable to verify match ownership.');
  return trip ? attempt as unknown as Row : null;
}

async function readCurrentBookingForFamily(database: Database, familyId: string, attempt: Row): Promise<Row | null | BookingActionError> {
  const existing = await readExistingLogicalBooking(database, attempt.trip_request_id as string, attempt.companion_id as string);
  if (isFailure(existing) || !existing) return existing;
  const { data: owned, error } = await database.from('trip_requests').select('id')
    .eq('id', existing.trip_request_id).eq('family_id', familyId).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to verify booking ownership.');
  return owned ? existing : null;
}

/** Creates the development booking shell for an accepted, currently eligible match. */
export async function createBookingForAcceptedMatch(matchAttemptId: string): Promise<BookingResult> {
  if (!validUuid(matchAttemptId)) return failure('INVALID_INPUT', 'Match attempt ID is invalid.');
  const context = await requireContext('family');
  if (isFailure(context)) return context;
  try {
    const attempt = await readFamilyOwnedAttempt(context.database, context.familyId as string, matchAttemptId);
    if (isFailure(attempt)) return attempt;
    if (!attempt) return failure('NOT_FOUND', 'Match attempt not found.');
    if (!acceptedStructuredMatch(attempt)) return failure('INVALID_STATE', 'Only an accepted match can be booked.');

    // This read makes retries safe even after the request has advanced from matched to booked.
    const existing = await readCurrentBookingForFamily(context.database, context.familyId as string, attempt);
    if (isFailure(existing)) return existing;
    if (existing) return resultForOwnedRow(context, existing);

    const trip = await readTrip(context.database, attempt.trip_request_id as string);
    const companion = await readCompanion(context.database, attempt.companion_id as string);
    if (isFailure(trip) || isFailure(companion)) return failure('PERSISTENCE', 'Unable to verify the booking match.');
    if (!trip || !companion) return failure('NOT_FOUND', 'The booking match could not be found.');
    if (trip.family_id !== context.familyId || trip.status !== 'matched') {
      return failure('INVALID_STATE', 'The trip request is not ready to book.');
    }
    if (!isDate(trip.departure_date) || trip.departure_date < todayUtc() || !eligibleForBooking(trip, companion)) {
      return failure('INVALID_STATE', 'The selected companion is no longer eligible for this trip.');
    }

    const bookingId = deterministicUuid(`booking:${matchAttemptId.toLowerCase()}`);
    const bookingReference = deterministicBookingReference(matchAttemptId);
    const { data: inserted, error } = await context.database.from('bookings').insert({
      id: bookingId,
      trip_request_id: trip.id,
      companion_id: companion.id,
      booking_reference: bookingReference,
      total_amount: 0.00,
      currency: 'USD',
      payment_status: 'pending',
      status: 'confirmed',
    }).select(BOOKING_COLUMNS).single();
    let booking = inserted as unknown as Row | null;
    if (error?.code === '23505') {
      const repeated = await readCurrentBookingForFamily(context.database, context.familyId as string, attempt);
      if (isFailure(repeated)) return repeated;
      if (repeated) return resultForOwnedRow(context, repeated);
      return failure('CONFLICT', 'This booking could not be created.');
    }
    if (error || !booking) return failure('PERSISTENCE', 'Unable to create the booking.');

    const { data: updatedTrip, error: tripUpdateError } = await context.database.from('trip_requests')
      .update({ status: 'booked', updated_at: new Date().toISOString() })
      .eq('id', trip.id).eq('family_id', context.familyId as string).eq('status', 'matched')
      .select('id').maybeSingle();
    if (tripUpdateError || !updatedTrip) {
      await context.database.from('bookings').delete().eq('id', bookingId);
      return failure('CONFLICT', 'The trip request changed before booking completed.');
    }
    return resultForOwnedRow(context, booking);
  } catch {
    return failure('PERSISTENCE', 'Unable to create the booking.');
  }
}

export async function getBooking(bookingId: string): Promise<BookingResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const user = await getCurrentUser().catch(() => null);
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family' && user.role !== 'companion') return failure('FORBIDDEN', 'You are not allowed to view this booking.');
  const context = await requireContext(user.role);
  if (isFailure(context)) return context;
  try {
    const booking = await readOwnedBookingRow(context, bookingId);
    if (isFailure(booking)) return booking;
    return booking ? resultForOwnedRow(context, booking) : failure('NOT_FOUND', 'Booking not found.');
  } catch {
    return failure('PERSISTENCE', 'Unable to load the booking.');
  }
}

async function transitionBooking(
  bookingId: string,
  actor: 'family' | 'companion',
  target: Extract<BookingStatus, 'cancelled_by_family' | 'cancelled_by_companion' | 'completed'>,
): Promise<BookingResult> {
  if (!validUuid(bookingId)) return failure('INVALID_INPUT', 'Booking ID is invalid.');
  const context = await requireContext(actor);
  if (isFailure(context)) return context;
  try {
    const current = await readOwnedBookingRow(context, bookingId);
    if (isFailure(current)) return current;
    if (!current) return failure('NOT_FOUND', 'Booking not found.');
    const currentStatus = current.status as BookingStatus;
    const currentPayment = current.payment_status as BookingPaymentStatus;
    if (currentStatus === target) return resultForOwnedRow(context, current);
    if (currentStatus !== 'confirmed') return failure('INVALID_STATE', 'This booking can no longer change state.');
    if (target === 'cancelled_by_family' && currentPayment !== 'pending' && currentPayment !== 'failed') {
      return failure('INVALID_STATE', 'A family cancellation is only available before successful payment.');
    }
    if ((target === 'cancelled_by_companion' || target === 'completed') && currentPayment !== 'paid') {
      return failure('INVALID_STATE', 'This booking requires successful payment first.');
    }
    const { data: updated, error } = await context.database.from('bookings').update({
      status: target,
      updated_at: new Date().toISOString(),
    }).eq('id', bookingId).eq('status', 'confirmed').eq('payment_status', currentPayment)
      .select(BOOKING_COLUMNS).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to update the booking.');
    if (!updated) {
      const latest = await readOwnedBookingRow(context, bookingId);
      if (isFailure(latest) || !latest) return failure('CONFLICT', 'The booking changed. Reload it and try again.');
      if (latest.status === target) return resultForOwnedRow(context, latest);
      return failure('CONFLICT', 'The booking changed. Reload it and try again.');
    }
    return resultForOwnedRow(context, updated as unknown as Row);
  } catch {
    return failure('PERSISTENCE', 'Unable to update the booking.');
  }
}

export async function cancelBooking(bookingId: string): Promise<BookingResult> {
  const user = await getCurrentUser().catch(() => null);
  if (!user || (user.role !== 'family' && user.role !== 'companion')) {
    return user ? failure('FORBIDDEN', 'You are not allowed to cancel this booking.') : failure('UNAUTHENTICATED', 'Authentication is required.');
  }
  return transitionBooking(bookingId, user.role, user.role === 'family' ? 'cancelled_by_family' : 'cancelled_by_companion');
}

export async function completeBooking(bookingId: string): Promise<BookingResult> {
  return transitionBooking(bookingId, 'companion', 'completed');
}

function developmentPaymentEnabled(): boolean {
  return (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') &&
    process.env.TRAVELBUDDY_DEV_PAYMENT_ENABLED === 'true';
}

/** Explicit test-only payment simulation; it never contacts a payment provider. */
export async function setDevelopmentPaymentState(
  bookingId: string,
  outcome: 'paid' | 'failed',
): Promise<BookingResult> {
  if (!developmentPaymentEnabled()) return failure('FORBIDDEN', 'Development payment simulation is disabled.');
  if (!validUuid(bookingId) || (outcome !== 'paid' && outcome !== 'failed')) {
    return failure('INVALID_INPUT', 'Payment input is invalid.');
  }
  const context = await requireContext('family');
  if (isFailure(context)) return context;
  try {
    const current = await readOwnedBookingRow(context, bookingId);
    if (isFailure(current)) return current;
    if (!current) return failure('NOT_FOUND', 'Booking not found.');
    if (current.status !== 'confirmed') {
      return failure('INVALID_STATE', 'Payment cannot change after booking completion or cancellation.');
    }
    if (current.payment_status === outcome) return resultForOwnedRow(context, current);
    if (current.payment_status === 'paid' && outcome === 'failed') {
      return failure('INVALID_STATE', 'A paid booking cannot be marked failed.');
    }

    const paymentId = deterministicUuid(`dev-payment:${bookingId.toLowerCase()}:${outcome}`);
    const intentId = `dev_test_payment_intent_${bookingId.toLowerCase()}_${outcome}`;
    const { error: paymentError } = await context.database.from('payments').insert({
      id: paymentId,
      booking_id: bookingId,
      stripe_payment_intent_id: intentId,
      amount_cents: 0,
      currency: current.currency,
      type: 'charge',
      status: outcome === 'paid' ? 'succeeded' : 'failed',
    });
    if (paymentError && paymentError.code !== '23505') return failure('PERSISTENCE', 'Unable to record the development payment.');

    const nextStatus: BookingPaymentStatus = outcome;
    const { data: updated, error: updateError } = await context.database.from('bookings').update({
      payment_status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', bookingId).eq('status', 'confirmed').in('payment_status', ['pending', 'failed'])
      .select(BOOKING_COLUMNS).maybeSingle();
    if (updateError) return failure('PERSISTENCE', 'Unable to update the booking payment state.');
    if (!updated) {
      const latest = await readOwnedBookingRow(context, bookingId);
      if (isFailure(latest) || !latest) return failure('CONFLICT', 'The booking changed. Reload it and try again.');
      if (latest.status !== 'confirmed') return failure('INVALID_STATE', 'Payment cannot change after booking completion or cancellation.');
      if (latest.payment_status === outcome) return resultForOwnedRow(context, latest);
      return failure('CONFLICT', 'The booking payment state changed. Reload it and try again.');
    }
    return resultForOwnedRow(context, updated as unknown as Row);
  } catch {
    return failure('PERSISTENCE', 'Unable to update the development payment state.');
  }
}

/** Named wrappers keep the development-only UI controls explicit. */
export async function markBookingPaidForDevelopment(bookingId: string): Promise<BookingResult> {
  return setDevelopmentPaymentState(bookingId, 'paid');
}

export async function markBookingPaymentFailedForDevelopment(bookingId: string): Promise<BookingResult> {
  return setDevelopmentPaymentState(bookingId, 'failed');
}
