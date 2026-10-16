import test from 'node:test';
import assert from 'node:assert/strict';
import { courseLink, notificationLinkPattern, queueNotification } from '../server/notification-queue.js';

const fakeDb = (inserts, muted = false) => ({ query: async (sql, params) => {
  if (/from notification_preferences/.test(sql)) return { rowCount: muted ? 1 : 0, rows: [] };
  if (/from notification_templates/.test(sql)) return { rowCount: 1, rows: [{ id: 'tpl_1', subject: 'Due {{title}}', body: 'Body' }] };
  if (/insert into notifications/.test(sql)) inserts.push(params);
  return { rowCount: 1, rows: [] };
} });

test('notification links must be in-app hash routes', () => {
  for (const ok of ['#office/fees', '#study/courses/per_1/crs_2', '#apply?programme=x']) assert.ok(notificationLinkPattern.test(ok), ok);
  for (const bad of ['https://evil.example', 'javascript:alert(1)', '#a b', '#"x"', '', '#' + 'a'.repeat(201)]) assert.ok(!notificationLinkPattern.test(bad), bad);
  assert.equal(courseLink('per 1', 'crs/2'), '#study/courses/per%201/crs%2F2');
});

test('a queued notification stores its link in the payload; bad links are refused', async () => {
  const inserts = [];
  await queueNotification(fakeDb(inserts), 'acc_1', 'course.deadline_reminder', { title: 'Essay' }, { link: '#study/timetable' });
  assert.equal(inserts[0][3].link, '#study/timetable');
  await queueNotification(fakeDb(inserts), 'acc_1', 'course.deadline_reminder', { title: 'Essay' });
  assert.equal('link' in inserts[1][3], false);
  await assert.rejects(queueNotification(fakeDb([]), 'acc_1', 'x', {}, { link: 'https://evil.example' }), /in-app route/);
});

import { notificationGroupFor, notificationGroups } from '../server/notification-preferences.js';

test('a muted group is not sent; essential messages have no group and are always sent', async () => {
  const inserts = [];
  assert.equal(await queueNotification(fakeDb(inserts, true), 'acc_1', 'course.deadline_reminder', { title: 'Essay' }), null);
  assert.equal(inserts.length, 0);
  for (const essential of ['course.submission_receipt', 'finance.hold_notice', 'admissions.offer_expiry_reminder', 'results.published', 'identity.password_changed', 'exams.timetable'])
    assert.equal(notificationGroupFor(essential), null, essential);
  assert.equal(notificationGroupFor('staff.weekly_digest'), 'weekly_digest');
  const templates = Object.values(notificationGroups).flatMap((group) => group.templates);
  assert.equal(new Set(templates).size, templates.length);
});
