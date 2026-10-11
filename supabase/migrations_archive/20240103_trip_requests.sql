-- Create trip_requests table
CREATE TABLE IF NOT EXISTS public.trip_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID REFERENCES public.families(id) NOT NULL,
    elderly_traveler_id UUID REFERENCES public.elderly_travelers(id) NOT NULL,
    origin_airport TEXT NOT NULL CHECK (length(origin_airport) = 3),
    destination_airport TEXT NOT NULL CHECK (length(destination_airport) = 3),
    departure_date DATE NOT NULL,
    return_date DATE,
    assistance_level TEXT NOT NULL CHECK (assistance_level IN ('minimal', 'moderate', 'maximum')),
    language_requirements TEXT[] DEFAULT '{}',
    special_instructions TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'searching', 'matched', 'booked', 'in_progress', 'completed', 'cancelled', 'expired')),
    matching_criteria JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trip_requests_family_id ON public.trip_requests(family_id);
CREATE INDEX IF NOT EXISTS idx_trip_requests_elderly_traveler_id ON public.trip_requests(elderly_traveler_id);
CREATE INDEX IF NOT EXISTS idx_trip_requests_status ON public.trip_requests(status);
CREATE INDEX IF NOT EXISTS idx_trip_requests_departure_date ON public.trip_requests(departure_date);
CREATE INDEX IF NOT EXISTS idx_trip_requests_origin_destination ON public.trip_requests(origin_airport, destination_airport);
CREATE INDEX IF NOT EXISTS idx_trip_requests_status_departure ON public.trip_requests(status, departure_date);

-- Enable Row Level Security
ALTER TABLE public.trip_requests ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_trip_requests_updated_at ON public.trip_requests;
CREATE TRIGGER update_trip_requests_updated_at
    BEFORE UPDATE ON public.trip_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security Policies for public.trip_requests
-- Family members can view trip requests for their family
CREATE POLICY "Family members can view family trip requests" ON public.trip_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
    );

-- Family members can view trip requests linked to their user ID (for traveler self-view)
CREATE POLICY "Travelers can view own trip requests" ON public.trip_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.elderly_travelers
            WHERE id = elderly_traveler_id AND traveler_user_id = auth.uid()
        )
    );

-- Family members can create trip requests for their family
CREATE POLICY "Family members can create family trip requests" ON public.trip_requests
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
    );

-- Family members can update trip requests for their family (only in draft/searching states)
CREATE POLICY "Family members can update own trip requests" ON public.trip_requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
        AND status IN ('draft', 'searching')
    );

-- Family members can delete trip requests for their family (only in draft/searching states)
CREATE POLICY "Family members can delete own trip requests" ON public.trip_requests
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
        AND status IN ('draft', 'searching')
    );

-- Companions can view trip requests when they are matched or booked (assigned to them)
-- This will be implemented after we add companion_id to trip_requests or bookings table
-- For now, companions can't directly access trip requests

-- Admins can view all trip requests
CREATE POLICY "Admins can view all trip requests" ON public.trip_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid() AND role = 'admin'
        )
    );