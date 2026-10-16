import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../server/config.js';
import {decryptSecret} from '../server/security.js';
import {registryMetrics} from '../server/modules/registry-reporting.js';
import {reportScheduleInput,reportScheduleListFilters,dueReportSlot,nextReportSlot,reportScheduleAuthority,resolveScheduledReportActor,createReportSchedulesModule,scheduledReportEditionInput} from '../server/modules/report-schedules.js';
import {startReportScheduler} from '../server/report-scheduler.js';

const key=Buffer.alloc(32,7),scope={programmeCodes:['P'],intakeIds:['I']};
const actor={accountId:'owner',permissions:['registry.view','reports.schedule','audit.view'],roles:[{permissions:['registry.view'],scope:{}},{permissions:['reports.schedule'],scope},{permissions:['audit.view'],scope:{}}]};
const input={reportKind:'registry',filters:{},title:'Private recurring registry',reason:'SECRET SCHEDULE REASON',cadence:'daily',firstRunAt:'2026-10-05T12:00:00.000Z',retainDays:30,requestKey:'schedule_request_1'};
const counts=Object.fromEntries(registryMetrics.map((m) => [m.id,0])),controls={programmesReconcile:true,periodsReconcile:true,registrationsReconcile:true};
function fixture() {
  const f={schedules:[],runs:[],editions:[],transitions:[],calls:[],sourceCalls:0,now:'2026-10-05T12:00:01.000Z',owner:structuredClone(actor),intakes:[{intakeId:'I',programmeCode:'P'}]};
  f.report={definitionVersion:'registry-enrolment-v1',filters:{programmeCode:'',intakeId:''},metrics:registryMetrics,totals:{...counts},controls,rows:[{intakeId:'I',programmeCode:'P',label:'Intake',counts:{...counts},controls}],availableIntakes:f.intakes};
  const db={release(){},async query(sql,v=[]) {
    f.calls.push({sql,v});
    if(sql.includes('transaction_timestamp() as "now"'))return {rows:[{now:f.now}]};
    if(sql.startsWith('select i.id'))return {rows:sql.includes('where i.id = $1') ? f.intakes.filter((r) => r.intakeId === v[0]) : f.intakes.filter((r) => v[0].includes(r.intakeId))};
    if(sql.startsWith('select count(*)'))return {rows:[{count:f.schedules.filter((r) => r.createdBy === v[0] && r.status !== 'cancelled').length}]};
    if(sql.startsWith('select s.id')) {
      let rows=f.schedules;
      if(sql.includes('where s.id = $1'))rows=rows.filter((r) => r.id === v[0] && (v.length < 2 || r.createdBy === v[1]));
      else if(sql.includes('s.created_by = $1'))rows=rows.filter((r) => r.createdBy === v[0] && (sql.includes('request_key = $2') ? r.requestKey === v[1] : !v[1] || r.reportKind === v[1]));
      else rows=rows.filter((r) => r.status === 'active' && r.nextRunAt <= f.now && !f.runs.some((run) => run.scheduleId === r.id && (run.status === 'running' && run.leaseUntil > f.now || run.status === 'failed' && run.retryAt > f.now)));
      return {rows:rows.map((r) => structuredClone(r))};
    }
    if(sql.startsWith('select id,schedule_id')) {
      let rows=f.runs.filter((r) => sql.includes('where id = $1') ? r.id === v[0] : r.scheduleId === v[0]);
      if(sql.includes('and scheduled_for = $2'))rows=rows.filter((r) => r.scheduledFor === v[1]);
      if(sql.includes("and (status = 'running'"))rows=rows.filter((r) => r.status === 'running' || r.status === 'failed' && r.retryAt);
      return {rows:rows.map((r) => structuredClone(r))};
    }
    if(sql.startsWith('select id,created_by'))return {rows:f.editions.filter((r) => r.createdBy === v[0] && r.requestKey === v[1]).map((r) => structuredClone(r))};
    if(sql.startsWith('insert into report_schedules')) {const names=['id','createdBy','reportKind','requestKey','requestHash','cadence','firstRunAt','retainDays','grants','configurationEncrypted','custodyDigest','createdAt','nextRunAt'];f.schedules.push({...Object.fromEntries(names.map((n,i) => [n,v[i]])),status:'active',revision:0});}
    if(sql.startsWith('insert into report_schedule_runs')) {const names=['id','scheduleId','scheduledFor','retainUntil','createdAt','leaseToken','leaseUntil','custodyDigest'];f.runs.push({...Object.fromEntries(names.map((n,i) => [n,v[i]])),status:'running',attempts:1,editionId:null,errorCode:null,retryAt:null});}
    if(sql.startsWith('insert into report_schedule_transitions'))f.transitions.push({id:v[0],scheduleId:v[1],revision:v[3],status:v[4],reasonEncrypted:v[5]});
    if(sql.startsWith('insert into report_editions')) {const names=['id','createdBy','reportKind','requestKey','requestHash','definitionVersion','sourceGeneratedAt','createdAt','retainUntil','grants','titleEncrypted','reasonEncrypted','payloadEncrypted','payloadDigest','custodyDigest'];f.editions.push({...Object.fromEntries(names.map((n,i) => [n,v[i]])),status:'retained'});}
    if(sql.startsWith('update report_schedules')) {const r=f.schedules.find((r) => r.id === v[0]);if(sql.includes('next_run_at = greatest'))r.nextRunAt=r.nextRunAt > (v[2] || v[1]) ? r.nextRunAt : v[2] || v[1];if(sql.includes('status = $2')){r.status=v[1];r.revision++;}else if(sql.includes("status = 'paused'")){r.status='paused';r.revision++;}}
    if(sql.startsWith('update report_schedule_runs')) {
      if(sql.includes("status = 'succeeded'") && f.failCompletionOnce){f.failCompletionOnce=false;throw new Error('Simulated crash after independent edition commit');}
      if(sql.includes('where schedule_id = $1')) {for(const r of f.runs.filter((r) => r.scheduleId === v[0] && r.status === 'failed' && r.retryAt)){r.retryAt=null;r.errorCode='schedule_stopped';r.finishedAt=f.now;}}
      else {const r=f.runs.find((r) => r.id === v[0]);if(sql.includes("status = 'running'")){r.status='running';r.attempts++;r.leaseToken=v[1];r.leaseUntil=v[2];r.retryAt=null;r.errorCode=null;r.finishedAt=null;}
        else {r.status=sql.includes("status = 'succeeded'") ? 'succeeded' : 'failed';r.leaseToken=null;r.leaseUntil=null;r.finishedAt=f.now;if(r.status === 'succeeded'){r.editionId=v[1];r.errorCode=null;r.retryAt=null;}else {r.errorCode=sql.includes("error_code = 'lease_expired'") ? 'lease_expired' : v[1];r.retryAt=v[2] || null;}}}
    }
    return {rows:[]};
  }};
  const pool={query:db.query,async connect(){return db;}};
  f.module=createReportSchedulesModule(pool,{dataEncryptionKey:key,schedulerEnabled:true,resolveActor:async () => f.owner,sources:{registry:async () => {f.sourceCalls++;if(f.sourceError)throw f.sourceError;return {...structuredClone(f.report),generatedAt:f.now};}}});return f;
}

