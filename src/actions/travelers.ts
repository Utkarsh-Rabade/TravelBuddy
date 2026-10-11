'use server';

import {
  getCurrentUser,
} from '@/lib/auth/server';
import type { AuthUser } from '@/lib/auth/types';
import { createAuthenticatedDatabaseClient } from '@/lib/supabase-auth-server';
import {
  decryptTravelerAccessibilityNeeds,
  decryptTravelerEmergencyContacts,
  decryptTravelerMedicalConditions,
  assertTravelerEncryptionConfigured,
  encryptTravelerAccessibilityNeeds,
  encryptTravelerEmergencyContacts,
  encryptTravelerMedicalConditions,
  type EmergencyContacts,
} from '@/lib/traveler-sensitive-fields';

const TRAVELER_COLUMNS = [
  'id',
  'family_id',
  'traveler_clerk_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'medical_conditions',
  'accessibility_needs',
  'emergency_contacts',
  'created_at',
  'updated_at',
].join(', ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 120;
const MAX_LIST_ITEMS = 32;
const MAX_LIST_ITEM_LENGTH = 160;
const MAX_CONTACT_VALUE_LENGTH = 160;

export interface TravelerInput {
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  medical_conditions?: string[] | null;
  accessibility_needs?: string[] | null;
  emergency_contacts?: EmergencyContacts | null;
}

export interface TravelerUpdateInput {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  medical_conditions?: string[] | null;
  accessibility_needs?: string[] | null;
  emergency_contacts?: EmergencyContacts | null;
}

export interface TravelerDTO {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  medical_conditions: string[];
  accessibility_needs: string[];
  emergency_contacts: EmergencyContacts | null;
  created_at: string;
  updated_at: string;
}

export type TravelerErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFIGURATION'
  | 'PERSISTENCE';

export interface TravelerActionError {
  success: false;
  error: string;
  code: TravelerErrorCode;
}

export type TravelerResult = { success: true; traveler: TravelerDTO } | TravelerActionError;
export type TravelerListResult = { success: true; travelers: TravelerDTO[] } | TravelerActionError;

type TravelerRow = {
  id: unknown;
  family_id: unknown;
  traveler_clerk_id: unknown;
  first_name: unknown;
  last_name: unknown;
  date_of_birth: unknown;
  medical_conditions: unknown;
  accessibility_needs: unknown;
  emergency_contacts: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type FamilyIdentity = { user: AuthUser; familyId: string } | TravelerActionError;

function failure(code: TravelerErrorCode, error: string): TravelerActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateText(value: unknown, label: string, required: boolean): string | TravelerActionError {
  if (typeof value !== 'string') {
    return required ? failure('INVALID_INPUT', `${label} is required.`) : '';
  }

  const normalized = value.trim();
  if (required && normalized.length === 0) {
    return failure('INVALID_INPUT', `${label} is required.`);
  }
  if (normalized.length > MAX_NAME_LENGTH) {
    return failure('INVALID_INPUT', `${label} is too long.`);
  }
  return normalized;
}

function validateDate(value: unknown): string | null | TravelerActionError {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return failure('INVALID_INPUT', 'Date of birth must use YYYY-MM-DD format.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return failure('INVALID_INPUT', 'Date of birth is invalid.');
  }

  if (date.getTime() > Date.now()) return failure('INVALID_INPUT', 'Date of birth cannot be in the future.');
  return value;
}

function validateStringList(value: unknown, label: string): string[] | null | TravelerActionError {
  if (value === undefined || value === null) return value === null ? null : [];
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    return failure('INVALID_INPUT', `${label} must be a short list of text values.`);
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return failure('INVALID_INPUT', `${label} must contain only text values.`);
    }
    const text = item.trim();
    if (text.length > MAX_LIST_ITEM_LENGTH) {
      return failure('INVALID_INPUT', `${label} contains a value that is too long.`);
    }
    if (text) normalized.push(text);
  }
  return normalized;
}

