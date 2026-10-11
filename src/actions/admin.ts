'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentUser } from '@/lib/auth/server';
import { encryptServerJSON } from '@/lib/traveler-sensitive-fields';
import { createServiceRoleClient } from '@/lib/supabase-server';
import {
  reviewCompanionVerification,
  type VerificationReviewDecision,
} from '@/lib/verification/server-workflow';
import { isUuid } from '@/lib/verification/metadata';
import type {
  AdminActionError,
  AdminBookingSummary,
  AdminCompanionSummary,
  AdminFamilySummary,
  AdminOverview,
  AdminOverviewInput,
  AdminOverviewResult,
  AdminRatingSummary,
  AdminRole,
  AdminSosSummary,
  AdminTripSummary,
  AdminVerificationDecision,
  AdminVerificationResult,
  AdminVerificationSummary,
} from '@/lib/admin-types';

type Database = SupabaseClient;
type Row = Record<string, unknown>;
type AdminContext = { database: Database; userId: string; role: AdminRole };
type ContextResult = AdminContext | AdminActionError;

const ADMIN_ROLES: readonly AdminRole[] = ['super_admin', 'moderator', 'support'];
const PAGE_SIZE = 50;

const ADMIN_VERIFICATION_COLUMNS = [
  'id',
  'companion_id',
  'document_type',
  'background_check_status',
  'verified_at',
  'expires_at',
  'created_at',
  'updated_at',
].join(', ');

const BOOKING_SUMMARY_COLUMNS = [
  'id',
  'booking_reference',
  'total_amount',
  'currency',
  'payment_status',
  'status',
  'created_at',
  'updated_at',
].join(', ');

const TRIP_SUMMARY_COLUMNS = [
  'id',
  'booking_id',
  'start_time',
  'end_time',
  'sos_triggered',
  'last_check_in',
  'created_at',
  'updated_at',
].join(', ');

const SOS_SUMMARY_COLUMNS = [
  'id',
  'trip_id',
  'status',
  'triggered_at',
  'acknowledged_at',
  'resolved_at',
].join(', ');

const RATING_SUMMARY_COLUMNS = 'id, score, comment, created_at, updated_at';
const FAMILY_SUMMARY_COLUMNS = 'id, name, created_at';
const COMPANION_SUMMARY_COLUMNS = 'id, first_name, last_name, verification_status, rating_average, total_trips, created_at';

const BOOKING_STATUSES = new Set<AdminBookingSummary['status']>([
  'confirmed',
  'cancelled_by_family',
  'cancelled_by_companion',
  'completed',
]);
const PAYMENT_STATUSES = new Set<AdminBookingSummary['payment_status']>([
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
]);
const SOS_STATUSES = new Set<AdminSosSummary['status']>([
  'active',
  'acknowledged',
  'resolved',
]);
const VERIFICATION_STATUSES = new Set<AdminVerificationSummary['background_check_status']>([
  'pending',
  'passed',
  'failed',
]);
const COMPANION_STATUSES = new Set<AdminCompanionSummary['verification_status']>([
  'pending',
  'verified',
  'expired',
  'rejected',
]);

function failure(code: AdminActionError['code'], error: string): AdminActionError {
  return { success: false, code, error };
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringValue(value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isAdminError(value: AdminActionError | object): value is AdminActionError {
  return 'success' in value && value.success === false;
}

function parsePage(input: AdminOverviewInput | undefined):
  | { limit: number; offset: number }
  | AdminActionError {
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
    return failure('INVALID_INPUT', 'Unable to load admin data.');
  }
  const limit = input?.limit ?? PAGE_SIZE;
  const offset = input?.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE ||
      !Number.isInteger(offset) || offset < 0) {
    return failure('INVALID_INPUT', 'Unable to load admin data.');
  }
  return { limit, offset };
}

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);
}

/**
 * The authenticated session establishes who is calling; this table lookup is
 * the additional authorization source for administrative access after the
 * verified native admin role. No caller-supplied role or flag is consulted.
 */
