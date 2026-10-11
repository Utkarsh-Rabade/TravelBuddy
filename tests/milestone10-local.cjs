// Real local Supabase + Chromium location/SOS safety integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3110';
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
  assert.match(tripId, /^[0-9a-f-]{36}$/);
  assert.match(tripRequestId, /^[0-9a-f-]{36}$/);
  assert.match(sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.trip_consents'::regclass and conname='trip_consents_data_type_check';"), /location/);

  // Reset only synthetic local safety rows and put the existing trip in the
  // active state needed for location updates; never touch remote Supabase.
  sql(`delete from public.sos_events where trip_id='${tripId}'; delete from public.trip_locations where trip_id='${tripId}'; delete from public.trip_consents where trip_id='${tripId}' and data_type='location'; delete from public.notifications where type='sos' and user_clerk_id in ('dev-family-user','dev-companion-user'); update public.trips set end_time=null,sos_triggered=false,current_location=null,updated_at=now() where id='${tripId}'; update public.bookings set companion_id=(select id from public.companions where user_clerk_id='dev-companion-user'),status='confirmed',updated_at=now() where id='${bookingId}'; update public.trip_requests set status='in_progress',updated_at=now() where id='${tripRequestId}';`);

  const safetyTypes = await loadModule('src/lib/safety-types.ts');
  const cryptoCodec = await loadModule('src/lib/traveler-sensitive-fields.ts');
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClient,
    '@/lib/safety-types': safetyTypes,
    '@/lib/traveler-sensitive-fields': cryptoCodec,
  });
  const family = await loadModule('src/actions/safety.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companion = await loadModule('src/actions/safety.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) }));
  const otherFamily = await loadModule('src/actions/safety.ts', authModule({ getCurrentUser: async () => ({ id: 'm10-other-family-user', role: 'family' }) }));
  const otherCompanion = await loadModule('src/actions/safety.ts', authModule({ getCurrentUser: async () => ({ id: 'm10-other-companion-user', role: 'companion' }) }));
  const anonymous = await loadModule('src/actions/safety.ts', authModule({ getCurrentUser: async () => null }));

  const browser = await chromium.launch({ headless: true });
  const familyContext = await browser.newContext();
  const companionContext = await browser.newContext();
  const pageErrors = [];
  try {
    const noConsent = await companion.recordTripLocation({ tripId, latitude: 51.5074, longitude: -0.1278, accuracy: 20 });
    assert.equal(noConsent.code, 'FORBIDDEN');

    const granted = await family.grantLocationConsent({ tripId, notes: 'Family approved active-trip location sharing.' });
    assert.equal(granted.success, true);
    assert.equal(granted.consent.data_type, 'location');
    assert.equal(sql(`select count(*) from public.trip_consents where id='${granted.consent.id}' and data_type='location' and granted_by_clerk_id='dev-family-user';`), '1');

    await login(familyContext, 'family');
    const familyPage = await familyContext.newPage();
    familyPage.on('pageerror', error => pageErrors.push(error.message));
    await familyPage.goto(`${base}/dashboard/bookings/${bookingId}`);
    await familyPage.getByText('Location sharing', { exact: true }).waitFor();
    await familyPage.getByText('Permitted location sharing is on.', { exact: true }).waitFor();

    const saved = await companion.recordTripLocation({ tripId, latitude: 51.5074, longitude: -0.1278, accuracy: 20 });
    assert.equal(saved.success, true);
    assert.ok(saved.location.recorded_at);
    assert.equal(sql(`select count(*) from public.trip_locations where id='${saved.location.id}' and trip_id='${tripId}';`), '1');
    assert.match(sql(`select recorded_at from public.trip_locations where id='${saved.location.id}';`), /^20/);
    assert.equal(sql(`select current_location is not null from public.trips where id='${tripId}';`), 't');

    const visibleToFamily = await family.listTripLocations({ tripId });
    assert.equal(visibleToFamily.success, true);
    assert.ok(visibleToFamily.locations.some(location => location.id === saved.location.id));
    const visibleToCompanion = await companion.listTripLocations({ tripId });
    assert.equal(visibleToCompanion.success, true);
    assert.ok(visibleToCompanion.locations.some(location => location.id === saved.location.id));
    assert.equal((await otherFamily.listTripLocations({ tripId })).code, 'NOT_FOUND');
    assert.equal((await otherCompanion.listTripLocations({ tripId })).code, 'NOT_FOUND');
    assert.equal((await anonymous.listTripLocations({ tripId })).code, 'UNAUTHENTICATED');

    const revoked = await family.revokeLocationConsent({ tripId, consentId: granted.consent.id });
    assert.equal(revoked.success, true);
    assert.equal(revoked.consent.status, 'revoked');
    assert.equal((await companion.recordTripLocation({ tripId, latitude: 51.5, longitude: -0.12, accuracy: 25 })).code, 'FORBIDDEN');
    assert.equal((await family.listTripLocations({ tripId })).code, 'FORBIDDEN');
    const grantedAgain = await family.grantLocationConsent({ tripId });
    assert.equal(grantedAgain.success, true);

    const sos = await companion.createSosEvent({ tripId, location: { latitude: 51.5074, longitude: -0.1278, accuracy: 20 }, idempotencyKey: 'm10-sos-1' });
    assert.equal(sos.success, true);
    assert.equal(sos.event.status, 'active');
    assert.equal(sos.event.triggered_by_clerk_id, 'dev-companion-user');
    assert.equal(sql(`select triggered_by_clerk_id from public.sos_events where id='${sos.event.id}';`), 'dev-companion-user');
    assert.equal(sql("select count(*) from public.notifications where user_clerk_id='dev-family-user' and type='sos';"), '1');
    const duplicateSos = await Promise.all([
      companion.createSosEvent({ tripId, idempotencyKey: 'm10-parallel-sos' }),
      companion.createSosEvent({ tripId, idempotencyKey: 'm10-parallel-sos' }),
    ]);
    assert.ok(duplicateSos.every(result => result.success));
    assert.equal(new Set(duplicateSos.map(result => result.event.id)).size, 1);
    assert.equal(sql(`select count(*) from public.sos_events where trip_id='${tripId}' and triggered_by_clerk_id='dev-companion-user';`), '2');
    assert.equal((await otherFamily.listSosEvents({ tripId })).code, 'NOT_FOUND');
    assert.equal((await otherCompanion.listSosEvents({ tripId })).code, 'NOT_FOUND');
    assert.equal((await anonymous.listSosEvents({ tripId })).code, 'UNAUTHENTICATED');

    const listed = await family.listSosEvents({ tripId });
    assert.equal(listed.success, true);
    assert.ok(listed.events.some(event => event.id === sos.event.id));
    assert.equal((await family.resolveSos({ tripId, eventId: sos.event.id })).code, 'INVALID_STATE');
    const acknowledged = await family.acknowledgeSos({ tripId, eventId: sos.event.id });
    assert.equal(acknowledged.success, true);
    assert.equal(acknowledged.event.status, 'acknowledged');
    const resolved = await companion.resolveSos({ tripId, eventId: sos.event.id, resolutionNote: 'In-app safety workflow completed.' });
    assert.equal(resolved.success, true);
    assert.equal(resolved.event.status, 'resolved');
    assert.equal((await family.acknowledgeSos({ tripId, eventId: sos.event.id })).code, 'INVALID_STATE');
    assert.equal((await companion.resolveSos({ tripId, eventId: sos.event.id })).code, 'CONFLICT');
    assert.equal(sql(`select status from public.sos_events where id='${sos.event.id}';`), 'resolved');

    // Closed trips reject normal location and SOS actions. Restore the local
    // fixture afterward so the workspace remains useful for subsequent work.
    sql(`update public.trips set end_time=now(),updated_at=now() where id='${tripId}'; update public.trip_requests set status='completed',updated_at=now() where id='${tripRequestId}'; update public.bookings set status='completed',updated_at=now() where id='${bookingId}';`);
    assert.equal((await companion.recordTripLocation({ tripId, latitude: 51.5, longitude: -0.12, accuracy: 20 })).code, 'INVALID_STATE');
    assert.equal((await companion.createSosEvent({ tripId, idempotencyKey: 'm10-closed' })).code, 'INVALID_STATE');
    sql(`update public.trips set end_time=null,updated_at=now() where id='${tripId}'; update public.trip_requests set status='in_progress',updated_at=now() where id='${tripRequestId}'; update public.bookings set status='confirmed',updated_at=now() where id='${bookingId}';`);
    await familyPage.reload();
    await familyPage.getByText('Location sharing', { exact: true }).waitFor();
    await familyPage.getByText('Send In-App SOS', { exact: true }).waitFor();
    await login(companionContext, 'companion');
    const companionPage = await companionContext.newPage();
    companionPage.on('pageerror', error => pageErrors.push(error.message));
    await companionPage.goto(`${base}/dashboard/bookings/${bookingId}`);
    await companionPage.getByText('Location sharing', { exact: true }).waitFor();
    try {
      await companionPage.getByText('Save Location Update', { exact: true }).waitFor({ timeout: 5000 });
    } catch (error) {
      console.error(await companionPage.locator('body').innerText());
      throw error;
    }
    await companionPage.getByLabel('Latitude').fill('51.5074');
    await companionPage.getByLabel('Longitude').fill('-0.1278');
    await companionPage.getByLabel('Accuracy (meters)').fill('20');
    await companionPage.getByText('Save Location Update', { exact: true }).click();
    await companionPage.getByText('51.5074', { exact: true }).waitFor();

    console.log(JSON.stringify({ bookingId, tripId, tripRequestId, localDatabase: true, consentGrant: 'PASS', locationPersistence: 'PASS', serverTimestamp: 'PASS', familyVisibility: 'PASS', revokeStopsExposure: 'PASS', otherFamilyDenied: 'DENIED', otherCompanionDenied: 'DENIED', anonymousDenied: 'DENIED', sosPersistence: 'PASS', serverActor: 'PASS', parallelSos: 'PASS', sosNotification: 'PASS', invalidSosTransitions: 'PASS', closedTripRestrictions: 'PASS', externalDispatch: 'NOT_CLAIMED', browserErrors: pageErrors.length }, null, 2));
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
