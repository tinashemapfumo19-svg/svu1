import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineWindow, digestLines, isoWeek, offerWindow } from '../server/modules/automations.js';
import { resolveAutomations, startAutomationScheduler } from '../server/automation-scheduler.js';

const now = new Date('2026-10-12T08:00:00Z');
const hours = h => new Date(now.getTime() + h * 3600000).toISOString();

test('deadline reminders fall into 48-hour and 24-hour windows only before the deadline', () => {
  assert.equal(deadlineWindow(hours(47), now).job, 'deadline_48');
  assert.equal(deadlineWindow(hours(24.5), now).job, 'deadline_48');
  assert.equal(deadlineWindow(hours(24), now).job, 'deadline_24');
  assert.equal(deadlineWindow(hours(1), now).job, 'deadline_24');
  for (const h of [-1, 0, 48.01, 100]) assert.equal(deadlineWindow(hours(h), now), null);
});

test('offer reminders fall into 7-day and 2-day windows only while the offer is open', () => {
  assert.equal(offerWindow(hours(6 * 24), now).job, 'offer_7d');
  assert.equal(offerWindow(hours(48), now).job, 'offer_2d');
  assert.equal(offerWindow(hours(3), now).job, 'offer_2d');
  for (const h of [-5, 0, 7 * 24 + 1]) assert.equal(offerWindow(hours(h), now), null);
});

test('the weekly digest summarises only non-zero work and is skipped when there is none', () => {
  assert.equal(digestLines({ tasks: 0, unmarked: 0, support: 0 }), null);
  const digest = digestLines({ tasks: 1, unmarked: 14, support: 2 });
  assert.equal(digest.headline, '14 unmarked submissions, 2 open support cases assigned to you');
  assert.equal(digest.lines, 'This week: 14 unmarked submissions; 2 open support cases assigned to you; 1 open task assigned to you.');
});

test('ISO week labels are stable across a week and roll over correctly', () => {
  assert.equal(isoWeek(new Date('2026-10-12T00:00:00Z')), '2026-W42');
  assert.equal(isoWeek(new Date('2026-10-18T23:59:00Z')), '2026-W42');
  assert.equal(isoWeek(new Date('2026-10-19T00:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
});

test('automations are off unless explicitly enabled, and the scheduler runs one sweep at a time', async () => {
  assert.equal(resolveAutomations(undefined), false);
  assert.equal(resolveAutomations('enabled'), true);
  assert.equal(resolveAutomations('disabled'), false);
  assert.throws(() => resolveAutomations('yes'), /enabled or disabled/);
  let calls = 0;
  const logs = [];
  const scheduler = startAutomationScheduler({ repository: { runAutomationSweep: async () => { calls++; return { results: { deadline_reminders: { sent: 2 } }, failed: false }; } }, logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) }, intervalMs: 60000 });
  await scheduler.stop();
  assert.equal(calls, 1);
  assert.deepEqual(logs, [['automation_sweep', { sent: 2, failed: false }]]);
  assert.throws(() => startAutomationScheduler({ repository: {}, logger: {}, intervalMs: 10 }), /Invalid automation interval/);
});
