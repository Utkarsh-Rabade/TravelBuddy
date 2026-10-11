// Local-only integration test. Creates synthetic records; never uses a remote DB.
// Run with next dev on 127.0.0.1:3102 and the explicit development auth flag.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
const base = 'http://127.0.0.1:3102';
const fixtureName = 'M2Synthetic-' + randomUUID().slice(0, 8);
function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}
function flightResult(text) {
  for (const line of text.split('\n')) {
    const match = line.match(/^\d+:(\{"success".*\})$/);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error('No action result in server response.');
}
async function replay(context, request, args) {
  const response = await context.request.post(base + '/dashboard/family/travelers/new', {
    headers: { 'next-action': request.headers()['next-action'], 'content-type': 'text/plain;charset=UTF-8', origin: base },
    data: JSON.stringify(args),
  });
  assert.equal(response.status(), 200);
  return flightResult(await response.text());
}
async function login(context, role) {
  const response = await context.request.post(base + '/api/dev-auth/session', { data: { role }, headers: { origin: base } });
  assert.equal(response.status(), 200);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const family = await browser.newContext();
    await login(family, 'family');
    const page = await family.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const actionRequests = [];
    page.on('request', request => { if (request.headers()['next-action']) actionRequests.push(request); });
    await page.goto(base + '/dashboard/family');
    await page.getByRole('link', { name: 'Add Traveler', exact: true }).click();
    await page.getByLabel('First Name', { exact: true }).fill(fixtureName);
    await page.getByLabel('Last Name', { exact: true }).fill('Traveler');
    await page.getByLabel('Date of Birth', { exact: true }).fill('1950-04-12');
    await page.getByLabel('Medical Conditions (comma-separated)', { exact: true }).fill('synthetic-condition');
    await page.getByLabel('Accessibility Needs (comma-separated)', { exact: true }).fill('synthetic-assistance');
    await page.getByLabel('Primary Contact Name', { exact: true }).fill('Synthetic Contact');
    await page.getByLabel('Primary Contact Phone', { exact: true }).fill('0000000000');
    await page.getByRole('button', { name: 'Save Traveler', exact: true }).click();
    await page.waitForURL(/\/travelers\/[0-9a-f-]+$/);
    await page.getByRole('heading', { name: fixtureName + ' Traveler', exact: true }).waitFor();
    const travelerId = page.url().split('/').pop();
    assert.match(travelerId, /^[0-9a-f-]{36}$/);
    const createRequest = actionRequests.find(r => r.postData()?.includes('M2Synthetic'));
    const readRequest = actionRequests.find(r => r.postData() === JSON.stringify([travelerId]));
    assert.ok(createRequest && readRequest);
    const repeated = await replay(family, createRequest, JSON.parse(createRequest.postData()));
    assert.equal(repeated.traveler.id, travelerId);
    await page.getByText('synthetic-condition', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('synthetic-condition', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Edit Traveler', exact: true }).click();
    await page.getByLabel('Last Name', { exact: true }).fill('Updated');
    await page.getByLabel('Medical Conditions (comma-separated)', { exact: true }).fill('synthetic-updated-condition');
    await page.getByRole('button', { name: 'Save Traveler', exact: true }).click();
    await page.waitForURL(base + '/dashboard/family/travelers/' + travelerId);
    await page.getByRole('heading', { name: fixtureName + ' Updated', exact: true }).waitFor();
    await page.getByText('synthetic-updated-condition', { exact: true }).waitFor();
    const updateRequest = actionRequests.find(r => r.postData()?.includes('synthetic-updated-condition'));
    assert.ok(updateRequest);
    await page.reload();
    await page.getByText('synthetic-updated-condition', { exact: true }).waitFor();
    await page.goto(base + '/dashboard/family/travelers');
    await page.getByRole('heading', { name: fixtureName + ' Updated', exact: true }).waitFor();
    assert.equal(sql(`select count(*) from public.elderly_travelers t join public.families f on f.id=t.family_id where t.id='${travelerId}' and f.family_member_clerk_id='dev-family-user' and t.last_name='Updated';`), '1');
    assert.equal(sql(`select (medical_conditions is not null and accessibility_needs is not null and emergency_contacts is not null and position('synthetic-updated-condition' in convert_from(medical_conditions,'UTF8'))=0 and position('Synthetic Contact' in convert_from(emergency_contacts,'UTF8'))=0)::text from public.elderly_travelers where id='${travelerId}';`), 'true');
    assert.equal(sql(`select (updated_at > created_at)::text from public.elderly_travelers where id='${travelerId}';`), 'true');
    const input = { first_name: 'Synthetic', last_name: 'Direct', date_of_birth: '1950-01-01', medical_conditions: [], accessibility_needs: [], emergency_contacts: { primary_name: 'Fixture', primary_phone: '000', secondary_name: '', secondary_phone: '' } };
    assert.equal((await replay(family, createRequest, [{ ...input, first_name: '' }, randomUUID()])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, createRequest, [{ ...input, date_of_birth: '2026-02-30' }, randomUUID()])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, readRequest, ['invalid-id'])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, updateRequest, [travelerId, { first_name: '' }])).code, 'INVALID_INPUT');
    // A second family is a DB fixture, NOT an arbitrary selectable auth identity.
    const foreignFamily = randomUUID(), foreignTraveler = randomUUID();
    sql(`insert into public.families(id,family_member_clerk_id,name) values('${foreignFamily}','m2-fixture-${foreignFamily}','M2 Foreign Fixture'); insert into public.elderly_travelers(id,family_id,first_name,last_name) values('${foreignTraveler}','${foreignFamily}','Foreign','Fixture');`);
    assert.equal((await replay(family, readRequest, [foreignTraveler])).code, 'NOT_FOUND');
    assert.equal((await replay(family, updateRequest, [foreignTraveler, { first_name: 'Tampered' }])).code, 'NOT_FOUND');
    const companion = await browser.newContext();
    await login(companion, 'companion');
    for (const [request, args] of [[readRequest, [travelerId]], [updateRequest, [travelerId, { first_name: 'Tampered' }]], [createRequest, [input, randomUUID()]]]) {
      const denied = await replay(companion, request, args);
      assert.equal(denied.success, false);
      assert.equal(denied.code, 'FORBIDDEN');
      assert.ok(!Object.hasOwn(denied, 'traveler'));
    }
    const anonymous = await browser.newContext();
    assert.equal((await replay(anonymous, readRequest, [travelerId])).code, 'UNAUTHENTICATED');
    assert.equal((await replay(anonymous, createRequest, [input, randomUUID()])).code, 'UNAUTHENTICATED');
    assert.equal(sql(`select first_name from public.elderly_travelers where id='${foreignTraveler}';`), 'Foreign');
    assert.equal(sql(`select first_name from public.elderly_travelers where id='${travelerId}';`), fixtureName);
    const cp = await companion.newPage();
    for (const path of ['/new', '/' + travelerId, '/' + travelerId + '/edit', '']) {
      await cp.goto(base + '/dashboard/family/travelers' + path);
      await cp.getByText(path === '/new' ? 'Only a family development identity can add travelers.' : 'This page is only available to family users.', { exact: true }).waitFor();
      assert.ok(!(await cp.locator('body').innerText()).includes('synthetic-updated-condition'));
    }
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ travelerId, localDatabase: true, create: 'PASS', retrieve: 'PASS', reload: 'PASS', update: 'PASS', updatedReload: 'PASS', encryptedBytea: 'PASS', invalidInput: 'PASS', foreignFamilyReadUpdate: 'DENIED', companionCreateReadUpdate: 'DENIED', anonymous: 'DENIED', browserErrors: 0 }, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
