import { createHash, timingSafeEqual } from 'node:crypto';

// Online payment providers (docs/ONLINE_PAYMENTS.md). Disabled unless SVU_PAYMENTS is set. 'paynow' follows Paynow's
// published web integration (form-encoded fields signed with an uppercase SHA-512 hash) and must be checked against the
// Paynow sandbox before live use (D-44). 'simulated' is for development only and never moves money.
export function loadPaymentsConfig(env = process.env) {
  const provider = env.SVU_PAYMENTS || 'disabled';
  if (!['disabled', 'paynow', 'simulated'].includes(provider)) throw new Error('SVU_PAYMENTS must be disabled, paynow or simulated.');
  const runtimeEnv = env.SVU_ENV || env.NODE_ENV || 'development';
  if (provider === 'simulated' && runtimeEnv !== 'development') throw new Error('The simulated payment provider is only available in development.');
  if (provider === 'paynow') {
    if (!/^\d{1,12}$/.test(env.PAYNOW_INTEGRATION_ID || '') || !(env.PAYNOW_INTEGRATION_KEY || '').trim()) throw new Error('Paynow needs PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY.');
    if (!/^https:\/\//.test(env.SVU_PUBLIC_URL || '')) throw new Error('Paynow needs SVU_PUBLIC_URL (https) for its return and result addresses.');
  }
  return { provider, integrationId: env.PAYNOW_INTEGRATION_ID || null, integrationKey: env.PAYNOW_INTEGRATION_KEY || null, publicUrl: (env.SVU_PUBLIC_URL || '').replace(/\/$/, '') || null };
}

// Paynow's hash: every value in order (the hash field excluded), then the integration key; SHA-512, uppercase hex.
export function paynowHash(fields, key) {
  const joined = Object.entries(fields).filter(([name]) => name.toLowerCase() !== 'hash').map(([, value]) => String(value ?? '')).join('');
  return createHash('sha512').update(joined + key, 'utf8').digest('hex').toUpperCase();
}
export function paynowVerify(fields, key) {
  const given = Buffer.from(String(fields.hash || fields.Hash || ''));
  const expected = Buffer.from(paynowHash(fields, key));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export const parseForm = (text) => Object.fromEntries(new URLSearchParams(text));
// Paynow status words, mapped to ours. Anything unknown stays pending.
export function paynowStatus(word) {
  const value = String(word || '').toLowerCase();
  if (['paid', 'awaiting delivery', 'delivered'].includes(value)) return 'paid';
  if (['cancelled'].includes(value)) return 'cancelled';
  if (['failed', 'disputed', 'refunded'].includes(value)) return 'failed';
  return 'pending';
}

export function paynowProvider(config, { fetchImpl = fetch } = {}) {
  const post = async (url, fields) => {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
    if (!response.ok) throw new Error('The payment provider is unavailable.');
    return parseForm(await response.text());
  };
  return {
    name: 'paynow',
    // Returns { redirectUrl, pollUrl } for the student to complete payment on Paynow's page.
    async initiate(intent, { email = '' } = {}) {
      const fields = { id: config.integrationId, reference: intent.id, amount: (intent.amountMinor / 100).toFixed(2), additionalinfo: `SVU fees ${intent.studentNumber}`,
        returnurl: `${config.publicUrl}/#office/fees?payment=${intent.id}`, resulturl: `${config.publicUrl}/api/payments/paynow/result`, ...(email ? { authemail: email } : {}), status: 'Message' };
      const reply = await post('https://www.paynow.co.zw/interface/initiatetransaction', { ...fields, hash: paynowHash(fields, config.integrationKey) });
      if (String(reply.status).toLowerCase() !== 'ok') throw new Error(reply.error ? `The payment provider refused the request: ${reply.error}` : 'The payment provider refused the request.');
      if (!paynowVerify(reply, config.integrationKey)) throw new Error('The payment provider reply could not be verified.');
      return { redirectUrl: reply.browserurl, pollUrl: reply.pollurl };
    },
    // Asks Paynow for the latest status. Returns { status, amountMinor, providerReference }.
    async poll(intent) {
      const reply = await post(intent.pollUrl, {});
      if (!paynowVerify(reply, config.integrationKey)) throw new Error('The payment provider reply could not be verified.');
      return this.read(reply);
    },
    // A status update (poll reply or result callback) as our fields. The caller checks the reference and amount.
    read(fields) {
      return { reference: fields.reference, status: paynowStatus(fields.status), amountMinor: Math.round(Number(fields.amount) * 100), providerReference: fields.paynowreference || null, detail: fields.status || '' };
    },
    verify(fields) { return paynowVerify(fields, config.integrationKey); }
  };
}

// Development: a local "gateway" page in the portal decides the outcome.
export function simulatedProvider() {
  return {
    name: 'simulated',
    async initiate(intent) { return { redirectUrl: `/#office/fees?simulate=${intent.id}`, pollUrl: null }; },
    async poll() { return null; },
    read(fields) { return fields; },
    verify() { return true; }
  };
}

export function createPaymentProvider(config) {
  if (!config || config.provider === 'disabled') return null;
  return config.provider === 'paynow' ? paynowProvider(config) : simulatedProvider();
}
