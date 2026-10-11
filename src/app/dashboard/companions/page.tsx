'use client';

import { getCurrentCompanionProfile } from '@/actions/companions';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, ProfileCard, SecondaryButton, SectionHeader, StatCard, StatusBadge } from '@/components/app/ui';
import { useAppAuth } from '@/lib/auth/provider';
import { AssignedJourneys } from '@/components/app/AssignedJourneys';
import type { CompanionProfileDTO } from '@/lib/companion-types';
import { useEffect, useState } from 'react';

export default function CompanionsDashboard() {
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) return <LoadingState label="Loading companion dashboard..." />;
  if (!session) {
    return <AccessState message="Sign in to your companion account first." action="Open sign in" href="/auth/sign-in" />;
  }
  if (session.user.role !== 'companion') {
    return <AccessState message="This dashboard is only available to companion users." />;
  }

  return <CompanionDashboardContent key={session.user.id} />;
}

function CompanionDashboardContent() {
  const [companion, setCompanion] = useState<CompanionProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getCurrentCompanionProfile();
        if (!active) return;
        if (result.success) setCompanion(result.profile);
        else setError(result.error);
      } catch {
        if (active) setError('Unable to load your companion profile. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <LoadingState label="Loading companion profile..." />;
  if (error) {
    return (
      <GlassCard><ErrorState message={error} action={<SecondaryButton href="/dashboard/companions" icon="refresh">Retry</SecondaryButton>} /></GlassCard>
    );
  }
  if (!companion) {
    return (
      <div className="tb-page">
        <PageHeader title="Companion Dashboard" eyebrow="Your companion workspace" description="Start with a thoughtful profile, then add your availability and verification documents." />
        <GlassCard><EmptyState title="Welcome to your next chapter" description="You have not created a companion profile yet." icon="users" action={<PrimaryButton href="/dashboard/companions/create" icon="plus">Create Profile</PrimaryButton>} /></GlassCard>
      </div>
    );
  }

  const availability = companion.availability_calendar ?? {};
  const verificationGuidance = {
    pending: 'Your profile is pending verification. Open your profile to submit documents or check their review status.',
    verified: 'Your profile is verified. Keep your documents and availability current as you plan future journeys.',
    expired: 'Your profile verification has expired. Open your profile to review document status and submit an updated document.',
    rejected: 'Your profile verification was rejected. Review your document status and submit an updated document when ready.',
  }[companion.verification_status];

  return (
    <div className="tb-page">
      <PageHeader
        title="Companion Dashboard"
        eyebrow="Your companion workspace"
        description="A clear view of your profile, verification, and the time you can offer to travelers."
        actions={<><SecondaryButton href={`/dashboard/companions/${companion.id}`} icon="user">View Profile</SecondaryButton><PrimaryButton href={`/dashboard/companions/${companion.id}/edit`} icon="edit">Edit Profile</PrimaryButton></>}
      />

      <section aria-label="Your companion profile statistics" className="tb-grid-3">
        <StatCard label="Rating" value={companion.rating_average ?? 'Not rated yet'} description="Your recorded companion rating" icon="star" />
        <StatCard label="Completed Trips" value={companion.total_trips} description="Recorded completed journeys" icon="plane" />
        <StatCard label="Languages spoken" value={companion.languages_spoken.length} description="Languages saved in your profile" icon="globe" />
      </section>

      <div className="tb-grid">
        <section aria-label="Your companion profile" id="companion-profile">
          <ProfileCard
            name={`${companion.first_name} ${companion.last_name}`}
            subtitle="Your companion profile"
            status={companion.verification_status}
            actions={<SecondaryButton href={`/dashboard/companions/${companion.id}`} icon="arrow">View full profile</SecondaryButton>}
          >
            <dl className="tb-details mt-6">
              <div><dt>Profile reference</dt><dd>{companion.id}</dd></div>
              <div><dt>Date of Birth</dt><dd>{companion.date_of_birth ? new Date(companion.date_of_birth).toLocaleDateString() : 'Not provided'}</dd></div>
            </dl>
          </ProfileCard>
        </section>

        <GlassCard className="tb-stack" aria-labelledby="verification-summary-heading">
          <SectionHeader id="verification-summary-heading" title="Verification Status" description="Managed by the TravelBuddy review process." icon="shield" />
          <div><StatusBadge status={companion.verification_status}>{formatStatus(companion.verification_status)}</StatusBadge></div>
          <p className="tb-muted tb-small">{verificationGuidance}</p>
          <div className="tb-actions"><SecondaryButton href={`/dashboard/companions/${companion.id}#verification`} icon="document">View verification documents</SecondaryButton></div>
        </GlassCard>
      </div>

      <div className="tb-grid">
        <GlassCard aria-labelledby="languages-heading">
          <SectionHeader id="languages-heading" title="Language support" description="The languages you can use to help travelers feel understood." icon="globe" actions={<SecondaryButton href={`/dashboard/companions/${companion.id}/edit#profile-details`} icon="edit">Edit languages</SecondaryButton>} />
          {companion.languages_spoken.length > 0 ? (
            <div className="tb-actions">{companion.languages_spoken.map((language, index) => <StatusBadge key={`${language}-${index}`} tone="info">{language}</StatusBadge>)}</div>
          ) : <p className="tb-muted tb-small">No languages saved yet. Add the languages you speak to your profile.</p>}
        </GlassCard>

        <GlassCard aria-labelledby="availability-summary-heading">
          <SectionHeader id="availability-summary-heading" title="Weekly availability" description="Your saved weekly time ranges." icon="calendar" actions={<SecondaryButton href={`/dashboard/companions/${companion.id}/edit#availability`} icon="calendar">Update availability</SecondaryButton>} />
          {Object.keys(availability).length === 0 ? <p className="tb-muted tb-small">No availability saved yet.</p> : (
            <ul className="tb-stack">
              {Object.entries(availability).map(([day, ranges]) => (
                <li key={day} className="flex min-w-0 flex-wrap justify-between gap-2 border-b border-white/10 pb-3 last:border-0 last:pb-0">
                  <span className="text-sm font-medium">{formatStatus(day)}:</span>
                  <span className="tb-muted tb-small">{ranges.length ? ranges.map((range) => `${range.start} - ${range.end}`).join(', ') : 'Not set'}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      <AssignedJourneys />
    </div>
  );
}

function AccessState({ message, action, href }: { message: string; action?: string; href?: string }) {
  return <GlassCard><ErrorState title="Companion account access" message={message} action={action && href ? <PrimaryButton href={href}>{action}</PrimaryButton> : undefined} /></GlassCard>;
}

function formatStatus(status: string) {
  return status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
