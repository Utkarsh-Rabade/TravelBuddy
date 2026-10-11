'use server';

import {
  getCurrentUser,
} from '@/lib/auth/server';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import type { AuthUser } from '@/lib/auth/types';

export interface FamilyRecord {
  id: string;
  name: string;
  family_member_clerk_id: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyTravelerSummary {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
}

export type FamilyLookupResult =
  | { success: true; family: FamilyRecord | null; travelers: FamilyTravelerSummary[] }
  | { success: false; error: string };

export type FamilyMutationResult =
  | { success: true; family: FamilyRecord; created: boolean }
  | { success: false; error: string };

async function requireFamilyUser(): Promise<{ user: AuthUser } | { error: string }> {
  const user = await getCurrentUser();

  if (!user) {
    return { error: 'Authentication is required.' } as const;
  }
  if (user.role !== 'family') {
    return { error: 'Only a family user can access family data.' } as const;
  }

  return { user } as const;
}

export async function getFamilyForCurrentUser(): Promise<FamilyLookupResult> {
  const identity = await requireFamilyUser();
  if ('error' in identity) {
    return { success: false, error: identity.error };
  }

  const supabase = await createAuthenticatedDatabaseClient();
  const { data: family, error: familyError } = await supabase
    .from('families')
    .select('id, name, family_member_clerk_id, created_at, updated_at')
    .eq('family_member_clerk_id', identity.user.id)
    .maybeSingle();

  if (familyError) {
    console.error('Family lookup failed:', familyError.message);
    return { success: false, error: 'Unable to load the family profile.' };
  }

  if (!family) {
    return { success: true, family: null, travelers: [] };
  }

  const { data: travelers, error: travelerError } = await supabase
    .from('elderly_travelers')
    .select('id, first_name, last_name, date_of_birth')
    .eq('family_id', family.id)
    .order('created_at', { ascending: false });

  if (travelerError) {
    console.error('Family traveler lookup failed:', travelerError.message);
    return { success: false, error: 'Unable to load family travelers.' };
  }

  return {
    success: true,
    family: family as FamilyRecord,
    travelers: (travelers ?? []) as FamilyTravelerSummary[],
  };
}

export async function createFamilyForCurrentUser(name: string): Promise<FamilyMutationResult> {
  const identity = await requireFamilyUser();
  if ('error' in identity) {
    return { success: false, error: identity.error };
  }

  if (typeof name !== 'string') {
    return { success: false, error: 'Family name is required.' };
  }
  const normalizedName = name.trim();
  if (normalizedName.length < 2 || normalizedName.length > 120) {
    return { success: false, error: 'Family name must be between 2 and 120 characters.' };
  }

  const supabase = await createAuthenticatedDatabaseClient();
  const { data: existingFamily, error: existingError } = await supabase
    .from('families')
    .select('id, name, family_member_clerk_id, created_at, updated_at')
    .eq('family_member_clerk_id', identity.user.id)
    .maybeSingle();

  if (existingError) {
    console.error('Existing family lookup failed:', existingError.message);
    return { success: false, error: 'Unable to verify the family profile.' };
  }

  if (existingFamily) {
    return { success: true, family: existingFamily as FamilyRecord, created: false };
  }

  const { data: family, error: insertError } = await supabase
    .from('families')
    .insert({
      family_member_clerk_id: identity.user.id,
      name: normalizedName,
    })
    .select('id, name, family_member_clerk_id, created_at, updated_at')
    .single();

  if (insertError || !family) {
    console.error('Family creation failed:', insertError?.message ?? 'No family returned.');
    return { success: false, error: 'Unable to create the family profile.' };
  }

  return { success: true, family: family as FamilyRecord, created: true };
}

/** The argument must be the verified native Auth ID, never an arbitrary owner. */
export async function getFamilyForUser(userId: string): Promise<
  { success: true; family: FamilyRecord | null } | { success: false; error: string }
> {
  const identity = await requireFamilyUser();
  if ('error' in identity) return { success: false, error: identity.error };
  if (userId !== identity.user.id) return { success: false, error: 'Family access is forbidden.' };
  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data, error } = await database.from('families')
      .select('id, name, family_member_clerk_id, created_at, updated_at')
      .eq('family_member_clerk_id', identity.user.id).maybeSingle();
    if (error) return { success: false, error: 'Unable to load the family profile.' };
    return { success: true, family: data as FamilyRecord | null };
  } catch {
    return { success: false, error: 'Unable to load the family profile.' };
  }
}

export async function updateFamily(familyId: string, input: { name: string }): Promise<
  { success: true; family: FamilyRecord } | { success: false; error: string }
> {
  const identity = await requireFamilyUser();
  if ('error' in identity) return { success: false, error: identity.error };
  if (typeof familyId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId) ||
      !input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => key !== 'name') || typeof input.name !== 'string') {
    return { success: false, error: 'Family update is invalid.' };
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) return { success: false, error: 'Family name must be between 2 and 120 characters.' };
  try {
    const database = await createAuthenticatedDatabaseClient();
    const { data, error } = await database.from('families')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', familyId).eq('family_member_clerk_id', identity.user.id)
      .select('id, name, family_member_clerk_id, created_at, updated_at').maybeSingle();
    if (error) return { success: false, error: 'Unable to update the family profile.' };
    if (!data) return { success: false, error: 'Family profile not found.' };
    return { success: true, family: data as FamilyRecord };
  } catch {
    return { success: false, error: 'Unable to update the family profile.' };
  }
}
