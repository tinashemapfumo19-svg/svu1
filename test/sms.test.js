import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsSender, loadSmsConfig, normalisePhone, smsTemplates, smsText, startSmsDispatcher } from '../server/sms.js';
import { notificationGroupFor } from '../server/notification-preferences.js';

test('SMS is off by default; simulation is development-only; the provider needs its keys', () => {
  assert.equal(loadSmsConfig({}).provider, 'disabled');
  assert.throws(() => loadSmsConfig({ SVU_SMS: 'simulated', SVU_ENV: 'production' }), /only available in development/);
  assert.throws(() => loadSmsConfig({ SVU_SMS: 'africastalking' }), /AT_USERNAME/);
  assert.equal(createSmsSender({ provider: 'disabled' }), null);
});

test('phone numbers must be international; texts are short and prefixed', () => {
  assert.equal(normalisePhone('+263 77 123 4567'), '+263771234567');
  assert.equal(normalisePhone('(+27) 82-555-0101'), '+27825550101');
  for (const bad of ['0771234567', '+0123456789', '+12', 'call me']) assert.equal(normalisePhone(bad), null, bad);
  assert.equal(smsText({ subject: 'Payment due', body: 'Pay   by\nFriday' }), 'SVU: Payment due. Pay by Friday');
  assert.equal(smsText({ subject: 'S', body: 'x'.repeat(400) }).length, 300);
});

test('only urgent message types are texted', () => {
  assert.ok(smsTemplates.includes('finance.hold_notice'));
  assert.ok(!smsTemplates.includes('course.resource'));
  assert.ok(!smsTemplates.includes('identity.password_recovery'));
  assert.equal(notificationGroupFor('finance.hold_notice'), null); // holds cannot be muted
});

test('the Africa\'s Talking sender posts the documented fields and reads the recipient status', async () => {
  let call;
  const fetchImpl = async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'ATX1' }] } }) }; };
  const send = createSmsSender({ provider: 'africastalking', username: 'svu', apiKey: 'k', senderId: 'SVU' }, { fetchImpl });
  assert.deepEqual(await send('+263771234567', 'Hello'), { ok: true, reference: 'ATX1' });
  assert.equal(call.url, 'https://api.africastalking.com/version1/messaging');
  assert.equal(call.options.headers.apiKey, 'k');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(call.options.body)), { username: 'svu', to: '+263771234567', message: 'Hello', from: 'SVU' });
  const failing = createSmsSender({ provider: 'africastalking', username: 'svu', apiKey: 'k' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ status: 'InvalidPhoneNumber' }] } }) }) });
  assert.deepEqual(await failing('+1', 'x'), { ok: false, detail: 'InvalidPhoneNumber' });
});

test('the dispatcher texts each message once and stops at the daily limit', async () => {
  const texts = [], claims = new Map();
  let sentToday = 4;
  const pool = { query: async (sql, params) => {
    if (/from notifications n/.test(sql)) return { rows: [{ id: 'n1', accountId: 'a', subject: 'Hold', body: 'Pay', phone: '+263771234567' }, { id: 'n2', accountId: 'a', subject: 'Offer', body: 'Expires', phone: '+263771234567' }] };
    if (/count\(\*\)::int as n from sms_deliveries/.test(sql)) return { rows: [{ n: sentToday }] };
    if (/insert into sms_deliveries/.test(sql)) { if (claims.has(params[0])) return { rowCount: 0 }; claims.set(params[0], params[2]); if (params[2] === 'sent') sentToday++; return { rowCount: 1 }; }
    return { rowCount: 1, rows: [] };
  } };
  const dispatcher = startSmsDispatcher(pool, { provider: 'simulated' }, { intervalMs: 60000, logger: {}, sender: async (to, message) => { texts.push(message); return { ok: true }; } });
  await dispatcher.sweep(); await dispatcher.sweep(); dispatcher.stop();
  assert.deepEqual(texts, ['SVU: Hold. Pay']);
  assert.equal(claims.get('n2'), 'skipped');
});

import { createSmsModule } from '../server/sms.js';

test('wrong codes are counted (committed) and lock verification after five tries', async () => {
  const state = { attempts: 0, verified: false, committed: 0 };
  const client = { query: async (sql) => {
    if (/^begin|^commit|^rollback/i.test(sql.trim())) { if (/commit/i.test(sql)) state.committed++; return { rows: [] }; }
    if (/select code_digest/.test(sql)) return { rows: [{ code_digest: 'f'.repeat(64), code_expires_at: new Date(Date.now() + 60000), code_attempts: state.attempts }] };
    if (/code_attempts=code_attempts\+1/.test(sql)) { state.attempts++; return { rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  }, release() {} };
  const pool = { connect: async () => client, query: client.query };
  const module = createSmsModule(pool, { smsSender: async () => ({ ok: true }) });
  for (let i = 0; i < 5; i++) await assert.rejects(module.verifySmsCode({ code: '000000' }, { accountId: 'a' }), /not right/);
  assert.equal(state.attempts, 5);
  await assert.rejects(module.verifySmsCode({ code: '000000' }, { accountId: 'a' }), /Too many attempts/);
});
