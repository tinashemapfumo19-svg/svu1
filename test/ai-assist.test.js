import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { aiAssistModel, aiTasks, anthropicAssistant, loadAiAssistConfig, simulatedAssistant } from '../server/ai-assist.js';
import { allowPublicQuestion, createAiFeaturesModule, supportReasons } from '../server/modules/ai-features.js';

test('AI assistance is disabled by default and the simulated provider is development-only', () => {
  assert.deepEqual(loadAiAssistConfig({}), { provider: 'disabled' });
  assert.deepEqual(loadAiAssistConfig({ SVU_AI_ASSIST: 'anthropic' }), { provider: 'anthropic' });
  assert.equal(loadAiAssistConfig({ SVU_AI_ASSIST: 'simulated', SVU_ENV: 'development' }).provider, 'simulated');
  assert.throws(() => loadAiAssistConfig({ SVU_AI_ASSIST: 'simulated', SVU_ENV: 'production' }), /only available in development/);
  assert.throws(() => loadAiAssistConfig({ SVU_AI_ASSIST: 'openai' }), /disabled, anthropic or simulated/);
});

test('every task schema closes its objects, as structured outputs require', () => {
  for (const [name, task] of Object.entries(aiTasks)) {
    assert.equal(task.schema.additionalProperties, false, name);
    assert.deepEqual([...task.schema.required].sort(), Object.keys(task.schema.properties).sort(), name);
    assert.ok(['low', 'medium'].includes(task.effort), name);
  }
});

const reply = (output, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], ...extra });
test('the Claude assistant sends a fixed system prompt, structured output and refusal fallbacks', async () => {
  let request;
  const client = { beta: { messages: { create: async body => { request = body; return reply({ summary: 'ok', nextSteps: [] }); } } } };
  const result = await anthropicAssistant({ client })('record_explanation', { text: 'record', documents: [{ type: 'text', text: 'doc' }] });
  assert.deepEqual(result, { summary: 'ok', nextSteps: [] });
  assert.equal(request.model, aiAssistModel);
  assert.equal(request.model, 'claude-opus-5-5');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(request.fallbacks, 'default');
  assert.equal(request.system, aiTasks.record_explanation.system);
  assert.deepEqual(request.output_config, { effort: 'low', format: { type: 'json_schema', schema: aiTasks.record_explanation.schema } });
  assert.deepEqual(request.messages, [{ role: 'user', content: [{ type: 'text', text: 'doc' }, { type: 'text', text: 'record' }] }]);
  assert.equal('thinking' in request, false);
});

test('refusals, truncation, bad output and provider errors become clear failures', async () => {
  const withResponse = response => anthropicAssistant({ client: { beta: { messages: { create: async () => response } } } })('feedback', { text: 'x' });
  await assert.rejects(withResponse({ stop_reason: 'refusal', content: [] }), { aiCode: 'REFUSED' });
  await assert.rejects(withResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"feed' }] }), { aiCode: 'INCOMPLETE' });
  await assert.rejects(withResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), { aiCode: 'INVALID_OUTPUT' });
  const throwing = error => anthropicAssistant({ client: { beta: { messages: { create: async () => { throw error; } } } } })('feedback', { text: 'x' });
  await assert.rejects(throwing(Object.create(Anthropic.RateLimitError.prototype)), { aiCode: 'RATE_LIMITED' });
  await assert.rejects(throwing(Object.create(Anthropic.AuthenticationError.prototype)), { aiCode: 'NOT_CONFIGURED' });
  await assert.rejects(throwing(new Error('socket hang up')), { aiCode: 'PROVIDER_UNAVAILABLE' });
});

test('simulated output is labelled and every task has one', async () => {
  const assistant = simulatedAssistant();
  for (const name of Object.keys(aiTasks)) {
    const output = await assistant(name, { meta: { documentType: 'national_id' } });
    for (const key of aiTasks[name].schema.required) assert.ok(key in output, `${name}.${key}`);
  }
  assert.match((await assistant('feedback', {})).feedback, /^\[Simulated draft\]/);
});

test('early-warning reasons follow the published rules', () => {
  assert.deepEqual(supportReasons({}), []);
  assert.deepEqual(supportReasons({ missingSubmissions: 1, averageMark: 50 }), []);
  assert.deepEqual(supportReasons({ missingSubmissions: 2, averageMark: 42.4, held: true, waitingSupport: 1, unregistered: true }).map(reason => reason.code),
    ['missing_work', 'low_marks', 'financial_hold', 'support_waiting', 'not_registered']);
});

test('public questions are limited to ten per hour per connection', () => {
  const key = `test-${Math.random()}`, start = 1_000_000;
  for (let index = 0; index < 10; index++) assert.equal(allowPublicQuestion(key, start + index), true);
  assert.equal(allowPublicQuestion(key, start + 20), false);
  assert.equal(allowPublicQuestion(key, start + 3600001), true);
});

test('assistive features refuse to run when assistance is disabled', async () => {
  const module = createAiFeaturesModule({ query: async () => ({ rows: [] }) }, { aiAssistant: null });
  assert.deepEqual(module.aiAssistStatus(), { enabled: false, askSvuPersonal: false });
  await assert.rejects(module.askAdmissionsGuidance({ question: 'What do I need?' }, '127.0.0.1'), { statusCode: 409 });
  await assert.rejects(module.explainMyAcademicRecord('p', { accountId: 'a', permissions: ['registry.self'] }), { statusCode: 409 });
  await assert.rejects(module.listStudentsNeedingSupport({ accountId: 'a', permissions: [] }), { statusCode: 403 });
});
