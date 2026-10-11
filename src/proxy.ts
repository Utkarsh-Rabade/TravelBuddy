import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicSupabaseConfig } from '@/lib/supabase-config';
import { resolveTrustedRole } from '@/lib/auth/roles';
import type { AuthRole } from '@/lib/auth/types';

function destination(role: AuthRole | null) {
  return role === 'admin' ? '/dashboard/admin'
    : role === 'family' ? '/dashboard/family'
      : role === 'companion' ? '/dashboard/companions' : '/select-role';
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getPublicSupabaseConfig();
  const database = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        const previous = response.cookies.getAll();
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        previous.forEach((cookie) => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  // Verify before trusting cookies; getUser also observes deleted/disabled users.
  const { data: { user }, error } = await database.auth.getUser();
  const path = request.nextUrl.pathname;
  const protectedPage = path === '/dashboard' || path.startsWith('/dashboard/') || path === '/select-role';
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Cookie');
  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    for (const name of ['cache-control', 'expires', 'pragma', 'vary']) {
      const value = response.headers.get(name);
      if (value) redirect.headers.set(name, value);
    }
    return redirect;
  };
  // Server actions/API handlers enforce their own authorization and return useful errors.
  if (protectedPage && ['GET', 'HEAD'].includes(request.method)) {
    if (error || !user) return redirectTo('/auth/sign-in');
    let role: AuthRole | null;
    try {
      role = await resolveTrustedRole(database, user.id);
    } catch {
      return new NextResponse('Account verification is temporarily unavailable. Please retry.', {
        status: 503, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (path === '/select-role') return role ? redirectTo(destination(role)) : response;
    if (!role) return redirectTo('/select-role');
    const forbidden =
      (path.startsWith('/dashboard/admin') && role !== 'admin') ||
      (path.startsWith('/dashboard/family') && role !== 'family') ||
      (path.startsWith('/dashboard/companions') && role !== 'companion') ||
      (path.startsWith('/dashboard/bookings') && role === 'admin');
    if (forbidden || path === '/dashboard') return redirectTo(destination(role));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)).*)'],
};
