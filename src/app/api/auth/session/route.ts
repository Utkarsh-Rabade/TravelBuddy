import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
  try {
    return NextResponse.json({ user: await getCurrentUser() }, { headers });
  } catch {
    return NextResponse.json({ user: null, error: 'Unable to verify your account.' }, { status: 503, headers });
  }
}
