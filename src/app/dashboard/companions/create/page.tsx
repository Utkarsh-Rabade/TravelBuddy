'use client';

import { createCompanionProfile } from '@/actions/companions';
import { ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, StepIndicator } from '@/components/app/ui';
import CompanionForm, { type CompanionFormValues } from '@/components/forms/CompanionForm';
import { useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export default function CompanionSignupPage() {
  const { isLoaded, session } = useAppAuth();

  if (!isLoaded) return <LoadingState label="Checking your session..." />;
  if (!session) return <AccessState message="Sign in to your companion account first." action="Open sign in" href="/auth/sign-in" />;
  if (session.user.role !== 'companion') return <AccessState message="Only a companion can create a companion profile." />;

  return <CreateContent key={session.user.id} />;
}

function CreateContent() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionId = useRef<string | null>(null);

  const handleSubmit = async (data: CompanionFormValues) => {
    setError(null);
    setIsLoading(true);
    try {
      // The server action derives ownership and forces verification_status to pending.
      submissionId.current ??= crypto.randomUUID();
      const result = await createCompanionProfile(data, submissionId.current);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/dashboard/companions/${result.profile.id}`);
    } catch {
      setError('Failed to create companion profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="tb-page">
      <PageHeader
        title="Become a Companion"
        eyebrow="Thoughtful support starts with you"
        description="Introduce yourself, share the languages you speak, and begin building your companion profile."
        backHref="/dashboard/companions"
        backLabel="Back to Companions"
      />
      <GlassCard><StepIndicator steps={['Profile details', 'Weekly availability', 'Document verification']} currentStep={0} /></GlassCard>
      {error && <Feedback tone="danger">{error}</Feedback>}
      <GlassCard id="profile-details"><CompanionForm onSubmit={handleSubmit} isLoading={isLoading} /></GlassCard>
      <Feedback>Availability is configured separately after your profile is created. Verification status is managed by the review process.</Feedback>
    </div>
  );
}

function AccessState({ message, action, href }: { message: string; action?: string; href?: string }) {
  return <GlassCard><ErrorState title="Companion account access" message={message} action={action && href ? <PrimaryButton href={href}>{action}</PrimaryButton> : undefined} /></GlassCard>;
}
