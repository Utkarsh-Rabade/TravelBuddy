'use server';

import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import {
  COMPANION_MATCH_COLUMNS,
  MATCH_ATTEMPT_COLUMNS,
  findMatchingCompanions,
  saveMatchAttempt,
  toMatchingCompanionDTO,
  updateMatchStatus,
} from '@/lib/matching/basic-matching-algorithm';
import { readExplanation } from '@/lib/matching/explanation-generator';
import type {
  MatchAttemptDTO,
  MatchResultDTO,
  MatchingCompanionDTO,
} from '@/lib/matching/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
type ActionFailure = { success: false; error: string };
type ActionResult<T> = { success: true } & T | ActionFailure;
type FamilyContext = { database: ReturnType<typeof createServiceRoleClient>; familyId: string };

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is ActionFailure {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

async function requireFamily(): Promise<FamilyContext | ActionFailure> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return { success: false, error: 'Authentication is required.' };
  }
  if (!user) return { success: false, error: 'Authentication is required.' };
  if (user.role !== 'family') return { success: false, error: 'Only a family user can access match data.' };

  try {
    // Matching persistence/status transitions and private candidate reads are
    // trusted workflows. Verified family role + owner lookup + readOwnedTrip
    // gate actions; companion results always pass through the safe DTO mapper.
    const database = createServiceRoleClient();
    const { data, error } = await database.from('families').select('id')
      .eq('family_member_clerk_id', user.id).maybeSingle();
    if (error || !data || typeof data.id !== 'string') {
      return { success: false, error: 'Unable to load the current family.' };
    }
    return { database, familyId: data.id };
  } catch {
    return { success: false, error: 'Unable to load the current family.' };
  }
}

async function readOwnedTrip(context: FamilyContext, tripRequestId: string): Promise<Row | null | ActionFailure> {
  const { data, error } = await context.database.from('trip_requests')
    .select('id, family_id, departure_date, return_date, language_requirements, status')
    .eq('id', tripRequestId)
    .eq('family_id', context.familyId)
    .maybeSingle();
  if (error) return { success: false, error: 'Unable to load the trip request.' };
  return (data as Row | null) ?? null;
}

async function readCompanion(
  database: FamilyContext['database'],
  companionId: string,
): Promise<MatchingCompanionDTO | null> {
  const { data, error } = await database.from('companions').select(COMPANION_MATCH_COLUMNS)
    .eq('id', companionId).maybeSingle();
  if (error || !data) return null;
  return toMatchingCompanionDTO(data);
}

function attemptDTO(row: unknown, companion: MatchingCompanionDTO): MatchAttemptDTO | null {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.trip_request_id !== 'string' ||
      typeof row.companion_id !== 'string' || typeof row.created_at !== 'string') return null;
  const score = numberValue(row.score);
  if (score === null) return null;
  const explanation = readExplanation(row.explanation, row.matched === true);
  return {
    id: row.id,
    trip_request_id: row.trip_request_id,
    companion_id: row.companion_id,
    score,
    explanation: explanation.text,
    ...(explanation.components ? { explanation_components: explanation.components } : {}),
    status: explanation.status,
    matched: row.matched === true,
    created_at: row.created_at,
    companion,
    match_score: score,
    match_attempted_at: row.created_at,
    companions: companion,
  };
}

async function readAttemptRows(
  database: FamilyContext['database'],
  tripRequestId: string,
): Promise<Row[] | ActionFailure> {
  const { data, error } = await database.from('match_attempts').select(MATCH_ATTEMPT_COLUMNS)
    .eq('trip_request_id', tripRequestId).order('created_at', { ascending: false });
  if (error) return { success: false, error: 'Unable to load match attempts.' };
  return (data ?? []) as unknown as Row[];
}

async function formatAttemptRows(
  database: FamilyContext['database'],
  rows: Row[],
): Promise<MatchAttemptDTO[] | null> {
  const companionIds = [...new Set(rows.map((row) => row.companion_id).filter(validUuid))];
  if (rows.some((row) => !validUuid(row.companion_id))) return null;
  if (companionIds.length === 0) return [];
  const { data, error } = await database.from('companions').select(COMPANION_MATCH_COLUMNS).in('id', companionIds);
  if (error) return null;
  const companions = new Map<string, MatchingCompanionDTO>();
  for (const row of data ?? []) {
    if (!isRecord(row) || typeof row.id !== 'string') continue;
    const companion = toMatchingCompanionDTO(row);
    if (companion) companions.set(row.id, companion);
  }
  const attempts: MatchAttemptDTO[] = [];
  for (const row of rows) {
    const companion = companions.get(row.companion_id as string);
    const attempt = companion ? attemptDTO(row, companion) : null;
    if (!attempt) return null;
    attempt.rank = attempts.length + 1;
    attempts.push(attempt);
  }
  return attempts;
}

