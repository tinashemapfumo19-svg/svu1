import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentKinds, slotTimes } from '../server/modules/appointments.js';

test('slots run back to back and repeat weekly', () => {
  const times = slotTimes({ startsAt: '2026-10-20T08:00:00.000Z', durationMinutes: 20, count: 3, weeks: 2 });
  assert.equal(times.length, 6);
  assert.deepEqual(times.slice(0, 3).map((row) => row.startsAt), ['2026-10-20T08:00:00.000Z', '2026-10-20T08:20:00.000Z', '2026-10-20T08:40:00.000Z']);
  assert.equal(times[2].endsAt, '2026-10-20T09:00:00.000Z');
  assert.equal(times[3].startsAt, '2026-10-27T08:00:00.000Z');
});

test('appointment types are a fixed list that matches the database check', () => {
  assert.deepEqual(Object.keys(appointmentKinds), ['office_hours', 'academic_advising', 'finance', 'support', 'registry']);
});
