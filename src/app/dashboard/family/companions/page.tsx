"use client";

import { getVerifiedCompanionCatalogue, type CompanionCatalogueEntry } from '@/actions/companions';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassCard, LoadingState, PageHeader, PrimaryButton, ProfileCard, SecondaryButton, SectionHeader } from '@/components/app/ui';

type Companion = CompanionCatalogueEntry;

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCompanions();
  }, []);

  async function loadCompanions() {
    try {
      setLoading(true);
      const result = await getVerifiedCompanionCatalogue();
      if (!result.success) throw new Error(result.error);
      setCompanions(result.companions);
    } catch (err) {
      console.error('Error loading companions:', err);
      setError('Failed to load companions');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading companions..." />;
  }

  if (error) {
    return <ErrorState title="Unable to load companions" message={error} action={<SecondaryButton href="/dashboard/family">Back to Dashboard</SecondaryButton>} />;
  }

  return (
    <div className="tb-page">
      <PageHeader title="Verified Companions" eyebrow="People who make journeys easier" description="Browse companion names, languages, ratings and travel experience. Create a trip request to find matches for your route and dates." backHref="/dashboard/family" backLabel="Back to Dashboard" actions={<PrimaryButton href="/dashboard/family/trip-requests/new" icon="plane">Create Trip Request</PrimaryButton>} />
      {companions.length > 0 ? (
        <section aria-labelledby="catalogue-heading">
          <SectionHeader id="catalogue-heading" title={`Companion catalogue (${companions.length})`} description="Get to know the verified companions in the catalogue." />
          <div className="tb-grid">
            {companions.map((companion) => (
              <ProfileCard key={companion.id} name={`${companion.first_name} ${companion.last_name}`} subtitle="Travel companion" status={companion.verification_status}>
                <dl className="tb-details mt-6">
                  <div><dt>Rating</dt><dd>{companion.rating_average !== null && companion.rating_average > 0 ? `${companion.rating_average.toFixed(1)} / 5.0` : 'No ratings yet'}</dd></div>
                  <div><dt>Experience</dt><dd>{companion.total_trips} trips</dd></div>
                  <div className="col-span-2"><dt>Languages</dt><dd>{companion.languages_spoken.join(', ') || 'None specified'}</dd></div>
                </dl>
                <details className="tb-min-zero mt-5">
                  <summary className="tb-link cursor-pointer" style={{ minHeight: 44 }}>View companion reference</summary>
                  <p className="tb-muted tb-small mt-2">Companion ID: <span className="font-mono">{companion.id}</span></p>
                </details>
              </ProfileCard>
            ))}
          </div>
        </section>
      ) : (
        <GlassCard><EmptyState title="The companion catalogue is growing" description="No verified companions found yet. Companions will appear here once they complete verification." icon="users" /></GlassCard>
      )}
    </div>
  );
}
