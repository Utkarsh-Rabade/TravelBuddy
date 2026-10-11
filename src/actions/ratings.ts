'use server';

import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import type {
  CreateRatingInput,
  RatingActionError,
  RatingDTO,
  RatingEligibilityResult,
  RatingErrorCode,
  RatingListResult,
  RatingResult,
} from '@/lib/rating-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATING_COLUMNS = 'id, trip_id, rater_clerk_id, ratee_clerk_id, score, comment, created_at, updated_at';
const MAX_COMMENT_LENGTH = 1000;

type Row = Record<string, unknown>;
type Database = SupabaseClient;
type Role = 'family' | 'companion';

type Context = {
  database: Database;
  userId: string;
  role: Role;
  familyId?: string;
  companionId?: string;
};

type CompletedTrip = {
  tripId: string;
  bookingId: string;
  tripRequestId: string;
  familyId: string;
  familyOwnerId: string;
  companionId: string;
  companionUserId: string;
};

function failure(code: RatingErrorCode, error: string): RatingActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is RatingActionError {
  return isRecord(value) && value.success === false && typeof value.code === 'string' && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function deterministicRatingId(tripId: string, raterId: string, rateeId: string): string {
  const digest = createHash('sha256')
    .update(`rating:${tripId.toLowerCase()}:${raterId}:${rateeId}`)
    .digest('hex');
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

function ratingDTO(row: Row, viewerId: string): RatingDTO | null {
  if (!validScore(row.score) ||
      (row.comment !== null && typeof row.comment !== 'string') ||
      !validTimestamp(row.created_at) || !validTimestamp(row.updated_at) ||
      typeof row.rater_clerk_id !== 'string') {
    return null;
  }
  return {
    score: row.score,
    comment: row.comment as string | null,
    created_at: row.created_at,
    is_mine: row.rater_clerk_id === viewerId,
  };
}

function extractTripId(input: string | { tripId: string }): unknown {
  return typeof input === 'string' ? input : input?.tripId;
}

function normalizeRatingInput(
  inputOrTripId: CreateRatingInput | string,
  scoreArgument?: number,
  commentArgument?: string | null,
): CreateRatingInput | RatingActionError {
  const input: CreateRatingInput = typeof inputOrTripId === 'string'
    ? { tripId: inputOrTripId, score: scoreArgument as number, comment: commentArgument }
    : inputOrTripId;

  if (!isRecord(input) || !validUuid(input.tripId)) {
    return failure('INVALID_INPUT', 'Trip ID is invalid.');
  }
  if (!validScore(input.score)) {
    return failure('INVALID_INPUT', 'Score must be an integer from 1 to 5.');
  }

  let comment: string | null = null;
  if (input.comment !== undefined && input.comment !== null) {
    if (typeof input.comment !== 'string') {
      return failure('INVALID_INPUT', 'Comment must be text.');
    }
    comment = input.comment.trim();
    if (!comment || comment.length > MAX_COMMENT_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment)) {
      return failure('INVALID_INPUT', 'Comment must be non-empty text of at most 1000 characters.');
    }
  }
  return { tripId: input.tripId, score: input.score, comment };
}

async function requireContext(role?: Role): Promise<Context | RatingActionError> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family' && user.role !== 'companion') {
    return failure('FORBIDDEN', 'You are not allowed to access ratings.');
  }
  if (role && user.role !== role) {
    return failure('FORBIDDEN', 'Only a family owner can submit a rating.');
  }

  try {
    // Rating creation and reputation aggregation are trusted writes. Verified
    // role/profile ownership and the completed-trip participant chain gate
    // every action; aggregation revalidates each historical relationship.
    const database = createServiceRoleClient();
    if (user.role === 'family') {
      const { data, error } = await database.from('families').select('id')
        .eq('family_member_clerk_id', user.id).maybeSingle();
      if (error || !data || !validUuid(data.id)) {
        return failure('FORBIDDEN', 'Family ownership could not be verified.');
      }
      return { database, userId: user.id, role: user.role, familyId: data.id };
    }

    const { data, error } = await database.from('companions').select('id')
      .eq('user_clerk_id', user.id).maybeSingle();
    if (error || !data || !validUuid(data.id)) {
      return failure('FORBIDDEN', 'Companion ownership could not be verified.');
    }
    return { database, userId: user.id, role: user.role, companionId: data.id };
  } catch {
    return failure('PERSISTENCE', 'Unable to load the current user.');
  }
}

