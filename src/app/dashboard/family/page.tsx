'use client';

import { getFamilyForCurrentUser } from '@/actions/family';
import { getCurrentFamilyTripRequests } from '@/actions/trip-requests';
import { EmptyState, ErrorState, GlassCard, LoadingState, PageHeader, PrimaryButton, ProfileCard, SecondaryButton, SectionHeader, StatCard, StatusBadge, Timeline } from '@/components/app/ui';
import { useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { FamilyLookupResult, FamilyRecord, FamilyTravelerSummary } from '@/actions/family';
import type { TripRequestDTO } from '@/lib/trip-request-types';

export default function FamilyDashboard() {
  const { isLoaded, session } = useAppAuth();
  const router = useRouter();
  const [family, setFamily] = useState<FamilyRecord | null>(null);
  const [elderlyTravelers, setElderlyTravelers] = useState<FamilyTravelerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<TripRequestDTO[] | null>(null);
  const [journeysLoading, setJourneysLoading] = useState(true);
  const [journeysError, setJourneysError] = useState<string | null>(null);

  const loadFamilyData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result: FamilyLookupResult = await getFamilyForCurrentUser();
      if (!result.success) {
        setFamily(null);
        setElderlyTravelers([]);
        setError(result.error);
      } else {
        setFamily(result.family);
        setElderlyTravelers(result.travelers);
      }
    } catch {
      setError('We couldn’t load your family profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!session) {
      setLoading(false);
      return;
    }
    void loadFamilyData();
  }, [isLoaded, loadFamilyData, session]);

  const loadJourneyData = useCallback(async () => {
    setJourneysLoading(true);
    setJourneysError(null);
    setRequests(null);
    try {
      const result = await getCurrentFamilyTripRequests();
      if (result.success) setRequests(result.requests);
      else setJourneysError(result.error);
    } catch {
      setJourneysError('Unable to load trip request summaries. Please try again.');
    } finally {
      setJourneysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (family?.id && session?.user.role === 'family') void loadJourneyData();
  }, [family?.id, loadJourneyData, session]);

  if (!isLoaded || loading) {
    return <LoadingState label="Loading family dashboard..." />;
  }

  if (!session) {
    return <GlassCard><EmptyState title="Welcome to your family dashboard" description="Sign in to your family account first." icon="home" action={<PrimaryButton href="/auth/sign-in">Open sign in</PrimaryButton>} /></GlassCard>;
  }

  if (session.user.role !== 'family') {
    return <GlassCard><ErrorState message="This dashboard is only available to family users." /></GlassCard>;
  }

  if (error) {
    return <GlassCard><ErrorState message={error} action={<PrimaryButton onClick={() => void loadFamilyData()} icon="refresh">Retry</PrimaryButton>} /></GlassCard>;
  }

  if (!family) {
    return (
      <div className="tb-page">
        <PageHeader title="TravelBuddy Dashboard" eyebrow="Your family, thoughtfully connected" description={`Welcome${session.user.firstName ? `, ${session.user.firstName}` : ''}. Start with a family profile, then add the people you’re planning a journey for.`} />
        <GlassCard tone="accent"><EmptyState title="A home for your family’s journeys" description="No family found. Please create a family first." icon="home" action={<PrimaryButton href="/dashboard/family/create" icon="plus">Create Family</PrimaryButton>} /></GlassCard>
      </div>
    );
  }

  const activeRequests = requests?.filter(request => ['draft', 'searching', 'matched'].includes(request.status)) ?? [];
  const upcomingBookings = requests?.filter(request => request.status === 'booked') ?? [];
  const matchingRequests = requests?.filter(request => ['searching', 'matched'].includes(request.status)) ?? [];
  const matchesHref = matchingRequests[0] ? `/dashboard/family/trip-requests/${matchingRequests[0].id}/matches` : '/dashboard/family/trip-requests';
  const journeyStatDescription = journeysLoading ? 'Loading your saved requests…' : journeysError ? 'Summary unavailable' : undefined;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="tb-page">
      <PageHeader
        title={`${greeting}, ${session.user.firstName || family.name}`}
        eyebrow="Your family, thoughtfully connected"
        description={<>TravelBuddy Dashboard · A clear view of your travelers and the journeys you’re planning.</>}
        actions={<><SecondaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</SecondaryButton><PrimaryButton href="/dashboard/family/trip-requests/new" icon="plane">Create Trip</PrimaryButton></>}
      />
      <div className="tb-stats-grid">
        <StatCard label="Traveler profiles" value={elderlyTravelers.length} description="Saved in your family" icon="users" />
        <StatCard label="Trip requests" value={requests?.length ?? '—'} description={journeyStatDescription ?? 'All saved requests'} icon="document" />
        <StatCard label="Upcoming bookings" value={requests ? upcomingBookings.length : '—'} description={journeyStatDescription ?? 'Requests with a booked status'} icon="calendar" />
        <StatCard label="Matching requests" value={requests ? matchingRequests.length : '—'} description={journeyStatDescription ?? 'Searching or matched requests'} icon="plane" />
      </div>
      <GlassCard tone="accent">
        <SectionHeader id="family-profile" title="Family Profile" description="Your shared starting point for every journey." icon="home" actions={<><SecondaryButton href="/dashboard/family/edit" icon="edit">Edit Family</SecondaryButton><SecondaryButton onClick={() => router.refresh()} icon="refresh">Reload data</SecondaryButton></>} />
        <dl className="tb-details">
          <div><dt>Family Name</dt><dd>{family.name}</dd></div>
          <div><dt>Members</dt><dd>{elderlyTravelers.length} {elderlyTravelers.length === 1 ? 'traveler' : 'travelers'}</dd></div>
          <div><dt>Created</dt><dd>{new Date(family.created_at).toLocaleDateString()}</dd></div>
        </dl>
      </GlassCard>
      <section aria-labelledby="family-travelers">
        <SectionHeader id="family-travelers" title="Elderly Travelers" description="The people at the heart of your plans." icon="users" actions={<SecondaryButton href="/dashboard/family/travelers" icon="arrow">View Travelers</SecondaryButton>} />
        {elderlyTravelers.length === 0 ? (
          <GlassCard><EmptyState title="No travelers added yet." description="Add a traveler’s profile so you can plan around their needs and preferences." icon="users" action={<PrimaryButton href="/dashboard/family/travelers/new" icon="plus">Add Traveler</PrimaryButton>} /></GlassCard>
        ) : (
          <div className="tb-grid-3">
            {elderlyTravelers.slice(0, 3).map(traveler => (
              <ProfileCard
                key={traveler.id}
                name={`${traveler.first_name} ${traveler.last_name}`}
                subtitle="Family traveler"
                status="Profile saved"
                actions={<><SecondaryButton href={`/dashboard/family/travelers/${traveler.id}`} icon="user">View Profile</SecondaryButton><SecondaryButton href={`/dashboard/family/travelers/${traveler.id}/edit`} icon="edit">Edit</SecondaryButton></>}
              >
                <hr className="tb-divider" />
                <dl className="tb-details"><div><dt>Date of Birth</dt><dd>{traveler.date_of_birth ? new Date(traveler.date_of_birth).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Not specified'}</dd></div></dl>
              </ProfileCard>
            ))}
          </div>
        )}
      </section>
      <div className="tb-grid">
        <GlassCard>
          <SectionHeader title="Trip requests" description="Drafts and requests still taking shape." icon="document" actions={<a className="tb-link" href="/dashboard/family/trip-requests">View Trip Requests</a>} />
          {journeysLoading ? <LoadingState label="Loading trip requests..." /> : journeysError ? <ErrorState message={journeysError} onRetry={() => void loadJourneyData()} /> : activeRequests.length === 0 ? (
            <EmptyState title="No active trip requests" description="Choose a traveler, route and dates to begin your next journey." icon="plane" action={<PrimaryButton href="/dashboard/family/trip-requests/new" icon="plus">Create Trip Request</PrimaryButton>} />
          ) : (
            <div className="tb-stack">
              {activeRequests.slice(0, 3).map(request => (
                <div key={request.id} className="tb-stack">
                  <div className="tb-actions"><StatusBadge status={request.status} /><a className="tb-link" href={`/dashboard/family/trip-requests/${request.id}`}>{request.origin_airport} → {request.destination_airport}</a></div>
                  <p className="tb-muted tb-small">{request.elderly_travelers.first_name} {request.elderly_travelers.last_name} · {new Date(request.departure_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}</p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard>
          <SectionHeader title="Upcoming journeys" description="Trip requests with a confirmed booked status." icon="calendar" />
          {journeysLoading ? <LoadingState label="Loading upcoming journeys..." /> : journeysError ? <ErrorState message="Upcoming journey summaries are unavailable until trip requests can be loaded." action={<SecondaryButton href="/dashboard/family/trip-requests">View Trip Requests</SecondaryButton>} /> : upcomingBookings.length === 0 ? (
            <EmptyState title="No upcoming booked trips" description="Your booked requests will appear here once a companion booking is confirmed." icon="calendar" action={<SecondaryButton href="/dashboard/family/trip-requests">Review Trip Requests</SecondaryButton>} />
          ) : (
            <div className="tb-stack">
              {upcomingBookings.slice(0, 3).map(request => (
                <div key={request.id} className="tb-stack">
                  <div className="tb-actions"><StatusBadge status={request.status} /><a className="tb-link" href={`/dashboard/family/trip-requests/${request.id}`}>{request.origin_airport} → {request.destination_airport}</a></div>
                  <p className="tb-muted tb-small">{request.elderly_travelers.first_name} {request.elderly_travelers.last_name} · {new Date(request.departure_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}</p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard tone="accent">
          <SectionHeader title="Companion matches" description="Explore companion options for a specific trip request." icon="users" actions={<SecondaryButton href={matchesHref} icon="arrow">View Matches</SecondaryButton>} />
          {journeysLoading ? <LoadingState label="Preparing your matching requests..." /> : journeysError ? <ErrorState message="Choose a trip request to review its companion matches." action={<SecondaryButton href="/dashboard/family/trip-requests">View Trip Requests</SecondaryButton>} /> : matchingRequests.length === 0 ? (
            <EmptyState title="Your next connection starts with a trip" description="Create a trip request, then start matching from its details page. Companion matches are shown for each request." icon="users" action={<PrimaryButton href="/dashboard/family/trip-requests/new" icon="plane">Create Trip</PrimaryButton>} />
          ) : (
            <div className="tb-stack">
              {matchingRequests.slice(0, 3).map(request => (
                <div key={request.id} className="tb-stack">
                  <div className="tb-actions"><StatusBadge status={request.status} /><span>{request.origin_airport} → {request.destination_airport}</span></div>
                  <a className="tb-link" href={`/dashboard/family/trip-requests/${request.id}/matches`}>View Matches for {request.elderly_travelers.first_name}</a>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard tone="info">
          <SectionHeader title="Safety preparation" description="Small details to review before every journey." icon="shield" />
          <Timeline steps={[
            { label: 'Review traveler profiles', description: 'Confirm personal details and any assistance needs.', status: 'current' },
            { label: 'Check emergency contacts', description: 'Keep a reachable primary contact on each traveler’s profile.', status: 'upcoming' },
            { label: 'Plan journey-specific support', description: 'Record assistance, language and other instructions in your trip request.', status: 'upcoming' },
          ]} />
          <SecondaryButton href="/dashboard/family/travelers" icon="shield">Review Traveler Details</SecondaryButton>
        </GlassCard>
      </div>
    </div>
  );
}
