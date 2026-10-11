'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import type {
  TripRequestActionError,
  TripRequestDTO,
  TripRequestErrorCode,
  TripRequestInput,
  TripRequestListResult,
  TripRequestResult,
  TripRequestStatus,
  TripTravelerOption,
  TripTravelerOptionsResult,
} from '@/lib/trip-request-types';

const REQUEST_COLUMNS = [
  'id', 'family_id', 'elderly_traveler_id', 'origin_airport',
  'destination_airport', 'departure_date', 'return_date', 'assistance_level',
  'language_requirements', 'special_instructions', 'status', 'created_at', 'updated_at',
].join(', ');
const TRAVELER_COLUMNS = 'id, first_name, last_name';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_FIELDS = new Set([
  'elderly_traveler_id', 'origin_airport', 'destination_airport',
  'departure_date', 'return_date', 'assistance_level', 'language_requirements',
  'special_instructions', 'status',
]);
const STATUSES = new Set<TripRequestStatus>([
  'draft', 'searching', 'matched', 'booked', 'in_progress', 'completed', 'cancelled', 'expired',
]);
const MAX_LANGUAGES = 16;
const MAX_LANGUAGE_LENGTH = 80;
const MAX_INSTRUCTIONS_LENGTH = 2000;

type FamilyContext = { database: SupabaseClient; familyId: string };
type RequestRow = Record<string, unknown>;
type NormalizedInput = Omit<TripRequestInput, 'special_instructions'> & { special_instructions: string | null };

function failure(code: TripRequestErrorCode, error: string): TripRequestActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isError(value: unknown): value is TripRequestActionError {
  return isRecord(value) && value.success === false;
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function normalizeInput(input: unknown): NormalizedInput | TripRequestActionError {
  if (!isRecord(input) || Object.keys(input).some((key) => !INPUT_FIELDS.has(key))) {
    return failure('INVALID_INPUT', 'Trip input contains unsupported fields.');
  }
  if (!validUuid(input.elderly_traveler_id)) return failure('INVALID_INPUT', 'Traveler ID is invalid.');
  if (typeof input.origin_airport !== 'string' || typeof input.destination_airport !== 'string') {
    return failure('INVALID_INPUT', 'Airport codes must contain three letters.');
  }
  const originText = input.origin_airport.trim();
  const destinationText = input.destination_airport.trim();
  const origin = originText.toUpperCase();
  const destination = destinationText.toUpperCase();
  if (!/^[A-Za-z]{3}$/.test(originText) || !/^[A-Za-z]{3}$/.test(destinationText) || origin === destination) {
    return failure('INVALID_INPUT', 'Use different three-letter origin and destination airport codes.');
  }
  if (!validDate(input.departure_date)) return failure('INVALID_INPUT', 'Departure date must be a valid YYYY-MM-DD date.');
  if (input.return_date !== null && !validDate(input.return_date)) {
    return failure('INVALID_INPUT', 'Return date must be a valid YYYY-MM-DD date or null.');
  }
  if (typeof input.return_date === 'string' && input.return_date < input.departure_date) {
    return failure('INVALID_INPUT', 'Return date cannot be before departure.');
  }
  if (!['minimal', 'moderate', 'maximum'].includes(input.assistance_level as string)) {
    return failure('INVALID_INPUT', 'Choose a valid assistance level.');
  }
  if (!Array.isArray(input.language_requirements) || input.language_requirements.length > MAX_LANGUAGES) {
    return failure('INVALID_INPUT', `Languages must be a list of at most ${MAX_LANGUAGES} values.`);
  }
  const languages: string[] = [];
  for (const value of input.language_requirements) {
    if (typeof value !== 'string' || value.length > MAX_LANGUAGE_LENGTH) {
      return failure('INVALID_INPUT', `Each language must be text of at most ${MAX_LANGUAGE_LENGTH} characters.`);
    }
    const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized && !languages.includes(normalized)) languages.push(normalized);
  }
  const instructions = input.special_instructions;
  if (instructions !== undefined && instructions !== null &&
      (typeof instructions !== 'string' || instructions.length > MAX_INSTRUCTIONS_LENGTH)) {
    return failure('INVALID_INPUT', `Special instructions must be at most ${MAX_INSTRUCTIONS_LENGTH} characters.`);
  }
  if (input.status !== undefined && input.status !== 'draft' && input.status !== 'searching') {
    return failure('INVALID_INPUT', 'Only draft and searching statuses can be supplied.');
  }
  return {
    elderly_traveler_id: input.elderly_traveler_id.toLowerCase(),
    origin_airport: origin,
    destination_airport: destination,
    departure_date: input.departure_date,
    return_date: input.return_date as string | null,
    assistance_level: input.assistance_level as NormalizedInput['assistance_level'],
    language_requirements: languages.sort(),
    special_instructions: typeof instructions === 'string' ? instructions.trim() || null : null,
    ...(input.status === undefined ? {} : { status: input.status }),
  };
}

