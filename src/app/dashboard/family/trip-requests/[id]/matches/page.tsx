"use client";

import {
  findMatchingCompanionsAction,
  getMatchAttemptsAction,
  updateMatchStatusAction,
} from '@/actions/match-companions';
import * as bookingActions from '@/actions/bookings';
import { getCurrentFamilyTripRequest } from '@/actions/trip-requests';
import MatchResultCard from '@/components/ui/MatchResultCard';
import { useAppAuth } from '@/lib/auth/provider';
import type { TripRequestDTO } from '@/lib/trip-request-types';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, Feedback, GlassCard, Icon, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge, StepIndicator } from '@/components/app/ui';

type RecordValue = Record<string, unknown>;
type MatchStatus = 'pending' | 'accepted' | 'rejected';

type CompanionSummary = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  languages_spoken: string[];
  verification_status: string | null;
  rating_average: number | null;
  total_trips: number | null;
  availability_summary?: string;
};

type MatchResult = {
  companion: CompanionSummary;
  score: number;
  explanation: string;
  explanationLimitations?: string;
  matchAttemptId: string;
  status: MatchStatus;
  bookingId?: string;
  bookingReference?: string;
};

type MatchAttempt = MatchResult & {
  attemptedAt: string | null;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function availabilitySummary(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value)) return undefined;

  const days = Object.entries(value).flatMap(([day, ranges]) => {
    if (!Array.isArray(ranges)) return [];
    const formattedRanges = ranges.flatMap((range) => {
      if (!isRecord(range)) return [];
      const start = textValue(range.start);
      const end = textValue(range.end);
      return start && end ? [`${start} - ${end}`] : [];
    });
    return formattedRanges.length ? [`${day}: ${formattedRanges.join(', ')}`] : [];
  });

  return days.length ? days.join('; ') : undefined;
}

function normalizeCompanion(value: unknown): CompanionSummary | null {
  if (!isRecord(value)) return null;
  const id = textValue(value.id);
  const firstName = textValue(value.first_name);
  const lastName = textValue(value.last_name);
  if (!id || !firstName || !lastName) return null;

  const languages = Array.isArray(value.languages_spoken)
    ? value.languages_spoken.filter((language): language is string => typeof language === 'string')
    : [];
  const availability = availabilitySummary(
    value.availability_calendar ?? value.availability ?? value.availability_summary,
  );

  return {
    id,
    first_name: firstName,
    last_name: lastName,
    date_of_birth: textValue(value.date_of_birth),
    languages_spoken: languages,
    verification_status: textValue(value.verification_status),
    rating_average: numberValue(value.rating_average),
    total_trips: numberValue(value.total_trips),
    ...(availability ? { availability_summary: availability } : {}),
  };
}

function normalizeStatus(value: unknown): MatchStatus {
  return value === 'accepted' || value === 'rejected' ? value : 'pending';
}

function explanationLimitations(value: RecordValue): string | undefined {
  const limitation = value.explanation_limitations ?? value.engine_explanation_limitations ?? value.limitations;
  if (typeof limitation === 'string' && limitation.trim()) return limitation;
  if (Array.isArray(limitation)) {
    const values = limitation.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
    return values.length ? values.join(' ') : undefined;
  }
  return undefined;
}

function normalizeMatch(value: unknown): MatchResult | null {
  if (!isRecord(value)) return null;
  const companion = normalizeCompanion(value.companion);
  const matchAttemptId = textValue(value.matchAttemptId ?? value.id);
  const score = numberValue(value.score ?? value.match_score);
  if (!companion || !matchAttemptId || score === null) return null;

  const explanation = textValue(value.explanation) ?? 'No match explanation was supplied.';
  const limitations = explanationLimitations(value);
  const booking = isRecord(value.booking) ? value.booking : null;
  const bookingId = textValue(value.booking_id ?? value.bookingId ?? booking?.id);
  const bookingReference = textValue(
    value.booking_reference ?? value.bookingReference ?? booking?.booking_reference ?? booking?.bookingReference,
  );
  return {
    companion,
    score,
    explanation,
    ...(limitations ? { explanationLimitations: limitations } : {}),
    matchAttemptId,
    status: normalizeStatus(value.status),
    ...(bookingId ? { bookingId } : {}),
    ...(bookingReference ? { bookingReference } : {}),
  };
}

