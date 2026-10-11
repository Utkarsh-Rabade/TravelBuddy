import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';


export const COMPANION_VERIFICATION_BUCKET = 'companion-verifications';
export const COMPANION_VERIFICATION_MAX_BYTES = 10 * 1024 * 1024;
export const COMPANION_VERIFICATION_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: COMPANION_VERIFICATION_MAX_BYTES,
  allowedMimeTypes: [...COMPANION_VERIFICATION_MIME_TYPES],
};

/**
 * Ensures the private KYC bucket has the restrictions required by the server
 * upload path. The client is always the server's service-role client.
 */
export async function ensureCompanionVerificationBucket(
  database: SupabaseClient,
): Promise<void> {
  const current = await database.storage.getBucket(COMPANION_VERIFICATION_BUCKET);

  if (current.data) {
    const updated = await database.storage.updateBucket(
      COMPANION_VERIFICATION_BUCKET,
      BUCKET_OPTIONS,
    );
    if (updated.error) throw new Error('Unable to configure verification storage.');
    return;
  }

  const created = await database.storage.createBucket(
    COMPANION_VERIFICATION_BUCKET,
    BUCKET_OPTIONS,
  );
  if (!created.error) return;

  // A concurrent request may have created the bucket between get and create.
  const concurrent = await database.storage.getBucket(COMPANION_VERIFICATION_BUCKET);
  if (!concurrent.data) throw new Error('Unable to configure verification storage.');

  const updated = await database.storage.updateBucket(
    COMPANION_VERIFICATION_BUCKET,
    BUCKET_OPTIONS,
  );
  if (updated.error) throw new Error('Unable to configure verification storage.');
}

export async function removeCompanionVerificationObject(
  storagePath: string,
  database: SupabaseClient,
): Promise<void> {
  const result = await database.storage
    .from(COMPANION_VERIFICATION_BUCKET)
    .remove([storagePath]);
  if (result.error) throw new Error('Unable to clean up verification storage.');
}