function validateContacts(value: unknown): EmergencyContacts | null | TravelerActionError {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    return failure('INVALID_INPUT', 'Emergency contacts must be an object.');
  }

  const fields = ['primary_name', 'primary_phone', 'secondary_name', 'secondary_phone'] as const;
  const contacts = {} as EmergencyContacts;
  for (const field of fields) {
    const fieldValue = value[field] ?? '';
    if (typeof fieldValue !== 'string' || fieldValue.trim().length > MAX_CONTACT_VALUE_LENGTH) {
      return failure('INVALID_INPUT', 'Emergency contact values are invalid.');
    }
    contacts[field] = fieldValue.trim();
  }
  if (!contacts.primary_name || !contacts.primary_phone) return failure('INVALID_INPUT', 'Primary emergency contact name and phone are required.');
  return contacts;
}

function validateTravelerId(value: unknown): string | TravelerActionError {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return failure('INVALID_INPUT', 'Traveler ID is invalid.');
  }
  return value;
}

function isError(value: unknown): value is TravelerActionError {
  return isRecord(value) && value.success === false && typeof value.error === 'string';
}

function requireTravelerEncryption(): TravelerActionError | null {
  try {
    assertTravelerEncryptionConfigured();
    return null;
  } catch {
    return failure('CONFIGURATION', 'Sensitive field encryption is not configured.');
  }
}

async function requireCurrentFamily(): Promise<FamilyIdentity> {
  let user: AuthUser | null;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to verify the current user.');
  }

  if (!user) return failure('UNAUTHENTICATED', 'Authentication is required.');
  if (user.role !== 'family') return failure('FORBIDDEN', 'Only a family user can access travelers.');

  try {
    const supabase = await createAuthenticatedDatabaseClient();
    const { data: family, error } = await supabase
      .from('families')
      .select('id')
      .eq('family_member_clerk_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Current family lookup failed.');
      return failure('PERSISTENCE', 'Unable to load the current family.');
    }
    if (!family || typeof family.id !== 'string') {
      return failure('NOT_FOUND', 'Create a family profile before adding travelers.');
    }
    return { user, familyId: family.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes('configuration is missing')) {
      return failure('CONFIGURATION', 'Database configuration is missing.');
    }
    console.error('Current family lookup failed.');
    return failure('PERSISTENCE', 'Unable to load the current family.');
  }
}

function toTravelerDTO(row: TravelerRow): TravelerDTO | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.first_name !== 'string' ||
    typeof row.last_name !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null;
  }

  try { return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: typeof row.date_of_birth === 'string' ? row.date_of_birth : null,
    medical_conditions: decryptTravelerMedicalConditions(row.medical_conditions),
    accessibility_needs: decryptTravelerAccessibilityNeeds(row.accessibility_needs),
    emergency_contacts: decryptTravelerEmergencyContacts(row.emergency_contacts),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }; } catch { return null; }
}

function validateCreateInput(input: TravelerInput):
  | { first_name: string; last_name: string; date_of_birth: string | null; medical_conditions: string[] | null; accessibility_needs: string[] | null; emergency_contacts: EmergencyContacts | null }
  | TravelerActionError {
  if (!isRecord(input)) return failure('INVALID_INPUT', 'Traveler input is invalid.');

  const firstName = validateText(input.first_name, 'First name', true);
  if (isError(firstName)) return firstName;
  const lastName = validateText(input.last_name, 'Last name', true);
  if (isError(lastName)) return lastName;
  const dateOfBirth = validateDate(input.date_of_birth);
  if (isError(dateOfBirth)) return dateOfBirth;
  const medicalConditions = validateStringList(input.medical_conditions, 'Medical conditions');
  if (isError(medicalConditions)) return medicalConditions;
  const accessibilityNeeds = validateStringList(input.accessibility_needs, 'Accessibility needs');
  if (isError(accessibilityNeeds)) return accessibilityNeeds;
  const emergencyContacts = validateContacts(input.emergency_contacts);
  if (isError(emergencyContacts)) return emergencyContacts;

  return {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: dateOfBirth,
    medical_conditions: medicalConditions,
    accessibility_needs: accessibilityNeeds,
    emergency_contacts: emergencyContacts,
  };
}

