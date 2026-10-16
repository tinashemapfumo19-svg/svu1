import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { createRouter } from '../server/router.js';
import { createLogger } from '../server/logger.js';
import { createLocalStorage } from '../server/storage.js';
import { totp } from '../server/security.js';

for (const policy of ['enrolled', 'privileged', 'off']) {
test(`${policy}: existing sessions must satisfy current factor and privilege requirements`, async ({ request }, testInfo) => {
  const admin = await send('POST', '/api/identity/sessions', {
    email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!'
  });
    const config = loadConfig({ ...process.env, SVU_MFA_POLICY: policy });
    const pool = createPool(config);
    const repository = createRepository(pool, {
      devOutboxDir: config.devOutboxDir, dataEncryptionKey: config.dataEncryptionKey,
      mfaPolicy: config.mfaPolicy, storage: createLocalStorage(config.devStorageDir)
    });
    const server = createServer(createRouter({ rootDir: process.cwd(), config, repository, logger: createLogger(config) }));
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const base = `http://127.0.0.1:${server.address().port}`;
      const email = `mfa.current.${policy}.${testInfo.project.name}.${Date.now()}@example.com`;
      const password = 'Browser-MFA-Password-2026!';
      const invitation = await send('POST', '/api/identity/invitations', { email, roleCode: 'applicant' }, admin.token);
      const account = await send('POST', '/api/identity/activations', {
        token: invitation.activationToken, password, preferredName: 'Current', legalName: 'Current MFA Pilot'
      });
      const login = () => send('POST', `${base}/api/identity/sessions`, { email, password });
      const beforeGrant = await login();
      expect(beforeGrant.status).toBe('active');
      await send('POST', '/api/access/role-assignments', {
        accountId: account.id, roleCode: 'system_administrator', reason: 'Native current MFA policy regression'
      }, admin.token);
      const grantResponse = await request.get(`${base}/api/identity/me`, { headers: headers(beforeGrant.token) });
      expect(grantResponse.status()).toBe(policy === 'privileged' ? 401 : 200);
      const grantAuthority = await request.get(`${base}/api/identity/accounts/${account.id}/sessions`, { headers: headers(beforeGrant.token) });
      expect(grantAuthority.status()).toBe(policy === 'privileged' ? 401 : 200);
      const enrolSession = await login();
      const otherSession = await login();
      expect(enrolSession.status).toBe(policy === 'privileged' ? 'mfa_enrolment_required' : 'active');
      const factor = await send('POST', `${base}/api/identity/mfa/totp`, {}, enrolSession.token);
      const confirmed = await send('POST', `${base}/api/identity/mfa/totp/confirm`, { code: totp(factor.secret, Date.now()) }, enrolSession.token);
      expect(confirmed.recoveryCodes).toHaveLength(10);
      expect((await send('GET', `${base}/api/identity/me`, undefined, enrolSession.token)).assurance).toBe('mfa');
      for (const stale of [beforeGrant, otherSession]) {
        const response = await request.get(`${base}/api/identity/me`, { headers: headers(stale.token) });
        expect(response.status()).toBe(policy === 'off' ? 200 : 401);
        expect(response.headers()['cache-control']).toBe('no-store');
        const protectedResponse = await request.get(`${base}/api/identity/accounts/${account.id}/sessions`, { headers: headers(stale.token) });
        expect(protectedResponse.status()).toBe(policy === 'off' ? 200 : 401);
        const enrol = await request.post(`${base}/api/identity/mfa/totp`, { headers: headers(stale.token), data: {} });
        expect(enrol.status()).toBe(policy === 'off' ? 409 : 401);
      }
      const fresh = await login();
      expect(fresh.status).toBe(policy === 'off' ? 'active' : 'mfa_pending');
      if (policy !== 'off') {
        await send('POST', `${base}/api/identity/sessions/current/mfa`, { recoveryCode: confirmed.recoveryCodes[0] }, fresh.token);
        expect((await send('GET', `${base}/api/identity/me`, undefined, fresh.token)).assurance).toBe('mfa');
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool.end();
    }
  function headers(token) { return token ? { authorization: `Bearer ${token}` } : {}; }
  async function send(method, path, data, token) {
    const response = await request.fetch(path, { method, headers: headers(token), ...(data === undefined ? {} : { data }) });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return (await response.json()).data;
  }
});
}
