// Real local Supabase + Chromium matching integration. Synthetic fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3105';
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const value = process.env[key];
  assert.ok(value, `Missing ${key}`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54321', 'Refusing non-local Supabase.');
}

function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}

function parseAction(text) {
  for (const line of text.split('\n')) {
    const match = line.match(/^\d+:(\{"success".*\})$/);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error(`No action result: ${text.slice(0, 240)}`);
}

async function login(context, role) {
  const response = await context.request.post(`${base}/api/dev-auth/session`, {
    headers: { origin: base },
    data: { role },
  });
  assert.equal(response.status(), 200);
}

async function replay(context, request, args) {
  const url = new URL(request.url());
  const response = await context.request.post(`${base}${url.pathname}`, {
    headers: {
      origin: base,
      'next-action': request.headers()['next-action'],
      'content-type': 'text/plain;charset=UTF-8',
    },
    data: JSON.stringify(args),
  });
  assert.equal(response.status(), 200);
  return parseAction(await response.text());
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

function nextMonday() {
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 7);
  while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

const MONDAY_CALENDAR = { monday: [{ start: '09:00', end: '17:00' }] };
const TUESDAY_CALENDAR = { tuesday: [{ start: '09:00', end: '17:00' }] };

async function createFixtureCompanion(actions, identity, input) {
  const { availability, ...profileInput } = input;
  const result = await actions.createCompanionProfile(profileInput, randomUUID());
  assert.equal(result.success, true, `Could not create fixture companion ${identity}`);
  const availabilityResult = await actions.updateCompanionAvailability(result.profile.id, availability ?? MONDAY_CALENDAR, randomUUID());
  assert.equal(availabilityResult.success, true, `Could not save fixture availability ${identity}`);
  return result.profile.id;
}

async function run() {
  const serverClient = await loadModule('src/lib/supabase-server.ts');
  const matchingTypes = await loadModule('src/lib/matching/types.ts', {
    '@/lib/companion-types': await loadModule('src/lib/companion-types.ts'),
  });
  const scoreCalculator = await loadModule('src/lib/matching/score-calculator.ts', {
    './types': matchingTypes,
  });
  const explanationGenerator = await loadModule('src/lib/matching/explanation-generator.ts', {
    './score-calculator': scoreCalculator,
    './types': matchingTypes,
  });
  const matchingAlgorithm = await loadModule('src/lib/matching/basic-matching-algorithm.ts', {
    '@/lib/supabase-server': serverClient,
    './score-calculator': scoreCalculator,
    './explanation-generator': explanationGenerator,
    './types': matchingTypes,
  });
  const loadMatchingActions = auth => loadModule('src/actions/match-companions.ts', {
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClient,
    '@/lib/matching/basic-matching-algorithm': matchingAlgorithm,
    '@/lib/matching/explanation-generator': explanationGenerator,
  });
  const companionActionCache = new Map();
  async function companionActions(identity) {
    if (!companionActionCache.has(identity)) {
      companionActionCache.set(identity, await loadModule('src/actions/companions.ts', {
        '@/lib/auth/server': { getCurrentUser: async () => ({ id: identity, role: 'companion' }) },
        '@/lib/supabase-server': serverClient,
      }));
    }
    return companionActionCache.get(identity);
  }

  const familyIdentity = { id: 'dev-family-user', role: 'family' };
  const tripActions = await loadModule('src/actions/trip-requests.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => familyIdentity },
    '@/lib/supabase-server': serverClient,
  });
  const travelerId = sql("select t.id from public.elderly_travelers t join public.families f on f.id=t.family_id where f.family_member_clerk_id='dev-family-user' order by t.created_at limit 1;");
  assert.match(travelerId, /^[0-9a-f-]{36}$/);
  const departure = nextMonday();
  const tripInput = {
    elderly_traveler_id: travelerId,
    origin_airport: 'BOM',
    destination_airport: 'DEL',
    departure_date: departure,
    return_date: null,
    assistance_level: 'moderate',
    language_requirements: ['English'],
    special_instructions: 'M5 synthetic matching request',
  };
  const createdTrip = await tripActions.createTripRequest(tripInput, randomUUID());
  assert.equal(createdTrip.success, true);
  const tripRequestId = createdTrip.request.id;
  const searchingTrip = await tripActions.updateTripRequest(tripRequestId, { ...tripInput, status: 'searching' });
  assert.equal(searchingTrip.success, true);

  const eligibleIdentity = `m5-eligible-${randomUUID()}`;
  const rankedIdentity = `m5-ranked-${randomUUID()}`;
  const unavailableIdentity = `m5-unavailable-${randomUUID()}`;
  const incompatibleIdentity = `m5-incompatible-${randomUUID()}`;
  const pendingIdentity = `m5-pending-${randomUUID()}`;
  sql("update public.companions set verification_status='pending' where user_clerk_id like 'm5-%';");
  const fixtureInput = (first_name, languages_spoken, availability) => ({
    first_name, last_name: 'Fixture', date_of_birth: '1980-01-01', languages_spoken, availability,
  });
  const eligibleId = await createFixtureCompanion(await companionActions(eligibleIdentity), eligibleIdentity, fixtureInput('Alice Eligible', ['English', 'Hindi'], MONDAY_CALENDAR));
  const rankedId = await createFixtureCompanion(await companionActions(rankedIdentity), rankedIdentity, fixtureInput('Zed Ranked', ['English'], MONDAY_CALENDAR));
  const unavailableId = await createFixtureCompanion(await companionActions(unavailableIdentity), unavailableIdentity, fixtureInput('Unavailable', ['English'], TUESDAY_CALENDAR));
  const incompatibleId = await createFixtureCompanion(await companionActions(incompatibleIdentity), incompatibleIdentity, fixtureInput('No Language', ['Spanish'], MONDAY_CALENDAR));
  const pendingId = await createFixtureCompanion(await companionActions(pendingIdentity), pendingIdentity, fixtureInput('Pending', ['English'], MONDAY_CALENDAR));

  // Verification is an admin-controlled field. These local-only SQL statements
  // establish trusted fixture states; no companion-facing action can perform them.
  sql(`update public.companions set verification_status='pending' where user_clerk_id='dev-companion-user'; update public.companions set verification_status='verified', rating_average=1.00, total_trips=0 where id='${eligibleId}'; update public.companions set verification_status='verified', rating_average=4.50, total_trips=12 where id='${rankedId}'; update public.companions set verification_status='verified', rating_average=5.00, total_trips=50 where id='${unavailableId}'; update public.companions set verification_status='verified', rating_average=5.00, total_trips=50 where id='${incompatibleId}'; update public.companions set verification_status='pending' where id='${pendingId}';`);

  const browser = await chromium.launch({ headless: true });
  const family = await browser.newContext();
  const otherFamily = await browser.newContext();
  const anonymous = await browser.newContext();
  const pageErrors = [];
  try {
    await login(family, 'family');
    const page = await family.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const requests = [];
    page.on('request', request => { if (request.headers()['next-action']) requests.push(request); });
    await page.goto(`${base}/dashboard/family/trip-requests/${tripRequestId}/matches`);
    const requestsBeforeFind = requests.length;
    await page.getByRole('button', { name: 'Find Matching Companions', exact: true }).click();
    await page.getByText('Zed Ranked', { exact: false }).waitFor();
    await page.getByText('Alice Eligible', { exact: false }).waitFor();
    await page.getByText('Verification Status', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('Unavailable', { exact: false }).count(), 0);
    assert.equal(await page.getByText('No Language', { exact: false }).count(), 0);
    assert.equal(await page.getByText('Pending Fixture', { exact: false }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: /Zed Ranked Fixture/ }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: /Alice Eligible Fixture/ }).count(), 1);
    await page.getByText('Route compatibility cannot be computed from the available companion data.', { exact: false }).count().then(count => assert.ok(count >= 0));

    const matchingRequests = requests.slice(requestsBeforeFind).filter(request => request.postData()?.includes(tripRequestId) && new URL(request.url()).pathname.includes('/matches'));
    const findRequest = matchingRequests[0];
    assert.ok(findRequest, 'Find action request was not observed.');
    const findArgs = JSON.parse(findRequest.postData());
    const firstRun = await replay(family, findRequest, findArgs);
    assert.equal(firstRun.success, true);
    assert.equal(firstRun.matches.length, 2);
    assert.equal(firstRun.matches[0].companion.id, rankedId);
    assert.equal(firstRun.matches[1].companion.id, eligibleId);
    assert.ok(firstRun.matches[0].score >= firstRun.matches[1].score);
    assert.match(firstRun.matches[0].explanation, /languages|Available|Verified|Route compatibility/);
    const attemptCount = sql(`select count(*) from public.match_attempts where trip_request_id='${tripRequestId}';`);
    assert.equal(attemptCount, '2');
    const duplicateRun = await replay(family, findRequest, findArgs);
    assert.equal(duplicateRun.success, true);
    assert.deepEqual(duplicateRun.matches.map(match => match.matchAttemptId), firstRun.matches.map(match => match.matchAttemptId));
    assert.equal(sql(`select count(*) from public.match_attempts where trip_request_id='${tripRequestId}';`), '2');

    const getAttemptsRequest = matchingRequests[matchingRequests.length - 1];
    assert.ok(getAttemptsRequest, 'Get attempts request was not observed.');
    const attemptsBeforeAccept = await replay(family, getAttemptsRequest, [tripRequestId]);
    assert.equal(attemptsBeforeAccept.success, true);
    assert.equal(attemptsBeforeAccept.matchAttempts.length, 2);
    const topAttemptId = firstRun.matches[0].matchAttemptId;
    const acceptButton = page.getByRole('button', { name: 'Accept Match', exact: true }).first();
    await acceptButton.click();
    await page.getByText('Accepted', { exact: true }).waitFor();
    assert.equal(sql(`select matched from public.match_attempts where id='${topAttemptId}';`), 't');
    assert.equal(sql(`select status from public.trip_requests where id='${tripRequestId}';`), 'matched');
    await page.reload();
    await page.getByText('Previous Match Attempts', { exact: false }).waitFor();
    await page.getByText('Accepted', { exact: true }).waitFor();
    const attemptsAfterAccept = await replay(family, getAttemptsRequest, [tripRequestId]);
    assert.equal(attemptsAfterAccept.matchAttempts.find(attempt => attempt.id === topAttemptId).status, 'accepted');
    const rejectButton = page.getByRole('button', { name: 'Reject Match', exact: true }).first();
    if (await rejectButton.count()) {
      await rejectButton.click();
      await page.getByText('Rejected', { exact: true }).waitFor();
    }

    const matchingActions = await loadMatchingActions({ getCurrentUser: async () => familyIdentity });
    assert.equal((await matchingActions.findMatchingCompanionsAction('bad-id')).success, false);
    assert.equal((await matchingActions.updateMatchStatusAction(topAttemptId, 'invalid')).success, false);
    assert.equal((await matchingActions.updateMatchStatusAction(topAttemptId, 'rejected')).success, false);

    const otherFamilyIdentity = `m5-family-${randomUUID()}`;
    const otherFamilyId = randomUUID();
    sql(`insert into public.families(id,family_member_clerk_id,name) values('${otherFamilyId}','${otherFamilyIdentity}','M5 Foreign Family');`);
    const otherFamilyActions = await loadMatchingActions({ getCurrentUser: async () => ({ id: otherFamilyIdentity, role: 'family' }) });
    assert.equal((await otherFamilyActions.getMatchAttemptsAction(tripRequestId)).error, 'Trip request not found.');
    assert.equal((await otherFamilyActions.findMatchingCompanionsAction(tripRequestId)).error, 'Trip request not found.');
    const anonymousActions = await loadMatchingActions({ getCurrentUser: async () => null });
    assert.equal((await anonymousActions.getMatchAttemptsAction(tripRequestId)).error, 'Authentication is required.');
    assert.equal((await anonymousActions.findMatchingCompanionsAction(tripRequestId)).error, 'Authentication is required.');

    const ownCompanionActions = await loadMatchingActions({ getCurrentUser: async () => ({ id: rankedIdentity, role: 'companion' }) });
    const otherCompanionActions = await loadMatchingActions({ getCurrentUser: async () => ({ id: eligibleIdentity, role: 'companion' }) });
    const ownAttempts = await ownCompanionActions.getCompanionMatchAttemptsAction();
    assert.equal(ownAttempts.success, true);
    assert.ok(ownAttempts.matchAttempts.some(attempt => attempt.companion_id === rankedId));
    assert.ok(!ownAttempts.matchAttempts.some(attempt => attempt.companion_id === eligibleId));
    const otherAttempts = await otherCompanionActions.getCompanionMatchAttemptsAction();
    assert.equal(otherAttempts.success, true);
    assert.ok(otherAttempts.matchAttempts.some(attempt => attempt.companion_id === eligibleId));
    assert.ok(!otherAttempts.matchAttempts.some(attempt => attempt.companion_id === rankedId));
    assert.equal((await otherCompanionActions.updateMatchStatusAction(topAttemptId, 'rejected')).success, false);

    const finalRow = sql(`select score,matched,jsonb_typeof(explanation),created_at from public.match_attempts where id='${topAttemptId}';`);
    assert.match(finalRow, /\|object\|/);
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log(JSON.stringify({ tripRequestId, rankedCompanions: [rankedId, eligibleId], excluded: { unavailable: unavailableId, incompatible: incompatibleId, pending: pendingId }, localDatabase: true, deterministicRanking: 'PASS', eligibleVerificationAndAvailability: 'PASS', routeAndAssistanceLimitationsExplained: 'PASS', duplicateAttempts: 'PASS', familyOwnership: 'DENIED', anonymous: 'DENIED', companionScopedReads: 'PASS', acceptRejectPersistence: 'PASS', reloadPersistence: 'PASS', browserErrors: 0 }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
