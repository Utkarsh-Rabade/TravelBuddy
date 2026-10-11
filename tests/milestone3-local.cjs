// Real local database + Chromium; creates synthetic test requests only.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('@playwright/test');
const base = 'http://127.0.0.1:3103';
const prefix = 'M3-' + randomUUID().slice(0, 8);
require('@next/env').loadEnvConfig(process.cwd(), true);
for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const url = new URL(process.env[key]);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54321', 'Refusing non-local Supabase.');
}
function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_TravelBuddy', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim();
}
function result(text) {
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+:(\{"success".*\})$/);
    if (m) return JSON.parse(m[1]);
  }
  throw new Error('No server action result.');
}
async function replay(context, request, args) {
  const response = await context.request.post(base + '/dashboard/family/trip-requests/new', {
    headers: { origin: base, 'next-action': request.headers()['next-action'], 'content-type': 'text/plain;charset=UTF-8' },
    data: JSON.stringify(args),
  });
  assert.equal(response.status(), 200);
  return result(await response.text());
}
async function login(context, role) {
  const response = await context.request.post(base + '/api/dev-auth/session', { headers: { origin: base }, data: { role } });
  assert.equal(response.status(), 200);
}
function dateAfter(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const family = await browser.newContext();
    await login(family, 'family');
    const page = await family.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.headers()['next-action']) requests.push(r); });
    await page.goto(base + '/dashboard/family');
    await page.getByRole('link', { name: 'Create Trip Request', exact: true }).click();
    const selector = page.getByLabel('Traveler', { exact: true });
    await selector.waitFor();
    const travelerId = sql("select t.id from public.elderly_travelers t join public.families f on f.id=t.family_id where f.family_member_clerk_id='dev-family-user' order by t.created_at limit 1;");
    const secondTravelerId = sql("select t.id from public.elderly_travelers t join public.families f on f.id=t.family_id where f.family_member_clerk_id='dev-family-user' order by t.created_at offset 1 limit 1;");
    assert.match(travelerId, /^[0-9a-f-]{36}$/);
    assert.match(secondTravelerId, /^[0-9a-f-]{36}$/);
    await selector.selectOption(travelerId);
    const departure = dateAfter(30), returnDate = dateAfter(35);
    await page.getByLabel('Origin Airport (IATA Code)', { exact: true }).fill('bom');
    await page.getByLabel('Destination Airport (IATA Code)', { exact: true }).fill('del');
    await page.getByLabel('Departure Date', { exact: true }).fill(departure);
    await page.getByLabel('Return Date (optional for one-way)', { exact: true }).fill(returnDate);
    await page.getByLabel('Assistance Level', { exact: true }).selectOption('moderate');
    await page.getByLabel('Language Requirements (comma-separated)', { exact: true }).fill(' Hindi, English, hindi ');
    await page.getByLabel('Special Instructions', { exact: true }).fill(prefix + ' create');
    await page.getByRole('button', { name: 'Create Trip Request', exact: true }).click();
    await page.waitForURL(/\/trip-requests\/[0-9a-f-]+$/);
    await page.getByText(prefix + ' create', { exact: true }).waitFor();
    await page.getByText('BOM → DEL', { exact: true }).waitFor();
    await page.getByText('Draft', { exact: true }).waitFor();
    const id = page.url().split('/').pop();
    const create = requests.find(r => r.postData()?.includes(prefix + ' create'));
    const read = requests.find(r => r.postData() === JSON.stringify([id]));
    assert.ok(create && read);
    const [input, submission] = JSON.parse(create.postData());
    let retrieved = await replay(family, read, [id]);
    assert.equal(retrieved.success, true);
    for (const [key, expected] of Object.entries({ elderly_traveler_id: travelerId, origin_airport: 'BOM', destination_airport: 'DEL', departure_date: departure, return_date: returnDate, assistance_level: 'moderate', special_instructions: prefix + ' create', status: 'draft' })) assert.equal(retrieved.request[key], expected);
    assert.deepEqual(retrieved.request.language_requirements, ['english', 'hindi']);
    assert.equal(typeof retrieved.request.elderly_travelers, 'object');
    assert.ok(!Object.hasOwn(retrieved.request.elderly_travelers, 'medical_conditions'));
    await page.reload();
    await page.getByText(prefix + ' create', { exact: true }).waitFor();
    const duplicate = await replay(family, create, [input, submission]);
    assert.equal(duplicate.request.id, id);
    assert.equal((await replay(family, create, [{ ...input, special_instructions: prefix + ' conflict' }, submission])).code, 'CONFLICT');
    const simultaneousId = randomUUID();
    const pair = await Promise.all([replay(family, create, [input, simultaneousId]), replay(family, create, [input, simultaneousId])]);
    assert.ok(pair.every(p => p.success && p.request.id === simultaneousId));
    assert.equal(sql(`select count(*) from public.trip_requests where id='${simultaneousId}';`), '1');
    await page.getByRole('link', { name: 'Edit Request', exact: true }).click();
    await page.getByLabel('Traveler', { exact: true }).waitFor();
    await page.getByLabel('Traveler', { exact: true }).selectOption(secondTravelerId);
    await page.getByLabel('Origin Airport (IATA Code)', { exact: true }).fill('del');
    await page.getByLabel('Destination Airport (IATA Code)', { exact: true }).fill('lhr');
    await page.getByLabel('Departure Date', { exact: true }).fill(dateAfter(40));
    await page.getByLabel('Return Date (optional for one-way)', { exact: true }).fill('');
    await page.getByLabel('Assistance Level', { exact: true }).selectOption('maximum');
    await page.getByLabel('Language Requirements (comma-separated)', { exact: true }).fill('Marathi');
    await page.getByLabel('Special Instructions', { exact: true }).fill(prefix + ' update');
    await page.getByLabel('Status', { exact: true }).selectOption('searching');
    await page.getByRole('button', { name: 'Save Trip Request', exact: true }).click();
    await page.waitForURL(base + '/dashboard/family/trip-requests/' + id);
    await page.getByText(prefix + ' update', { exact: true }).waitFor();
    await page.getByText('Searching', { exact: true }).waitFor();
    const update = requests.find(r => r.postData()?.includes(prefix + ' update'));
    assert.ok(update);
    const [, editedInput] = JSON.parse(update.postData());
    await page.reload();
    await page.getByText(prefix + ' update', { exact: true }).waitFor();
    retrieved = await replay(family, read, [id]);
    assert.equal(retrieved.request.elderly_traveler_id, secondTravelerId);
    assert.equal(retrieved.request.origin_airport, 'DEL');
    assert.equal(retrieved.request.destination_airport, 'LHR');
    assert.equal(retrieved.request.return_date, null);
    assert.equal(retrieved.request.departure_date, dateAfter(40));
    assert.equal(retrieved.request.assistance_level, 'maximum');
    assert.deepEqual(retrieved.request.language_requirements, ['marathi']);
    assert.equal(retrieved.request.status, 'searching');
    assert.equal((await replay(family, update, [id, editedInput])).success, true);
    assert.equal(sql(`select count(*) from public.trip_requests r join public.families f on f.id=r.family_id join public.elderly_travelers t on t.id=r.elderly_traveler_id and t.family_id=r.family_id where r.id='${id}' and f.family_member_clerk_id='dev-family-user' and r.return_date is null and r.destination_airport='LHR' and r.status='searching' and r.updated_at>r.created_at;`), '1');
    const invalids = [
      { elderly_traveler_id: 'invalid-id' }, { departure_date: '2026-02-30' },
      { departure_date: '2020-01-01' }, { return_date: '2026-02-30' },
      { return_date: dateAfter(1) }, { origin_airport: '12!' },
      { destination_airport: 'BOM' }, { assistance_level: 'unsupported' },
      { language_requirements: 'Hindi' }, { special_instructions: 'x'.repeat(2001) },
      { status: 'completed' }, { family_id: randomUUID() }, { owner_id: 'dev-companion-user' },
      { matching_criteria: {} },
    ];
    const countBeforeInvalid = sql('select count(*) from public.trip_requests;');
    for (const change of invalids) assert.equal((await replay(family, create, [{ ...input, ...change }, randomUUID()])).code, 'INVALID_INPUT');
    assert.equal(sql('select count(*) from public.trip_requests;'), countBeforeInvalid);
    assert.equal((await replay(family, create, [{ ...input, status: 'searching' }, randomUUID()])).code, 'INVALID_STATE');
    assert.equal((await replay(family, read, ['invalid'])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, read, [randomUUID()])).code, 'NOT_FOUND');
    assert.equal((await replay(family, create, [{ ...input, elderly_traveler_id: randomUUID() }, randomUUID()])).code, 'FORBIDDEN');
    assert.equal((await replay(family, update, [id, { ...editedInput, status: 'draft' }])).code, 'INVALID_STATE');
    assert.equal((await replay(family, update, [id, { ...editedInput, status: 'booked' }])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, update, [id, { ...editedInput, departure_date: '2026-02-30' }])).code, 'INVALID_INPUT');
    assert.equal((await replay(family, update, [id, { ...editedInput, family_id: randomUUID() }])).code, 'INVALID_INPUT');
    const foreignFamily = randomUUID(), foreignTraveler = randomUUID(), foreignRequest = randomUUID();
    sql(`insert into public.families(id,family_member_clerk_id,name) values('${foreignFamily}','m3-fixture-${foreignFamily}','M3 Foreign Fixture'); insert into public.elderly_travelers(id,family_id,first_name,last_name) values('${foreignTraveler}','${foreignFamily}','Foreign','M3'); insert into public.trip_requests(id,family_id,elderly_traveler_id,origin_airport,destination_airport,departure_date,assistance_level) values('${foreignRequest}','${foreignFamily}','${foreignTraveler}','BOM','DEL','${departure}','minimal');`);
    assert.equal((await replay(family, create, [{ ...input, elderly_traveler_id: foreignTraveler }, randomUUID()])).code, 'FORBIDDEN');
    assert.equal((await replay(family, update, [id, { ...editedInput, elderly_traveler_id: foreignTraveler }])).code, 'FORBIDDEN');
    assert.equal((await replay(family, read, [foreignRequest])).code, 'NOT_FOUND');
    assert.equal((await replay(family, update, [foreignRequest, editedInput])).code, 'NOT_FOUND');
    assert.equal((await replay(family, create, [input, foreignRequest])).code, 'CONFLICT');
    const foreignPage = await family.newPage();
    for (const path of ['/' + foreignRequest, '/' + foreignRequest + '/edit']) {
      await foreignPage.goto(base + '/dashboard/family/trip-requests' + path);
      await foreignPage.getByText('Trip request not found.', { exact: true }).waitFor();
      assert.equal(await foreignPage.locator('form').count(), 0);
    }
    await foreignPage.close();
    // Negative browser edit: values stay mounted after a rejected state change.
    await page.getByRole('link', { name: 'Edit Request', exact: true }).click();
    await page.getByLabel('Status', { exact: true }).selectOption('draft');
    await page.getByRole('button', { name: 'Save Trip Request', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Special Instructions', { exact: true }).inputValue(), prefix + ' update');
    assert.equal(await page.getByLabel('Destination Airport (IATA Code)', { exact: true }).inputValue(), 'LHR');
    const listResponse = page.waitForResponse(r => r.request().headers()['next-action'] && new URL(r.url()).pathname === '/dashboard/family/trip-requests');
    await page.goto(base + '/dashboard/family/trip-requests');
    const listRequest = (await listResponse).request();
    await page.locator(`a[href='/dashboard/family/trip-requests/${id}']`).waitFor();
    await page.reload();
    await page.locator(`a[href='/dashboard/family/trip-requests/${id}']`).waitFor();
    const list = await replay(family, listRequest, []);
    assert.ok(list.success && list.requests.some(r => r.id === id) && !list.requests.some(r => r.id === foreignRequest));
    const optionsRequest = requests.find(r => r.postData() === '[]' && new URL(r.url()).pathname.endsWith('/new'));
    assert.ok(optionsRequest);
    const options = await replay(family, optionsRequest, []);
    assert.ok(options.success && !options.travelers.some(t => t.id === foreignTraveler));
    const companion = await browser.newContext(); await login(companion, 'companion');
    const anonymous = await browser.newContext();
    for (const [request, args] of [[create, [input, randomUUID()]], [read, [id]], [update, [id, editedInput]], [listRequest, []], [optionsRequest, []]]) {
      assert.equal((await replay(companion, request, args)).code, 'FORBIDDEN');
      assert.equal((await replay(anonymous, request, args)).code, 'UNAUTHENTICATED');
    }
    const cp = await companion.newPage();
    const ap = await anonymous.newPage();
    for (const path of ['', '/new', '/' + id, '/' + id + '/edit']) {
      await cp.goto(base + '/dashboard/family/trip-requests' + path);
      await cp.getByText('Trip requests are only available to family users.', { exact: true }).waitFor();
      assert.ok(!(await cp.locator('body').innerText()).includes(prefix));
      await ap.goto(base + '/dashboard/family/trip-requests' + path);
      await ap.getByText(/Please sign in/).waitFor();
      assert.ok(!(await ap.locator('body').innerText()).includes(prefix));
    }
    assert.equal(sql(`select status||':'||destination_airport from public.trip_requests where id='${id}';`), 'searching:LHR');
    assert.equal(sql(`select status||':'||destination_airport from public.trip_requests where id='${foreignRequest}';`), 'draft:DEL');
    assert.equal(sql(`select count(*) from public.trip_requests where id='${submission}';`), '1');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ requestId: id, localDatabase: true, createAllFields: 'PASS', retrieve: 'PASS', reload: 'PASS', editOneWayAndFields: 'PASS', updatedReload: 'PASS', duplicateAndParallelSubmission: 'PASS', invalidInput: 'PASS', forgedOwnership: 'DENIED', crossFamilyTravelerRequest: 'DENIED', companion: 'DENIED', anonymous: 'DENIED', guardedState: 'PASS', browserErrors: 0 }, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
