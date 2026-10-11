// Real local Supabase + Chromium booking/payment lifecycle integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3107';
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const url = new URL(process.env[key]);
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
  new Function('require', 'module', 'exports', code)(id => id === 'server-only' ? {} : replacements[id] ?? require(id), mod, mod.exports);
  return mod.exports;
}

async function login(context, role) {
  const response = await context.request.post(`${base}/api/dev-auth/session`, { headers: { origin: base }, data: { role } });
  assert.equal(response.status(), 200);
}

async function run() {
  const serverClientModule = await loadModule('src/lib/supabase-server.ts');
  const database = serverClientModule.createDevelopmentDatabaseClient();
  const attemptRow = sql("select ma.id||'|'||ma.trip_request_id||'|'||ma.companion_id||'|'||c.user_clerk_id from public.match_attempts ma join public.companions c on c.id=ma.companion_id where ma.matched=true and c.verification_status='verified' order by ma.created_at desc limit 1;");
  const [matchAttemptId, tripRequestId, companionId, companionUserId] = attemptRow.split('|');
  assert.match(matchAttemptId, /^[0-9a-f-]{36}$/);
  assert.match(tripRequestId, /^[0-9a-f-]{36}$/);
  assert.match(companionId, /^[0-9a-f-]{36}$/);
  assert.ok(companionUserId.startsWith('m5-ranked-'));
  // Keep this local integration fixture repeatable after an interrupted run.
  sql(`delete from public.bookings where trip_request_id='${tripRequestId}' and companion_id='${companionId}'; update public.trip_requests set status='matched' where id='${tripRequestId}';`);
  assert.equal(sql(`select count(*) from public.bookings where trip_request_id='${tripRequestId}' and companion_id='${companionId}';`), '0');

  const matchingTypes = await loadModule('src/lib/matching/types.ts', { '@/lib/companion-types': await loadModule('src/lib/companion-types.ts') });
  const scoreCalculator = await loadModule('src/lib/matching/score-calculator.ts', { './types': matchingTypes });
  const explanationGenerator = await loadModule('src/lib/matching/explanation-generator.ts', { './score-calculator': scoreCalculator, './types': matchingTypes });
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClientModule,
    '@/lib/matching/score-calculator': scoreCalculator,
    '@/lib/matching/explanation-generator': explanationGenerator,
  });
  const familyActions = await loadModule('src/actions/bookings.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companionActions = await loadModule('src/actions/bookings.ts', authModule({ getCurrentUser: async () => ({ id: companionUserId, role: 'companion' }) }));
  const otherCompanionUser = sql("select user_clerk_id from public.companions where user_clerk_id <> 'dev-companion-user' and user_clerk_id <> '" + companionUserId + "' limit 1;");
  const otherFamilyUser = `m7-family-${Date.now()}`;
  const otherFamilyId = require('node:crypto').randomUUID();
  sql(`insert into public.families(id,family_member_clerk_id,name) values('${otherFamilyId}','${otherFamilyUser}','M7 Foreign Family');`);
  const otherFamilyActions = await loadModule('src/actions/bookings.ts', authModule({ getCurrentUser: async () => ({ id: otherFamilyUser, role: 'family' }) }));
  const anonymousActions = await loadModule('src/actions/bookings.ts', authModule({ getCurrentUser: async () => null }));

  // The booking action must re-check live verification state rather than
  // trusting the historical accepted match attempt.
  for (const status of ['pending', 'expired', 'rejected']) {
    sql(`update public.companions set verification_status='${status}' where id='${companionId}';`);
    const blocked = await familyActions.createBookingForAcceptedMatch(matchAttemptId);
    assert.equal(blocked.success, false);
    assert.equal(blocked.code, 'INVALID_STATE');
  }
  sql(`update public.companions set verification_status='verified' where id='${companionId}';`);

  const browser = await chromium.launch({ headless: true });
  const family = await browser.newContext();
  const companion = await browser.newContext();
  const anonymous = await browser.newContext();
  const pageErrors = [];
  try {
    await login(family, 'family');
    const page = await family.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/dashboard/family/trip-requests/${tripRequestId}/matches`);
    await page.getByRole('button', { name: 'Create Booking', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create Booking', exact: true }).click();
    await page.waitForURL(/\/dashboard\/bookings\/[0-9a-f-]+$/);
    const bookingId = page.url().split('/').pop();
    assert.match(bookingId, /^[0-9a-f-]{36}$/);
    await page.getByText('Booking Status', { exact: true }).waitFor();
    await page.getByText('Confirmed', { exact: true }).waitFor();
    await page.getByText('Payment Status', { exact: true }).waitFor();
    await page.getByText('Pending', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('Confirmed', { exact: true }).waitFor();
    await page.getByText('Pending', { exact: true }).waitFor();

    const bookingResult = await familyActions.getBooking(bookingId);
    assert.equal(bookingResult.success, true);
    assert.equal(bookingResult.booking.trip_request_id, tripRequestId);
    assert.equal(bookingResult.booking.companion_id, companionId);
    assert.equal(bookingResult.booking.status, 'confirmed');
    assert.equal(bookingResult.booking.payment_status, 'pending');
    assert.equal(sql(`select count(*) from public.bookings where id='${bookingId}';`), '1');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'booked');

    const parallel = await Promise.all([
      familyActions.createBookingForAcceptedMatch(matchAttemptId),
      familyActions.createBookingForAcceptedMatch(matchAttemptId),
    ]);
    assert.ok(parallel.every(result => result.success && result.booking.id === bookingId));
    assert.equal(sql(`select count(*) from public.bookings where trip_request_id='${tripRequestId}' and companion_id='${companionId}';`), '1');

    const payment = await familyActions.setDevelopmentPaymentState(bookingId, 'paid');
    assert.equal(payment.success, true);
    assert.equal(payment.booking.payment_status, 'paid');
    assert.equal(sql(`select count(*) from public.payments where booking_id='${bookingId}' and status='succeeded' and type='charge';`), '1');
    await page.reload();
    await page.getByText('Paid', { exact: true }).waitFor();

    await login(companion, 'companion');
    const companionBooking = await companionActions.getBooking(bookingId);
    assert.equal(companionBooking.success, true);
    assert.equal(companionBooking.booking.companion_id, companionId);
    const otherBooking = otherCompanionUser ? await (await loadModule('src/actions/bookings.ts', authModule({ getCurrentUser: async () => ({ id: otherCompanionUser, role: 'companion' }) }))).getBooking(bookingId) : { success: false };
    assert.equal(otherBooking.success, false);
    assert.equal((await otherFamilyActions.getBooking(bookingId)).code, 'NOT_FOUND');
    assert.equal((await anonymousActions.getBooking(bookingId)).code, 'UNAUTHENTICATED');
    assert.equal((await familyActions.cancelBooking(bookingId)).code, 'INVALID_STATE');

    const companionCancel = await companionActions.cancelBooking(bookingId);
    assert.equal(companionCancel.success, true);
    assert.equal(companionCancel.booking.status, 'cancelled_by_companion');
    assert.equal(sql(`select status from public.bookings where id='${bookingId}';`), 'cancelled_by_companion');
    assert.equal((await companionActions.completeBooking(bookingId)).code, 'INVALID_STATE');
    assert.equal((await familyActions.setDevelopmentPaymentState(bookingId, 'paid')).code, 'INVALID_STATE');
    await page.reload();
    await page.getByText('Cancelled By Companion', { exact: true }).waitFor();

    // Reuse the same deterministic fixture after removing the cancelled test
    // row, then verify the separate companion completion transition.
    sql(`delete from public.bookings where id='${bookingId}'; update public.trip_requests set status='matched' where id='${tripRequestId}';`);
    const completedBooking = await familyActions.createBookingForAcceptedMatch(matchAttemptId);
    assert.equal(completedBooking.success, true);
    assert.equal(completedBooking.booking.id, bookingId);
    assert.equal((await familyActions.setDevelopmentPaymentState(bookingId, 'paid')).success, true);
    const completed = await companionActions.completeBooking(bookingId);
    assert.equal(completed.success, true);
    assert.equal(completed.booking.status, 'completed');
    assert.equal(sql(`select status from public.bookings where id='${bookingId}';`), 'completed');
    assert.equal((await companionActions.cancelBooking(bookingId)).code, 'INVALID_STATE');
    await page.reload();
    await page.getByText('Completed', { exact: true }).waitFor();

    const invalidAttempt = sql("select id from public.match_attempts where matched=false order by created_at desc limit 1;");
    if (invalidAttempt) assert.equal((await familyActions.createBookingForAcceptedMatch(invalidAttempt)).code, 'INVALID_STATE');
    assert.equal((await familyActions.createBookingForAcceptedMatch(require('node:crypto').randomUUID())).code, 'NOT_FOUND');
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log(JSON.stringify({ bookingId, tripRequestId, companionId, localDatabase: true, acceptedMatchCreatesOneBooking: 'PASS', initialBookingState: 'confirmed/pending', reloadPersistence: 'PASS', developmentPayment: 'paid persisted as test charge', familyOwnership: 'PASS', companionOwnership: 'PASS', crossFamily: 'DENIED', crossCompanion: 'DENIED', anonymous: 'DENIED', duplicateParallel: 'PASS', cancellation: 'PASS', invalidTransitions: 'PASS', browserErrors: 0 }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
