import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { assertDevelopmentSeed,databaseSeedTarget } from './development-seed-safety.js';
import { withOwnedRecoveryDatabase } from './recovery-verification.js';

assertDevelopmentSeed();
const source = new URL(loadConfig().databaseUrl),target = `svu_restore_seed_${randomUUID().replaceAll('-','')}`;
const targetUrl = new URL(source);targetUrl.pathname=`/${target}`;
databaseSeedTarget(targetUrl.href,['--reset-database',target]);
const adminUrl=new URL(source);adminUrl.pathname='/postgres';
const admin=new pg.Client({connectionString:adminUrl.href});
const env={...process.env,DATABASE_URL:targetUrl.href,SVU_ENV:'development',NODE_ENV:'development'};
const evidence={target,checks:[],status:'failed'};
const record=(name) => evidence.checks.push(name);
const run=(file,args=[],extra={}) => spawnSync(process.execPath,[file,...args],{env:{...env,...extra},encoding:'utf8'});
const expectStatus=(result,status,name) => {if(result.status!==status)throw new Error(`${name}: unexpected child exit status ${result.status}.`);record(name);};
let connected=false;
try {
  await admin.connect();connected=true;
  await withOwnedRecoveryDatabase(admin,target,async () => {
    expectStatus(run('scripts/migrate.js'),0,'isolated migration');
    expectStatus(run('scripts/seed-postgres.js',['--reset-database',target]),0,'acknowledged first seed');
    const client=new pg.Client({connectionString:targetUrl.href});
    try {
      await client.connect();
      await client.query("update people set preferred_name='SAMPLE SEED SAFETY SENTINEL' where id='person_system_admin'");
      const retained=async () => (await client.query("select preferred_name from people where id='person_system_admin'")).rows[0]?.preferred_name === 'SAMPLE SEED SAFETY SENTINEL';
      for(const [args,extra,name] of [
        [[],{},'missing acknowledgement refused'],
        [['--reset-database','wrong'],{},'wrong acknowledgement refused'],
        [['--reset-database',target],{SVU_ENV:'production',NODE_ENV:'production'},'production seed refused'],
        [['--reset-database',target],{SVU_ENV:'development',NODE_ENV:'production'},'conflicting production mode refused']
      ]) {
        expectStatus(run('scripts/seed-postgres.js',args,extra),1,name);
        if(!await retained())throw new Error(`${name}: isolated sentinel changed.`);
      }
      record('all refusals retain actual database rows');
      expectStatus(run('scripts/seed-postgres.js',['--reset-database',target]),0,'acknowledged disposable reset');
      if(await retained())throw new Error('Acknowledged reset did not replace the isolated demo fixture.');
      if(!(await client.query("select 1 from accounts where email='admin@southvalley.test' and password_hash is not null")).rowCount)throw new Error('Demo bootstrap account missing after isolated reset.');
      record('explicit reset restores demo bootstrap');
    } finally {await client.end();}
  });
  if((await admin.query('select 1 from pg_database where datname=$1',[target])).rowCount)throw new Error('Owned seed verification database remains.');
  record('owned verification database removed');evidence.status='passed';
}catch(error){evidence.error=error.code ? `Database operation failed (${error.code}).` : error.message;process.exitCode=1;}
finally {if(connected)await admin.end();console.log(JSON.stringify(evidence,null,2));}
