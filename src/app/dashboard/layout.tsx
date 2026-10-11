'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app/AppShell';
import { ErrorState, GlassCard, LoadingState, SecondaryButton } from '@/components/app/ui';
import { authDestination, useAppAuth } from '@/lib/auth/provider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoaded, error, refresh } = useAppAuth();
  const router = useRouter();
  const pathname = usePathname();
  const wrongRole = Boolean(user && (
    !user.role ||
    (pathname.startsWith('/dashboard/family') && user.role !== 'family') ||
    (pathname.startsWith('/dashboard/companions') && user.role !== 'companion') ||
    (pathname.startsWith('/dashboard/admin') && user.role !== 'admin') ||
    (pathname.startsWith('/dashboard/bookings') && user.role !== 'family' && user.role !== 'companion')
  ));

  useEffect(() => {
    if (!isLoaded || error) return;
    if (!user) router.replace('/auth/sign-in');
    else if (wrongRole) router.replace(authDestination(user.role));
  }, [isLoaded, error, user, wrongRole, router]);

  if (!isLoaded || error || !user || wrongRole) {
    return <main className="tb-app-system tb-access-screen"><GlassCard>{error ? <ErrorState message={error} action={<><SecondaryButton onClick={() => void refresh().catch(() => undefined)}>Try again</SecondaryButton><SecondaryButton href="/auth/sign-in">Open sign in</SecondaryButton></>} /> : <LoadingState label={!isLoaded ? 'Checking your session…' : 'Taking you to your account…'} />}</GlassCard></main>;
  }

  return <AppShell user={user}><div key={user.id}>{children}</div></AppShell>;
}
