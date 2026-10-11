"use client";

import { getCurrentFamilyTripRequest } from '@/actions/trip-requests';
import { useAppAuth } from '@/lib/auth/provider';
import type { TripRequestDTO } from '@/lib/trip-request-types';
import { use, useEffect, useState } from 'react';
import { Avatar, EmptyState, ErrorState, Feedback, GlassCard, Icon, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge, Timeline } from '@/components/app/ui';

export default function TripRequestDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();
  if (!isLoaded) return <LoadingState label="Loading trip request details..." />;
  if (!session || session.user.role !== 'family') {
    return <ErrorState title="Trip request is unavailable" message={!session ? 'Please sign in to view this trip request.' : 'Trip requests are only available to family users.'} action={<SecondaryButton href="/">Back to Home</SecondaryButton>} />;
  }
  return <TripRequestDetailContent key={`${session.user.id}:${id}`} id={id} />;
}

function TripRequestDetailContent({ id }: { id: string }) {
  const [tripRequest, setTripRequest] = useState<TripRequestDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getCurrentFamilyTripRequest(id);
        if (!active) return;
        if (result.success) setTripRequest(result.request);
        else setError(result.error);
      } catch {
        if (active) setError('Failed to load trip request details. Please try again.');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (isLoading) {
    return <LoadingState label="Loading trip request details..." />;
  }

  if (error) {
    return <ErrorState title="Unable to load trip request" message={error} action={<SecondaryButton href="/dashboard/family/trip-requests">Back to Trip Requests</SecondaryButton>} />;
  }

  if (!tripRequest) {
    return <EmptyState title="Trip request not found" description="Return to your requests to choose a journey." action={<SecondaryButton href="/dashboard/family/trip-requests">Back to Trip Requests</SecondaryButton>} />;
  }

  const stages = [
    { status: 'draft', label: 'Draft request' },
    { status: 'searching', label: 'Searching for companions' },
    { status: 'matched', label: 'Companion matched' },
    { status: 'booked', label: 'Booking created' },
    { status: 'in_progress', label: 'Travel in progress' },
    { status: 'completed', label: 'Journey complete' },
  ];
  const currentStage = stages.findIndex(stage => stage.status === tripRequest.status);

  return (
    <div className="tb-page">
      <PageHeader title="Trip Request Details" eyebrow="Your journey" description="Travel details, assistance needs and the current request status, together in one place." backHref="/dashboard/family/trip-requests" backLabel="Back to Trip Requests" actions={<>
        {(tripRequest.status === 'draft' || tripRequest.status === 'searching') && <SecondaryButton href={`/dashboard/family/trip-requests/${id}/edit`} icon="edit">Edit Request</SecondaryButton>}
        <PrimaryButton href={`/dashboard/family/trip-requests/${id}/matches`} icon="users">View Matches</PrimaryButton>
      </>} />
      <GlassCard tone="accent" className="tb-stack">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={`${tripRequest.elderly_travelers.first_name} ${tripRequest.elderly_travelers.last_name}`} />
            <div className="tb-min-zero"><p className="tb-muted tb-small">Traveler</p><h2 className="text-lg font-semibold">{tripRequest.elderly_travelers.first_name} {tripRequest.elderly_travelers.last_name}</h2></div>
          </div>
          <StatusBadge status={tripRequest.status}>{formatStatus(tripRequest.status)}</StatusBadge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-6" aria-label={`Route: ${tripRequest.origin_airport.toUpperCase()} to ${tripRequest.destination_airport.toUpperCase()}`}>
          <div><p className="tb-muted tb-small">Origin airport</p><p className="font-mono text-3xl font-semibold">{tripRequest.origin_airport.toUpperCase()}</p></div>
          <span className="text-[#25e0ff]" aria-hidden="true"><Icon name="plane" size={26} /></span>
          <div><p className="tb-muted tb-small">Destination airport</p><p className="font-mono text-3xl font-semibold">{tripRequest.destination_airport.toUpperCase()}</p></div>
        </div>
        <dl className="tb-details">
          <div><dt>Departure</dt><dd>{new Date(tripRequest.departure_date).toLocaleDateString()}</dd></div>
          <div><dt>Return</dt><dd>{tripRequest.return_date ? new Date(tripRequest.return_date).toLocaleDateString() : 'One-way'}</dd></div>
        </dl>
      </GlassCard>
      <div className="tb-grid">
        <div className="tb-stack">
          <GlassCard>
            <SectionHeader title="Traveler Information" icon="user" />
            <dl className="tb-details">
              <div><dt>Name</dt><dd>{tripRequest.elderly_travelers.first_name} {tripRequest.elderly_travelers.last_name}</dd></div>
              <div><dt>Traveler Details</dt><dd><SecondaryButton href={`/dashboard/family/travelers/${tripRequest.elderly_travelers.id}`} icon="arrow">View Traveler</SecondaryButton></dd></div>
            </dl>
            <hr className="tb-divider" />
            <SectionHeader title="Trip Details" />
            <dl className="tb-details">
              <div className="col-span-2"><dt>Route</dt><dd>{tripRequest.origin_airport.toUpperCase()} → {tripRequest.destination_airport.toUpperCase()}</dd></div>
              <div><dt>Assistance Level</dt><dd className="capitalize">{tripRequest.assistance_level}</dd></div>
              <div><dt>Language Requirements</dt><dd>{tripRequest.language_requirements.length > 0 ? tripRequest.language_requirements.join(', ') : 'None specified'}</dd></div>
            </dl>
            {tripRequest.special_instructions && <><hr className="tb-divider" /><SectionHeader title="Special Instructions" /><p className="tb-small tb-min-zero whitespace-pre-line leading-7">{tripRequest.special_instructions}</p></>}
          </GlassCard>
          <GlassCard>
            <SectionHeader title="Request Information" icon="document" />
            <dl className="tb-details">
              <div className="col-span-2"><dt>Trip Request ID</dt><dd className="font-mono">{tripRequest.id}</dd></div>
              <div><dt>Created</dt><dd>{new Date(tripRequest.created_at).toLocaleString()}</dd></div>
              <div><dt>Updated</dt><dd>{new Date(tripRequest.updated_at).toLocaleString()}</dd></div>
            </dl>
          </GlassCard>
        </div>
        <GlassCard className="self-start">
          <SectionHeader title="Request progress" description="Based on the request's current status." icon="plane" />
          {currentStage >= 0 ? <Timeline steps={stages.map((stage, index) => ({ label: stage.label, status: index < currentStage || tripRequest.status === 'completed' ? 'completed' : index === currentStage ? 'current' : 'upcoming' }))} /> : <Feedback tone={tripRequest.status === 'cancelled' ? 'danger' : 'warning'}>This request is {formatStatus(tripRequest.status).toLowerCase()}.</Feedback>}
        </GlassCard>
      </div>
    </div>
  );
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
