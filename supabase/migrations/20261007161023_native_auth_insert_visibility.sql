-- INSERT ... RETURNING evaluates SELECT policies on the new row. A STABLE
-- same-table lookup uses the pre-statement snapshot and cannot see that row.
-- Check its owner directly instead; keep private helpers for cross-table joins.
ALTER POLICY "Read own native family" ON public.families
  USING (family_member_clerk_id = (SELECT auth.uid())::text
    AND (SELECT app_private.current_app_role()) = 'family');
ALTER POLICY "Read own native companion" ON public.companions
  USING (user_clerk_id = (SELECT auth.uid())::text
    AND (SELECT app_private.current_app_role()) = 'companion');
NOTIFY pgrst, 'reload schema';