async function requireCurrentFamily(): Promise<FamilyContext | TripRequestActionError> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family') return failure('FORBIDDEN', 'Only a family user can access trip requests.');
  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data, error } = await database.from('families').select('id')
      .eq('family_member_clerk_id', user.id).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to load the current family.');
    if (!data) return failure('NOT_FOUND', 'Create a family profile before managing trip requests.');
    if (!validUuid(data.id)) return failure('PERSISTENCE', 'Unable to read the current family.');
    return { database, familyId: data.id };
  } catch {
    return failure('PERSISTENCE', 'Unable to load the current family.');
  }
}

function travelerOption(value: unknown): TripTravelerOption | null {
  if (!isRecord(value) || !validUuid(value.id) || typeof value.first_name !== 'string' ||
      typeof value.last_name !== 'string') return null;
  return { id: value.id, first_name: value.first_name, last_name: value.last_name };
}

async function readOwnedTraveler(context: FamilyContext, id: string): Promise<TripTravelerOption | TripRequestActionError> {
  const { data, error } = await context.database.from('elderly_travelers')
    .select(TRAVELER_COLUMNS).eq('family_id', context.familyId).eq('id', id).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to verify the traveler.');
  if (!data) return failure('FORBIDDEN', 'Select a traveler belonging to the current family.');
  return travelerOption(data) ?? failure('PERSISTENCE', 'Unable to read the traveler.');
}

async function readOwnedRequest(context: FamilyContext, id: string): Promise<RequestRow | null | TripRequestActionError> {
  const { data, error } = await context.database.from('trip_requests').select(REQUEST_COLUMNS)
    .eq('family_id', context.familyId).eq('id', id).maybeSingle();
  if (error) return failure('PERSISTENCE', 'Unable to load the trip request.');
  return data as RequestRow | null;
}

function toDTO(row: RequestRow, traveler: TripTravelerOption, familyId: string): TripRequestDTO | TripRequestActionError {
  if (row.family_id !== familyId || row.elderly_traveler_id !== traveler.id) {
    return failure('FORBIDDEN', 'Trip traveler ownership could not be verified.');
  }
  if (!validUuid(row.id) || typeof row.created_at !== 'string' ||
      typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)) ||
      typeof row.status !== 'string' || !STATUSES.has(row.status as TripRequestStatus)) {
    return failure('PERSISTENCE', 'Unable to read the trip request.');
  }
  const fields = normalizeInput({
    elderly_traveler_id: row.elderly_traveler_id,
    origin_airport: row.origin_airport,
    destination_airport: row.destination_airport,
    departure_date: row.departure_date,
    return_date: row.return_date,
    assistance_level: row.assistance_level,
    language_requirements: row.language_requirements ?? [],
    special_instructions: row.special_instructions,
  });
  if (isError(fields)) return failure('PERSISTENCE', 'Unable to read the trip request.');
  return {
    ...fields,
    id: row.id,
    status: row.status as TripRequestStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
    elderly_travelers: traveler,
  };
}

async function requestResult(context: FamilyContext, row: RequestRow): Promise<TripRequestResult> {
  if (!validUuid(row.elderly_traveler_id)) return failure('PERSISTENCE', 'Unable to read the trip traveler.');
  const traveler = await readOwnedTraveler(context, row.elderly_traveler_id);
  if (isError(traveler)) return traveler;
  const request = toDTO(row, traveler, context.familyId);
  return isError(request) ? request : { success: true, request };
}

