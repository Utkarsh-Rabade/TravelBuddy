'use client';

import { useCallback, useEffect, useState } from 'react';
import { listCurrentUserTrips } from '@/actions/trips';
import { getCompanionMatchAttemptsAction } from '@/actions/match-companions';
import type { TripDTO } from '@/lib/trip-types';
import type { MatchAttemptDTO } from '@/lib/matching/types';
import { EmptyState, ErrorState, GlassCard, Icon, LoadingState, SecondaryButton, SectionHeader, StatusBadge } from './ui';

/** Presentation of existing owner-scoped action results; no new data contract. */
export function AssignedJourneys() {
  const [trips, setTrips] = useState<TripDTO[]>([]);
  const [matches, setMatches] = useState<MatchAttemptDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tripResult, matchResult] = await Promise.all([listCurrentUserTrips(), getCompanionMatchAttemptsAction()]);
      if (!tripResult.success || !matchResult.success) {
        setError(!tripResult.success ? tripResult.error : !matchResult.success ? matchResult.error : 'Journey summaries unavailable.');
        return;
      }
      setTrips(tripResult.trips); setMatches(matchResult.matchAttempts);
    } catch { setError('We couldn’t load your assigned journeys. Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section id="assigned-journeys" className="tb-stack">
    <SectionHeader title="Your journeys" icon="plane" description="Matches and bookings connected to your companion profile." actions={<SecondaryButton icon="refresh" onClick={() => void load()} disabled={loading}>Refresh journeys</SecondaryButton>} />
    {loading ? <GlassCard><LoadingState label="Loading assigned journeys…" /></GlassCard> : error ? <GlassCard><ErrorState message={error} onRetry={() => void load()} /></GlassCard> : <div className="tb-grid">
      <GlassCard><SectionHeader title="Assigned bookings" description="Your upcoming, active and completed journey records." />{trips.length === 0 ? <EmptyState title="No assigned bookings yet" description="Your bookings will appear here when a family confirms a matching journey." icon="calendar" /> : <div className="tb-stack">{trips.map(trip => <div key={trip.id} className="tb-journey-row"><div className="tb-actions"><StatusBadge status={trip.status} /><span className="tb-trip-route"><strong>{trip.trip_request.origin_airport}</strong><Icon name="arrow" size={17} /><strong>{trip.trip_request.destination_airport}</strong></span></div><p className="tb-muted tb-small">{new Date(`${trip.trip_request.departure_date}T00:00:00Z`).toLocaleDateString('en-GB',{ day:'numeric',month:'short',year:'numeric' })}</p><SecondaryButton href={`/dashboard/bookings/${trip.booking_id}`} icon="arrow">Open Journey</SecondaryButton></div>)}</div>}</GlassCard>
      <GlassCard><SectionHeader title="Trip matches" description="The matching decisions recorded for your profile." />{matches.length === 0 ? <EmptyState title="Ready for a thoughtful connection" description="Keep your availability and verification current. Saved matches will appear here when your profile is recommended." icon="users" /> : <div className="tb-stack">{matches.map(match => <div key={match.id} className="tb-journey-row"><div className="tb-actions"><StatusBadge status={match.status} /><span className="tb-muted tb-small">Compatibility score: {match.score}%</span></div><p className="tb-muted tb-small">Request {match.trip_request_id.slice(0,8)} · {new Date(match.created_at).toLocaleDateString('en-GB')}</p><details><summary className="tb-link">Why this match</summary><p className="tb-muted tb-small">{match.explanation}</p></details>{trips.find(trip => trip.trip_request_id === match.trip_request_id) && <SecondaryButton href={`/dashboard/bookings/${trips.find(trip => trip.trip_request_id === match.trip_request_id)!.booking_id}`}>View assigned booking</SecondaryButton>}</div>)}</div>}</GlassCard>
    </div>}
  </section>;
}
