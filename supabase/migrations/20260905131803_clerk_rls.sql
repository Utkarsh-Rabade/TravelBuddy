-- Helper: get current Clerk ID from JWT
-- (assumes a JWT claim 'sub' contains the Clerk ID)
CREATE OR REPLACE FUNCTION public.current_clerk_id()
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT auth.jwt()->>'sub';
$$;

-- families
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view own families"
    ON public.families FOR SELECT
    USING (family_member_clerk_id = current_clerk_id());
CREATE POLICY "Family members can update own families"
    ON public.families FOR UPDATE
    USING (family_member_clerk_id = current_clerk_id());
CREATE POLICY "Family members can insert own families"
    ON public.families FOR INSERT
    WITH CHECK (family_member_clerk_id = current_clerk_id());
-- Admin bypass (role claim)
CREATE POLICY "Admins can view all families"
    ON public.families FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all families"
    ON public.families FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert all families"
    ON public.families FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');

-- elderly_travelers
ALTER TABLE public.elderly_travelers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view travelers in their family"
    ON public.elderly_travelers FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = elderly_travelers.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Travelers can view own data"
    ON public.elderly_travelers FOR SELECT
    USING (traveler_clerk_id = current_clerk_id());
CREATE POLICY "Family members can update travelers in their family"
    ON public.elderly_travelers FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = elderly_travelers.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Travelers can update own data"
    ON public.elderly_travelers FOR UPDATE
    USING (traveler_clerk_id = current_clerk_id());
CREATE POLICY "Family members can insert travelers for their family"
    ON public.elderly_travelers FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = elderly_travelers.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
-- Admin bypass
CREATE POLICY "Admins can view all elderly travelers"
    ON public.elderly_travelers FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all elderly travelers"
    ON public.elderly_travelers FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert all elderly travelers"
    ON public.elderly_travelers FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');

-- companions
ALTER TABLE public.companions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Companions can view own data"
    ON public.companions FOR SELECT
    USING (user_clerk_id = current_clerk_id());
CREATE POLICY "Companions can update own data"
    ON public.companions FOR UPDATE
    USING (user_clerk_id = current_clerk_id());
CREATE POLICY "Companions can insert own data"
    ON public.companions FOR INSERT
    WITH CHECK (user_clerk_id = current_clerk_id());
CREATE POLICY "Public can view verified companions"
    ON public.companions FOR SELECT
    USING (verification_status = 'verified');
-- Admin bypass
CREATE POLICY "Admins can view all companions"
    ON public.companions FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all companions"
    ON public.companions FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert all companions"
    ON public.companions FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');

-- verifications
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Companions can view own verification"
    ON public.verifications FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.companions c
            WHERE c.id = verifications.companion_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Companions can update own verification (document upload only)"
    ON public.verifications FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.companions c
            WHERE c.id = verifications.companion_id
              AND c.user_clerk_id = current_clerk_id()
        )
    )
    WITH CHECK (background_check_status = 'pending');  -- only companions can set pending when uploading
CREATE POLICY "Admins can view all verifications"
    ON public.verifications FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all verifications"
    ON public.verifications FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert verifications"
    ON public.verifications FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');

-- trip_requests
ALTER TABLE public.trip_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view own trip requests"
    ON public.trip_requests FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = trip_requests.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Travelers can view own trip requests"
    ON public.trip_requests FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.elderly_travelers et
            WHERE et.id = trip_requests.elderly_traveler_id
              AND et.traveler_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can create trip requests for their family"
    ON public.trip_requests FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = trip_requests.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can update own trip requests (draft/searching only)"
    ON public.trip_requests FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = trip_requests.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
        AND status IN ('draft','searching')
    );
CREATE POLICY "Family members can delete own trip requests (draft/searching only)"
    ON public.trip_requests FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            WHERE f.id = trip_requests.family_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
        AND status IN ('draft','searching')
    );
-- Admin bypass
CREATE POLICY "Admins can view all trip_requests"
    ON public.trip_requests FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all trip_requests"
    ON public.trip_requests FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can delete all trip_requests"
    ON public.trip_requests FOR DELETE
    USING ((auth.jwt()->>'role') = 'admin');

