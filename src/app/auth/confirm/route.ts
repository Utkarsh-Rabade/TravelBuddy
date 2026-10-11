import { NextResponse, type NextRequest } from 'next/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';

/** Email confirmation only: no OAuth or magic-link sign-in surface. */
export async function GET(request: NextRequest) {
  const database = await createAuthenticatedDatabaseClient();
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  let confirmed = false;
  if (code) {
    const { error } = await database.auth.exchangeCodeForSession(code);
    confirmed = !error;
  } else if (tokenHash && (type === 'signup' || type === 'email')) {
    const { error } = await database.auth.verifyOtp({ token_hash: tokenHash, type });
    confirmed = !error;
  }
  // Relative, fixed destinations preserve the caller's public origin even when
  // Next.js constructs request.url from an internal localhost/proxy address.
  // Do not trust an arbitrary Host/next/redirect_to value as a redirect target.
  return new NextResponse(null, { status: 303, headers: {
    Location: confirmed ? '/select-role' : '/auth/sign-in?error=confirmation',
    'Cache-Control': 'private, no-store, max-age=0',
  } });
}
