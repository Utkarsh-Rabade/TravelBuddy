-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. families
CREATE TABLE IF NOT EXISTS public.families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_member_clerk_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. elderly_travelers
CREATE TABLE IF NOT EXISTS public.elderly_travelers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    traveler_clerk_id TEXT UNIQUE,  -- nullable until traveler creates a Clerk account
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    medical_conditions BYTEA,          -- encrypted array of text (pgp_sym_encrypt each element)
    accessibility_needs BYTEA,         -- encrypted array of text
    emergency_contacts BYTEA,          -- encrypted JSONB
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. companions
CREATE TABLE IF NOT EXISTS public.companions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_clerk_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    languages_spoken TEXT[] NOT NULL DEFAULT '{}',
    availability_calendar JSONB NOT NULL DEFAULT '{}',
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending','verified','expired','rejected')),
    rating_average DECIMAL(3,2) DEFAULT 0.00,
    total_trips INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. verifications
CREATE TABLE IF NOT EXISTS public.verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    document_storage_path TEXT NOT NULL,  -- reference to encrypted file in Supabase Storage
    background_check_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (background_check_status IN ('pending','passed','failed')),
    verified_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. trip_requests
CREATE TABLE IF NOT EXISTS public.trip_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    elderly_traveler_id UUID NOT NULL REFERENCES public.elderly_travelers(id) ON DELETE CASCADE,
    origin_airport TEXT NOT NULL CHECK (length(origin_airport) = 3),
    destination_airport TEXT NOT NULL CHECK (length(destination_airport) = 3),
    departure_date DATE NOT NULL,
    return_date DATE,
    assistance_level TEXT NOT NULL CHECK (assistance_level IN ('minimal','moderate','maximum')),
    language_requirements TEXT[] DEFAULT '{}',
    special_instructions TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','searching','matched','booked','in_progress','completed','cancelled','expired')),
    matching_criteria JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. match_attempts
CREATE TABLE IF NOT EXISTS public.match_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_request_id UUID NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
    companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
    score DECIMAL(5,2) NOT NULL,
    explanation JSONB,
    matched BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. bookings
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_request_id UUID NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
    companion_id UUID NOT NULL REFERENCES public.companions(id) ON DELETE CASCADE,
    booking_reference TEXT NOT NULL UNIQUE,
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending','paid','failed','refunded','partially_refunded')),
    status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed','cancelled_by_family','cancelled_by_companion','completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. payments
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    stripe_refund_id TEXT,
    amount_cents BIGINT NOT NULL,          -- stored in cents to avoid floating‑point
    currency TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('platform_fee','companion_payout','refund','charge')),
    status TEXT NOT NULL
        CHECK (status IN ('succeeded','failed','pending')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. trips
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NULL,
    current_location BYTEA,                -- encrypted JSONB {lat,lng,accuracy,timestamp}
    sos_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    last_check_in TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. trip_consents
CREATE TABLE IF NOT EXISTS public.trip_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    data_type TEXT NOT NULL
        CHECK (data_type IN ('medical','accessibility','emergency')),
    granted_by_clerk_id TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    notes TEXT
);

-- 11. trip_locations
CREATE TABLE IF NOT EXISTS public.trip_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy INTEGER NOT NULL,            -- meters
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. messages
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    sender_clerk_id TEXT NOT NULL,
    content TEXT NOT NULL,
    image_storage_path TEXT,              -- reference to encrypted file in Supabase Storage
    message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text','image','location')),
    read_by TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_clerk_id TEXT NOT NULL,
    type TEXT NOT NULL
        CHECK (type IN ('trip_update','payment','sos','reminder','promotional','system')),
    title TEXT NOT NULL,
    body BYTEA,                           -- encrypted JSONB if PII may be present
    data BYTEA,                           -- encrypted JSONB for extra context
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 14. sos_events
CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    triggered_by_clerk_id TEXT NOT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    location BYTEA NOT NULL,              -- encrypted JSONB {lat,lng,accuracy,timestamp}
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','acknowledged','resolved')),
    acknowledged_by_clerk_id TEXT NULL,
    acknowledged_at TIMESTAMPTZ NULL,
    resolved_by_clerk_id TEXT NULL,
    resolved_at TIMESTAMPTZ NULL,
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. ratings
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    rater_clerk_id TEXT NOT NULL,
    ratee_clerk_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_clerk_id TEXT NULL,                     -- nullable for system‑only actions
    action TEXT NOT NULL
        CHECK (action IN (
            'CREATE','UPDATE','DELETE','LOGIN','LOGOUT',
            'SOS_TRIGGER','SOS_ACKNOWLEDGE','SOS_RESOLVE',
            'PAYMENT','REFUND','ADMIN_OVERRIDE','VERIFICATION'
        )),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    changes BYTEA,                               -- encrypted JSONB diff (PII redacted before encrypt)
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 17. admin_roles (optional, if you prefer a table over JWT claim)
CREATE TABLE IF NOT EXISTS public.admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('super_admin','moderator','support')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
