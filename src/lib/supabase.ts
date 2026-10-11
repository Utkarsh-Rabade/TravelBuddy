import { createBrowserClient } from '@supabase/ssr';
import { getPublicSupabaseConfig } from './supabase-config';

export function createBrowserDatabaseClient() {
  const { url, key } = getPublicSupabaseConfig();
  return createBrowserClient(url, key);
}

// SSR uses the same persistent cookies as the browser, not a separate localStorage session.
export const supabase = createBrowserDatabaseClient();
