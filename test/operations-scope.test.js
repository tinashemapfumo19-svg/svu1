import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowModule } from '../server/modules/workflow.js';
import { createRepository } from '../server/repository.js';

const actor = permission => ({ accountId: 'officer', authorizingPermission: permission, roles: [
  { code: 'officer', scope: { programmeCodes: ['BSC-IS'], intakeIds: ['intake_a'] }, permissions: ['workflow.transition', 'task.assign'] },
  { code: 'auditor', scope: {}, permissions: ['audit.view'] }
] });
const rows = [
  { id: 'own', workflowInstanceId: 'wf_own', scopeId: 'scope_own', programmeCode: 'BSC-IS', intakeId: 'intake_a' },
  { id: 'other', workflowInstanceId: 'wf_other', scopeId: 'scope_other', programmeCode: 'BCOM', intakeId: 'intake_b' },
  { id: 'unbound', workflowInstanceId: 'wf_unbound', scopeId: null, programmeCode: null, intakeId: null }
];
test('workflow queue uses only scopes granting workflow authority and omits internal scope fields', async () => {
  const pool = { async query() { return { rows }; } };
  assert.deepEqual(await createWorkflowModule(pool).listWorkflowInstances(actor('workflow.transition')), [{ id: 'own', workflowInstanceId: 'wf_own' }]);
});
test('task queue filters bound scopes and retains standalone tasks under existing task authority', async () => {
  const pool = { async query() { return { rows: [...rows, { id: 'standalone', workflowInstanceId: null }] }; } };
  assert.deepEqual(await createRepository(pool).listTasks(actor('task.assign')), [
    { id: 'own', workflowInstanceId: 'wf_own' }, { id: 'standalone', workflowInstanceId: null }
  ]);
});
test('global workflow authority still excludes records missing the required subject scope', async () => {
  const pool = { async query() { return { rows }; } };
  const global = { authorizingPermission: 'workflow.transition', roles: [{ code: 'global', scope: {}, permissions: ['workflow.transition'] }] };
  assert.deepEqual((await createWorkflowModule(pool).listWorkflowInstances(global)).map(row => row.id), ['own', 'other']);
});
