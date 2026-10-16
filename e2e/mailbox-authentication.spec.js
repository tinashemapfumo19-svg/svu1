import { test, expect } from '@playwright/test';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { readNotificationDeliveryContent } from '../server/notification-queue.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Mailbox fixtures require an isolated database.');

for (const operation of ['login', 'recovery']) {
  test(`${operation}: canonical mailbox collisions cannot select an account`, async ({ request }, info) => {
    test.setTimeout(180000);
    const pool = createPool(loadConfig());
    const password = 'Mailbox-Identity-Password-2026!';
    const email = `mailbox.${operation}.${info.project.name}.${Date.now()}@example.com`;
    const otherCase = email.toUpperCase();
    let secondId;
    let legacyIndexDropped = false;
    try {
      const admin = await api('/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, 201);
      const first = await account(email);
      const preservedEmail = ` ${otherCase} `;
      await pool.query('update accounts set email=$2 where id=$1', [first.id, preservedEmail]);
      const identityBefore = await identity();
      const original = await api('/api/identity/sessions', { email: ` ${otherCase} `, password }, 201);
      expect(original.accountId).toBe(first.id);
      const accepted = await api('/api/identity/recovery-requests', { email: otherCase }, 202);
      const activeToken = (await pool.query("select id from password_recovery_tokens where account_id=$1 and status='active'", [first.id])).rows[0].id;
      expect((await pool.query('select email from accounts where id=$1', [first.id])).rows[0].email).toBe(preservedEmail);
      expect(await identity()).toEqual(identityBefore);
      const notificationId = (await pool.query("select n.id from notifications n join notification_templates t on t.id=n.template_id where n.recipient_account_id=$1 and t.code='identity.password_recovery' order by n.created_at desc limit 1", [first.id])).rows[0].id;
      const content = await readNotificationDeliveryContent(pool, notificationId, loadConfig().dataEncryptionKey);
      expect(content.accountId).toBe(first.id);
      expect(content.recipientEmail).toBe(email);
      const second = await account(`other.${email}`);
      secondId = second.id;
      // Model a pre-existing collision in this owned database; native creation now refuses it.
      await pool.query('drop index accounts_canonical_email_key');
      legacyIndexDropped = true;
      await pool.query('update accounts set email=$2 where id=$1', [second.id, otherCase]);
      expect(second.id).not.toBe(first.id);
      expect((await pool.query('select count(*)::int as n from accounts where lower(btrim(email))=$1', [email])).rows[0].n).toBe(2);

      for (const inactive of [false, true]) {
        if (inactive) await api(`/api/identity/accounts/${second.id}/suspend`, { reason: 'Isolated inactive canonical collision' }, 200, admin.token);
        const before = await retained();
        if (operation === 'login') {
          for (const supplied of [email, otherCase]) {
            const response = await request.post('/api/identity/sessions', { data: { email: supplied, password } });
            expect(response.status()).toBe(401);
            expect(response.headers()['cache-control']).toBe('no-store');
            const body = await response.json();
            expect(body.data).toBeUndefined();
            expect(JSON.stringify(body)).not.toContain(first.id);
            expect(JSON.stringify(body)).not.toContain(second.id);
          }
        } else {
          for (const supplied of [email, otherCase]) expect(await api('/api/identity/recovery-requests', { email: supplied }, 202)).toEqual(accepted);
          expect(await api('/api/identity/recovery-requests', { email: `absent.${email}` }, 202)).toEqual(accepted);
        }
        expect(await retained()).toEqual(before);
        expect((await pool.query('select status from password_recovery_tokens where id=$1', [activeToken])).rows[0].status).toBe('active');
        const me = await request.get('/api/identity/me', { headers: { authorization: `Bearer ${original.token}` } });
        expect(me.status()).toBe(200);
        expect((await me.json()).data.account.id).toBe(first.id);
      }

      async function account(mailbox) {
        const invitation = await api('/api/identity/invitations', { email: mailbox, roleCode: 'applicant' }, 201, admin.token);
        return api('/api/identity/activations', { token: invitation.activationToken, password, preferredName: 'Mailbox fixture', legalName: 'Isolated mailbox identity fixture' }, 200);
      }
      async function retained() {
        const tables = ['accounts', 'people', 'role_assignments', 'sessions', 'password_recovery_tokens', 'notifications', 'notification_delivery_content', 'email_deliveries', 'email_delivery_attempts', 'email_delivery_events'];
        const snapshots = [];
        for (const table of tables) snapshots.push((await pool.query(`select md5(coalesce(string_agg(row::text, '' order by row::text), '')) as digest from (select to_jsonb(t) as row from ${table} t) retained`)).rows[0].digest);
        return snapshots;
      }
      async function identity() {
        return (await pool.query("select md5((to_jsonb(a)-'last_login_at'-'updated_at')::text) as digest from accounts a where id=$1", [first.id])).rows[0].digest;
      }
    } finally {
      if (secondId) await pool.query('update accounts set email=$2 where id=$1', [secondId, `other.${email}`]);
      if (legacyIndexDropped) await pool.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))');
      await pool.end();
    }
    async function api(path, data, status, token) {
      const response = await request.post(path, { data, headers: token ? { authorization: `Bearer ${token}` } : {} });
      expect(response.status(), path).toBe(status);
      expect(response.headers()['cache-control']).toBe('no-store');
      return (await response.json()).data;
    }
  });
}
