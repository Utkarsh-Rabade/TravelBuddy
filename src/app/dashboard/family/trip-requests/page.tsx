"use client";

import { getCurrentFamilyTripRequests } from '@/actions/trip-requests';
import { useAppAuth } from '@/lib/auth/provider';
import type { TripRequestDTO } from '@/lib/trip-request-types';
import { useEffect, useState } from 'react';
import { Avatar, EmptyState, ErrorState, GlassCard, Icon, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/app/ui';

export default function TripRequestsPage() {
  const { isLoaded, session } = useAppAuth();
  if (!isLoaded) return <LoadingState label="Loading trip requests..." />;
  if (!session || session.user.role !== 'family') {
    return <ErrorState title="Trip requests are unavailable" message={!session ? 'Please sign in to manage trip requests.' : 'Trip requests are only available to family users.'} action={<SecondaryButton href="/">Back to Home</SecondaryButton>} />;
  }
  return <TripRequestsContent key={session.user.id} />;
}

function TripRequestsContent() {
  const [tripRequests, setTripRequests] = useState<TripRequestDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getCurrentFamilyTripRequests();
        if (!active) return;
        if (result.success) setTripRequests(result.requests);
        else setError(result.error);
      } catch {
        if (active) setError('Failed to load trip requests. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <LoadingState label="Loading trip requests..." />;
  }

  if (error) {
    return <ErrorState title="Unable to load trip requests" message={error} action={<SecondaryButton href="/dashboard/family">Back to Dashboard</SecondaryButton>} />;
  }

  return (
    <div className="tb-page">
      <PageHeader title="Trip Requests" eyebrow="For your family" description="A clear view of each journey, from your first request to a companion booking." backHref="/dashboard/family" backLabel="Dashboard" actions={<PrimaryButton href="/dashboard/family/trip-requests/new" icon="plus">New Request</PrimaryButton>} />
      {tripRequests.length > 0 ? (
        <section aria-labelledby="requests-heading">
          <SectionHeader id="requests-heading" title={`Trip Requests (${tripRequests.length})`} description="View and manage your trip requests." />
          <div className="tb-grid">
            {tripRequests.map((request) => (
              <GlassCard key={request.id} className="tb-stack">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={`${request.elderly_travelers.first_name} ${request.elderly_travelers.last_name}`} />
                    <div className="tb-min-zero">
                      <p className="tb-muted tb-small">Traveler</p>
                      <h3 className="font-semibold">{request.elderly_travelers.first_name} {request.elderly_travelers.last_name}</h3>
                    </div>
                  </div>
                  <StatusBadge status={request.status}>{formatStatus(request.status)}</StatusBadge>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-5" aria-label={`Route: ${request.origin_airport.toUpperCase()} to ${request.destination_airport.toUpperCase()}`}>
                  <div><p className="tb-muted tb-small">From</p><p className="font-mono text-2xl font-semibold">{request.origin_airport.toUpperCase()}</p></div>
                  <span className="text-[#25e0ff]" aria-hidden="true"><Icon name="plane" /></span>
                  <div><p className="tb-muted tb-small">To</p><p className="font-mono text-2xl font-semibold">{request.destination_airport.toUpperCase()}</p></div>
                </div>
                <dl className="tb-details">
                  <div><dt>Departure</dt><dd>{new Date(request.departure_date).toLocaleDateString()}</dd></div>
                  <div><dt>Return</dt><dd>{request.return_date ? new Date(request.return_date).toLocaleDateString() : 'One-way'}</dd></div>
                  <div><dt>Assistance</dt><dd className="capitalize">{request.assistance_level}</dd></div>
                  <div><dt>Languages</dt><dd>{request.language_requirements.join(', ') || 'None specified'}</dd></div>
                </dl>
                <div className="tb-form-actions">
                  <SecondaryButton href={`/dashboard/family/trip-requests/${request.id}`} icon="arrow">View Details</SecondaryButton>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>
      ) : (
        <GlassCard><EmptyState title="Your next journey starts here" description="No trip requests found. Create your first trip request to get started." action={<PrimaryButton href="/dashboard/family/trip-requests/new" icon="plus">Create Trip Request</PrimaryButton>} /></GlassCard>
      )}
    </div>
  );
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
