import { useEffect, useState } from 'react';

import { FormField, Input, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/app/ui';
import type { CompanionProfileInput } from '@/lib/companion-types';

export type CompanionFormValues = Required<Pick<CompanionProfileInput, 'first_name' | 'last_name' | 'date_of_birth' | 'languages_spoken'>>;

interface CompanionFormProps {
  onSubmit: (data: CompanionFormValues) => Promise<void>;
  initialData?: Partial<CompanionFormValues>;
  isLoading?: boolean;
}

function toFormValues(initialData?: Partial<CompanionFormValues>): CompanionFormValues {
  return {
    first_name: initialData?.first_name ?? '',
    last_name: initialData?.last_name ?? '',
    date_of_birth: initialData?.date_of_birth ?? null,
    languages_spoken: initialData?.languages_spoken ?? [],
  };
}

export default function CompanionForm({
  onSubmit,
  initialData,
  isLoading = false
}: CompanionFormProps) {
  const [formData, setFormData] = useState<CompanionFormValues>(() => toFormValues(initialData));

  // Only replace the draft when a different profile is loaded. This preserves
  // values after a server validation error while still supporting navigation
  // between profiles in a mounted client boundary.
  useEffect(() => {
    setFormData(toFormValues(initialData));
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleArrayChange = (field: string, value: string[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prepare data for submission
    const dataToSubmit: CompanionFormValues = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      date_of_birth: formData.date_of_birth || null,
      languages_spoken: formData.languages_spoken,
    };

    await onSubmit(dataToSubmit);
  };

  return (
    <form onSubmit={handleSubmit} className="tb-form">
      <div>
        <SectionHeader
          title="Personal details"
          description="Keep your name and spoken languages up to date so your companion profile reflects you."
          icon="user"
        />
        <div className="tb-form-grid">
          <FormField label="First Name" htmlFor="first_name" required>
            <Input
              id="first_name"
              name="first_name"
              type="text"
              aria-label="First Name"
              autoComplete="given-name"
              value={formData.first_name}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField label="Last Name" htmlFor="last_name" required>
            <Input
              id="last_name"
              name="last_name"
              type="text"
              aria-label="Last Name"
              autoComplete="family-name"
              value={formData.last_name}
              onChange={handleChange}
              required
            />
          </FormField>
          <FormField label="Date of Birth" htmlFor="date_of_birth" hint="Optional. Your profile details are separate from document verification.">
            <Input
              id="date_of_birth"
              name="date_of_birth"
              type="date"
              autoComplete="bday"
              aria-describedby="date_of_birth-hint"
              value={formData.date_of_birth ?? ''}
              onChange={handleChange}
            />
          </FormField>
          <FormField
            label="Languages Spoken (comma-separated)"
            htmlFor="languages_spoken"
            hint="Enter languages like: English, Spanish, Mandarin"
          >
            <Input
              id="languages_spoken"
              name="languages_spoken"
              type="text"
              aria-describedby="languages_spoken-hint"
              value={formData.languages_spoken.join(', ')}
              onChange={(e) => handleArrayChange('languages_spoken',
                e.target.value.split(',').map(item => item.trim()).filter(item => item.length > 0)
              )}
            />
          </FormField>
        </div>
      </div>

      <div className="tb-form-actions">
        <SecondaryButton href="/dashboard/companions">Cancel</SecondaryButton>
        <PrimaryButton type="submit" disabled={isLoading} loading={isLoading} icon="check">
          {isLoading ? 'Saving...' : 'Save Companion Profile'}
        </PrimaryButton>
      </div>
    </form>
  );
}
