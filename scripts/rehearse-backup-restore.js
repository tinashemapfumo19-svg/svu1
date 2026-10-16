import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { recoveryTarget,captureRecoveryTables,captureRecoveryTableDefinitions,compareRecoveryTables,schemaDigest,schemaDifferenceNames,withOwnedRecoveryDatabase } from './recovery-verification.js';

const evidencePath = new URL('../docs/phase-1/BACKUP_RESTORE_EVIDENCE.generated.json',import.meta.url);
const evidence = {version:'full-database-recovery-v1',startedAt:new Date().toISOString(),checks:[]};
let source,admin;
const record = (id,details = {}) => evidence.checks.push({id,status:'passed',details});

try {
  const config = loadConfig();
  if (config.env !== 'development') throw new Error('Local recovery rehearsal is development-only.');
  const sourceUrl = new URL(config.databaseUrl),sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(sourceDatabase)) throw new Error('Invalid local source database identifier.');
  if (process.env.SVU_DATABASE_NAME && process.env.SVU_DATABASE_NAME !== sourceDatabase) throw new Error('Source database override differs from the configured connection.');
  const target = recoveryTarget(sourceDatabase,process.env.SVU_RESTORE_DATABASE_NAME);
  const container = process.env.SVU_POSTGRES_CONTAINER || 'svu-postgres',user = process.env.SVU_DATABASE_USER || 'postgres';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(user)) throw new Error('Invalid PostgreSQL container or user.');
  evidence.sourceDatabase = sourceDatabase;evidence.rehearsalDatabase = target;
  const adminUrl = new URL(sourceUrl);adminUrl.pathname = '/postgres';
  source = new pg.Client({connectionString:sourceUrl.href});admin = new pg.Client({connectionString:adminUrl.href});
  await source.connect();await admin.connect();
  const identity = (await admin.query('select system_identifier::text as id from pg_control_system()')).rows[0].id;
  const containerIdentity = await run('docker',['exec',container,'psql','--no-password','-X','-U',user,'-d','postgres','-t','-A','-v','ON_ERROR_STOP=1','-c','select system_identifier::text from pg_control_system()']);
  if (containerIdentity.toString('utf8').trim() !== identity) throw new Error('Docker tools and configured connection refer to different PostgreSQL clusters.');
  record('source_tool_cluster_verified');
  await source.query('begin isolation level repeatable read read only');
  await source.query("set local timezone = 'UTC'");
  const snapshot = (await source.query('select pg_export_snapshot() as snapshot')).rows[0].snapshot;
  const before = await captureRecoveryTables(source);
  const sourceTables = await captureRecoveryTableDefinitions(source);
  const dumpArgs = ['exec',container,'pg_dump','--no-password','-U',user,'--dbname',sourceDatabase,`--snapshot=${snapshot}`];
  const schema = await run('docker',[...dumpArgs,'--schema-only']);
  const dump = await run('docker',[...dumpArgs,'--format=custom']);
  record('snapshot_dump_created',{bytes:dump.length,digest:createHash('sha256').update(dump).digest('hex'),schemaDigest:schemaDigest(schema.toString('utf8'),sourceTables),relations:before.length});
  await source.query('rollback');

  await withOwnedRecoveryDatabase(admin,target,async () => {
    record('unique_rehearsal_database_created');
    // No --clean/--create: restore only into our newly created empty target.
    await run('docker',['exec','-i',container,'pg_restore','--no-password','-U',user,'--dbname',target,'--exit-on-error','--single-transaction'],dump);
    record('dump_restored');
    const targetUrl = new URL(sourceUrl);targetUrl.pathname = `/${target}`;
    const restored = new pg.Client({connectionString:targetUrl.href});
    try {
      await restored.connect();await restored.query('begin isolation level repeatable read read only');await restored.query("set local timezone = 'UTC'");
      const after = await captureRecoveryTables(restored),comparison = compareRecoveryTables(before,after);
      const restoredTables = await captureRecoveryTableDefinitions(restored);
      const restoredSchema = await run('docker',['exec',container,'pg_dump','--no-password','-U',user,'--dbname',target,'--schema-only']);
      if (schemaDigest(schema.toString('utf8'),sourceTables) !== schemaDigest(restoredSchema.toString('utf8'),restoredTables)) {
        evidence.schemaDifferenceFields = sourceTables.flatMap((row) => {const next=restoredTables.find((t) => t.schema===row.schema && t.name===row.name);return Object.keys(row).filter((key) => JSON.stringify(row[key])!==JSON.stringify(next?.[key])).map((key) => `${row.schema}.${row.name}.${key}`);});
        evidence.constraintDifferenceFields = sourceTables.flatMap((row) => {const next=restoredTables.find((t) => t.schema===row.schema && t.name===row.name);return row.checks.flatMap((check) => {const other=next?.checks.find((k) => k.name===check.name);return Object.keys(check).filter((key) => JSON.stringify(check[key])!==JSON.stringify(other?.[key])).map((key) => `${row.name}.${check.name}.${key}`);});});
        throw new Error(`Restored schema definitions differ from source: ${schemaDifferenceNames(schema.toString('utf8'),restoredSchema.toString('utf8'),sourceTables,restoredTables).join(' | ') || 'object ordering or preamble'}.`);
      }
      if (comparison.status !== 'passed') throw new Error(`Restored relation contents differ: ${comparison.changed.join(', ')}.`);
      record('full_schema_and_content_verified',comparison);
      await restored.query('rollback');
    } finally {await restored.end();}
  });
  const remaining = (await admin.query('select datname from pg_database where datname = $1',[target])).rows;
  if (remaining.length) throw new Error('Owned recovery target remains after cleanup.');
  record('owned_rehearsal_database_removed');
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  // Do not persist row values, URLs, credentials, archive bytes or tool stderr.
  evidence.error = error.code ? `Recovery database/tool operation failed (${error.code}).` : error.message;
  process.exitCode = 1;
} finally {
  await source?.end().catch(() => {});await admin?.end().catch(() => {});
  evidence.completedAt = new Date().toISOString();
  await mkdir(new URL('../docs/phase-1/',import.meta.url),{recursive:true});
  await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`,'utf8');
  console.log(JSON.stringify(evidence,null,2));
}

function run(command,args,input) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{stdio:['pipe','pipe','pipe']});
    const chunks = [];let bytes = 0,failure;
    child.stdout.on('data',(chunk) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024 * 1024) {failure = new Error('Recovery tool output exceeds the 256 MiB development limit.');child.kill();}
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error',reject);
    child.stdin.on('error',(error) => {failure = new Error(`Recovery tool input failed (${error.code || 'unknown'}).`);});
    child.on('close',(code) => code === 0 && !failure ? resolve(Buffer.concat(chunks)) : reject(failure || new Error(`Recovery tool ${args.includes('pg_restore') ? 'restore' : 'dump'} failed (${code}).`)));
    child.stdin.end(input);
  });
}
