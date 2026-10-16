import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyWarningCsv, followUpOutcomes } from '../server/modules/ai-features.js';

const row = (extra = {}) => ({ studentNumber: 'S1', studentName: 'Tariro Moyo', programmeCode: 'BSC-IS', reasons: [{ code: 'missing_work', text: '2 assignments past due' }, { code: 'financial_hold', text: 'Financial hold on the account' }], lastFollowUp: null, ...extra });

test('the early-warning CSV has a header, joined reasons and the latest follow-up', () => {
  const csv = earlyWarningCsv([row({ lastFollowUp: { outcome: 'contacted', at: '2026-10-12T09:00:00Z', by: 'Rudo Dube', note: 'secret note' } }), row({ studentNumber: 'S2' })]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Student number,Name,Programme,Reasons,Last follow-up,Follow-up date,Followed up by');
  assert.equal(lines[1], 'S1,Tariro Moyo,BSC-IS,2 assignments past due; Financial hold on the account,Contacted the student,2026-10-12,Rudo Dube');
  assert.equal(lines[2], 'S2,Tariro Moyo,BSC-IS,2 assignments past due; Financial hold on the account,,,');
  assert.equal(lines.at(-1), '');
  assert.doesNotMatch(csv, /secret note/); // notes stay in the portal
});

test('cells are quoted when needed and formula-like text is neutralised', () => {
  const csv = earlyWarningCsv([row({ studentName: '=HYPERLINK("http://x")', programmeCode: 'A,B' })]);
  const line = csv.split('\r\n')[1];
  assert.ok(line.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(line.includes('"A,B"'));
  assert.deepEqual(Object.keys(followUpOutcomes), ['contacted', 'meeting_booked', 'referred', 'no_action']);
});

import { supportReasons } from '../server/modules/ai-features.js';

test('low attendance is flagged below 75% once there are at least four sessions', () => {
  assert.deepEqual(supportReasons({ attendanceSessions: 8, attendanceMarked: 5 }).map((row) => row.code), ['low_attendance']);
  assert.match(supportReasons({ attendanceSessions: 8, attendanceMarked: 5 })[0].text, /Attended 5 of 8/);
  assert.deepEqual(supportReasons({ attendanceSessions: 8, attendanceMarked: 6 }), []);
  assert.deepEqual(supportReasons({ attendanceSessions: 3, attendanceMarked: 0 }), []);
});
