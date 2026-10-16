import test from 'node:test';
import assert from 'node:assert/strict';
import { accountMailbox, lockAccountMailbox, requireNewAccountMailbox } from '../server/account-mailbox.js';

test('new-account mailboxes normalize without accepting arbitrary values or header controls', () => {
  assert.equal(accountMailbox(' Mixed.Case@Example.com '), 'mixed.case@example.com');
  for (const raw of [null, {}, ['a@example.com'], 'a@example.com\n', 'a@example.com\r', 'a\u0000@example.com', 'bad', 'a..b@example.com', 'a@localhost']) assert.throws(() => accountMailbox(raw), { statusCode: 400 });
});

test('all native account writers can lock the same canonical mailbox and refuse every existing status', async () => {
  const calls = [], db = { async query(sql, args) { calls.push({ sql, args }); return { rowCount: 0 }; } };
  const email = await lockAccountMailbox(db, ' Mixed.Case@Example.com ');
  await requireNewAccountMailbox(db, email);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(calls[0].args, ['account-mailbox:mixed.case@example.com']);
  assert.deepEqual(calls[1].args, ['mixed.case@example.com']);
  assert.match(calls[1].sql, /lower\(btrim\(email\)\)=\$1 limit 1/);
  assert.doesNotMatch(calls[1].sql, /status/);
  await assert.rejects(requireNewAccountMailbox({ async query() { return { rowCount: 1 }; } }, email), { statusCode: 409 });
});
