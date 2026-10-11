import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

import {
  calculateScoreComponents,
  isCompanionEligible,
  normalizeAvailabilityCalendar,
  type MatchingCompanion,
  type MatchingTripRequest,
} from './score-calculator';
import {
  createExplanationEnvelope,
  explanationGenerator,
  readExplanation,
} from './explanation-generator';
import type {
  MatchExplanationComponents,
  MatchStatus,
  MatchingCompanionDTO,
} from './types';

export const COMPANION_MATCH_COLUMNS = [
  'id', 'first_name', 'last_name',
  'languages_spoken', 'availability_calendar', 'verification_status',
  'rating_average', 'total_trips',
].join(', ');

export const MATCH_ATTEMPT_COLUMNS = [
  'id', 'trip_request_id', 'companion_id', 'score', 'explanation', 'matched', 'created_at',
].join(', ');

export type MatchingCompanionRow = Omit<MatchingCompanion, 'verification_status' | 'languages_spoken' | 'availability_calendar' | 'rating_average' | 'total_trips'> & {
  id: string;
  user_clerk_id?: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  languages_spoken: string[];
  availability_calendar: Record<string, Array<{ start: string; end: string }>>;
  verification_status: string;
  rating_average: number;
  total_trips: number;
};

export interface MatchingResult {
  companion: MatchingCompanionRow;
  score: number;
  explanation: string;
  explanationComponents: MatchExplanationComponents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function normalizeLanguages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)
    : [];
}

const VERIFICATION_STATUSES = new Set(['pending', 'verified', 'expired', 'rejected']);

function asMatchingCompanion(value: unknown): MatchingCompanionRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.first_name !== 'string' ||
      typeof value.last_name !== 'string' || typeof value.verification_status !== 'string' ||
      !VERIFICATION_STATUSES.has(value.verification_status)) return null;
  const availability = normalizeAvailabilityCalendar(value.availability_calendar);
  if (!availability) return null;
  const rating = numeric(value.rating_average);
  const totalTrips = numeric(value.total_trips);
  if (!Number.isFinite(rating) || !Number.isFinite(totalTrips) || totalTrips < 0) return null;
  return {
    id: value.id,
    first_name: value.first_name.trim(),
    last_name: value.last_name.trim(),
    languages_spoken: normalizeLanguages(value.languages_spoken),
    availability_calendar: availability,
    verification_status: value.verification_status,
    rating_average: rating,
    total_trips: totalTrips,
  };
}

/** Safe fields intended for clients; ownership identifiers are deliberately omitted. */
export function toMatchingCompanionDTO(value: unknown): MatchingCompanionDTO | null {
  const companion = asMatchingCompanion(value);
  if (!companion) return null;
  return {
    id: companion.id,
    first_name: companion.first_name,
    last_name: companion.last_name,
    // Retain the legacy DTO slot as null; candidate DOB is never read/disclosed.
    date_of_birth: null,
    languages_spoken: companion.languages_spoken,
    availability_calendar: companion.availability_calendar,
    verification_status: companion.verification_status as MatchingCompanionDTO['verification_status'],
    rating_average: companion.rating_average,
    total_trips: companion.total_trips,
  };
}

function stableName(companion: MatchingCompanionRow): string {
  return `${companion.first_name} ${companion.last_name}`.trim().toLocaleLowerCase('en-US');
}

export function sortMatchingResults(left: MatchingResult, right: MatchingResult): number {
  return right.score - left.score || stableName(left.companion).localeCompare(stableName(right.companion), 'en-US') ||
    left.companion.id.localeCompare(right.companion.id, 'en-US');
}

/**
 * Trusted server-only matching helpers require an explicitly supplied client.
 * The action caller must verify native role and request/attempt ownership first;
 * candidate reads select scoring/display fields rather than private profiles.
 */
