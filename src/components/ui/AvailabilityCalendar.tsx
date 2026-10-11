import { useEffect, useState } from 'react';

import { DangerButton, Feedback, FormField, GlassCard, Input, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge } from '@/components/app/ui';
import type {
  CompanionAvailabilityCalendar as AvailabilityCalendarValue,
  CompanionAvailabilityRange,
  CompanionWeekday,
} from '@/lib/companion-types';

interface AvailabilityCalendarProps {
  value: AvailabilityCalendarValue;
  onChange?: (value: AvailabilityCalendarValue) => void;
  onSave?: (value: AvailabilityCalendarValue) => Promise<void>;
  isSaving?: boolean;
  error?: string | null;
}

const DAYS_OF_WEEK: { id: CompanionWeekday; label: string }[] = [
  { id: 'monday', label: 'Monday' },
  { id: 'tuesday', label: 'Tuesday' },
  { id: 'wednesday', label: 'Wednesday' },
  { id: 'thursday', label: 'Thursday' },
  { id: 'friday', label: 'Friday' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday', label: 'Sunday' },
];

function cloneCalendar(value: AvailabilityCalendarValue): AvailabilityCalendarValue {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([day, ranges]) => [
      day,
      (ranges as CompanionAvailabilityRange[]).map((range) => ({ start: range.start, end: range.end })),
    ]),
  );
}

export default function AvailabilityCalendar({ value, onChange, onSave, isSaving = false, error }: AvailabilityCalendarProps) {
  const [calendar, setCalendar] = useState<AvailabilityCalendarValue>(() => cloneCalendar(value));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setCalendar(cloneCalendar(value));
  }, [value]);

  const updateCalendar = (next: AvailabilityCalendarValue) => {
    setCalendar(next);
    onChange?.(next);
  };

  const handleTimeChange = (day: CompanionWeekday, index: number, field: 'start' | 'end', value: string) => {
    const ranges = [...(calendar[day] ?? [])];
    ranges[index] = { ...(ranges[index] ?? { start: '', end: '' }), [field]: value };
    updateCalendar({ ...calendar, [day]: ranges });
  };

  const handleAddTimeRange = (day: CompanionWeekday) => {
    updateCalendar({ ...calendar, [day]: [...(calendar[day] ?? []), { start: '', end: '' }] });
  };

  const handleRemoveTimeRange = (day: CompanionWeekday, index: number) => {
    updateCalendar({ ...calendar, [day]: (calendar[day] ?? []).filter((_, rangeIndex) => rangeIndex !== index) });
  };

  const handleSubmit = async () => {
    setValidationError(null);
    for (const day of DAYS_OF_WEEK) {
      const ranges = calendar[day.id] ?? [];
      for (const range of ranges) {
        if (!range.start || !range.end) {
          setValidationError(`${day.label} availability needs both a start and end time.`);
          return;
        }
        if (range.start >= range.end) {
          setValidationError(`${day.label} availability must end after it starts.`);
          return;
        }
      }
    }
    if (onSave) await onSave(calendar);
  };

  return (
    <section id="availability" aria-labelledby="availability-heading">
      <GlassCard className="tb-stack">
        <SectionHeader
          id="availability-heading"
          title="Availability Calendar"
          description="Build your weekly schedule with one or more time ranges each day. Each range must end after it starts. Save availability separately from your profile."
          icon="calendar"
        />

        {(validationError || error) && <Feedback tone="danger">{validationError || error}</Feedback>}

        <div className="tb-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          {DAYS_OF_WEEK.map(day => (
            <GlassCard key={day.id} className="tb-stack" aria-labelledby={`${day.id}-heading`}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="tb-min-zero">
                  <h3 id={`${day.id}-heading`} className="text-base font-semibold">{day.label}</h3>
                  <p className="tb-muted tb-small mt-1">Weekly availability</p>
                </div>
                <StatusBadge tone={calendar[day.id]?.length ? 'info' : 'neutral'}>
                  {calendar[day.id]?.length ? 'Time ranges added' : 'Not set'}
                </StatusBadge>
              </div>

              {calendar[day.id] && calendar[day.id].length > 0 ? (
                <div className="tb-stack">
                  {calendar[day.id].map((range, index) => (
                    <fieldset key={index} className="min-w-0 rounded-xl border border-white/10 p-4">
                      <legend className="tb-muted tb-small px-2">Time range {index + 1}</legend>
                      <div className="tb-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
                        <FormField
                          label={<span className="inline-flex min-h-11 items-center">Start Time</span>}
                          htmlFor={`${day.id}-${index}-start`}
                        >
                          <Input
                            id={`${day.id}-${index}-start`}
                            type="time"
                            className="min-w-0"
                            aria-label={`${day.label} start time`}
                            value={range.start || ''}
                            onChange={(e) => handleTimeChange(day.id, index, 'start', e.target.value)}
                          />
                        </FormField>
                        <FormField
                          label={<span className="inline-flex min-h-11 items-center">End Time</span>}
                          htmlFor={`${day.id}-${index}-end`}
                        >
                          <Input
                            id={`${day.id}-${index}-end`}
                            type="time"
                            className="min-w-0"
                            aria-label={`${day.label} end time`}
                            value={range.end || ''}
                            onChange={(e) => handleTimeChange(day.id, index, 'end', e.target.value)}
                          />
                        </FormField>
                      </div>
                      <div className="tb-actions mt-4">
                        <DangerButton type="button" icon="close" onClick={() => handleRemoveTimeRange(day.id, index)}>
                          Remove
                        </DangerButton>
                      </div>
                    </fieldset>
                  ))}
                </div>
              ) : (
                <p className="tb-muted tb-small">No time ranges set for this day. Click "Add Time Range" to set availability.</p>
              )}

              <div className="tb-actions">
                <SecondaryButton type="button" icon="plus" onClick={() => handleAddTimeRange(day.id)}>
                  Add Time Range
                </SecondaryButton>
              </div>
            </GlassCard>
          ))}
        </div>

        {onSave && <div className="tb-form-actions">
          <PrimaryButton type="button" onClick={handleSubmit} disabled={isSaving} loading={isSaving} icon="check">
            {isSaving ? 'Saving Availability...' : 'Save Availability'}
          </PrimaryButton>
        </div>}
      </GlassCard>
    </section>
  );
}
