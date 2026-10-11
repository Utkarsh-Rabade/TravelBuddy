'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppAuth } from '@/lib/auth/provider';
import { Feedback, SecondaryButton } from '@/components/app/ui';

export default function SignOutButton() {
  const { refresh } = useAppAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) {
        setError('Unable to sign out. Please try again.');
        setBusy(false);
        return;
      }
      await refresh().catch(() => undefined);
      window.location.replace('/auth/sign-in');
    } catch {
      setError('Unable to sign out. Check your connection and try again.');
      setBusy(false);
    }
  }

  return <div className="tb-sign-out">
    <SecondaryButton type="button" disabled={busy} onClick={() => void signOut()} loading={busy} icon="logout">{busy ? 'Signing out…' : 'Sign out'}</SecondaryButton>
    {error && <Feedback tone="danger">{error}</Feedback>}
  </div>;
}
