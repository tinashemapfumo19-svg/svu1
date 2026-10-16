import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { createRouter } from '../server/router.js';
import { createLogger } from '../server/logger.js';
import { createLocalStorage } from '../server/storage.js';
import { actorCanAccessScope } from '../server/support.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Principal fixtures require an isolated database.');

for (const policy of ['enrolled', 'privileged', 'off']) {
  test(`${policy}: principal and login use current grants with coherent MFA and scopes`, async ({ request }, info) => {
    test.setTimeout(240000);
    const config = loadConfig({ ...process.env, SVU_MFA_POLICY: policy });
    const pool = createPool(config), options = { mfaPolicy: policy, dataEncryptionKey: config.dataEncryptionKey, storage: createLocalStorage(config.devStorageDir), devOutboxDir: config.devOutboxDir };
    const repository = createRepository(pool, options);
    const server = createServer(createRouter({ rootDir: process.cwd(), config, repository, logger: createLogger(config) }));
    try {
      const admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' });
      const adminId = (await api('GET', '/api/identity/me', undefined, admin.token)).account.id;
      const email = `principal.${policy}.${info.project.name}.${Date.now()}@example.com`, password = 'Principal-Browser-Password-2026!';
      const invite = await api('POST', '/api/identity/invitations', { email, roleCode: 'applicant' }, admin.token);
      const account = await api('POST', '/api/identity/activations', { token: invite.activationToken, password, preferredName: 'Principal', legalName: 'Isolated Principal Pilot' });
      const suffix = randomUUID().replaceAll('-', ''), low = `pl_${suffix}`, unrelated = `pu_${suffix}`, high = `ph_${suffix}`;
      for (const [code, risk, permission] of [[low, 'low', 'access.assign_role'], [unrelated, 'low', 'audit.view'], [high, 'high', 'identity.manage']]) {
        await pool.query('insert into roles (code,name,risk) values ($1,$2,$3)', [code, 'Isolated principal fixture', risk]);
        await pool.query('insert into role_permissions (role_code,permission_code) values ($1,$2)', [code, permission]);
      }
      const scoped = await grant(low, { programmeCodes: ['A'] });
      await grant(unrelated, {});
      const privileged = await grant(high, {});
      await pool.query('update roles set active=false where code=$1', [high]);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const base = `http://127.0.0.1:${server.address().port}`;
      const login = () => api('POST', `${base}/api/identity/sessions`, { email, password });
      const original = await login();
      expect(original.status).toBe('active');
      const me = () => api('GET', `${base}/api/identity/me`, undefined, original.token);
      const protectedStatus = async expected => {
        const r = await request.get(`${base}/api/identity/accounts`, { headers: { authorization: `Bearer ${original.token}` } });
        expect(r.status()).toBe(expected); expect(r.headers()['cache-control']).toBe('no-store');
        if (expected !== 200) expect((await r.json()).data).toBeUndefined();
      };
      const initial = await me();
      expect(initial.roles.some(r => r.code === high)).toBe(false);
      expect(initial.permissions).not.toContain('identity.manage');
      await protectedStatus(403);
      const actor = await repository.requirePermission(original.token, 'access.assign_role');
      expect(actorCanAccessScope(actor, { programmeCode: 'A' })).toBe(true);
      expect(actorCanAccessScope(actor, { programmeCode: 'B' })).toBe(false);
      await pool.query('update roles set active=true where code=$1', [high]);
      expect((await login()).status).toBe(policy === 'privileged' ? 'mfa_enrolment_required' : 'active');
      await protectedStatus(policy === 'privileged' ? 401 : 200);
      // Keep dates current to prove ended_at is independently enforced, unlike the usual end command.
      await pool.query('update role_assignments set ended_at=clock_timestamp(),ended_by=$2,end_reason=$3 where id=$1', [privileged.id, adminId, 'Isolated current-date ended-grant shape']);
      expect((await login()).status).toBe('active');
      expect((await me()).roles.some(r => r.code === high)).toBe(false);
      await protectedStatus(403);
      await pool.query('update role_assignments set ended_at=null,ended_by=null,end_reason=null,effective_from=current_date+1 where id=$1', [privileged.id]);
      expect((await login()).status).toBe('active'); await protectedStatus(403);
      await pool.query('update role_assignments set effective_from=current_date-2,effective_to=current_date-1 where id=$1', [privileged.id]);
      expect((await login()).status).toBe('active'); await protectedStatus(403);
      await pool.query('update role_assignments set effective_from=current_date,effective_to=current_date where id=$1', [privileged.id]);
      expect((await login()).status).toBe(policy === 'privileged' ? 'mfa_enrolment_required' : 'active');
      await protectedStatus(policy === 'privileged' ? 401 : 200);
      await pool.query('update roles set active=false where code=$1', [high]);
      await snapshotRace(async () => pool.query('update roles set active=true where code=$1', [high]), async old => {
        expect(old.permissions).not.toContain('identity.manage'); expect(old.roles.some(r => r.code === high)).toBe(false);
      });
      if (policy === 'privileged') await expect(repository.authenticateSession(original.token)).rejects.toMatchObject({ statusCode: 401 });
      else expect((await repository.authenticateSession(original.token)).permissions).toContain('identity.manage');
      await pool.query('update roles set active=false where code=$1', [high]);
      await snapshotRace(async () => {
        await api('POST', `/api/access/role-assignments/${scoped.id}/end`, { reason: 'Native principal snapshot withdrawal' }, admin.token);
      }, async old => {
        expect(old.permissions).toContain('access.assign_role');
        expect(actorCanAccessScope({ ...old, authorizingPermission: 'access.assign_role' }, { programmeCode: 'B' })).toBe(false);
      });
      const after = await me();
      expect(after.permissions).not.toContain('access.assign_role');
      expect(after.roles.some(r => r.code === low)).toBe(false);
      await expect(repository.requirePermission(original.token, 'access.assign_role')).rejects.toMatchObject({ statusCode: 403 });
      await pool.query('delete from role_permissions where role_code=$1', [unrelated]);
      const empty = await me(); expect(empty.roles.find(r => r.code === unrelated).permissions).toEqual([]); expect(empty.permissions).not.toContain('audit.view');
      await api('POST', `/api/identity/accounts/${account.id}/suspend`, { reason: 'Native principal account withdrawal' }, admin.token);
      await protectedStatus(401);

      async function grant(roleCode, scope) { return api('POST', '/api/access/role-assignments', { accountId: account.id, roleCode, scope, reason: 'Isolated principal authority fixture' }, admin.token); }
      async function snapshotRace(change, check) {
        let resume, observed;
        const ready = new Promise(resolve => { observed = resolve; }), hold = new Promise(resolve => { resume = resolve; });
        let queries = 0;
        const paused = { async query(sql, args) {
          queries++; const result = await pool.query(sql, args);
          if (sql.includes('from sessions s')) { observed(); await hold; }
          return result;
        } };
        const pending = createRepository(paused, options).authenticateSession(original.token);
        pending.catch(() => {});
        try { await ready; await change(); } finally { resume(); }
        await check(await pending); expect(queries).toBe(1);
      }
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool.end();
    }
    async function api(method, path, data, token) {
      const r = await request.fetch(path, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(data === undefined ? {} : { data }) });
      expect(r.ok(), `${method} ${path} status ${r.status()}`).toBe(true);
      expect(r.headers()['cache-control']).toBe('no-store'); return (await r.json()).data;
    }
  });
}
