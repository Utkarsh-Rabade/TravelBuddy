// Real local database integration, with only the auth identity injected.
// The dev provider deliberately has one family identity; never extend it for tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd(), true);
const url = new URL(process.env.SUPABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '54321', 'Refusing non-local database.');
function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}
async function loadModule(path, replacements = {}) {
  const swc = require('next/dist/build/swc');
  await swc.loadBindings();
  const { code } = await swc.transform(fs.readFileSync(path, 'utf8'), {
    filename: path, jsc: { parser: { syntax: 'typescript' }, target: 'es2020' }, module: { type: 'commonjs' },
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => id === 'server-only' ? {} : replacements[id] ?? require(id), mod, mod.exports);
  return mod.exports;
}
async function run() {
  let user = { id: 'dev-family-user', role: 'family' };
  const database = await loadModule('src/lib/supabase-server.ts');
  const actions = await loadModule('src/actions/trip-requests.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => user },
    '@/lib/supabase-server': database,
  });
  const mainId = sql("select id from public.trip_requests where family_id=(select id from public.families where family_member_clerk_id='dev-family-user') order by updated_at desc limit 1;");
  const main = await actions.getCurrentFamilyTripRequest(mainId);
  assert.equal(main.success, true, 'Browser fixture required.');
  const mainSnapshot = sql(`select row_to_json(r) from public.trip_requests r where id='${mainId}';`);
  const familyId = randomUUID(), travelerId = randomUUID();
  const otherIdentity = 'm3-other-' + familyId;
  sql(`insert into public.families(id,family_member_clerk_id,name) values('${familyId}','${otherIdentity}','M3 Ownership Fixture'); insert into public.elderly_travelers(id,family_id,first_name,last_name) values('${travelerId}','${familyId}','M3','Ownership');`);
  user = { id: otherIdentity, role: 'family' };
  const { id, status, created_at, updated_at, elderly_travelers, ...fields } = main.request;
  assert.equal((await actions.getCurrentFamilyTripRequest(mainId)).code, 'NOT_FOUND');
  assert.equal((await actions.updateTripRequest(mainId, { ...fields, status: 'draft' })).code, 'NOT_FOUND');
  assert.equal((await actions.createTripRequest(fields, randomUUID())).code, 'FORBIDDEN');
  assert.equal((await actions.createTripRequest({ ...fields, elderly_traveler_id: travelerId }, mainId)).code, 'CONFLICT');
  assert.deepEqual((await actions.getCurrentFamilyTripRequests()).requests, []);
  assert.deepEqual((await actions.getTripRequestTravelers()).travelers.map(t => t.id), [travelerId]);
  const ownInput = { ...fields, elderly_traveler_id: travelerId, status: 'draft' };
  const own = await actions.createTripRequest(ownInput, randomUUID());
  assert.equal(own.success, true);
  assert.equal((await actions.updateTripRequest(own.request.id, ownInput)).success, true);
  // Existing schema-valid later states are readable but cannot be forged or edited.
  for (const laterStatus of ['matched', 'booked', 'in_progress', 'completed', 'cancelled', 'expired']) {
    const closedId = randomUUID();
    sql(`insert into public.trip_requests(id,family_id,elderly_traveler_id,origin_airport,destination_airport,departure_date,assistance_level,status) values('${closedId}','${familyId}','${travelerId}','BOM','DEL','${fields.departure_date}','minimal','${laterStatus}');`);
    assert.equal((await actions.getCurrentFamilyTripRequest(closedId)).request.status, laterStatus);
    const before = sql(`select row_to_json(r) from public.trip_requests r where id='${closedId}';`);
    assert.equal((await actions.updateTripRequest(closedId, ownInput)).code, 'INVALID_STATE');
    assert.equal(sql(`select row_to_json(r) from public.trip_requests r where id='${closedId}';`), before);
  }
  assert.equal(sql(`select row_to_json(r) from public.trip_requests r where id='${mainId}';`), mainSnapshot);
  // The same action code denies the original family access in the opposite direction.
  user = { id: 'dev-family-user', role: 'family' };
  assert.equal((await actions.getCurrentFamilyTripRequest(own.request.id)).code, 'NOT_FOUND');
  assert.equal((await actions.updateTripRequest(own.request.id, fields)).code, 'NOT_FOUND');
  user = { id: 'm3-no-family-' + randomUUID(), role: 'family' };
  assert.equal((await actions.getTripRequestTravelers()).code, 'NOT_FOUND');
  assert.equal((await actions.getCurrentFamilyTripRequests()).code, 'NOT_FOUND');
  // Production identity uses the real centralized adapter, not the injected user.
  const developmentUsers = await loadModule('src/lib/auth/development-users.ts');
  const realAuth = await loadModule('src/lib/auth/server.ts', {
    './development-users': developmentUsers,
    'next/headers': { cookies: () => { throw new Error('Production must not read dev cookies.'); } },
  });
  const productionActions = await loadModule('src/actions/trip-requests.ts', {
    '@/lib/auth/server': realAuth,
    '@/lib/supabase-server': { createDevelopmentDatabaseClient: () => { throw new Error('Production must not access the development DB.'); } },
  });
  const originalEnv = process.env.NODE_ENV;
  const originalFlag = process.env.TRAVELBUDDY_DEV_AUTH_ENABLED;
  const originalSecret = process.env.TRAVELBUDDY_DEV_AUTH_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.TRAVELBUDDY_DEV_AUTH_ENABLED = 'true';
    process.env.TRAVELBUDDY_DEV_AUTH_SECRET = randomUUID();
    assert.equal(await realAuth.getCurrentUser(), null);
    assert.equal((await productionActions.createTripRequest(ownInput, randomUUID())).code, 'UNAUTHENTICATED');
    assert.equal((await productionActions.updateTripRequest(mainId, ownInput)).code, 'UNAUTHENTICATED');
    assert.equal((await productionActions.getCurrentFamilyTripRequest(mainId)).code, 'UNAUTHENTICATED');
    assert.equal((await productionActions.getCurrentFamilyTripRequests()).code, 'UNAUTHENTICATED');
    assert.equal((await productionActions.getTripRequestTravelers()).code, 'UNAUTHENTICATED');
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    if (originalFlag === undefined) delete process.env.TRAVELBUDDY_DEV_AUTH_ENABLED;
    else process.env.TRAVELBUDDY_DEV_AUTH_ENABLED = originalFlag;
    if (originalSecret === undefined) delete process.env.TRAVELBUDDY_DEV_AUTH_SECRET;
    else process.env.TRAVELBUDDY_DEV_AUTH_SECRET = originalSecret;
  }
  console.log('PASS: real LOCAL DB, injected second-family identity, bidirectional ownership denials, foreign traveler/collision denied, own CRUD succeeds, all six later states read-only, denied rows unchanged, missing-family handled, real production adapter/actions fail closed.');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