function normalizeAttempt(value: unknown): MatchAttempt | null {
  if (!isRecord(value)) return null;
  const match = normalizeMatch({
    ...value,
    companion: value.companion ?? value.companions,
    matchAttemptId: value.id,
    score: value.match_score,
  });
  if (!match) return null;
  return {
    ...match,
    attemptedAt: textValue(value.match_attempted_at),
  };
}

type BookingAction = (...args: unknown[]) => Promise<unknown>;

function actionByName(...names: string[]): BookingAction | null {
  const actions = bookingActions as unknown as Record<string, unknown>;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name] as BookingAction;
  }
  return null;
}

function bookingIdFromResult(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const booking = isRecord(value.booking) ? value.booking : value;
  return textValue(booking.id ?? value.booking_id ?? value.bookingId);
}

function bookingIdsFromResult(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const values = Array.isArray(value.bookings) ? value.bookings : [];
  return values.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id ?? item.booking_id ?? item.bookingId);
    return id ? [id] : [];
  });
}

async function deterministicBookingId(matchAttemptId: string): Promise<string | null> {
  if (typeof globalThis.crypto?.subtle === 'undefined') return null;
  const bytes = new TextEncoder().encode(`booking:${matchAttemptId.toLowerCase()}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function actionError(value: unknown, fallback: string): string | null {
  if (!isRecord(value)) return fallback;
  if (value.success === false && typeof value.error === 'string') return value.error;
  return null;
}

function sortMatches(matches: MatchResult[]): MatchResult[] {
  return [...matches].sort((left, right) =>
    right.score - left.score || left.companion.id.localeCompare(right.companion.id),
  );
}

function sortAttempts(attempts: MatchAttempt[]): MatchAttempt[] {
  return [...attempts].sort((left, right) => {
    const scoreOrder = right.score - left.score;
    if (scoreOrder !== 0) return scoreOrder;
    const dateOrder = (right.attemptedAt ?? '').localeCompare(left.attemptedAt ?? '');
    return dateOrder || left.matchAttemptId.localeCompare(right.matchAttemptId);
  });
}

function requestErrorMessage(result: { code?: string; error?: string }): string {
  if (result.code === 'NOT_FOUND' || result.code === 'FORBIDDEN' || result.code === 'INVALID_INPUT') {
    return 'Trip request not found or unavailable.';
  }
  return result.error ?? 'Failed to load trip request details.';
}

export default function TripRequestMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) {
    return <LoadingState label="Loading matching results..." />;
  }

  if (!session || session.user.role !== 'family') {
    return <ErrorState title="Matching results are unavailable" message={!session ? 'Please sign in to view matching results.' : 'Matching results are only available to family users.'} action={<SecondaryButton href="/">Back to Home</SecondaryButton>} />;
  }

  return <TripRequestMatchesContent key={`${session.user.id}:${id}`} id={id} />;
}

function TripRequestMatchesContent({ id }: { id: string }) {
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [matchAttempts, setMatchAttempts] = useState<MatchAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFindingMatches, setIsFindingMatches] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingBookingAttemptId, setPendingBookingAttemptId] = useState<string | null>(null);
  const [hasLoadedAttempts, setHasLoadedAttempts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tripRequest, setTripRequest] = useState<TripRequestDTO | null>(null);
  const mountedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const findingRef = useRef(false);
  const bookingCreationRef = useRef<string | null>(null);

  const loadOwnedState = useCallback(async (showLoading: boolean, clearMatches: boolean) => {
    const generation = ++loadGenerationRef.current;
    if (showLoading) {
      setIsLoading(true);
      setError(null);
      setTripRequest(null);
      setMatches([]);
      setMatchAttempts([]);
      setHasLoadedAttempts(false);
    } else {
      setHasLoadedAttempts(false);
      if (clearMatches) setMatches([]);
    }

    const isCurrent = () => mountedRef.current && generation === loadGenerationRef.current;

    try {
      const requestResult = await getCurrentFamilyTripRequest(id);
      if (!isCurrent()) return;
      if (!requestResult.success) {
        setError(requestErrorMessage(requestResult));
        return;
      }
      setTripRequest(requestResult.request);

      const attemptsResult = await getMatchAttemptsAction(id);
      if (!isCurrent()) return;
      if (!attemptsResult.success) {
        setError('Unable to load matching results. Please try again.');
        return;
      }
      const attempts = sortAttempts((attemptsResult.matchAttempts ?? [])
        .map(normalizeAttempt)
        .filter((attempt): attempt is MatchAttempt => attempt !== null));
      const lookup = actionByName('getBookingForMatchAttempt', 'getBookingByMatchAttempt');
      const tripLookup = actionByName('getBookingsForTripRequest', 'getBookingForTripRequest', 'getBookingByTripRequest');
      const getBooking = actionByName('getBooking');
      const attemptsWithBookings = lookup || tripLookup || getBooking
        ? await Promise.all(attempts.map(async (attempt) => {
          if (attempt.status !== 'accepted' || attempt.bookingId) return attempt;
          try {
            if (lookup) {
              const result = await lookup(attempt.matchAttemptId);
              const bookingId = bookingIdFromResult(result) ?? bookingIdsFromResult(result)[0];
              if (bookingId) return { ...attempt, bookingId };
            }
            if (tripLookup) {
              const result = await tripLookup(id);
              const bookingId = bookingIdFromResult(result) ?? bookingIdsFromResult(result)[0];
              if (bookingId) return { ...attempt, bookingId };
            }
            if (getBooking) {
              const deterministicId = await deterministicBookingId(attempt.matchAttemptId);
              if (deterministicId) {
                const result = await getBooking(deterministicId);
                if (!actionError(result, '') && bookingIdFromResult(result)) {
                  return { ...attempt, bookingId: deterministicId };
                }
              }
            }
          } catch {
            // The booking action remains authoritative; absence of an optional lookup
            // must not prevent match attempts from rendering.
          }
          return attempt;
        }))
        : attempts;
      if (!isCurrent()) return;
      setMatchAttempts(attemptsWithBookings);
      setHasLoadedAttempts(true);
    } catch {
      if (isCurrent()) setError('Unable to load matching results. Please try again.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    mountedRef.current = true;
    void loadOwnedState(true, false);
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, [loadOwnedState]);

  async function findMatches() {
    if (findingRef.current || isFindingMatches || pendingActionId !== null || pendingBookingAttemptId !== null || !tripRequest) return;
    findingRef.current = true;
    setIsFindingMatches(true);
    setError(null);

    try {
      const result = await findMatchingCompanionsAction(id);
      if (!mountedRef.current) return;
      if (!result.success) {
        setError(result.error || 'Failed to find matches.');
        return;
      }

      const rankedMatches = sortMatches(
        (result.matches ?? [])
          .map(normalizeMatch)
          .filter((match): match is MatchResult => match !== null),
      );
      setMatches(rankedMatches);
      await loadOwnedState(false, false);
    } catch {
      if (mountedRef.current) setError('An unexpected error occurred while finding matches.');
    } finally {
      findingRef.current = false;
      if (mountedRef.current) setIsFindingMatches(false);
    }
  }

  async function updateMatch(matchAttemptId: string, status: 'accepted' | 'rejected') {
    if (pendingActionId !== null || pendingBookingAttemptId !== null || !matchAttemptId) return;
    setPendingActionId(matchAttemptId);
    setError(null);

    try {
      const result = await updateMatchStatusAction(matchAttemptId, status);
      if (!mountedRef.current) return;
      if (!result.success) {
        setError(result.error || `Failed to ${status === 'accepted' ? 'accept' : 'reject'} match.`);
        return;
      }
      await loadOwnedState(false, true);
    } catch {
      if (mountedRef.current) setError(`Failed to ${status === 'accepted' ? 'accept' : 'reject'} match.`);
    } finally {
      if (mountedRef.current) setPendingActionId(null);
    }
  }

  async function createBooking(attempt: MatchAttempt) {
    if (bookingCreationRef.current !== null || pendingBookingAttemptId !== null || pendingActionId !== null || attempt.status !== 'accepted') return;
    if (attempt.bookingId) {
      window.location.assign(`/dashboard/bookings/${attempt.bookingId}`);
      return;
    }

    const create = actionByName('createBookingFromAcceptedMatch', 'createBookingForAcceptedMatch', 'createBooking');
    if (!create) {
      setError('Booking creation is unavailable. Please try again later.');
      return;
    }
    bookingCreationRef.current = attempt.matchAttemptId;
    setPendingBookingAttemptId(attempt.matchAttemptId);
    setError(null);
    try {
      const result = await create(attempt.matchAttemptId);
      if (!mountedRef.current) return;
      const resultError = actionError(result, 'Unable to create the booking.');
      if (resultError) {
        setError(resultError);
        return;
      }
      const bookingId = bookingIdFromResult(result);
      if (!bookingId) {
        setError('Booking was created, but its details could not be loaded. Reload and try again.');
        return;
      }
      window.location.assign(`/dashboard/bookings/${bookingId}`);
    } catch {
      if (mountedRef.current) setError('Unable to create the booking. Please try again.');
    } finally {
      bookingCreationRef.current = null;
      if (mountedRef.current) setPendingBookingAttemptId(null);
    }
  }

  if (isLoading) {
    return <LoadingState label="Loading trip request..." />;
  }

  if (!tripRequest) {
    return <ErrorState title="Trip request is unavailable" message={error ?? 'Trip request not found or unavailable.'} action={<SecondaryButton href="/dashboard/family/trip-requests">Back to Trip Requests</SecondaryButton>} />;
  }

  return (
    <div className="tb-page">
      <PageHeader title="Matching Results" eyebrow="Meet your travel companion" description="Review compatibility, profile details and the explanation before choosing a companion." backHref={`/dashboard/family/trip-requests/${id}`} backLabel="Back to Trip Request" />
      {error && <Feedback tone="danger">{error}</Feedback>}
      <GlassCard tone="accent" className="tb-stack">
        <SectionHeader title={<span className="tb-min-zero">Trip Request for {tripRequest.elderly_travelers.first_name} {tripRequest.elderly_travelers.last_name}</span>} actions={<StatusBadge status={tripRequest.status} />} />
        <div className="flex min-w-0 flex-wrap items-center gap-6" aria-label={`Route: ${tripRequest.origin_airport.toUpperCase()} to ${tripRequest.destination_airport.toUpperCase()}`}>
          <div><p className="tb-muted tb-small">Origin airport</p><p className="font-mono text-3xl font-semibold">{tripRequest.origin_airport.toUpperCase()}</p></div>
          <span className="text-[#25e0ff]" aria-hidden="true"><Icon name="plane" size={24} /></span>
          <div><p className="tb-muted tb-small">Destination airport</p><p className="font-mono text-3xl font-semibold">{tripRequest.destination_airport.toUpperCase()}</p></div>
        </div>
        <dl className="tb-details">
          <div><dt>Departure</dt><dd>{new Date(tripRequest.departure_date).toLocaleDateString()}</dd></div>
          <div><dt>Return</dt><dd>{tripRequest.return_date ? new Date(tripRequest.return_date).toLocaleDateString() : 'One-way'}</dd></div>
          <div><dt>Assistance</dt><dd className="capitalize">{tripRequest.assistance_level}</dd></div>
          <div><dt>Language Requirements</dt><dd>{tripRequest.language_requirements.join(', ') || 'None specified'}</dd></div>
        </dl>
        <p className="tb-muted tb-small tb-min-zero">Trip Request ID: <span className="font-mono">{tripRequest.id}</span></p>
        <hr className="tb-divider" />
        <StepIndicator steps={['Trip request', 'Companion matches', 'Booking']} currentStep={tripRequest.status === 'completed' ? 3 : ['booked', 'in_progress'].includes(tripRequest.status) ? 2 : tripRequest.status === 'cancelled' || tripRequest.status === 'expired' ? -1 : 1} />
      </GlassCard>
      {!isFindingMatches && matches.length === 0 && matchAttempts.length === 0 && (
        <div className="tb-actions"><PrimaryButton type="button" onClick={findMatches} icon="users">Find Matching Companions</PrimaryButton></div>
      )}
      {isFindingMatches && <GlassCard><LoadingState label="Finding matching companions..." /></GlassCard>}
      {matches.length > 0 && (
        <section className="tb-stack" aria-labelledby="recommended-heading">
          <SectionHeader id="recommended-heading" title={`Recommended Companions (${matches.length})`} description="Companions are ranked by compatibility score (higher is better)." />
          {matches.slice(0, 5).map((match, index) => (
            <MatchResultCard key={match.matchAttemptId} match={match} index={index + 1} actionDisabled={pendingActionId !== null || pendingBookingAttemptId !== null} onAccept={() => updateMatch(match.matchAttemptId, 'accepted')} onReject={() => updateMatch(match.matchAttemptId, 'rejected')} />
          ))}
          {matches.length > 5 && <p className="tb-muted tb-small text-center">+{matches.length - 5} more matches available</p>}
        </section>
      )}
      {matchAttempts.length > 0 && matches.length === 0 && (
        <section className="tb-stack" aria-labelledby="attempts-heading">
          <SectionHeader id="attempts-heading" title={`Previous Match Attempts (${matchAttempts.length})`} description="History of companion matches for this trip request." />
          {matchAttempts.map((attempt, index) => (
            <MatchResultCard
              key={attempt.matchAttemptId}
              match={attempt}
              index={index + 1}
              attemptedAt={attempt.attemptedAt}
              showPersonalDetails={false}
              initiallyExpanded
              onAccept={() => updateMatch(attempt.matchAttemptId, 'accepted')}
              onReject={() => updateMatch(attempt.matchAttemptId, 'rejected')}
              actions={attempt.status === 'accepted' ? (
                attempt.bookingId ? (
                  <PrimaryButton href={`/dashboard/bookings/${attempt.bookingId}`} className="tb-min-zero" icon="arrow">View Booking{attempt.bookingReference ? ` (${attempt.bookingReference})` : ''}</PrimaryButton>
                ) : (
                  <PrimaryButton type="button" disabled={pendingBookingAttemptId !== null || pendingActionId !== null} loading={pendingBookingAttemptId === attempt.matchAttemptId} onClick={() => void createBooking(attempt)} icon="document">{pendingBookingAttemptId === attempt.matchAttemptId ? 'Creating Booking...' : 'Create Booking'}</PrimaryButton>
                )
              ) : attempt.status === 'pending' ? (
                <><PrimaryButton type="button" disabled={pendingActionId !== null} onClick={() => updateMatch(attempt.matchAttemptId, 'accepted')} icon="check">Accept</PrimaryButton><SecondaryButton type="button" disabled={pendingActionId !== null} onClick={() => updateMatch(attempt.matchAttemptId, 'rejected')} icon="close">Reject</SecondaryButton></>
              ) : undefined}
            />
          ))}
        </section>
      )}
      {hasLoadedAttempts && matches.length === 0 && matchAttempts.length === 0 && !isFindingMatches && (
        <GlassCard><EmptyState title="No matching companions found" description="Try adjusting the trip request criteria or check back later as new companions join." icon="users" action={<SecondaryButton href="/dashboard/family/companions" icon="arrow">Browse All Companions</SecondaryButton>} /></GlassCard>
      )}
    </div>
  );
}
