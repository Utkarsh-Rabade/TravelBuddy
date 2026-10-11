/** Server-action contracts for consent, location, and SOS safety actions. */

export type SafetyConsentDataType = 'location';
export type SafetyConsentStatus = 'active' | 'revoked' | 'expired';
export type SosStatus = 'active' | 'acknowledged' | 'resolved';

export interface LocationInput {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface TripLocationDTO extends LocationInput {
  id: string;
  trip_id: string;
  recorded_at: string;
}

export interface TripConsentDTO {
  id: string;
  trip_id: string;
  data_type: SafetyConsentDataType;
  granted_by_clerk_id: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  notes: string | null;
  status: SafetyConsentStatus;
}

export interface SosEventDTO {
  id: string;
  trip_id: string;
  triggered_by_clerk_id: string;
  triggered_at: string;
  location: LocationInput | null;
  status: SosStatus;
  acknowledged_by_clerk_id: string | null;
  acknowledged_at: string | null;
  resolved_by_clerk_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface GrantLocationConsentInput {
  tripId: string;
  expiresAt?: string | null;
  notes?: string | null;
}

export interface RevokeLocationConsentInput {
  tripId: string;
  consentId?: string;
}

export interface RecordTripLocationInput extends LocationInput {
  tripId: string;
}

export interface ListTripLocationsInput {
  tripId: string;
  limit?: number;
}

export interface CreateSosInput {
  tripId: string;
  location?: LocationInput | null;
  /** Reusing a key returns the same event; use a new key after resolution. */
  idempotencyKey?: string;
}

export interface ListSosEventsInput {
  tripId: string;
}

export interface AcknowledgeSosInput {
  tripId: string;
  eventId: string;
}

export interface ResolveSosInput {
  tripId: string;
  eventId: string;
  resolutionNote?: string | null;
}

export type SafetyErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'PERSISTENCE'
  | 'CONFIGURATION';

export interface SafetyActionError {
  success: false;
  code: SafetyErrorCode;
  error: string;
}

export type ConsentResult = { success: true; consent: TripConsentDTO } | SafetyActionError;
export type ConsentLookupResult = { success: true; consent: TripConsentDTO | null } | SafetyActionError;
export type LocationResult = { success: true; location: TripLocationDTO } | SafetyActionError;
export type LocationListResult = { success: true; locations: TripLocationDTO[] } | SafetyActionError;
export type SosResult = { success: true; event: SosEventDTO } | SafetyActionError;
export type SosListResult = { success: true; events: SosEventDTO[] } | SafetyActionError;
