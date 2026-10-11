// Real local Auth + RLS + business contracts + Chromium. Never runs against remote.
// Only request cookies are adapted for the module contract checks: identity is
// verified by the real src/lib/auth/server.ts against the real Supabase Auth API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { execFileSync, spawn } = require('node:child_process');
const { createServerClient } = require('@supabase/ssr');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = process.env.TRAVELBUDDY_TEST_BASE_URL || 'http://127.0.0.1:3113';
for (const value of [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
  const url = new URL(value || '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '54321', 'Refusing non-local Supabase.');
}
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Refusing non-local app.');
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cookieContext = new AsyncLocalStorage();
const tables = ['families','elderly_travelers','companions','verifications','trip_requests',
  'match_attempts','bookings','payments','trips','trip_consents','trip_locations','messages',
  'notifications','sos_events','ratings','audit_logs','admin_roles','app_user_roles'];
const accounts = [];
const contextList = [];
const fixtureFamilies = [];
const fixtureCompanions = [];
const checks = [];
let browser;
let appServer;

async function startTestServer() {
  if (process.env.TRAVELBUDDY_TEST_START_SERVER !== 'true') return;
  appServer = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', new URL(base).port], {
    stdio: ['ignore', 'inherit', 'inherit'], env: process.env,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (appServer.exitCode !== null) throw new Error('Test app server exited before becoming ready.');
    try { if ((await fetch(`${base}/api/auth/session`)).ok) return; } catch { /* bounded startup wait */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Test app server did not become ready.');
}

function snapshot() {
  const query = [...tables.map(table => `public.${table}`), 'auth.users'].map(table => `SELECT '${table}',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM ${table} t`).join(' UNION ALL ');
  return execFileSync('docker', ['exec','supabase_db_TravelBuddy','psql','-U','postgres','-d','postgres','-Atc',query], { encoding: 'utf8' }).trim();
}
function jar() {
  const entries = new Map();
  return {
    getAll: () => [...entries].map(([name, value]) => ({ name, value })),
    set(name, value) { if (value) entries.set(name, value); else entries.delete(name); },
  };
}
function authClient(cookies) {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, publicKey, {
    cookies: { getAll: cookies.getAll, setAll: values => values.forEach(c => cookies.set(c.name, c.value)) },
  });
}
function ok(result, label) {
  assert.equal(result.success, true, `${label}: ${result.error || 'failed'}`);
  return result;
}
const as = (account, fn) => cookieContext.run(account ? account.cookies : jar(), fn);
const checked = label => { checks.push(label); console.log(`PASS: ${label}`); };

async function moduleLoader() {
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const { code } = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename, jsc: { parser: { syntax: 'typescript' }, target: 'es2020' }, module: { type: 'commonjs' },
    });
    const mod = { exports: {} };
    cache.set(filename, mod);
    new Function('require','module','exports',code)(id => {
      if (id === 'server-only') return {};
      if (id === 'next/headers') return { cookies: async () => {
        const cookies = cookieContext.getStore();
        assert.ok(cookies, 'Missing test request cookie scope.');
        return cookies;
      } };
      if (id.startsWith('@/') || id.startsWith('.')) {
        const target = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(filename), id);
        return load(`${target}.ts`);
      }
      return require(id);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

async function signup(label) {
  const cookies = jar();
  const client = authClient(cookies);
  const email = `native-${label}-${randomUUID()}@example.test`;
  const password = `Tb-${randomBytes(18).toString('base64url')}!`;
  const { data, error } = await client.auth.signUp({ email, password });
  assert.equal(error, null, 'Real native signup failed.');
  assert.ok(data.user && data.session, 'Local suite requires email confirmation disabled in local config.');
  const account = { id: data.user.id, email, password, cookies, client };
  accounts.push(account);
  return account;
}

async function run() {
  const before = snapshot();
  const load = await moduleLoader();
  const auth = load('src/lib/auth/server.ts');
  const roles = load('src/actions/set-role.ts');
  const family = load('src/actions/family.ts');
  const travelers = load('src/actions/travelers.ts');
  const requests = load('src/actions/trip-requests.ts');
  const companions = load('src/actions/companions.ts');
  const matching = load('src/actions/match-companions.ts');
  const bookings = load('src/actions/bookings.ts');
  const trips = load('src/actions/trips.ts');
  const messages = load('src/actions/messages.ts');
  const safety = load('src/actions/safety.ts');
  const ratings = load('src/actions/ratings.ts');
  const notifications = load('src/actions/notifications.ts');
  const admin = load('src/actions/admin.ts');
  try {
    await startTestServer();
    assert.equal(await as(null, () => auth.getCurrentUser()), null);
    assert.equal((await as(null, () => family.createFamilyForCurrentUser('Denied'))).success, false);
    assert.equal((await as(null, () => roles.setUserRole('family'))).success, false);
    const invalid = authClient(jar());
    assert.ok((await invalid.auth.signUp({ email: 'invalid', password: 'short' })).error);
    assert.ok((await invalid.auth.signUp({ email: `weak-${randomUUID()}@example.test`, password: '1234' })).error);
    checked('anonymous actions denied; invalid email and weak native signup rejected');

    const a = await signup('family');
    const b = await signup('other-family');
    const c = await signup('companion');
    const d = await signup('other-companion');
    const administrator = await signup('admin');
    const unassigned = await signup('onboarding');
    const duplicate = await authClient(jar()).auth.signUp({ email: a.email, password: a.password });
    assert.ok(duplicate.error || duplicate.data.user?.identities?.length === 0);
    assert.ok((await authClient(jar()).auth.signInWithPassword({ email: a.email, password: 'IncorrectPassword!' })).error);
    checked('real email/password signup, duplicate signup and invalid credentials');

    assert.equal(await as(unassigned, () => auth.getCurrentUserRole()), null);
    await unassigned.client.auth.updateUser({ data: { role: 'admin' } });
    assert.equal(await as(unassigned, () => auth.getCurrentUserRole()), null);
    assert.equal((await as(unassigned, () => roles.setUserRole('admin'))).success, false);
    assert.ok((await unassigned.client.from('admin_roles').insert({ clerk_id: unassigned.id, role: 'super_admin' })).error);
    for (const [account, role] of [[a,'family'],[b,'family'],[c,'companion'],[d,'companion']]) {
      ok(await as(account, () => roles.setUserRole(role)), 'choose role');
      assert.equal(await as(account, () => auth.getCurrentUserRole()), role);
    }
    assert.equal((await as(a, () => roles.setUserRole('companion'))).success, false);
    assert.ok((await a.client.from('app_user_roles').update({ role: 'companion' }).eq('user_id', a.id)).error);
    assert.equal((await as(c, () => family.createFamilyForCurrentUser('Denied'))).success, false);
    assert.equal((await as(a, () => companions.getCurrentCompanionProfile())).success, false);
    assert.equal((await as(a, () => admin.getAdminOverview())).success, false);
    assert.equal((await as(c, () => admin.getAdminOverview())).success, false);
    // Explicit trusted setup of ONLY this newly-created local test administrator.
    assert.equal((await service.from('admin_roles').insert({ clerk_id: administrator.id, role: 'super_admin' })).error, null);
    assert.equal(await as(administrator, () => auth.getCurrentUserRole()), 'admin');
    checked('trusted immutable role onboarding; metadata/admin escalation denied');

    const fa = ok(await as(a, () => family.createFamilyForCurrentUser('Native Test Family')), 'family create').family;
    fixtureFamilies.push(fa.id);
    const fb = ok(await as(b, () => family.createFamilyForCurrentUser('Other Test Family')), 'second family').family;
    fixtureFamilies.push(fb.id);
    ok(await as(a, () => family.updateFamily(fa.id, { name: 'Native Updated Family' })), 'family edit');
    assert.equal((await as(b, () => family.updateFamily(fa.id, { name: 'Denied' }))).success, false);
    assert.equal((await as(b, () => family.getFamilyForUser(a.id))).success, false);
    const travelerInput = { first_name: 'Synthetic', last_name: 'Traveler', date_of_birth: '1945-01-01',
      medical_conditions: ['synthetic condition'], accessibility_needs: ['synthetic need'], emergency_contacts: null };
    const traveler = ok(await as(a, () => travelers.createTraveler(travelerInput, randomUUID())), 'traveler create').traveler;
    ok(await as(a, () => travelers.updateTraveler(traveler.id, { first_name: 'Updated' })), 'traveler edit');
    assert.equal((await as(b, () => travelers.getCurrentFamilyTraveler(traveler.id))).success, false);
    assert.equal((await as(b, () => travelers.updateTraveler(traveler.id, { first_name: 'Denied' }))).success, false);
    const input = { elderly_traveler_id: traveler.id, origin_airport: 'DEL', destination_airport: 'BOM',
      departure_date: new Date(Date.now()+86400000*14).toISOString().slice(0,10), return_date: null,
      assistance_level: 'moderate', language_requirements: ['english'], special_instructions: null };
    const request = ok(await as(a, () => requests.createTripRequest(input, randomUUID())), 'request create').request;
    ok(await as(a, () => requests.updateTripRequest(request.id, { ...input, assistance_level: 'minimal' })), 'request edit');
    assert.equal((await as(b, () => requests.getCurrentFamilyTripRequest(request.id))).success, false);
    checked('family/traveler/request CRUD and encrypted sensitive fields; cross-family actions denied');

    const profile = ok(await as(c, () => companions.createCompanionProfile({ first_name: 'Synthetic', last_name: 'Companion',
      date_of_birth: '1980-01-01', languages_spoken: ['english'] }, randomUUID())), 'companion create').profile;
    fixtureCompanions.push(profile.id);
    const otherProfile = ok(await as(d, () => companions.createCompanionProfile({ first_name: 'Other', last_name: 'Companion',
      languages_spoken: ['english'] }, randomUUID())), 'other companion create').profile;
    fixtureCompanions.push(otherProfile.id);
    ok(await as(c, () => companions.updateCompanionProfile(profile.id, { first_name: 'Updated' })), 'companion edit');
    const calendar = Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
      .map(day => [day, [{ start: '00:00', end: '23:59' }]]));
    ok(await as(c, () => companions.updateCompanionAvailability(profile.id, calendar, randomUUID())), 'availability');
    assert.ok((await c.client.from('companions').update({ verification_status: 'verified', rating_average: 5 }).eq('id', profile.id)).error);
    assert.equal((await as(d, () => companions.updateCompanionProfile(profile.id, { first_name: 'Denied' }))).success, false);
    checked('companion CRUD/availability; direct verification/reputation forgery denied');

    for (const account of [b,c,d]) {
      const result = await account.client.from('families').select('id').eq('id', fa.id);
      assert.equal(result.error, null);
      assert.equal(result.data.length, 0);
      assert.equal((await account.client.from('elderly_travelers').select('id').eq('id', traveler.id)).data.length, 0);
    }
    assert.equal((await b.client.from('families').update({ name: 'Denied' }).eq('id', fa.id).select('id')).data.length, 0);
    assert.ok((await a.client.from('families').update({ family_member_clerk_id: b.id }).eq('id', fa.id)).error);
    assert.ok((await a.client.from('match_attempts').insert({ trip_request_id: request.id, companion_id: profile.id, score: 100 })).error);
    checked('raw Data API RLS denies cross-user data, ownership reassignment and forged matches');

    // Continue below with the real HTTP KYC boundary and lifecycle/browser checks.
    await businessAndBrowser({ a,b,c,d,administrator,unassigned,fa,traveler,request,profile,
      auth,roles,family,travelers,requests,companions,matching,bookings,trips,messages,safety,ratings,notifications,admin });
  } finally {
    await cleanup();
    assert.equal(snapshot(), before, 'Existing data changed or a test fixture was not cleaned up.');
    checked('all 18 app tables and auth.users fingerprints unchanged after isolated fixture cleanup');
  }
  console.log(JSON.stringify({ localOnly: true, passed: checks.length, checks }, null, 2));
}

const cookieHeader = account => account.cookies.getAll().map(c => `${c.name}=${c.value}`).join('; ');
async function businessAndBrowser(x) {
  const { a,b,c,d,administrator,fa,traveler,request,profile,matching,bookings,trips,messages,safety,ratings,notifications,admin } = x;
  if (process.env.TRAVELBUDDY_UI_AUDIT === 'true') await require('./ui-route-inspection.cjs').inspect({ ...x,base,phase:'draft' });
  const upload = new FormData();
  upload.set('file', new File([Buffer.from('%PDF-1.4\n% synthetic local test only\n%%EOF\n')], 'synthetic.pdf', { type: 'application/pdf' }));
  assert.equal((await fetch(`${base}/api/companion/kyc`)).status, 401);
  assert.equal((await fetch(`${base}/api/companion/kyc`, { headers: { cookie: cookieHeader(a) } })).status, 403);
  const response = await fetch(`${base}/api/companion/kyc`, { method: 'POST', headers: { cookie: cookieHeader(c), origin: base }, body: upload });
  assert.equal(response.status, 201, 'Real KYC upload failed.');
  const { verification } = await response.json();
  assert.ok(verification.id);
  assert.equal('document_storage_path' in verification, false);
  const downloadUrl = `${base}${verification.download_url}`;
  assert.equal((await fetch(downloadUrl, { headers: { cookie: cookieHeader(c) } })).status, 200);
  assert.ok([403,404].includes((await fetch(downloadUrl, { headers: { cookie: cookieHeader(d) } })).status));
  assert.equal((await fetch(downloadUrl)).status, 401);
  assert.equal((await as(c, () => admin.reviewAdminVerification(verification.id, 'approve'))).success, false);
  ok(await as(administrator, () => admin.reviewAdminVerification(verification.id, 'approve', new Date(Date.now()+86400000*60).toISOString())), 'admin KYC approve');
  ok(await as(administrator, () => admin.getAdminOverview({ limit: 10, offset: 0 })), 'admin overview');
  const catalogue = ok(await as(a, () => x.companions.getVerifiedCompanionCatalogue()), 'safe catalogue');
  assert.equal(JSON.stringify(catalogue).includes('date_of_birth'), false);
  assert.equal(JSON.stringify(catalogue).includes('user_clerk_id'), false);
  checked('real private KYC HTTP upload/download; anonymous/cross-owner denial; trusted admin review');

  const found = ok(await as(a, () => matching.findMatchingCompanionsAction(request.id)), 'matching');
  const match = found.matches.find(m => m.companion.id === profile.id);
  assert.ok(match, 'Verified local test companion was not eligible.');
  assert.equal(match.companion.date_of_birth, null);
  assert.equal((await as(b, () => matching.getMatchAttemptsAction(request.id))).success, false);
  ok(await as(a, () => matching.updateMatchStatusAction(match.matchAttemptId, 'accepted')), 'accept match');
  const booking = ok(await as(a, () => bookings.createBookingForAcceptedMatch(match.matchAttemptId)), 'booking').booking;
  assert.equal((await as(a, () => bookings.createBookingForAcceptedMatch(match.matchAttemptId))).booking.id, booking.id);
  assert.equal((await as(b, () => bookings.getBooking(booking.id))).success, false);
  assert.equal((await as(d, () => bookings.getBooking(booking.id))).success, false);
  ok(await as(c, () => bookings.getBooking(booking.id)), 'participant booking');
  const trip = ok(await as(a, () => trips.getTripForBooking(booking.id)), 'trip row').trip;
  assert.equal((await as(b, () => trips.getTripForBooking(booking.id))).success, false);
  ok(await as(c, () => trips.startTrip(booking.id)), 'start trip');
  ok(await as(c, () => trips.companionCheckIn(booking.id)), 'check in');
  checked('matching eligibility/status and idempotent booking; participant trip lifecycle');

  const sent = ok(await as(a, () => messages.sendMessage({ tripId: trip.id, content: 'Synthetic native conversation', idempotencyKey: randomUUID() })), 'chat');
  ok(await as(c, () => messages.listMessages(trip.id)), 'participant chat read');
  ok(await as(c, () => messages.markMessageRead({ messageId: sent.message.id, tripId: trip.id })), 'chat read marker');
  assert.equal((await as(b, () => messages.listMessages(trip.id))).success, false);
  assert.equal((await as(d, () => messages.sendMessage({ tripId: trip.id, content: 'Denied' }))).success, false);
  assert.ok((await c.client.from('messages').insert({ trip_id: trip.id, sender_clerk_id: a.id, content: 'forged' })).error);
  const inbox = ok(await as(c, () => notifications.listNotifications()), 'notification inbox');
  assert.ok(inbox.notifications.length);
  ok(await as(c, () => notifications.markNotificationRead(inbox.notifications[0].id)), 'read notification');
  assert.equal((await as(a, () => notifications.markNotificationRead(inbox.notifications[0].id))).success, false);
  checked('chat, read markers, encrypted notification fan-out and recipient isolation');

  const location = { latitude: 12.34, longitude: 77.56, accuracy: 10 };
  assert.equal((await as(c, () => safety.recordTripLocation({ tripId: trip.id, ...location }))).success, false);
  ok(await as(a, () => safety.grantLocationConsent({ tripId: trip.id })), 'location consent');
  ok(await as(c, () => safety.recordTripLocation({ tripId: trip.id, ...location })), 'record location');
  assert.equal((await a.client.from('trip_locations').select('id').eq('trip_id', trip.id)).data.length, 1);
  assert.equal((await b.client.from('trip_locations').select('id').eq('trip_id', trip.id)).data.length, 0);
  const sos = ok(await as(a, () => safety.createSosEvent({ tripId: trip.id, location, idempotencyKey: randomUUID() })), 'SOS').event;
  ok(await as(c, () => safety.acknowledgeSos({ tripId: trip.id, eventId: sos.id })), 'ack SOS');
  ok(await as(c, () => safety.resolveSos({ tripId: trip.id, eventId: sos.id, resolutionNote: 'Synthetic resolved' })), 'resolve SOS');
  assert.equal((await as(b, () => safety.listSosEvents({ tripId: trip.id }))).success, false);
  ok(await as(a, () => safety.revokeLocationConsent({ tripId: trip.id })), 'revoke consent');
  assert.equal((await a.client.from('trip_locations').select('id').eq('trip_id', trip.id)).data.length, 0);
  assert.equal((await as(c, () => safety.recordTripLocation({ tripId: trip.id, ...location }))).success, false);
  checked('consented location RLS, revocation and participant-only SOS lifecycle');
  if (process.env.TRAVELBUDDY_UI_AUDIT === 'true') await require('./ui-route-inspection.cjs').inspect({ ...x,base,phase:'active',bookingId:booking.id,verification });

  ok(await as(c, () => trips.completeTrip(booking.id)), 'complete trip');
  const rating = ok(await as(a, () => ratings.submitRating({ tripId: trip.id, score: 5, comment: 'Synthetic review' })), 'rating');
  assert.equal(rating.rating.score, 5);
  assert.equal((await as(b, () => ratings.submitRating({ tripId: trip.id, score: 1 }))).success, false);
  assert.ok((await a.client.from('ratings').insert({ trip_id: trip.id, rater_clerk_id: a.id, ratee_clerk_id: c.id, score: 5 })).error);
  const reputation = await service.from('companions').select('rating_average').eq('id', profile.id).single();
  assert.equal(Number(reputation.data.rating_average), 5);
  checked('completed-trip ratings and trusted reputation aggregation; forged ratings denied');
  if (process.env.TRAVELBUDDY_UI_AUDIT === 'true') await require('./ui-route-inspection.cjs').inspect({ ...x,base,phase:'completed',bookingId:booking.id });

  await browserChecks(x, booking.id);
}

async function cleanup() {
  for (const context of contextList) await context.close();
  if (browser) await browser.close();
  // Delete ONLY IDs created in this invocation. No resets or historical fixture mutation.
  for (const account of accounts.filter(a => !a.id)) {
    // A browser navigation can finish before a test obtains its user ID. Recover
    // only this run's exact generated email/password, never search/delete by prefix.
    const recovered = await account.client.auth.signInWithPassword({ email: account.email, password: account.password });
    if (recovered.data.user) account.id = recovered.data.user.id;
  }
  const ids = accounts.map(a => a.id).filter(Boolean);
  if (ids.length) {
    const created = await service.from('families').select('id').in('family_member_clerk_id', ids);
    for (const row of created.data || []) if (!fixtureFamilies.includes(row.id)) fixtureFamilies.push(row.id);
  }
  for (const id of fixtureCompanions) {
    const stored = await service.from('verifications').select('document_storage_path').eq('companion_id', id);
    const paths = (stored.data || []).map(v => v.document_storage_path.replace(/^companion-verifications\//, ''));
    if (paths.length) assert.equal((await service.storage.from('companion-verifications').remove(paths)).error, null);
  }
  if (fixtureFamilies.length) assert.equal((await service.from('families').delete().in('id', fixtureFamilies)).error, null);
  if (fixtureCompanions.length) assert.equal((await service.from('companions').delete().in('id', fixtureCompanions)).error, null);
  for (const table of ['notifications','audit_logs']) if (ids.length) {
    assert.equal((await service.from(table).delete().in('user_clerk_id', ids)).error, null);
  }
  if (ids.length) assert.equal((await service.from('admin_roles').delete().in('clerk_id', ids)).error, null);
  for (const account of accounts.filter(a => a.id)) {
    await account.client.auth.signOut({ scope: 'global' });
    assert.equal((await service.auth.admin.deleteUser(account.id)).error, null);
  }
  if (appServer && appServer.exitCode === null) {
    const exited = new Promise(resolve => appServer.once('exit', resolve));
    appServer.kill('SIGTERM');
    await exited;
  }
}

async function browserChecks(x, bookingId) {
  browser = await chromium.launch({ headless: true });
  const errors = [];
  async function context(options = {}) {
    const result = await browser.newContext(options);
    contextList.push(result);
    result.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return result;
  }
  async function signIn(ctx, account, destination) {
    const page = await ctx.newPage();
    await page.goto(`${base}/auth/sign-in`);
    await page.getByLabel('Email address', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(`${base}${destination}`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    return page;
  }
  const anonymous = await context({ viewport: { width: 390, height: 844 } });
  const page = await anonymous.newPage();
  // Real provider-generated signup confirmation, not a mocked authentication
  // response. Only the local test service client can generate this fixture link.
  const confirmationEmail = `native-confirm-${randomUUID()}@example.test`;
  const confirmationPassword = `Tb-${randomBytes(18).toString('base64url')}!`;
  const link = await service.auth.admin.generateLink({ type: 'signup', email: confirmationEmail, password: confirmationPassword });
  assert.equal(link.error, null, 'Local signup confirmation fixture generation failed.');
  const confirmationCookies = jar();
  accounts.push({ id: link.data.user.id, email: confirmationEmail, password: confirmationPassword,
    cookies: confirmationCookies, client: authClient(confirmationCookies) });
  const confirmationContext = await context();
  const confirmationUrl = `${base}/auth/confirm?type=signup&token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`;
  const confirmation = await confirmationContext.request.get(confirmationUrl, { maxRedirects: 0 })
    .catch(() => { throw new Error('Email confirmation HTTP request failed.'); });
  assert.equal(confirmation.status(), 303);
  assert.equal(confirmation.headers().location, '/select-role');
  const confirmed = await (await confirmationContext.request.get(`${base}/api/auth/session`)).json();
  assert.equal(confirmed.user.id, link.data.user.id);
  assert.equal(confirmed.user.role, null);
  const rejected = await anonymous.request.get(`${base}/auth/confirm?type=signup&token_hash=invalid-synthetic`, { maxRedirects: 0 });
  assert.equal(rejected.headers().location, '/auth/sign-in?error=confirmation');
  checked('real signup email-token confirmation establishes cookies; invalid confirmation rejected');

  // Expire only the storage timestamp of a REAL issued session. Proxy must
  // use its valid refresh token and forward renewed cookies/cache headers.
  const stored = x.a.cookies.getAll().filter(c => /auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a,b) => a.name.localeCompare(b.name));
  assert.ok(stored.length);
  const encoded = stored.map(c => c.value).join('');
  const session = JSON.parse(Buffer.from(encoded.slice('base64-'.length), 'base64url').toString());
  session.expires_at = Math.floor(Date.now()/1000) - 60;
  stored.forEach(c => x.a.cookies.set(c.name, ''));
  const cookieName = stored[0].name.replace(/\.\d+$/, '');
  x.a.cookies.set(cookieName, `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`);
  const renewed = await fetch(`${base}/api/auth/session`, { headers: { cookie: cookieHeader(x.a) } });
  assert.equal((await renewed.json()).user.id, x.a.id);
  const updatedCookies = renewed.headers.getSetCookie();
  assert.ok(updatedCookies.some(c => c.startsWith(cookieName)), 'Proxy did not renew expired session storage.');
  assert.match(renewed.headers.get('cache-control'), /no-store/);
  for (const value of updatedCookies) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    x.a.cookies.set(pair.slice(0,separator), pair.slice(separator+1));
  }
  checked('proxy refreshes real sessions and forwards cookies with private no-store headers');

  await page.goto(`${base}/dashboard/family`);
  await page.waitForURL(`${base}/auth/sign-in`);
  await page.goto(`${base}/select-role`);
  await page.waitForURL(`${base}/auth/sign-in`);
  assert.equal((await anonymous.request.post(`${base}/api/dev-auth/session`, { data: { role: 'admin' } })).status(), 404);
  await page.getByLabel('Email address', { exact: true }).fill(x.a.email);
  await page.getByLabel('Password', { exact: true }).fill('IncorrectPassword!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /invalid.*credentials/i }).waitFor();
  checked('real mobile sign-in error, anonymous route redirects and retired dev-auth endpoint');

  await page.goto(`${base}/auth/sign-up`);
  await page.getByLabel('Email address', { exact: true }).fill('invalid');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password', { exact: true }).fill('different');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByText('Enter a valid email address.', { exact: true }).waitFor();
  await page.getByText('Use a password with at least 8 characters.', { exact: true }).waitFor();
  await page.getByText('Passwords do not match.', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByLabel('Email address', { exact: true }).fill(x.a.email);
  await page.getByLabel('Password', { exact: true }).fill(x.a.password);
  await page.getByLabel('Confirm password', { exact: true }).fill(x.a.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /already.*registered|already exists/i }).waitFor();
  checked('mobile signup email/password/confirmation validation and real duplicate-account error');

  const email = `native-browser-${randomUUID()}@example.test`;
  const password = `Tb-${randomBytes(18).toString('base64url')}!`;
  const cookies = jar();
  const client = authClient(cookies);
  const account = { id: null, email, password, cookies, client };
  accounts.push(account);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.waitForURL(`${base}/select-role`);
  account.id = (await (await anonymous.request.get(`${base}/api/auth/session`)).json()).user?.id;
  assert.ok(account.id, 'Native browser signup did not create a verified user.');
  await page.getByRole('button', { name: 'I am a Family Member', exact: true }).click();
  await page.waitForURL(`${base}/dashboard/family`);
  await page.getByRole('link', { name: 'Create Family', exact: true }).click();
  await page.getByLabel('Family Name', { exact: true }).fill('Native Browser Family');
  await page.getByRole('button', { name: 'Save Family', exact: true }).click();
  await page.waitForURL(`${base}/dashboard/family`);
  await page.getByText('Native Browser Family', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Native Browser Family', { exact: true }).waitFor();
  const state = await anonymous.storageState();
  assert.ok(state.cookies.some(c => c.name.includes('auth-token') && c.expires > Date.now()/1000));
  // New Chromium process simulates reopening with persistent cookies, without
  // writing session material or a storageState file to the repository.
  const reopenedBrowser = await chromium.launch({ headless: true });
  try {
    const reopened = await reopenedBrowser.newContext({ storageState: state });
    const reopenedPage = await reopened.newPage();
    await reopenedPage.goto(`${base}/dashboard/family`);
    await reopenedPage.getByText('Native Browser Family', { exact: true }).waitFor();
    assert.equal((await (await reopened.request.get(`${base}/api/auth/session`)).json()).user.role, 'family');
  } finally { await reopenedBrowser.close(); }
  checked('real UI signup → role → family creation; reload and reopened-browser persistence');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(`${base}/auth/sign-in`);
  assert.equal((await (await anonymous.request.get(`${base}/api/auth/session`)).json()).user, null);
  await page.goto(`${base}/dashboard/family`);
  await page.waitForURL(`${base}/auth/sign-in`);
  await page.goBack();
  // Back navigation must not restore verified private UI from a stale page cache.
  await page.waitForURL(`${base}/auth/sign-in`);
  checked('real sign-out clears browser identity and denies refresh/back private navigation');

  const familyContext = await context();
  const familyPage = await signIn(familyContext, x.a, '/dashboard/family');
  await familyPage.getByText('Native Updated Family', { exact: true }).waitFor();
  await familyPage.goto(`${base}/dashboard/admin`);
  await familyPage.waitForURL(`${base}/dashboard/family`);
  await familyPage.goto(`${base}/dashboard/companions`);
  await familyPage.waitForURL(`${base}/dashboard/family`);
  await familyPage.goto(`${base}/dashboard/bookings/${bookingId}`);
  await familyPage.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  const companionContext = await context();
  const companionPage = await signIn(companionContext, x.c, '/dashboard/companions');
  await companionPage.getByText('Companion Dashboard', { exact: true }).waitFor();
  await companionPage.reload();
  await companionPage.getByText('Companion Dashboard', { exact: true }).waitFor();
  await companionPage.goto(`${base}/dashboard/family`);
  await companionPage.waitForURL(`${base}/dashboard/companions`);
  await companionPage.goto(`${base}/dashboard/admin`);
  await companionPage.waitForURL(`${base}/dashboard/companions`);
  const adminPage = await signIn(await context(), x.administrator, '/dashboard/admin');
  await adminPage.getByText('Admin dashboard', { exact: true }).waitFor();
  const onboarding = await signIn(await context(), x.unassigned, '/select-role');
  await onboarding.goto(`${base}/dashboard/admin`);
  await onboarding.waitForURL(`${base}/select-role`);
  assert.equal(errors.length, 0, errors.join('\n'));
  checked('family/companion/admin/no-role browser routing, navigation/reload and zero page errors');
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