export async function findMatchingCompanions(
  tripRequestId: string,
  database: SupabaseClient,
): Promise<MatchingResult[]> {
  const { data: tripRequest, error: tripError } = await database.from('trip_requests')
    .select('id, departure_date, return_date, language_requirements')
    .eq('id', tripRequestId)
    .maybeSingle();
  if (tripError || !tripRequest) throw new Error('Unable to load matching request.');

  const request = tripRequest as MatchingTripRequest;
  const { data: companionRows, error: companionError } = await database.from('companions')
    .select(COMPANION_MATCH_COLUMNS)
    .eq('verification_status', 'verified');
  if (companionError) throw new Error('Unable to load matching companions.');

  const results: MatchingResult[] = [];
  for (const row of companionRows ?? []) {
    const companion = asMatchingCompanion(row);
    if (!companion || !isCompanionEligible(request, companion)) continue;
    const components = calculateScoreComponents(request, companion);
    const explanation = explanationGenerator.generateExplanation(request, companion, components.totalScore);
    results.push({ companion, score: components.totalScore, explanation, explanationComponents: componentsForEnvelope(request, companion, components.totalScore) });
  }
  return results.sort(sortMatchingResults);
}

function componentsForEnvelope(
  request: MatchingTripRequest,
  companion: MatchingCompanionRow,
  score: number,
): MatchExplanationComponents {
  return explanationGenerator.generateExplanationComponents(request, companion, score).components;
}

function attemptStatus(value: unknown, matched: boolean): MatchStatus {
  return readExplanation(value, matched).status;
}

async function readExistingAttempt(
  database: SupabaseClient,
  tripRequestId: string,
  companionId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await database.from('match_attempts')
    .select(MATCH_ATTEMPT_COLUMNS)
    .eq('trip_request_id', tripRequestId)
    .eq('companion_id', companionId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error('Unable to read match attempts.');
  return (data?.[0] as unknown as Record<string, unknown> | undefined) ?? null;
}

function deterministicAttemptId(tripRequestId: string, companionId: string): string {
  const digest = createHash('sha256').update(`${tripRequestId.toLowerCase()}:${companionId.toLowerCase()}`).digest('hex');
  // UUIDv5-shaped deterministic identifier; the database only requires a UUID.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${digest.slice(18, 20)}-${digest.slice(20, 32)}`;
}

export async function saveMatchAttempt(
  tripRequestId: string,
  companionId: string,
  score: number,
  explanation: string,
  status: MatchStatus = 'pending',
  explanationComponents: MatchExplanationComponents | undefined,
  database: SupabaseClient,
): Promise<Record<string, unknown>> {
  const existing = await readExistingAttempt(database, tripRequestId, companionId);
  if (existing) return existing;

  const envelope = createExplanationEnvelope(explanation, status, explanationComponents);
  const { data, error } = await database.from('match_attempts').insert({
    id: deterministicAttemptId(tripRequestId, companionId),
    trip_request_id: tripRequestId,
    companion_id: companionId,
    score,
    explanation: envelope,
    matched: status === 'accepted',
  }).select(MATCH_ATTEMPT_COLUMNS).single();
  if (!error && data) return data as unknown as Record<string, unknown>;

  // A deployment may add a uniqueness constraint for the trip/candidate pair.
  // Re-read after a collision so concurrent retries return the committed ID.
  if (error?.code === '23505') {
    const repeated = await readExistingAttempt(database, tripRequestId, companionId);
    if (repeated) return repeated;
  }
  throw new Error('Unable to save match attempt.');
}

export async function getMatchAttemptsByTripRequest(
  tripRequestId: string,
  database: SupabaseClient,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await database.from('match_attempts')
    .select(MATCH_ATTEMPT_COLUMNS)
    .eq('trip_request_id', tripRequestId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Unable to read match attempts.');
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

export async function updateMatchStatus(
  matchAttemptId: string,
  status: Extract<MatchStatus, 'accepted' | 'rejected'>,
  database: SupabaseClient,
): Promise<Record<string, unknown>> {
  const current = await database.from('match_attempts').select('explanation, matched')
    .eq('id', matchAttemptId).maybeSingle();
  if (current.error || !current.data) throw new Error('Match attempt not found.');
  const oldExplanation = readExplanation(current.data.explanation, current.data.matched === true);
  const envelope = createExplanationEnvelope(oldExplanation.text, status, oldExplanation.components);
  const { data, error } = await database.from('match_attempts')
    .update({ matched: status === 'accepted', explanation: envelope })
    .eq('id', matchAttemptId)
    .select(MATCH_ATTEMPT_COLUMNS)
    .single();
  if (error || !data) throw new Error('Unable to update match attempt.');
  return data as unknown as Record<string, unknown>;
}

export { attemptStatus };
