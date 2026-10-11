/** Client-safe companion profile and availability contracts. */

export type CompanionVerificationStatus = 'pending' | 'verified' | 'expired' | 'rejected';

export type CompanionWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface CompanionAvailabilityRange {
  start: string;
  end: string;
}

/**
 * A weekly calendar. Omitted days have no availability; when present, a day
 * always contains a list of non-overlapping { start, end } ranges.
 */
export type CompanionAvailabilityCalendar = Record<string, CompanionAvailabilityRange[]>;

/** Short aliases are useful to callers that do not need the longer names. */
export type AvailabilityCalendar = CompanionAvailabilityCalendar;
export type AvailabilityRange = CompanionAvailabilityRange;

export interface CompanionProfileInput {
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  languages_spoken: string[];
}

/** Profile-only input used by the staged profile form. */
export type CompanionInput = Omit<CompanionProfileInput, 'availability_calendar'>;

export interface CompanionProfileUpdateInput {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  languages_spoken?: string[];
}

export interface CompanionProfileDTO {
  id: string;
  user_clerk_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  languages_spoken: string[];
  availability_calendar: CompanionAvailabilityCalendar;
  readonly verification_status: CompanionVerificationStatus;
  readonly rating_average: number;
  readonly total_trips: number;
  created_at: string;
  updated_at: string;
}

/** Backwards-compatible name for the safe profile DTO. */
export type CompanionDTO = CompanionProfileDTO;

export type CompanionAvailabilityDTO = CompanionAvailabilityCalendar;

export type CompanionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERSISTENCE';

export interface CompanionActionError {
  success: false;
  code: CompanionErrorCode;
  error: string;
}

export type CompanionProfileResult =
  | { success: true; profile: CompanionProfileDTO }
  | CompanionActionError;

export type CurrentCompanionProfileResult =
  | { success: true; profile: CompanionProfileDTO | null }
  | CompanionActionError;

export type CompanionAvailabilityResult =
  | { success: true; availability: CompanionAvailabilityDTO | null }
  | CompanionActionError;
