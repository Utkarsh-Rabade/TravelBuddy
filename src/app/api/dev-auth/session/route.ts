/**
 * Development-only auth API — DISABLED.
 *
 * This route previously provided development authentication shortcuts.
 * It has been replaced by native Supabase authentication and now returns 404
 * for all methods to prevent accidental use.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { error: 'Development authentication has been retired. Use email/password sign-in.' },
    { status: 404 },
  );
}

export async function POST() {
  return Response.json(
    { error: 'Development authentication has been retired. Use email/password sign-in.' },
    { status: 404 },
  );
}

export async function DELETE() {
  return Response.json(
    { error: 'Development authentication has been retired. Use email/password sign-in.' },
    { status: 404 },
  );
}
