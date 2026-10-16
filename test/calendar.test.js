import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarRange, deadlineStatus } from '../server/modules/calendar.js';

const now = new Date('2026-10-12T08:00:00Z');
const hours = h => new Date(now.getTime() + h * 3600000).toISOString();

test('the calendar range defaults to a week back and six weeks ahead', () => {
  const { from, to } = calendarRange({}, now);
  assert.equal(from.toISOString(), '2026-10-05T08:00:00.000Z');
  assert.equal(to.toISOString(), '2026-11-23T08:00:00.000Z');
});

test('the calendar range accepts YYYY-MM-DD dates up to 120 days apart', () => {
  const { from, to } = calendarRange({ from: '2026-10-01', to: '2026-11-01' }, now);
  assert.equal(from.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(to.toISOString(), '2026-11-01T00:00:00.000Z');
  for (const input of [{ from: '01/10/2026' }, { from: '2026-13-40' }, { from: '2026-11-01', to: '2026-10-01' }, { from: '2026-01-01', to: '2026-06-01' }])
    assert.throws(() => calendarRange(input, now), (error) => error.status === 400 || error.statusCode === 400);
});

test('deadline status reflects the submission and the time left', () => {
  assert.equal(deadlineStatus({ dueAt: hours(-5), submitted: true, now }), 'submitted');
  assert.equal(deadlineStatus({ dueAt: hours(-1), submitted: false, now }), 'overdue');
  assert.equal(deadlineStatus({ dueAt: hours(12), submitted: false, now }), 'due_soon');
  assert.equal(deadlineStatus({ dueAt: hours(24), submitted: false, now }), 'due_soon');
  assert.equal(deadlineStatus({ dueAt: hours(30), submitted: false, now }), 'due');
});

import { buildCalendar, foldLine } from '../server/ics.js';
import { feedDigest, feedEvent } from '../server/modules/calendar.js';

test('the iCalendar writer escapes text, folds long lines and writes all-day dates', () => {
  const body = buildCalendar({ name: 'SVU', now: new Date('2026-10-12T08:00:00Z'), events: [
    { id: 'assignment:r1', title: 'Essay; part 1, draft', description: 'Line one\nLine two', start: '2026-10-15T10:00:00Z', end: '2026-10-15T11:00:00Z', allDay: false, url: 'https://svu.example/#study/timetable' },
    { id: 'fee:f1', title: 'Tuition', start: '2026-11-01T00:00:00.000Z', allDay: true }] });
  assert.match(body, /^BEGIN:VCALENDAR\r\n/);
  assert.ok(body.includes('SUMMARY:Essay\\; part 1\\, draft\r\n'));
  assert.ok(body.includes('DESCRIPTION:Line one\\nLine two\r\n'));
  assert.match(body, /DTSTART:20261015T100000Z\r\n/);
  assert.match(body, /DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102\r\n/);
  assert.match(body, /END:VCALENDAR\r\n$/);
  const folded = foldLine('SUMMARY:' + 'x'.repeat(200));
  assert.ok(folded.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(folded.replace(/\r\n /g, ''), 'SUMMARY:' + 'x'.repeat(200));
});

test('feed events leave fee amounts and exam seats in the portal', () => {
  const fee = feedEvent({ id: 'fee:1', type: 'fee', title: 'Tuition', subtitle: 'USD 450.00 outstanding', start: '2026-11-01T00:00:00Z', allDay: true, href: '#office/fees' }, 'https://svu.example');
  assert.doesNotMatch(JSON.stringify(fee), /450/);
  assert.equal(fee.url, 'https://svu.example/#office/fees');
  const exam = feedEvent({ id: 'exam:1', type: 'exam', title: 'COMP101 Final', subtitle: 'Hall A · Seat 12', start: '2026-11-03T08:00:00Z', allDay: false });
  assert.doesNotMatch(JSON.stringify(exam), /Seat 12/);
  assert.equal(exam.title, 'Exam: COMP101 Final');
  assert.match(feedDigest('abc'), /^[0-9a-f]{64}$/);
});
