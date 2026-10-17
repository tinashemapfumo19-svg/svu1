import { test, expect } from '@playwright/test';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Linkage fixtures require an isolated database.');

for (const operation of ['registration', 'staff']) {
  test(`${operation}: preserved canonical mailboxes never select ambiguous identities`, async ({ request }, info) => {
    const pool = createPool(loadConfig()), email = `link.${operation}.${info.project.name}.${Date.now()}@example.com`;
    const password = 'Mailbox-Linkage-Password-2026!', preserved = ` ${email.toUpperCase()} `;
    let secondId, dropped = false;
    try {
      const admin = await api('/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, 201);
      const first = await account(email), second = await account(`other.${email}`);
      secondId = second.id;
      const firstSession = await api('/api/identity/sessions', { email, password }, 201);
      const secondSession = await api('/api/identity/sessions', { email: `other.${email}`, password }, 201);
      await pool.query('update accounts set email=$2 where id=$1', [first.id, preserved]);
      const core = await hash(['accounts']);
      const registration = { email: email.toUpperCase(), preferredName: 'Linkage', legalName: 'Isolated linkage fixture' };
      const staff = { email: email.toUpperCase(), legalName: 'Linkage fixture', preferredName: 'Linkage', category: 'LECTURER', grade: 'L1', departmentId: 'dept_computing', roleCode: 'legacy_staff', engagedOn: new Date(Date.now()-86400000).toISOString().slice(0,10), reason: 'Isolated appointment', linkExistingAccount: true };
      let offer, accepted;
      if (operation === 'registration') {
        const before = await hash(['accounts', 'people', 'role_assignments', 'invitations', 'account_activation_tokens']);
        accepted = await api('/api/admissions/registrations', registration, 202);
        expect(await hash(['accounts', 'people', 'role_assignments', 'invitations', 'account_activation_tokens'])).toEqual(before);
        expect((await pool.query("select n.recipient_account_id from notifications n join notification_templates t on t.id=n.template_id where t.code='admissions.registration_existing' and n.recipient_account_id=$1", [first.id])).rowCount).toBe(1);
      } else {
        const before = await retained();
        await api('/api/staff', { ...staff, linkExistingAccount: false }, 409, admin.token);
        expect(await retained()).toEqual(before);
        const created = await api('/api/staff', staff, 201, admin.token);
        expect(created).toMatchObject({ status: 'invited', accountId: null, roles: [] });
        offer = (await get('/api/identity/staff-appointments', firstSession.token))[0];
        expect(offer).toMatchObject({ employeeNumber: created.employeeNumber, roleCode: 'legacy_staff' });
        expect(await get('/api/identity/staff-appointments', secondSession.token)).toEqual([]);
        await api(`/api/identity/staff-appointments/${offer.invitationId}`, { accept: true }, 404, secondSession.token);
      }
      expect(await hash(['accounts'])).toEqual(core);
      await pool.query('drop index accounts_canonical_email_key'); dropped = true;
      await pool.query('update accounts set email=$2 where id=$1', [second.id, email.toUpperCase()]);
      for (const inactive of [false, true]) {
        if (inactive) await api(`/api/identity/accounts/${second.id}/suspend`, { reason: 'Isolated ambiguous inactive account' }, 200, admin.token);
        const before = await retained();
        if (operation === 'registration') expect(await api('/api/admissions/registrations', registration, 202)).toEqual(accepted);
        else {
          await api('/api/staff', { ...staff, email: email.toLowerCase() }, 409, admin.token);
          expect(await get('/api/identity/staff-appointments', firstSession.token)).toEqual([]);
          await api(`/api/identity/staff-appointments/${offer.invitationId}`, { accept: true }, 404, firstSession.token);
        }
        expect(await retained()).toEqual(before);
      }
      await pool.query('update accounts set email=$2 where id=$1', [second.id, `other.${email}`]);
      await pool.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))'); dropped = false;
      if (operation === 'staff') {
        const before = await hash(['accounts']);
        await api(`/api/identity/staff-appointments/${offer.invitationId}`, { accept: true }, 200, firstSession.token);
        expect(await hash(['accounts'])).toEqual(before);
        expect((await pool.query("select 1 from staff_members where account_id=$1 and status='active'", [first.id])).rowCount).toBe(1);
        expect((await pool.query("select 1 from role_assignments where account_id=$1 and role_code='legacy_staff'", [first.id])).rowCount).toBe(1);
      }
      expect((await pool.query('select email from accounts where id=$1', [first.id])).rows[0].email).toBe(preserved);
      async function account(mailbox) {
        const invitation = await api('/api/identity/invitations', { email: mailbox, roleCode: 'applicant' }, 201, admin.token);
        return api('/api/identity/activations', { token: invitation.activationToken, password, preferredName: 'Linkage', legalName: 'Isolated linkage account' }, 200);
      }
      async function retained() { return hash(['accounts','people','role_assignments','invitations','account_activation_tokens','staff_members','staff_employment_periods','staff_status_history','notifications','notification_delivery_content','audit_events']); }
      async function hash(tables) {
        const result = [];
        for (const table of tables) result.push((await pool.query(`select md5(coalesce(string_agg(row::text,'' order by row::text),'')) digest from (select to_jsonb(t) row from ${table} t) r`)).rows[0].digest);
        return result;
      }
    } finally {
      try {
        if (secondId) await pool.query('update accounts set email=$2 where id=$1', [secondId, `other.${email}`]);
        if (dropped) await pool.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))');
      } finally { await pool.end(); }
    }
    async function api(path, data, status, token) {
      const response = await request.post(path, { data, headers: token ? { authorization: `Bearer ${token}` } : {} });
      expect(response.status(), path).toBe(status);
      expect(response.headers()['cache-control']).toBe('no-store');
      return (await response.json()).data;
    }
    async function get(path, token) {
      const response = await request.get(path, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status(), path).toBe(200); return (await response.json()).data;
    }
  });
}
