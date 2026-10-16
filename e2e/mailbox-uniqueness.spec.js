import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPool } from '../server/db.js';
import { loadConfig } from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Canonical migration proof requires an isolated database.');

test('canonical account uniqueness preserves identities and refuses historical collisions without rewriting', async ({ request }, info) => {
  const pool = createPool(loadConfig());
  const sql = await readFile(new URL('../migrations/103_account_mailbox_uniqueness.sql', import.meta.url), 'utf8');
  const email = `unique.${info.project.name}.${randomUUID()}@example.com`;
  try {
    const admin = await api('/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, undefined, 201);
    const first = await account(email), second = await account(`other.${email}`);
    const before = await retained(pool);
    for (const candidate of [email.toUpperCase(), ` ${email} `, ` ${email.toUpperCase()} `]) {
      for (const status of ['active', 'suspended', 'invited']) {
        await expect(pool.query('insert into accounts(id,person_id,email,status) select $1,person_id,$2,$3 from accounts where id=$4', [`collision_${randomUUID()}`, candidate, status, first.id])).rejects.toMatchObject({ code: '23505', constraint: 'accounts_canonical_email_key' });
        expect(await retained(pool)).toEqual(before);
      }
    }
    const db = await pool.connect();
    try {
      await db.query('begin');
      await db.query('drop index accounts_canonical_email_key');
      await db.query('update accounts set email=$2 where id=$1', [first.id, ` ${email.toUpperCase()} `]);
      const existing = await retained(db);
      await db.query(sql);
      expect(await retained(db)).toEqual(existing);
      expect((await db.query('select email from accounts where id=$1', [first.id])).rows[0].email).toBe(` ${email.toUpperCase()} `);
      await db.query('rollback');

      await db.query('begin');
      await db.query('drop index accounts_canonical_email_key');
      await db.query('update accounts set email=$2 where id=$1', [second.id, email.toUpperCase()]);
      const collisionState = await retained(db);
      await db.query('savepoint migration_probe');
      await expect(db.query(sql)).rejects.toMatchObject({ code: '23505', message: 'Canonical account email collision; resolve identities before migration.' });
      await db.query('rollback to savepoint migration_probe');
      expect(await retained(db)).toEqual(collisionState);
      expect((await db.query("select to_regclass('public.accounts_canonical_email_key') as index")).rows[0].index).toBeNull();
    } finally { await db.query('rollback'); db.release(); }
    expect(await retained(pool)).toEqual(before);
    const definition = (await pool.query("select indexdef from pg_indexes where schemaname='public' and indexname='accounts_canonical_email_key'")).rows[0].indexdef;
    expect(definition).toContain('UNIQUE INDEX'); expect(definition).toContain('lower(btrim(email))');

    async function account(mailbox) {
      const invitation = await api('/api/identity/invitations', { email: mailbox, roleCode: 'applicant' }, admin.token, 201);
      return api('/api/identity/activations', { token: invitation.activationToken, password: 'Canonical-Index-Password-2026!', preferredName: 'Index fixture', legalName: 'Isolated index fixture' });
    }
  } finally { await pool.end(); }
  async function api(path, data, token, status = 200) {
    const response = await request.post(path, { data, headers: token ? { authorization: `Bearer ${token}` } : {} });
    expect(response.status(), path).toBe(status); expect(response.headers()['cache-control']).toBe('no-store'); return (await response.json()).data;
  }
});

async function retained(db) {
  const result = [];
  for (const table of ['accounts', 'people', 'role_assignments', 'account_activation_tokens', 'invitations']) result.push((await db.query(`select md5(coalesce(string_agg(row::text, '' order by row::text), '')) as digest from (select to_jsonb(t) as row from ${table} t) retained`)).rows[0].digest);
  return result;
}