function mutationFields(input: NormalizedInput) {
  return {
    elderly_traveler_id: input.elderly_traveler_id,
    origin_airport: input.origin_airport,
    destination_airport: input.destination_airport,
    departure_date: input.departure_date,
    return_date: input.return_date,
    assistance_level: input.assistance_level,
    language_requirements: input.language_requirements,
    special_instructions: input.special_instructions,
  };
}

async function repeatedSubmission(context: FamilyContext, row: RequestRow, input: NormalizedInput): Promise<TripRequestResult> {
  const result = await requestResult(context, row);
  if (!result.success) return result;
  const saved = result.request;
  const same = saved.elderly_traveler_id === input.elderly_traveler_id &&
    saved.origin_airport === input.origin_airport && saved.destination_airport === input.destination_airport &&
    saved.departure_date === input.departure_date && saved.return_date === input.return_date &&
    saved.assistance_level === input.assistance_level && saved.special_instructions === input.special_instructions &&
    JSON.stringify(saved.language_requirements) === JSON.stringify(input.language_requirements);
  return same ? result : failure('CONFLICT', 'This submission ID has already been used for a different trip.');
}

export async function getTripRequestTravelers(): Promise<TripTravelerOptionsResult> {
  const context = await requireCurrentFamily();
  if (isError(context)) return context;
  try {
    const { data, error } = await context.database.from('elderly_travelers').select(TRAVELER_COLUMNS)
      .eq('family_id', context.familyId).order('created_at', { ascending: false });
    if (error) return failure('PERSISTENCE', 'Unable to load traveler options.');
    const travelers = (data ?? []).map(travelerOption);
    if (travelers.some((traveler) => traveler === null)) return failure('PERSISTENCE', 'Unable to read traveler options.');
    return { success: true, travelers: travelers as TripTravelerOption[] };
  } catch {
    return failure('PERSISTENCE', 'Unable to load traveler options.');
  }
}

export async function createTripRequest(input: TripRequestInput, submissionId: string): Promise<TripRequestResult> {
  const context = await requireCurrentFamily();
  if (isError(context)) return context;
  if (!validUuid(submissionId)) return failure('INVALID_INPUT', 'Submission ID is invalid.');
  const validated = normalizeInput(input);
  if (isError(validated)) return validated;
  if (validated.status !== undefined && validated.status !== 'draft') {
    return failure('INVALID_STATE', 'New trip requests must be drafts.');
  }
  try {
    const id = submissionId.toLowerCase();
    const existing = await readOwnedRequest(context, id);
    if (isError(existing)) return existing;
    // A committed submission remains retryable even if its departure date has since passed.
    if (existing) return await repeatedSubmission(context, existing, validated);
    if (validated.departure_date < todayInIndia()) return failure('INVALID_INPUT', 'Departure date cannot be in the past (Asia/Kolkata).');
    const traveler = await readOwnedTraveler(context, validated.elderly_traveler_id);
    if (isError(traveler)) return traveler;
    const { data, error } = await context.database.from('trip_requests').insert({
      id, family_id: context.familyId, ...mutationFields(validated), status: 'draft',
    }).select(REQUEST_COLUMNS).single();
    if (error?.code === '23505') {
      const repeated = await readOwnedRequest(context, id);
      if (isError(repeated)) return repeated;
      // A collision outside this family never discloses that family's record.
      return repeated ? await repeatedSubmission(context, repeated, validated)
        : failure('CONFLICT', 'This submission ID is unavailable. Start a new submission.');
    }
    if (error || !data) return failure('PERSISTENCE', 'Unable to create the trip request.');
    return await requestResult(context, data as unknown as RequestRow);
  } catch {
    return failure('PERSISTENCE', 'Unable to create the trip request.');
  }
}

