import test from 'node:test';
import assert from 'node:assert/strict';
import { aiCheckable, aiVerdict, gptzeroAdapter, loadAiCheckConfig, parseGptzeroResponse, simulatedAdapter } from '../server/ai-checker.js';
import { createCourseWorkspaceModule, validateCourseResource } from '../server/modules/course-workspace.js';

test('AI check configuration is disabled by default and validates provider, key and threshold', () => {
  assert.deepEqual(loadAiCheckConfig({}), { provider: 'disabled', threshold: 20 });
  assert.deepEqual(loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'gptzero', SVU_GPTZERO_API_KEY: 'key_123', SVU_AI_CHECK_THRESHOLD: '35.5' }), { provider: 'gptzero', apiKey: 'key_123', threshold: 35.5 });
  assert.equal(loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'simulated', SVU_ENV: 'development' }).provider, 'simulated');
  assert.throws(() => loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'other' }), /disabled, gptzero or simulated/);
  assert.throws(() => loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'simulated', SVU_ENV: 'production' }), /only available in development/);
  assert.throws(() => loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'gptzero' }), /SVU_GPTZERO_API_KEY/);
  assert.throws(() => loadAiCheckConfig({ SVU_AI_CHECK_PROVIDER: 'gptzero', SVU_GPTZERO_API_KEY: 'has space' }), /SVU_GPTZERO_API_KEY/);
  for (const value of ['-1', '100.01', '12.345', 'abc']) assert.throws(() => loadAiCheckConfig({ SVU_AI_CHECK_THRESHOLD: value }), /percentage/);
});

test('only text documents are checked and a score equal to the threshold is allowed', () => {
  for (const name of ['essay.pdf', 'essay.DOCX', 'notes.txt']) assert.equal(aiCheckable(name), true);
  for (const name of ['photo.png', 'slides.pptx', 'bundle.zip', 'sheet.xlsx']) assert.equal(aiCheckable(name), false);
  assert.equal(aiVerdict(20, 20).aboveThreshold, false);
  assert.equal(aiVerdict(20.01, 20).aboveThreshold, true);
});

test('GPTZero responses map class probabilities to percentages and reject malformed results', () => {
  const parsed = parseGptzeroResponse({ version: '2026-01-01-base', documents: [{ predicted_class: 'mixed', class_probabilities: { ai: 0.3412, human: 0.5, mixed: 0.1588 } }] });
  assert.deepEqual(parsed, { aiScore: 34.12, mixedScore: 15.88, humanScore: 50, predictedClass: 'mixed', providerVersion: '2026-01-01-base' });
  assert.equal(parseGptzeroResponse({ version: 'not a valid version!', documents: [{ predicted_class: 'robot', class_probabilities: { ai: 0, human: 1, mixed: 0 } }] }).predictedClass, null);
  for (const data of [{}, { documents: [] }, { documents: [{ class_probabilities: { ai: 1.2, human: 0, mixed: 0 } }] }, { documents: [{ class_probabilities: { ai: '0.5', human: 0.5, mixed: 0 } }] }])
    assert.throws(() => parseGptzeroResponse(data), { aiCode: 'INVALID_RESPONSE' });
});

test('the GPTZero adapter posts the file to the fixed endpoint with the API key and maps failures', async () => {
  let seen;
  const ok = async (url, options) => { seen = { url, options }; return { ok: true, status: 200, json: async () => ({ documents: [{ predicted_class: 'human', class_probabilities: { ai: 0.1, human: 0.9, mixed: 0 } }] }) }; };
  const result = await gptzeroAdapter({ apiKey: 'key_123' }, { fetchImpl: ok })({ bytes: Buffer.from('My essay'), fileName: 'essay.txt', contentType: 'text/plain' });
  assert.equal(result.aiScore, 10);
  assert.equal(seen.url, 'https://api.gptzero.me/v2/predict/files');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.headers['x-api-key'], 'key_123');
  const file = seen.options.body.get('files');
  assert.equal(file.name, 'essay.txt');
  assert.equal(await file.text(), 'My essay');
  const call = fetchImpl => gptzeroAdapter({ apiKey: 'k' }, { fetchImpl })({ bytes: Buffer.from('x'), fileName: 'a.txt', contentType: 'text/plain' });
  await assert.rejects(call(async () => { throw new Error('offline'); }), { aiCode: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(call(async () => ({ ok: false, status: 401, json: async () => ({ error: 'bad key' }) })), { aiCode: 'PROVIDER_HTTP_401' });
  await assert.rejects(call(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })), { aiCode: 'INVALID_RESPONSE' });
});

test('the simulated checker is deterministic and honours an explicit score marker', async () => {
  const check = simulatedAdapter();
  assert.equal((await check({ bytes: Buffer.from('Essay [[ai-score:42.5]] text') })).aiScore, 42.5);
  const first = await check({ bytes: Buffer.from('Same text') }), second = await check({ bytes: Buffer.from('Same text') });
  assert.deepEqual(first, second);
  assert.ok(first.aiScore >= 0 && first.aiScore <= 100);
});

test('assignments accept an optional allowable AI score and other resources ignore it', () => {
  const assignment = { kind: 'assignment', section: 'Assignments', title: 'Essay', description: '', url: '', status: 'published', pinned: false, allowLate: false, position: 0, sectionPosition: 0, dueAt: '2026-12-01T10:00:00+02:00' };
  assert.equal(validateCourseResource({ ...assignment, aiThreshold: 25 }).aiThreshold, 25);
  assert.equal(validateCourseResource({ ...assignment, aiThreshold: null }).aiThreshold, null);
  assert.equal(validateCourseResource({ ...assignment, kind: 'note', dueAt: null, aiThreshold: 25 }).aiThreshold, null);
  for (const aiThreshold of [-1, 101, 10.555, '20']) assert.throws(() => validateCourseResource({ ...assignment, aiThreshold }), { statusCode: 400 });
});

test('checks report disabled or unsupported files without touching the database or the provider', async () => {
  let queries = 0, calls = 0;
  const pool = { async query() { queries++; return { rows: [], rowCount: 0 }; } };
  const pdf = { fileName: 'essay.pdf', base64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') };
  assert.deepEqual(await createCourseWorkspaceModule(pool, { aiChecker: null }).checkCourseAssignmentAi('p', 'c', 'r', { file: pdf }, {}), { status: 'disabled' });
  const png = { fileName: 'photo.png', base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString('base64') };
  assert.deepEqual(await createCourseWorkspaceModule(pool, { aiChecker: async () => { calls++; } }).checkCourseAssignmentAi('p', 'c', 'r', { file: png }, {}), { status: 'unsupported' });
  assert.equal(queries, 0);
  assert.equal(calls, 0);
});
