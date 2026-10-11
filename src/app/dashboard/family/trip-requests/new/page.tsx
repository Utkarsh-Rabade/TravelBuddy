"use client";

import TripRequestForm from '@/components/forms/TripRequestForm';
import { createTripRequest, getTripRequestTravelers } from '@/actions/trip-requests';
import { useAppAuth } from '@/lib/auth/provider';
import type { TripRequestInput, TripTravelerOption } from '@/lib/trip-request-types';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StepIndicator } from '@/components/app/ui';

export default function NewTripRequestPage() {
  const { isLoaded, session } = useAppAuth();
  if (!isLoaded) return <LoadingState label="Loading traveler data..." />;
  if (!session || session.user.role !== 'family') {
    return <ErrorState title="Trip requests are unavailable" message={!session ? 'Please sign in to create a trip request.' : 'Trip requests are only available to family users.'} action={<SecondaryButton href="/">Back to Home</SecondaryButton>} />;
  }
  return <NewTripRequestContent key={session.user.id} />;
}

function NewTripRequestContent() {
  const [travelers, setTravelers] = useState<TripTravelerOption[]>([]);
  const [loadingTravelers, setLoadingTravelers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionId = useRef<string | null>(null);
  const active = useRef(false);
  const router = useRouter();

  useEffect(() => {
    let current = true;
    active.current = true;
    void (async () => {
      try {
        const result = await getTripRequestTravelers();
        if (!current) return;
        if (result.success) setTravelers(result.travelers);
        else setLoadError(result.error);
      } catch {
        if (current) setLoadError('Failed to load traveler data. Please try again.');
      } finally {
        if (current) setLoadingTravelers(false);
      }
    })();
    return () => { current = false; active.current = false; };
  }, []);

  const handleSubmit = async (formData: TripRequestInput) => {
    if (isLoading || !active.current) return;
    setError(null);
    setIsLoading(true);
    try {
      submissionId.current ??= crypto.randomUUID();
      const result = await createTripRequest(formData, submissionId.current);
      if (!active.current) return;
      if (result.success) router.push(`/dashboard/family/trip-requests/${result.request.id}`);
      else setError(result.error);
    } catch {
      if (active.current) setError('Failed to create trip request. Please try again.');
    } finally {
      if (active.current) setIsLoading(false);
    }
  };

  return (
    <div className="tb-page">
      <PageHeader title="New Trip Request" eyebrow="Plan a supported journey" description="Tell us who is traveling, where they're going and the assistance they need." backHref="/dashboard/family/trip-requests" backLabel="Back to Requests" />
      <GlassCard className="tb-stack w-full max-w-4xl">
        <StepIndicator steps={['Trip request', 'Companion matches', 'Booking']} currentStep={0} />
        <hr className="tb-divider" />
        {error && <Feedback tone="danger">{error}</Feedback>}
        {loadingTravelers ? <LoadingState label="Loading traveler data..." /> : loadError ? (
          <ErrorState title="Unable to load travelers" message={loadError} action={<SecondaryButton href="/dashboard/family">Back to Dashboard</SecondaryButton>} />
        ) : travelers.length > 0 ? (
          <>
            <SectionHeader title="Journey details" description="Required fields are marked with an asterisk." />
            <TripRequestForm key="new-request" onSubmit={handleSubmit} travelers={travelers} isLoading={isLoading} />
          </>
        ) : (
          <EmptyState title="Add a traveler to begin" description="No travelers found. Please add a traveler first before creating a trip request." icon="user" action={<PrimaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</PrimaryButton>} />
        )}
      </GlassCard>
    </div>
  );
}