export async function getCurrentFamilyTripRequests(): Promise<TripRequestListResult> {
  const context = await requireCurrentFamily();
  if (isError(context)) return context;
  try {
    const { data, error } = await context.database.from('trip_requests').select(REQUEST_COLUMNS)
      .eq('family_id', context.familyId).order('created_at', { ascending: false });
    if (error) return failure('PERSISTENCE', 'Unable to load trip requests.');
    const rows = (data ?? []) as unknown as RequestRow[];
    if (rows.length === 0) return { success: true, requests: [] };
    const travelerIds = rows.map((row) => row.elderly_traveler_id);
    if (!travelerIds.every(validUuid)) return failure('PERSISTENCE', 'Unable to read trip travelers.');
    const { data: travelerRows, error: travelerError } = await context.database.from('elderly_travelers')
      .select(TRAVELER_COLUMNS).eq('family_id', context.familyId).in('id', [...new Set(travelerIds)]);
    if (travelerError) return failure('PERSISTENCE', 'Unable to load trip travelers.');
    const travelers = new Map<string, TripTravelerOption>();
    for (const row of travelerRows ?? []) {
      const traveler = travelerOption(row);
      if (!traveler) return failure('PERSISTENCE', 'Unable to read trip travelers.');
      travelers.set(traveler.id, traveler);
    }
    const requests: TripRequestDTO[] = [];
    for (const row of rows) {
      const traveler = travelers.get(row.elderly_traveler_id as string);
      if (!traveler) return failure('FORBIDDEN', 'Trip traveler ownership could not be verified.');
      const request = toDTO(row, traveler, context.familyId);
      if (isError(request)) return request;
      requests.push(request);
    }
    return { success: true, requests };
  } catch {
    return failure('PERSISTENCE', 'Unable to load trip requests.');
  }
}

export async function getCurrentFamilyTripRequest(id: string): Promise<TripRequestResult> {
  const context = await requireCurrentFamily();
  if (isError(context)) return context;
  if (!validUuid(id)) return failure('INVALID_INPUT', 'Trip request ID is invalid.');
  try {
    const row = await readOwnedRequest(context, id.toLowerCase());
    if (isError(row)) return row;
    return row ? await requestResult(context, row) : failure('NOT_FOUND', 'Trip request not found.');
  } catch {
    return failure('PERSISTENCE', 'Unable to load the trip request.');
  }
}

export async function updateTripRequest(id: string, input: TripRequestInput): Promise<TripRequestResult> {
  const context = await requireCurrentFamily();
  if (isError(context)) return context;
  if (!validUuid(id)) return failure('INVALID_INPUT', 'Trip request ID is invalid.');
  const validated = normalizeInput(input);
  if (isError(validated)) return validated;
  if (validated.departure_date < todayInIndia()) return failure('INVALID_INPUT', 'Departure date cannot be in the past (Asia/Kolkata).');
  try {
    const row = await readOwnedRequest(context, id.toLowerCase());
    if (isError(row)) return row;
    if (!row) return failure('NOT_FOUND', 'Trip request not found.');
    const owned = await requestResult(context, row);
    if (!owned.success) return owned;
    const current = owned.request;
    if (current.status !== 'draft' && current.status !== 'searching') {
      return failure('INVALID_STATE', 'Only draft and searching trip requests can be edited.');
    }
    const status = validated.status ?? current.status;
    if (current.status === 'searching' && status === 'draft') {
      return failure('INVALID_STATE', 'A searching trip request cannot return to draft.');
    }
    const traveler = await readOwnedTraveler(context, validated.elderly_traveler_id);
    if (isError(traveler)) return traveler;
    // Advance the revision even for same-millisecond edits. The update is one
    // statement guarded by both the observed status and timestamp.
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString();
    const { data, error } = await context.database.from('trip_requests')
      .update({ ...mutationFields(validated), status, updated_at: updatedAt })
      .eq('family_id', context.familyId).eq('id', current.id)
      .eq('elderly_traveler_id', current.elderly_traveler_id)
      .eq('status', current.status).eq('updated_at', current.updated_at)
      .select(REQUEST_COLUMNS).maybeSingle();
    if (error) return failure('PERSISTENCE', 'Unable to update the trip request.');
    if (!data) return failure('CONFLICT', 'The trip request changed. Reload it before saving again.');
    return await requestResult(context, data as unknown as RequestRow);
  } catch {
    return failure('PERSISTENCE', 'Unable to update the trip request.');
  }
}