/**
 * Resolves the complete completed-trip relationship. The database client is
 * privileged for reputation aggregation, so every relationship edge is checked here.
 */
async function readCompletedTrip(
  database: Database,
  tripId: string,
  forAggregate = false,
): Promise<CompletedTrip | null | RatingActionError> {
  const { data: trip, error: tripError } = await database.from('trips')
    .select('id, booking_id, end_time').eq('id', tripId).maybeSingle();
  if (tripError) return failure('PERSISTENCE', 'Unable to load the trip.');
  if (!trip || !isRecord(trip)) return forAggregate ? null : failure('NOT_FOUND', 'Trip not found.');
  if (!validUuid(trip.id) || trip.id !== tripId || !validUuid(trip.booking_id)) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the trip.');
  }
  if (trip.end_time === null || trip.end_time === undefined) {
    return forAggregate ? null : failure('INVALID_STATE', 'Ratings are available only after the trip ends.');
  }
  if (!validTimestamp(trip.end_time)) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the trip.');
  }

  const { data: booking, error: bookingError } = await database.from('bookings')
    .select('id, trip_request_id, companion_id, status').eq('id', trip.booking_id).maybeSingle();
  if (bookingError) return failure('PERSISTENCE', 'Unable to load the booking.');
  if (!booking || !isRecord(booking)) return forAggregate ? null : failure('NOT_FOUND', 'Trip booking not found.');
  if (!validUuid(booking.id) || !validUuid(booking.trip_request_id) || !validUuid(booking.companion_id)) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the booking.');
  }
  if (booking.status !== 'completed') {
    return forAggregate ? null : failure('INVALID_STATE', 'Ratings are available only for completed trips.');
  }

  const { data: request, error: requestError } = await database.from('trip_requests')
    .select('id, family_id, status').eq('id', booking.trip_request_id).maybeSingle();
  if (requestError) return failure('PERSISTENCE', 'Unable to load the trip request.');
  if (!request || !isRecord(request)) return forAggregate ? null : failure('NOT_FOUND', 'Trip request not found.');
  if (!validUuid(request.id) || request.id !== booking.trip_request_id || !validUuid(request.family_id)) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the trip request.');
  }
  if (request.status !== 'completed') {
    return forAggregate ? null : failure('INVALID_STATE', 'Ratings are available only for completed trips.');
  }

  const { data: family, error: familyError } = await database.from('families')
    .select('id, family_member_clerk_id').eq('id', request.family_id).maybeSingle();
  if (familyError) return failure('PERSISTENCE', 'Unable to load the family.');
  if (!family || !isRecord(family) || !validUuid(family.id) || family.id !== request.family_id ||
      typeof family.family_member_clerk_id !== 'string' || !family.family_member_clerk_id) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the family.');
  }

  const { data: companion, error: companionError } = await database.from('companions')
    .select('id, user_clerk_id').eq('id', booking.companion_id).maybeSingle();
  if (companionError) return failure('PERSISTENCE', 'Unable to load the companion.');
  if (!companion || !isRecord(companion) || !validUuid(companion.id) || companion.id !== booking.companion_id ||
      typeof companion.user_clerk_id !== 'string' || !companion.user_clerk_id) {
    return forAggregate ? null : failure('PERSISTENCE', 'Unable to read the companion.');
  }

  return {
    tripId,
    bookingId: booking.id,
    tripRequestId: request.id,
    familyId: family.id,
    familyOwnerId: family.family_member_clerk_id,
    companionId: companion.id,
    companionUserId: companion.user_clerk_id,
  };
}

