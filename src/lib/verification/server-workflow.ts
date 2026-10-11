import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';


import {
  isUuid,
  isVerificationRow,
  toCompanionVerificationMetadata,
  VERIFICATION_METADATA_COLUMNS,
} from './metadata';
import type { CompanionVerificationMetadata } from './types';

export type VerificationReviewDecision = 'approve' | 'reject' | 'expire';

export interface ReviewCompanionVerificationInput {
  verificationId: string;
  decision: VerificationReviewDecision;
  expiresAt?: string | Date | null;
}

type CompanionStatus = 'pending' | 'verified' | 'expired' | 'rejected';

function reviewError(): Error {
  return new Error('Unable to review verification.');
}

function parseExpiry(value: string | Date | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Trusted server-only workflow. Its caller must verify native admin role and
 * server-owned admin_roles membership before supplying a privileged client.
 * There is deliberately no default client or browser-invokable server action.
 */
export async function reviewCompanionVerification(
  input: ReviewCompanionVerificationInput,
  database: SupabaseClient,
): Promise<CompanionVerificationMetadata> {
  if (!input || !isUuid(input.verificationId) ||
      (input.decision !== 'approve' && input.decision !== 'reject' && input.decision !== 'expire')) {
    throw reviewError();
  }

  const trustedDatabase = database;

  const loaded = await trustedDatabase.from('verifications')
    .select(VERIFICATION_METADATA_COLUMNS)
    .eq('id', input.verificationId)
    .maybeSingle();
  if (loaded.error || !loaded.data || !isVerificationRow(loaded.data)) throw reviewError();
  const verification = loaded.data;

  const companion = await trustedDatabase.from('companions')
    .select('id, verification_status')
    .eq('id', verification.companion_id)
    .maybeSingle();
  if (companion.error || !companion.data || !isUuid(companion.data.id) ||
      (companion.data.verification_status !== 'pending' &&
       companion.data.verification_status !== 'verified' &&
       companion.data.verification_status !== 'expired' &&
       companion.data.verification_status !== 'rejected')) {
    throw reviewError();
  }

  const currentCompanionStatus = companion.data.verification_status as CompanionStatus;
  const now = new Date();
  const nowIso = now.toISOString();
  const requestedExpiry = parseExpiry(input.expiresAt);
  if (input.expiresAt !== undefined && input.expiresAt !== null && requestedExpiry === null) {
    throw reviewError();
  }

  let expectedBackground: 'pending' | 'passed';
  let nextBackground: 'passed' | 'failed';
  let nextCompanionStatus: CompanionStatus;
  let nextVerifiedAt: string | null;
  let nextExpiresAt: string | null;

  if (input.decision === 'approve') {
    if (verification.background_check_status !== 'pending' || currentCompanionStatus !== 'pending') {
      throw reviewError();
    }
    if (requestedExpiry !== null && requestedExpiry <= now.getTime()) throw reviewError();
    expectedBackground = 'pending';
    nextBackground = 'passed';
    nextCompanionStatus = 'verified';
    nextVerifiedAt = nowIso;
    nextExpiresAt = requestedExpiry === null ? null : new Date(requestedExpiry).toISOString();
  } else if (input.decision === 'reject') {
    if (verification.background_check_status !== 'pending' || currentCompanionStatus !== 'pending') {
      throw reviewError();
    }
    expectedBackground = 'pending';
    nextBackground = 'failed';
    nextCompanionStatus = 'rejected';
    nextVerifiedAt = null;
    nextExpiresAt = null;
  } else {
    if (verification.background_check_status !== 'passed' || currentCompanionStatus !== 'verified') {
      throw reviewError();
    }
    if (requestedExpiry !== null && requestedExpiry > now.getTime()) throw reviewError();
    expectedBackground = 'passed';
    nextBackground = 'passed';
    nextCompanionStatus = 'expired';
    nextVerifiedAt = verification.verified_at;
    nextExpiresAt = requestedExpiry === null ? nowIso : new Date(requestedExpiry).toISOString();
  }

  const updated = await trustedDatabase.from('verifications')
    .update({
      background_check_status: nextBackground,
      verified_at: nextVerifiedAt,
      expires_at: nextExpiresAt,
      updated_at: nowIso,
    })
    .eq('id', verification.id)
    .eq('background_check_status', expectedBackground)
    .select(VERIFICATION_METADATA_COLUMNS)
    .maybeSingle();
  if (updated.error || !updated.data || !isVerificationRow(updated.data)) throw reviewError();

  const companionUpdated = await trustedDatabase.from('companions')
    .update({ verification_status: nextCompanionStatus, updated_at: nowIso })
    .eq('id', verification.companion_id)
    .eq('verification_status', currentCompanionStatus)
    .select('id')
    .maybeSingle();
  if (companionUpdated.error || !companionUpdated.data) {
    // Best-effort rollback keeps a failed two-table transition from granting
    // verification when the companion row could not be changed.
    await trustedDatabase.from('verifications')
      .update({
        background_check_status: verification.background_check_status,
        verified_at: verification.verified_at,
        expires_at: verification.expires_at,
        updated_at: verification.updated_at,
      })
      .eq('id', verification.id)
      .eq('background_check_status', nextBackground);
    throw reviewError();
  }

  const metadata = toCompanionVerificationMetadata(updated.data);
  if (!metadata) throw reviewError();
  return metadata;
}
