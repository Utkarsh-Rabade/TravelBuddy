/** Client-safe contracts for the server-side booking lifecycle. */

export type BookingPaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type BookingStatus =
  | 'confirmed'
  | 'cancelled_by_family'
  | 'cancelled_by_companion'
  | 'completed';

export type BookingPaymentType = 'platform_fee' | 'companion_payout' | 'refund' | 'charge';
export type BookingPaymentState = 'succeeded' | 'failed' | 'pending';

export interface BookingPaymentDTO {
  id: string;
  amount_cents: number;
  currency: string;
  type: BookingPaymentType;
  status: BookingPaymentState;
  created_at: string;
}

export interface BookingTripDTO {
  id: string;
  origin_airport: string;
  destination_airport: string;
  departure_date: string;
  return_date: string | null;
  assistance_level: 'minimal' | 'moderate' | 'maximum';
  language_requirements: string[];
  status: string;
}

export interface BookingCompanionDTO {
  id: string;
  first_name: string;
  last_name: string;
  languages_spoken: string[];
  verification_status: 'pending' | 'verified' | 'expired' | 'rejected';
  rating_average: number;
  total_trips: number;
}

export interface BookingDTO {
  id: string;
  trip_request_id: string;
  companion_id: string;
  booking_reference: string;
  total_amount: number;
  currency: string;
  payment_status: BookingPaymentStatus;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
  trip_request: BookingTripDTO;
  /** Compatibility alias for consumers that call the nested request "trip". */
  trip: BookingTripDTO;
  companion: BookingCompanionDTO;
  payments: BookingPaymentDTO[];
}

export type BookingErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'PERSISTENCE';

export interface BookingActionError {
  success: false;
  code: BookingErrorCode;
  error: string;
}

export type BookingResult =
  | { success: true; booking: BookingDTO }
  | BookingActionError;
