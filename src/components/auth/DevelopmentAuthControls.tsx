'use client';

import { useRouter } from 'next/navigation';
import { useDevelopmentAuth } from '@/lib/auth/development-provider';

export default function DevelopmentAuthControls() {
  const { isLoaded, isDevelopment, session, signInAsDevUser } = useDevelopmentAuth();
  const router = useRouter();

  if (!isLoaded || !isDevelopment) {
    return null;
  }

  async function signIn(role: 'family' | 'companion' | 'admin') {
    await signInAsDevUser(role);
    router.push(role === 'family' ? '/dashboard/family' : role === 'companion' ? '/dashboard/companions/create' : '/dashboard/admin');
  }

  return (
    <section className="mt-6 w-full max-w-md rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="text-xs font-semibold uppercase tracking-wide">Development authentication</p>
      <p className="mt-1 text-sm">
        {session ? `Signed in as ${session.user.email}` : 'Use a deterministic development identity.'}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void signIn('family')}
          className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white"
        >
          Dev family
        </button>
        <button
          type="button"
          onClick={() => void signIn('companion')}
          className="rounded-md border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-900"
        >
          Dev companion
        </button>
        <button
          type="button"
          onClick={() => void signIn('admin')}
          className="rounded-md border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-900"
        >
          Dev admin
        </button>
      </div>
    </section>
  );
}
