/** Client-safe contracts for the server-side trip lifecycle and check-in flow. */

import type { BookingStatus } from '@/lib/booking-types';
import type { TripRequestStatus } from '@/lib/trip-request-types';

/** `upcoming` is presentation-only; the persisted value remains `booked`. */
export type TripLifecycleStatus = 'upcoming' | 'in_progress' | 'completed' | 'cancelled';

export interface TripBookingSummary {
  id: string;
  status: BookingStatus;
}

export interface TripRequestSummary {
  id: string;
  origin_airport: string;
  destination_airport: string;
  departure_date: string;
  return_date: string | null;
}

export interface TripDTO {
  id: string;
  booking_id: string;
  trip_request_id: string;
  /** Derived from trip_request.status. This value is never written to the database. */
  status: TripLifecycleStatus;
  request_status: TripRequestStatus;
  booking_status: BookingStatus;
  start_time: string;
  end_time: string | null;
  last_check_in: string | null;
  booking: TripBookingSummary;
  trip_request: TripRequestSummary;
}

export type TripErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'PERSISTENCE';

export interface TripActionError {
  success: false;
  code: TripErrorCode;
  error: string;
}

export type TripResult = { success: true; trip: TripDTO } | TripActionError;
export type TripListResult = { success: true; trips: TripDTO[] } | TripActionError;
