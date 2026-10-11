'use client';

import { getCurrentCompanionProfile, updateCompanionAvailability, updateCompanionProfile } from '@/actions/companions';
import { ErrorState, Feedback, GlassCard, LoadingState, PageHeader, SecondaryButton, StatusBadge } from '@/components/app/ui';
import CompanionForm, { type CompanionFormValues } from '@/components/forms/CompanionForm';
import KYCDocumentUpload from '@/components/forms/KYCDocumentUpload';
import AvailabilityCalendar from '@/components/ui/AvailabilityCalendar';
import { useAppAuth } from '@/lib/auth/provider';
import type { CompanionAvailabilityCalendar as AvailabilityCalendarValue, CompanionProfileDTO } from '@/lib/companion-types';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CompanionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();
  if (!isLoaded) return <StatusPage message="Loading companion profile..." loading />;
  if (!session) return <StatusPage message="Sign in to your companion account first." href="/auth/sign-in" linkLabel="Open sign in" />;
  if (session.user.role !== 'companion') return <StatusPage message="Only a companion can edit a companion profile." />;
  return <EditContent key={`${session.user.id}:${id}`} id={id} />;
}

function EditContent({ id }: { id: string }) {
  const router = useRouter();
  const [companion, setCompanion] = useState<CompanionProfileDTO | null>(null);
  const [availability, setAvailability] = useState<AvailabilityCalendarValue>({});
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const availabilitySubmissionId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getCurrentCompanionProfile();
        if (!active) return;
        if (!result.success) setError(result.error);
        else if (result.profile?.id !== id) setError('Companion profile not found.');
        else {
          setCompanion(result.profile);
          setAvailability(result.profile.availability_calendar ?? {});
        }
      } catch {
        if (active) setError('Failed to load companion profile.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) return <StatusPage message="Loading companion profile..." loading />;
  if (!companion) return <StatusPage message={error ?? 'Companion profile not found.'} href="/dashboard/companions" linkLabel="Back to Companions" />;

  const handleProfileSubmit = async (data: CompanionFormValues) => {
    setError(null);
    setSavingProfile(true);
    try {
      const result = await updateCompanionProfile(id, data);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCompanion(result.profile);
      router.push(`/dashboard/companions/${id}`);
    } catch {
      setError('Failed to update companion profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvailabilitySave = async (nextAvailability: AvailabilityCalendarValue) => {
    setAvailabilityError(null);
    setAvailabilitySaved(false);
    setSavingAvailability(true);
    try {
      availabilitySubmissionId.current ??= crypto.randomUUID();
      const result = await updateCompanionAvailability(id, nextAvailability, availabilitySubmissionId.current);
      if (!result.success) {
        setAvailabilityError(result.error);
        return;
      }
      setAvailability(nextAvailability);
      setAvailabilitySaved(true);
    } catch {
      setAvailabilityError('Failed to save availability. Please try again.');
    } finally {
      setSavingAvailability(false);
    }
  };

  return (
    <div className="tb-page">
      <PageHeader
        title="Edit Companion Profile"
        eyebrow="Keep your companion profile current"
        description="Update your personal details, save your weekly schedule, and manage verification documents in one place."
        backHref={`/dashboard/companions/${id}`}
        backLabel="Back to Profile"
        actions={<StatusBadge status={companion.verification_status}>Verification: {companion.verification_status}</StatusBadge>}
      />
      <nav className="tb-actions" aria-label="Profile sections">
        <SecondaryButton href="#profile-details" icon="user">Personal details</SecondaryButton>
        <SecondaryButton href="#availability" icon="calendar">Weekly availability</SecondaryButton>
        <SecondaryButton href="#verification" icon="shield">KYC Verification</SecondaryButton>
      </nav>
      {error && <Feedback tone="danger">{error}</Feedback>}
      <GlassCard id="profile-details"><CompanionForm initialData={companion} onSubmit={handleProfileSubmit} isLoading={savingProfile} /></GlassCard>
      {availabilitySaved && <Feedback tone="success">Your weekly availability has been saved.</Feedback>}
      <AvailabilityCalendar
        value={availability}
        onChange={(next) => { setAvailability(next); setAvailabilitySaved(false); }}
        onSave={handleAvailabilitySave}
        isSaving={savingAvailability}
        error={availabilityError}
      />
      <KYCDocumentUpload companionId={companion.id} />
      <Feedback>Verification status, rating, and completed trips are read-only and managed by TravelBuddy.</Feedback>
    </div>
  );
}

function StatusPage({ message, href, linkLabel, loading }: { message: string; href?: string; linkLabel?: string; loading?: boolean }) {
  return <GlassCard>{loading ? <LoadingState label={message} /> : <ErrorState title="Companion profile" message={message} action={href ? <SecondaryButton href={href}>{linkLabel}</SecondaryButton> : undefined} />}</GlassCard>;
}
