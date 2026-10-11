'use client';

import { getCurrentFamilyTraveler, updateTraveler, type TravelerDTO, type TravelerUpdateInput } from '@/actions/travelers';
import { EmptyState, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, SecondaryButton } from '@/components/app/ui';
import TravelerForm, { type TravelerFormSubmit } from '@/components/forms/TravelerForm';
import { useAppAuth } from '@/lib/auth/provider';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EditTravelerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();
  const [traveler, setTraveler] = useState<TravelerDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    if (!session || session.user.role !== 'family') { setIsLoading(false); return; }
    void (async () => {
      try {
        const result = await getCurrentFamilyTraveler(id);
        if (result.success) setTraveler(result.traveler); else setError(result.error);
      } catch { setError('Unable to load traveler details.'); }
      finally { setIsLoading(false); }
    })();
  }, [id, isLoaded, session]);

  async function handleSubmit(formData: TravelerFormSubmit) {
    setIsLoading(true); setError(null);
    const input: TravelerUpdateInput = { ...formData, date_of_birth: formData.date_of_birth || null };
    try {
      const result = await updateTraveler(id, input);
      if (result.success) { setTraveler(result.traveler); router.push(`/dashboard/family/travelers/${id}`); } else setError(result.error);
    } catch { setError('Unable to update traveler. Please try again.'); }
    finally { setIsLoading(false); }
  }

  if (!isLoaded || (isLoading && !traveler)) return <LoadingState label="Loading traveler details..." />;
  if (!session || session.user.role !== 'family') return <GlassCard><ErrorState message="This page is only available to family users." /></GlassCard>;
  if (!traveler) return <GlassCard>{error ? <ErrorState message={error} action={<SecondaryButton href="/dashboard/family/travelers" icon="back">Back to Travelers</SecondaryButton>} /> : <EmptyState title="Traveler not found." description="Return to your family’s travelers to choose a saved profile." icon="user" action={<SecondaryButton href="/dashboard/family/travelers" icon="back">Back to Travelers</SecondaryButton>} />}</GlassCard>;

  return (
    <div className="tb-page">
      <PageHeader
        title="Edit Traveler"
        eyebrow="Traveler profile"
        description={`Keep ${traveler.first_name}’s details current before the next journey.`}
        backHref={`/dashboard/family/travelers/${id}`}
        backLabel="Back to Traveler Details"
      />
      {error && <Feedback tone="danger">{error}</Feedback>}
      <TravelerForm
        initialData={traveler}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        cancelHref={`/dashboard/family/travelers/${id}`}
      />
    </div>
  );
}
