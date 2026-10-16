import test from 'node:test';
import assert from 'node:assert/strict';
import { cardKey, cardTokenMinutes, readCardToken, signCardToken } from '../server/modules/student-card.js';

const key = cardKey(Buffer.alloc(32, 7));
const now = Date.parse('2026-10-12T08:00:00Z');

test('a card token names the programme and expires after the set minutes', () => {
  const token = signCardToken('spr_1', key, now);
  assert.match(token, /^card-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  const read = readCardToken(token, key, now + 60000);
  assert.equal(read.programmeId, 'spr_1');
  assert.equal(read.expiresAt, new Date(now + cardTokenMinutes * 60000).toISOString());
  assert.throws(() => readCardToken(token, key, now + (cardTokenMinutes + 1) * 60000), (error) => error.statusCode === 410);
});

test('altered, foreign or malformed tokens are refused', () => {
  const token = signCardToken('spr_1', key, now);
  const [payload, sig] = token.slice(5).split('.');
  const other = Buffer.from(JSON.stringify({ p: 'spr_2', e: 9999999999 })).toString('base64url');
  for (const bad of [`card-${other}.${sig}`, signCardToken('spr_1', cardKey(Buffer.alloc(32, 8)), now), `card-${payload}.${'A'.repeat(43)}`, 'card-x.y', 'ABCD-EFGH', '', null])
    assert.throws(() => readCardToken(bad, key, now), (error) => error.statusCode === 404, String(bad));
  assert.throws(() => cardKey(Buffer.alloc(16)), /data encryption key/);
});
