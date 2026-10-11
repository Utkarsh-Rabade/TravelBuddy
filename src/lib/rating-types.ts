/** Client-safe contracts for completed-trip ratings. */

export interface CreateRatingInput {
  tripId: string;
  score: number;
  comment?: string | null;
}

/** A rating never exposes the trip, actor, or target identifiers to clients. */
export interface RatingDTO {
  score: number;
  comment: string | null;
  created_at: string;
  is_mine: boolean;
}

export interface RatingEligibilityDTO {
  /** Whether the current user is an eligible family owner rater. */
  eligible: boolean;
  /** Whether the current user may submit a new rating. */
  can_rate: boolean;
  has_rated: boolean;
  rating: RatingDTO | null;
}

export type RatingErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'PERSISTENCE';

export interface RatingActionError {
  success: false;
  code: RatingErrorCode;
  error: string;
}

export type RatingResult =
  | { success: true; rating: RatingDTO; created: boolean }
  | RatingActionError;

export type RatingEligibilityResult =
  | { success: true; eligibility: RatingEligibilityDTO }
  | RatingActionError;

export type RatingListResult =
  | { success: true; ratings: RatingDTO[] }
  | RatingActionError;
