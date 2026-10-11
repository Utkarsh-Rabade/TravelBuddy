'use client';

import { useState } from 'react';
import { FormField, GlassCard, Input, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/app/ui';

export interface TravelerFormData {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  medical_conditions: string[];
  accessibility_needs: string[];
  emergency_contacts: {
    primary_name: string;
    primary_phone: string;
    secondary_name: string;
    secondary_phone: string;
  };
}

export type TravelerFormSubmit = TravelerFormData;

interface TravelerFormProps {
  onSubmit: (data: TravelerFormSubmit) => Promise<void>;
  initialData?: Omit<Partial<TravelerFormData>, 'date_of_birth' | 'emergency_contacts'> & {
    date_of_birth?: string | null;
    emergency_contacts?: TravelerFormData['emergency_contacts'] | null;
  };
  isLoading?: boolean;
  cancelHref?: string;
}

export default function TravelerForm({
  onSubmit,
  initialData,
  isLoading = false,
  cancelHref = '/dashboard/family/travelers'
}: TravelerFormProps) {
  const [formData, setFormData] = useState<TravelerFormData>({
    first_name: initialData?.first_name || '',
    last_name: initialData?.last_name || '',
    date_of_birth: initialData?.date_of_birth ?
      new Date(initialData.date_of_birth).toISOString().split('T')[0] : '',
    medical_conditions: initialData?.medical_conditions || [],
    accessibility_needs: initialData?.accessibility_needs || [],
    emergency_contacts: initialData?.emergency_contacts || {
      primary_name: '',
      primary_phone: '',
      secondary_name: '',
      secondary_phone: ''
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? e.target.checked : value
    }));
  };

  const handleArrayChange = (field: keyof TravelerFormData, value: string[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleObjectChange = <F extends keyof TravelerFormData>(field: F, subField: keyof TravelerFormData[F], value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: {
        ...(prev[field] as object),
        [subField]: value
      }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await onSubmit({
      ...formData,
      date_of_birth: formData.date_of_birth || '',
    });
  };

  return (
    <GlassCard>
      <SectionHeader
        title="Traveler information"
        description="Help your family plan around the person behind the journey. Fields marked with an asterisk are required."
        icon="user"
      />
      <form onSubmit={handleSubmit} className="tb-form" aria-busy={isLoading}>
        <fieldset className="tb-form-section">
          <legend>Personal details</legend>
          <div className="tb-stack">
            <p className="tb-muted tb-small">Use the traveler’s name as you would like it to appear on their profile.</p>
            <div className="tb-form-grid">
              <FormField label="First Name" htmlFor="first_name" required>
                <Input
                  id="first_name"
                  name="first_name"
                  type="text"
                  value={formData.first_name}
                  onChange={handleChange}
                  required
                  autoComplete="given-name"
                />
              </FormField>
              <FormField label="Last Name" htmlFor="last_name" required>
                <Input
                  id="last_name"
                  name="last_name"
                  type="text"
                  value={formData.last_name}
                  onChange={handleChange}
                  required
                  autoComplete="family-name"
                />
              </FormField>
              <FormField label="Date of Birth" htmlFor="date_of_birth" hint="Optional. You can add or update this later.">
                <Input
                  id="date_of_birth"
                  name="date_of_birth"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={handleChange}
                  autoComplete="bday"
                  aria-describedby="date_of_birth-hint"
                />
              </FormField>
            </div>
          </div>
        </fieldset>
        <fieldset className="tb-form-section">
          <legend>Assistance &amp; accessibility</legend>
          <div className="tb-stack">
            <p className="tb-muted tb-small">Record the needs that matter when arranging travel. Separate multiple items with commas.</p>
            <div className="tb-form-grid">
              <FormField
                label="Medical Conditions (comma-separated)"
                htmlFor="medical_conditions"
                hint="Enter conditions like: diabetes, heart condition, mobility issues"
              >
                <Input
                  id="medical_conditions"
                  name="medical_conditions"
                  type="text"
                  value={formData.medical_conditions.join(', ')}
                  onChange={(e) => handleArrayChange('medical_conditions',
                    e.target.value.split(',').map(item => item.trim()).filter(item => item.length > 0)
                  )}
                  aria-describedby="medical_conditions-hint"
                />
              </FormField>
              <FormField
                label="Accessibility Needs (comma-separated)"
                htmlFor="accessibility_needs"
                hint="Enter needs like: wheelchair assistance, hearing impairment, visual impairment"
              >
                <Input
                  id="accessibility_needs"
                  name="accessibility_needs"
                  type="text"
                  value={formData.accessibility_needs.join(', ')}
                  onChange={(e) => handleArrayChange('accessibility_needs',
                    e.target.value.split(',').map(item => item.trim()).filter(item => item.length > 0)
                  )}
                  aria-describedby="accessibility_needs-hint"
                />
              </FormField>
            </div>
          </div>
        </fieldset>
        <fieldset className="tb-form-section">
          <legend>Emergency Contact Information</legend>
          <div className="tb-stack">
            <p className="tb-muted tb-small">Add a primary contact who can be reached during travel. A second contact is optional.</p>
            <div className="tb-form-grid">
              <FormField label="Primary Contact Name" htmlFor="primary_name" required>
                <Input
                  id="primary_name"
                  name="primary_name"
                  type="text"
                  value={formData.emergency_contacts.primary_name}
                  onChange={(e) => handleObjectChange('emergency_contacts', 'primary_name', e.target.value)}
                  required
                  autoComplete="section-primary name"
                />
              </FormField>
              <FormField label="Primary Contact Phone" htmlFor="primary_phone" required>
                <Input
                  id="primary_phone"
                  name="primary_phone"
                  type="tel"
                  value={formData.emergency_contacts.primary_phone}
                  onChange={(e) => handleObjectChange('emergency_contacts', 'primary_phone', e.target.value)}
                  required
                  autoComplete="section-primary tel"
                />
              </FormField>
              <FormField label="Secondary Contact Name" htmlFor="secondary_name">
                <Input
                  id="secondary_name"
                  name="secondary_name"
                  type="text"
                  value={formData.emergency_contacts.secondary_name}
                  onChange={(e) => handleObjectChange('emergency_contacts', 'secondary_name', e.target.value)}
                  autoComplete="section-secondary name"
                />
              </FormField>
              <FormField label="Secondary Contact Phone" htmlFor="secondary_phone">
                <Input
                  id="secondary_phone"
                  name="secondary_phone"
                  type="tel"
                  value={formData.emergency_contacts.secondary_phone}
                  onChange={(e) => handleObjectChange('emergency_contacts', 'secondary_phone', e.target.value)}
                  autoComplete="section-secondary tel"
                />
              </FormField>
            </div>
          </div>
        </fieldset>
        <div className="tb-form-actions">
          <SecondaryButton href={cancelHref}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={isLoading} loading={isLoading} icon="check">
            {isLoading ? 'Saving...' : 'Save Traveler'}
          </PrimaryButton>
        </div>
      </form>
    </GlassCard>
  );
}
