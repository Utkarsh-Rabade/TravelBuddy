'use server';

import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import {
  getOwnedCompanionId,
  isVerificationActionError,
  requireCompanionIdentity,
} from '@/lib/verification/access';
import {
  toCompanionVerificationMetadata,
  VERIFICATION_METADATA_COLUMNS,
} from '@/lib/verification/metadata';
import type { CurrentCompanionVerificationsResult } from '@/lib/verification/types';

/** Returns only the current companion's safe verification metadata. */
export async function getCurrentCompanionVerifications(): Promise<CurrentCompanionVerificationsResult> {
  const identity = await requireCompanionIdentity();
  if (isVerificationActionError(identity)) return identity;

  try {
    const database = await createAuthenticatedDatabaseClient();
    const companionId = await getOwnedCompanionId(identity.userId, database);
    if (!companionId) {
      return { success: false, code: 'NOT_FOUND', error: 'Companion profile not found.' };
    }

    const { data, error } = await database.from('verifications')
      .select(VERIFICATION_METADATA_COLUMNS)
      .eq('companion_id', companionId)
      .order('created_at', { ascending: false });
    if (error) {
      return { success: false, code: 'PERSISTENCE', error: 'Unable to read verification data.' };
    }

    return {
      success: true,
      verifications: (data ?? [])
        .map((row) => toCompanionVerificationMetadata(row))
        .filter((row): row is NonNullable<typeof row> => row !== null),
    };
  } catch {
    return { success: false, code: 'PERSISTENCE', error: 'Unable to read verification data.' };
  }
}
