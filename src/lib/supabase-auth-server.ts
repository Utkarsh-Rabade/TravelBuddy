import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicSupabaseConfig } from './supabase-config';

/** Request-scoped, user-token client: ordinary data access is subject to RLS. */
export async function createAuthenticatedDatabaseClient() {
  const cookieStore = await cookies();
  const { url, key } = getPublicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Proxy refreshes them before rendering.
          // Actions and Route Handlers can write; never share this client between requests.
        }
      },
    },
  });
}