-- match_attempts
ALTER TABLE public.match_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view match attempts for their trip requests"
    ON public.match_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            WHERE tr.id = match_attempts.trip_request_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Companions can view own match attempts"
    ON public.match_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.companions c
            WHERE c.id = match_attempts.companion_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can insert match attempts for their trip requests"
    ON public.match_attempts FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            WHERE tr.id = match_attempts.trip_request_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Admins can view all match_attempts"
    ON public.match_attempts FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all match_attempts"
    ON public.match_attempts FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert all match_attempts"
    ON public.match_attempts FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can delete all match_attempts"
    ON public.match_attempts FOR DELETE
    USING ((auth.jwt()->>'role') = 'admin');
-- bookings
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view own bookings"
    ON public.bookings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            WHERE tr.id = bookings.trip_request_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Companions can view own bookings"
    ON public.bookings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.companions c
            WHERE c.id = bookings.companion_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can update own bookings (cancel pre‑payment)"
    ON public.bookings FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.families f
            JOIN public.trip_requests tr ON tr.family_id = f.id
            WHERE tr.id = bookings.trip_request_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
        AND bookings.payment_status = 'pending'  -- only before payment
    );
CREATE POLICY "Companions can update own bookings (cancel post‑payment per policy)"
    ON public.bookings FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.companions c
            WHERE c.id = bookings.companion_id
              AND c.user_clerk_id = current_clerk_id()
        )
        AND bookings.payment_status = 'paid'  -- example rule; actual policy in app logic
    );
-- Admin bypass
CREATE POLICY "Admins can view all bookings"
    ON public.bookings FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all bookings"
    ON public.bookings FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can delete all bookings"
    ON public.bookings FOR DELETE
    USING ((auth.jwt()->>'role') = 'admin');

-- payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all payments"
    ON public.payments FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all payments"
    ON public.payments FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can insert all payments"
    ON public.payments FOR INSERT
    WITH CHECK ((auth.jwt()->>'role') = 'admin');
-- (Payments are primarily written by webhooks; they run as service_role, which bypasses RLS)

-- trips
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can view own trips"
    ON public.trips FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            JOIN public.bookings b ON b.trip_request_id = tr.id
            WHERE b.id = trips.booking_id
              AND f.family_member_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Companions can view own trips"
    ON public.trips FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.bookings b
            JOIN public.companions c ON b.companion_id = c.id
            WHERE b.id = trips.booking_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Companions can update location and check‑in"
    ON public.trips FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.bookings b
            JOIN public.companions c ON b.companion_id = c.id
            WHERE b.id = trips.booking_id
              AND c.user_clerk_id = current_clerk_id()
        )
    )
    WITH CHECK (TRUE);  -- actual column restrictions enforced by triggers/app logic
CREATE POLICY "Either party can trigger SOS"
    ON public.trips FOR UPDATE
    USING (
        (
            EXISTS (
                SELECT 1 FROM public.families f
                JOIN public.trip_requests tr ON tr.family_id = f.id
                JOIN public.bookings b ON b.trip_request_id = tr.id
                WHERE b.id = trips.booking_id
                  AND f.family_member_clerk_id = current_clerk_id()
            )
            OR
            EXISTS (
                SELECT 1 FROM public.bookings b
                JOIN public.companions c ON b.companion_id = c.id
                WHERE b.id = trips.booking_id
                  AND c.user_clerk_id = current_clerk_id()
            )
        )
    )
    WITH CHECK (sos_triggered = TRUE);  -- only allow setting to true; clearing handled elsewhere
-- Admin bypass
CREATE POLICY "Admins can view all trips"
    ON public.trips FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all trips"
    ON public.trips FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');

-- trip_consents
ALTER TABLE public.trip_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members can grant consents for own trips"
    ON public.trip_consents FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
            WHERE f.family_member_clerk_id = current_clerk_id()
              AND t.id = trip_consents.trip_id
        )
    );