async function requireAdminContext(): Promise<ContextResult> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return failure('UNAUTHENTICATED', 'Unable to authenticate the current user.');
  }
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    return failure('UNAUTHENTICATED', 'Unable to authenticate the current user.');
  }
  if (user.role !== 'admin') return failure('FORBIDDEN', 'You are not allowed to perform this admin action.');

  try {
    // Admin overview/review/audit requires privileged reads and writes. Both
    // verified native admin role and the existing server-owned admin_roles
    // membership must pass before any admin entity is read or modified.
    const database = createServiceRoleClient();
    const roleResult = await database.from('admin_roles')
      .select('role')
      .eq('clerk_id', user.id)
      .in('role', [...ADMIN_ROLES])
      .maybeSingle();
    if (roleResult.error || !roleResult.data || !isAdminRole(roleResult.data.role)) {
      return failure('FORBIDDEN', 'You are not allowed to perform this admin action.');
    }
    return { database, userId: user.id, role: roleResult.data.role };
  } catch {
    return failure('PERSISTENCE', 'Unable to verify admin access.');
  }
}

async function countRows(
  database: Database,
  table: string,
  filter?: { column: string; value: string },
): Promise<number> {
  let query = database.from(table).select('id', { count: 'exact', head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const result = await query;
  if (result.error) throw new Error('Unable to load admin counts.');
  return result.count ?? 0;
}

async function boundedRows(
  database: Database,
  table: string,
  columns: string,
  page: { limit: number; offset: number },
  filter?: { column: string; value: string },
): Promise<unknown[]> {
  let query = database.from(table)
    .select(columns)
    .order('created_at', { ascending: false })
    // Fetch one extra row so callers can determine whether another page exists.
    .range(page.offset, page.offset + page.limit);
  if (filter) query = query.eq(filter.column, filter.value);
  const result = await query;
  if (result.error) throw new Error('Unable to load admin data.');
  return (result.data ?? []) as unknown[];
}

function verificationSummary(value: unknown): AdminVerificationSummary | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.companion_id) ||
      !stringValue(value.document_type) || !VERIFICATION_STATUSES.has(value.background_check_status as AdminVerificationSummary['background_check_status']) ||
      !timestamp(value.created_at) || !timestamp(value.updated_at)) return null;
  const verifiedAt = nullableStringValue(value.verified_at);
  const expiresAt = nullableStringValue(value.expires_at);
  const documentType = stringValue(value.document_type);
  if (verifiedAt !== null && verifiedAt !== undefined && !timestamp(verifiedAt)) return null;
  if (expiresAt !== null && expiresAt !== undefined && !timestamp(expiresAt)) return null;
  if (!documentType) return null;
  return {
    id: value.id,
    companion_id: value.companion_id,
    document_type: documentType,
    background_check_status: value.background_check_status as AdminVerificationSummary['background_check_status'],
    verified_at: verifiedAt ?? null,
    expires_at: expiresAt ?? null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function bookingSummary(value: unknown): AdminBookingSummary | null {
  const amount = isRecord(value) ? finiteNumber(value.total_amount) : null;
  const bookingReference = isRecord(value) ? stringValue(value.booking_reference) : null;
  const currency = isRecord(value) ? stringValue(value.currency) : null;
  if (!isRecord(value) || !isUuid(value.id) || !stringValue(value.booking_reference) ||
      amount === null || !currency || !bookingReference ||
      !PAYMENT_STATUSES.has(value.payment_status as AdminBookingSummary['payment_status']) ||
      !BOOKING_STATUSES.has(value.status as AdminBookingSummary['status']) ||
      !timestamp(value.created_at) || !timestamp(value.updated_at)) return null;
  return {
    id: value.id,
    booking_reference: bookingReference,
    total_amount: amount,
    currency,
    payment_status: value.payment_status as AdminBookingSummary['payment_status'],
    status: value.status as AdminBookingSummary['status'],
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function familySummary(value: unknown): AdminFamilySummary | null {
  if (!isRecord(value) || !isUuid(value.id) || !stringValue(value.name) || !timestamp(value.created_at)) return null;
  return { id: value.id, name: value.name as string, created_at: value.created_at };
}

function companionSummary(value: unknown): AdminCompanionSummary | null {
  const rating = isRecord(value) ? finiteNumber(value.rating_average) : null;
  const trips = isRecord(value) ? finiteNumber(value.total_trips) : null;
  if (!isRecord(value) || !isUuid(value.id) || !stringValue(value.first_name) || !stringValue(value.last_name) ||
      !COMPANION_STATUSES.has(value.verification_status as AdminCompanionSummary['verification_status']) ||
      rating === null || trips === null || rating < 0 || trips < 0 || !timestamp(value.created_at)) return null;
  return {
    id: value.id,
    first_name: value.first_name as string,
    last_name: value.last_name as string,
    verification_status: value.verification_status as AdminCompanionSummary['verification_status'],
    rating_average: rating,
    total_trips: trips,
    created_at: value.created_at,
  };
}

function tripSummary(value: unknown): AdminTripSummary | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.booking_id) ||
      !timestamp(value.start_time) || typeof value.sos_triggered !== 'boolean' ||
      !timestamp(value.created_at) || !timestamp(value.updated_at)) return null;
  const endTime = nullableStringValue(value.end_time);
  const lastCheckIn = nullableStringValue(value.last_check_in);
  if (endTime !== null && endTime !== undefined && !timestamp(endTime)) return null;
  if (lastCheckIn !== null && lastCheckIn !== undefined && !timestamp(lastCheckIn)) return null;
  return {
    id: value.id,
    booking_id: value.booking_id,
    start_time: value.start_time,
    end_time: endTime ?? null,
    sos_triggered: value.sos_triggered,
    last_check_in: lastCheckIn ?? null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function sosSummary(value: unknown): AdminSosSummary | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.trip_id) ||
      !SOS_STATUSES.has(value.status as AdminSosSummary['status']) ||
      !timestamp(value.triggered_at)) return null;
  const acknowledgedAt = nullableStringValue(value.acknowledged_at);
  const resolvedAt = nullableStringValue(value.resolved_at);
  if (acknowledgedAt !== null && acknowledgedAt !== undefined && !timestamp(acknowledgedAt)) return null;
  if (resolvedAt !== null && resolvedAt !== undefined && !timestamp(resolvedAt)) return null;
  return {
    id: value.id,
    trip_id: value.trip_id,
    status: value.status as AdminSosSummary['status'],
    triggered_at: value.triggered_at,
    acknowledged_at: acknowledgedAt ?? null,
    resolved_at: resolvedAt ?? null,
  };
}

