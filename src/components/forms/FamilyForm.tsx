"use client";

import { useState } from 'react';
import { FormField, GlassCard, Input, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/app/ui';

interface FamilyFormProps {
  onSubmit: (data: { name: string }) => Promise<void>;
  initialData?: { name: string };
  isLoading?: boolean;
  cancelHref?: string;
}

export default function FamilyForm({
  onSubmit,
  initialData,
  isLoading = false,
  cancelHref = '/dashboard/family'
}: FamilyFormProps) {
  const [formData, setFormData] = useState({
    name: initialData?.name || ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  return (
    <GlassCard>
      <SectionHeader
        title="Family identity"
        description="A familiar name for the people and journeys you organize together."
        icon="home"
      />
      <form onSubmit={handleSubmit} className="tb-form" aria-busy={isLoading}>
        <FormField
          label="Family Name"
          htmlFor="name"
          required
          hint="Choose a name between 2 and 120 characters."
        >
          <Input
            id="name"
            name="name"
            type="text"
            value={formData.name}
            onChange={handleChange}
            required
            aria-describedby="name-hint"
            placeholder="e.g. The Sharma Family"
          />
        </FormField>
        <div className="tb-form-actions">
          <SecondaryButton href={cancelHref}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={isLoading} loading={isLoading} icon="check">
            {isLoading ? 'Saving...' : 'Save Family'}
          </PrimaryButton>
        </div>
      </form>
    </GlassCard>
  );
}
