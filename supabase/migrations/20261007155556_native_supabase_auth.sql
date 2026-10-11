-- Forward-only native Auth boundary. Existing rows, TEXT ownership columns,
-- entity keys, encrypted payloads and historical migration files are untouched.
-- No legacy account is linked automatically; new owners store auth.uid()::text.

CREATE TABLE public.app_user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('family', 'companion')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_user_roles TO authenticated;
GRANT INSERT (user_id, role) ON public.app_user_roles TO authenticated;
GRANT ALL ON public.app_user_roles TO service_role;
CREATE POLICY "Read own onboarding role" ON public.app_user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Choose own non-admin role once" ON public.app_user_roles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND role IN ('family', 'companion'));
-- No UPDATE/DELETE grants or policies: role selection is immutable for users.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

-- Narrow internal membership lookup avoids recursive admin_roles policies.
-- It is NOT exposed as a Data API RPC, takes no supplied identity, and returns
-- only the caller's role. Every lookup checks the native, signed auth.uid().
CREATE FUNCTION app_private.current_app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN (SELECT auth.uid()) IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.admin_roles a WHERE a.clerk_id = (SELECT auth.uid())::text)
      THEN 'admin'
    ELSE (SELECT r.role FROM public.app_user_roles r WHERE r.user_id = (SELECT auth.uid())) END;
