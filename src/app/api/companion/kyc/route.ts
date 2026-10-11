import { randomUUID } from 'node:crypto';

import { createServiceRoleClient } from '@/lib/supabase-server';
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
import {
  COMPANION_VERIFICATION_BUCKET,
  COMPANION_VERIFICATION_MAX_BYTES,
  ensureCompanionVerificationBucket,
  removeCompanionVerificationObject,
} from '@/lib/verification/storage';
import type {
  CompanionVerificationActionError,
  CompanionVerificationMetadata,
} from '@/lib/verification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TO_EXTENSION: Readonly<Record<string, 'pdf' | 'jpg' | 'jpeg' | 'png'>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
};

function responseError(error: CompanionVerificationActionError, status: number): Response {
  return Response.json({ error: error.error, code: error.code }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function genericError(status = 500): Response {
  return Response.json(
    { error: 'Unable to process verification request.' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function authStatus(error: CompanionVerificationActionError): number {
  return error.code === 'UNAUTHENTICATED' ? 401 : 403;
}

function fileExtension(file: File): 'pdf' | 'jpg' | 'jpeg' | 'png' | null {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'pdf' && extension !== 'jpg' && extension !== 'jpeg' && extension !== 'png') {
    return null;
  }
  return extension;
}

function validUploadFile(file: File): boolean {
  const extension = fileExtension(file);
  if (!extension || file.size <= 0 || file.size > COMPANION_VERIFICATION_MAX_BYTES) return false;
  const expectedExtension = MIME_TO_EXTENSION[file.type.toLowerCase()];
  if (!expectedExtension) return false;
  return expectedExtension === extension ||
    (expectedExtension === 'jpeg' && extension === 'jpg');
}

function metadataResponse(metadata: CompanionVerificationMetadata): Response {
  return Response.json({ verification: metadata }, {
    status: 201,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(): Promise<Response> {
  const identity = await requireCompanionIdentity();
  if (isVerificationActionError(identity)) return responseError(identity, authStatus(identity));

  try {
    const database = await createAuthenticatedDatabaseClient();
    const companionId = await getOwnedCompanionId(identity.userId, database);
    if (!companionId) return genericError(404);

    const { data, error } = await database.from('verifications')
      .select(VERIFICATION_METADATA_COLUMNS)
      .eq('companion_id', companionId)
      .order('created_at', { ascending: false });
    if (error) return genericError();

    const verifications = (data ?? [])
      .map((row) => toCompanionVerificationMetadata(row))
      .filter((row): row is CompanionVerificationMetadata => row !== null);

    return Response.json({ verifications }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return genericError();
  }
}

export async function POST(request: Request): Promise<Response> {
  const identity = await requireCompanionIdentity();
  if (isVerificationActionError(identity)) return responseError(identity, authStatus(identity));

  let file: File;
  try {
    const form = await request.formData();
    const value = form.get('file');
    if (!(value instanceof File)) return genericError(400);
    file = value;
  } catch {
    return genericError(400);
  }

  if (!validUploadFile(file)) return genericError(400);

  let companionId: string | null;
  try {
    companionId = await getOwnedCompanionId(identity.userId);
  } catch {
    return genericError();
  }
  if (!companionId) return genericError(404);

  let database: ReturnType<typeof createServiceRoleClient>;
  try {
    // Private KYC storage and verification-state writes are trusted. Native
    // companion role + authenticated owner lookup passed before this client;
    // paths are server-generated and the companion update repeats ownership.
    database = createServiceRoleClient();
  } catch {
    return genericError();
  }

  const extension = fileExtension(file);
  if (!extension) return genericError(400);
  const storagePath = `${COMPANION_VERIFICATION_BUCKET}/${companionId}/${randomUUID()}.${extension}`;
  let uploaded = false;
  let insertedVerificationId: string | null = null;

  try {
    await ensureCompanionVerificationBucket(database);
    const upload = await database.storage
      .from(COMPANION_VERIFICATION_BUCKET)
      .upload(storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length), file, {
        contentType: file.type,
        upsert: false,
      });
    if (upload.error) return genericError();
    uploaded = true;

    const now = new Date().toISOString();
    const inserted = await database.from('verifications').insert({
      companion_id: companionId,
      document_type: 'kyc',
      document_storage_path: storagePath,
      background_check_status: 'pending',
      verified_at: null,
      expires_at: null,
      created_at: now,
      updated_at: now,
    }).select(VERIFICATION_METADATA_COLUMNS).single();

    if (inserted.error || !inserted.data) {
      await removeCompanionVerificationObject(storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length), database).catch(() => undefined);
      return genericError();
    }
    const insertedId = (inserted.data as unknown as { id?: unknown })?.id;
    if (typeof insertedId !== 'string') {
      await removeCompanionVerificationObject(storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length), database).catch(() => undefined);
      return genericError();
    }
    insertedVerificationId = insertedId;

    const companionUpdate = await database.from('companions')
      .update({ verification_status: 'pending', updated_at: now })
      .eq('id', companionId)
      .eq('user_clerk_id', identity.userId)
      .select('id')
      .maybeSingle();
    if (companionUpdate.error || !companionUpdate.data) {
      await database.from('verifications').delete().eq('id', insertedVerificationId);
      await removeCompanionVerificationObject(storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length), database).catch(() => undefined);
      return genericError();
    }

    const metadata = toCompanionVerificationMetadata(inserted.data);
    if (!metadata) {
      await database.from('verifications').delete().eq('id', insertedVerificationId);
      await removeCompanionVerificationObject(storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length), database).catch(() => undefined);
      return genericError();
    }
    return metadataResponse(metadata);
  } catch {
    if (insertedVerificationId) {
      try {
        await database.from('verifications').delete().eq('id', insertedVerificationId);
      } catch {
        // The storage cleanup below is still attempted when row cleanup fails.
      }
    }
    if (uploaded) {
      await removeCompanionVerificationObject(
        storagePath.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length),
        database,
      ).catch(() => undefined);
    }
    return genericError();
  }
}