CREATE POLICY "Travelers can grant consents for own trips"
    ON public.trip_consents FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.elderly_travelers et
            WHERE et.id = (SELECT elderly_traveler_id FROM public.trip_requests WHERE id = (SELECT trip_request_id FROM public.bookings WHERE id = (SELECT trip_id FROM public.trips WHERE id = trip_consents.trip_id)))
              AND et.traveler_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can update/revoke own consents"
    ON public.trip_consents FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
            WHERE f.family_member_clerk_id = current_clerk_id()
              AND t.id = trip_consents.trip_id
        )
    );
CREATE POLICY "Travelers can update/revoke own consents"
    ON public.trip_consents FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.elderly_travelers et
            WHERE et.id = (SELECT elderly_traveler_id FROM public.trip_requests WHERE id = (SELECT trip_request_id FROM public.bookings WHERE id = (SELECT trip_id FROM public.trips WHERE id = trip_consents.trip_id)))
              AND et.traveler_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can delete own consents"
    ON public.trip_consents FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
            WHERE f.family_member_clerk_id = current_clerk_id()
              AND t.id = trip_consents.trip_id
        )
    );
CREATE POLICY "Travelers can delete own consents"
    ON public.trip_consents FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.elderly_travelers et
            WHERE et.id = (SELECT elderly_traveler_id FROM public.trip_requests WHERE id = (SELECT trip_request_id FROM public.bookings WHERE id = (SELECT trip_id FROM public.trips WHERE id = trip_consents.trip_id)))
              AND et.traveler_clerk_id = current_clerk_id()
        )
    );
-- Companions can only read consents for trips they are on
CREATE POLICY "Companions can view consents for assigned trips"
    ON public.trip_consents FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.bookings b
            JOIN public.companions c ON b.companion_id = c.id
            WHERE b.trip_request_id = (SELECT trip_request_id FROM public.trip_requests WHERE id = (SELECT trip_id FROM public.trips WHERE id = trip_consents.trip_id))
              AND c.user_clerk_id = current_clerk_id()
        )
    );
-- Admin bypass
CREATE POLICY "Admins can view all trip_consents"
    ON public.trip_consents FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all trip_consents"
    ON public.trip_consents FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can delete all trip_consents"
    ON public.trip_consents FOR DELETE
    USING ((auth.jwt()->>'role') = 'admin');

-- trip_locations
ALTER TABLE public.trip_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Companions can insert location points for own trips"
    ON public.trip_locations FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.bookings b ON b.id = t.booking_id
            JOIN public.companions c ON c.id = b.companion_id
            WHERE t.id = trip_locations.trip_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
CREATE POLICY "Family members can view location points of own trips"
    ON public.trip_locations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trip_requests tr
            JOIN public.families f ON tr.family_id = f.id
            JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
            WHERE f.family_member_clerk_id = current_clerk_id()
              AND t.id = trip_locations.trip_id
        )
    );
CREATE POLICY "Companions can view location points of own trips"
    ON public.trip_locations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.bookings b ON b.id = t.booking_id
            JOIN public.companions c ON c.id = b.companion_id
            WHERE t.id = trip_locations.trip_id
              AND c.user_clerk_id = current_clerk_id()
        )
    );
-- Admin bypass
CREATE POLICY "Admins can view all trip_locations"
    ON public.trip_locations FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');

-- messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view messages of trips they are part of"
    ON public.messages FOR SELECT
    USING (
        (
            EXISTS (
                SELECT 1 FROM public.families f
                JOIN public.trip_requests tr ON tr.family_id = f.id
                JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
                WHERE f.family_member_clerk_id = current_clerk_id()
                  AND t.id = messages.trip_id
            )
            OR
            EXISTS (
                SELECT 1 FROM public.bookings b
                JOIN public.companions c ON b.companion_id = c.id
                WHERE b.trip_request_id = (SELECT trip_request_id FROM public.trip_requests WHERE id = (SELECT trip_id FROM public.trips WHERE id = messages.trip_id))
                  AND c.user_clerk_id = current_clerk_id()
            )
        )
    );
