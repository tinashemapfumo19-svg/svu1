import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {encryptSecret,decryptSecret} from '../security.js';
import {actorCanAccessScope,isGlobalScope,insertAudit,requestError,withTransaction} from '../support.js';
import {createReportEditionSources,createReportEditionsModule,reportEditionKinds,reportEditionInput,reportEditionListFilters,reportEditionGrants,reportEditionScopeAllowed} from './report-editions.js';

const canonical=(v) => JSON.stringify(v,(_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k,x[k]])) : x);
const iso=(v) => new Date(v).toISOString();
const bounded=(v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');
const fields=(v,allowed) => {if(!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !allowed.includes(k)))throw requestError(400,'Unsupported report schedule fields.');};
const duration=(cadence) => {if(!['daily','weekly'].includes(cadence))throw requestError(400,'Choose daily or weekly UTC cadence.');return (cadence === 'daily' ? 1 : 7)*86400000;};
export function dueReportSlot(first,cadence,now) {
  const start=Date.parse(first),time=Date.parse(now),interval=duration(cadence);if(!Number.isFinite(start) || !Number.isFinite(time))throw requestError(409,'Report schedule time requires reconciliation.');
  return time < start ? null : iso(start+Math.floor((time-start)/interval)*interval);
}
export function nextReportSlot(first,cadence,now) {const due=dueReportSlot(first,cadence,now);return due ? iso(Date.parse(due)+duration(cadence)) : iso(first);}
export function reportScheduleInput(input) {
  fields(input,['reportKind','filters','title','reason','cadence','firstRunAt','retainDays','requestKey','financeAsOfMode']);
  if(!bounded(input.title,110) || !['daily','weekly'].includes(input.cadence) || typeof input.firstRunAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(input.firstRunAt) || !Number.isFinite(Date.parse(input.firstRunAt)) || iso(input.firstRunAt) !== input.firstRunAt || !Number.isInteger(input.retainDays) || input.retainDays < 1 || input.retainDays > 366)throw requestError(400,'Use bounded UTC schedule and custody fields.');
  const native=reportEditionInput({reportKind:input.reportKind,filters:input.filters,title:input.title,reason:input.reason,retainUntil:'2000-01-01',requestKey:input.requestKey});
  const financeAsOfMode=input.financeAsOfMode ?? 'run_date';
  if(input.reportKind === 'finance' ? !['run_date','fixed'].includes(financeAsOfMode) || financeAsOfMode === 'fixed' && !native.filters.asOf : Object.hasOwn(input,'financeAsOfMode'))throw requestError(400,'Use an explicit finance cutoff mode only for finance schedules.');
  return {...input,filters:native.filters,title:native.title,reason:native.reason,...(input.reportKind === 'finance' ? {financeAsOfMode} : {})};
}
export function scheduledReportEditionInput(schedule,run,configuration) {
  const filters={...configuration.filters};if(schedule.reportKind === 'finance' && configuration.financeAsOfMode === 'run_date')filters.asOf=iso(run.createdAt).slice(0,10);
  return {reportKind:schedule.reportKind,filters,title:`${configuration.title} (${iso(run.scheduledFor)})`,reason:`Automatic private report capture from ${schedule.id}`,retainUntil:run.retainUntil,requestKey:`schedule_${run.id}`};
}
export function reportScheduleListFilters(input={}) {
  fields(input,['reportKind','status','limit','offset']);const status=input.status ?? 'all';if(!['all','active','paused','cancelled'].includes(status))throw requestError(400,'Choose a report schedule status.');
  return {...reportEditionListFilters({...input,status:'all'}),status};
}
export function reportScheduleAuthority(actor,kind,grants,current) {
  if(!actor?.permissions.includes('reports.schedule') || !reportEditionScopeAllowed(actor,kind,grants,current))return false;
  const can=(r) => actorCanAccessScope({...actor,authorizingPermission:'reports.schedule'},r);
  return grants.intakes.length ? grants.intakes.every((r) => can(r) && can(current.find((i) => i.intakeId === r.intakeId))) : actor.roles.some((r) => r.permissions.includes('reports.schedule') && (r.code === 'system_administrator' || isGlobalScope(r.scope)));
}
export async function resolveScheduledReportActor(pool,accountId) {
  return withTransaction(pool,async (db) => {
    await db.query('set transaction isolation level repeatable read');const account=(await db.query('select id,status from accounts where id = $1',[accountId])).rows[0];if(account?.status !== 'active')return null;
    const roles=(await db.query(`select ra.role_code as code,ra.scope,coalesce(array_agg(rp.permission_code) filter (where rp.permission_code is not null),'{}') as permissions
      from role_assignments ra left join role_permissions rp on rp.role_code = ra.role_code where ra.account_id = $1 and ra.effective_from <= current_date
      and (ra.effective_to is null or ra.effective_to >= current_date) group by ra.id,ra.role_code,ra.scope`,[accountId])).rows;
    return {accountId,roles,permissions:[...new Set(roles.flatMap((r) => r.permissions))],sessionStatus:'scheduled_delegation',assurance:'reports.schedule'};
  });
}
const header=`select s.id,s.created_by as "createdBy",s.report_kind as "reportKind",s.request_key as "requestKey",s.request_hash as "requestHash",s.cadence,s.first_run_at as "firstRunAt",s.retain_days as "retainDays",
  s.grants,s.configuration_encrypted as "configurationEncrypted",s.custody_digest as "custodyDigest",s.created_at as "createdAt",s.status,s.revision,s.next_run_at as "nextRunAt" from report_schedules s`;
