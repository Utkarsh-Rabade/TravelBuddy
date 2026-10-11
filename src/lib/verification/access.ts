import 'server-only';

import { getCurrentUser } from '@/lib/auth/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';

import type { CompanionVerificationActionError } from './types';

export type CompanionIdentity = { userId: string };

export function isVerificationActionError(
  value: unknown,
): value is CompanionVerificationActionError {
  return typeof value === 'object' && value !== null &&
    (value as { success?: unknown }).success === false;
}

export async function requireCompanionIdentity(): Promise<
  CompanionIdentity | CompanionVerificationActionError
> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication is required.' };
  }
  if (!user) return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication is required.' };
  if (user.role !== 'companion') {
    return { success: false, code: 'FORBIDDEN', error: 'Only a companion can access KYC data.' };
  }
  if (typeof user.id !== 'string' || user.id.length === 0) {
    return { success: false, code: 'UNAUTHENTICATED', error: 'Authentication is required.' };
  }
  return { userId: user.id };
}

export async function getOwnedCompanionId(
  userId: string,
  database?: SupabaseClient,
): Promise<string | null> {
  const client = database ?? await createAuthenticatedDatabaseClient();
  const { data, error } = await client.from('companions')
    .select('id')
    .eq('user_clerk_id', userId)
    .maybeSingle();
  if (error) throw new Error('Unable to load companion profile.');
  if (!data || typeof data.id !== 'string') return null;
  return data.id;
}