function validateUpdateInput(input: TravelerUpdateInput):
  | Partial<{ first_name: string; last_name: string; date_of_birth: string | null; medical_conditions: string | null; accessibility_needs: string | null; emergency_contacts: string | null }>
  | TravelerActionError {
  if (!isRecord(input)) return failure('INVALID_INPUT', 'Traveler update is invalid.');
  const update: Partial<{ first_name: string; last_name: string; date_of_birth: string | null; medical_conditions: string | null; accessibility_needs: string | null; emergency_contacts: string | null }> = {};

  if (Object.prototype.hasOwnProperty.call(input, 'first_name')) {
    const value = validateText(input.first_name, 'First name', true);
    if (isError(value)) return value;
    update.first_name = value;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'last_name')) {
    const value = validateText(input.last_name, 'Last name', true);
    if (isError(value)) return value;
    update.last_name = value;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'date_of_birth')) {
    const value = validateDate(input.date_of_birth);
    if (isError(value)) return value;
    update.date_of_birth = value;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'medical_conditions')) {
    const value = validateStringList(input.medical_conditions, 'Medical conditions');
    if (isError(value)) return value;
    update.medical_conditions = encryptTravelerMedicalConditions(value);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'accessibility_needs')) {
    const value = validateStringList(input.accessibility_needs, 'Accessibility needs');
    if (isError(value)) return value;
    update.accessibility_needs = encryptTravelerAccessibilityNeeds(value);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'emergency_contacts')) {
    const value = validateContacts(input.emergency_contacts);
    if (isError(value)) return value;
    update.emergency_contacts = encryptTravelerEmergencyContacts(value);
  }
  if (Object.keys(update).length === 0) {
    return failure('INVALID_INPUT', 'At least one traveler field is required.');
  }
  return update;
}

async function readTravelerRows(familyId: string, travelerId?: string): Promise<TravelerRow[] | TravelerActionError> {
  try {
    const supabase = await createAuthenticatedDatabaseClient();
    let query = supabase
      .from('elderly_travelers')
      .select(TRAVELER_COLUMNS)
      .eq('family_id', familyId);
    if (travelerId) query = query.eq('id', travelerId);

    const { data, error } = travelerId ? await query.maybeSingle() : await query.order('created_at', { ascending: false });
    if (error) {
      console.error('Traveler lookup failed.');
      return failure('PERSISTENCE', 'Unable to load traveler data.');
    }
    if (travelerId) return data ? [data as unknown as TravelerRow] : [];
    return (data ?? []) as unknown as TravelerRow[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('configuration is missing')) {
      return failure('CONFIGURATION', 'Database configuration is missing.');
    }
    console.error('Traveler lookup failed.');
    return failure('PERSISTENCE', 'Unable to load traveler data.');
  }
}

export async function createTraveler(input: TravelerInput, submissionId: string): Promise<TravelerResult> {
  const identity = await requireCurrentFamily();
  if (isError(identity)) return identity;
  const encryptionError = requireTravelerEncryption();
  if (encryptionError) return encryptionError;

  const validated = validateCreateInput(input);
  if (isError(validated)) return validated;
  const validSubmissionId = validateTravelerId(submissionId);
  if (isError(validSubmissionId)) return failure('INVALID_INPUT', 'Submission ID is invalid.');

  try {
    const supabase = await createAuthenticatedDatabaseClient();
    const { data: existing, error: existingError } = await supabase.from('elderly_travelers')
      .select(TRAVELER_COLUMNS).eq('id', validSubmissionId).eq('family_id', identity.familyId).maybeSingle();
    if (existingError) return failure('PERSISTENCE', 'Unable to verify traveler submission.');
    if (existing) {
      const traveler = toTravelerDTO(existing as unknown as TravelerRow);
      return traveler ? { success: true, traveler } : failure('PERSISTENCE', 'Unable to read traveler submission.');
    }
    const { data, error } = await supabase
      .from('elderly_travelers')
      .insert({
        id: validSubmissionId,
        family_id: identity.familyId,
        traveler_clerk_id: null,
        first_name: validated.first_name,
        last_name: validated.last_name,
        date_of_birth: validated.date_of_birth,
        medical_conditions: encryptTravelerMedicalConditions(validated.medical_conditions),
        accessibility_needs: encryptTravelerAccessibilityNeeds(validated.accessibility_needs),
        emergency_contacts: encryptTravelerEmergencyContacts(validated.emergency_contacts),
      })
      .select(TRAVELER_COLUMNS)
      .single();

    if (error || !data) {
      if (error?.code === '23505') {
        const repeated = await getCurrentFamilyTraveler(validSubmissionId);
        if (repeated.success) return repeated;
      }
      console.error('Traveler creation failed.');
      return failure('PERSISTENCE', 'Unable to create the traveler.');
    }

    const traveler = toTravelerDTO(data as unknown as TravelerRow);
    return traveler ? { success: true, traveler } : failure('PERSISTENCE', 'Unable to read the created traveler.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('encryption is not configured')) {
      return failure('CONFIGURATION', 'Sensitive field encryption is not configured.');
    }
    if (error instanceof Error && error.message.includes('configuration is missing')) {
      return failure('CONFIGURATION', 'Database configuration is missing.');
    }
    console.error('Traveler creation failed.');
    return failure('PERSISTENCE', 'Unable to create the traveler.');
  }
}

