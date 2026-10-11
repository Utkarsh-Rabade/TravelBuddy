-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create auth.users mirror table (to store Clerk user data with role)
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('family_member', 'elderly_traveler', 'companion', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create families table
CREATE TABLE IF NOT EXISTS public.families (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_member_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create elderly_travelers table
CREATE TABLE IF NOT EXISTS public.elderly_travelers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID REFERENCES public.families(id) NOT NULL,
    traveler_user_id UUID REFERENCES auth.users(id), -- Nullable until traveler creates account
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    medical_conditions TEXT[] DEFAULT '{}',
    accessibility_needs TEXT[] DEFAULT '{}',
    emergency_contacts JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create companions table
CREATE TABLE IF NOT EXISTS public.companions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    languages_spoken TEXT[] NOT NULL DEFAULT '{}',
    availability_calendar JSONB DEFAULT '{}',
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'expired', 'rejected')),
    rating_average DECIMAL(3,2) DEFAULT 0.00,
    total_trips INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_role ON auth.users(role);
CREATE INDEX IF NOT EXISTS idx_families_family_member_id ON public.families(family_member_id);
CREATE INDEX IF NOT EXISTS idx_elderly_travelers_family_id ON public.elderly_travelers(family_id);
CREATE INDEX IF NOT EXISTS idx_elderly_travelers_traveler_user_id ON public.elderly_travelers(traveler_user_id);
CREATE INDEX IF NOT EXISTS idx_companions_user_id ON public.companions(user_id);
CREATE INDEX IF NOT EXISTS idx_companions_verification_status ON public.companions(verification_status);
CREATE INDEX IF NOT EXISTS idx_companions_rating_average ON public.companions(rating_average);

-- Enable Row Level Security
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elderly_travelers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companions ENABLE ROW LEVEL SECURITY;

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_auth_users_updated_at ON auth.users;
CREATE TRIGGER update_auth_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_families_updated_at ON public.families;
CREATE TRIGGER update_families_updated_at
    BEFORE UPDATE ON public.families
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_elderly_travelers_updated_at ON public.elderly_travelers;
CREATE TRIGGER update_elderly_travelers_updated_at
    BEFORE UPDATE ON public.elderly_travelers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_companions_updated_at ON public.companions;
CREATE TRIGGER update_companions_updated_at
    BEFORE UPDATE ON public.companions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
