import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { createRepository } from '../server/repository.js';
import { decryptSecret } from '../server/security.js';

const config = loadConfig(), url = new URL(config.databaseUrl);
const { name } = JSON.parse(readFileSync('data/legacy-cutover/rehearsal-database.json'));
if (!/^svu_legacy_rehearsal_[a-f0-9]{32}$/.test(name)) throw Error('Invalid owned rehearsal database.');
url.pathname = '/' + name;
const pool = new pg.Pool({ connectionString: url.href });
const checks = [];
try {
  const imported = (await pool.query('select * from legacy_imports')).rows[0];
  assert.equal(imported.report.sourceRows, 94988);
  const key = readFileSync('data/legacy-cutover/archive-key.bin');
  const credentials = (await pool.query(`select r.source_table,r.source_row,r.payload_encrypted,r.target_id,a.password_hash,a.password_salt
    from legacy_source_rows r left join accounts a on a.id=r.target_id
    where r.source_table in ('student_pro','svu_sl','users') order by r.source_table,r.source_row`)).rows;
  let matched = 0;
  for (const r of credentials) {
    const source = JSON.parse(decryptSecret(r.payload_encrypted, key));
    const password = r.source_table === 'student_pro' ? source.key_id : r.source_table === 'svu_sl' ? source.authid : source.pass;
    if (password) { assert.equal(r.password_hash, password); matched++; }
  }
  assert.equal(matched, 945); checks.push('All 945 source password hashes retained exactly');
  assert.equal((await pool.query('select count(*)::int as n from accounts where legacy_source_ref is null')).rows[0].n, 0);
  checks.push('All operational account rows originate from the supplied SQL');
  const permissionRows = (await pool.query("select permission_code from role_permissions where role_code='system_administrator'")).rows;
  const permissions = permissionRows.map(r => r.permission_code);
  const actor = { accountId: 'rehearsal-verification', permissions, roles: [{code:'system_administrator',scope:{},permissions}] };
  const repo = createRepository(pool, {mfaPolicy:'enrolled',dataEncryptionKey:config.dataEncryptionKey});
  const registry = await repo.listRegistryStudents({}, actor);
  assert.equal(registry.total, 849);
  const programme = await repo.getRegistryProgramme(registry.items[0].id, actor);
  assert.ok(programme.legacySourceStatus); assert.equal(programme.studyYear.history.length, 0);
  assert.equal((await repo.listProgrammes()).length, 48);
  assert.equal((await repo.listReviewQueue(actor, { includeClosed:true,limit:1 })).length, 1);
  checks.push('Registry, programme catalogue and historical admissions read through the application repository');

  // Controlled test identities exist only in the owned disposable rehearsal database.
  const marker = randomUUID(), personId = 'verify_person_' + marker, accountId = 'verify_account_' + marker;
  const alias = 'verify_legacy_' + marker, password = 'Continuity-Fixture-2026!';
  await pool.query("insert into people(id,preferred_name,legal_name,status) values($1,'Verification','Verification','active')",[personId]);
  await pool.query("insert into accounts(id,person_id,email,status,password_hash,password_salt,legacy_source_ref) values($1,$2,null,'active',$3,'legacy-md5',$4)",
    [accountId,personId,createHash('md5').update(password).digest('hex'),'verification:'+marker]);
  await pool.query('insert into legacy_login_aliases(alias,account_id) values($1,$2)',[alias,accountId]);
  const session = await repo.createSession({email:alias,password});
  assert.equal(session.account.id,accountId);
  assert.equal((await repo.authenticateSession(session.token)).accountId,accountId);
  await assert.rejects(repo.createSession({email:alias,password:'incorrect'}),{statusCode:401});
  const second = 'verify_other_' + marker;
  await pool.query("insert into accounts(id,person_id,email,status,legacy_source_ref) values($1,$2,null,'active',$3)",[second,personId,'verification-other:'+marker]);
  await pool.query('insert into legacy_login_aliases(alias,account_id) values($1,$2)',[alias,second]);
  await assert.rejects(repo.createSession({email:alias,password}),{statusCode:401});
  checks.push('Legacy username login, session authentication, wrong-password rejection and ambiguous-alias rejection');
  writeFileSync('data/legacy-cutover/verification.json',JSON.stringify({passed:true,database:name,checks},null,2));
  console.log(JSON.stringify({passed:true,checks}));
} finally { await pool.end(); }
