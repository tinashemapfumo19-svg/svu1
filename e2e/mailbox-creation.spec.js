import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTransaction } from '../server/support.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Account-creation fixtures require an isolated database.');

test('identity invitations retain canonical mailbox input', async ({ request }, info) => {
  const api = client(request), admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, undefined, 201);
  const email = `creation.${info.project.name}.${randomUUID()}@example.com`;
  const invitation = await api('POST', '/api/identity/invitations', { email: ` ${email.toUpperCase()} `, roleCode: 'applicant' }, admin.token, 201);
  expect(invitation.email).toBe(email);
  const pool = createPool(loadConfig());
  try {
    expect((await pool.query('select email from invitations where id=$1', [invitation.id])).rows[0].email).toBe(email);
    expect((await pool.query('select email from account_activation_tokens where invitation_id=$1', [invitation.id])).rows[0].email).toBe(email);
    const account = await api('POST', '/api/identity/activations', { token: invitation.activationToken, password: 'Canonical-Invitation-Password-2026!', legalName: 'Canonical fixture', preferredName: 'Canonical' });
    expect(account.email).toBe(email);
    expect((await pool.query('select email from accounts where id=$1', [account.id])).rows[0].email).toBe(email);
  } finally { await pool.end(); }
});

test('activation and sharing serialize native creation, recheck expiry and roll back identity faults', async ({ request }, info) => {
  test.setTimeout(240000);
  const api = client(request), config = loadConfig(), pool = createPool(config);
  const options = { dataEncryptionKey: config.dataEncryptionKey, devOutboxDir: config.devOutboxDir, mfaPolicy: 'enrolled' };
  const suffix = `${info.project.name}.${Date.now()}`, password = 'Canonical-Creation-Password-2026!';
  try {
    const admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, undefined, 201);
    const student = await api('POST', '/api/identity/sessions', { email: 'tinashe@example.edu', password: 'Phase1-Student-Password-2026!' }, undefined, 201);
    const me = await api('GET', '/api/identity/me', undefined, student.token);
    const programme = (await pool.query("select programme_id from intakes where id='intake_2027_feb'")).rows[0].programme_id;
    const intake = await api('POST', '/api/master-data/intakes', { programmeId: programme, label: `Canonical creation fixture ${suffix}`, capacity: 5, startsOn: '2027-02-01', applicationOpensAt: new Date(Date.now()-86400000).toISOString(), applicationClosesAt: new Date(Date.now()+30*86400000).toISOString() }, admin.token, 201);
    await api('POST', `/api/master-data/intakes/${intake.id}/transitions`, { toStatus: 'published', reason: 'Isolated identity writer proof' }, admin.token);
    await api('POST', '/api/admissions/migrations', { source: `SAMPLE-CREATION-${suffix}`, totals: { applications: 1, documents: 0, documentBytes: 0 }, applications: [{ legacyId: 'SAMPLE-CREATION-STUDENT', accountId: me.account.id, intakeId: intake.id, state: 'Accepted', referenceNumber: `SAMPLE-${suffix}`, studyModeCode: 'FULL_TIME', answers: { applicantCategory: 'standard' }, documents: [], decision: { decision: 'offer', conditions: [], offerExpiresAt: new Date(Date.now()+86400000).toISOString() } }] }, admin.token, 201);
    const sp = (await api('GET', '/api/registry/me', undefined, student.token)).programmes.find(p => p.intakeId === intake.id);
    for (const winner of ['activation', 'sharing']) {
      const email = `writer.${winner}.${suffix}@example.com`;
      const invitation = await api('POST', '/api/identity/invitations', { email: email.toUpperCase(), roleCode: 'applicant' }, admin.token, 201);
      const share = await sharing(email), activationInput = activate(invitation), sharingInput = register(share.token);
      const h = harness(sql => sql.includes('insert into accounts'), true);
      const core = createRepository(h.pool, options);
      const first = settle(winner === 'activation' ? core.activateAccount(activationInput) : core.registerShareRecipient(sharingInput));
      let competitor;
      try {
        await expect.poll(() => h.entered, { timeout: 15000 }).toBe(true);
        competitor = settle(request.post(winner === 'activation' ? '/api/student-sharing/register' : '/api/identity/activations', { data: winner === 'activation' ? sharingInput : activationInput }));
        await expect.poll(async () => (await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and $1::int=any(pg_blocking_pids(pid))", [h.pid])).rowCount, { timeout: 15000 }).toBeGreaterThan(0);
        h.resume();
        const completed = await first; if (completed.error) throw completed.error;
        const competing = await competitor; if (competing.error) throw competing.error;
        expect(competing.result.status()).toBe(409);
        expect(competing.result.headers()['cache-control']).toBe('no-store');
        expect((await competing.result.json()).data).toBeUndefined();
        const accounts = (await pool.query('select id,email from accounts where lower(btrim(email))=$1', [email])).rows;
        expect(accounts).toHaveLength(1); expect(accounts[0].email).toBe(email);
        expect((await pool.query('select status,used_at from account_activation_tokens where invitation_id=$1', [invitation.id])).rows[0].status).toBe(winner === 'activation' ? 'used' : 'active');
        const retainedShare = (await pool.query('select status,recipient_id from student_record_shares where id=$1', [share.id])).rows[0];
        expect(retainedShare.status).toBe(winner === 'sharing' ? 'accepted' : 'pending');
        expect(retainedShare.recipient_id).toBe(winner === 'sharing' ? accounts[0].id : null);
        const before = await retained(pool);
        await api('POST', winner === 'activation' ? '/api/student-sharing/register' : '/api/identity/activations', winner === 'activation' ? sharingInput : activationInput, undefined, 409);
        expect(await retained(pool)).toEqual(before);
        await released(email);
      } finally { h.resume(); await first; if (competitor) await competitor; }
    }

    const expiryEmail = `expiry.${suffix}@example.com`, expiring = await api('POST', '/api/identity/invitations', { email: expiryEmail, roleCode: 'applicant' }, admin.token, 201);
    const h = harness(sql => sql.includes('pg_advisory_xact_lock'), false);
    const expiry = settle(createRepository(h.pool, options).activateAccount(activate(expiring)));
    try {
      await expect.poll(() => h.entered, { timeout: 15000 }).toBe(true);
      await pool.query("update account_activation_tokens set expires_at=clock_timestamp()-interval '1 second' where invitation_id=$1", [expiring.id]);
      const before = await retained(pool); h.resume();
      expect((await expiry).error).toMatchObject({ statusCode: 400 });
      expect(await retained(pool)).toEqual(before); await released(expiryEmail);
    } finally { h.resume(); await expiry; }

    const expiredShareEmail = `shareexpiry.${suffix}@example.com`, expiringShare = await sharing(expiredShareEmail);
    await withTransaction(pool, async db => {
      // Controlled isolated expiry setup, with the retained revision guard and history intact.
      await db.query("update student_record_shares set revision=revision+1,challenge_expires_at=clock_timestamp()+interval '5 seconds' where id=$1", [expiringShare.id]);
      await db.query("insert into student_share_history(share_id,revision,action,actor_id) values($1,2,'fixture.expiry',$2)", [expiringShare.id, me.account.id]);
    });
    // Pause this specific mailbox lock, not the sharing row/command locks.
    const shareHold = harness((sql, args) => sql.includes('pg_advisory_xact_lock') && args?.[0] === `account-mailbox:${expiredShareEmail}`, false);
    const pendingShare = settle(createRepository(shareHold.pool, options).registerShareRecipient(register(expiringShare.token)));
    try {
      await expect.poll(() => shareHold.entered, { timeout: 15000 }).toBe(true);
      const before = await retained(pool);
      await new Promise(resolve => setTimeout(resolve, 6000)); shareHold.resume();
      expect((await pendingShare).error).toMatchObject({ statusCode: 409 });
      expect(await retained(pool)).toEqual(before); await released(expiredShareEmail);
    } finally { shareHold.resume(); await pendingShare; }

    for (const point of ['insert into role_assignments', 'insert into audit_events']) {
      const email = `fault.${randomUUID()}@example.com`, invitation = await api('POST', '/api/identity/invitations', { email, roleCode: 'applicant' }, admin.token, 201);
      const before = await retained(pool), broken = { query: (...args) => pool.query(...args), async connect() { const db = await pool.connect(); return { release: () => db.release(), query(sql, args) { return db.query(sql.includes(point) ? 'select 1/0' : sql, sql.includes(point) ? [] : args); } }; } };
      await expect(createRepository(broken, options).activateAccount(activate(invitation))).rejects.toMatchObject({ code: '22012' });
      expect(await retained(pool)).toEqual(before); await released(email);
      await api('POST', '/api/identity/activations', activate(invitation));
      const after = await retained(pool); await api('POST', '/api/identity/activations', activate(invitation), undefined, 400); expect(await retained(pool)).toEqual(after);
    }

    async function sharing(email) {
      const share = await api('POST', `/api/registry/me/sharing/${sp.id}`, { email, categories: ['programme_status'], days: 30, requestKey: randomUUID() }, student.token, 201);
      for (const name of await readdir(config.devOutboxDir)) {
        if (!name.endsWith('.json')) continue;
        const message = JSON.parse(await readFile(join(config.devOutboxDir, name), 'utf8'));
        if (message.templateCode === 'student.sharing_invitation' && message.recipientEmail === email) return { id: share.id, token: new URLSearchParams(message.variables.invitationLink.split('?')[1]).get('token') };
      }
      throw new Error('Isolated sharing challenge was not queued');
    }
    function activate(invitation) { return { token: invitation.activationToken, password, preferredName: 'Creator', legalName: 'Isolated canonical creator' }; }
    function register(token) { return { token, password, preferredName: 'Recipient', legalName: 'Isolated sharing creator', accept: true }; }
    async function released(email) { const db = await pool.connect(); try { await db.query('begin'); expect((await db.query('select pg_try_advisory_xact_lock(hashtextextended($1,0)) as free', [`account-mailbox:${email}`])).rows[0].free).toBe(true); } finally { await db.query('rollback'); db.release(); } }
    function harness(match, after) {
      let resume; const hold = new Promise(resolve => { resume = resolve; });
      const h = { resume, entered: false, pid: null, pool: { query: (...args) => pool.query(...args), async connect() { const db = await pool.connect(); h.pid = (await db.query('select pg_backend_pid() as pid')).rows[0].pid; return { release: () => db.release(), async query(sql, args) { if (!h.entered && match(sql, args) && !after) { h.entered = true; await hold; } const result = await db.query(sql, args); if (!h.entered && match(sql, args) && after) { h.entered = true; await hold; } return result; } }; } } }; return h;
    }
  } finally { await pool.end(); }
});

function settle(promise) { return promise.then(result => ({ result }), error => ({ error })); }

test('a pending invitation cannot reset, reactivate or grant roles to an existing account', async ({ request }, info) => {
  test.setTimeout(180000);
  const api = client(request), pool = createPool(loadConfig());
  const email = `activation.${info.project.name}.${randomUUID()}@example.com`, password = 'Creation-Original-Password-2026!';
  try {
    const admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, undefined, 201);
    const first = await api('POST', '/api/identity/invitations', { email, roleCode: 'applicant' }, admin.token, 201);
    const second = await api('POST', '/api/identity/invitations', { email, roleCode: 'legacy_staff', scope: { programmeCodes: ['ISOLATED'] } }, admin.token, 201);
    const original = await api('POST', '/api/identity/activations', { token: first.activationToken, password, preferredName: 'Original', legalName: 'Isolated original identity' });
    for (const suspended of [false, true]) {
      if (suspended) await api('POST', `/api/identity/accounts/${original.id}/suspend`, { reason: 'Isolated activation authority' }, admin.token);
      const before = await retained(pool);
      await api('POST', '/api/identity/activations', { token: second.activationToken, password: 'Creation-Replacement-Password-2026!', preferredName: 'Replacement', legalName: 'Must not replace identity' }, undefined, 409);
      expect(await retained(pool)).toEqual(before);
      expect((await pool.query('select status,used_at from account_activation_tokens where invitation_id=$1', [second.id])).rows[0]).toEqual({ status: 'active', used_at: null });
      await api('POST', '/api/identity/invitations', { email: email.toUpperCase(), roleCode: 'legacy_staff' }, admin.token, 409);
      expect(await retained(pool)).toEqual(before);
    }
  } finally { await pool.end(); }
});

async function retained(pool) {
  const tables = ['accounts', 'people', 'role_assignments', 'account_activation_tokens', 'invitations', 'staff_members', 'staff_status_history', 'student_record_shares', 'student_share_history', 'student_share_commands'];
  const result = [];
  for (const table of tables) result.push((await pool.query(`select md5(coalesce(string_agg(row::text, '' order by row::text), '')) as digest from (select to_jsonb(t) as row from ${table} t) retained`)).rows[0].digest);
  return result;
}

function client(request) {
  return async (method, path, data, token, status = 200) => {
    const response = await request.fetch(path, { method, data, headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect(response.status(), path).toBe(status);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = await response.json();
    if (status >= 400) { expect(body.data).toBeUndefined(); return; }
    return body.data;
  };
}
