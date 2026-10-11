'use client';

import { useId, useState, type ReactNode } from 'react';
import { Avatar, GlassCard, Icon, PrimaryButton, SecondaryButton, StatusBadge, type Tone } from '@/components/app/ui';
import MatchExplanation from '@/components/ui/MatchExplanation';

interface MatchResultCardProps {
  match: {
    companion: {
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
    score: number;
    explanation: string;
    explanationLimitations?: string;
    matchAttemptId: string;
    status?: 'pending' | 'accepted' | 'rejected';
  };
  index: number;
  actionDisabled?: boolean;
  actions?: ReactNode;
  attemptedAt?: string | null;
  showPersonalDetails?: boolean;
  initiallyExpanded?: boolean;
  onAccept: (matchAttemptId: string) => void;
  onReject: (matchAttemptId: string) => void;
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return 'Not supplied';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function MatchResultCard({
  match,
  index,
  actionDisabled = false,
  actions,
  attemptedAt,
  showPersonalDetails = true,
  initiallyExpanded = false,
  onAccept,
  onReject,
}: MatchResultCardProps) {
  const { companion, score, explanation, explanationLimitations, matchAttemptId } = match;
  const status = match.status ?? 'pending';
  const [explanationOpen, setExplanationOpen] = useState(initiallyExpanded);
  const explanationId = useId();

  let scoreTone: Tone;
  if (score >= 85) scoreTone = 'success';
  else if (score >= 70) scoreTone = 'info';
  else if (score >= 50) scoreTone = 'warning';
  else scoreTone = 'danger';

  const dob = companion.date_of_birth
    ? new Date(companion.date_of_birth).toLocaleDateString()
    : 'Not specified';
  const age = companion.date_of_birth
    ? new Date().getFullYear() - new Date(companion.date_of_birth).getFullYear()
    : null;
  const rating = companion.rating_average !== null
    ? `${companion.rating_average.toFixed(2)} / 5.0`
    : 'Not rated';

  return (
    <GlassCard className="tb-stack">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Avatar name={`${companion.first_name} ${companion.last_name}`} size="large" />
          <div className="tb-min-zero tb-stack">
            <div><p className="tb-app-eyebrow">Ranked #{index}</p><h3 className="text-xl font-semibold">{companion.first_name} {companion.last_name}</h3></div>
            <div className="tb-actions">
              <div>
                <p className="tb-muted tb-small mb-2">Verification Status</p>
                <div className="tb-actions">
                  {companion.verification_status === 'verified' && <span className="text-[#88dfc2]"><Icon name="shield" size={18} /></span>}
                  <StatusBadge status={companion.verification_status ?? 'Not supplied'}>{formatStatus(companion.verification_status)}</StatusBadge>
                </div>
              </div>
              <div><p className="tb-muted tb-small mb-2">Match status</p><StatusBadge status={status}>{formatStatus(status)}</StatusBadge></div>
            </div>
            {attemptedAt !== undefined && <p className="tb-muted tb-small">Matched: {attemptedAt ? new Date(attemptedAt).toLocaleDateString() : 'Date not supplied'}</p>}
          </div>
        </div>
        <GlassCard tone={scoreTone} className="w-full sm:w-auto sm:min-w-44">
          <p className="tb-muted tb-small">Compatibility <strong>SCORE</strong></p>
          <p className="tb-stat-value tb-min-zero">{score}<span className="tb-muted text-lg">%</span></p>
          <p className="tb-muted tb-small">Higher is better</p>
        </GlassCard>
      </div>
      <dl className="tb-details">
        <div><dt>Rating</dt><dd className="flex flex-wrap items-center gap-2"><span className="text-[#80dfee]"><Icon name="star" size={16} /></span>{rating}</dd></div>
        <div><dt>Experience</dt><dd>{companion.total_trips !== null ? `${companion.total_trips} trips completed` : 'Not supplied'}</dd></div>
        <div><dt>Languages</dt><dd>{companion.languages_spoken.length > 0 ? companion.languages_spoken.join(', ') : 'Not specified'}</dd></div>
        <div><dt>Availability</dt><dd>{companion.availability_summary || 'Not supplied'}</dd></div>
      </dl>
      <details className="tb-min-zero">
        <summary className="tb-link cursor-pointer" style={{ minHeight: 44 }}>View Companion Details</summary>
        <dl className="tb-details mt-4">
          <div className="col-span-2"><dt>Companion ID</dt><dd className="font-mono">{companion.id}</dd></div>
          {showPersonalDetails && <><div><dt>Age</dt><dd>{age !== null ? `${age} years` : 'Not specified'}</dd></div><div><dt>Date of Birth</dt><dd>{dob}</dd></div></>}
        </dl>
      </details>
      <div className="tb-stack">
        <SecondaryButton type="button" icon="info" className="self-start" aria-expanded={explanationOpen} aria-controls={explanationId} onClick={() => setExplanationOpen(open => !open)}>{explanationOpen ? 'Hide Match Explanation' : 'View Match Explanation'}</SecondaryButton>
        <div id={explanationId} hidden={!explanationOpen}>
          <MatchExplanation explanation={explanation} explanationLimitations={explanationLimitations} />
        </div>
      </div>
      {(actions || status === 'pending') && <div className="tb-form-actions">
        {actions ?? <><PrimaryButton type="button" disabled={actionDisabled} onClick={() => onAccept(matchAttemptId)} icon="check">Accept Match</PrimaryButton><SecondaryButton type="button" disabled={actionDisabled} onClick={() => onReject(matchAttemptId)} icon="close">Reject Match</SecondaryButton></>}
      </div>}
    </GlassCard>
  );
}
