"use client";

import TripRequestForm from '@/components/forms/TripRequestForm';
import { getCurrentFamilyTripRequest, getTripRequestTravelers, updateTripRequest } from '@/actions/trip-requests';
import { useAppAuth } from '@/lib/auth/provider';
import type { TripRequestDTO, TripRequestInput, TripTravelerOption } from '@/lib/trip-request-types';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/app/ui';

export default function EditTripRequestPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();
  if (!isLoaded) return <LoadingState label="Loading trip request details..." />;
  if (!session || session.user.role !== 'family') {
    return <ErrorState title="Trip request is unavailable" message={!session ? 'Please sign in to edit this trip request.' : 'Trip requests are only available to family users.'} action={<SecondaryButton href="/">Back to Home</SecondaryButton>} />;
  }
  return <EditTripRequestContent key={`${session.user.id}:${id}`} id={id} />;
}

function EditTripRequestContent({ id }: { id: string }) {
  const [tripRequest, setTripRequest] = useState<TripRequestDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [travelers, setTravelers] = useState<TripTravelerOption[]>([]);
  const active = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let current = true;
    active.current = true;
    void (async () => {
      try {
        const [requestResult, travelerResult] = await Promise.all([
          getCurrentFamilyTripRequest(id),
          getTripRequestTravelers()
        ]);
        if (!current) return;
        if (!requestResult.success) setLoadError(requestResult.error);
        else if (!travelerResult.success) setLoadError(travelerResult.error);
        else {
          setTripRequest(requestResult.request);
          setTravelers(travelerResult.travelers);
        }
      } catch {
        if (current) setLoadError('Failed to load trip request details. Please try again.');
      } finally {
        if (current) setIsLoading(false);
      }
    })();
    return () => { current = false; active.current = false; };
  }, [id]);

  const handleSubmit = async (formData: TripRequestInput) => {
    if (isSaving || !active.current) return;
    setError(null);
    setIsSaving(true);
    try {
      const result = await updateTripRequest(id, formData);
      if (!active.current) return;
      if (result.success) router.push(`/dashboard/family/trip-requests/${result.request.id}`);
      else setError(result.error);
    } catch {
      if (active.current) setError('Failed to update trip request. Please try again.');
    } finally {
      if (active.current) setIsSaving(false);
    }
  };

  if (isLoading) {
    return <LoadingState label="Loading trip request details..." />;
  }

  if (loadError) {
    return <ErrorState title="Unable to load trip request" message={loadError} action={<SecondaryButton href={`/dashboard/family/trip-requests/${id}`}>Back to Trip Request</SecondaryButton>} />;
  }

  if (!tripRequest) {
    return <EmptyState title="Trip request not found" description="Return to your requests to choose a journey." action={<SecondaryButton href="/dashboard/family/trip-requests">Back to Trip Requests</SecondaryButton>} />;
  }

  // Only allow editing draft or searching requests
  if (tripRequest.status !== 'draft' && tripRequest.status !== 'searching') {
    return <ErrorState title="This request is no longer editable" message={`This trip request cannot be edited in its current status (${formatStatus(tripRequest.status)}).`} action={<SecondaryButton href={`/dashboard/family/trip-requests/${id}`}>Back to Trip Request</SecondaryButton>} />;
  }

  return (
    <div className="tb-page">
      <PageHeader title="Edit Trip Request" eyebrow="Refine your journey" description="Update the traveler, route and assistance preferences for this request." backHref={`/dashboard/family/trip-requests/${id}`} backLabel="Back to Trip Request" />
      <GlassCard className="tb-stack w-full max-w-4xl">
        <SectionHeader title="Journey details" description="Required fields are marked with an asterisk." actions={<StatusBadge status={tripRequest.status}>{formatStatus(tripRequest.status)}</StatusBadge>} />
        {error && <Feedback tone="danger">{error}</Feedback>}
        {travelers.length > 0 ? (
          <TripRequestForm key={tripRequest.id} initialData={tripRequest} onSubmit={handleSubmit} travelers={travelers} isLoading={isSaving} />
        ) : (
          <EmptyState title="Add a traveler to continue" description="No travelers found. Please add a traveler before editing this trip request." icon="user" action={<PrimaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</PrimaryButton>} />
        )}
      </GlassCard>
    </div>
  );
}

// Helper functions for status badges
function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
