"use client";

import { getFamilyForUser, updateFamily, type FamilyRecord } from '@/actions/family';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/app/ui';
import FamilyForm from '@/components/forms/FamilyForm';
import { useAppAuth } from '@/lib/auth/provider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EditFamilyPage() {
  const { user, isLoaded } = useAppAuth();
  if (!isLoaded) return <LoadingState label="Checking your session..." />;
  if (!user || user.role !== 'family') return <GlassCard><ErrorState message="Sign in to your family account to edit your profile." action={<PrimaryButton href="/auth/sign-in">Open sign in</PrimaryButton>} /></GlassCard>;
  return <EditFamilyContent key={user.id} userId={user.id} />;
}

function EditFamilyContent({ userId }: { userId: string }) {
  const [family, setFamily] = useState<FamilyRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getFamilyForUser(userId);
        if (!active) return;
        if (!result.success) setError(result.error);
        else setFamily(result.family);
      } catch {
        if (active) setError('Failed to load family details. Please try again.');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [userId]);

  if (isLoading) {
    return <LoadingState label="Loading family details..." />;
  }

  if (error) {
    return <GlassCard><ErrorState message={error} action={<SecondaryButton href="/dashboard/family" icon="back">Back to Dashboard</SecondaryButton>} /></GlassCard>;
  }

  if (!family) {
    return <GlassCard><EmptyState title="Family not found" description="Create a family profile to organize your travelers and journeys." icon="home" action={<PrimaryButton href="/dashboard/family/create" icon="plus">Create Family</PrimaryButton>} /></GlassCard>;
  }

  const handleSubmit = async (formData: { name: string }) => {
    if (isSaving) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      const result = await updateFamily(family.id, formData);
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      router.replace('/dashboard/family');
      router.refresh();
    } catch {
      setSaveError('Failed to update family. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="tb-page">
      <PageHeader
        title="Edit Family"
        eyebrow="Family profile"
        description="Keep your family’s shared identity up to date."
        backHref="/dashboard/family"
        backLabel="Back to Dashboard"
      />
      {saveError && <Feedback tone="danger">{saveError}</Feedback>}
      <div className="tb-grid">
        <FamilyForm
          initialData={{ name: family.name }}
          onSubmit={handleSubmit}
          isLoading={isSaving}
        />
        <GlassCard tone="accent">
          <SectionHeader title="Your family profile" description="A shared starting point for the journeys you arrange." icon="home" />
          <dl className="tb-details">
            <div><dt>Family Name</dt><dd>{family.name}</dd></div>
            <div><dt>Created</dt><dd>{new Date(family.created_at).toLocaleDateString()}</dd></div>
          </dl>
          <hr className="tb-divider" />
          <p className="tb-muted tb-small">Traveler details and assistance needs can be reviewed from each traveler’s profile.</p>
          <a className="tb-link" href="/dashboard/family/travelers">View Travelers</a>
        </GlassCard>
      </div>
    </div>
  );
}
