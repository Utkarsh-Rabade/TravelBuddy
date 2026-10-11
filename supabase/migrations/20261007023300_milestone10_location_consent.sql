-- Milestone 10: location consent is a first-class trip consent.
-- Keep the existing table and all existing consent values; only extend the
-- data_type check that was missing location.
ALTER TABLE public.trip_consents
    DROP CONSTRAINT IF EXISTS trip_consents_data_type_check;

ALTER TABLE public.trip_consents
    ADD CONSTRAINT trip_consents_data_type_check
    CHECK (data_type IN ('medical', 'accessibility', 'emergency', 'location'));
