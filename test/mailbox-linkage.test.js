import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionsModule } from '../server/modules/admissions.js';
import { createStaffModule } from '../server/modules/staff.js';

function fixture(rows) {
  const calls = [];
  const client = { release() {}, async query(sql, args) {
    calls.push({ sql, args });
    if (['begin','commit','rollback'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('count(*)::int as count')) return { rows: [{ count: 0 }], rowCount: 1 };
    if (sql.startsWith('select 1 from staff_members')) return { rows: [], rowCount: 0 };
    if (sql.includes('from accounts')) return { rows, rowCount: rows.length };
    assert.fail(`Unexpected account-specific operation: ${sql}`);
  } };
  return { calls, pool: { async connect() { return client; } } };
}

test('registration returns generic acceptance for all-status canonical ambiguity without choosing or writing an identity', async () => {
  let accepted;
  for (const status of ['active','suspended','invited']) {
    const f = fixture([{ id: 'a', status: 'active' }, { id: 'b', status }]);
    const result = await createAdmissionsModule(f.pool).registerApplicant({ email: ' Fixture@Example.com ', preferredName: 'Fixture', legalName: 'Fixture Person' });
    accepted ??= result;
    assert.deepEqual(result, accepted);
    const lookup = f.calls.find(c => c.sql.includes('from accounts'));
    assert.match(lookup.sql, /lower\(btrim\(email\)\) = \$1 limit 2/);
    assert.deepEqual(lookup.args, ['fixture@example.com']);
    assert.ok(f.calls.find(c => c.args?.[0] === 'account-mailbox:fixture@example.com'));
    assert.equal(f.calls.at(-1).sql, 'commit');
    assert.ok(!f.calls.some(c => /\b(insert|update|delete)\b/.test(c.sql)));
  }
});

test('staff canonical ambiguity rolls back before references, invitations, grants or notifications', async () => {
  const input = { email: ' Fixture@Example.com ', legalName: 'Fixture Person', preferredName: 'Fixture', category: 'LECTURER', grade: 'L1', departmentId: 'dept_computing', roleCode: 'lecturer', engagedOn: '2026-01-15', reason: 'Approved fixture', linkExistingAccount: true };
  const actor = { accountId: 'admin', roles: [{ code: 'system_administrator', scope: {}, permissions: ['staff.manage'] }] };
  for (const status of ['active','suspended','invited']) {
    const f = fixture([{ id: 'a', status: 'active' }, { id: 'b', status }]);
    await assert.rejects(createStaffModule(f.pool).createStaffMember(input, actor), { statusCode: 409, message: 'Account identity is ambiguous; resolve it before offering an appointment.' });
    assert.match(f.calls.find(c => c.sql.includes('from accounts')).sql, /lower\(btrim\(email\)\) = \$1 limit 2/);
    assert.ok(f.calls.find(c => c.args?.[0] === 'account-mailbox:fixture@example.com'));
    assert.equal(f.calls.at(-1).sql, 'rollback');
    assert.ok(!f.calls.some(c => /\b(insert|update|delete)\b/.test(c.sql)));
  }
});
