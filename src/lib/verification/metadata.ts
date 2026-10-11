import 'server-only';

import type {
  CompanionVerificationMetadata,
  VerificationBackgroundCheckStatus,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKGROUND_CHECK_STATUSES = new Set<VerificationBackgroundCheckStatus>([
  'pending',
  'passed',
  'failed',
]);

export const VERIFICATION_METADATA_COLUMNS = [
  'id',
  'companion_id',
  'document_type',
  'document_storage_path',
  'background_check_status',
  'verified_at',
  'expires_at',
  'created_at',
  'updated_at',
].join(', ');

export interface VerificationRow {
  id: string;
  companion_id: string;
  document_type: string;
  document_storage_path: string;
  background_check_status: VerificationBackgroundCheckStatus;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validTimestamp(value: unknown, nullable: boolean): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isVerificationRow(value: unknown): value is VerificationRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isUuid(row.id) &&
    isUuid(row.companion_id) &&
    typeof row.document_type === 'string' &&
    row.document_type.length > 0 &&
    typeof row.document_storage_path === 'string' &&
    row.document_storage_path.length > 0 &&
    BACKGROUND_CHECK_STATUSES.has(row.background_check_status as VerificationBackgroundCheckStatus) &&
    validTimestamp(row.verified_at, true) &&
    validTimestamp(row.expires_at, true) &&
    validTimestamp(row.created_at, false) &&
    validTimestamp(row.updated_at, false);
}

export function verificationDownloadPath(verificationId: string): string {
  return `/api/companion/kyc/${encodeURIComponent(verificationId)}`;
}

/** Converts a database row into the only verification shape safe for callers. */
export function toCompanionVerificationMetadata(
  value: unknown,
): CompanionVerificationMetadata | null {
  if (!isVerificationRow(value)) return null;
  const row = value;
  return {
    id: row.id,
    companion_id: row.companion_id,
    document_type: row.document_type,
    background_check_status: row.background_check_status,
    verified_at: row.verified_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    download_url: verificationDownloadPath(row.id),
  };
}

export function storagePathExtension(storagePath: string): 'pdf' | 'jpg' | 'jpeg' | 'png' | null {
  const extension = storagePath.split('.').pop()?.toLowerCase();
  return extension === 'pdf' || extension === 'jpg' || extension === 'jpeg' || extension === 'png'
    ? extension
    : null;
}
