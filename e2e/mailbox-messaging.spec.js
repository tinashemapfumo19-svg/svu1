import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { createPrivateMessagesModule } from '../server/modules/private-messages.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Mailbox messaging fixtures require an isolated database.');

for (const channel of ['private', 'room']) {
  test(`${channel}: canonical recipient matching preserves IDs and refuses all-status ambiguity`, async ({ request }, info) => {
    const pool = createPool(loadConfig()), suffix = `${channel}.${info.project.name}.${Date.now()}`;
    const email = `recipient.${suffix}@example.com`, preserved = ` ${email.toUpperCase()} `;
    let duplicateId, dropped = false;
    try {
      const admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, null, 201);
      const sender = await account(`sender.${suffix}@example.com`), recipient = await account(email), duplicate = await account(`other.${email}`);
      duplicateId = duplicate.accountId;
      const privateRoot = '/api/private-messages', roomRoot = '/api/message-rooms';
      for (const who of [sender, recipient]) {
        await api('PUT', `${privateRoot}/preferences`, { revision: 0, enabled: true }, who.token);
        await api('PUT', `${roomRoot}/preferences`, { revision: 0, enabled: true, requestKey: randomUUID() }, who.token);
      }
      let endpoint = `${privateRoot}/conversations`, room;
      if (channel === 'room') {
        for (const [who, roleCode] of [[sender, 'room_steward'], [duplicate, 'room_approver']]) await api('POST', '/api/access/role-assignments', { accountId: who.accountId, roleCode, reason: 'Isolated canonical recipient fixture' }, admin.token, 201);
        room = await api('POST', roomRoot, { title: `Canonical ${suffix}`, purpose: 'Isolated recipient matching', policyReference: 'FIXTURE', retentionRule: 'Isolated fixture only', requestKey: randomUUID() }, sender.token);
        await api('POST', `${roomRoot}/${room.id}/activate`, { revision: 1, requestKey: randomUUID() }, duplicate.token);
        await api('POST', `${roomRoot}/${room.id}/join`, { requestKey: randomUUID() }, sender.token);
        endpoint = `${roomRoot}/${room.id}/members`;
      }
      await pool.query('update accounts set email=$2 where id=$1', [recipient.accountId, preserved]);
      const identities = await hash(['accounts', 'people', 'role_assignments']);
      const invited = await api('POST', endpoint, { email: email.toUpperCase(), requestKey: randomUUID() }, sender.token);
      expect(await hash(['accounts', 'people', 'role_assignments'])).toEqual(identities);
      if (channel === 'private') {
        const row = (await pool.query('select account_a,account_b from private_conversations where id=$1', [invited.id])).rows[0];
        expect([row.account_a, row.account_b].sort()).toEqual([sender.accountId, recipient.accountId].sort());
        await api('POST', `${privateRoot}/conversations/${invited.id}/accept`, { revision: 1 }, recipient.token);
      } else {
        expect((await pool.query('select account_id,status from message_room_memberships where id=$1', [invited.id])).rows[0]).toEqual({ account_id: recipient.accountId, status: 'pending' });
        await api('POST', `${roomRoot}/${room.id}/members/${invited.id}/accept`, { revision: 1, requestKey: randomUUID() }, recipient.token);
      }
      if(channel==='private') {
        const actor=await createRepository(pool,{mfaPolicy:'enrolled',dataEncryptionKey:loadConfig().dataEncryptionKey}).authenticateSession(sender.token);
        let resume,entered=false;
        const paused=new Promise(resolve=>{resume=resolve;});
        const harness={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,args){const result=await db.query(sql,args);if(!entered && sql==='select id from accounts where lower(btrim(email))=$1 limit 2'){entered=true;await paused;}return result;}};}};
        const pending=createPrivateMessagesModule(harness,{dataEncryptionKey:loadConfig().dataEncryptionKey}).invitePrivateContact({email,requestKey:randomUUID()},actor).then(result=>({result}),error=>({error}));
        try {
          await expect.poll(()=>entered,{timeout:10000}).toBe(true);
          await pool.query('update accounts set email=$2 where id=$1',[recipient.accountId,`moved.${email}`]);
          await pool.query('update accounts set email=$2 where id=$1',[duplicate.accountId,email]);
          const before=await hash(['accounts','people','role_assignments','private_conversations','private_message_reads','audit_events']);
          resume();const completed=await pending;
          expect(completed.error).toMatchObject({statusCode:404});expect(completed.result).toBeUndefined();
          expect(await hash(['accounts','people','role_assignments','private_conversations','private_message_reads','audit_events'])).toEqual(before);
        } finally {
          resume();await pending;
          await pool.query('update accounts set email=$2 where id=$1',[duplicate.accountId,`other.${email}`]);
          await pool.query('update accounts set email=$2 where id=$1',[recipient.accountId,preserved]);
        }
      }
      await pool.query('drop index accounts_canonical_email_key'); dropped = true;
      await pool.query('update accounts set email=$2 where id=$1', [duplicate.accountId, email.toUpperCase()]);
      const tables = (await pool.query("select tablename from pg_tables where schemaname='public' and (tablename like 'private_%' or tablename like 'message_room%' or tablename like 'room_%') order by tablename")).rows.map(r => r.tablename);
      for (const inactive of [false, true]) {
        if (inactive) await api('POST', `/api/identity/accounts/${duplicate.accountId}/suspend`, { reason: 'Isolated inactive canonical collision' }, admin.token);
        const before = await hash([...tables, 'accounts', 'people', 'role_assignments', 'audit_events']);
        await api('POST', endpoint, { email, requestKey: randomUUID() }, sender.token, 404);
        expect(await hash([...tables, 'accounts', 'people', 'role_assignments', 'audit_events'])).toEqual(before);
      }
      expect((await pool.query('select email from accounts where id=$1', [recipient.accountId])).rows[0].email).toBe(preserved);
      async function account(mailbox) {
        const password = 'Canonical-Messaging-Password-2026!';
        const invitation = await api('POST', '/api/identity/invitations', { email: mailbox, roleCode: 'applicant' }, admin.token, 201);
        const activated = await api('POST', '/api/identity/activations', { token: invitation.activationToken, password, preferredName: 'Recipient', legalName: 'Isolated recipient fixture' }, null);
        const session = await api('POST', '/api/identity/sessions', { email: mailbox, password }, null, 201);
        return { ...session, accountId: activated.id };
      }
      async function hash(tables) {
        const result = [];
        for (const table of tables) {
          if (!/^[a-z_]+$/.test(table)) throw Error('Invalid fixture table');
          result.push((await pool.query(`select md5(coalesce(string_agg(row::text,'' order by row::text),'')) digest from (select to_jsonb(t) row from ${table} t) r`)).rows[0].digest);
        }
        return result;
      }
    } finally {
      try {
        if (duplicateId) await pool.query('update accounts set email=$2 where id=$1', [duplicateId, `other.${email}`]);
        if (dropped) await pool.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))');
      } finally { await pool.end(); }
    }
    async function api(method, path, data, token, status = 200) {
      const response = await request.fetch(path, { method, data, headers: token ? { authorization: `Bearer ${token}` } : {} });
      expect(response.status(), path).toBe(status); expect(response.headers()['cache-control']).toBe('no-store');
      return (await response.json()).data;
    }
  });
}
