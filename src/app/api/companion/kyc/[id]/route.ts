import { getCurrentUser } from '@/lib/auth/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import {
  isUuid,
  isVerificationRow,
  storagePathExtension,
  VERIFICATION_METADATA_COLUMNS,
} from '@/lib/verification/metadata';
import {
  COMPANION_VERIFICATION_BUCKET,
  ensureCompanionVerificationBucket,
} from '@/lib/verification/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(status: number): Response {
  return Response.json(
    { error: 'Unable to access verification document.' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return errorResponse(401);
  }
  if (!user) return errorResponse(401);
  if (user.role !== 'companion') return errorResponse(403);

  const { id } = await params;
  if (!isUuid(id)) return errorResponse(404);

  try {
    const database = await createAuthenticatedDatabaseClient();
    const verificationResult = await database.from('verifications')
      .select(VERIFICATION_METADATA_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (verificationResult.error || !verificationResult.data || !isVerificationRow(verificationResult.data)) {
      return errorResponse(404);
    }

    const row = verificationResult.data;
    const ownership = await database.from('companions')
      .select('id')
      .eq('id', row.companion_id)
      .eq('user_clerk_id', user.id)
      .maybeSingle();
    if (ownership.error || !ownership.data) return errorResponse(404);

    const extension = storagePathExtension(row.document_storage_path);
    if (!extension || !row.document_storage_path.startsWith(`${COMPANION_VERIFICATION_BUCKET}/`)) {
      return errorResponse(404);
    }

    const objectPath = row.document_storage_path.slice(`${COMPANION_VERIFICATION_BUCKET}/`.length);
    const objectSegments = objectPath.split('/');
    if (!objectPath || objectPath.startsWith('/') || objectSegments[0] !== row.companion_id ||
        objectSegments.some((segment) => segment.length === 0 || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment))) {
      return errorResponse(404);
    }
    // Private object download/bucket configuration requires privileged storage
    // access only after native companion role, RLS metadata, explicit owner and
    // companion-prefixed path checks have passed.
    const storageDatabase = createServiceRoleClient();
    await ensureCompanionVerificationBucket(storageDatabase);
    const download = await storageDatabase.storage.from(COMPANION_VERIFICATION_BUCKET).download(objectPath);
    if (download.error || !download.data) return errorResponse(404);

    const contentType = extension === 'pdf'
      ? 'application/pdf'
      : extension === 'png' ? 'image/png' : 'image/jpeg';
    return new Response(download.data, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="verification-${id}.${extension}"`,
      },
    });
  } catch {
    return errorResponse(404);
  }
}
