import type { MatchScoreComponents } from './types';

export interface MatchingTripRequest {
  departure_date: string;
  return_date: string | null;
  language_requirements?: unknown;
}

export interface MatchingCompanion {
  verification_status: unknown;
  languages_spoken?: unknown;
  availability_calendar?: unknown;
  rating_average?: unknown;
  total_trips?: unknown;
}

export const MATCH_SCORE_WEIGHTS = Object.freeze({
  language: 40,
  availability: 30,
  verification: 15,
  reputation: 15,
});

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? date : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);
}

/** Returns a canonical calendar, or null when any calendar data is invalid. */
export function normalizeAvailabilityCalendar(value: unknown): Record<string, Array<{ start: string; end: string }>> | null {
  if (!isRecord(value)) return null;
  const normalized: Record<string, Array<{ start: string; end: string }>> = {};
  let rangeCount = 0;

  for (const [rawDay, rawRanges] of Object.entries(value)) {
    const day = rawDay.trim().toLowerCase();
    if (!(WEEKDAYS as readonly string[]).includes(day) || !Array.isArray(rawRanges)) return null;
    const ranges: Array<{ start: string; end: string }> = [];
    for (const rawRange of rawRanges) {
      if (!isRecord(rawRange) || typeof rawRange.start !== 'string' ||
          typeof rawRange.end !== 'string' || !TIME_PATTERN.test(rawRange.start) ||
          !TIME_PATTERN.test(rawRange.end) || timeToMinutes(rawRange.start) >= timeToMinutes(rawRange.end)) {
        return null;
      }
      ranges.push({ start: rawRange.start, end: rawRange.end });
      rangeCount += 1;
    }
    normalized[day] = ranges;
  }

  if (rangeCount === 0) return null;
  return normalized;
}

export function getTripDates(departureDate: unknown, returnDate: unknown): Date[] {
  const start = parseDate(departureDate);
  const end = returnDate === null || returnDate === undefined ? start : parseDate(returnDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];

  const dates: Date[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function getRequiredWeekdays(departureDate: unknown, returnDate: unknown): string[] {
  const start = parseDate(departureDate);
  const end = returnDate === null || returnDate === undefined ? start : parseDate(returnDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const weekdays = new Set<string>();
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor;
    weekdays.add(WEEKDAYS[(date.getUTCDay() + 6) % 7]);
    if (weekdays.size === WEEKDAYS.length) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return WEEKDAYS.filter((day) => weekdays.has(day));
}

export function availabilityCoversTrip(
  departureDate: unknown,
  returnDate: unknown,
  availabilityCalendar: unknown,
): boolean {
  const calendar = normalizeAvailabilityCalendar(availabilityCalendar);
  const requiredWeekdays = getRequiredWeekdays(departureDate, returnDate);
  return calendar !== null && requiredWeekdays.length > 0 &&
    requiredWeekdays.every((day) => Array.isArray(calendar[day]) && calendar[day].length > 0);
}

export function getMatchedLanguages(required: unknown, spoken: unknown): string[] {
  const requiredLanguages = normalizeStringList(required);
  const spokenLanguages = new Set(normalizeStringList(spoken));
  return [...new Set(requiredLanguages.filter((language) => spokenLanguages.has(language)))];
}

export function calculateLanguageScore(required: unknown, spoken: unknown): number {
  const requiredLanguages = [...new Set(normalizeStringList(required))];
  if (requiredLanguages.length === 0) return MATCH_SCORE_WEIGHTS.language;
  return Math.round((getMatchedLanguages(requiredLanguages, spoken).length / requiredLanguages.length) * MATCH_SCORE_WEIGHTS.language);
}

export function calculateAvailabilityScore(
  departureDate: unknown,
  returnDate: unknown,
  availabilityCalendar: unknown,
): number {
  return availabilityCoversTrip(departureDate, returnDate, availabilityCalendar)
    ? MATCH_SCORE_WEIGHTS.availability
    : 0;
}

export function calculateVerificationScore(status: unknown): number {
  return status === 'verified' ? MATCH_SCORE_WEIGHTS.verification : 0;
}

export function calculateReputationScore(rating: unknown, totalTrips: unknown): number {
  const numericRating = typeof rating === 'number' ? rating : typeof rating === 'string' ? Number(rating) : 0;
  const numericTrips = typeof totalTrips === 'number' ? totalTrips : typeof totalTrips === 'string' ? Number(totalTrips) : 0;
  const ratingPoints = Math.round(Math.max(0, Math.min(5, numericRating)) * 2);
  const tripPoints = Math.min(5, Math.round(Math.log10(Math.max(0, numericTrips) + 1) * 2.5));
  return Math.min(MATCH_SCORE_WEIGHTS.reputation, ratingPoints + tripPoints);
}

/** A companion is eligible only when every computable required constraint passes. */
export function isCompanionEligible(tripRequest: MatchingTripRequest, companion: MatchingCompanion): boolean {
  const requiredLanguages = normalizeStringList(tripRequest.language_requirements);
  return companion.verification_status === 'verified' &&
    availabilityCoversTrip(tripRequest.departure_date, tripRequest.return_date, companion.availability_calendar) &&
    (requiredLanguages.length === 0 || getMatchedLanguages(requiredLanguages, companion.languages_spoken).length > 0);
}

export function calculateScoreComponents(
  tripRequest: MatchingTripRequest,
  companion: MatchingCompanion,
): MatchScoreComponents {
  const languageScore = calculateLanguageScore(tripRequest.language_requirements, companion.languages_spoken);
  const availabilityScore = calculateAvailabilityScore(
    tripRequest.departure_date,
    tripRequest.return_date,
    companion.availability_calendar,
  );
  const verificationScore = calculateVerificationScore(companion.verification_status);
  const reputationScore = calculateReputationScore(companion.rating_average, companion.total_trips);
  const eligible = isCompanionEligible(tripRequest, companion);
  const totalScore = eligible
    ? Math.min(100, languageScore + availabilityScore + verificationScore + reputationScore)
    : 0;

  return {
    languageScore,
    availabilityScore,
    verificationScore,
    reputationScore,
    experienceScore: reputationScore,
    totalScore,
  };
}

export function calculateMatchScore(tripRequest: MatchingTripRequest, companion: MatchingCompanion): number {
  return calculateScoreComponents(tripRequest, companion).totalScore;
}

export const isEligibleCompanion = isCompanionEligible;
export const calculateExperienceScore = calculateReputationScore;

/** Compatibility facade retained for existing callers; all methods are deterministic. */
export const scoreCalculator = {
  async calculateMatchScore(tripRequest: MatchingTripRequest, companion: MatchingCompanion): Promise<number> {
    return calculateMatchScore(tripRequest, companion);
  },
  async calculateScoreComponents(tripRequest: MatchingTripRequest, companion: MatchingCompanion): Promise<MatchScoreComponents> {
    return calculateScoreComponents(tripRequest, companion);
  },
  calculateLanguageScore,
  calculateAvailabilityScore,
  calculateVerificationScore,
  calculateExperienceScore: calculateReputationScore,
};
