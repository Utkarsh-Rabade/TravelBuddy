/** Server-action contracts for the bounded administrative read/review surface. */

export type AdminRole = 'super_admin' | 'moderator' | 'support';
export type AdminVerificationDecision = 'approve' | 'reject' | 'expire';

export interface AdminVerificationSummary {
  id: string;
  companion_id: string;
  document_type: string;
  background_check_status: 'pending' | 'passed' | 'failed';
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminFamilySummary {
  id: string;
  name: string;
  created_at: string;
}

export interface AdminCompanionSummary {
  id: string;
  first_name: string;
  last_name: string;
  verification_status: 'pending' | 'verified' | 'expired' | 'rejected';
  rating_average: number;
  total_trips: number;
  created_at: string;
}

export interface AdminBookingSummary {
  id: string;
  booking_reference: string;
  total_amount: number;
  currency: string;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
  status: 'confirmed' | 'cancelled_by_family' | 'cancelled_by_companion' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface AdminTripSummary {
  id: string;
  booking_id: string;
  start_time: string;
  end_time: string | null;
  sos_triggered: boolean;
  last_check_in: string | null;
  created_at: string;
  updated_at: string;
}

/** Deliberately excludes the encrypted location column. */
export interface AdminSosSummary {
  id: string;
  trip_id: string;
  status: 'active' | 'acknowledged' | 'resolved';
  triggered_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface AdminRatingSummary {
  id: string;
  score: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminOverviewStats {
  families: number;
  companions: number;
  elderly_travelers: number;
  trip_requests: number;
  bookings: number;
  trips: number;
  ratings: number;
  sos_events: number;
  notifications: number;
  pending_verifications: number;
}

export interface AdminOverviewPagination {
  limit: number;
  offset: number;
  next_offset: number | null;
}

export interface AdminOverview {
  stats: AdminOverviewStats;
  families: AdminFamilySummary[];
  companions: AdminCompanionSummary[];
  pending_verifications: AdminVerificationSummary[];
  bookings: AdminBookingSummary[];
  trips: AdminTripSummary[];
  sos_events: AdminSosSummary[];
  ratings: AdminRatingSummary[];
  pagination: AdminOverviewPagination;
}

export interface AdminOverviewInput {
  limit?: number;
  offset?: number;
}

export type AdminActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PERSISTENCE';

export interface AdminActionError {
  success: false;
  code: AdminActionErrorCode;
  error: string;
}

export type AdminOverviewResult = { success: true; overview: AdminOverview } | AdminActionError;
export type AdminVerificationResult =
  | { success: true; verification: AdminVerificationSummary }
  | AdminActionError;