/** Find and persist deterministic trip/candidate attempts for the current family. */
export async function findMatchingCompanionsAction(
  tripRequestId: string,
  matchingSubmissionId?: string,
): Promise<ActionResult<{ matches: MatchResultDTO[] }>> {
  if (!validUuid(tripRequestId) || (matchingSubmissionId !== undefined && !validUuid(matchingSubmissionId))) {
    return { success: false, error: 'Match request ID is invalid.' };
  }
  const context = await requireFamily();
  if (isFailure(context)) return context;
  const request = await readOwnedTrip(context, tripRequestId);
  if (isFailure(request)) return request;
  if (!request) return { success: false, error: 'Trip request not found.' };

  try {
    const matches = await findMatchingCompanions(tripRequestId, context.database);
    const results: MatchResultDTO[] = [];
    for (const match of matches) {
      const attempt = await saveMatchAttempt(
        tripRequestId,
        match.companion.id,
        match.score,
        match.explanation,
        'pending',
        match.explanationComponents,
        context.database,
      );
      const companion = toMatchingCompanionDTO(match.companion);
      if (!companion || typeof attempt.id !== 'string') continue;
      const envelope = readExplanation(attempt.explanation, attempt.matched === true);
      results.push({
        rank: results.length + 1,
        companion,
        score: numberValue(attempt.score) ?? match.score,
        explanation: envelope.text,
        ...(envelope.components ? { explanation_components: envelope.components } : {}),
        matchAttemptId: attempt.id,
        status: envelope.status,
      });
    }
    return { success: true, matches: results };
  } catch {
    return { success: false, error: 'Failed to find matching companions.' };
  }
}

export async function getMatchAttemptsAction(
  tripRequestId: string,
): Promise<ActionResult<{ matchAttempts: MatchAttemptDTO[] }>> {
  if (!validUuid(tripRequestId)) return { success: false, error: 'Trip request ID is invalid.' };
  const context = await requireFamily();
  if (isFailure(context)) return context;
  const request = await readOwnedTrip(context, tripRequestId);
  if (isFailure(request)) return request;
  if (!request) return { success: false, error: 'Trip request not found.' };
  const rows = await readAttemptRows(context.database, tripRequestId);
  if (isFailure(rows)) return rows;
  try {
    const attempts = await formatAttemptRows(context.database, rows);
    return attempts ? { success: true, matchAttempts: attempts } : { success: false, error: 'Unable to load match attempts.' };
  } catch {
    return { success: false, error: 'Unable to load match attempts.' };
  }
}

export async function updateMatchStatusAction(
  matchAttemptId: string,
  status: 'accepted' | 'rejected',
): Promise<ActionResult<{ matchAttempt: MatchAttemptDTO }>> {
  if (!validUuid(matchAttemptId) || (status !== 'accepted' && status !== 'rejected')) {
    return { success: false, error: 'Match attempt or status is invalid.' };
  }
  const context = await requireFamily();
  if (isFailure(context)) return context;

  try {
    const { data: current, error: currentError } = await context.database.from('match_attempts')
      .select(MATCH_ATTEMPT_COLUMNS).eq('id', matchAttemptId).maybeSingle();
    if (currentError || !current) return { success: false, error: 'Match attempt not found.' };
    const currentRow = current as unknown as Row;
    if (!validUuid(currentRow.trip_request_id) || !validUuid(currentRow.companion_id)) {
      return { success: false, error: 'Match attempt not found.' };
    }
    const request = await readOwnedTrip(context, currentRow.trip_request_id);
    if (isFailure(request)) return request;
    if (!request) return { success: false, error: 'Match attempt not found.' };
    const companion = await readCompanion(context.database, currentRow.companion_id);
    if (!companion) return { success: false, error: 'Match attempt not found.' };

    const currentStatus = readExplanation(currentRow.explanation, currentRow.matched === true).status;
    if (currentStatus !== 'pending' && currentStatus !== status) {
      return { success: false, error: 'This match attempt has already been decided.' };
    }

    const updated = await updateMatchStatus(matchAttemptId, status, context.database);
    if (status === 'accepted') {
      const { error } = await context.database.from('trip_requests')
        .update({ status: 'matched', updated_at: new Date().toISOString() })
        .eq('id', currentRow.trip_request_id).eq('family_id', context.familyId);
      if (error) return { success: false, error: 'Unable to update the trip request.' };
    }
    const result = attemptDTO(updated, companion);
    return result ? { success: true, matchAttempt: result } : { success: false, error: 'Unable to read the updated match attempt.' };
  } catch {
    return { success: false, error: 'Failed to update match attempt.' };
  }
}

/** Companion-scoped read: the owner predicate prevents cross-companion disclosure. */
export async function getCompanionMatchAttemptsAction(): Promise<ActionResult<{ matchAttempts: MatchAttemptDTO[] }>> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return { success: false, error: 'Authentication is required.' };
  }
  if (!user) return { success: false, error: 'Authentication is required.' };
  if (user.role !== 'companion') return { success: false, error: 'Only a companion can access companion match data.' };
  try {
    // Trusted matching projection: verified companion role and owner-scoped
    // profile/attempt predicates precede the sanitized matching DTO return.
    const database = createServiceRoleClient();
    const { data: profile, error: profileError } = await database.from('companions')
      .select('id').eq('user_clerk_id', user.id).maybeSingle();
    if (profileError || !profile || !validUuid(profile.id)) return { success: false, error: 'Companion profile not found.' };
    const { data, error } = await database.from('match_attempts').select(MATCH_ATTEMPT_COLUMNS)
      .eq('companion_id', profile.id).order('created_at', { ascending: false });
    if (error) return { success: false, error: 'Unable to load match attempts.' };
    const rows = (data ?? []) as unknown as Row[];
    const attempts = await formatAttemptRows(database as FamilyContext['database'], rows);
    return attempts ? { success: true, matchAttempts: attempts } : { success: false, error: 'Unable to load match attempts.' };
  } catch {
    return { success: false, error: 'Unable to load match attempts.' };
  }
}

/** Compatibility name for consumers that use the explicit ownership wording. */
export const getOwnMatchAttemptsAction = getCompanionMatchAttemptsAction;
export const getCurrentCompanionMatchAttemptsAction = getCompanionMatchAttemptsAction;
