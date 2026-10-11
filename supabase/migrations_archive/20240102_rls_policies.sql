-- Row Level Security Policies for auth.users
-- Users can only read their own data
CREATE POLICY "Users can view own data" ON auth.users
    FOR SELECT
    USING (auth.uid() = id);

-- Users can only update their own data
CREATE POLICY "Users can update own data" ON auth.users
    FOR UPDATE
    USING (auth.uid() = id);

-- Row Level Security Policies for public.families
-- Family members can view their own families
CREATE POLICY "Family members can view own families" ON public.families
    FOR SELECT
    USING (auth.uid() = family_member_id);

-- Family members can update their own families
CREATE POLICY "Family members can update own families" ON public.families
    FOR UPDATE
    USING (auth.uid() = family_member_id);

-- Family members can insert their own families
CREATE POLICY "Family members can insert own families" ON public.families
    FOR INSERT
    WITH CHECK (auth.uid() = family_member_id);

-- Row Level Security Policies for public.elderly_travelers
-- Family members can view travelers in their family
CREATE POLICY "Family members can view family travelers" ON public.elderly_travelers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
    );

-- Family members can view travelers linked to their user ID (for traveler self-view)
CREATE POLICY "Travelers can view own data" ON public.elderly_travelers
    FOR SELECT
    USING (auth.uid() = traveler_user_id);

-- Family members can update travelers in their family
CREATE POLICY "Family members can update family travelers" ON public.elderly_travelers
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
    );

-- Family members can insert travelers for their family
CREATE POLICY "Family members can insert family travelers" ON public.elderly_travelers
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.families
            WHERE id = family_id AND family_member_id = auth.uid()
        )
    );

-- Row Level Security Policies for public.companions
-- Companions can view their own data
CREATE POLICY "Companions can view own data" ON public.companions
    FOR SELECT
    USING (auth.uid() = user_id);

-- Companions can update their own data
CREATE POLICY "Companions can update own data" ON public.companions
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Companions can insert their own data
CREATE POLICY "Companions can insert own data" ON public.companions
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Public can view basic companion information (name, languages, rating) for verified companions only
CREATE POLICY "Public can view verified companions" ON public.companions
    FOR SELECT
    USING (
        verification_status = 'verified'
    );

-- Admins can view all data in all tables
CREATE POLICY "Admins can view all data" ON auth.users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can view all families" ON public.families
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can view all elderly travelers" ON public.elderly_travelers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can view all companions" ON public.companions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid() AND role = 'admin'
        )
    );
