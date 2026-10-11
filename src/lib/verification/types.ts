/** Metadata that may be returned to an authenticated companion. */
export type VerificationBackgroundCheckStatus = 'pending' | 'passed' | 'failed';

export interface CompanionVerificationMetadata {
  id: string;
  companion_id: string;
  document_type: string;
  background_check_status: VerificationBackgroundCheckStatus;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  /** Protected application endpoint; this is not a Supabase public URL. */
  download_url: string;
}

export type CompanionVerificationActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PERSISTENCE';

export interface CompanionVerificationActionError {
  success: false;
  code: CompanionVerificationActionErrorCode;
  error: string;
}

export type CompanionVerificationResult =
  | { success: true; verification: CompanionVerificationMetadata }
  | CompanionVerificationActionError;

export type CurrentCompanionVerificationsResult =
  | { success: true; verifications: CompanionVerificationMetadata[] }
  | CompanionVerificationActionError;
