'use client';

import { useRef, useState } from 'react';
import type { TripRequestDTO, TripRequestInput, TripTravelerOption } from '@/lib/trip-request-types';
import { FormField, Input, PrimaryButton, SecondaryButton, Select, Textarea } from '@/components/app/ui';

type FormValues = Omit<TripRequestInput, 'return_date' | 'special_instructions'> & {
  return_date: string;
  special_instructions: string;
};

interface TripRequestFormProps {
  onSubmit: (data: TripRequestInput) => Promise<void>;
  initialData?: TripRequestDTO;
  isLoading?: boolean;
  travelers?: TripTravelerOption[];
}

export default function TripRequestForm({
  onSubmit,
  initialData,
  isLoading = false,
  travelers = []
}: TripRequestFormProps) {
  const [formData, setFormData] = useState<FormValues>(() => ({
    elderly_traveler_id: initialData?.elderly_traveler_id ?? '',
    origin_airport: initialData?.origin_airport ?? '',
    destination_airport: initialData?.destination_airport ?? '',
    departure_date: initialData?.departure_date.slice(0, 10) ?? '',
    return_date: initialData?.return_date?.slice(0, 10) ?? '',
    assistance_level: initialData?.assistance_level ?? 'minimal',
    language_requirements: initialData?.language_requirements ?? [],
    special_instructions: initialData?.special_instructions ?? '',
    ...(initialData ? { status: initialData.status === 'searching' ? 'searching' : 'draft' } : {})
  }));
  const [languages, setLanguages] = useState(() => initialData?.language_requirements.join(', ') ?? '');
  const submitting = useRef(false);

  const handleChange = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || submitting.current) return;
    submitting.current = true;
    try {
      await onSubmit({
        ...formData,
        origin_airport: formData.origin_airport.trim().toUpperCase(),
        destination_airport: formData.destination_airport.trim().toUpperCase(),
        return_date: formData.return_date || null,
        special_instructions: formData.special_instructions.trim() || null,
        language_requirements: languages.split(',').map(item => item.trim()).filter(Boolean)
      });
    } finally {
      submitting.current = false;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="tb-form">
      <fieldset className="tb-form-section tb-stack">
        <legend>Traveler</legend>
        <p className="tb-muted tb-small">Choose the person this journey is for.</p>
        <FormField label="Traveler" htmlFor="elderly_traveler_id" required>
          <Select
            id="elderly_traveler_id"
            name="elderly_traveler_id"
            aria-label="Traveler"
            value={formData.elderly_traveler_id}
            onChange={(e) => handleChange('elderly_traveler_id', e.target.value)}
            required
          >
            <option value="">Select a traveler</option>
            {travelers.map((traveler) => (
              <option key={traveler.id} value={traveler.id}>
                {traveler.first_name} {traveler.last_name}
              </option>
            ))}
          </Select>
        </FormField>
      </fieldset>

      <fieldset className="tb-form-section tb-stack">
        <legend>Route &amp; travel dates</legend>
        <p className="tb-muted tb-small">Add the airport-to-airport route and the dates you need support.</p>
        <div className="tb-form-grid">
          <FormField label="Origin Airport (IATA Code)" htmlFor="origin_airport" required hint="Enter the 3-letter IATA code (e.g., JFK, LAX, LHR)">
            <Input
              id="origin_airport"
              name="origin_airport"
              aria-label="Origin Airport (IATA Code)"
              type="text"
              value={formData.origin_airport}
              onChange={(e) => handleChange('origin_airport', e.target.value)}
              required
              maxLength={3}
              className="uppercase"
              aria-describedby="origin_airport-hint"
            />
          </FormField>

          <FormField label="Destination Airport (IATA Code)" htmlFor="destination_airport" required hint="Enter the 3-letter IATA code (e.g., JFK, LAX, LHR)">
            <Input
              id="destination_airport"
              name="destination_airport"
              aria-label="Destination Airport (IATA Code)"
              type="text"
              value={formData.destination_airport}
              onChange={(e) => handleChange('destination_airport', e.target.value)}
              required
              maxLength={3}
              className="uppercase"
              aria-describedby="destination_airport-hint"
            />
          </FormField>
        </div>

        <div className="tb-form-grid">
          <FormField label="Departure Date" htmlFor="departure_date" required>
            <Input
              id="departure_date"
              name="departure_date"
              aria-label="Departure Date"
              type="date"
              value={formData.departure_date}
              onChange={(e) => handleChange('departure_date', e.target.value)}
              required
            />
          </FormField>

          <FormField label="Return Date (optional for one-way)" htmlFor="return_date" hint="Leave this empty for a one-way journey.">
            <Input
              id="return_date"
              name="return_date"
              type="date"
              value={formData.return_date}
              onChange={(e) => handleChange('return_date', e.target.value)}
              aria-describedby="return_date-hint"
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="tb-form-section tb-stack">
        <legend>Assistance &amp; preferences</legend>
        <p className="tb-muted tb-small">Help companions understand the traveler&apos;s needs.</p>
        <FormField label="Assistance Level" htmlFor="assistance_level" hint={<>Minimal: Basic mobility help<br />Moderate: Assistance with boarding, transfers, toileting<br />Maximum: Continuous personal care and medical assistance</>}>
          <Select
            id="assistance_level"
            name="assistance_level"
            value={formData.assistance_level}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'minimal' || value === 'moderate' || value === 'maximum') handleChange('assistance_level', value);
            }}
            aria-describedby="assistance_level-hint"
          >
            <option value="minimal">Minimal Assistance</option>
            <option value="moderate">Moderate Assistance</option>
            <option value="maximum">Maximum Assistance</option>
          </Select>
        </FormField>

        <FormField label="Language Requirements (comma-separated)" htmlFor="language_requirements" hint="Enter languages like: English, Spanish, Mandarin, ASL">
          <Input
            id="language_requirements"
            name="language_requirements"
            type="text"
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            aria-describedby="language_requirements-hint"
          />
        </FormField>

        <FormField label="Special Instructions" htmlFor="special_instructions" hint="Any additional information about the traveler's needs, preferences, or requirements">
          <Textarea
            id="special_instructions"
            name="special_instructions"
            rows={4}
            value={formData.special_instructions}
            onChange={(e) => handleChange('special_instructions', e.target.value)}
            aria-describedby="special_instructions-hint"
          />
        </FormField>
      </fieldset>

      {initialData && (
        <fieldset className="tb-form-section">
          <legend>Request status</legend>
          <FormField label="Status" htmlFor="status">
            <Select
              id="status"
              name="status"
              value={formData.status}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'draft' || value === 'searching') handleChange('status', value);
              }}
            >
              <option value="draft">Draft</option>
              <option value="searching">Searching</option>
            </Select>
          </FormField>
        </fieldset>
      )}

      <div className="tb-form-actions">
        <SecondaryButton href="/dashboard/family/trip-requests">Cancel</SecondaryButton>
        <PrimaryButton
          type="submit"
          disabled={isLoading}
          loading={isLoading}
          icon={initialData ? 'check' : 'plus'}
        >
          {isLoading ? (initialData ? 'Saving Request...' : 'Creating Request...') : (initialData ? 'Save Trip Request' : 'Create Trip Request')}
        </PrimaryButton>
      </div>
    </form>
  );
}
