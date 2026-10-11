import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Explicit privileged boundary for trusted server workflows only.
 * This bypasses RLS. Callers MUST verify native Auth identity, trusted role and
 * entity/participant authorization before exposing data or committing changes.
 * Ordinary owned CRUD uses createAuthenticatedDatabaseClient instead.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Privileged database configuration is missing.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
