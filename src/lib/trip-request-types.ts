/** Client-safe contracts. Ownership and matching criteria are server-managed. */
export type TripAssistanceLevel = 'minimal' | 'moderate' | 'maximum';
export type TripRequestEditableStatus = 'draft' | 'searching';
export type TripRequestStatus =
  | TripRequestEditableStatus
  | 'matched'
  | 'booked'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface TripTravelerOption {
  id: string;
  first_name: string;
  last_name: string;
}

export interface TripRequestInput {
  elderly_traveler_id: string;
  origin_airport: string;
  destination_airport: string;
  departure_date: string;
  return_date: string | null;
  assistance_level: TripAssistanceLevel;
  language_requirements: string[];
  special_instructions?: string | null;
  status?: TripRequestEditableStatus;
}

export interface TripRequestDTO {
  id: string;
  elderly_traveler_id: string;
  origin_airport: string;
  destination_airport: string;
  departure_date: string;
  return_date: string | null;
  assistance_level: TripAssistanceLevel;
  language_requirements: string[];
  special_instructions: string | null;
  status: TripRequestStatus;
  created_at: string;
  updated_at: string;
  elderly_travelers: TripTravelerOption;
}

export type TripRequestErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'PERSISTENCE';

export interface TripRequestActionError {
  success: false;
  code: TripRequestErrorCode;
  error: string;
}

export type TripRequestResult =
  | { success: true; request: TripRequestDTO }
  | TripRequestActionError;
export type TripRequestListResult =
  | { success: true; requests: TripRequestDTO[] }
  | TripRequestActionError;
export type TripTravelerOptionsResult =
  | { success: true; travelers: TripTravelerOption[] }
  | TripRequestActionError;
