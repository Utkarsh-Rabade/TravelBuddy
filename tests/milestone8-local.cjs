// Real local Supabase + Chromium trip lifecycle/check-in integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3108';
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const value = process.env[key];
  assert.ok(value, `Missing ${key}`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54321', 'Refusing non-local Supabase.');
}

function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}

async function loadModule(path, replacements = {}) {
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const { code } = await swc.transform(fs.readFileSync(path, 'utf8'), {
    filename: path,
    jsc: { parser: { syntax: 'typescript' }, target: 'es2020' },
    module: { type: 'commonjs' },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    id => id === 'server-only' ? {} : replacements[id] ?? require(id),
    mod,
    mod.exports,
  );
  return mod.exports;
}

async function login(context, role) {
  const response = await context.request.post(`${base}/api/dev-auth/session`, {
    headers: { origin: base },
    data: { role },
  });
  assert.equal(response.status(), 200);
}

async function run() {
  const serverClient = await loadModule('src/lib/supabase-server.ts');
  const database = serverClient.createDevelopmentDatabaseClient();
  const bookingId = '70ae6c80-cbb8-586a-9117-3ed1d1971cbc';
  const bookingRow = sql(`select b.trip_request_id||'|'||b.companion_id||'|'||c.user_clerk_id from public.bookings b join public.companions c on c.id=b.companion_id where b.id='${bookingId}';`);
  const [tripRequestId, companionId, companionUserId] = bookingRow.split('|');
  assert.match(tripRequestId, /^[0-9a-f-]{36}$/);
  assert.match(companionId, /^[0-9a-f-]{36}$/);
  assert.ok(companionUserId);

  // Reset only this synthetic local Milestone 7 fixture for a repeatable run.
  sql(`delete from public.trips where booking_id='${bookingId}'; update public.bookings set status='confirmed',payment_status='paid',updated_at=now() where id='${bookingId}'; update public.trip_requests set status='booked',updated_at=now() where id='${tripRequestId}';`);
  assert.equal(sql("select count(*) from information_schema.tables where table_schema='public' and table_name='check_ins';"), '0');

  const tripTypes = await loadModule('src/lib/trip-types.ts', {
    '@/lib/booking-types': await loadModule('src/lib/booking-types.ts'),
    '@/lib/trip-request-types': await loadModule('src/lib/trip-request-types.ts'),
  });
  const bookingTypes = await loadModule('src/lib/booking-types.ts');
  const tripRequestTypes = await loadModule('src/lib/trip-request-types.ts');
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClient,
    '@/lib/trip-types': tripTypes,
    '@/lib/booking-types': bookingTypes,
    '@/lib/trip-request-types': tripRequestTypes,
  });
  const familyActions = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companionActions = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: companionUserId, role: 'companion' }) }));
  const otherCompanionActions = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) }));
  const anonymousActions = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => null }));

  const browser = await chromium.launch({ headless: true });
  const family = await browser.newContext();
  const otherFamily = await browser.newContext();
  const anonymous = await browser.newContext();
  const pageErrors = [];
  try {
    await login(family, 'family');
    const page = await family.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/dashboard/bookings/${bookingId}`);
    await page.getByText('Trip Lifecycle', { exact: true }).waitFor();
    await page.locator('dd').filter({ hasText: 'Upcoming' }).waitFor();
    await page.getByText('No check-in recorded yet.', { exact: true }).waitFor();
    const initial = await familyActions.getTripForBooking(bookingId);
    assert.equal(initial.success, true);
    const tripId = initial.trip.id;
    assert.equal(initial.trip.status, 'upcoming');
    assert.equal(initial.trip.request_status, 'booked');
    assert.equal(sql(`select count(*) from public.trips where id='${tripId}' and booking_id='${bookingId}';`), '1');
    await page.reload();
    await page.locator('dd').filter({ hasText: 'Upcoming' }).waitFor();

    assert.equal((await companionActions.completeTrip(bookingId)).code, 'INVALID_STATE');
    assert.equal((await familyActions.startTrip(bookingId)).code, 'FORBIDDEN');
    const started = await companionActions.startTrip(bookingId);
    assert.equal(started.success, true);
    assert.equal(started.trip.status, 'in_progress');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'in_progress');
    await page.reload();
    await page.locator('dd').filter({ hasText: 'In Progress' }).waitFor();

    const checkedIn = await companionActions.companionCheckIn(bookingId);
    assert.equal(checkedIn.success, true);
    assert.equal(checkedIn.trip.id, tripId);
    assert.ok(checkedIn.trip.last_check_in);
    const repeated = await Promise.all([
      companionActions.companionCheckIn(bookingId),
      companionActions.companionCheckIn(bookingId),
    ]);
    assert.ok(repeated.every(result => result.success && result.trip.id === tripId && result.trip.last_check_in));
    assert.equal(sql(`select count(*) from public.trips where booking_id='${bookingId}';`), '1');
    assert.match(sql(`select last_check_in from public.trips where id='${tripId}';`), /^20/);
    await page.reload();
    await page.getByText('Last Check-in', { exact: true }).waitFor();
    await page.getByText('No check-in recorded yet.', { exact: true }).waitFor({ state: 'detached' });

    await login(otherFamily, 'family');
    assert.equal((await otherFamily.request.get(`${base}/dashboard/bookings/${bookingId}`)).status(), 200);
    const otherFamilyActions = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: `m8-other-family-${Date.now()}`, role: 'family' }) }));
    assert.equal((await otherFamilyActions.getTripForBooking(bookingId)).code, 'FORBIDDEN');
    assert.equal((await otherCompanionActions.getTripForBooking(bookingId)).code, 'NOT_FOUND');
    assert.equal((await anonymousActions.getTripForBooking(bookingId)).code, 'UNAUTHENTICATED');
    assert.equal((await otherCompanionActions.companionCheckIn(bookingId)).code, 'NOT_FOUND');

    // Cancellation is represented by the existing booking/request states; the
    // trip row is closed server-side and cannot be restarted or checked in.
    sql(`update public.bookings set status='cancelled_by_family',updated_at=now() where id='${bookingId}'; update public.trip_requests set status='booked',updated_at=now() where id='${tripRequestId}'; update public.trips set end_time=null,updated_at=now() where id='${tripId}';`);
    const cancelled = await familyActions.cancelTrip(bookingId);
    assert.equal(cancelled.success, true);
    assert.equal(cancelled.trip.status, 'cancelled');
    assert.equal(cancelled.trip.booking_status, 'cancelled_by_family');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'cancelled');
    assert.equal((await companionActions.startTrip(bookingId)).code, 'INVALID_STATE');
    assert.equal((await companionActions.companionCheckIn(bookingId)).code, 'INVALID_STATE');

    // Restore the same local fixture to prove the valid completion path after
    // the cancellation path has been exercised.
    sql(`delete from public.trips where booking_id='${bookingId}'; update public.bookings set status='confirmed',payment_status='paid',updated_at=now() where id='${bookingId}'; update public.trip_requests set status='booked',updated_at=now() where id='${tripRequestId}';`);
    assert.equal((await familyActions.getTripForBooking(bookingId)).success, true);
    assert.equal((await companionActions.startTrip(bookingId)).success, true);

    const completed = await companionActions.completeTrip(bookingId);
    assert.equal(completed.success, true);
    assert.equal(completed.trip.status, 'completed');
    assert.equal(completed.trip.booking_status, 'completed');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'completed');
    assert.equal(sql(`select status from public.bookings where id='${bookingId}';`), 'completed');
    assert.match(sql(`select end_time from public.trips where id='${tripId}';`), /^20/);
    assert.equal((await companionActions.startTrip(bookingId)).code, 'INVALID_STATE');
    assert.equal((await companionActions.companionCheckIn(bookingId)).code, 'INVALID_STATE');
    await page.reload();
    await page.locator('dd').filter({ hasText: 'Completed' }).first().waitFor();
    await page.getByText('This trip is completed. No further trip actions or check-ins are available.', { exact: true }).waitFor();

    console.log(JSON.stringify({ bookingId, tripId, tripRequestId, companionId, localDatabase: true, upcomingPersistence: 'PASS', validStart: 'PASS', invalidTransition: 'PASS', companionCheckIn: 'PASS', checkInPersistence: 'PASS', duplicateCheckIn: 'PASS', familyVisibility: 'PASS', otherFamilyDenied: 'DENIED', otherCompanionDenied: 'DENIED', anonymousDenied: 'DENIED', completedRejectsCheckIn: 'PASS', completedRejectsRestart: 'PASS', bookingTripConsistency: 'PASS', browserErrors: pageErrors.length }, null, 2));
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
