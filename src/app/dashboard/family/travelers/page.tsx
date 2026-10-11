'use client';

import { getCurrentFamilyTravelers, type TravelerDTO } from '@/actions/travelers';
import { EmptyState, ErrorState, GlassCard, LoadingState, PageHeader, PrimaryButton, ProfileCard, SecondaryButton, SectionHeader, StatusBadge } from '@/components/app/ui';
import { useAppAuth } from '@/lib/auth/provider';
import { useCallback, useEffect, useState } from 'react';

export default function TravelersPage() {
  const { isLoaded, session } = useAppAuth();
  const [travelers, setTravelers] = useState<TravelerDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await getCurrentFamilyTravelers();
      if (result.success) setTravelers(result.travelers); else setError(result.error);
    } catch { setError('Unable to load travelers. Please try again.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isLoaded && session?.user.role === 'family') void load(); else if (isLoaded) setLoading(false); }, [isLoaded, load, session]);

  if (!isLoaded || loading) return <LoadingState label="Loading travelers..." />;
  if (!session) return <GlassCard><EmptyState title="Your family’s travelers" description="Sign in to your family account first." icon="users" action={<PrimaryButton href="/auth/sign-in">Open sign in</PrimaryButton>} /></GlassCard>;
  if (session.user.role !== 'family') return <GlassCard><ErrorState message="This page is only available to family users." /></GlassCard>;

  return (
    <div className="tb-page">
      <PageHeader
        title="Elderly Travelers"
        eyebrow="The people at the heart of every journey"
        description="Keep a thoughtful profile for each traveler. Review their details before planning the next trip."
        backHref="/dashboard/family"
        backLabel="Back to Dashboard"
        actions={<PrimaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</PrimaryButton>}
      />
      {error ? (
        <GlassCard><ErrorState message={error} onRetry={() => void load()} action={<SecondaryButton href="/dashboard/family" icon="back">Back to Dashboard</SecondaryButton>} /></GlassCard>
      ) : travelers.length === 0 ? (
        <GlassCard><EmptyState title="No travelers found." description="Start with someone you’re planning a journey for. Their saved profile can be used when you create a trip request." icon="users" action={<PrimaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</PrimaryButton>} /></GlassCard>
      ) : (
        <section aria-labelledby="saved-travelers">
          <SectionHeader
            id="saved-travelers"
            title="Saved profiles"
            description={`${travelers.length} ${travelers.length === 1 ? 'traveler' : 'travelers'} in your family. Open a profile for assistance needs and emergency contacts.`}
            actions={<SecondaryButton href="/dashboard/family/trip-requests/new" icon="plane">Create Trip</SecondaryButton>}
          />
          <div className="tb-grid-3">
            {travelers.map((traveler) => {
              const hasPrimaryContact = Boolean(traveler.emergency_contacts?.primary_name && traveler.emergency_contacts.primary_phone);
              return (
                <ProfileCard
                  key={traveler.id}
                  name={`${traveler.first_name} ${traveler.last_name}`}
                  subtitle="Family traveler"
                  actions={<>
                    <SecondaryButton href={`/dashboard/family/travelers/${traveler.id}`} icon="user">View Details</SecondaryButton>
                    <SecondaryButton href={`/dashboard/family/travelers/${traveler.id}/edit`} icon="edit">Edit Profile</SecondaryButton>
                  </>}
                >
                  <hr className="tb-divider" />
                  <div className="tb-stack">
                    <StatusBadge status={hasPrimaryContact ? 'Profile saved' : 'Contact review needed'} tone={hasPrimaryContact ? 'info' : 'warning'} />
                    <dl className="tb-details">
                      <div>
                        <dt>Date of Birth</dt>
                        <dd>{traveler.date_of_birth ? new Date(traveler.date_of_birth).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Not specified'}</dd>
                      </div>
                      <div><dt>Last updated</dt><dd>{new Date(traveler.updated_at).toLocaleDateString()}</dd></div>
                    </dl>
                  </div>
                </ProfileCard>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
