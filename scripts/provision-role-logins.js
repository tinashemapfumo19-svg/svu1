import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { hashSecret } from '../server/security.js';
import { insertAudit } from '../server/support.js';

// Supply the user-selected password through stdin; never persist it in scripts or reports.
const password = readFileSync(0, 'utf8').trimEnd();
if (!password || password.length > 256) throw Error('Provide the role-login password through stdin.');
const db = new pg.Client({ connectionString: loadConfig().databaseUrl });
const identity = (kind, role) => `role_login_${kind}_${createHash('sha256').update(role).digest('hex').slice(0, 24)}`;
try {
  await db.connect();
  await db.query('begin');
  await db.query("select pg_advisory_xact_lock(hashtext('svu:role-login-provisioning'))");
  const roles = (await db.query(`select r.code,r.name,count(rp.permission_code)::int as permissions
    from roles r left join role_permissions rp on rp.role_code=r.code where r.active
    group by r.code,r.name order by r.name`)).rows;
  const result = [];
  for (const role of roles) {
    const existing = (await db.query('select account_id,login_alias from role_login_accounts where role_code=$1', [role.code])).rows[0];
    const accountId = existing?.account_id || identity('account', role.code);
    const alias = existing?.login_alias || `role.${role.code}`;
    if ((await db.query('select 1 from legacy_login_aliases where alias=$1 and account_id<>$2', [alias, accountId])).rowCount) throw Error('A requested role login conflicts with an existing login.');
    if (!existing) {
      const personId = identity('person', role.code), secret = await hashSecret(password);
      const personas = role.code === 'student' ? ['student'] : role.code === 'applicant' ? ['applicant'] : ['staff'];
      await db.query("insert into people(id,legal_name,preferred_name,personas,status) values($1,$2,$2,$3,'active')", [personId, role.name + ' Login', JSON.stringify(personas)]);
      await db.query(`insert into accounts(id,person_id,email,status,password_hash,password_salt,password_set_at,provisioning_source)
        values($1,$2,null,'active',$3,$4,now(),'role_login')`, [accountId, personId, secret.hash, secret.salt]);
      await db.query('insert into legacy_login_aliases(alias,account_id) values($1,$2)', [alias, accountId]);
      await db.query('insert into role_login_accounts(role_code,account_id,login_alias) values($1,$2,$3)', [role.code, accountId, alias]);
      await db.query(`insert into role_assignments(id,account_id,role_code,scope,effective_from,granted_by,reason)
        values($1,$2,$3,'{}',current_date,'user_requested_role_logins','User requested a separate login with only this role permissions')`, [identity('assignment', role.code), accountId, role.code]);
    }
    const assignments = (await db.query(`select role_code from role_assignments where account_id=$1 and ended_at is null
      and effective_from<=current_date and (effective_to is null or effective_to>=current_date)`, [accountId])).rows;
    if (assignments.length !== 1 || assignments[0].role_code !== role.code) throw Error('A managed role login has additional or missing role grants.');
    result.push({ roleCode: role.code, roleName: role.name, username: alias, accountId, permissions: role.permissions, created: !existing });
  }
  await insertAudit(db, { actorId: 'user_requested_role_logins', action: 'identity.role_logins.provisioned', subjectType: 'RoleLoginPopulation', subjectId: 'active_roles',
    reason: 'User clarified: separate logins for every role, each restricted to that role permissions', metadata: { roleCount: result.length, newAccounts: result.filter(r => r.created).length, existingAccountsUnchanged: true } });
  await db.query('commit');
  writeFileSync('data/legacy-cutover/role-login-accounts.json', JSON.stringify({ applied: true, accounts: result }, null, 2));
  const lines = ['# Role logins', '', 'One separate account per active role, restricted to that role permissions. Use the password supplied in the conversation. Passwords are stored as salted scrypt hashes, not in this list.', '',
    'These accounts have no invented student enrolments, employment records, teaching allocations, shared-record invitations or consent. Self-service screens show records only after the relevant account is linked through the appropriate workflow.', '',
    '| Role | Username | Permissions |', '| --- | --- | ---: |', ...result.map(r => `| ${r.roleName} | \`${r.username}\` | ${r.permissions} |`), '',
    'Jerry retains full master access. The earlier master grants on existing imported accounts were not changed by creating these separate role accounts.', ''];
  writeFileSync('docs/ROLE_LOGINS.md', lines.join('\n'));
  console.log(JSON.stringify({ applied: true, roleLogins: result.length, newAccounts: result.filter(r => r.created).length, onlyAssignedRoleVerified: true }));
} catch (error) {
  await db.query('rollback').catch(() => {});
  console.error(JSON.stringify({ applied: false, code: error.code || 'validation', reason: error.code ? 'Database operation refused' : error.message }));
  process.exitCode = 1;
} finally { await db.end(); }
