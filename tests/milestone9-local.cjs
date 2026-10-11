// Real local Supabase + Chromium chat/notification integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd(), true);

const base = 'http://127.0.0.1:3109';
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
  const database = serverClient.createDevelopmentDatabaseClient();
  const bookingId = '70ae6c80-cbb8-586a-9117-3ed1d1971cbc';
  const row = sql(`select b.trip_request_id from public.bookings b where b.id='${bookingId}';`);
  const tripRequestId = row;
  const companionUserId = 'dev-companion-user';
  assert.match(tripRequestId, /^[0-9a-f-]{36}$/);
  assert.ok(companionUserId);

  // Reset only this synthetic local fixture; no migration or remote database is touched.
  sql(`delete from public.notifications where user_clerk_id in ('dev-family-user','${companionUserId}'); delete from public.messages where trip_id in (select id from public.trips where booking_id='${bookingId}'); delete from public.trips where booking_id='${bookingId}'; update public.bookings set companion_id=(select id from public.companions where user_clerk_id='${companionUserId}'),status='confirmed',payment_status='paid',updated_at=now() where id='${bookingId}'; update public.trip_requests set status='booked',updated_at=now() where id='${tripRequestId}';`);

  const messageTypes = await loadModule('src/lib/message-types.ts');
  const notificationTypes = await loadModule('src/lib/notification-types.ts');
  const cryptoCodec = await loadModule('src/lib/traveler-sensitive-fields.ts');
  const authModule = auth => ({
    '@/lib/auth/server': auth,
    '@/lib/supabase-server': serverClient,
    '@/lib/message-types': messageTypes,
    '@/lib/notification-types': notificationTypes,
    '@/lib/traveler-sensitive-fields': cryptoCodec,
  });
  const familyMessages = await loadModule('src/actions/messages.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companionMessages = await loadModule('src/actions/messages.ts', authModule({ getCurrentUser: async () => ({ id: companionUserId, role: 'companion' }) }));
  const otherFamilyMessages = await loadModule('src/actions/messages.ts', authModule({ getCurrentUser: async () => ({ id: 'm9-other-family-user', role: 'family' }) }));
  const otherCompanionMessages = await loadModule('src/actions/messages.ts', authModule({ getCurrentUser: async () => ({ id: 'm9-other-companion-user', role: 'companion' }) }));
  const anonymousMessages = await loadModule('src/actions/messages.ts', authModule({ getCurrentUser: async () => null }));
  const familyNotifications = await loadModule('src/actions/notifications.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const companionNotifications = await loadModule('src/actions/notifications.ts', authModule({ getCurrentUser: async () => ({ id: companionUserId, role: 'companion' }) }));
  const otherFamilyNotifications = await loadModule('src/actions/notifications.ts', authModule({ getCurrentUser: async () => ({ id: 'm9-other-family-user', role: 'family' }) }));
  const anonymousNotifications = await loadModule('src/actions/notifications.ts', authModule({ getCurrentUser: async () => null }));

  const initialTrip = await loadModule('src/actions/trips.ts', authModule({ getCurrentUser: async () => ({ id: 'dev-family-user', role: 'family' }) }));
  const tripResult = await initialTrip.getTripForBooking(bookingId);
  assert.equal(tripResult.success, true);
  const tripId = tripResult.trip.id;

  const browser = await chromium.launch({ headless: true });
  const family = await browser.newContext();
  const companion = await browser.newContext();
  const pageErrors = [];
  try {
    await login(family, 'family');
    const familyPage = await family.newPage();
    familyPage.on('pageerror', error => pageErrors.push(error.message));
    await familyPage.goto(`${base}/dashboard/bookings/${bookingId}`);
    await familyPage.getByText('Trip Conversation', { exact: true }).waitFor();
    await familyPage.getByText('No messages yet. Send the first update to the other trip participant.', { exact: true }).waitFor();

    const first = await familyMessages.sendMessage({ tripId, content: 'Family needs a terminal update.', idempotencyKey: 'm9-family-1' });
    assert.equal(first.success, true);
    assert.equal(first.created, true);
    const messageId = first.message.id;
    assert.equal(sql(`select count(*) from public.messages where id='${messageId}' and trip_id='${tripId}' and sender_clerk_id='dev-family-user';`), '1');
    assert.equal(sql(`select count(*) from public.notifications where user_clerk_id='${companionUserId}' and type='trip_update';`), '1');

    const duplicate = await Promise.all([
      familyMessages.sendMessage({ tripId, content: 'Parallel safe send.', idempotencyKey: 'm9-parallel' }),
      familyMessages.sendMessage({ tripId, content: 'Parallel safe send.', idempotencyKey: 'm9-parallel' }),
    ]);
    assert.ok(duplicate.every(result => result.success));
    assert.equal(new Set(duplicate.map(result => result.message.id)).size, 1);
    assert.equal(sql(`select count(*) from public.messages where trip_id='${tripId}' and content='Parallel safe send.';`), '1');
    assert.equal((await familyMessages.sendMessage({ tripId, content: '   ' })).code, 'INVALID_INPUT');
    assert.equal((await familyMessages.sendMessage({ tripId: 'not-a-uuid', content: 'bad' })).code, 'INVALID_INPUT');

    await login(companion, 'companion');
    const companionPage = await companion.newPage();
    companionPage.on('pageerror', error => pageErrors.push(error.message));
    await companionPage.goto(`${base}/dashboard/bookings/${bookingId}`);
    await companionPage.getByText('Family needs a terminal update.', { exact: true }).waitFor();
    assert.equal(sql(`select 'dev-companion-user'=any(read_by) from public.messages where id='${messageId}';`), 't');
    const companionList = await companionMessages.listMessages(tripId);
    assert.equal(companionList.success, true);
    assert.ok(companionList.messages.some(message => message.id === messageId && message.content === 'Family needs a terminal update.'));
    const reply = await companionMessages.sendMessage({ tripId, content: 'Companion confirms the terminal.', idempotencyKey: 'm9-companion-1' });
    assert.equal(reply.success, true);
    assert.equal(sql(`select count(*) from public.messages where id='${reply.message.id}' and sender_clerk_id='${companionUserId}';`), '1');
    assert.equal(sql("select count(*) from public.notifications where user_clerk_id='dev-family-user' and type='trip_update';"), '1');
    await familyPage.reload();
    await familyPage.getByText('Companion confirms the terminal.', { exact: true }).waitFor();
    assert.equal(sql(`select 'dev-family-user'=any(read_by) from public.messages where id='${reply.message.id}';`), 't');

    const familyNotificationsList = await familyNotifications.listNotifications({ unreadOnly: true });
    assert.equal(familyNotificationsList.success, true);
    assert.ok(familyNotificationsList.notifications.length >= 1);
    const notificationId = familyNotificationsList.notifications[0].id;
    const marked = await familyNotifications.markNotificationRead(notificationId);
    assert.equal(marked.success, true);
    assert.equal(marked.notification.is_read, true);
    assert.equal(sql(`select is_read from public.notifications where id='${notificationId}' and user_clerk_id='dev-family-user';`), 't');
    assert.equal((await familyNotifications.listNotifications({ unreadOnly: true })).notifications.some(item => item.id === notificationId), false);
    await familyPage.reload();
    await familyPage.getByText('Notifications', { exact: true }).waitFor();

    assert.equal((await otherFamilyMessages.listMessages(tripId)).code, 'NOT_FOUND');
    assert.equal((await otherFamilyMessages.sendMessage({ tripId, content: 'private' })).code, 'NOT_FOUND');
    assert.equal((await otherCompanionMessages.listMessages(tripId)).code, 'NOT_FOUND');
    assert.equal((await anonymousMessages.listMessages(tripId)).code, 'UNAUTHENTICATED');
    assert.equal((await otherFamilyNotifications.markNotificationRead(notificationId)).code, 'NOT_FOUND');
    assert.equal((await anonymousNotifications.listNotifications()).code, 'UNAUTHENTICATED');
    assert.equal((await companionNotifications.listNotifications()).success, true);
    assert.equal((await familyMessages.markMessageRead({ messageId, tripId })).success, true);

    console.log(JSON.stringify({ bookingId, tripId, tripRequestId, localDatabase: true, familyMessagePersisted: 'PASS', companionRetrieved: 'PASS', replyPersisted: 'PASS', reloadConversation: 'PASS', invalidMessagesRejected: 'PASS', parallelDuplicateSend: 'PASS', messageNotificationsCreated: 'PASS', notificationReadPersisted: 'PASS', otherFamilyDenied: 'DENIED', otherCompanionDenied: 'DENIED', anonymousDenied: 'DENIED', privateNotificationReadDenied: 'DENIED', browserErrors: pageErrors.length }, null, 2));
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
