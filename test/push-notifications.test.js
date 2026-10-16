import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { loadPushConfig, pushPayload, startPushDispatcher } from '../server/push-notifications.js';

const keys = webpush.generateVAPIDKeys();

test('push is off by default and needs VAPID keys and a contact when on', () => {
  assert.deepEqual(loadPushConfig({}), { enabled: false });
  assert.throws(() => loadPushConfig({ SVU_PUSH: 'enabled' }), /VAPID_PUBLIC_KEY/);
  assert.throws(() => loadPushConfig({ SVU_PUSH: 'enabled', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }), /VAPID_SUBJECT/);
  assert.equal(loadPushConfig({ SVU_PUSH: 'enabled', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:it@svu.example' }).enabled, true);
  assert.throws(() => loadPushConfig({ SVU_PUSH: 'yes' }), /disabled or enabled/);
});

test('a push carries the subject, a short body and the in-app link', () => {
  const payload = JSON.parse(pushPayload({ id: 'not_1', subject: 'Payment due', body: 'x'.repeat(300), link: '#office/fees' }));
  assert.equal(payload.title, 'Payment due');
  assert.equal(payload.body.length, 178);
  assert.equal(payload.link, '#office/fees');
  assert.equal(JSON.parse(pushPayload({ id: 'not_2', subject: 'Hi', body: 'b' })).link, '#messages');
});

test('the dispatcher claims each message once, sends to every device and drops expired devices', async () => {
  const sent = [], deleted = [], claims = new Set();
  const pool = { query: async (sql, params) => {
    if (/from notifications n/.test(sql)) return { rows: [{ id: 'not_1', accountId: 'acc_1', subject: 'Hello', body: 'World', link: '#home' }] };
    if (/insert into push_deliveries/.test(sql)) { const fresh = !claims.has(params[0]); claims.add(params[0]); return { rowCount: fresh ? 1 : 0 }; }
    if (/select id,endpoint/.test(sql)) return { rows: [{ id: 'd1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }, { id: 'd2', endpoint: 'https://push.example/2', p256dh: 'p', auth: 'a' }] };
    if (/delete from push_subscriptions/.test(sql)) { deleted.push(params[0]); return { rowCount: 1 }; }
    return { rowCount: 1, rows: [] };
  } };
  const send = async (subscription) => { if (subscription.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 }); sent.push(subscription.endpoint); };
  const dispatcher = startPushDispatcher(pool, { enabled: true, subject: 'mailto:it@svu.example', publicKey: keys.publicKey, privateKey: keys.privateKey }, { intervalMs: 60000, send, logger: {} });
  await dispatcher.sweep(); await dispatcher.sweep();
  dispatcher.stop();
  assert.deepEqual(sent, ['https://push.example/1']);
  assert.deepEqual(deleted, ['d2']);
});
