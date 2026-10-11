// Real local Supabase storage/database + Chromium KYC lifecycle integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3106';
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

function nextMonday() {
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + 7);
  while (cursor.getUTCDay() !== 1) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

async function run() {
  const serverClient = await loadModule('src/lib/supabase-server.ts');
  const database = serverClient.createDevelopmentDatabaseClient();
  const companionId = sql("select id from public.companions where user_clerk_id='dev-companion-user';");
  assert.match(companionId, /^[0-9a-f-]{36}$/);
  // Remove only prior synthetic M6 rows/objects so this repeatable local test
  // starts from a pending companion with no prior KYC submissions.
  const previousObjects = await database.storage.from('companion-verifications').list(companionId, { limit: 100 });
  if (previousObjects.data?.length) {
    await database.storage.from('companion-verifications').remove(previousObjects.data.map(item => `${companionId}/${item.name}`));
  }
  sql(`delete from public.verifications where companion_id='${companionId}'; update public.companions set verification_status='pending' where id='${companionId}';`);

  const companionActions = await loadModule('src/actions/companions.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) },
    '@/lib/supabase-server': serverClient,
  });
  const availability = await companionActions.updateCompanionAvailability(companionId, { monday: [{ start: '09:00', end: '17:00' }] }, randomUUID());
  assert.equal(availability.success, true);

  const tripActions = await loadModule('src/actions/trip-requests.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) },
    '@/lib/supabase-server': serverClient,
  });
  const travelerId = sql("select t.id from public.elderly_travelers t join public.families f on f.id=t.family_id where f.family_member_clerk_id='dev-family-user' order by t.created_at limit 1;");
  assert.match(travelerId, /^[0-9a-f-]{36}$/);
  const trip = await tripActions.createTripRequest({
    elderly_traveler_id: travelerId,
    origin_airport: 'BOM',
    destination_airport: 'DEL',
    departure_date: nextMonday(),
    return_date: null,
    assistance_level: 'moderate',
    language_requirements: ['English'],
    special_instructions: 'M6 KYC matching integration fixture',
  }, randomUUID());
  assert.equal(trip.success, true);
  const tripRequestId = trip.request.id;

  const verificationTypes = await loadModule('src/lib/verification/types.ts');
  const metadata = await loadModule('src/lib/verification/metadata.ts', { './types': verificationTypes });
  const storage = await loadModule('src/lib/verification/storage.ts', { '@/lib/supabase-server': serverClient });
  const workflow = await loadModule('src/lib/verification/server-workflow.ts', {
    '@/lib/supabase-server': serverClient,
    './metadata': metadata,
  });
  const verificationAccess = await loadModule('src/lib/verification/access.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) },
    '@/lib/supabase-server': serverClient,
  });
  const verificationActions = await loadModule('src/actions/companion-verifications.ts', {
    '@/lib/auth/server': { getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) },
    '@/lib/supabase-server': serverClient,
    '@/lib/verification/access': verificationAccess,
    '@/lib/verification/metadata': metadata,
    '@/lib/verification/types': verificationTypes,
  });

  const browser = await chromium.launch({ headless: true });
  const companion = await browser.newContext();
  const family = await browser.newContext();
  const anonymous = await browser.newContext();
  const pageErrors = [];
  try {
    await login(companion, 'companion');
    const page = await companion.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/dashboard/companions/${companionId}`);
    await page.getByRole('heading', { name: 'KYC Verification' }).waitFor();
    await page.getByText('No verification documents submitted yet.', { exact: true }).waitFor();

    const pdf = Buffer.from('%PDF-1.4\n% synthetic M6 document\n');
    await page.getByLabel('Verification document', { exact: true }).setInputFiles({
      name: 'm6-kyc.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await page.getByText('Status: Pending', { exact: true }).waitFor();
    const downloadHref = await page.getByRole('link', { name: 'Download document', exact: true }).getAttribute('href');
    assert.ok(downloadHref);
    const verificationId = downloadHref.split('/').pop();
    assert.match(verificationId, /^[0-9a-f-]{36}$/);
    await page.reload();
    await page.getByText('Status: Pending', { exact: true }).waitFor();

    const row = sql(`select companion_id||'|'||document_type||'|'||background_check_status||'|'||document_storage_path from public.verifications where id='${verificationId}';`);
    assert.match(row, new RegExp(`^${companionId}\\|kyc\\|pending\\|companion-verifications/${companionId}/`));
    assert.equal(sql("select public from storage.buckets where id='companion-verifications';"), 'f');
    assert.equal(sql(`select count(*) from storage.objects where bucket_id='companion-verifications' and name like '${companionId}/%';`), '1');

    const download = await companion.request.get(`${base}${downloadHref}`);
    assert.equal(download.status(), 200);
    assert.equal(download.headers()['content-type'], 'application/pdf');
    assert.ok((await download.body()).includes(Buffer.from('%PDF-1.4')));

    await login(family, 'family');
    assert.equal((await family.request.get(`${base}/api/companion/kyc`)).status(), 403);
    assert.equal((await family.request.get(`${base}${downloadHref}`)).status(), 403);
    assert.equal((await anonymous.request.get(`${base}/api/companion/kyc`)).status(), 401);
    assert.equal((await anonymous.request.get(`${base}${downloadHref}`)).status(), 401);

    const pendingMatches = await runMatching(database, tripRequestId);
    assert.ok(!pendingMatches.some(match => match.companion.id === companionId));

    const approved = await workflow.reviewCompanionVerification({ verificationId, decision: 'approve', expiresAt: new Date(Date.now() + 86400000 * 30).toISOString() }, database);
    assert.equal(approved.background_check_status, 'passed');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'verified');
    await page.reload();
    await page.getByText('Status: Approved', { exact: true }).waitFor();
    const approvedMatches = await runMatching(database, tripRequestId);
    assert.ok(approvedMatches.some(match => match.companion.id === companionId));

    const secondPdf = Buffer.from('%PDF-1.4\n% synthetic M6 rejection document\n');
    await page.getByLabel('Verification document', { exact: true }).setInputFiles({ name: 'm6-reject.pdf', mimeType: 'application/pdf', buffer: secondPdf });
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await page.getByText('Status: Pending', { exact: true }).waitFor();
    const downloadLinks = page.getByRole('link', { name: 'Download document', exact: true });
    const secondHref = await downloadLinks.last().getAttribute('href');
    const secondVerificationId = secondHref.split('/').pop();
    assert.notEqual(secondVerificationId, verificationId);
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'pending');
    assert.ok(!(await runMatching(database, tripRequestId)).some(match => match.companion.id === companionId));
    const rejected = await workflow.reviewCompanionVerification({ verificationId: secondVerificationId, decision: 'reject' }, database);
    assert.equal(rejected.background_check_status, 'failed');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'rejected');
    await page.reload();
    await page.getByText('Status: Rejected', { exact: true }).waitFor();
    assert.ok(!(await runMatching(database, tripRequestId)).some(match => match.companion.id === companionId));

    const thirdPdf = Buffer.from('%PDF-1.4\n% synthetic M6 expiry document\n');
    await page.getByLabel('Verification document', { exact: true }).setInputFiles({ name: 'm6-expire.pdf', mimeType: 'application/pdf', buffer: thirdPdf });
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await page.getByText('Status: Pending', { exact: true }).waitFor();
    const thirdHref = await downloadLinks.last().getAttribute('href');
    const thirdVerificationId = thirdHref.split('/').pop();
    await workflow.reviewCompanionVerification({ verificationId: thirdVerificationId, decision: 'approve' }, database);
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'verified');
    assert.ok((await runMatching(database, tripRequestId)).some(match => match.companion.id === companionId));
    const expired = await workflow.reviewCompanionVerification({ verificationId: thirdVerificationId, decision: 'expire' }, database);
    assert.equal(expired.background_check_status, 'passed');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'expired');
    await page.reload();
    await page.getByText('Status: Expired', { exact: true }).waitFor();
    assert.ok(!(await runMatching(database, tripRequestId)).some(match => match.companion.id === companionId));

    assert.equal((await workflow.reviewCompanionVerification({ verificationId: thirdVerificationId, decision: 'approve' }, database).catch(() => null)), null);
    const otherUserId = sql("select user_clerk_id from public.companions where user_clerk_id <> 'dev-companion-user' limit 1;");
    assert.ok(otherUserId);
    const otherVerificationAccess = await loadModule('src/lib/verification/access.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: otherUserId, role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
    });
    const otherVerificationActions = await loadModule('src/actions/companion-verifications.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: otherUserId, role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
      '@/lib/verification/access': otherVerificationAccess,
      '@/lib/verification/metadata': metadata,
      '@/lib/verification/types': verificationTypes,
    });
    const otherMetadata = await otherVerificationActions.getCurrentCompanionVerifications();
    assert.equal(otherMetadata.success, true);
    assert.ok(!otherMetadata.verifications.some(item => item.id === verificationId));
    const otherDownloadRoute = await loadModule('src/app/api/companion/kyc/[id]/route.ts', {
      '@/lib/auth/server': { getCurrentUser: async () => ({ id: otherUserId, role: 'companion' }) },
      '@/lib/supabase-server': serverClient,
      '@/lib/verification/metadata': metadata,
      '@/lib/verification/storage': storage,
    });
    const crossCompanionResponse = await otherDownloadRoute.GET(new Request(`${base}${downloadHref}`), { params: Promise.resolve({ id: verificationId }) });
    assert.equal(crossCompanionResponse.status, 404);
    const verificationActionCheck = await verificationActions.getCurrentCompanionVerifications();
    assert.equal(verificationActionCheck.success, true);
    assert.ok(verificationActionCheck.verifications.some(item => item.id === verificationId));
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log(JSON.stringify({ companionId, verificationId, localDatabase: true, uploadPersisted: 'PASS', reloadPersistence: 'PASS', privateDownload: 'PASS', bucketPrivate: 'PASS', pendingExcluded: 'PASS', approvedEligible: 'PASS', rejectedExcluded: 'PASS', expiredExcluded: 'PASS', familyDenied: 'DENIED', anonymousDenied: 'DENIED', selfApprovalUnavailable: 'PASS', browserErrors: 0 }, null, 2));
  } finally {
    await browser.close();
  }
}

async function runMatching(database, tripRequestId) {
  const types = await loadModule('src/lib/matching/types.ts', { '@/lib/companion-types': await loadModule('src/lib/companion-types.ts') });
  const score = await loadModule('src/lib/matching/score-calculator.ts', { './types': types });
  const explanation = await loadModule('src/lib/matching/explanation-generator.ts', { './score-calculator': score, './types': types });
  const algorithm = await loadModule('src/lib/matching/basic-matching-algorithm.ts', { '@/lib/supabase-server': database, './score-calculator': score, './explanation-generator': explanation, './types': types });
  return algorithm.findMatchingCompanions(tripRequestId, database);
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
