'use client';

import { createFamilyForCurrentUser } from '@/actions/family';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, SectionHeader, Timeline } from '@/components/app/ui';
import FamilyForm from '@/components/forms/FamilyForm';
import { useAppAuth } from '@/lib/auth/provider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function CreateFamilyPage() {
  const { isLoaded, session } = useAppAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (formData: { name: string }) => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await createFamilyForCurrentUser(formData.name);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push('/dashboard/family');
    } catch (caught) {
      console.error('Error creating family:', caught);
      setError('Failed to create family. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isLoaded) return <LoadingState label="Checking your session..." />;
  if (!session) return <GlassCard><EmptyState title="Your family journey starts here" description="Sign in to your family account first." icon="home" action={<PrimaryButton href="/auth/sign-in">Open sign in</PrimaryButton>} /></GlassCard>;
  if (session.user.role !== 'family') return <GlassCard><ErrorState message="Only a family user can create a family." /></GlassCard>;

  return (
    <div className="tb-page">
      <PageHeader
        title="Create Family"
        eyebrow="A thoughtful beginning"
        description="Give your family a home for traveler profiles and future journeys."
        backHref="/dashboard/family"
        backLabel="Back to Dashboard"
      />
      {error && <Feedback tone="danger">{error}</Feedback>}
      <div className="tb-grid">
        <FamilyForm onSubmit={handleSubmit} isLoading={isLoading} />
        <GlassCard tone="accent">
          <SectionHeader title="From family to first journey" description="Start small. Add the details as your plans take shape." icon="plane" />
          <Timeline steps={[
            { label: 'Create your family', description: 'Choose the name for your shared family profile.', status: 'current' },
            { label: 'Add a traveler', description: 'Save personal details, assistance needs and emergency contacts.', status: 'upcoming' },
            { label: 'Plan a trip', description: 'Choose a route and dates, then explore companion matches.', status: 'upcoming' },
          ]} />
        </GlassCard>
      </div>
    </div>
  );
}