CREATE POLICY "Senders can update/delete own messages (within time window)"
    ON public.messages FOR UPDATE
    USING (sender_clerk_id = current_clerk_id());
    -- time‑window check enforced by application logic or a trigger
CREATE POLICY "Senders can delete own messages"
    ON public.messages FOR DELETE
    USING (sender_clerk_id = current_clerk_id());
-- Admin bypass
CREATE POLICY "Admins can view all messages"
    ON public.messages FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');

-- notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notifications"
    ON public.notifications FOR SELECT
    USING (user_clerk_id = current_clerk_id());
CREATE POLICY "Users can mark own notifications as read"
    ON public.notifications FOR UPDATE
    USING (user_clerk_id = current_clerk_id());
-- Admin bypass
CREATE POLICY "Admins can view all notifications"
    ON public.notifications FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');

-- sos_events
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Either party can view SOS events of trips they are part of"
    ON public.sos_events FOR SELECT
    USING (
            EXISTS (
                SELECT 1 FROM public.families f
                    JOIN public.trip_requests tr ON tr.family_id = f.id
                    JOIN public.trips t ON t.booking_id = (SELECT id FROM public.bookings WHERE trip_request_id = tr.id)
                    WHERE f.family_member_clerk_id = current_clerk_id()
                      AND t.id = sos_events.trip_id
                )
            OR
            EXISTS (
                SELECT 1 FROM public.bookings b
                    JOIN public.companions c ON b.companion_id = c.id
                    WHERE b.trip_request_id = (SELECT trip_request_id FROM public.trip_requests WHERE id = (SELECT trip_id FROM public.trips WHERE id = sos_events.trip_id))
                    AND c.user_clerk_id = current_clerk_id()
                )
        );
CREATE POLICY "Either party can update own SOS event fields"
    ON public.sos_events FOR UPDATE
    USING (
        (
            triggered_by_clerk_id = current_clerk_id()
            AND status IN ('active','acknowledged')
        )
        OR
        (
            acknowledged_by_clerk_id = current_clerk_id()
            AND status = 'acknowledged'
        )
        OR
        (
            resolved_by_clerk_id = current_clerk_id()
            AND status = 'resolved'
        )
    );
-- Admin bypass
CREATE POLICY "Admins can view all sos_events"
    ON public.sos_events FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all sos_events"
    ON public.sos_events FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');

-- ratings
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own ratings"
    ON public.ratings FOR SELECT
    USING (rater_clerk_id = current_clerk_id());
CREATE POLICY "Users can update/delete own ratings (within window)"
    ON public.ratings FOR UPDATE
    USING (rater_clerk_id = current_clerk_id());
    -- time‑window enforced by app/trigger
CREATE POLICY "Users can delete own ratings"
    ON public.ratings FOR DELETE
    USING (rater_clerk_id = current_clerk_id());
-- Companions see only aggregate; no direct SELECT on ratings
-- Admin bypass
CREATE POLICY "Admins can view all ratings"
    ON public.ratings FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can update all ratings"
    ON public.ratings FOR UPDATE
    USING ((auth.jwt()->>'role') = 'admin');
CREATE POLICY "Admins can delete all ratings"
    ON public.ratings FOR DELETE
    USING ((auth.jwt()->>'role') = 'admin');

-- audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all audit logs"
    ON public.audit_logs FOR SELECT
    USING ((auth.jwt()->>'role') = 'admin');
-- No insert/update/delete policies for regular users; only system/triggers insert.

-- admin_roles (if used)
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view own admin role"
    ON public.admin_roles FOR SELECT
    USING (clerk_id = current_clerk_id());
CREATE POLICY "Super admins can view all admin roles"
    ON public.admin_roles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_roles ar
            WHERE ar.clerk_id = current_clerk_id()
              AND ar.role = 'super_admin'
        )
    );
CREATE POLICY "Super admins can insert/update/delete admin roles"
    ON public.admin_roles FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_roles ar
            WHERE ar.clerk_id = current_clerk_id()
              AND ar.role = 'super_admin'
        )
    );