const runSelect=`select id,schedule_id as "scheduleId",scheduled_for as "scheduledFor",to_char(retain_until,'YYYY-MM-DD') as "retainUntil",created_at as "createdAt",attempts,status,
  custody_digest as "custodyDigest",lease_token as "leaseToken",lease_until as "leaseUntil",retry_at as "retryAt",finished_at as "finishedAt",error_code as "errorCode",edition_id as "editionId" from report_schedule_runs`;
const custody=(r) => ({id:r.id,createdBy:r.createdBy,reportKind:r.reportKind,requestKey:r.requestKey,requestHash:r.requestHash,cadence:r.cadence,firstRunAt:iso(r.firstRunAt),retainDays:r.retainDays,grants:r.grants,configurationEncrypted:r.configurationEncrypted,createdAt:iso(r.createdAt)});
export function createReportSchedulesModule(pool,{dataEncryptionKey,schedulerEnabled=false,sources:overrides={},resolveActor=resolveScheduledReportActor,captureEdition}={}) {
  const sources={...createReportEditionSources(pool),...overrides},digest=(v) => createHmac('sha256',dataEncryptionKey).update(v).digest('hex');
  const verify=(r) => {try {const expected=digest(canonical(custody(r)));if(/^[a-f0-9]{64}$/.test(r.custodyDigest) && timingSafeEqual(Buffer.from(r.custodyDigest,'hex'),Buffer.from(expected,'hex')))return;}catch{}throw requestError(409,'Report schedule custody requires reconciliation.');};
  const runCustody=(r) => ({id:r.id,scheduleId:r.scheduleId,scheduledFor:iso(r.scheduledFor),retainUntil:r.retainUntil,createdAt:iso(r.createdAt)});
  const verifyRun=(r) => {try {const expected=digest(canonical(runCustody(r)));if(/^[a-f0-9]{64}$/.test(r.custodyDigest) && timingSafeEqual(Buffer.from(r.custodyDigest,'hex'),Buffer.from(expected,'hex')))return;}catch{}throw requestError(409,'Report schedule run custody requires reconciliation.');};
  const configuration=(r) => {try {const data=JSON.parse(decryptSecret(r.configurationEncrypted,dataEncryptionKey));reportScheduleInput({reportKind:r.reportKind,filters:data.filters,title:data.title,reason:data.reason,requestKey:r.requestKey,cadence:r.cadence,firstRunAt:iso(r.firstRunAt),retainDays:r.retainDays,...(r.reportKind === 'finance' ? {financeAsOfMode:data.financeAsOfMode} : {})});if(r.reportKind === 'finance' && !['run_date','fixed'].includes(data.financeAsOfMode))throw new Error();return data;}catch{throw requestError(409,'Report schedule configuration requires reconciliation.');}};
  const clock=async (db) => iso((await db.query('select transaction_timestamp() as "now"')).rows[0].now);
  const current=async (db,grants) => grants.intakes.length ? (await db.query('select i.id as "intakeId",p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id where i.id = any($1::text[])',[grants.intakes.map((r) => r.intakeId)])).rows : [];
  const allowed=async (db,r,actor) => {verify(r);return reportScheduleAuthority(actor,r.reportKind,r.grants,await current(db,r.grants));};
  const grantsFor=async (kind,report,filters) => {
    const grants=reportEditionGrants(kind,report);
    if(kind === 'examinations' && filters.intakeId && !grants.intakes.some((r) => r.intakeId === filters.intakeId)) {
      const intake=(await pool.query('select i.id as "intakeId",p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id where i.id = $1',[filters.intakeId])).rows[0];if(!intake)throw requestError(404,'Report schedule intake was not found.');grants.intakes.push(intake);
    }
    return grants;
  };
  const audit=(db,actorId,action,r,extra={}) => insertAudit(db,{actorId,action:`reports.schedules.${action}`,subjectType:'ReportSchedule',subjectId:r.id,reason:'Private report schedule custody operation',metadata:{reportKind:r.reportKind,...extra}});
  const transitionHistory=(db,r,status,reason) => db.query('insert into report_schedule_transitions(id,schedule_id,actor_id,revision,to_status,reason_encrypted) values($1,$2,$3,$4,$5,$6)',[`rst_${randomUUID()}`,r.id,r.createdBy,r.revision+1,status,encryptSecret(reason,dataEncryptionKey)]);
  const quarantine=async (db,r) => {await db.query("update report_schedules set status = 'paused',revision = revision+1 where id = $1",[r.id]);await transitionHistory(db,r,'paused','Automatic pause: schedule custody or due state requires reconciliation.');await audit(db,r.createdBy,'custody.quarantined',r);return {quarantined:true,id:r.id};};
  const runMetadata=(r) => ({id:r.id,scheduledFor:iso(r.scheduledFor),status:r.status,attempts:r.attempts,editionId:r.editionId || null,errorCode:r.errorCode || null,retryAt:r.retryAt ? iso(r.retryAt) : null,leaseUntil:r.leaseUntil ? iso(r.leaseUntil) : null});
  const metadata=(r) => ({id:r.id,reportKind:r.reportKind,label:reportEditionKinds[r.reportKind].label,title:configuration(r).title,cadence:r.cadence,firstRunAt:iso(r.firstRunAt),nextRunAt:iso(r.nextRunAt),retainDays:r.retainDays,status:r.status,revision:r.revision,createdAt:iso(r.createdAt),...(r.reportKind === 'finance' ? {financeAsOfMode:configuration(r).financeAsOfMode} : {})});
  const advance=async (db,r,now) => {const next=nextReportSlot(r.firstRunAt,r.cadence,now);await db.query('update report_schedules set next_run_at = greatest(next_run_at,$2::timestamptz) where id = $1 and status <> \'cancelled\'',[r.id,next]);};
  async function claim(id,actor) {
    return withTransaction(pool,async (db) => {
      const now=await clock(db);
      const row=(await db.query(`${header} where ${id ? 's.id = $1 and s.created_by = $2' : `s.status = 'active' and s.next_run_at <= transaction_timestamp() and not exists(select 1 from report_schedule_runs rr where rr.schedule_id = s.id and (rr.status = 'running' and rr.lease_until > transaction_timestamp() or rr.status = 'failed' and rr.retry_at > transaction_timestamp()))`} ${id ? '' : 'order by s.next_run_at,s.id'} limit 1 for update of s skip locked`,id ? [id,actor.accountId] : [])).rows[0];
      if(!row)return null;
      try {verify(row);}catch(error){if(actor)throw error;return quarantine(db,row);}
      if(actor && !await allowed(db,row,actor))throw requestError(404,'Report schedule was not found.');
      if(row.status !== 'active' || Date.parse(row.nextRunAt) > Date.parse(now))return null;
      const interval=duration(row.cadence),delta=Date.parse(row.nextRunAt)-Date.parse(row.firstRunAt);if(delta < 0 || delta%interval !== 0){if(actor)throw requestError(409,'Report schedule due time requires reconciliation.');return quarantine(db,row);}
      const pending=(await db.query(`${runSelect} where schedule_id = $1 and (status = 'running' or status = 'failed' and retry_at is not null) order by scheduled_for limit 1 for update`,[row.id])).rows[0];
      if(pending){try {verifyRun(pending);}catch(error){if(actor)throw error;return quarantine(db,row);}}
      if(pending && (pending.status === 'running' && Date.parse(pending.leaseUntil) > Date.parse(now) || pending.status === 'failed' && Date.parse(pending.retryAt) > Date.parse(now)))return null;
      if(pending?.attempts >= 3) {await db.query("update report_schedule_runs set status = 'failed',lease_token = null,lease_until = null,retry_at = null,finished_at = now(),error_code = 'lease_expired' where id = $1",[pending.id]);await advance(db,row,now);await audit(db,row.createdBy,'lease.exhausted',row,{runId:pending.id});return {quarantined:true,id:row.id};}
      const slot=pending ? iso(pending.scheduledFor) : dueReportSlot(row.firstRunAt,row.cadence,now);if(!slot)return null;
      const existing=pending || (await db.query(`${runSelect} where schedule_id = $1 and scheduled_for = $2`,[row.id,slot])).rows[0];
      if(existing){try {verifyRun(existing);}catch(error){if(actor)throw error;return quarantine(db,row);}}
      if(existing && existing.status !== 'running' && !(existing.status === 'failed' && existing.retryAt)) {await advance(db,row,now);return {quarantined:true,id:row.id};}
      const token=randomUUID(),lease=iso(Date.parse(now)+180000);let run;
      if(existing) {run={...existing,status:'running',attempts:existing.attempts+1,leaseToken:token,leaseUntil:lease,retryAt:null,errorCode:null};await db.query("update report_schedule_runs set status = 'running',attempts = attempts+1,lease_token = $2,lease_until = $3,retry_at = null,finished_at = null,error_code = null where id = $1",[run.id,token,lease]);}
      else {const retainUntil=iso(Date.parse(now.slice(0,10))+row.retainDays*86400000).slice(0,10);run={id:`rsr_${randomUUID()}`,scheduleId:row.id,scheduledFor:slot,retainUntil,createdAt:now,status:'running',attempts:1,leaseToken:token,leaseUntil:lease};run.custodyDigest=digest(canonical(runCustody(run)));await db.query("insert into report_schedule_runs(id,schedule_id,scheduled_for,retain_until,created_at,status,attempts,lease_token,lease_until,custody_digest) values($1,$2,$3,$4,$5,'running',1,$6,$7,$8)",[run.id,row.id,slot,retainUntil,now,token,lease,run.custodyDigest]);}
      await audit(db,row.createdBy,'run.claimed',row,{runId:run.id,scheduledFor:slot,attempt:run.attempts});return {schedule:row,run};
    });
  }
  async function execute(claimed) {
    if(claimed.quarantined)return {id:claimed.id,status:'not_claimed'};
    const {schedule,run}=claimed;let edition,errorCode;
    try {
      const owner=await resolveActor(pool,schedule.createdBy);if(!owner || !await withTransaction(pool,(db) => allowed(db,schedule,owner)))throw requestError(403,'Schedule authority is unavailable.');
      const data=configuration(schedule),wrapped=Object.fromEntries(Object.entries(sources).map(([kind,read]) => [kind,async (filters,actor) => {
        const report=await read(filters,actor),grants=await grantsFor(kind,report,filters);
        if(!await withTransaction(pool,async (db) => reportScheduleAuthority(actor,kind,grants,await current(db,grants))))throw requestError(403,'Fresh report scope is outside scheduling authority.');return report;
      }]));
      const capture=captureEdition || createReportEditionsModule(pool,{dataEncryptionKey,sources:wrapped}).captureReportEdition;
      edition=await capture(scheduledReportEditionInput(schedule,run,data),owner);
    }catch(error){errorCode=[401,403,404].includes(error.statusCode) ? 'authority_unavailable' : error.statusCode === 409 ? 'source_reconciliation' : 'capture_unavailable';}
    return withTransaction(pool,async (db) => {
      const now=await clock(db),row=(await db.query(`${header} where s.id = $1 for update of s`,[schedule.id])).rows[0],held=(await db.query(`${runSelect} where id = $1 for update`,[run.id])).rows[0];
      if(held?.status !== 'running' || held.leaseToken !== run.leaseToken)return {id:run.id,status:'superseded'};
      verifyRun(held);
      if(edition) {await db.query("update report_schedule_runs set status = 'succeeded',edition_id = $2,finished_at = now(),lease_token = null,lease_until = null where id = $1",[run.id,edition.id]);if(row.status !== 'cancelled')await advance(db,row,now);await audit(db,row.createdBy,'run.succeeded',row,{runId:run.id,editionId:edition.id});return {id:run.id,status:'succeeded',editionId:edition.id};}
      const retryable=errorCode !== 'authority_unavailable' && run.attempts < 3 && row.status === 'active',retryAt=retryable ? iso(Date.parse(now)+30000*2**(run.attempts-1)) : null;
      await db.query("update report_schedule_runs set status = 'failed',finished_at = now(),error_code = $2,retry_at = $3,lease_token = null,lease_until = null where id = $1",[run.id,errorCode,retryAt]);
      if(errorCode === 'authority_unavailable' && row.status === 'active'){await db.query("update report_schedules set status = 'paused',revision = revision+1 where id = $1",[row.id]);await transitionHistory(db,row,'paused','Automatic pause: current owner or scheduling/report authority is unavailable.');}else if(!retryable && row.status !== 'cancelled')await advance(db,row,now);
      await audit(db,row.createdBy,'run.failed',row,{runId:run.id,errorCode,attempt:run.attempts,retryable});return {id:run.id,status:'failed',errorCode,retryAt};
    });
  }
  return {
    async listReportSchedules(input,actor) {
      const filters=reportScheduleListFilters(input),kinds=Object.entries(reportEditionKinds).filter(([,d]) => actor.permissions.includes('reports.schedule') && d.permissions.some((p) => actor.permissions.includes(p))).map(([reportKind,d]) => ({reportKind,label:d.label}));
      if(!kinds.length)return {items:[],total:0,kinds,filters,workerEnabled:Boolean(schedulerEnabled)};
      return withTransaction(pool,async (db) => {await db.query('set transaction isolation level repeatable read');const rows=(await db.query(`${header} where s.created_by = $1 and ($2::text = '' or s.report_kind = $2) order by s.created_at desc,s.id desc`,[actor.accountId,filters.reportKind])).rows;for(const r of rows)verify(r);
        const scopes=await current(db,{intakes:rows.flatMap((r) => r.grants.intakes)}),visible=rows.filter((r) => reportScheduleAuthority(actor,r.reportKind,r.grants,scopes) && (filters.status === 'all' || filters.status === r.status));
        const items=visible.slice(filters.offset,filters.offset+filters.limit).map(metadata);await audit(db,actor.accountId,'library.accessed',{id:'library',reportKind:''},{returnedCount:items.length});return {items,total:visible.length,kinds,filters,workerEnabled:Boolean(schedulerEnabled)};
      });
    },
    async createReportSchedule(input,actor) {
      const data=reportScheduleInput(input);if(!actor.permissions.includes('reports.schedule') || !reportEditionKinds[data.reportKind].permissions.some((p) => actor.permissions.includes(p)))throw requestError(403,'Native report authority and explicit scheduling delegation are required.');const hash=digest(canonical(data));
      const replay=async (db,r) => {verify(r);if(r.requestHash !== hash)throw requestError(409,'The schedule request key was used for different fields.');if(r.status === 'cancelled' || !await allowed(db,r,actor))throw requestError(404,'Report schedule was not found.');await audit(db,actor.accountId,'created.replayed',r);return {...metadata(r),replayed:true};};
      const old=await withTransaction(pool,async (db) => {const r=(await db.query(`${header} where s.created_by = $1 and s.request_key = $2`,[actor.accountId,data.requestKey])).rows[0];return r ? replay(db,r) : null;});if(old)return old;
      const report=await sources[data.reportKind]({...data.filters,format:'json'},actor),grants=await grantsFor(data.reportKind,report,data.filters);
      return withTransaction(pool,async (db) => {await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`report-schedules:${actor.accountId}`]);const r=(await db.query(`${header} where s.created_by = $1 and s.request_key = $2`,[actor.accountId,data.requestKey])).rows[0];if(r)return replay(db,r);const now=await clock(db),distance=Date.parse(data.firstRunAt)-Math.floor(Date.parse(now)/60000)*60000;
        if(distance < -60000 || distance > 366*86400000)throw requestError(400,'First UTC run must be current or future, at most 366 days ahead.');
        if(Number((await db.query("select count(*) as count from report_schedules where created_by = $1 and status <> 'cancelled'",[actor.accountId])).rows[0].count) >= 50)throw requestError(409,'Cancel an existing schedule before creating more.');
        const saved={id:`rsc_${randomUUID()}`,createdBy:actor.accountId,reportKind:data.reportKind,requestKey:data.requestKey,requestHash:hash,cadence:data.cadence,firstRunAt:data.firstRunAt,retainDays:data.retainDays,grants,configurationEncrypted:encryptSecret(JSON.stringify({title:data.title,reason:data.reason,filters:data.filters,...(data.reportKind === 'finance' ? {financeAsOfMode:data.financeAsOfMode} : {})}),dataEncryptionKey),createdAt:now,status:'active',revision:0,nextRunAt:data.firstRunAt};saved.custodyDigest=digest(canonical(custody(saved)));
        if(!await allowed(db,saved,actor))throw requestError(404,'Report scheduling scope was not found.');await db.query(`insert into report_schedules(id,created_by,report_kind,request_key,request_hash,cadence,first_run_at,retain_days,grants,configuration_encrypted,custody_digest,created_at,next_run_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[saved.id,saved.createdBy,saved.reportKind,saved.requestKey,saved.requestHash,saved.cadence,saved.firstRunAt,saved.retainDays,saved.grants,saved.configurationEncrypted,saved.custodyDigest,saved.createdAt,saved.nextRunAt]);await audit(db,actor.accountId,'created',saved,{cadence:saved.cadence,firstRunAt:saved.firstRunAt,retainDays:saved.retainDays});return {...metadata(saved),replayed:false};
      });
    },
    async readReportSchedule(id,actor) {
      if(!bounded(id,160))throw requestError(400,'Use a bounded schedule identifier.');return withTransaction(pool,async (db) => {await db.query('set transaction isolation level repeatable read');const r=(await db.query(`${header} where s.id = $1 and s.created_by = $2`,[id,actor.accountId])).rows[0];if(!r || !await allowed(db,r,actor))throw requestError(404,'Report schedule was not found.');const rows=(await db.query(`${runSelect} where schedule_id = $1 order by scheduled_for desc,id desc limit 25`,[r.id])).rows;for(const run of rows)verifyRun(run);const runs=rows.map(runMetadata);await audit(db,actor.accountId,'accessed',r,{returnedCount:runs.length});return {schedule:metadata(r),configuration:configuration(r),runs};});
    },
    async transitionReportSchedule(id,input,actor) {
      fields(input,['status','revision','reason']);if(!bounded(id,160) || !['active','paused','cancelled'].includes(input.status) || !Number.isInteger(input.revision) || input.revision < 0 || !bounded(input.reason,2000))throw requestError(400,'A bounded reason and schedule revision are required.');
      return withTransaction(pool,async (db) => {const r=(await db.query(`${header} where s.id = $1 and s.created_by = $2 for update of s`,[id,actor.accountId])).rows[0];if(!r)throw requestError(404,'Report schedule was not found.');verify(r);
        if(r.status === input.status)return {id:r.id,status:r.status,revision:r.revision,replayed:true};if(r.revision !== input.revision)throw requestError(409,'The report schedule changed. Refresh before trying again.');if(r.status === 'cancelled')throw requestError(409,'Schedule cancellation is terminal.');if(input.status === 'active' && !await allowed(db,r,actor))throw requestError(404,'Report schedule was not found.');
        // Stopping future claims remains available to the authenticated creator after source-authority loss.
        const now=await clock(db),next=input.status === 'active' ? nextReportSlot(r.firstRunAt,r.cadence,now) : iso(r.nextRunAt);
        await db.query('update report_schedules set status = $2,revision = revision+1,next_run_at = greatest(next_run_at,$3::timestamptz) where id = $1',[r.id,input.status,next]);if(input.status !== 'active')await db.query("update report_schedule_runs set retry_at = null,error_code = 'schedule_stopped',finished_at = now() where schedule_id = $1 and status = 'failed' and retry_at is not null",[r.id]);await transitionHistory(db,r,input.status,input.reason.trim());await audit(db,actor.accountId,'transitioned',r,{status:input.status,revision:r.revision+1});return {id:r.id,status:input.status,revision:r.revision+1,replayed:false};
      });
    },
    async runReportSchedule(id,actor) {if(!bounded(id,160))throw requestError(400,'Use a bounded schedule identifier.');const held=await claim(id,actor);if(!held)throw requestError(409,'No report schedule run is due or its claim is already held.');return execute(held);},
    async runDueReportSchedules({limit=5}={}) {if(!Number.isInteger(limit) || limit < 1 || limit > 20)throw requestError(400,'Use a bounded schedule processing batch.');const runs=[];for(let n=0;n<limit;n++){const held=await claim();if(!held)break;runs.push(await execute(held));}return {runs};}
  };
}
