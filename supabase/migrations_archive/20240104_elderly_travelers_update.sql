-- Add indexes for better query performance on elderly_travelers table
CREATE INDEX IF NOT EXISTS idx_elderly_travelers_family_id ON public.elderly_travelers(family_id);
CREATE INDEX IF NOT EXISTS idx_elderly_travelers_traveler_user_id ON public.elderly_travelers(traveler_user_id);

-- Add index for quick lookup of travelers by user ID
CREATE INDEX IF NOT EXISTS idx_elderly_travelers_user_id ON public.elderly_travelers(traveler_user_id) WHERE traveler_user_id IS NOT NULL;

-- Update RLS policies to allow travelers to view their own data
-- (This was already in the original policies, but ensuring it's correct)

DO $$
BEGIN
    -- Check if the policy "Travelers can view own data" exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'elderly_travelers' AND policyname = 'Travelers can view own data'
    ) THEN
        CREATE POLICY "Travelers can view own data" ON public.elderly_travelers
            FOR SELECT
            USING (auth.uid() = traveler_user_id);
    END IF;
END
$$;

-- Update the updated_at trigger function if needed
DROP TRIGGER IF EXISTS update_elderly_travelers_updated_at ON public.elderly_travelers;
CREATE TRIGGER update_elderly_travelers_updated_at
    BEFORE UPDATE ON public.elderly_travelers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();