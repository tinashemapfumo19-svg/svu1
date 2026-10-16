import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPaymentsConfig, paynowHash, paynowProvider, paynowStatus, paynowVerify } from '../server/payment-gateway.js';

const config = { provider: 'paynow', integrationId: '1201', integrationKey: 'secret-key', publicUrl: 'https://portal.svu.example' };

test('payments are off by default; simulation is development-only; Paynow needs its keys and an https address', () => {
  assert.equal(loadPaymentsConfig({}).provider, 'disabled');
  assert.equal(loadPaymentsConfig({ SVU_PAYMENTS: 'simulated', SVU_ENV: 'development' }).provider, 'simulated');
  assert.throws(() => loadPaymentsConfig({ SVU_PAYMENTS: 'simulated', SVU_ENV: 'production' }), /only available in development/);
  assert.throws(() => loadPaymentsConfig({ SVU_PAYMENTS: 'paynow' }), /PAYNOW_INTEGRATION_ID/);
  assert.throws(() => loadPaymentsConfig({ SVU_PAYMENTS: 'paynow', PAYNOW_INTEGRATION_ID: '1', PAYNOW_INTEGRATION_KEY: 'k', SVU_PUBLIC_URL: 'http://x' }), /https/);
  assert.equal(loadPaymentsConfig({ SVU_PAYMENTS: 'paynow', PAYNOW_INTEGRATION_ID: '1', PAYNOW_INTEGRATION_KEY: 'k', SVU_PUBLIC_URL: 'https://x/' }).publicUrl, 'https://x');
  assert.throws(() => loadPaymentsConfig({ SVU_PAYMENTS: 'stripe' }), /disabled, paynow or simulated/);
});

test('the Paynow hash covers every value in order plus the key, and verification is exact', () => {
  const fields = { reference: 'pay_1', amount: '10.00', status: 'Paid' };
  const hash = paynowHash(fields, 'secret-key');
  assert.match(hash, /^[0-9A-F]{128}$/);
  assert.ok(paynowVerify({ ...fields, hash }, 'secret-key'));
  assert.ok(!paynowVerify({ ...fields, amount: '1.00', hash }, 'secret-key'));
  assert.ok(!paynowVerify({ ...fields, hash }, 'other-key'));
  assert.ok(!paynowVerify(fields, 'secret-key'));
});

test('Paynow status words map to paid, failed, cancelled or pending', () => {
  assert.equal(paynowStatus('Paid'), 'paid');
  assert.equal(paynowStatus('Awaiting Delivery'), 'paid');
  assert.equal(paynowStatus('Cancelled'), 'cancelled');
  assert.equal(paynowStatus('Disputed'), 'failed');
  assert.equal(paynowStatus('Sent'), 'pending');
});

test('initiating sends signed fields and refuses an unverified reply', async () => {
  let sent;
  const reply = { status: 'Ok', browserurl: 'https://www.paynow.co.zw/Payment/ConfirmPayment/1', pollurl: 'https://www.paynow.co.zw/Interface/CheckPayment/?guid=1' };
  const signed = new URLSearchParams({ ...reply, hash: paynowHash(reply, 'secret-key') }).toString();
  const fetchImpl = async (url, options) => { sent = Object.fromEntries(new URLSearchParams(options.body)); return { ok: true, text: async () => signed }; };
  const result = await paynowProvider(config, { fetchImpl }).initiate({ id: 'pay_1', amountMinor: 12550, studentNumber: 'S1' });
  assert.equal(result.redirectUrl, reply.browserurl);
  assert.equal(sent.amount, '125.50');
  assert.equal(sent.returnurl, 'https://portal.svu.example/#office/fees?payment=pay_1');
  assert.ok(paynowVerify(sent, 'secret-key'));
  const forged = async () => ({ ok: true, text: async () => new URLSearchParams({ ...reply, hash: 'AB' }).toString() });
  await assert.rejects(paynowProvider(config, { fetchImpl: forged }).initiate({ id: 'pay_1', amountMinor: 100, studentNumber: 'S1' }), /could not be verified/);
});