$$;
CREATE FUNCTION app_private.owns_family(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (SELECT app_private.current_app_role()) = 'family'
    AND EXISTS (SELECT 1 FROM public.families f
      WHERE f.id = target AND f.family_member_clerk_id = (SELECT auth.uid())::text);
$$;
CREATE FUNCTION app_private.owns_companion(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (SELECT app_private.current_app_role()) = 'companion'
    AND EXISTS (SELECT 1 FROM public.companions c
      WHERE c.id = target AND c.user_clerk_id = (SELECT auth.uid())::text);
$$;
CREATE FUNCTION app_private.owns_request(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (SELECT 1 FROM public.trip_requests r
    WHERE r.id = target AND app_private.owns_family(r.family_id));
$$;
CREATE FUNCTION app_private.booking_participant(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings b JOIN public.trip_requests r ON r.id = b.trip_request_id
    WHERE b.id = target AND (app_private.owns_family(r.family_id) OR app_private.owns_companion(b.companion_id)));
$$;
CREATE FUNCTION app_private.trip_participant(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (SELECT 1 FROM public.trips t
    WHERE t.id = target AND app_private.booking_participant(t.booking_id));
$$;
CREATE FUNCTION app_private.location_visible(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND app_private.trip_participant(target) AND EXISTS (
    SELECT 1 FROM public.trip_consents c
    JOIN public.trips t ON t.id = c.trip_id
    JOIN public.bookings b ON b.id = t.booking_id
    JOIN public.trip_requests r ON r.id = b.trip_request_id
    JOIN public.families f ON f.id = r.family_id
    WHERE c.trip_id = target AND c.data_type = 'location' AND c.revoked_at IS NULL
      AND (c.expires_at IS NULL OR c.expires_at > now())
      AND c.granted_by_clerk_id = f.family_member_clerk_id);
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO authenticated, service_role;

-- Retain compatibility for SQL consumers, with a fixed search path.
ALTER FUNCTION public.current_clerk_id() SET search_path = '';

-- Replace the inspected legacy policies ONLY on the 17 original app tables.
-- Policies/grants change, not tables or data. Trusted lifecycle writes stay in
-- server workflows rather than allowing clients to forge scores/payments/SOS.
DO $$
DECLARE p record; t text;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY['families','elderly_travelers','companions','verifications',
      'trip_requests','match_attempts','bookings','payments','trips','trip_consents',
      'trip_locations','messages','notifications','sos_events','ratings','audit_logs','admin_roles'])
  LOOP EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename); END LOOP;
  FOREACH t IN ARRAY ARRAY['families','elderly_travelers','companions','verifications',
    'trip_requests','match_attempts','bookings','payments','trips','trip_consents',
    'trip_locations','messages','notifications','sos_events','ratings','audit_logs','admin_roles']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "Native admin read" ON public.%I FOR SELECT TO authenticated USING ((SELECT app_private.current_app_role()) = ''admin'')', t);
  END LOOP;
END $$;

CREATE POLICY "Read own native family" ON public.families FOR SELECT TO authenticated
  USING (app_private.owns_family(id));
CREATE POLICY "Create own native family" ON public.families FOR INSERT TO authenticated
  WITH CHECK (family_member_clerk_id = (SELECT auth.uid())::text AND (SELECT app_private.current_app_role()) = 'family');
CREATE POLICY "Edit own native family" ON public.families FOR UPDATE TO authenticated
  USING (app_private.owns_family(id))
  WITH CHECK (family_member_clerk_id = (SELECT auth.uid())::text AND (SELECT app_private.current_app_role()) = 'family');
GRANT INSERT (id, family_member_clerk_id, name) ON public.families TO authenticated;
GRANT UPDATE (name, updated_at) ON public.families TO authenticated;

CREATE POLICY "Read own family travelers" ON public.elderly_travelers FOR SELECT TO authenticated
  USING (app_private.owns_family(family_id));
CREATE POLICY "Create own family traveler" ON public.elderly_travelers FOR INSERT TO authenticated
  WITH CHECK (app_private.owns_family(family_id) AND traveler_clerk_id IS NULL);
CREATE POLICY "Edit own family traveler" ON public.elderly_travelers FOR UPDATE TO authenticated
  USING (app_private.owns_family(family_id)) WITH CHECK (app_private.owns_family(family_id));
GRANT INSERT (id, family_id, traveler_clerk_id, first_name, last_name, date_of_birth,
  medical_conditions, accessibility_needs, emergency_contacts) ON public.elderly_travelers TO authenticated;
GRANT UPDATE (first_name, last_name, date_of_birth, medical_conditions, accessibility_needs,
  emergency_contacts, updated_at) ON public.elderly_travelers TO authenticated;

CREATE POLICY "Read own native companion" ON public.companions FOR SELECT TO authenticated
  USING (app_private.owns_companion(id));
CREATE POLICY "Create own native companion" ON public.companions FOR INSERT TO authenticated
  WITH CHECK (user_clerk_id = (SELECT auth.uid())::text AND (SELECT app_private.current_app_role()) = 'companion'
    AND verification_status = 'pending' AND rating_average = 0 AND total_trips = 0);
CREATE POLICY "Edit own basic companion profile" ON public.companions FOR UPDATE TO authenticated
  USING (app_private.owns_companion(id))
  WITH CHECK (user_clerk_id = (SELECT auth.uid())::text AND (SELECT app_private.current_app_role()) = 'companion');
GRANT INSERT (id, user_clerk_id, first_name, last_name, date_of_birth, languages_spoken,
  availability_calendar) ON public.companions TO authenticated;
GRANT UPDATE (first_name, last_name, date_of_birth, languages_spoken, availability_calendar,
  updated_at) ON public.companions TO authenticated;
-- Verification/reputation/owner fields have NO authenticated write privileges.
-- The verified catalogue is a role-guarded, sanitized server projection, not
-- a full-row public SELECT policy exposing DOB and account identity.

CREATE POLICY "Read own KYC metadata" ON public.verifications FOR SELECT TO authenticated
  USING (app_private.owns_companion(companion_id));

CREATE POLICY "Read own native requests" ON public.trip_requests FOR SELECT TO authenticated
  USING (app_private.owns_family(family_id));
CREATE POLICY "Create own draft request" ON public.trip_requests FOR INSERT TO authenticated
  WITH CHECK (app_private.owns_family(family_id) AND status = 'draft' AND EXISTS (
    SELECT 1 FROM public.elderly_travelers e WHERE e.id = elderly_traveler_id AND e.family_id = trip_requests.family_id));
CREATE POLICY "Edit own draft or searching request" ON public.trip_requests FOR UPDATE TO authenticated
  USING (app_private.owns_family(family_id) AND status IN ('draft', 'searching'))
  WITH CHECK (app_private.owns_family(family_id) AND status IN ('draft', 'searching') AND EXISTS (
    SELECT 1 FROM public.elderly_travelers e WHERE e.id = elderly_traveler_id AND e.family_id = trip_requests.family_id));
GRANT INSERT (id, family_id, elderly_traveler_id, origin_airport, destination_airport, departure_date,
  return_date, assistance_level, language_requirements, special_instructions, status) ON public.trip_requests TO authenticated;
GRANT UPDATE (elderly_traveler_id, origin_airport, destination_airport, departure_date, return_date,
  assistance_level, language_requirements, special_instructions, status, updated_at) ON public.trip_requests TO authenticated;

CREATE POLICY "Read participant matching attempts" ON public.match_attempts FOR SELECT TO authenticated
  USING (app_private.owns_request(trip_request_id) OR app_private.owns_companion(companion_id));
CREATE POLICY "Read participant bookings" ON public.bookings FOR SELECT TO authenticated
  USING (app_private.booking_participant(id));
CREATE POLICY "Read participant payment summary" ON public.payments FOR SELECT TO authenticated
  USING (app_private.booking_participant(booking_id));
CREATE POLICY "Read participant trips" ON public.trips FOR SELECT TO authenticated
  USING (app_private.booking_participant(booking_id));
CREATE POLICY "Read participant consents" ON public.trip_consents FOR SELECT TO authenticated
  USING (app_private.trip_participant(trip_id));
CREATE POLICY "Read consented participant location" ON public.trip_locations FOR SELECT TO authenticated
  USING (app_private.location_visible(trip_id));
CREATE POLICY "Read participant chat" ON public.messages FOR SELECT TO authenticated
  USING (app_private.trip_participant(trip_id));
CREATE POLICY "Read participant SOS" ON public.sos_events FOR SELECT TO authenticated
  USING (app_private.trip_participant(trip_id));
CREATE POLICY "Read participant ratings" ON public.ratings FOR SELECT TO authenticated
  USING (app_private.trip_participant(trip_id));
-- Deliberately no direct lifecycle/chat/rating/safety writes. Server actions
-- check complete relationships, consent, transition rules and idempotency.

CREATE POLICY "Read own native notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_clerk_id = (SELECT auth.uid())::text);
CREATE POLICY "Mark own native notification read" ON public.notifications FOR UPDATE TO authenticated
  USING (user_clerk_id = (SELECT auth.uid())::text)
  WITH CHECK (user_clerk_id = (SELECT auth.uid())::text);
GRANT UPDATE (is_read, read_at) ON public.notifications TO authenticated;

-- Self-read supports role resolution during onboarding. No recursive lookup,
-- no user INSERT/UPDATE/DELETE and no user-accessible admin-assignment RPC.
CREATE POLICY "Read own protected admin membership" ON public.admin_roles FOR SELECT TO authenticated
  USING (clerk_id = (SELECT auth.uid())::text);

NOTIFY pgrst, 'reload schema';
