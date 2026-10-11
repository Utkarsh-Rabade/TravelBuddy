'use server';

import { getCurrentUser } from '@/lib/auth/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import type {
  AvailabilityCalendar,
  CompanionActionError,
  CompanionAvailabilityDTO,
  CompanionAvailabilityRange,
  CompanionErrorCode,
  CompanionProfileDTO,
  CompanionProfileInput,
  CompanionProfileResult,
  CompanionProfileUpdateInput,
  CompanionVerificationStatus,
  CompanionWeekday,
  CurrentCompanionProfileResult,
  CompanionAvailabilityResult,
} from '@/lib/companion-types';

const COMPANION_COLUMNS = [
  'id',
  'user_clerk_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'languages_spoken',
  'availability_calendar',
  'verification_status',
  'rating_average',
  'total_trips',
  'created_at',
  'updated_at',
].join(', ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_NAME_LENGTH = 120;
const MAX_LANGUAGE_COUNT = 32;
const MAX_LANGUAGE_LENGTH = 80;
const MAX_RANGES_PER_DAY = 24;
const MAX_TOTAL_RANGES = 96;
const MIN_BIRTH_YEAR = 1900;

const WEEKDAYS: readonly CompanionWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const VERIFICATION_STATUSES = new Set<CompanionVerificationStatus>([
  'pending',
  'verified',
  'expired',
  'rejected',
]);

type CompanionRow = Record<string, unknown>;

type NormalizedProfileInput = {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  languages_spoken: string[];
};

type NormalizedProfileUpdate = Partial<
  Pick<NormalizedProfileInput, 'first_name' | 'last_name' | 'date_of_birth' | 'languages_spoken'>
>;

function failure(code: CompanionErrorCode, error: string): CompanionActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActionError(value: unknown): value is CompanionActionError {
  return isRecord(value) && value.success === false && typeof value.code === 'string';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function validateName(value: unknown, label: string): string | CompanionActionError {
  if (typeof value !== 'string') return failure('INVALID_INPUT', `${label} is required.`);
  if (containsControlCharacter(value)) return failure('INVALID_INPUT', `${label} is invalid.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return failure('INVALID_INPUT', `${label} is required.`);
  if (normalized.length > MAX_NAME_LENGTH) {
    return failure('INVALID_INPUT', `${label} is invalid.`);
  }
  return normalized;
}

function validateDate(value: unknown): string | null | CompanionActionError {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return failure('INVALID_INPUT', 'Date of birth must use YYYY-MM-DD format.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < MIN_BIRTH_YEAR ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return failure('INVALID_INPUT', 'Date of birth is invalid.');
  }
  if (date.getTime() > Date.now()) {
    return failure('INVALID_INPUT', 'Date of birth cannot be in the future.');
  }
  return value;
}

function normalizeLanguages(value: unknown): string[] | CompanionActionError {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LANGUAGE_COUNT) {
    return failure('INVALID_INPUT', `Languages must contain at most ${MAX_LANGUAGE_COUNT} values.`);
  }

  const languages = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      return failure('INVALID_INPUT', 'Languages must contain only text values.');
    }
    if (containsControlCharacter(item)) return failure('INVALID_INPUT', 'Language values are invalid.');
    const normalized = item.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized || normalized.length > MAX_LANGUAGE_LENGTH) {
      return failure('INVALID_INPUT', 'Language values are invalid.');
    }
    languages.add(normalized);
  }
  return [...languages].sort();
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeCalendar(value: unknown): AvailabilityCalendar | CompanionActionError {
  if (!isRecord(value)) {
    return failure('INVALID_INPUT', 'Availability calendar must be an object.');
  }

  const normalized: AvailabilityCalendar = {};
  let totalRanges = 0;
  for (const key of Object.keys(value)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) {
      return failure('INVALID_INPUT', 'Availability calendar contains an unknown day.');
    }
    const dayRanges = value[key];
    if (!Array.isArray(dayRanges) || dayRanges.length > MAX_RANGES_PER_DAY) {
      return failure('INVALID_INPUT', 'Availability ranges are invalid.');
    }

    const ranges: CompanionAvailabilityRange[] = [];
    for (const range of dayRanges) {
      if (!isRecord(range) || Object.keys(range).length !== 2 ||
          !Object.prototype.hasOwnProperty.call(range, 'start') ||
          !Object.prototype.hasOwnProperty.call(range, 'end') ||
          typeof range.start !== 'string' || typeof range.end !== 'string' ||
          !TIME_PATTERN.test(range.start) || !TIME_PATTERN.test(range.end)) {
        return failure('INVALID_INPUT', 'Availability ranges must use exact HH:mm times.');
      }
      if (timeToMinutes(range.start) >= timeToMinutes(range.end)) {
        return failure('INVALID_INPUT', 'Availability ranges must have start before end.');
      }
      ranges.push({ start: range.start, end: range.end });
    }

    totalRanges += ranges.length;
    if (totalRanges > MAX_TOTAL_RANGES) {
      return failure('INVALID_INPUT', 'Availability calendar contains too many ranges.');
    }

    ranges.sort((left, right) => {
      const startDifference = timeToMinutes(left.start) - timeToMinutes(right.start);
      return startDifference || timeToMinutes(left.end) - timeToMinutes(right.end);
    });
    for (let index = 1; index < ranges.length; index += 1) {
      if (timeToMinutes(ranges[index - 1].end) > timeToMinutes(ranges[index].start)) {
        return failure('INVALID_INPUT', 'Availability ranges cannot overlap.');
      }
    }
    normalized[key as CompanionWeekday] = ranges;
  }

  // Rebuild in weekday order so equivalent JSON values have one canonical form.
  return Object.fromEntries(
    WEEKDAYS.filter((day) => Object.prototype.hasOwnProperty.call(normalized, day))
      .map((day) => [day, normalized[day]]),
  ) as AvailabilityCalendar;
}

function normalizeCreateInput(input: unknown): NormalizedProfileInput | CompanionActionError {
  if (!isRecord(input) || !hasOnlyKeys(input, new Set([
    'first_name',
    'last_name',
    'date_of_birth',
    'languages_spoken',
  ]))) {
    return failure('INVALID_INPUT', 'Companion profile input contains unsupported fields.');
  }
  const firstName = validateName(input.first_name, 'First name');
  if (isActionError(firstName)) return firstName;
  const lastName = validateName(input.last_name, 'Last name');
  if (isActionError(lastName)) return lastName;
  const dateOfBirth = validateDate(input.date_of_birth);
  if (isActionError(dateOfBirth)) return dateOfBirth;
  const languages = normalizeLanguages(input.languages_spoken);
  if (isActionError(languages)) return languages;
  return {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: dateOfBirth,
    languages_spoken: languages,
  };
}

function normalizeUpdateInput(input: unknown): NormalizedProfileUpdate | CompanionActionError {
  if (!isRecord(input) || !hasOnlyKeys(input, new Set([
    'first_name',
    'last_name',
    'date_of_birth',
    'languages_spoken',
  ]))) {
    return failure('INVALID_INPUT', 'Companion profile update contains unsupported fields.');
  }

  const update: NormalizedProfileUpdate = {};
  if (Object.prototype.hasOwnProperty.call(input, 'first_name')) {
    const firstName = validateName(input.first_name, 'First name');
    if (isActionError(firstName)) return firstName;
    update.first_name = firstName;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'last_name')) {
    const lastName = validateName(input.last_name, 'Last name');
    if (isActionError(lastName)) return lastName;
    update.last_name = lastName;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'date_of_birth')) {
    const dateOfBirth = validateDate(input.date_of_birth);
    if (isActionError(dateOfBirth)) return dateOfBirth;
    update.date_of_birth = dateOfBirth;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'languages_spoken')) {
    const languages = normalizeLanguages(input.languages_spoken);
    if (isActionError(languages)) return languages;
    update.languages_spoken = languages;
  }
  if (Object.keys(update).length === 0) {
    return failure('INVALID_INPUT', 'At least one companion profile field is required.');
  }
  return update;
}

function databaseFailure(): CompanionActionError {
  return failure('PERSISTENCE', 'Unable to save the companion profile.');
}

async function requireCurrentCompanion(): Promise<
  { userId: string } | CompanionActionError
> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'companion') {
    return failure('FORBIDDEN', 'Only a companion can access companion data.');
  }
  if (typeof user.id !== 'string' || user.id.length === 0) {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }
  return { userId: user.id };
}

function validDateFromDatabase(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === 'string' && DATE_PATTERN.test(value) && !isActionError(validateDate(value));
}

function toProfileDTO(row: CompanionRow): CompanionProfileDTO | null {
  if (!validUuid(row.id) || typeof row.user_clerk_id !== 'string' || !row.user_clerk_id ||
      !validDateFromDatabase(row.date_of_birth) || !Array.isArray(row.languages_spoken) ||
      !VERIFICATION_STATUSES.has(row.verification_status as CompanionVerificationStatus) ||
      typeof row.created_at !== 'string' || typeof row.updated_at !== 'string' ||
      !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at))) {
    return null;
  }
  const firstName = validateName(row.first_name, 'First name');
  const lastName = validateName(row.last_name, 'Last name');
  if (isActionError(firstName) || isActionError(lastName)) return null;
  const languages = normalizeLanguages(row.languages_spoken);
  const calendar = normalizeCalendar(row.availability_calendar);
  if (isActionError(languages) || isActionError(calendar)) return null;

  const rating = typeof row.rating_average === 'number'
    ? row.rating_average
    : typeof row.rating_average === 'string' ? Number(row.rating_average) : NaN;
  const totalTrips = typeof row.total_trips === 'number'
    ? row.total_trips
    : typeof row.total_trips === 'string' ? Number(row.total_trips) : NaN;
  if (!Number.isFinite(rating) || rating < 0 || rating > 5 ||
      !Number.isInteger(totalTrips) || totalTrips < 0) return null;

  return {
    id: row.id,
    user_clerk_id: row.user_clerk_id,
    first_name: firstName,
    last_name: lastName,
    date_of_birth: row.date_of_birth,
    languages_spoken: languages,
    availability_calendar: calendar,
    verification_status: row.verification_status as CompanionVerificationStatus,
    rating_average: rating,
    total_trips: totalTrips,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sameCalendar(left: AvailabilityCalendar, right: AvailabilityCalendar): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameCreateInput(profile: CompanionProfileDTO, input: NormalizedProfileInput): boolean {
  return profile.first_name === input.first_name &&
    profile.last_name === input.last_name &&
    profile.date_of_birth === input.date_of_birth &&
    JSON.stringify(profile.languages_spoken) === JSON.stringify(input.languages_spoken);
}

async function readOwnedProfile(userId: string, id?: string): Promise<
  CompanionProfileDTO | null | CompanionActionError
> {
  try {
    const database = await createAuthenticatedDatabaseClient();
    let query = database.from('companions').select(COMPANION_COLUMNS).eq('user_clerk_id', userId);
    if (id) query = query.eq('id', id);
    const { data, error } = await query.maybeSingle();
    if (error) return databaseFailure();
    if (!data) return null;
    const profile = toProfileDTO(data as unknown as CompanionRow);
    return profile ?? databaseFailure();
  } catch {
    return databaseFailure();
  }
}

async function readProfileById(id: string): Promise<CompanionProfileDTO | null | CompanionActionError> {
  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data, error } = await database.from('companions')
      .select(COMPANION_COLUMNS).eq('id', id).maybeSingle();
    if (error) return databaseFailure();
    if (!data) return null;
    const profile = toProfileDTO(data as unknown as CompanionRow);
    return profile ?? databaseFailure();
  } catch {
    return databaseFailure();
  }
}

async function readCurrentProfileResult(userId: string): Promise<CurrentCompanionProfileResult> {
  const profile = await readOwnedProfile(userId);
  if (isActionError(profile)) return profile;
  return { success: true, profile };
}

export async function getCurrentCompanionProfile(): Promise<CurrentCompanionProfileResult> {
  const identity = await requireCurrentCompanion();
  if (isActionError(identity)) return identity;
  return readCurrentProfileResult(identity.userId);
}

export async function createCompanionProfile(
  input: CompanionProfileInput,
  submissionId: string,
): Promise<CompanionProfileResult> {
  const identity = await requireCurrentCompanion();
  if (isActionError(identity)) return identity;
  if (!validUuid(submissionId)) return failure('INVALID_INPUT', 'Submission ID is invalid.');
  const normalized = normalizeCreateInput(input);
  if (isActionError(normalized)) return normalized;

  try {
    const database = await createAuthenticatedDatabaseClient();
    const existing = await readOwnedProfile(identity.userId);
    if (isActionError(existing)) return existing;
    if (existing) {
      return sameCreateInput(existing, normalized)
        ? { success: true, profile: existing }
        : failure('CONFLICT', 'A different companion profile already exists.');
    }

    const { data, error } = await database.from('companions').insert({
      // The explicit submission UUID is the row key because the live schema
      // has no separate idempotency-key column.
      id: submissionId.toLowerCase(),
      user_clerk_id: identity.userId,
      first_name: normalized.first_name,
      last_name: normalized.last_name,
      date_of_birth: normalized.date_of_birth,
      languages_spoken: normalized.languages_spoken,
    }).select(COMPANION_COLUMNS).single();

    if (!error && data) {
      const profile = toProfileDTO(data as unknown as CompanionRow);
      return profile ? { success: true, profile } : databaseFailure();
    }

    if (error?.code === '23505') {
      const repeated = await readOwnedProfile(identity.userId);
      if (isActionError(repeated)) return repeated;
      if (repeated) {
        return sameCreateInput(repeated, normalized)
          ? { success: true, profile: repeated }
          : failure('CONFLICT', 'A different companion profile already exists.');
      }
      // The submission UUID may already belong to another owner. Do not
      // reveal that row or overwrite it.
      const byId = await readProfileById(submissionId.toLowerCase());
      if (isActionError(byId)) return byId;
      return failure('CONFLICT', 'This submission cannot be reused.');
    }
    return databaseFailure();
  } catch {
    return databaseFailure();
  }
}

export async function updateCompanionProfile(
  id: string,
  input: CompanionProfileUpdateInput,
): Promise<CompanionProfileResult> {
  const identity = await requireCurrentCompanion();
  if (isActionError(identity)) return identity;
  if (!validUuid(id)) return failure('INVALID_INPUT', 'Companion ID is invalid.');
  const normalized = normalizeUpdateInput(input);
  if (isActionError(normalized)) return normalized;

  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data, error } = await database.from('companions')
      .update({ ...normalized, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_clerk_id', identity.userId)
      .select(COMPANION_COLUMNS)
      .maybeSingle();
    if (error) return databaseFailure();
    if (!data) return failure('NOT_FOUND', 'Companion profile not found.');
    const profile = toProfileDTO(data as unknown as CompanionRow);
    return profile ? { success: true, profile } : databaseFailure();
  } catch {
    return databaseFailure();
  }
}

export async function getCurrentCompanionAvailability(): Promise<CompanionAvailabilityResult> {
  const identity = await requireCurrentCompanion();
  if (isActionError(identity)) return identity;
  const profile = await readOwnedProfile(identity.userId);
  if (isActionError(profile)) return profile;
  return {
    success: true,
    availability: profile ? profile.availability_calendar : null,
  };
}

export async function updateCompanionAvailability(
  id: string,
  calendar: AvailabilityCalendar,
  submissionId: string,
): Promise<CompanionAvailabilityResult> {
  const identity = await requireCurrentCompanion();
  if (isActionError(identity)) return identity;
  if (!validUuid(id)) return failure('INVALID_INPUT', 'Companion ID is invalid.');
  if (!validUuid(submissionId)) return failure('INVALID_INPUT', 'Submission ID is invalid.');
  const normalized = normalizeCalendar(calendar);
  if (isActionError(normalized)) return normalized;

  try {
    const database = await createAuthenticatedDatabaseClient();
    const owned = await readOwnedProfile(identity.userId, id);
    if (isActionError(owned)) return owned;
    if (!owned) return failure('NOT_FOUND', 'Companion profile not found.');
    if (sameCalendar(owned.availability_calendar, normalized)) {
      return { success: true, availability: owned.availability_calendar };
    }

    // There is intentionally no availability table. The owner/id predicate
    // makes concurrent retries safe and prevents cross-profile updates.
    const { data, error } = await database.from('companions')
      .update({ availability_calendar: normalized, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_clerk_id', identity.userId)
      .select('availability_calendar')
      .maybeSingle();
    if (error) return databaseFailure();
    if (!data || !isRecord(data)) return failure('NOT_FOUND', 'Companion profile not found.');
    const saved = normalizeCalendar(data.availability_calendar);
    if (isActionError(saved)) return databaseFailure();
    return { success: true, availability: saved as CompanionAvailabilityDTO };
  } catch {
    return databaseFailure();
  }
}

/**
 * Compatibility adapters for the staged companion screens. They remain
 * server-side and delegate to the explicit Milestone 4 actions above.
 */
export async function getCompanionForCurrentUser(): Promise<
  | { success: true; companion: CompanionProfileDTO | null }
  | CompanionActionError
> {
  const result = await getCurrentCompanionProfile();
  return result.success ? { success: true, companion: result.profile } : result;
}

export async function createCompanionForCurrentUser(
  input: CompanionProfileInput,
): Promise<{ success: true; companion: CompanionProfileDTO } | CompanionActionError> {
  const result = await createCompanionProfile(input, crypto.randomUUID());
  return result.success ? { success: true, companion: result.profile } : result;
}

export async function updateCompanionForCurrentUser(
  id: string,
  input: CompanionProfileUpdateInput,
): Promise<{ success: true; companion: CompanionProfileDTO } | CompanionActionError> {
  const result = await updateCompanionProfile(id, input);
  return result.success ? { success: true, companion: result.profile } : result;
}

export async function saveCompanionAvailabilityForCurrentUser(
  id: string,
  calendar: AvailabilityCalendar,
): Promise<CompanionAvailabilityResult> {
  return updateCompanionAvailability(id, calendar, crypto.randomUUID());
}

export interface CompanionCatalogueEntry {
  id: string;
  first_name: string;
  last_name: string;
  languages_spoken: string[];
  rating_average: number;
  total_trips: number;
  verification_status: 'verified';
}

/** Family-facing display catalogue; never return a full companion profile. */
export async function getVerifiedCompanionCatalogue(): Promise<
  { success: true; companions: CompanionCatalogueEntry[] } | CompanionActionError
> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family') return failure('FORBIDDEN', 'Only a family user can browse companions.');
  try {
    // Verified candidates are private under RLS. The verified family role
    // authorizes this curated catalogue only: explicit display columns and
    // the verified predicate exclude owner IDs, DOB and document paths.
    const database = createServiceRoleClient();
    const { data, error } = await database.from('companions')
      .select('id, first_name, last_name, languages_spoken, rating_average, total_trips, verification_status')
      .eq('verification_status', 'verified').order('rating_average', { ascending: false });
    if (error) return failure('PERSISTENCE', 'Unable to load companions.');
    const companions: CompanionCatalogueEntry[] = [];
    for (const row of data ?? []) {
      if (!validUuid(row.id) || typeof row.first_name !== 'string' || typeof row.last_name !== 'string' ||
          row.verification_status !== 'verified') continue;
      const rating = Number(row.rating_average);
      const trips = Number(row.total_trips);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isInteger(trips) || trips < 0) continue;
      companions.push({
        id: row.id, first_name: row.first_name, last_name: row.last_name,
        languages_spoken: Array.isArray(row.languages_spoken)
          ? row.languages_spoken.filter((item: unknown): item is string => typeof item === 'string') : [],
        rating_average: rating, total_trips: trips, verification_status: 'verified',
      });
    }
    return { success: true, companions };
  } catch {
    return failure('PERSISTENCE', 'Unable to load companions.');
  }
}
