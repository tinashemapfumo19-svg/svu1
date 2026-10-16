import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createIdentitySelfServiceModule } from '../server/modules/identity-self-service.js';
import { hashSecret } from '../server/security.js';

test('ambiguous login pays the password check and records a generic failure without account writes', async () => {
  const password = 'Mailbox-Unit-Password-2026!', secret = await hashSecret(password);
  for (const statuses of [['active', 'active'], ['active', 'suspended'], ['suspended', 'active']]) {
    const calls = [];
    const pool = { async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes('count(*)::int as failures')) return { rows: [{ failures: 0 }] };
      if (sql.includes('from accounts')) return { rows: statuses.map((status, i) => ({ id: `account_${i}`, email: 'fixture@example.com', status, password_hash: secret.hash, password_salt: secret.salt })) };
      if (sql.startsWith('insert into login_failures') || sql.includes('insert into audit_events')) return { rows: [] };
      throw new Error('Unexpected account-specific query');
    }, async connect() { assert.fail('An ambiguous login must not create a session'); } };
    await assert.rejects(createRepository(pool).createSession({ email: ' Fixture@Example.com ', password }), { statusCode: 401, message: 'Invalid email or password.' });
    const lookup = calls.find(c => c.sql.includes('from accounts'));
    assert.match(lookup.sql, /lower\(btrim\(email\)\) = \$1 or exists/);
    assert.match(lookup.sql, /legacy_login_aliases/);
    assert.match(lookup.sql, /limit 2/);
    assert.deepEqual(lookup.args, ['fixture@example.com']);
    assert.ok(calls.some(c => c.sql.startsWith('insert into login_failures')));
    assert.ok(!calls.some(c => c.sql.includes('from mfa_factors')));
  }
});

test('recovery refuses any mailbox ambiguity before tokens, throttles, audit or notification work', async () => {
  const results = [[], [{ id: 'inactive', status: 'suspended' }], [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }], [{ id: 'a', status: 'active' }, { id: 'b', status: 'suspended' }], [{ id: 'a', status: 'suspended' }, { id: 'b', status: 'active' }]];
  let accepted;
  for (const rows of results) {
    const calls = [];
    const module = createIdentitySelfServiceModule({ async query(sql, args) {
      calls.push({ sql, args });
      assert.equal(calls.length, 1);
      return { rows, rowCount: rows.length };
    }, async connect() { assert.fail('Recovery must not write for absent, inactive or ambiguous mailboxes'); } });
    const result = await module.requestPasswordRecovery({ email: ' Fixture@Example.com ' });
    accepted ??= result;
    assert.deepEqual(result, accepted);
    assert.match(calls[0].sql, /lower\(btrim\(email\)\) = \$1 limit 2/);
    assert.doesNotMatch(calls[0].sql, /and status/);
    assert.deepEqual(calls[0].args, ['fixture@example.com']);
  }
});