function ratingSummary(value: unknown): AdminRatingSummary | null {
  const score = isRecord(value) ? finiteNumber(value.score) : null;
  if (!isRecord(value) || !isUuid(value.id) || score === null ||
      !Number.isInteger(score) || score < 1 || score > 5 ||
      (value.comment !== null && typeof value.comment !== 'string') ||
      !timestamp(value.created_at) || !timestamp(value.updated_at)) return null;
  return {
    id: value.id,
    score,
    comment: value.comment as string | null,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function pageItems<T>(rows: unknown[], convert: (value: unknown) => T | null, limit: number): T[] {
  return rows.slice(0, limit).map(convert).filter((value): value is T => value !== null);
}

export async function getAdminOverview(
  input: AdminOverviewInput = {},
): Promise<AdminOverviewResult> {
  const page = parsePage(input);
  if (isAdminError(page)) return page;

  const context = await requireAdminContext();
  if (isAdminError(context)) return context;

  try {
    const [
      families,
      companions,
      elderlyTravelers,
      tripRequests,
      bookings,
      trips,
      ratings,
      sosEvents,
      notifications,
      pendingVerifications,
      familyRows,
      companionRows,
      pendingRows,
      bookingRows,
      tripRows,
      sosRows,
      ratingRows,
    ] = await Promise.all([
      countRows(context.database, 'families'),
      countRows(context.database, 'companions'),
      countRows(context.database, 'elderly_travelers'),
      countRows(context.database, 'trip_requests'),
      countRows(context.database, 'bookings'),
      countRows(context.database, 'trips'),
      countRows(context.database, 'ratings'),
      countRows(context.database, 'sos_events'),
      countRows(context.database, 'notifications'),
      countRows(context.database, 'verifications', { column: 'background_check_status', value: 'pending' }),
      boundedRows(context.database, 'families', FAMILY_SUMMARY_COLUMNS, page),
      boundedRows(context.database, 'companions', COMPANION_SUMMARY_COLUMNS, page),
      boundedRows(context.database, 'verifications', ADMIN_VERIFICATION_COLUMNS, page, { column: 'background_check_status', value: 'pending' }),
      boundedRows(context.database, 'bookings', BOOKING_SUMMARY_COLUMNS, page),
      boundedRows(context.database, 'trips', TRIP_SUMMARY_COLUMNS, page),
      boundedRows(context.database, 'sos_events', SOS_SUMMARY_COLUMNS, page),
      boundedRows(context.database, 'ratings', RATING_SUMMARY_COLUMNS, page),
    ]);

    const overview: AdminOverview = {
      stats: {
        families,
        companions,
        elderly_travelers: elderlyTravelers,
        trip_requests: tripRequests,
        bookings,
        trips,
        ratings,
        sos_events: sosEvents,
        notifications,
        pending_verifications: pendingVerifications,
      },
      families: pageItems(familyRows, familySummary, page.limit),
      companions: pageItems(companionRows, companionSummary, page.limit),
      pending_verifications: pageItems(pendingRows, verificationSummary, page.limit),
      bookings: pageItems(bookingRows, bookingSummary, page.limit),
      trips: pageItems(tripRows, tripSummary, page.limit),
      sos_events: pageItems(sosRows, sosSummary, page.limit),
      ratings: pageItems(ratingRows, ratingSummary, page.limit),
      pagination: {
        limit: page.limit,
        offset: page.offset,
        next_offset: [pendingRows, bookingRows, tripRows, sosRows, ratingRows]
          .some((rows) => rows.length > page.limit) ? page.offset + page.limit : null,
      },
    };
    return { success: true, overview };
  } catch {
    return failure('PERSISTENCE', 'Unable to load admin data.');
  }
}

export async function getAdminVerification(
  verificationId: string,
): Promise<AdminVerificationResult> {
  if (!isUuid(verificationId)) return failure('INVALID_INPUT', 'Unable to load verification.');
  const context = await requireAdminContext();
  if (isAdminError(context)) return context;

  try {
    const result = await context.database.from('verifications')
      .select(ADMIN_VERIFICATION_COLUMNS)
      .eq('id', verificationId)
      .maybeSingle();
    if (result.error) return failure('PERSISTENCE', 'Unable to load verification.');
    const verification = verificationSummary(result.data);
    return verification
      ? { success: true, verification }
      : failure('NOT_FOUND', 'Unable to load verification.');
  } catch {
    return failure('PERSISTENCE', 'Unable to load verification.');
  }
}

export async function reviewAdminVerification(
  verificationId: string,
  decision: AdminVerificationDecision,
  expiresAt?: string | Date | null,
): Promise<AdminVerificationResult> {
  if (!isUuid(verificationId) ||
      (decision !== 'approve' && decision !== 'reject' && decision !== 'expire')) {
    return failure('INVALID_INPUT', 'Unable to review verification.');
  }

  const context = await requireAdminContext();
  if (isAdminError(context)) return context;

  try {
    const reviewed = await reviewCompanionVerification(
      { verificationId, decision: decision as VerificationReviewDecision, expiresAt },
      context.database,
    );
    const verification = verificationSummary(reviewed);
    if (!verification) return failure('PERSISTENCE', 'Unable to review verification.');

    const auditChanges = encryptServerJSON({
      actor: context.userId,
      action: 'VERIFICATION',
      table: 'verifications',
      record: verificationId,
      decision,
      background_check_status: verification.background_check_status,
      verified_at: verification.verified_at,
      expires_at: verification.expires_at,
      timestamp: new Date().toISOString(),
    });
    if (!auditChanges) return failure('PERSISTENCE', 'Unable to record verification review.');

    const audit = await context.database.from('audit_logs').insert({
      user_clerk_id: context.userId,
      action: 'VERIFICATION',
      table_name: 'verifications',
      record_id: verificationId,
      changes: auditChanges,
      ip_address: null,
      user_agent: null,
    });
    if (audit.error) return failure('PERSISTENCE', 'Unable to record verification review.');
    return { success: true, verification };
  } catch {
    return failure('PERSISTENCE', 'Unable to review verification.');
  }
}

/** Compatibility alias for callers that use the longer workflow name. */
export async function reviewAdminCompanionVerification(
  verificationId: string,
  decision: AdminVerificationDecision,
  expiresAt?: string | Date | null,
): Promise<AdminVerificationResult> {
  return reviewAdminVerification(verificationId, decision, expiresAt);
}
