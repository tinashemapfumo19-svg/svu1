import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { createRepository } from '../server/repository.js';
import { createPrivateMessagesModule } from '../server/modules/private-messages.js';
import { createMessageRoomsModule } from '../server/modules/message-rooms.js';
import { encryptSecret } from '../server/security.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname), 'Quota fixtures require an isolated database.');

test('messaging quotas use post-lock wall time, serialize actor capacity and retain safe retries', async ({ request }, info) => {
  test.setTimeout(600000);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const config = loadConfig(), encryption = { dataEncryptionKey: config.dataEncryptionKey }, suffix = `${info.project.name}.${Date.now()}`;
  const priv = '/api/private-messages', rooms = '/api/message-rooms';
  const privateModule = p => createPrivateMessagesModule(p, encryption), roomModule = p => createMessageRoomsModule(p, encryption);
  try {
    const admin = await api('POST', '/api/identity/sessions', { email: 'admin@southvalley.test', password: 'Phase1-Admin-Password-2026!' }, undefined, 201);
    const a = await account('actor'), b = await account('peer'), c = await account('reviewer'), d = await account('target');
    for (const [who, roleCode] of [[a, 'room_steward'], [c, 'room_approver']]) await api('POST', '/api/access/role-assignments', { accountId: who.accountId, roleCode, reason: 'Isolated quota fixture appointment' }, admin.token, 201);
    const actor = await createRepository(pool, { mfaPolicy: 'enrolled', ...encryption }).authenticateSession(a.token);
    const contact = await api('POST', `${priv}/conversations`, { email: b.email, requestKey: key() }, a.token);
    const thread = `${priv}/conversations/${contact.id}`;
    await api('POST', `${thread}/accept`, { revision: 1 }, b.token);
    const definitions = [];
    for (let n = 0; n < 3; n++) {
      const room = await api('POST', rooms, { title: `Quota room ${n} ${suffix}`, purpose: 'Isolated concurrency verification', policyReference: 'ISOLATED-QUOTA', retentionRule: 'Isolated test records only', requestKey: key() }, a.token);
      await api('POST', `${rooms}/${room.id}/activate`, { revision: 1, requestKey: key() }, c.token);
      definitions.push(room.id);
    }
    const own = [];
    for (const id of definitions.slice(0, 2)) own.push(await api('POST', `${rooms}/${id}/join`, { requestKey: key() }, a.token));
    const invited = await api('POST', `${rooms}/${definitions[0]}/members`, { email: b.email, requestKey: key() }, a.token);
    const peerMember = await api('POST', `${rooms}/${definitions[0]}/members/${invited.id}/accept`, { revision: 1, requestKey: key() }, b.token);
    const body = '<b>Keep these words</b>\nSecond line.';

    const staleSendInput = { body, requestKey: key() };
    const staleSend = await delayed(privateModule, 'sendPrivateMessage', [contact.id, staleSendInput, actor], 'private-command:', async start => {
      await seedPrivateMessages(29, start, true);
    });
    expect(staleSend.quota.total).toBe(0);
    await timestamp('private_messages', 'created_at', staleSend.result.id, staleSend.released);
    expect((await api('GET', `${thread}/messages`, undefined, a.token)).items.find(m => m.id === staleSend.result.id).body).toBe(body);
    const staleInviteInput = { email: d.email, requestKey: key() };
    const staleInvite = await delayed(privateModule, 'invitePrivateContact', [staleInviteInput, actor], 'private-command:', async start => {
      await seedPrivateInvites(19, start, true);
    });
    expect(staleInvite.quota.total).toBe(1);
    await timestamp('private_conversations', 'created_at', staleInvite.result.id, staleInvite.released);
    const staleRoomInvite = await delayed(roomModule, 'inviteRoomMember', [definitions[1], { email: d.email, requestKey: key() }, actor], 'room-command:');
    await timestamp('message_room_memberships', 'invited_at', staleRoomInvite.result.id, staleRoomInvite.released);
    const staleJoin = await delayed(roomModule, 'joinOwnMessageRoom', [definitions[2], { requestKey: key() }, actor], 'room-command:');
    await timestamp('message_room_memberships', 'invited_at', staleJoin.result.id, staleJoin.released);
    own.push(staleJoin.result);

    await seedPrivateMessages(29 - await count('private_messages', 'author_id', 'created_at', '1 minute'), null, false);
    const sendInput = { body: 'Stable private quota retry', requestKey: key() };
    await faults(privateModule, 'sendPrivateMessage', [contact.id, sendInput, actor], false);
    const sent = await race(privateModule, 'sendPrivateMessage', [contact.id, sendInput, actor], 'private_messages', () => raw('POST', `${thread}/messages`, { body: 'Competing private capacity', requestKey: key() }, a.token), 29);
    const privateFull = await snapshot();
    expect(await api('POST', `${thread}/messages`, sendInput, a.token)).toEqual(sent);
    await api('POST', `${thread}/messages`, { ...sendInput, body: 'Changed retry' }, a.token, 409);
    await api('POST', `${thread}/messages`, { body: 'Beyond private capacity', requestKey: key() }, a.token, 429);
    expect(await snapshot()).toBe(privateFull);
    expect(await count('private_messages', 'author_id', 'created_at', '1 minute')).toBe(30);

    await seedPrivateInvites(19 - await count('private_conversations', 'invited_by', 'created_at', '1 day'), null, false);
    const inviteInput = { email: c.email, requestKey: key() };
    await faults(privateModule, 'invitePrivateContact', [inviteInput, actor], false);
    const lastContact = await race(privateModule, 'invitePrivateContact', [inviteInput, actor], 'private_conversations', () => raw('POST', `${priv}/conversations`, { email: c.email, requestKey: key() }, a.token), 19);
    const privateInviteFull = await snapshot();
    expect(await api('POST', `${priv}/conversations`, inviteInput, a.token)).toEqual(lastContact);
    await api('POST', `${priv}/conversations`, { email: b.email, requestKey: inviteInput.requestKey }, a.token, 409);
    await api('POST', `${priv}/conversations`, { email: c.email, requestKey: key() }, a.token, 429);
    expect(await snapshot()).toBe(privateInviteFull);
    expect(await count('private_conversations', 'invited_by', 'created_at', '1 day')).toBe(20);

    await seedRoomMessages(a.accountId, own[0].id, 29);
    const roomSendInput = { body, kind: 'notice', requestKey: key() };
    await faults(roomModule, 'sendRoomMessage', [definitions[0], roomSendInput, actor], true);
    const roomSent = await race(roomModule, 'sendRoomMessage', [definitions[0], roomSendInput, actor], 'room_messages', () => raw('POST', `${rooms}/${definitions[1]}/messages`, { body: 'Other room action', kind: 'action', requestKey: key() }, a.token), 29);
    const roomFull = await snapshot();
    expect(await api('POST', `${rooms}/${definitions[0]}/messages`, roomSendInput, a.token)).toEqual(roomSent);
    await api('POST', `${rooms}/${definitions[0]}/messages`, { ...roomSendInput, kind: 'text' }, a.token, 409);
    await api('POST', `${rooms}/${definitions[1]}/messages`, { body: 'Beyond room capacity', requestKey: key() }, a.token, 429);
    expect(await snapshot()).toBe(roomFull);
    expect(await count('room_messages', 'author_id', 'created_at', '1 minute')).toBe(30);
    expect((await api('GET', `${rooms}/${definitions[0]}/messages`, undefined, a.token)).items.find(m => m.id === roomSent.id).body).toBe(body);

    await seedRoomInvites(49 - await count('message_room_memberships', 'invited_by', 'invited_at', '1 day'));
    const roomInviteInput = { email: c.email, requestKey: key() };
    await faults(roomModule, 'inviteRoomMember', [definitions[1], roomInviteInput, actor], true);
    const roomInvited = await race(roomModule, 'inviteRoomMember', [definitions[1], roomInviteInput, actor], 'message_room_memberships', () => raw('POST', `${rooms}/${definitions[2]}/members`, { email: c.email, requestKey: key() }, a.token), 49);
    const roomInviteFull = await snapshot();
    expect(await api('POST', `${rooms}/${definitions[1]}/members`, roomInviteInput, a.token)).toEqual(roomInvited);
    await api('POST', `${rooms}/${definitions[1]}/members`, { ...roomInviteInput, email: b.email }, a.token, 409);
    await api('POST', `${rooms}/${definitions[2]}/members`, { email: c.email, requestKey: key() }, a.token, 429);
    expect(await snapshot()).toBe(roomInviteFull);
    expect(await count('message_room_memberships', 'invited_by', 'invited_at', '1 day')).toBe(50);

    const reportMessages = await seedRoomMessages(b.accountId, peerMember.id, 51);
    const reportInput = { category: 'spam', reason: 'Isolated quota report', disclose: true, requestKey: key() };
    for (const id of reportMessages.slice(0, 49)) await api('POST', `${rooms}/${definitions[0]}/messages/${id}/report`, { ...reportInput, requestKey: key() }, a.token);
    await faults(roomModule, 'reportRoomMessage', [definitions[0], reportMessages[49], reportInput, actor], true);
    const reported = await race(roomModule, 'reportRoomMessage', [definitions[0], reportMessages[49], reportInput, actor], 'room_abuse_reports', () => raw('POST', `${rooms}/${definitions[0]}/messages/${reportMessages[50]}/report`, { ...reportInput, requestKey: key() }, a.token), 49);
    const reportFull = await snapshot();
    expect(await api('POST', `${rooms}/${definitions[0]}/messages/${reportMessages[49]}/report`, reportInput, a.token)).toEqual(reported);
    await api('POST', `${rooms}/${definitions[0]}/messages/${reportMessages[49]}/report`, { ...reportInput, reason: 'Changed report retry' }, a.token, 409);
    await api('POST', `${rooms}/${definitions[0]}/messages/${reportMessages[50]}/report`, { ...reportInput, requestKey: key() }, a.token, 429);
    expect(await snapshot()).toBe(reportFull);
    expect(await count('room_abuse_reports', 'reporter_id', 'created_at', '1 day')).toBe(50);

    async function seedPrivateMessages(n, start, expiring) {
      const rows = Array.from({ length: n }, () => { const id = `pm_${key()}`; return { id, envelope: encryptSecret(JSON.stringify({ id, conversationId: contact.id, authorId: a.accountId, body: 'Isolated retained quota fixture' }), config.dataEncryptionKey), key: key() }; });
      await pool.query(`insert into private_messages(id,conversation_id,author_id,envelope,request_key,request_digest,created_at)
        select t.id,$1,$2,t.envelope,t.key,'isolated-fixture',${expiring ? "$4::timestamptz-interval '1 minute'+interval '1 second'" : 'clock_timestamp()'} from jsonb_to_recordset($3::jsonb) as t(id text,envelope text,key text)`, [contact.id, a.accountId, JSON.stringify(rows), ...(expiring ? [start] : [])]);
    }
    async function seedPrivateInvites(n, start, expiring) {
      const ids = [a.accountId, b.accountId].sort();
      await pool.query(`insert into private_conversations(id,account_a,account_b,invited_by,request_key,request_digest,status,closed_at,created_at)
        select 'pc_'||t.id,$1,$2,$3,t.id,'isolated-fixture','closed',clock_timestamp(),${expiring ? "$5::timestamptz-interval '1 day'+interval '1 second'" : 'clock_timestamp()'} from jsonb_array_elements_text($4::jsonb) as t(id)`, [...ids, a.accountId, JSON.stringify(Array.from({ length: n }, key)), ...(expiring ? [start] : [])]);
    }
    async function seedRoomMessages(authorId, membershipId, n) {
      const rows = Array.from({ length: n }, (_, i) => { const id = `rmsg_${key()}`, kind = authorId === a.accountId ? ['text', 'action', 'notice'][i % 3] : 'text'; return { id, kind, envelope: encryptSecret(JSON.stringify({ id, roomId: definitions[0], authorId, membershipId, kind, body: 'Isolated retained quota fixture' }), config.dataEncryptionKey) }; });
      await pool.query('insert into room_messages(id,room_id,author_id,membership_id,kind,envelope,created_at) select t.id,$1,$2,$3,t.kind,t.envelope,clock_timestamp() from jsonb_to_recordset($4::jsonb) as t(id text,kind text,envelope text)', [definitions[0], authorId, membershipId, JSON.stringify(rows)]);
      return rows.map(r => r.id);
    }
    async function seedRoomInvites(n) {
      const db = await pool.connect();
      try {
        await db.query('begin');
        for (let i = 0; i < n; i++) {
          const id = `rm_${key()}`;
          await db.query('insert into message_room_memberships(id,room_id,account_id,invited_by,invited_at) values($1,$2,$3,$4,clock_timestamp())', [id, definitions[2], c.accountId, a.accountId]);
          await db.query("insert into message_room_membership_history(membership_id,revision,status,role,actor_id,reason_encrypted) values($1,1,'pending','member',$2,$3)", [id, a.accountId, encryptSecret(JSON.stringify({ membershipId: id, roomId: definitions[2], revision: 1, actorId: a.accountId, reason: 'Isolated retained quota fixture' }), config.dataEncryptionKey)]);
          await db.query("update message_room_memberships set status='declined',revision=2,ended_at=clock_timestamp() where id=$1", [id]);
          await db.query("insert into message_room_membership_history(membership_id,revision,status,role,actor_id,reason_encrypted) values($1,2,'declined','member',$2,$3)", [id, c.accountId, encryptSecret(JSON.stringify({ membershipId: id, roomId: definitions[2], revision: 2, actorId: c.accountId, reason: 'Isolated retained quota fixture' }), config.dataEncryptionKey)]);
        }
        await db.query('commit');
      } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
    }
    async function count(table, actorColumn, timeColumn, interval) {
      return (await pool.query(`select count(*)::int as total from ${table} where ${actorColumn}=$1 and ${timeColumn}>clock_timestamp()-$2::interval`, [a.accountId, interval])).rows[0].total;
    }
    async function timestamp(table, column, id, released) {
      expect((await pool.query(`select ${column}>=$2::timestamptz as fresh from ${table} where id=$1`, [id, released])).rows[0].fresh).toBe(true);
    }
    function harness(match) {
      let resume; const hold = new Promise(resolve => { resume = resolve; });
      const h = { resume, entered: false, quota: null, async connect() {
        const db = await pool.connect(); h.pid = (await db.query('select pg_backend_pid() as pid')).rows[0].pid;
        return { release: () => db.release(), async query(sql, args) {
          const result = await db.query(sql, args);
          if (sql === 'begin') h.start = (await db.query('select now()::text as started')).rows[0].started;
          if (sql.includes('count(*)::int as total')) h.quota = result.rows[0];
          if (!h.entered && match(sql, args)) { h.entered = true; await hold; }
          return result;
        } };
      } };
      return h;
    }
    async function delayed(factory, method, args, lockPrefix, seed) {
      const h = harness((sql, params) => sql.includes('pg_advisory_xact_lock') && params?.[0] === lockPrefix + a.accountId);
      const operation = factory(h)[method](...args).then(result => ({ result }), error => ({ error }));
      try {
        await expect.poll(() => h.entered, { timeout: 15000 }).toBe(true);
        if (seed) await seed(h.start);
        await pool.query('select pg_sleep(2)');
        const released = (await pool.query('select clock_timestamp()::text as released')).rows[0].released;
        h.resume(); const outcome = await operation; if (outcome.error) throw outcome.error;
        return { result: outcome.result, quota: h.quota, released };
      } finally { h.resume(); await operation; }
    }
    async function race(factory, method, args, table, competing, total) {
      const h = harness(sql => sql.includes(`count(*)::int as total from ${table}`));
      const operation = factory(h)[method](...args).then(result => ({ result }), error => ({ error }));
      let other;
      try {
        await expect.poll(() => h.entered, { timeout: 15000 }).toBe(true); expect(h.quota.total).toBe(total);
        other = competing().then(response => ({ response }), error => ({ error }));
        await expect.poll(async () => (await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and $1::int=any(pg_blocking_pids(pid))", [h.pid])).rowCount, { timeout: 15000, message: `${method}: competing actor capacity must wait on the operation backend` }).toBeGreaterThan(0);
        h.resume(); const first = await operation; if (first.error) throw first.error;
        const second = await other; if (second.error) throw second.error;
        expect(second.response.status()).toBe(429); expect(second.response.headers()['cache-control']).toBe('no-store'); expect((await second.response.json()).data).toBeUndefined();
        return first.result;
      } finally { h.resume(); await operation; if (other) await other; }
    }
    async function faults(factory, method, args, receipt) {
      for (const needle of receipt ? ['insert into audit_events', 'insert into room_message_receipts'] : ['insert into audit_events']) {
        const before = await snapshot(); let injected = false;
        const failing = { async connect() { const db = await pool.connect(); return { release: () => db.release(), async query(sql, params) { if (sql.includes(needle)) { injected = true; return db.query('select 1/0'); } return db.query(sql, params); } }; } };
        await expect(factory(failing)[method](...args)).rejects.toMatchObject({ code: '22012' }); expect(injected).toBe(true); expect(await snapshot()).toBe(before);
      }
    }
    async function snapshot() {
      const names = (await pool.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r => r.table_name).filter(n => /^(private_|message_room|room_)/.test(n));
      const state = {};
      for (const name of names) { if (!/^[a-z_]+$/.test(name)) throw Error('Invalid fixture table'); state[name] = (await pool.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${name} t`)).rows[0].rows; }
      state.audit = (await pool.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as rows from audit_events t where (action like 'private_message.%' or action like 'message_room.%') and action not like '%.read'")).rows[0].rows;
      return createHash('sha256').update(JSON.stringify(state)).digest('hex');
    }
    async function account(name) {
      const email = `quota.${name}.${suffix}@example.com`, password = 'Quota-Browser-Password-2026!';
      const invite = await api('POST', '/api/identity/invitations', { email, roleCode: 'applicant' }, admin.token, 201);
      const account = await api('POST', '/api/identity/activations', { token: invite.activationToken, password, preferredName: name, legalName: `Quota ${name}` });
      const session = await api('POST', '/api/identity/sessions', { email, password }, undefined, 201);
      await api('PUT', `${priv}/preferences`, { revision: 0, enabled: true }, session.token);
      await api('PUT', `${rooms}/preferences`, { revision: 0, enabled: true, requestKey: key() }, session.token);
      return { ...session, email, accountId: account.id };
    }
  } finally { await pool.end(); }
  function key() { return randomUUID(); }
  function raw(method, url, data, token) { return request.fetch(url, { method, data, timeout: 40000, headers: token ? { Authorization: `Bearer ${token}` } : {} }); }
  async function api(method, url, data, token, status = 200) {
    const response = await raw(method, url, data, token); expect(response.status(), `${method} ${url}`).toBe(status); expect(response.headers()['cache-control']).toBe('no-store');
    const value = await response.json(); if (status >= 400) { expect(value.data).toBeUndefined(); return; } return value.data;
  }
});
