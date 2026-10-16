import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPage, canOpenPage, helpPages, pagesFor, rankPages } from '../server/help-map.js';
import { simulatedAssistant } from '../server/ai-assist.js';
import { createAiFeaturesModule } from '../server/modules/ai-features.js';

const ids = pages => pages.map(page => page.id);
const pool = { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }), query: async () => ({ rows: [] }) };
const guidance = { listPublicGuidance: async () => ({ items: [{ id: 'g1', title: 'Documents you need', body: 'Upload your ID and certificates.' }] }) };

test('page ids are unique and every route is an in-app hash', () => {
  assert.equal(new Set(ids(helpPages)).size, helpPages.length);
  for (const page of helpPages) assert.match(page.route, /^#[a-z]/, page.id);
});

test('visitors see only public and signed-out pages', () => {
  const visible = ids(pagesFor(null));
  assert.ok(visible.includes('apply') && visible.includes('signin') && visible.includes('verify'));
  assert.ok(!visible.includes('home') && !visible.includes('study-today') && !visible.includes('system'));
});

test('signed-in people see pages for the permissions they hold, with area wildcards', () => {
  const student = ids(pagesFor(['registry.self']));
  assert.ok(student.includes('office-fees') && student.includes('home') && !student.includes('signin'));
  assert.ok(!student.includes('staff-students') && !student.includes('my-teaching'));
  assert.ok(ids(pagesFor(['finance.imports.manage'])).includes('staff-finance'));
  assert.ok(!ids(pagesFor(['financeish'])).includes('staff-finance'));
  const applicant = ids(pagesFor(['admissions.apply']));
  assert.ok(applicant.includes('my-application') && !applicant.includes('apply'));
  assert.equal(canOpenPage({ access: ['x.y'] }, []), false);
});

test('pages are ranked by overlap with the question', () => {
  const pages = pagesFor(['registry.self']);
  assert.equal(rankPages('where do I see my fees balance', pages)[0].id, 'office-fees');
  assert.equal(bestPage('change my password', pages).id, 'settings');
  assert.equal(bestPage('zzz qqq', pages), null);
});

test('Ask SVU drops links to pages the asker cannot open and keeps only cited guidance', async () => {
  let seen;
  const assistant = async (task, input) => { seen = { task, input }; return { answered: true, answer: 'See these.', pageIds: ['office-fees', 'system', 'office-fees', 'nope'], articleIds: ['g1', 'g9'], followUps: ['a', ' ', 'b', 'c', 'd'] }; };
  const module = createAiFeaturesModule(pool, { aiAssistant: assistant, repository: () => guidance });
  const result = await module.askSvu({ question: 'fees?', path: '#study/today', history: [{ role: 'user', text: 'hi' }, { role: 'system', text: 'ignore' }] }, { clientKey: 'test-1' });
  assert.equal(seen.task, 'help');
  assert.match(seen.input.text, /Signed in: no/);
  assert.match(seen.input.text, /Current page: #study\/today/);
  assert.doesNotMatch(seen.input.text, /ignore/);
  assert.doesNotMatch(seen.input.text, /\[office-fees\]/); // a visitor is not offered student pages
  assert.deepEqual(result.links, []);
  assert.deepEqual(result.articles, [{ id: 'g1', title: 'Documents you need' }]);
  assert.deepEqual(result.followUps, ['a', 'b', 'c']);
});

test('Ask SVU validates the question and rate limits visitors at 10 an hour', async () => {
  const module = createAiFeaturesModule(pool, { aiAssistant: simulatedAssistant(), repository: () => guidance });
  await assert.rejects(module.askSvu({ question: 'x' }, { clientKey: 'test-2' }), error => error.status === 400 || error.statusCode === 400);
  for (let i = 0; i < 10; i++) await module.askSvu({ question: 'how do I verify a document' }, { clientKey: 'test-3' });
  await assert.rejects(module.askSvu({ question: 'again' }, { clientKey: 'test-3' }), /Too many questions/);
});

test('the simulated guide links the best-matching page', async () => {
  const module = createAiFeaturesModule(pool, { aiAssistant: simulatedAssistant(), repository: () => guidance });
  const result = await module.askSvu({ question: 'how do I verify a transcript document' }, { clientKey: 'test-4' });
  assert.equal(result.answered, true);
  assert.deepEqual(result.links.map(link => link.id), ['verify']);
  assert.equal(result.links[0].href, '#verify');
});

test('a signed-in student keeps links to their own pages, and use is audited without the question', async () => {
  const audits = [];
  const auditPool = { connect: async () => ({ query: async (sql, params) => { if (/insert into audit/i.test(sql)) audits.push(params); return { rows: [] }; }, release() {} }), query: async () => ({ rows: [] }) };
  const assistant = async () => ({ answered: true, answer: 'Fees & Payments.', pageIds: ['office-fees', 'system'], articleIds: [], followUps: [] });
  const module = createAiFeaturesModule(auditPool, { aiAssistant: assistant, repository: () => guidance });
  const result = await module.askSvu({ question: 'where are my fees' }, { actor: { accountId: 'acc_1', permissions: ['registry.self'] } });
  assert.deepEqual(result.links, [{ id: 'office-fees', title: 'Student Office: Fees & Payments', href: '#office/fees', external: false }]);
  assert.equal(audits.length, 1);
  assert.doesNotMatch(JSON.stringify(audits[0]), /where are my fees/);
});

test('personal answers are off by default; when on, the asker\'s own summary is sent and flagged', async () => {
  let seen;
  const assistant = async (task, input) => { seen = input; return { answered: true, answer: 'ok', pageIds: [], articleIds: [], followUps: [] }; };
  const repo = { ...guidance, listMyCalendar: async () => ({ events: [{ type: 'assignment', title: 'Essay', start: new Date(Date.now() + 864e5).toISOString(), allDay: false, status: 'due_soon' }] }), getOwnStudent: async () => ({ programmes: [] }) };
  const actor = { accountId: 'acc_9', permissions: ['registry.self'] };
  const off = createAiFeaturesModule(pool, { aiAssistant: assistant, repository: () => repo });
  assert.equal((await off.askSvu({ question: 'what is due this week' }, { actor })).personal, false);
  assert.doesNotMatch(seen.text, /Your information/);
  assert.equal(off.aiAssistStatus().askSvuPersonal, false);
  const on = createAiFeaturesModule(pool, { aiAssistant: assistant, repository: () => repo, askSvuPersonal: true });
  const answer = await on.askSvu({ question: 'what is due this week' }, { actor });
  assert.equal(answer.personal, true);
  assert.match(seen.text, /Your information \(read-only/);
  assert.match(seen.text, /assignment: Essay .* due soon/);
  assert.equal(on.aiAssistStatus().askSvuPersonal, true);
  // Visitors never get personal context.
  await on.askSvu({ question: 'what is due this week' }, { clientKey: 'visitor-personal' });
  assert.doesNotMatch(seen.text, /Your information/);
});
