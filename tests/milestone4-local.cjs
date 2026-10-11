// Real local Supabase + Chromium. Uses synthetic companion identities/data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);
const base = 'http://127.0.0.1:3104';
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const value = process.env[key];
  assert.ok(value, `Missing ${key}`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54321', 'Refusing non-local Supabase.');
}
const prefix = `M4-${randomUUID().slice(0, 8)}`;

function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}

function parseAction(text) {
  for (const line of text.split('\n')) {
    const match = line.match(/^\d+:(\{"success".*\})$/);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error(`No action result in response: ${text.slice(0, 200)}`);
}

async function login(context, role) {
  const response = await context.request.post(`${base}/api/dev-auth/session`, {
    headers: { origin: base },
    data: { role },
  });
  assert.equal(response.status(), 200);
}

async function replay(context, request, args) {
  const requestUrl = new URL(request.url());
  const response = await context.request.post(`${base}${requestUrl.pathname}`, {
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

async function run() {
  const browser = await chromium.launch({ headless: true });
  const family = await browser.newContext();
  const anonymous = await browser.newContext();
  const companion = await browser.newContext();
  const pageErrors = [];
  try {
    await login(companion, 'companion');
    const page = await companion.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    const actionRequests = [];
    page.on('request', request => {
      if (request.headers()['next-action']) actionRequests.push(request);
    });

    await page.goto(`${base}/dashboard/companions`);
    await page.getByText('You have not created a companion profile yet.', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Create Profile', exact: true }).click();
    await page.getByLabel('First Name', { exact: true }).fill('M4 Companion');
    await page.getByLabel('Last Name', { exact: true }).fill('Original');
    await page.getByLabel('Date of Birth', { exact: true }).fill('1985-04-12');
    await page.getByLabel('Languages Spoken (comma-separated)', { exact: true }).fill(' English, Hindi, english ');
    await page.getByRole('button', { name: 'Save Companion Profile', exact: true }).click();
    await page.waitForURL(/\/dashboard\/companions\/[0-9a-f-]+$/);
    const companionId = page.url().split('/').pop();
    assert.match(companionId, /^[0-9a-f-]{36}$/);
    await page.getByText('M4 Companion Original', { exact: true }).waitFor();
    await page.getByText('Pending', { exact: true }).waitFor();
    await page.getByText(/Rating:\s*0.*Completed trips:\s*0/).waitFor();
    await page.getByText('english, hindi', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('M4 Companion Original', { exact: true }).waitFor();

    const getProfileRequest = actionRequests.find(request => request.postData() === '[]' && new URL(request.url()).pathname === `/dashboard/companions/${companionId}`);
    assert.ok(getProfileRequest, 'Profile retrieval action was not observed.');
    const createRequest = actionRequests.find(request => request.postData()?.includes('M4 Companion'));
    assert.ok(createRequest, 'Profile create action was not observed.');
    const [createInput, createSubmissionId] = JSON.parse(createRequest.postData());
    const created = await replay(companion, createRequest, [createInput, createSubmissionId]);
    assert.equal(created.success, true);
    assert.equal(created.profile.id, companionId);
    assert.equal(created.profile.user_clerk_id, 'dev-companion-user');
    assert.equal(created.profile.verification_status, 'pending');
    assert.equal(created.profile.rating_average, 0);
    assert.equal(created.profile.total_trips, 0);
    assert.deepEqual(created.profile.languages_spoken, ['english', 'hindi']);
    assert.ok(!Object.hasOwn(created.profile, 'experience'));
    assert.ok(!Object.hasOwn(created.profile, 'assistance_capabilities'));

    await page.getByRole('link', { name: 'Edit Profile', exact: true }).click();
    await page.getByLabel('First Name', { exact: true }).waitFor();
    await page.getByLabel('First Name', { exact: true }).fill('M4 Updated');
    await page.getByLabel('Last Name', { exact: true }).fill('Companion');
    await page.getByLabel('Languages Spoken (comma-separated)', { exact: true }).fill('Marathi, English');
    await page.getByRole('button', { name: 'Save Companion Profile', exact: true }).click();
    await page.waitForURL(`${base}/dashboard/companions/${companionId}`);
    await page.getByText('M4 Updated Companion', { exact: true }).waitFor();
    await page.getByText('english, marathi', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('M4 Updated Companion', { exact: true }).waitFor();
    const updateRequest = actionRequests.find(request => request.postData()?.includes('M4 Updated'));
    assert.ok(updateRequest, 'Profile update action was not observed.');
    const [, updatedInput] = JSON.parse(updateRequest.postData());
    const updated = await replay(companion, updateRequest, [companionId, updatedInput]);
    assert.equal(updated.success, true);
    assert.equal(updated.profile.first_name, 'M4 Updated');
    assert.equal(updated.profile.last_name, 'Companion');
    assert.deepEqual(updated.profile.languages_spoken, ['english', 'marathi']);
    assert.equal(updated.profile.verification_status, 'pending');

    await page.getByRole('link', { name: 'Edit Profile', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Companion Profile' }).waitFor();
    await page.getByRole('button', { name: 'Add Time Range' }).first().click();
    await page.getByLabel('Monday start time', { exact: true }).fill('09:00');
    await page.getByLabel('Monday end time', { exact: true }).fill('17:00');
    await page.getByRole('button', { name: 'Save Availability', exact: true }).click();
    await page.getByText('Verification status, rating, and completed trips are read-only and managed by TravelBuddy.', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Back to Profile', exact: true }).click();
    await page.getByText('Monday:', { exact: false }).waitFor();
    await page.getByText(/09:00 - 17:00/).waitFor();
    await page.reload();
    await page.getByText(/09:00 - 17:00/).waitFor();

    const availabilityRequest = actionRequests.find(request => request.postData()?.includes('09:00') && request.postData()?.includes('17:00'));
    assert.ok(availabilityRequest, 'Availability update action was not observed.');
    const [, availabilityInput, availabilitySubmissionId] = JSON.parse(availabilityRequest.postData());
    const availabilityResult = await replay(companion, availabilityRequest, [companionId, availabilityInput, availabilitySubmissionId]);
    assert.equal(availabilityResult.success, true);
    assert.deepEqual(availabilityResult.availability.monday, [{ start: '09:00', end: '17:00' }]);
    const availabilityRetry = await replay(companion, availabilityRequest, [companionId, availabilityInput, availabilitySubmissionId]);
    assert.deepEqual(availabilityRetry.availability, availabilityResult.availability);
    assert.deepEqual(JSON.parse(sql(`select availability_calendar->'monday' from public.companions where id='${companionId}';`)), [{ start: '09:00', end: '17:00' }]);

    const invalidProfileInputs = [
      { first_name: '', last_name: 'x', date_of_birth: '1985-04-12', languages_spoken: [] },
      { first_name: 'A', last_name: 'B', date_of_birth: '2026-02-30', languages_spoken: [] },
      { first_name: 'A', last_name: 'B', date_of_birth: '2999-01-01', languages_spoken: [] },
      { first_name: 'A', last_name: 'B', date_of_birth: null, languages_spoken: 'English' },
      { first_name: 'A', last_name: 'B', date_of_birth: null, languages_spoken: [], verification_status: 'verified' },
      { first_name: 'A', last_name: 'B', date_of_birth: null, languages_spoken: [], rating_average: 5 },
      { first_name: 'A', last_name: 'B', date_of_birth: null, languages_spoken: [], total_trips: 99 },
      { first_name: 'A', last_name: 'B', date_of_birth: null, languages_spoken: [], user_clerk_id: 'dev-companion-user' },
    ];
    const profileCount = sql("select count(*) from public.companions where user_clerk_id='dev-companion-user';");
    for (const invalid of invalidProfileInputs) assert.equal((await replay(companion, createRequest, [invalid, randomUUID()])).code, 'INVALID_INPUT');
    assert.equal(sql("select count(*) from public.companions where user_clerk_id='dev-companion-user';"), profileCount);

    const invalidCalendars = [
      { monday: [{ start: '17:00', end: '09:00' }] },
      { monday: [{ start: '09:00:00', end: '10:00' }] },
      { monday: [{ start: '09:00', end: '11:00' }, { start: '10:00', end: '12:00' }] },
      { tuesdayy: [] },
      { monday: [{ start: '09:00', end: '10:00', note: 'x' }] },
      { monday: null },
    ];
    for (const invalid of invalidCalendars) assert.equal((await replay(companion, availabilityRequest, [companionId, invalid, randomUUID()])).code, 'INVALID_INPUT');
    const invalidUpdate = await replay(companion, updateRequest, [companionId, { ...updatedInput, verification_status: 'verified' }]);
    assert.equal(invalidUpdate.code, 'INVALID_INPUT');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'pending');

    await login(family, 'family');
    assert.equal((await replay(family, getProfileRequest, [])).code, 'FORBIDDEN');
    assert.equal((await replay(family, updateRequest, [companionId, updatedInput])).code, 'FORBIDDEN');
    assert.equal((await replay(family, availabilityRequest, [companionId, availabilityInput, randomUUID()])).code, 'FORBIDDEN');
    assert.equal((await replay(anonymous, getProfileRequest, [])).code, 'UNAUTHENTICATED');
    assert.equal((await replay(anonymous, updateRequest, [companionId, updatedInput])).code, 'UNAUTHENTICATED');

    const serverClient = await loadModule('src/lib/supabase-server.ts');
    // Create a real second companion fixture through the same action layer, then
    // switch the injected identity to prove the owner predicate both ways.
    let otherId;
    let otherUserId = `m4-other-${randomUUID()}`;
    const otherActions = await loadModule('src/actions/companions.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: otherUserId, role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
    });
    const other = await otherActions.createCompanionProfile({ first_name: 'M4 Other', last_name: 'Companion', date_of_birth: '1980-01-01', languages_spoken: ['English'] }, randomUUID());
    assert.equal(other.success, true);
    otherId = other.profile.id;
    const ownerActions = await loadModule('src/actions/companions.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
    });
    const otherOwnerActions = await loadModule('src/actions/companions.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: otherUserId, role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
    });
    assert.equal((await ownerActions.getCurrentCompanionProfile()).profile.id, companionId);
    assert.equal((await ownerActions.updateCompanionProfile(otherId, updatedInput)).code, 'NOT_FOUND');
    assert.equal((await ownerActions.updateCompanionAvailability(otherId, availabilityInput, randomUUID())).code, 'NOT_FOUND');
    assert.equal((await otherOwnerActions.getCurrentCompanionProfile()).profile.id, otherId);
    assert.equal((await otherOwnerActions.updateCompanionProfile(companionId, updatedInput)).code, 'NOT_FOUND');
    assert.equal((await otherOwnerActions.updateCompanionAvailability(companionId, availabilityInput, randomUUID())).code, 'NOT_FOUND');
    assert.ok(otherUserId.startsWith('m4-other-'));

    // The production adapter must fail closed even if development flags are set.
    const developmentUsers = await loadModule('src/lib/auth/development-users.ts');
    const productionAuth = await loadModule('src/lib/auth/server.ts', {
      './development-users': developmentUsers,
      'next/headers': { cookies: async () => { throw new Error('Development cookies must not be read in production.'); } },
    });
    const productionActions = await loadModule('src/actions/companions.ts', {
      '@/lib/auth/server': productionAuth,
      '@/lib/supabase-server': { createDevelopmentDatabaseClient: () => { throw new Error('Development DB must not be reached in production.'); } },
    });
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDevFlag = process.env.TRAVELBUDDY_DEV_AUTH_ENABLED;
    const originalDevSecret = process.env.TRAVELBUDDY_DEV_AUTH_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      process.env.TRAVELBUDDY_DEV_AUTH_ENABLED = 'true';
      process.env.TRAVELBUDDY_DEV_AUTH_SECRET = randomUUID();
      assert.equal(await productionAuth.getCurrentUser(), null);
      assert.equal((await productionActions.getCurrentCompanionProfile()).code, 'UNAUTHENTICATED');
      assert.equal((await productionActions.createCompanionProfile(createInput, randomUUID())).code, 'UNAUTHENTICATED');
      assert.equal((await productionActions.updateCompanionProfile(companionId, updatedInput)).code, 'UNAUTHENTICATED');
      assert.equal((await productionActions.getCurrentCompanionAvailability()).code, 'UNAUTHENTICATED');
      assert.equal((await productionActions.updateCompanionAvailability(companionId, availabilityInput, randomUUID())).code, 'UNAUTHENTICATED');
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalDevFlag === undefined) delete process.env.TRAVELBUDDY_DEV_AUTH_ENABLED;
      else process.env.TRAVELBUDDY_DEV_AUTH_ENABLED = originalDevFlag;
      if (originalDevSecret === undefined) delete process.env.TRAVELBUDDY_DEV_AUTH_SECRET;
      else process.env.TRAVELBUDDY_DEV_AUTH_SECRET = originalDevSecret;
    }

    assert.equal(sql(`select user_clerk_id||':'||verification_status||':'||rating_average::text||':'||total_trips::text from public.companions where id='${companionId}';`), 'dev-companion-user:pending:0.00:0');
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log(JSON.stringify({ profileId: companionId, localDatabase: true, createRetrieve: 'PASS', reloadPersistence: 'PASS', editRetrieveReload: 'PASS', availabilitySaveRetrieveReload: 'PASS', duplicateSubmission: 'PASS', invalidProfileAndAvailability: 'PASS', familyDenied: 'DENIED', anonymousDenied: 'DENIED', crossCompanionDenied: 'DENIED', verificationRemainedPending: 'PASS', browserErrors: 0 }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
