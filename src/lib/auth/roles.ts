import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthRole } from './types';

/** Read protected tables with the verified user's client; never use user_metadata. */
export async function resolveTrustedRole(database: SupabaseClient, userId: string): Promise<AuthRole | null> {
  const { data: admin, error: adminError } = await database.from('admin_roles')
    .select('role').eq('clerk_id', userId).maybeSingle();
  if (adminError) throw new Error('Unable to verify administrative membership.');
  if (admin && ['super_admin', 'moderator', 'support'].includes(admin.role)) return 'admin';
  const { data, error } = await database.from('app_user_roles')
    .select('role').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Unable to verify account role.');
  return data?.role === 'family' || data?.role === 'companion' ? data.role : null;
}
