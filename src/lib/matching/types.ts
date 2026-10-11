import type { CompanionAvailabilityCalendar } from '@/lib/companion-types';

export type MatchStatus = 'pending' | 'accepted' | 'rejected';

export interface MatchExplanationComponents {
  matchedLanguages: string[];
  requiredLanguages: string[];
  coveredWeekdays: string[];
  dateSpan: { departure: string; return: string } | null;
  verified: boolean;
  ratingAverage: number;
  totalTrips: number;
  limitations: string[];
}

export interface MatchExplanationEnvelope {
  text: string;
  status: MatchStatus;
  components?: MatchExplanationComponents;
}

export interface MatchingCompanionDTO {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  languages_spoken: string[];
  availability_calendar: CompanionAvailabilityCalendar;
  verification_status: 'pending' | 'verified' | 'expired' | 'rejected';
  rating_average: number;
  total_trips: number;
}

export interface MatchScoreComponents {
  languageScore: number;
  availabilityScore: number;
  verificationScore: number;
  reputationScore: number;
  /** Compatibility alias for callers that used the old name. */
  experienceScore: number;
  totalScore: number;
}

export interface MatchAttemptDTO {
  id: string;
  rank?: number;
  trip_request_id: string;
  companion_id: string;
  score: number;
  explanation: string;
  explanation_components?: MatchExplanationComponents;
  status: MatchStatus;
  matched: boolean;
  created_at: string;
  companion: MatchingCompanionDTO;
  /** Compatibility aliases derived from the live schema, never database columns. */
  match_score: number;
  match_attempted_at: string;
  companions: MatchingCompanionDTO;
}

export interface MatchResultDTO {
  rank?: number;
  companion: MatchingCompanionDTO;
  score: number;
  explanation: string;
  explanation_components?: MatchExplanationComponents;
  matchAttemptId: string;
  status: MatchStatus;
}
