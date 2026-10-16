import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('canonical uniqueness migration orders writers and refuses collisions before index creation', async () => {
  const sql = await readFile(new URL('../migrations/103_account_mailbox_uniqueness.sql', import.meta.url), 'utf8');
  assert.match(sql, /lock table accounts in share mode/);
  assert.match(sql, /group by lower\(btrim\(email\)\) having count\(\*\) > 1/);
  assert.match(sql, /errcode = '23505'/);
  assert.ok(sql.indexOf('lock table') < sql.indexOf('if exists'));
  assert.ok(sql.indexOf('raise exception') < sql.indexOf('create unique index'));
  assert.match(sql, /create unique index accounts_canonical_email_key on accounts \(lower\(btrim\(email\)\)\)/);
  assert.doesNotMatch(sql, /\b(update|delete|truncate|drop)\b/i);
});