test('schedule inputs are bounded native selectors with explicit UTC minute cadence and delegation',() => {
  assert.deepEqual(reportScheduleInput(input),input);
  for(const change of [{title:'x'.repeat(111)},{firstRunAt:'2026-02-30T12:00:00.000Z'},{firstRunAt:'2026-10-05T12:00:01.000Z'},{cadence:'cron'},{retainDays:0},{retainDays:367},{retainDays:'30'},{filters:{format:'csv'}},{filters:{counts:4}},{requestKey:'short'},{token:'secret'}])assert.throws(() => reportScheduleInput({...input,...change}),{statusCode:400});
  assert.deepEqual(reportScheduleListFilters({status:'paused',limit:'2'}),{reportKind:'',status:'paused',limit:2,offset:0});for(const v of [{status:'expired'},{offset:10001},{limit:0},{reportKind:0},{token:'secret'}])assert.throws(() => reportScheduleListFilters(v),{statusCode:400});
});
test('UTC slot arithmetic has no early run, one latest missed slot and stable daily/weekly boundaries',() => {
  const first=input.firstRunAt;assert.equal(dueReportSlot(first,'daily','2026-10-05T11:59:59Z'),null);assert.equal(nextReportSlot(first,'daily','2026-10-05T11:59:59Z'),first);
  assert.equal(dueReportSlot(first,'daily','2026-10-08T12:00:00Z'),'2026-10-08T12:00:00.000Z');assert.equal(nextReportSlot(first,'daily','2026-10-08T12:00:00Z'),'2026-10-09T12:00:00.000Z');
  assert.equal(dueReportSlot(first,'weekly','2026-10-11T23:59:59Z'),first);assert.equal(nextReportSlot(first,'weekly','2026-10-12T12:00:00Z'),'2026-10-19T12:00:00.000Z');assert.throws(() => dueReportSlot('BROKEN','daily',first),{statusCode:409});
});
test('finance schedules explicitly choose run-date or fixed cutoff and replay the original execution date',() => {
  const finance={...input,reportKind:'finance',filters:{asOf:'2026-10-04'}};assert.equal(reportScheduleInput(finance).financeAsOfMode,'run_date');assert.equal(reportScheduleInput({...finance,financeAsOfMode:'fixed'}).financeAsOfMode,'fixed');for(const value of [{...finance,financeAsOfMode:'unknown'},{...finance,financeAsOfMode:'fixed',filters:{}},{...input,financeAsOfMode:'run_date'}])assert.throws(() => reportScheduleInput(value),{statusCode:400});
  const run={id:'run',createdAt:'2026-10-05T23:59:00Z',scheduledFor:'2026-10-04T12:00:00Z',retainUntil:'2026-11-04'},schedule={id:'schedule',reportKind:'finance'},configuration={title:'Finance',filters:finance.filters,financeAsOfMode:'run_date'};assert.equal(scheduledReportEditionInput(schedule,run,configuration).filters.asOf,'2026-10-05');assert.equal(scheduledReportEditionInput(schedule,run,{...configuration,financeAsOfMode:'fixed'}).filters.asOf,'2026-10-04');assert.equal(scheduledReportEditionInput(schedule,run,configuration).requestKey,'schedule_run');assert.equal(configuration.filters.asOf,'2026-10-04');
});
test('scheduling authority is independent of native authority and unrelated global permissions',() => {
  const grants={intakes:[{intakeId:'I',programmeCode:'P'}]},current=grants.intakes;assert.equal(reportScheduleAuthority(actor,'registry',grants,current),true);
  assert.equal(reportScheduleAuthority({...actor,roles:[actor.roles[0],actor.roles[2]]},'registry',grants,current),false);assert.equal(reportScheduleAuthority(actor,'registry',grants,[{intakeId:'I',programmeCode:'OTHER'}]),false);
  assert.equal(reportScheduleAuthority(actor,'registry',{intakes:[]},[]),false);assert.equal(reportScheduleAuthority({...actor,roles:[...actor.roles,{permissions:['reports.schedule'],scope:{}}]},'registry',{intakes:[]},[]),true);
});
test('fresh delegated actors require active accounts and current permission-specific role scopes without tokens',async () => {
  const calls=[],roles=actor.roles,pool={async connect(){return {release(){},async query(sql,v){calls.push({sql,v});return {rows:sql.startsWith('select id,status') ? [{id:'owner',status:'active'}] : sql.startsWith('select ra.role_code') ? roles : []};}};}};
  const resolved=await resolveScheduledReportActor(pool,'owner');assert.deepEqual(resolved.roles,roles);assert.equal(resolved.sessionStatus,'scheduled_delegation');assert.equal(resolved.token,undefined);assert.match(calls.find((r) => r.sql.startsWith('select ra.role_code')).sql,/effective_to >= current_date/);assert.equal(calls.some((r) => /sessions|token_digest/.test(r.sql)),false);
  assert.equal(await resolveScheduledReportActor({async connect(){return {release(){},async query(){return {rows:[{status:'suspended'}]};}};}},'owner'),null);
});
test('schedule creation encrypts fixed intent, is retry-safe and does not save preview report figures',async () => {
  const f=fixture(),saved=await f.module.createReportSchedule(input,actor);assert.equal(saved.replayed,false);assert.equal(f.sourceCalls,1);assert.equal(f.editions.length,0);assert.doesNotMatch(JSON.stringify(f.schedules),/SECRET SCHEDULE|Private recurring/);
  assert.deepEqual(JSON.parse(decryptSecret(f.schedules[0].configurationEncrypted,key)),{title:input.title,reason:input.reason,filters:{}});assert.equal((await f.module.createReportSchedule(input,actor)).id,saved.id);assert.equal(f.sourceCalls,1);await assert.rejects(f.module.createReportSchedule({...input,retainDays:7},actor),{statusCode:409});
  assert.doesNotMatch(JSON.stringify(f.calls.filter((q) => q.sql.includes('insert into audit_events'))),/SECRET|Private recurring/);
});
test('a due run creates exactly one native private edition and advances to the next UTC slot',async () => {
  const f=fixture(),saved=await f.module.createReportSchedule(input,actor),run=await f.module.runReportSchedule(saved.id,actor);assert.equal(run.status,'succeeded');assert.equal(f.editions.length,1);assert.equal(f.sourceCalls,2);assert.equal(f.schedules[0].nextRunAt,'2026-10-06T12:00:00.000Z');assert.equal(f.runs[0].scheduledFor,input.firstRunAt);assert.equal(f.runs[0].retainUntil,'2026-11-04');assert.equal(f.editions[0].requestKey,`schedule_${f.runs[0].id}`);
  assert.equal((await f.module.readReportSchedule(saved.id,actor)).runs[0].editionId,run.editionId);await assert.rejects(f.module.runReportSchedule(saved.id,actor),{statusCode:409});assert.deepEqual(await f.module.runDueReportSchedules(),{runs:[]});assert.equal(f.editions.length,1);
});
test('missed execution captures only the latest due slot, never a fabricated historical snapshot',async () => {
  const f=fixture();await f.module.createReportSchedule(input,actor);f.now='2026-10-10T18:00:00.000Z';const result=await f.module.runDueReportSchedules();assert.equal(result.runs[0].status,'succeeded');assert.equal(f.runs.length,1);assert.equal(f.runs[0].scheduledFor,'2026-10-10T12:00:00.000Z');assert.equal(f.editions[0].sourceGeneratedAt,f.now);assert.equal(f.schedules[0].nextRunAt,'2026-10-11T12:00:00.000Z');
});
test('an expired claim recovers a committed edition without generating again or changing its custody fields',async () => {
  const f=fixture();await f.module.createReportSchedule(input,actor);f.failCompletionOnce=true;await assert.rejects(f.module.runDueReportSchedules(),/Simulated crash/);assert.equal(f.editions.length,1);assert.equal(f.runs[0].status,'running');const original=f.editions[0].id,key=f.editions[0].requestKey,keep=f.runs[0].retainUntil;f.now='2026-10-05T12:03:02.000Z';await f.module.runDueReportSchedules();assert.equal(f.runs[0].attempts,2);assert.equal(f.runs[0].editionId,original);assert.equal(f.editions.length,1);assert.equal(f.editions[0].requestKey,key);assert.equal(f.runs[0].retainUntil,keep);assert.equal(f.sourceCalls,2);
});
test('owner inactivity or original-scope loss pauses before native capture and hides library/history',async () => {
  for(const owner of [null,{...actor,permissions:[],roles:[]}]) {const f=fixture(),saved=await f.module.createReportSchedule(input,actor);f.owner=owner;const r=await f.module.runDueReportSchedules();assert.equal(r.runs[0].errorCode,'authority_unavailable');assert.equal(f.schedules[0].status,'paused');assert.equal(f.sourceCalls,1);assert.equal(f.editions.length,0);assert.equal(f.transitions.length,1);const revoked={...actor,permissions:[],roles:[]};assert.equal((await f.module.listReportSchedules({},revoked)).total,0);await assert.rejects(f.module.readReportSchedule(saved.id,revoked),{statusCode:404});}
});
test('freshly added source scopes require current scheduling authority, not just broad report permission',async () => {
  const f=fixture();await f.module.createReportSchedule(input,actor);f.intakes.push({intakeId:'J',programmeCode:'Q'});f.report.rows.push({...f.report.rows[0],intakeId:'J',programmeCode:'Q'});const r=await f.module.runDueReportSchedules();assert.equal(r.runs[0].errorCode,'authority_unavailable');assert.equal(f.sourceCalls,2);assert.equal(f.editions.length,0);assert.equal(f.schedules[0].status,'paused');
});
test('source reconciliation retries are bounded, reuse the same slot/key/retention and stop after three',async () => {
  const f=fixture();await f.module.createReportSchedule(input,actor);f.sourceError=Object.assign(new Error('SECRET SOURCE FAULT'),{statusCode:409});await f.module.runDueReportSchedules();const first=structuredClone(f.runs[0]);assert.equal(first.attempts,1);assert.equal(first.errorCode,'source_reconciliation');assert.deepEqual(await f.module.runDueReportSchedules(),{runs:[]});
  f.now=first.retryAt;await f.module.runDueReportSchedules();assert.equal(f.runs[0].id,first.id);assert.equal(f.runs[0].attempts,2);assert.equal(f.runs[0].retainUntil,first.retainUntil);f.now=f.runs[0].retryAt;await f.module.runDueReportSchedules();assert.equal(f.runs[0].attempts,3);assert.equal(f.runs[0].retryAt,null);assert.equal(f.schedules[0].nextRunAt,'2026-10-06T12:00:00.000Z');assert.doesNotMatch(JSON.stringify(f.calls.filter((q) => q.sql.includes('insert into audit_events'))),/SECRET SOURCE/);
});
test('pause/cancel terminate pending retries; blind creator stop is allowed but resume requires full scope',async () => {
  const f=fixture(),saved=await f.module.createReportSchedule(input,actor);f.sourceError=new Error('Source unavailable');await f.module.runDueReportSchedules();assert.ok(f.runs[0].retryAt);const revoked={...actor,permissions:[],roles:[]};assert.equal((await f.module.transitionReportSchedule(saved.id,{status:'paused',revision:0,reason:'SECRET STOP'},revoked)).status,'paused');assert.equal(f.runs[0].retryAt,null);assert.equal(f.runs[0].errorCode,'schedule_stopped');await assert.rejects(f.module.transitionReportSchedule(saved.id,{status:'active',revision:1,reason:'Resume'},revoked),{statusCode:404});
  await assert.rejects(f.module.transitionReportSchedule(saved.id,{status:'cancelled',revision:1,reason:'Cancel'}, {...actor,accountId:'other'}),{statusCode:404});assert.equal((await f.module.transitionReportSchedule(saved.id,{status:'cancelled',revision:1,reason:'Cancel'},revoked)).status,'cancelled');assert.equal((await f.module.transitionReportSchedule(saved.id,{status:'cancelled',revision:1,reason:'Retry'},revoked)).replayed,true);await assert.rejects(f.module.transitionReportSchedule(saved.id,{status:'active',revision:2,reason:'Resume'},actor),{statusCode:409});assert.equal(decryptSecret(f.transitions[0].reasonEncrypted,key),'SECRET STOP');
});
test('signed header and due-state faults are quarantined without source reads, not silently repaired',async () => {
  for(const change of [(r) => {r.configurationEncrypted='BROKEN';},(r) => {r.nextRunAt='2026-10-05T12:00:00.001Z';}]) {const f=fixture();await f.module.createReportSchedule(input,actor);change(f.schedules[0]);await f.module.runDueReportSchedules();assert.equal(f.schedules[0].status,'paused');assert.equal(f.sourceCalls,1);assert.equal(f.editions.length,0);}
});
test('scheduler config defaults to development only and process timer never overlaps a held batch',async () => {
  assert.equal(loadConfig({}).reportSchedulerEnabled,true);assert.equal(loadConfig({SVU_ENV:'production',SVU_DATA_KEY:key.toString('base64')}).reportSchedulerEnabled,false);assert.equal(loadConfig({SVU_REPORT_SCHEDULER:'disabled'}).reportSchedulerEnabled,false);assert.throws(() => loadConfig({SVU_REPORT_SCHEDULER:'yes'}));
  let release,calls=0;const worker=startReportScheduler({repository:{async runDueReportSchedules(){calls++;await new Promise((ok) => {release=ok;});return {runs:[]};}},logger:{info(){},error(){}},intervalMs:1000});await new Promise((ok) => setTimeout(ok,1100));assert.equal(calls,1);const stopping=worker.stop();release();await stopping;assert.equal(calls,1);
});
