import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceCode, attendanceRate, attendanceWindow, codeMatches, codeWindowSeconds } from '../server/modules/attendance.js';
import { deriveKey } from '../server/derived-keys.js';

const key = deriveKey(Buffer.alloc(32, 3), 'attendance');
const now = Date.parse('2026-10-12T08:00:05Z');
const session = 'att_00000000-0000-4000-8000-000000000001';

test('attendance codes are six unambiguous characters that change every window', () => {
  const code = attendanceCode(key, session, attendanceWindow(now));
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(code, attendanceCode(key, session, attendanceWindow(now) + 1));
  assert.notEqual(code, attendanceCode(key, 'att_00000000-0000-4000-8000-000000000002', attendanceWindow(now)));
  assert.notEqual(code, attendanceCode(deriveKey(Buffer.alloc(32, 4), 'attendance'), session, attendanceWindow(now)));
});

test('a check-in accepts the current or previous code only, in any case or spacing', () => {
  const code = attendanceCode(key, session, attendanceWindow(now));
  assert.ok(codeMatches(key, session, code, now));
  assert.ok(codeMatches(key, session, `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`, now));
  assert.ok(codeMatches(key, session, code, now + codeWindowSeconds * 1000)); // previous window still accepted
  assert.ok(!codeMatches(key, session, code, now + 2 * codeWindowSeconds * 1000)); // two windows later it is stale
  for (const bad of ['', 'ABC', 'AAAAAAA', null]) assert.ok(!codeMatches(key, session, bad, now));
});

test('attendance rate is a whole percentage, or null with no sessions yet', () => {
  assert.equal(attendanceRate(3, 4), 75);
  assert.equal(attendanceRate(0, 0), null);
});
