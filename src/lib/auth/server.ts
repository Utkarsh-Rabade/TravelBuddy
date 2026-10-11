import 'server-only';

import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import { resolveTrustedRole } from './roles';

import type { AuthRole, AuthUser } from './types';

/**
 * Application auth interface used by server-side business logic.
 *
 * Auth server verification plus current, protected database membership.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const database = await createAuthenticatedDatabaseClient();
  const { data: { user }, error } = await database.auth.getUser();
  if (error || !user) return null;
  const role = await resolveTrustedRole(database, user.id);

  return {
    id: user.id,
    email: user.email ?? '',
    firstName: '',
    lastName: '',
    role,
  };
}

export async function getCurrentUserId(): Promise<string | null> {
  const database = await createAuthenticatedDatabaseClient();
  const { data: { user }, error } = await database.auth.getUser();
  return error ? null : user?.id ?? null;
}

export async function getCurrentUserRole(): Promise<AuthRole | null> {
  const user = await getCurrentUser();
  return user?.role ?? null;
}
