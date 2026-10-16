import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { actorCanAccessScope } from '../server/support.js';

function repository(policy, session) {
  const queries = [];
  const pool = { async query(sql) {
    queries.push(sql);
    if (sql.includes('from sessions s')) return { rows: [{
      id: 'ses_current', account_id: 'acc_current', email: 'current@example.com',
      status: 'active', assurance: 'password', hasFactor: false, privileged: false,
      roles: [{ code: 'system_administrator', scope: {}, permissions: ['identity.manage'] }], ...session
    }] };
    throw new Error('Unexpected second principal query');
  } };
  return { core: createRepository(pool, { mfaPolicy: policy }), queries };
}

test('enrolment blocks pre-existing password sessions before loading permissions', async () => {
  const { core, queries } = repository('enrolled', { hasFactor: true });
  await assert.rejects(core.requirePermission('token', 'identity.manage'), { statusCode: 401 });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /from mfa_factors/);
  assert.match(queries[0], /r\.risk in \('critical', 'high'\)/);
  assert.match(queries[0], /ra\.effective_from <= current_date/);
  assert.match(queries[0], /ra\.effective_to >= current_date/);
  assert.match(queries[0], /r\.code = ra\.role_code and r\.active/);
  assert.match(queries[0], /ra\.ended_at is null/);
});

test('current privileged policy blocks active password sessions without a factor', async () => {
  const { core, queries } = repository('privileged', { privileged: true });
  await assert.rejects(core.authenticateSession('token'), { statusCode: 401 });
  assert.equal(queries.length, 1);
});

test('current policy preserves low-risk unenrolled sessions and explicit off policy', async () => {
  for (const [policy, session] of [
    ['enrolled', { privileged: true }], ['privileged', {}],
    ['off', { privileged: true, hasFactor: true }]
  ]) {
    const { core } = repository(policy, session);
    assert.equal((await core.authenticateSession('token')).assurance, 'password');
  }
});

test('verified sessions and valid partial challenges retain their existing access boundaries', async () => {
  const verified = repository('privileged', { hasFactor: true, privileged: true, assurance: 'mfa' }).core;
  assert.equal((await verified.requirePermission('token', 'identity.manage')).assurance, 'mfa');
  for (const [status, session] of [
    ['mfa_pending', { hasFactor: true }], ['mfa_enrolment_required', { privileged: true }]
  ]) {
    const { core } = repository('privileged', { ...session, status });
    await assert.rejects(core.authenticateSession('token'), { statusCode: 401 });
    assert.equal((await core.authenticateSession('token', { allowStatuses: [status] })).sessionStatus, status);
  }
});

test('an enrolment challenge cannot remain authorized after another session activates a factor', async () => {
  const { core } = repository('privileged', { hasFactor: true, privileged: true, status: 'mfa_enrolment_required' });
  await assert.rejects(core.authenticateSession('token', { allowStatuses: ['active', 'mfa_enrolment_required'] }), { statusCode: 401 });
});

test('one principal snapshot supplies deduplicated permissions and permission-specific scopes', async () => {
  const roles = [
    { code: 'officer', scope: { programmeCodes: ['A'] }, permissions: ['access.assign_role', 'messages.self'] },
    { code: 'auditor', scope: {}, permissions: ['audit.view', 'messages.self'] },
    { code: 'empty', scope: {}, permissions: [] }
  ];
  const { core, queries } = repository('privileged', { roles });
  const actor = await core.requirePermission('token', 'access.assign_role');
  assert.equal(queries.length, 1);
  assert.match(queries[0], /cross join lateral/);
  assert.deepEqual(actor.permissions, ['access.assign_role', 'audit.view', 'messages.self']);
  assert.deepEqual(actor.roles, roles);
  assert.equal(actorCanAccessScope(actor, { programmeCode: 'A' }), true);
  assert.equal(actorCanAccessScope(actor, { programmeCode: 'B' }), false);
});

test('no qualifying grants preserve authenticated self access but grant no protected capability', async () => {
  const { core, queries } = repository('privileged', { roles: [] });
  assert.deepEqual((await core.authenticateSession('token')).permissions, []);
  await assert.rejects(core.requirePermission('token', 'identity.manage'), { statusCode: 403 });
  assert.equal(queries.length, 2);
});

test('missing tokens and invalid session states cannot project authority', async () => {
  const { core, queries } = repository('off', { status: 'revoked' });
  await assert.rejects(core.authenticateSession(''), { statusCode: 401 });
  assert.equal(queries.length, 0);
  await assert.rejects(core.authenticateSession('token'), { statusCode: 401 });
  assert.equal(queries.length, 1);
});
