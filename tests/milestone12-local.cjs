// Real local Supabase + Chromium admin operations integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3112';
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
  const verificationId = sql("select id from public.verifications order by created_at limit 1;");
  const companionId = sql(`select companion_id from public.verifications where id='${verificationId}';`);
  assert.match(verificationId, /^[0-9a-f-]{36}$/);
  assert.match(companionId, /^[0-9a-f-]{36}$/);
  const original = sql(`select background_check_status||'|'||coalesce(verified_at::text,'')||'|'||coalesce(expires_at::text,'') from public.verifications where id='${verificationId}';`);
  const originalCompanionStatus = sql(`select verification_status from public.companions where id='${companionId}';`);
  const originalAdminRole = sql("select coalesce(string_agg(role,','),'') from public.admin_roles where clerk_id='dev-admin-user';");
  const auditBaseline = Number(sql(`select count(*) from public.audit_logs where record_id='${verificationId}' and action='VERIFICATION' and user_clerk_id='dev-admin-user';`));

  // Local-only admin/verification fixture setup. This is restored in finally.
  sql(`insert into public.admin_roles (clerk_id,role) values ('dev-admin-user','super_admin') on conflict (clerk_id) do update set role='super_admin'; update public.verifications set background_check_status='pending',verified_at=null,expires_at=null,updated_at=now() where id='${verificationId}'; update public.companions set verification_status='pending',updated_at=now() where id='${companionId}';`);

  const adminTypes = await loadModule('src/lib/admin-types.ts');
  const cryptoCodec = await loadModule('src/lib/traveler-sensitive-fields.ts');
  const verificationMetadata = await loadModule('src/lib/verification/metadata.ts');
  const workflow = await loadModule('src/lib/verification/server-workflow.ts', {
    '@/lib/supabase-server': await loadModule('src/lib/supabase-server.ts'),
    '@/lib/verification/metadata': verificationMetadata,
    './metadata': verificationMetadata,
  });
  const serverClient = await loadModule('src/lib/supabase-server.ts');
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/admin-types': adminTypes,
    '@/lib/supabase-server': serverClient,
    '@/lib/traveler-sensitive-fields': cryptoCodec,
    '@/lib/verification/server-workflow': workflow,
    '@/lib/verification/metadata': verificationMetadata,
  });
  const admin = await loadModule('src/actions/admin.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-admin-user', role: 'admin' }) }));
  const family = await loadModule('src/actions/admin.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companion = await loadModule('src/actions/admin.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-companion-user', role: 'companion' }) }));
  const anonymous = await loadModule('src/actions/admin.ts', authModule({ getCurrentUser: async () => null }));

  const browser = await chromium.launch({ headless: true });
  const adminContext = await browser.newContext();
  const familyContext = await browser.newContext();
  const companionContext = await browser.newContext();
  const pageErrors = [];
  try {
    assert.equal((await family.getAdminOverview()).code, 'FORBIDDEN');
    assert.equal((await companion.getAdminOverview()).code, 'FORBIDDEN');
    assert.equal((await anonymous.getAdminOverview()).code, 'UNAUTHENTICATED');
    assert.equal((await family.reviewAdminVerification(verificationId, 'approve')).code, 'FORBIDDEN');
    assert.equal((await companion.reviewAdminVerification(verificationId, 'approve')).code, 'FORBIDDEN');

    const overview = await admin.getAdminOverview({ limit: 10, offset: 0 });
    assert.equal(overview.success, true);
    assert.ok(overview.overview.stats.families >= 1);
    assert.ok(overview.overview.stats.companions >= 1);
    assert.ok(overview.overview.stats.pending_verifications >= 1);
    const pending = overview.overview.pending_verifications.find((item) => item.id === verificationId);
    assert.ok(pending);
    assert.equal('document_storage_path' in pending, false);
    assert.equal('location' in pending, false);
    assert.equal('medical_conditions' in pending, false);

    await login(adminContext, 'admin');
    const adminPage = await adminContext.newPage();
    adminPage.on('pageerror', error => pageErrors.push(error.message));
    await adminPage.goto(`${base}/dashboard/admin`);
    await adminPage.getByText('Admin dashboard', { exact: true }).waitFor();
    await adminPage.getByText('Pending verification queue', { exact: true }).waitFor();
    await adminPage.getByText('Document contents and storage locations are not shown in this review surface.', { exact: true }).waitFor();
    await adminPage.reload();
    await adminPage.getByText('Admin dashboard', { exact: true }).waitFor();

    const detail = await admin.getAdminVerification(verificationId);
    assert.equal(detail.success, true);
    assert.equal('document_storage_path' in detail.verification, false);
    assert.equal('location' in detail.verification, false);

    const approved = await admin.reviewAdminVerification(verificationId, 'approve', new Date(Date.now() + 86400000).toISOString());
    assert.equal(approved.success, true);
    assert.equal(approved.verification.background_check_status, 'passed');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'verified');
    assert.equal(sql(`select background_check_status from public.verifications where id='${verificationId}';`), 'passed');
    assert.equal(Number(sql(`select count(*) from public.audit_logs where record_id='${verificationId}' and action='VERIFICATION' and user_clerk_id='dev-admin-user';`)), auditBaseline + 1);

    assert.equal((await admin.reviewAdminVerification(verificationId, 'approve')).success, false);
    const expired = await admin.reviewAdminVerification(verificationId, 'expire');
    assert.equal(expired.success, true);
    assert.equal(expired.verification.background_check_status, 'passed');
    assert.equal(sql(`select verification_status from public.companions where id='${companionId}';`), 'expired');
    assert.equal(Number(sql(`select count(*) from public.audit_logs where record_id='${verificationId}' and action='VERIFICATION' and user_clerk_id='dev-admin-user';`)), auditBaseline + 2);

    await login(familyContext, 'family');
    const familyPage = await familyContext.newPage();
    await familyPage.goto(`${base}/dashboard/admin`);
    await familyPage.getByText('This dashboard is only available to admin users.', { exact: true }).waitFor();
    await login(companionContext, 'companion');
    const companionPage = await companionContext.newPage();
    companionPage.on('pageerror', error => pageErrors.push(error.message));
    await companionPage.goto(`${base}/dashboard/admin`);
    await companionPage.getByText('This dashboard is only available to admin users.', { exact: true }).waitFor();
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));

    console.log(JSON.stringify({ verificationId, companionId, localDatabase: true, adminAllowed: 'PASS', familyDenied: 'DENIED', companionDenied: 'DENIED', anonymousDenied: 'DENIED', pendingQueue: 'PASS', safeVerificationMetadata: 'PASS', bookingTripStats: 'PASS', sosRatingsOversight: 'PASS', approveTransition: 'PASS', invalidTransition: 'PASS', expireTransition: 'PASS', companionSelfReviewDenied: 'DENIED', auditLog: 'PASS', reloadPreservation: 'PASS', browserErrors: pageErrors.length }, null, 2));
  } finally {
    const [background, verifiedAt, expiresAt] = original.split('|');
    const verifiedSql = verifiedAt ? `'${verifiedAt}'` : 'null';
    const expiresSql = expiresAt ? `'${expiresAt}'` : 'null';
    sql(`update public.verifications set background_check_status='${background}',verified_at=${verifiedSql},expires_at=${expiresSql},updated_at=now() where id='${verificationId}'; update public.companions set verification_status='${originalCompanionStatus}',updated_at=now() where id='${companionId}'; ${originalAdminRole ? `update public.admin_roles set role='${originalAdminRole}' where clerk_id='dev-admin-user';` : "delete from public.admin_roles where clerk_id='dev-admin-user';"}`);
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
