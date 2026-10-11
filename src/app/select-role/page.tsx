'use client';

import { authDestination, useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { setUserRole } from '@/actions/set-role';
import SignOutButton from '@/components/auth/SignOutButton';
import { ErrorState, Feedback, GlassCard, Icon, LoadingState, PrimaryButton, SecondaryButton, StepIndicator } from '@/components/app/ui';

export default function SelectRolePage() {
  const { user, isLoaded, error: sessionError, refresh } = useAppAuth();
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || sessionError || updating || redirecting) return;
    if (!user) router.replace('/auth/sign-in');
    else if (user.role) router.replace(authDestination(user.role));
  }, [isLoaded, sessionError, updating, redirecting, user, router]);

  const handleSelectRole = async (role: 'family' | 'companion') => {
    if (!user || user.role || updating) return;
    setUpdating(true);
    setError(null);
    try {
      const result = await setUserRole(role);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRedirecting(true);
      await refresh();
      window.location.replace(result.role === 'family' ? '/dashboard/family' : '/dashboard/companions');
    } catch {
      setRedirecting(false);
      setError('Unable to finish setting up your account. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  if (!isLoaded || sessionError || !user || user.role) {
    return (
      <div className="tb-app-system tb-access-screen">
        <GlassCard>{sessionError ? <ErrorState message={sessionError} action={<><SecondaryButton onClick={() => void refresh().catch(() => undefined)}>Try again</SecondaryButton><SecondaryButton href="/auth/sign-in">Open sign in</SecondaryButton></>} /> : <LoadingState label={!isLoaded ? 'Checking your session…' : 'Taking you to your account…'} />}</GlassCard>
      </div>
    );
  }

  return (
    <div className="tb-app-system tb-onboarding">
      <div className="tb-onboarding-brand"><Icon name="plane" />TravelBuddy<span>.</span></div>
      <GlassCard className="tb-onboarding-card">
        <StepIndicator steps={['Account created','Your role','Your profile']} currentStep={1} />
        <div className="tb-onboarding-heading"><p className="tb-app-eyebrow">A journey that starts with you</p><h1>Select Your Role</h1><p className="tb-muted">Are you signing up as a family member seeking travel assistance, or as a companion willing to help?</p></div>
        {error && <Feedback tone="danger">{error}</Feedback>}
        <div className="tb-grid">
          <GlassCard className="tb-role-card"><span className="tb-state-icon"><Icon name="users" size={25} /></span><h2>Care for your family</h2><p className="tb-muted tb-small">Plan a loved one’s journey, find a companion and stay connected along the way.</p><PrimaryButton type="button" onClick={() => handleSelectRole('family')} disabled={updating}>{updating ? 'Saving...' : 'I am a Family Member'}</PrimaryButton></GlassCard>
          <GlassCard className="tb-role-card"><span className="tb-state-icon"><Icon name="plane" size={25} /></span><h2>Be there for a traveler</h2><p className="tb-muted tb-small">Share your time and language skills to help make someone’s trip more comfortable.</p><SecondaryButton type="button" onClick={() => handleSelectRole('companion')} disabled={updating}>{updating ? 'Saving...' : 'I am a Companion'}</SecondaryButton></GlassCard>
        </div>
        <p className="tb-muted tb-small">Choose carefully. Your role cannot be changed after selection.</p>
        <div className="tb-onboarding-footer"><span className="tb-muted tb-small">Signed in as {user.email}</span><SignOutButton /></div>
      </GlassCard>
    </div>
  );
}