export async function getCurrentFamilyTravelers(): Promise<TravelerListResult> {
  const identity = await requireCurrentFamily();
  if (isError(identity)) return identity;
  const encryptionError = requireTravelerEncryption();
  if (encryptionError) return encryptionError;

  const rows = await readTravelerRows(identity.familyId);
  if (isError(rows)) return rows;
  const travelers = rows.map(toTravelerDTO);
  if (travelers.some((traveler) => traveler === null)) {
    return failure('PERSISTENCE', 'Unable to read family travelers.');
  }
  return { success: true, travelers: travelers as TravelerDTO[] };
}

export async function getCurrentFamilyTraveler(travelerId: string): Promise<TravelerResult> {
  const identity = await requireCurrentFamily();
  if (isError(identity)) return identity;
  const encryptionError = requireTravelerEncryption();
  if (encryptionError) return encryptionError;
  const validId = validateTravelerId(travelerId);
  if (isError(validId)) return validId;

  const rows = await readTravelerRows(identity.familyId, validId);
  if (isError(rows)) return rows;
  if (rows.length === 0) return failure('NOT_FOUND', 'Traveler not found.');
  const traveler = toTravelerDTO(rows[0]);
  return traveler ? { success: true, traveler } : failure('PERSISTENCE', 'Unable to read the traveler.');
}

export async function updateTraveler(
  travelerId: string,
  input: TravelerUpdateInput,
): Promise<TravelerResult> {
  const identity = await requireCurrentFamily();
  if (isError(identity)) return identity;
  const encryptionError = requireTravelerEncryption();
  if (encryptionError) return encryptionError;
  const validId = validateTravelerId(travelerId);
  if (isError(validId)) return validId;
  try {
    // Verify ownership before encrypting or updating; never permit a caller to
    // change family_id or traveler_clerk_id through this input contract.
    const owned = await getCurrentFamilyTraveler(validId);
    if (!owned.success) return owned;
    const validated = validateUpdateInput(input);
    if (isError(validated)) return validated;
    const supabase = await createAuthenticatedDatabaseClient();
    const { data, error } = await supabase
      .from('elderly_travelers')
      .update({ ...validated, updated_at: new Date().toISOString() })
      .eq('id', validId)
      .eq('family_id', identity.familyId)
      .select(TRAVELER_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('Traveler update failed.');
      return failure('PERSISTENCE', 'Unable to update the traveler.');
    }
    if (!data) return failure('NOT_FOUND', 'Traveler not found.');

    const traveler = toTravelerDTO(data as unknown as TravelerRow);
    return traveler ? { success: true, traveler } : failure('PERSISTENCE', 'Unable to read the updated traveler.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('encryption is not configured')) {
      return failure('CONFIGURATION', 'Sensitive field encryption is not configured.');
    }
    if (error instanceof Error && error.message.includes('configuration is missing')) {
      return failure('CONFIGURATION', 'Database configuration is missing.');
    }
    console.error('Traveler update failed.');
    return failure('PERSISTENCE', 'Unable to update the traveler.');
  }
}
