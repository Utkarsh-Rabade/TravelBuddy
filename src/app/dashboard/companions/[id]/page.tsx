'use client';

import { getCurrentCompanionProfile } from '@/actions/companions';
import { ErrorState, GlassCard, LoadingState, PageHeader, PrimaryButton, ProfileCard, SecondaryButton, SectionHeader, StatusBadge } from '@/components/app/ui';
import KYCDocumentUpload from '@/components/forms/KYCDocumentUpload';
import { useAppAuth } from '@/lib/auth/provider';
import type { CompanionProfileDTO } from '@/lib/companion-types';
import { use, useEffect, useState } from 'react';

export default function CompanionProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) return <StatusPage message="Loading companion profile..." loading />;
  if (!session) return <StatusPage message="Sign in to your companion account first." href="/auth/sign-in" linkLabel="Open sign in" />;
  if (session.user.role !== 'companion') return <StatusPage message="This profile is only available to companion users." />;

  return <ProfileContent key={`${session.user.id}:${id}`} id={id} />;
}

function ProfileContent({ id }: { id: string }) {
  const [companion, setCompanion] = useState<CompanionProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getCurrentCompanionProfile();
        if (!active) return;
        if (!result.success) setError(result.error);
        else if (result.profile?.id !== id) setError('Companion profile not found.');
        else setCompanion(result.profile);
      } catch {
        if (active) setError('Failed to load companion profile.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) return <StatusPage message="Loading companion profile..." loading />;
  if (error || !companion) return <StatusPage message={error ?? 'Companion profile not found.'} href="/dashboard/companions" linkLabel="Back to Companions" />;

  const availability = companion.availability_calendar ?? {};
  return (
    <div className="tb-page">
      <PageHeader
        title="Companion Profile"
        eyebrow="Your profile, clearly presented"
        description="Review your saved details, weekly availability, and private verification submissions."
        backHref="/dashboard/companions"
        backLabel="Back to Companions"
        actions={<PrimaryButton href={`/dashboard/companions/${companion.id}/edit`} icon="edit">Edit Profile</PrimaryButton>}
      />

      <ProfileCard name={`${companion.first_name} ${companion.last_name}`} subtitle="Your companion profile">
        <dl className="tb-details mt-6">
          <div><dt>Companion ID</dt><dd>{companion.id}</dd></div>
          <div><dt>Verification Status</dt><dd><StatusBadge status={companion.verification_status}>{formatStatus(companion.verification_status)}</StatusBadge></dd></div>
          {companion.date_of_birth && <div><dt>Date of Birth</dt><dd>{new Date(companion.date_of_birth).toLocaleDateString()}</dd></div>}
          <div><dt>Reputation</dt><dd>Rating: {companion.rating_average ?? 'Not rated yet'} · Completed trips: {companion.total_trips}</dd></div>
        </dl>
      </ProfileCard>

      <div className="tb-grid">
        <GlassCard aria-labelledby="profile-languages-heading">
          <SectionHeader id="profile-languages-heading" title="Languages Spoken" description="Languages saved in your companion profile." icon="globe" />
          <p className="tb-small">{companion.languages_spoken.length > 0 ? companion.languages_spoken.join(', ') : 'No languages saved yet.'}</p>
        </GlassCard>

        <GlassCard aria-labelledby="profile-availability-heading">
          <SectionHeader
            id="profile-availability-heading"
            title="Availability Summary"
            description="Your saved weekly schedule."
            icon="calendar"
            actions={<SecondaryButton href={`/dashboard/companions/${companion.id}/edit#availability`} icon="edit">Update availability</SecondaryButton>}
          />
          {Object.keys(availability).length === 0 ? <p className="tb-muted tb-small">No availability saved yet.</p> : (
            <ul className="tb-stack">
              {Object.entries(availability).map(([day, ranges]) => <li key={day} className="flex min-w-0 flex-wrap justify-between gap-2 border-b border-white/10 pb-3 last:border-0 last:pb-0"><span className="text-sm font-medium">{formatStatus(day)}:</span><span className="tb-muted tb-small">{ranges.length ? ranges.map((range) => `${range.start} - ${range.end}`).join(', ') : 'Not set'}</span></li>)}
            </ul>
          )}
        </GlassCard>
      </div>

      <KYCDocumentUpload companionId={companion.id} />
    </div>
  );
}

function StatusPage({ message, href, linkLabel, loading }: { message: string; href?: string; linkLabel?: string; loading?: boolean }) {
  return <GlassCard>{loading ? <LoadingState label={message} /> : <ErrorState title="Companion profile" message={message} action={href ? <SecondaryButton href={href}>{linkLabel}</SecondaryButton> : undefined} />}</GlassCard>;
}

function formatStatus(status: string) { return status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
