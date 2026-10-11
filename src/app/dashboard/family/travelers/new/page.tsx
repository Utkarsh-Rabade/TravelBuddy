'use client';

import { createTraveler, type TravelerInput } from '@/actions/travelers';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton } from '@/components/app/ui';
import TravelerForm, { type TravelerFormSubmit } from '@/components/forms/TravelerForm';
import { useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export default function NewTravelerPage() {
  const { isLoaded, session } = useAppAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const submissionId = useRef<string | null>(null);

  async function handleSubmit(formData: TravelerFormSubmit) {
    setIsLoading(true);
    setError(null);
    const input: TravelerInput = {
      ...formData,
      date_of_birth: formData.date_of_birth || null,
    };
    try {
      submissionId.current ??= crypto.randomUUID();
      const result = await createTraveler(input, submissionId.current);
      if (result.success) router.push(`/dashboard/family/travelers/${result.traveler.id}`);
      else setError(result.error);
    } catch { setError('Unable to save traveler. Please try again.'); }
    finally { setIsLoading(false); }
  }

  if (!isLoaded) return <LoadingState label="Checking your session..." />;
  if (!session) return <GlassCard><EmptyState title="A profile for someone you love" description="Sign in to your family account first." icon="user" action={<PrimaryButton href="/auth/sign-in">Open sign in</PrimaryButton>} /></GlassCard>;
  if (session.user.role !== 'family') return <GlassCard><ErrorState message="Only a family user can add travelers." /></GlassCard>;

  return (
    <div className="tb-page">
      <PageHeader
        title="Add New Traveler"
        eyebrow="People before plans"
        description="Save the personal details, assistance needs and emergency contacts you’ll use when planning a journey."
        backHref="/dashboard/family/travelers"
        backLabel="Back to Travelers"
      />
      {error && <Feedback tone="danger">{error}</Feedback>}
      <TravelerForm onSubmit={handleSubmit} isLoading={isLoading} />
    </div>
  );
}