function participantAllowed(context: Context, trip: CompletedTrip): boolean {
  return context.role === 'family'
    ? context.familyId === trip.familyId && context.userId === trip.familyOwnerId
    : context.companionId === trip.companionId && context.userId === trip.companionUserId;
}

async function readTripRatings(
  database: Database,
  trip: CompletedTrip,
  viewerId: string,
): Promise<RatingDTO[] | RatingActionError> {
  const { data, error } = await database.from('ratings').select(RATING_COLUMNS).eq('trip_id', trip.tripId);
  if (error) return failure('PERSISTENCE', 'Unable to load ratings.');

  const ratings: RatingDTO[] = [];
  for (const raw of data ?? []) {
    if (!isRecord(raw) || raw.trip_id !== trip.tripId || raw.rater_clerk_id !== trip.familyOwnerId ||
        raw.ratee_clerk_id !== trip.companionUserId || raw.rater_clerk_id === raw.ratee_clerk_id) continue;
    const dto = ratingDTO(raw, viewerId);
    if (dto) ratings.push(dto);
  }
  return ratings;
}

async function recomputeCompanionAverage(
  database: Database,
  companion: CompletedTrip,
): Promise<RatingActionError | null> {
  const { data, error } = await database.from('ratings')
    .select('trip_id, rater_clerk_id, ratee_clerk_id, score')
    .eq('ratee_clerk_id', companion.companionUserId);
  if (error) return failure('PERSISTENCE', 'Unable to load ratings for aggregation.');

  const validScores: number[] = [];
  for (const raw of data ?? []) {
    if (!isRecord(raw) || raw.ratee_clerk_id !== companion.companionUserId ||
        raw.rater_clerk_id === raw.ratee_clerk_id || !validUuid(raw.trip_id) || !validScore(raw.score)) continue;
    const relationship = await readCompletedTrip(database, raw.trip_id, true);
    if (isFailure(relationship)) return relationship;
    if (!relationship || relationship.companionUserId !== companion.companionUserId ||
        relationship.familyOwnerId !== raw.rater_clerk_id) continue;
    validScores.push(raw.score);
  }

  const average = validScores.length === 0
    ? 0
    : Number((validScores.reduce((total, score) => total + score, 0) / validScores.length).toFixed(2));
  const { data: updated, error: updateError } = await database.from('companions')
    .update({ rating_average: average }).eq('id', companion.companionId).select('id').maybeSingle();
  if (updateError || !updated) return failure('PERSISTENCE', 'Unable to update the companion rating average.');
  return null;
}

