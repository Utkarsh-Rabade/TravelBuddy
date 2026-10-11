// Real local Supabase + Chromium post-trip rating/reputation integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3111';
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
  new Function('require', 'module', 'exports', code)(id => id === 'server-only' ? {} : replacements[id] ?? require(id), mod, mod.exports);
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
  const bookingId = '70ae6c80-cbb8-586a-9117-3ed1d1971cbc';
  const tripId = sql(`select id from public.trips where booking_id='${bookingId}' order by created_at limit 1;`);
  const tripRequestId = sql(`select trip_request_id from public.bookings where id='${bookingId}';`);
  const companionId = sql(`select companion_id from public.bookings where id='${bookingId}';`);
  assert.match(tripId, /^[0-9a-f-]{36}$/);
  assert.match(tripRequestId, /^[0-9a-f-]{36}$/);
  assert.match(companionId, /^[0-9a-f-]{36}$/);

  // Reset only synthetic local rating rows and start from an active trip.
  sql(`delete from public.ratings where trip_id='${tripId}'; update public.companions set rating_average=0 where id='${companionId}'; update public.trips set end_time=null,updated_at=now() where id='${tripId}'; update public.trip_requests set status='in_progress',updated_at=now() where id='${tripRequestId}'; update public.bookings set status='confirmed',updated_at=now() where id='${bookingId}';`);

  const ratingTypes = await loadModule('src/lib/rating-types.ts');
  const cryptoCodec = await loadModule('src/lib/traveler-sensitive-fields.ts');
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClient,
    '@/lib/rating-types': ratingTypes,
    '@/lib/traveler-sensitive-fields': cryptoCodec,
  });
  const family = await loadModule('src/actions/ratings.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companion = await loadModule('src/actions/ratings.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) }));
  const otherFamily = await loadModule('src/actions/ratings.ts', authModule({ getCurrentUser: async () => ({ id: 'm11-other-family-user', role: 'family' }) }));
  const otherCompanion = await loadModule('src/actions/ratings.ts', authModule({ getCurrentUser: async () => ({ id: 'm11-other-companion-user', role: 'companion' }) }));
  const anonymous = await loadModule('src/actions/ratings.ts', authModule({ getCurrentUser: async () => null }));

  assert.equal((await family.submitRating({ tripId, score: 5, comment: 'Too early.' })).code, 'INVALID_STATE');
  assert.equal((await companion.submitRating({ tripId, score: 5 })).code, 'FORBIDDEN');

  // Complete the existing local trip using the schema-supported terminal states.
  const completedAt = new Date().toISOString();
  sql(`update public.trips set end_time='${completedAt}',updated_at='${completedAt}' where id='${tripId}'; update public.trip_requests set status='completed',updated_at='${completedAt}' where id='${tripRequestId}'; update public.bookings set status='completed',updated_at='${completedAt}' where id='${bookingId}';`);

  const browser = await chromium.launch({ headless: true });
  const familyContext = await browser.newContext();
  const pageErrors = [];
  try {
    await login(familyContext, 'family');
    const page = await familyContext.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/dashboard/bookings/${bookingId}`);
    await page.getByText('Trip Rating', { exact: true }).waitFor();
    await page.getByText('Share a rating and an optional review to help keep the community informed.', { exact: true }).waitFor();

    const eligibility = await family.getRatingEligibility({ tripId });
    assert.equal(eligibility.success, true);
    assert.equal(eligibility.eligibility.eligible, true);
    assert.equal(eligibility.eligibility.can_rate, true);
    const rating = await family.submitRating({ tripId, score: 5, comment: 'A safe and helpful completed trip.' });
    assert.equal(rating.success, true);
    assert.equal(rating.created, true);
    assert.equal(rating.rating.score, 5);
    assert.equal(sql(`select count(*) from public.ratings where trip_id='${tripId}' and rater_clerk_id='dev-family-user' and ratee_clerk_id='dev-companion-user';`), '1');
    assert.equal(sql(`select rating_average from public.companions where id='${companionId}';`), '5.00');
    await page.reload();
    await page.getByText('Your rating', { exact: false }).waitFor();
    await page.getByText('A safe and helpful completed trip.', { exact: true }).waitFor();

    const duplicate = await Promise.all([
      family.submitRating({ tripId, score: 1, comment: 'Changed retry must not overwrite.' }),
      family.submitRating({ tripId, score: 4, comment: 'Another retry must not duplicate.' }),
    ]);
    assert.ok(duplicate.every(result => result.success && result.created === false));
    assert.equal(new Set(duplicate.map(result => result.rating.created_at)).size, 1);
    assert.equal(sql(`select count(*) from public.ratings where trip_id='${tripId}' and rater_clerk_id='dev-family-user';`), '1');
    assert.equal(sql(`select score from public.ratings where trip_id='${tripId}' and rater_clerk_id='dev-family-user';`), '5');

    assert.equal((await family.submitRating({ tripId, score: 0 })).code, 'INVALID_INPUT');
    assert.equal((await family.submitRating({ tripId, score: 6 })).code, 'INVALID_INPUT');
    assert.equal((await family.submitRating({ tripId, score: 4, comment: '   ' })).code, 'INVALID_INPUT');
    assert.equal((await family.submitRating({ tripId: 'not-a-uuid', score: 4 })).code, 'INVALID_INPUT');
    assert.equal((await family.submitRating({ tripId: crypto.randomUUID(), score: 4 })).code, 'NOT_FOUND');
    assert.equal((await otherFamily.getRatingEligibility({ tripId })).code, 'FORBIDDEN');
    assert.equal((await otherFamily.getRatingsForTrip({ tripId })).code, 'FORBIDDEN');
    assert.equal((await otherCompanion.getRatingsForTrip({ tripId })).code, 'FORBIDDEN');
    assert.equal((await anonymous.getRatingsForTrip({ tripId })).code, 'UNAUTHENTICATED');

    const companionEligibility = await companion.getRatingEligibility({ tripId });
    assert.equal(companionEligibility.success, true);
    assert.equal(companionEligibility.eligibility.eligible, false);
    const companionRatings = await companion.getRatingsForTrip({ tripId });
    assert.equal(companionRatings.success, true);
    assert.equal(companionRatings.ratings.length, 1);
    assert.equal(companionRatings.ratings[0].is_mine, false);

    // A direct malformed/spoofed row must not change the trusted aggregate.
    sql(`insert into public.ratings (id,trip_id,rater_clerk_id,ratee_clerk_id,score,comment,created_at,updated_at) values ('${crypto.randomUUID()}','${tripId}','spoofed-user','dev-companion-user',1,'spoofed',now(),now());`);
    const repeat = await family.submitRating({ tripId, score: 5, comment: 'retry' });
    assert.equal(repeat.success, true);
    assert.equal(sql(`select rating_average from public.companions where id='${companionId}';`), '5.00');
    assert.equal((await family.getRatingsForTrip({ tripId })).ratings.length, 1);

    const messages = await loadModule('src/actions/messages.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) },
      '@/lib/supabase-server': serverClient,
      '@/lib/message-types': await loadModule('src/lib/message-types.ts'),
      '@/lib/traveler-sensitive-fields': cryptoCodec,
    });
    const completedHistory = await messages.listMessages({ tripId });
    assert.equal(completedHistory.success, true);
    assert.equal((await messages.sendMessage({ tripId, content: 'No new active-trip chat after completion.' })).code, 'NOT_FOUND');

    const trips = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) }));
    assert.equal((await trips.startTrip(bookingId)).code, 'INVALID_STATE');
    assert.equal((await trips.completeTrip(bookingId)).code, 'INVALID_STATE');
    assert.equal(sql(`select status from public.bookings where id='${bookingId}';`), 'completed');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'completed');
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log(JSON.stringify({ bookingId, tripId, tripRequestId, companionId, localDatabase: true, completedEligible: 'PASS', ratingPersisted: 'PASS', reloadPersistence: 'PASS', duplicatePrevented: 'PASS', parallelSafe: 'PASS', invalidScoreRejected: 'PASS', anonymousDenied: 'DENIED', otherFamilyDenied: 'DENIED', otherCompanionDenied: 'DENIED', unrelatedTripDenied: 'DENIED', preCompletionDenied: 'PASS', companionReputation: '5.00 from one valid rating', spoofedAggregateIgnored: 'PASS', authorizedReviewVisibility: 'PASS', completedChatHistoryReadable: 'PASS', completedChatSendDenied: 'PASS', completedTripRestrictions: 'PASS', browserErrors: pageErrors.length }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
