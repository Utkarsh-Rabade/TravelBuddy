'use server';

import { getCurrentUser } from '@/lib/auth/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';

export type SetRoleResult =
  | { success: true; role: 'family' | 'companion' }
  | { success: false; error: string };

/**
 * One-time family/companion onboarding. Protected database membership is the
 * authority, not editable metadata. Administrative assignment is never exposed.
 */
export async function setUserRole(role: 'family' | 'companion'): Promise<SetRoleResult> {
  const ALLOWED_ROLES = ['family', 'companion'] as const;

  if (!ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number])) {
    return { success: false, error: 'Invalid role. Must be "family" or "companion".' };
  }

  try {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Authentication is required.' };
    if (user.role) return user.role === role
      ? { success: true, role }
      : { success: false, error: 'Your account role has already been selected.' };
    const database = await createAuthenticatedDatabaseClient();
    const { error } = await database.from('app_user_roles').insert({ user_id: user.id, role });
    if (error) {
      // Concurrent submissions can converge on the same choice, never overwrite it.
      const { data: saved, error: readError } = await database.from('app_user_roles')
        .select('role').eq('user_id', user.id).maybeSingle();
      if (!readError && saved?.role === role) return { success: true, role };
      return { success: false, error: 'Unable to save this role. Reload your account and try again.' };
    }
    return { success: true, role };
  } catch {
    return { success: false, error: 'Failed to update role. Please try again.' };
  }
}