export async function getRatingEligibility(
  input: string | { tripId: string },
): Promise<RatingEligibilityResult> {
  const tripId = extractTripId(input);
  if (!validUuid(tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  const context = await requireContext();
  if (isFailure(context)) return context;

  try {
    const trip = await readCompletedTrip(context.database, tripId);
    if (isFailure(trip)) return trip;
    if (!trip || !participantAllowed(context, trip)) {
      return failure('FORBIDDEN', 'You are not allowed to view ratings for this trip.');
    }
    const ratings = await readTripRatings(context.database, trip, context.userId);
    if (isFailure(ratings)) return ratings;
    const existing = ratings[0] ?? null;
    const eligible = context.role === 'family';
    return {
      success: true,
      eligibility: {
        eligible,
        can_rate: eligible && existing === null,
        has_rated: existing !== null,
        rating: existing,
      },
    };
  } catch {
    return failure('PERSISTENCE', 'Unable to load rating eligibility.');
  }
}

export async function getRatingsForTrip(
  input: string | { tripId: string },
): Promise<RatingListResult> {
  const tripId = extractTripId(input);
  if (!validUuid(tripId)) return failure('INVALID_INPUT', 'Trip ID is invalid.');
  const context = await requireContext();
  if (isFailure(context)) return context;

  try {
    const trip = await readCompletedTrip(context.database, tripId);
    if (isFailure(trip)) return trip;
    if (!trip || !participantAllowed(context, trip)) {
      return failure('FORBIDDEN', 'You are not allowed to view ratings for this trip.');
    }
    const ratings = await readTripRatings(context.database, trip, context.userId);
    return isFailure(ratings) ? ratings : { success: true, ratings };
  } catch {
    return failure('PERSISTENCE', 'Unable to load ratings.');
  }
}

export async function submitRating(
  inputOrTripId: CreateRatingInput | string,
  scoreArgument?: number,
  commentArgument?: string | null,
): Promise<RatingResult> {
  const normalized = normalizeRatingInput(inputOrTripId, scoreArgument, commentArgument);
  if (isFailure(normalized)) return normalized;
  const context = await requireContext('family');
  if (isFailure(context)) return context;

  try {
    const trip = await readCompletedTrip(context.database, normalized.tripId);
    if (isFailure(trip)) return trip;
    if (!trip || !participantAllowed(context, trip) || context.userId === trip.companionUserId) {
      return failure('FORBIDDEN', 'Only the family owner for this trip can submit its rating.');
    }

    const ratingId = deterministicRatingId(trip.tripId, context.userId, trip.companionUserId);
    const existingQuery = await context.database.from('ratings').select(RATING_COLUMNS)
      .eq('id', ratingId).maybeSingle();
    if (existingQuery.error) return failure('PERSISTENCE', 'Unable to check the existing rating.');

    let row = existingQuery.data as unknown as Row | null;
    let created = false;
    // The deterministic ID handles all new writes and races. This second
    // relationship lookup also makes the action safe when a row predates this
    // server action and therefore has a random schema-generated ID.
    if (!row) {
      const relationshipQuery = await context.database.from('ratings').select(RATING_COLUMNS)
        .eq('trip_id', trip.tripId)
        .eq('rater_clerk_id', context.userId)
        .eq('ratee_clerk_id', trip.companionUserId)
        .limit(1)
        .maybeSingle();
      if (relationshipQuery.error) return failure('PERSISTENCE', 'Unable to check the existing rating.');
      row = relationshipQuery.data as unknown as Row | null;
    }
    if (!row) {
      const now = new Date().toISOString();
      const inserted = await context.database.from('ratings').insert({
        id: ratingId,
        trip_id: trip.tripId,
        rater_clerk_id: context.userId,
        ratee_clerk_id: trip.companionUserId,
        score: normalized.score,
        comment: normalized.comment,
        created_at: now,
        updated_at: now,
      }).select(RATING_COLUMNS).single();
      if (inserted.error?.code === '23505') {
        const repeated = await context.database.from('ratings').select(RATING_COLUMNS)
          .eq('id', ratingId).maybeSingle();
        if (repeated.error || !repeated.data) return failure('CONFLICT', 'The rating changed before it could be saved.');
        row = repeated.data as unknown as Row;
      } else if (inserted.error || !inserted.data) {
        return failure('PERSISTENCE', 'Unable to save the rating.');
      } else {
        row = inserted.data as unknown as Row;
        created = true;
      }
    }

    if (!row || row.trip_id !== trip.tripId || row.rater_clerk_id !== context.userId ||
        row.ratee_clerk_id !== trip.companionUserId) {
      return failure('CONFLICT', 'A different rating already exists for this trip relationship.');
    }
    const rating = ratingDTO(row, context.userId);
    if (!rating) return failure('PERSISTENCE', 'Unable to read the saved rating.');

    // Repeated submissions are safe idempotent retries: the first persisted
    // rating wins and a later payload never edits it.
    const aggregateError = await recomputeCompanionAverage(context.database, trip);
    if (aggregateError) return aggregateError;
    return { success: true, rating, created };
  } catch {
    return failure('PERSISTENCE', 'Unable to save the rating.');
  }
}

/** Alias for callers that use create terminology for server mutations. */
export async function createRating(input: CreateRatingInput): Promise<RatingResult> {
  return submitRating(input);
}
