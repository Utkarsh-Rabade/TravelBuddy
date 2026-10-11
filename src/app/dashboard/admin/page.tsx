'use client';

import {
  getAdminOverview,
  getAdminVerification,
  reviewAdminVerification,
} from '@/actions/admin';
import { Avatar, ConfirmationDialog, DangerButton, EmptyState, ErrorState, Feedback, GlassCard, Icon, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatCard, StatusBadge, Timeline } from '@/components/app/ui';
import type {
  AdminBookingSummary,
  AdminCompanionSummary,
  AdminFamilySummary,
  AdminOverview,
  AdminRatingSummary,
  AdminSosSummary,
  AdminTripSummary,
  AdminVerificationDecision,
  AdminVerificationSummary,
} from '@/lib/admin-types';
import { useAppAuth } from '@/lib/auth/provider';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

const PAGE_LIMIT = 10;

export default function AdminDashboardPage() {
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) return <LoadingState label="Loading admin dashboard..." />;
  if (!session) {
    return <AccessState message="Please sign in to view the admin dashboard." href="/auth/sign-in" />;
  }
  if (session.user.role !== 'admin') {
    return <AccessState message="This dashboard is only available to admin users." />;
  }

  return <AdminDashboardContent key={session.user.id} />;
}

function AdminDashboardContent() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [selectedVerificationId, setSelectedVerificationId] = useState<string | null>(null);
  const [verification, setVerification] = useState<AdminVerificationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVerificationLoading, setIsVerificationLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewingDecision, setReviewingDecision] = useState<AdminVerificationDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [confirmationDecision, setConfirmationDecision] = useState<AdminVerificationDecision | null>(null);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getAdminOverview({ limit: PAGE_LIMIT, offset: 0 });
      if (!result.success) {
        setError(result.error);
        setOverview(null);
        return;
      }
      setOverview(result.overview);
      setSelectedVerificationId((current) => {
        const stillPending = current && result.overview.pending_verifications.some((item) => item.id === current);
        return stillPending ? current : result.overview.pending_verifications[0]?.id ?? null;
      });
    } catch {
      setError('Unable to load admin data. Please try again.');
      setOverview(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedVerificationId) {
      setVerification(null);
      setVerificationError(null);
      setIsVerificationLoading(false);
      return;
    }

    let active = true;
    setIsVerificationLoading(true);
    setVerificationError(null);
    void (async () => {
      try {
        const result = await getAdminVerification(selectedVerificationId);
        if (!active) return;
        if (result.success) setVerification(result.verification);
        else {
          setVerification(null);
          setVerificationError(result.error);
        }
      } catch {
        if (active) {
          setVerification(null);
          setVerificationError('Unable to load this verification. Please try again.');
        }
      } finally {
        if (active) setIsVerificationLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedVerificationId]);

  async function review(decision: AdminVerificationDecision) {
    if (!selectedVerificationId || isReviewing) return;

    setIsReviewing(true);
    setReviewingDecision(decision);
    setReviewError(null);
    setReviewFeedback(null);
    try {
      const result = await reviewAdminVerification(selectedVerificationId, decision);
      if (!result.success) {
        setReviewError(result.error);
        return;
      }
      await loadOverview();
      setReviewFeedback(`Verification review recorded: ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'expired'}.`);
    } catch {
      setReviewError('Unable to review this verification. Please try again.');
    } finally {
      setIsReviewing(false);
      setReviewingDecision(null);
      setConfirmationDecision(null);
    }
  }

  if (isLoading && !overview) return <LoadingState label="Loading admin data..." />;
  if (error || !overview) {
    return (
      <GlassCard><ErrorState message={error ?? 'Admin data is unavailable.'} action={<SecondaryButton type="button" onClick={() => void loadOverview()} icon="refresh">Retry</SecondaryButton>} /></GlassCard>
    );
  }

  return (
    <div className="tb-page">
      <PageHeader
        title="Admin dashboard"
        eyebrow="TravelBuddy operations"
        description="Review verification submissions and keep a clear view of the people, journeys, and safety summaries in your current operational scope."
        actions={<SecondaryButton type="button" onClick={() => void loadOverview()} disabled={isLoading} loading={isLoading} icon="refresh">{isLoading ? 'Refreshing...' : 'Refresh data'}</SecondaryButton>}
      />
      {reviewFeedback && <Feedback tone="success">{reviewFeedback}</Feedback>}

      <section aria-labelledby="overview-heading">
        <SectionHeader
          id="overview-heading"
          title="Overview"
          description="Bounded operational summaries for the current admin view."
          actions={<span className="tb-muted tb-small">Showing up to {overview.pagination.limit} items per list</span>}
        />
        <div className="tb-stats-grid">
          <Kpi label="Families" value={overview.stats.families} icon="home" />
          <Kpi label="Companions" value={overview.stats.companions} icon="users" />
          <Kpi label="Elderly travelers" value={overview.stats.elderly_travelers} icon="user" />
          <Kpi label="Trip requests" value={overview.stats.trip_requests} icon="calendar" />
          <Kpi label="Bookings" value={overview.stats.bookings} icon="document" />
          <Kpi label="Trips" value={overview.stats.trips} icon="plane" />
          <Kpi label="Ratings" value={overview.stats.ratings} icon="star" />
          <Kpi label="SOS events" value={overview.stats.sos_events} icon="alert" tone={overview.stats.sos_events > 0 ? 'warning' : 'default'} />
          <Kpi label="Notifications" value={overview.stats.notifications} icon="bell" />
          <Kpi label="Pending verification" value={overview.stats.pending_verifications} icon="shield" tone={overview.stats.pending_verifications > 0 ? 'warning' : 'default'} />
        </div>
      </section>

      <section className="tb-grid" aria-labelledby="verification-heading">
        <Panel title="Pending verification queue" headingId="verification-heading" description="Select a submission to inspect its review metadata." icon="shield">
          {overview.pending_verifications.length === 0 ? (
            <EmptyNotice message="No pending verifications." />
          ) : (
            <ul className="tb-stack">
              {overview.pending_verifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedVerificationId(item.id)}
                    aria-pressed={selectedVerificationId === item.id}
                    aria-controls="verification-detail-heading"
                    className={`w-full min-w-0 rounded-xl border p-4 text-left transition-colors ${selectedVerificationId === item.id ? 'border-cyan-300/40 bg-cyan-300/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-cyan-300/25'}`}
                  >
                    <span className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                      <span className="tb-min-zero text-sm font-semibold">{item.document_type}</span>
                      <StatusBadge status={item.background_check_status}>{formatStatus(item.background_check_status)}</StatusBadge>
                    </span>
                    <span className="tb-muted tb-small mt-3 block">Verification {shortId(item.id)} · Companion {shortId(item.companion_id)}</span>
                    <span className="tb-muted tb-small mt-1 block">Submitted {formatDate(item.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Verification detail" headingId="verification-detail-heading" description="Review the selected submission and record a decision." icon="document">
          {!selectedVerificationId ? (
            <EmptyNotice message="Select a verification to review." />
          ) : isVerificationLoading ? (
            <InlineLoading label="Loading verification detail..." />
          ) : verificationError ? (
            <InlineError message={verificationError} />
          ) : verification ? (
            <VerificationDetail
              verification={verification}
              isReviewing={isReviewing}
              reviewingDecision={reviewingDecision}
              error={reviewError}
              onReview={(decision) => setConfirmationDecision(decision)}
            />
          ) : (
            <EmptyNotice message="This verification is no longer available." />
          )}
        </Panel>
      </section>

      <section className="tb-grid" aria-label="Users and entities" id="admin-people">
        <Panel title="Families" description="Family account summaries in this view." icon="home">
          {overview.families.length === 0 ? <EmptyNotice message="No family summaries available." /> : <FamiliesList families={overview.families} />}
        </Panel>
        <Panel title="Companions" description="Recorded verification status and companion reputation." icon="users">
          {overview.companions.length === 0 ? <EmptyNotice message="No companion summaries available." /> : <CompanionsList companions={overview.companions} />}
        </Panel>
      </section>

      <section className="tb-grid" aria-label="Bookings and trips" id="admin-journeys">
        <Panel title="Safe bookings" description="Booking references, payment summaries, and current status." icon="lock">
          {overview.bookings.length === 0 ? <EmptyNotice message="No booking summaries available." /> : <BookingsList bookings={overview.bookings} />}
        </Panel>
        <Panel title="Safe trips" description="Trip references, start times, and last recorded check-ins." icon="plane">
          {overview.trips.length === 0 ? <EmptyNotice message="No trip summaries available." /> : <TripsList trips={overview.trips} />}
        </Panel>
      </section>

      <section className="tb-grid" aria-label="Safety and feedback summaries" id="admin-safety">
        <Panel title="SOS summaries" description="Recorded safety event status in the bounded result." icon="alert">
          {overview.sos_events.length === 0 ? <EmptyNotice message="No SOS events in the bounded result." /> : <SosList events={overview.sos_events} />}
        </Panel>
        <Panel title="Ratings and reviews" description="Traveler feedback included in the current result." icon="star">
          {overview.ratings.length === 0 ? <EmptyNotice message="No ratings or reviews in the bounded result." /> : <RatingsList ratings={overview.ratings} />}
        </Panel>
      </section>

      <Panel title="Review audit & data scope" headingId="admin-audit" description="Decisions stay connected to the trusted verification workflow." icon="document">
        <Feedback>Approval, rejection, and expiry decisions are recorded by the verification review workflow. Detailed audit records are not included in this dashboard dataset.</Feedback>
        <p className="tb-muted tb-small mt-4">This view contains metadata and bounded summaries, with up to {overview.pagination.limit} items per list. Refresh data to retrieve the current result.</p>
      </Panel>

      <ConfirmationDialog
        open={confirmationDecision !== null}
        title={confirmationDecision ? `${formatStatus(confirmationDecision)} this verification?` : 'Review verification'}
        description={<>This action will be recorded. {selectedVerificationId && <>Verification reference: <strong>{shortId(selectedVerificationId)}</strong>.</>}</>}
        confirmLabel={confirmationDecision ? formatStatus(confirmationDecision) : 'Confirm'}
        danger={confirmationDecision === 'reject' || confirmationDecision === 'expire'}
        loading={isReviewing}
        onConfirm={() => { if (confirmationDecision) void review(confirmationDecision); }}
        onClose={() => { if (!isReviewing) setConfirmationDecision(null); }}
      />
    </div>
  );
}

function Kpi({ label, value, icon, tone = 'default' }: { label: string; value: number; icon: string; tone?: 'default' | 'warning' }) {
  return <StatCard label={label} value={value.toLocaleString()} icon={icon} tone={tone === 'warning' ? 'warning' : 'info'} />;
}

function Panel({ title, headingId, description, icon, children }: { title: string; headingId?: string; description?: string; icon?: string; children: ReactNode }) {
  return (
    <GlassCard>
      <SectionHeader title={title} id={headingId} description={description} icon={icon} />
      {children}
    </GlassCard>
  );
}

function VerificationDetail({
  verification,
  isReviewing,
  reviewingDecision,
  error,
  onReview,
}: {
  verification: AdminVerificationSummary;
  isReviewing: boolean;
  reviewingDecision: AdminVerificationDecision | null;
  error: string | null;
  onReview: (decision: AdminVerificationDecision) => void;
}) {
  return (
    <div className="tb-stack">
      <dl className="tb-details">
        <Detail label="Document type" value={verification.document_type} />
        <Detail label="Status" value={<StatusBadge status={verification.background_check_status}>{formatStatus(verification.background_check_status)}</StatusBadge>} />
        <Detail label="Companion reference" value={shortId(verification.companion_id)} />
        <Detail label="Submitted" value={formatDate(verification.created_at)} />
        <Detail label="Verified" value={formatDate(verification.verified_at)} />
        <Detail label="Expires" value={formatDate(verification.expires_at)} />
      </dl>
      <Feedback>Document contents and storage locations are not shown in this review surface.</Feedback>
      <div className="tb-form-actions">
        {(['approve', 'reject', 'expire'] as const).map((decision) => (
          decision === 'approve' ? (
            <PrimaryButton key={decision} type="button" icon="check" onClick={() => onReview(decision)} disabled={isReviewing} loading={isReviewing && reviewingDecision === decision}>
              {isReviewing && reviewingDecision === decision ? `${formatStatus(decision)}...` : formatStatus(decision)}
            </PrimaryButton>
          ) : decision === 'reject' ? (
            <DangerButton key={decision} type="button" icon="close" onClick={() => onReview(decision)} disabled={isReviewing} loading={isReviewing && reviewingDecision === decision}>
              {isReviewing && reviewingDecision === decision ? `${formatStatus(decision)}...` : formatStatus(decision)}
            </DangerButton>
          ) : (
            <SecondaryButton key={decision} type="button" icon="clock" onClick={() => onReview(decision)} disabled={isReviewing} loading={isReviewing && reviewingDecision === decision}>
              {isReviewing && reviewingDecision === decision ? `${formatStatus(decision)}...` : formatStatus(decision)}
            </SecondaryButton>
          )
        ))}
      </div>
      {error && <Feedback tone="danger">{error}</Feedback>}
      <div className="border-t border-white/10 pt-5">
        <h3 className="mb-4 text-sm font-semibold">Verification timestamps</h3>
        <Timeline steps={[
          { label: 'Submitted', description: formatDate(verification.created_at), status: 'completed' },
          { label: 'Metadata updated', description: formatDate(verification.updated_at), status: 'completed' },
          { label: 'Verified', description: formatDate(verification.verified_at), status: verification.verified_at ? 'completed' : 'upcoming' },
        ]} />
      </div>
    </div>
  );
}

function BookingsList({ bookings }: { bookings: AdminBookingSummary[] }) {
  return (
    <ul className="tb-stack">
      {bookings.map((booking) => <li key={booking.id} className="min-w-0 border-b border-white/10 pb-5 last:border-0 last:pb-0">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="tb-min-zero"><p className="tb-muted tb-small">Booking reference</p><p className="mt-1 text-sm font-semibold">{booking.booking_reference}</p></div>
          <StatusBadge status={booking.status}>{formatStatus(booking.status)}</StatusBadge>
        </div>
        <dl className="tb-details mt-4"><Detail label="Amount" value={formatCurrency(booking.total_amount, booking.currency)} /><Detail label="Payment" value={<StatusBadge status={booking.payment_status}>{formatStatus(booking.payment_status)}</StatusBadge>} /></dl>
      </li>)}
    </ul>
  );
}

function FamiliesList({ families }: { families: AdminFamilySummary[] }) {
  return <ul className="tb-stack">{families.map((family) => <li key={family.id} className="flex min-w-0 items-start gap-3 border-b border-white/10 pb-4 last:border-0 last:pb-0"><Avatar name={family.name} size="small" /><div className="tb-min-zero"><p className="text-sm font-medium">{family.name}</p><p className="tb-muted tb-small mt-1">Created {formatDate(family.created_at)}</p></div></li>)}</ul>;
}

function CompanionsList({ companions }: { companions: AdminCompanionSummary[] }) {
  return <ul className="tb-stack">{companions.map((companion) => <li key={companion.id} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-white/10 pb-4 last:border-0 last:pb-0"><Avatar name={`${companion.first_name} ${companion.last_name}`} size="small" /><div className="tb-min-zero flex-1"><p className="text-sm font-medium">{companion.first_name} {companion.last_name}</p><p className="tb-muted tb-small mt-1">Rating {companion.rating_average.toFixed(2)} · {companion.total_trips} trips</p></div><StatusBadge status={companion.verification_status}>{formatStatus(companion.verification_status)}</StatusBadge></li>)}</ul>;
}

function TripsList({ trips }: { trips: AdminTripSummary[] }) {
  return (
    <ul className="tb-stack">
      {trips.map((trip) => <li key={trip.id} className="min-w-0 border-b border-white/10 pb-5 last:border-0 last:pb-0"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Trip {shortId(trip.id)}</p><StatusBadge status={trip.sos_triggered ? 'SOS triggered' : 'No SOS'} tone={trip.sos_triggered ? 'danger' : 'neutral'} /></div><p className="tb-muted tb-small mt-2">Booking {shortId(trip.booking_id)}</p><dl className="tb-details mt-4"><Detail label="Starts" value={formatDate(trip.start_time)} /><Detail label="Last check-in" value={formatDate(trip.last_check_in)} /></dl></li>)}
    </ul>
  );
}

function SosList({ events }: { events: AdminSosSummary[] }) {
  return (
    <ul className="tb-stack">
      {events.map((event) => <li key={event.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4 last:border-0 last:pb-0"><div className="tb-min-zero"><p className="text-sm font-semibold">Trip {shortId(event.trip_id)}</p><p className="tb-muted tb-small mt-1">Triggered {formatDate(event.triggered_at)}</p></div><StatusBadge status={event.status} tone={event.status === 'active' ? 'danger' : event.status === 'acknowledged' ? 'warning' : 'success'}>{formatStatus(event.status)}</StatusBadge></li>)}
    </ul>
  );
}

function RatingsList({ ratings }: { ratings: AdminRatingSummary[] }) {
  return (
    <ul className="tb-stack">
      {ratings.map((rating) => <li key={rating.id} className="min-w-0 border-b border-white/10 pb-4 last:border-0 last:pb-0"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold" aria-label={`Rated ${rating.score} out of 5`}><Icon name="star" size={17} />{rating.score} / 5</span><span className="tb-muted tb-small">{formatDate(rating.created_at)}</span></div><p className="tb-muted tb-small mt-3 break-words">{rating.comment || 'No written review.'}</p></li>)}
    </ul>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return <div className="tb-min-zero"><dt>{label}</dt><dd>{value}</dd></div>;
}

function EmptyNotice({ message }: { message: string }) {
  return <EmptyState title="No records in this view" description={message} icon="document" />;
}

function InlineLoading({ label }: { label: string }) {
  return <LoadingState label={label} />;
}

function InlineError({ message }: { message: string }) {
  return <Feedback tone="danger">{message}</Feedback>;
}

function AccessState({ message, href }: { message: string; href?: string }) {
  return <GlassCard><ErrorState title="Admin account access" message={message} action={href ? <PrimaryButton href={href}>Open sign in</PrimaryButton> : undefined} /></GlassCard>;
}

function formatStatus(status: string) {
  return status.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function formatDate(value: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
