import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {actorCanAccessScope,insertAudit,isGlobalScope,requestError,withTransaction} from '../support.js';
import {encryptSecret,decryptSecret} from '../security.js';
import {createAdmissionsReportingModule,admissionsReportCsv,admissionsReportFilters} from './admissions-reporting.js';
import {createRegistryReportingModule,registryReportCsv,registryReportFilters} from './registry-reporting.js';
import {createFinanceReportingModule,financeReportCsv,financeReportFilters} from './finance-reporting.js';
import {createSupportReportingModule,supportReportCsv,supportReportFilters} from './support-reporting.js';
import {createEnquiryReportingModule,enquiryReportCsv,enquiryReportFilters} from './enquiry-reporting.js';
import {createCommunicationReportingModule,communicationReportCsv,communicationReportFilters} from './communication-reporting.js';
import {createAcademicReportingModule,academicReportCsv,academicReportFilters,academicDomainAuthority,academicReportPermissions} from './academic-reporting.js';
import {createContinuationReportingModule,continuationReportCsv,continuationReportFilters} from './continuation-reporting.js';
import {createExaminationReportingModule,examinationReportCsv,examinationReportFilters,examinationReportPermissions} from './examination-reporting.js';
import {createAssessmentReportingModule,assessmentReportCsv,assessmentReportFilters,assessmentReportPermissions} from './assessment-reporting.js';

export const reportEditionKinds = Object.freeze({
  admissions:{label:'Admissions workload',permissions:['admissions.review'],filter:admissionsReportFilters,csv:admissionsReportCsv},
  registry:{label:'Registry and enrolment',permissions:['registry.view'],filter:registryReportFilters,csv:registryReportCsv},
  finance:{label:'Finance control totals',permissions:['finance.view'],filter:financeReportFilters,csv:financeReportCsv},
  support:{label:'Student support workload',permissions:['support.view'],filter:supportReportFilters,csv:supportReportCsv},
  enquiries:{label:'Prospective enquiry workload',permissions:['enquiries.manage'],filter:enquiryReportFilters,csv:enquiryReportCsv},
  communications:{label:'Applicant campaign workload',permissions:['admissions.communicate'],filter:communicationReportFilters,csv:communicationReportCsv},
  academic:{label:'Academic outcomes and awards',permissions:academicReportPermissions,filter:academicReportFilters,csv:academicReportCsv},
  continuation:{label:'Confirmed period continuation',permissions:['registry.view'],filter:continuationReportFilters,csv:continuationReportCsv},
  examinations:{label:'Examination workload',permissions:examinationReportPermissions,filter:examinationReportFilters,csv:examinationReportCsv},
  assessment:{label:'Assessment recording workload',permissions:assessmentReportPermissions,filter:assessmentReportFilters,csv:assessmentReportCsv}
});
export const maxReportEditionBytes = 4_000_000;
const fields = (input,allowed) => {if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !allowed.includes(k))) throw requestError(400,'Unsupported report edition fields.');};
const bounded = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');
const kind = (v) => typeof v === 'string' && Object.hasOwn(reportEditionKinds,v);
const day = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const iso = (v) => new Date(v).toISOString();
const canonical = (v) => JSON.stringify(v,(_k,item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((k) => [k,item[k]])) : item);
const hasKind = (actor,k) => kind(k) && reportEditionKinds[k].permissions.some((p) => actor.permissions.includes(p));
const can = (actor,permission,row) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},row);
export const hasGlobalFinanceImport = (actor) => actor.roles.some((r) => (r.permissions || []).includes('finance.import') && (r.code === 'system_administrator' || isGlobalScope(r.scope)));
export function reportEditionInput(input) {
  fields(input,['reportKind','filters','title','reason','retainUntil','requestKey']);
  if (!kind(input.reportKind) || !bounded(input.title,160) || !bounded(input.reason,2000) || !day(input.retainUntil) || typeof input.requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey)) throw requestError(400,'Use bounded report edition custody fields.');
  const filters = input.filters ?? {};fields(filters,Object.keys(filters));if (Object.hasOwn(filters,'format')) throw requestError(400,'Capture filters must not specify an export format.');
  reportEditionKinds[input.reportKind].filter({...filters,format:'json'});
  return {...input,title:input.title.trim(),reason:input.reason.trim(),filters};
}
export function reportEditionListFilters(input = {}) {
  fields(input,['reportKind','status','limit','offset']);const {reportKind = '',status = 'all',limit = 25,offset = 0} = input;
  if (typeof reportKind !== 'string' || reportKind && !kind(reportKind) || !['all','retained','expired','withdrawn'].includes(status) || !/^\d+$/.test(String(limit)) || !/^\d+$/.test(String(offset)) || Number(limit) < 1 || Number(limit) > 100 || Number(offset) > 10000) throw requestError(400,'Use bounded report edition library filters.');
  return {reportKind,status,limit:Number(limit),offset:Number(offset)};
}
export function reportEditionGrants(reportKind,report) {
  let scopes;
  if (reportKind === 'assessment') scopes = report.selection;
  else if (reportKind === 'continuation') scopes = [report.baseline];
  else if (reportKind === 'finance') scopes = report.availableIntakes.filter((r) => ['programmeCode','intakeId'].every((k) => !report.filters[k] || report.filters[k] === r[k]));
  else scopes = report.rows;
  const intakes = new Map();
  for (const r of scopes) {
    if (!bounded(r.intakeId,160) || !bounded(r.programmeCode,160)) throw requestError(409,'Report snapshot scope requires reconciliation.');
    const entry = {intakeId:r.intakeId,programmeCode:r.programmeCode};
    if (reportKind === 'academic') entry.domains = r.authority;
    if (reportKind === 'enquiries') entry.applications = r.applicationAuthority;
    intakes.set(r.intakeId,entry);
  }
  return {intakes:[...intakes.values()],financeImportGlobal:reportKind === 'finance' && report.unmatchedQueue !== null};
}
export function reportEditionScopeAllowed(actor,reportKind,grants,currentIntakes) {
  if (!hasKind(actor,reportKind) || grants.financeImportGlobal && !hasGlobalFinanceImport(actor)) return false;
  return grants.intakes.every((captured) => {
    const current = currentIntakes.find((r) => r.intakeId === captured.intakeId);if (!current) return false;
    return [captured,current].every((row) => {
      if (reportKind === 'academic') {const authority = academicDomainAuthority(actor,row);return Object.entries(captured.domains).every(([d,required]) => !required || authority[d]);}
      const primary = reportEditionKinds[reportKind].permissions.some((p) => can(actor,p,row));
      return primary && (reportKind !== 'enquiries' || !captured.applications || can(actor,'admissions.review',row));
    });
  });
}
const headerSelect = `select id,created_by as "createdBy",report_kind as "reportKind",request_key as "requestKey",request_hash as "requestHash",definition_version as "definitionVersion",
  source_generated_at as "sourceGeneratedAt",created_at as "createdAt",to_char(retain_until,'YYYY-MM-DD') as "retainUntil",grants,title_encrypted as "titleEncrypted",reason_encrypted as "reasonEncrypted",
  payload_digest as "payloadDigest",custody_digest as "custodyDigest",status,withdrawn_at as "withdrawnAt" from report_editions`;
const custody = (row) => ({id:row.id,createdBy:row.createdBy,reportKind:row.reportKind,requestKey:row.requestKey,requestHash:row.requestHash,definitionVersion:row.definitionVersion,
  sourceGeneratedAt:iso(row.sourceGeneratedAt),createdAt:iso(row.createdAt),retainUntil:row.retainUntil,grants:row.grants,titleEncrypted:row.titleEncrypted,reasonEncrypted:row.reasonEncrypted,payloadDigest:row.payloadDigest});
export function createReportEditionSources(pool) {
  return {
    admissions:createAdmissionsReportingModule(pool).admissionsOperationsReport,registry:createRegistryReportingModule(pool).registryOperationsReport,
    finance:createFinanceReportingModule(pool).financeControlTotals,support:createSupportReportingModule(pool).supportOperationsReport,
    enquiries:createEnquiryReportingModule(pool).enquiryOperationsReport,communications:createCommunicationReportingModule(pool).communicationOperationsReport,
    academic:createAcademicReportingModule(pool).academicOperationsReport,continuation:createContinuationReportingModule(pool).continuationOperationsReport,
    examinations:createExaminationReportingModule(pool).examinationOperationsReport,assessment:createAssessmentReportingModule(pool).assessmentOperationsReport
  };
}
export function createReportEditionsModule(pool,{dataEncryptionKey,sources:overrides = {}} = {}) {
  const sources = {...createReportEditionSources(pool),...overrides};
  const digest = (v) => createHmac('sha256',dataEncryptionKey).update(v).digest('hex'),encode = (v) => encryptSecret(v,dataEncryptionKey);
  const decode = (v) => {try {return decryptSecret(v,dataEncryptionKey);} catch {throw requestError(409,'Report edition encrypted content requires reconciliation.');}};
  const equal = (a,b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
  const verify = (row) => {
    try {if (kind(row.reportKind) && equal(row.custodyDigest,digest(canonical(custody(row))))) return;} catch { /* Refuse malformed custody without exposing fields. */ }
    throw requestError(409,'Report edition custody requires reconciliation.');
  };
  const audit = (db,actor,action,row,extra = {}) => insertAudit(db,{actorId:actor.accountId,action:`reports.editions.${action}`,subjectType:'ReportEdition',subjectId:row.id || 'library',reason:'Private report edition custody operation',metadata:{reportKind:row.reportKind || '',definitionVersion:row.definitionVersion || '',...extra}});
  const clock = async (db) => iso((await db.query('select transaction_timestamp() as "now"')).rows[0].now);
  const currentScopes = async (db,rows) => {
    const ids = [...new Set(rows.flatMap((r) => r.grants.intakes.map((g) => g.intakeId)))];
    return ids.length ? (await db.query('select i.id as "intakeId",p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id where i.id = any($1::text[])',[ids])).rows : [];
  };
  const status = (row,now) => row.status === 'withdrawn' ? 'withdrawn' : row.retainUntil < now.slice(0,10) ? 'expired' : 'retained';
  const metadata = (row,now) => ({id:row.id,reportKind:row.reportKind,label:reportEditionKinds[row.reportKind].label,title:decode(row.titleEncrypted),definitionVersion:row.definitionVersion,
    sourceGeneratedAt:iso(row.sourceGeneratedAt),createdAt:iso(row.createdAt),retainUntil:row.retainUntil,status:status(row,now),withdrawnAt:row.withdrawnAt ? iso(row.withdrawnAt) : null});
  const allowed = async (db,row,actor) => {verify(row);return reportEditionScopeAllowed(actor,row.reportKind,row.grants,await currentScopes(db,[row]));};
  const replay = async (db,row,requestHash,actor,now) => {
    verify(row);if (row.requestHash !== requestHash) throw requestError(409,'The edition request key was used for different custody fields.');
    if (status(row,now) !== 'retained' || !await allowed(db,row,actor)) throw requestError(404,'Retained report edition was not found.');
    await audit(db,actor,'capture.replayed',row);return {...metadata(row,now),replayed:true};
  };
  return {
    async listReportEditions(input,actor) {
      const filters = reportEditionListFilters(input),kinds = Object.entries(reportEditionKinds).filter(([k]) => hasKind(actor,k)).map(([reportKind,d]) => ({reportKind,label:d.label}));
      if (!kinds.length) return {items:[],total:0,kinds,filters};
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');const now = await clock(db);
        const rows = (await db.query(`${headerSelect} where created_by = $1 and ($2::text = '' or report_kind = $2) order by created_at desc,id desc`,[actor.accountId,filters.reportKind])).rows;
        for (const row of rows) verify(row);const scopes = await currentScopes(db,rows);
        const visible = rows.filter((r) => reportEditionScopeAllowed(actor,r.reportKind,r.grants,scopes) && (filters.status === 'all' || status(r,now) === filters.status));
        const items = visible.slice(filters.offset,filters.offset+filters.limit).map((r) => metadata(r,now));
        await audit(db,actor,'library.accessed',{}, {returnedCount:items.length});return {items,total:visible.length,kinds,filters};
      });
    },
    async captureReportEdition(input,actor) {
      const data = reportEditionInput(input);if (!hasKind(actor,data.reportKind)) throw requestError(403,'Viewing authority for this report kind is required.');
      const requestHash = digest(canonical(data));
      const old = await withTransaction(pool,async (db) => {
        const row = (await db.query(`${headerSelect} where created_by = $1 and request_key = $2`,[actor.accountId,data.requestKey])).rows[0];
        return row ? replay(db,row,requestHash,actor,await clock(db)) : null;
      });if (old) return old;
      // Native generators capture their own consistent source snapshot; never accept browser totals or CSV.
      const generated = await sources[data.reportKind]({...data.filters,format:'json'},actor),{availableIntakes,availablePeriods,availableCourses,...report} = generated;
      if (!bounded(report.definitionVersion,160) || !Number.isFinite(Date.parse(report.generatedAt)) || !Array.isArray(report.metrics)) throw requestError(409,'Native report snapshot requires reconciliation.');
      const grants = reportEditionGrants(data.reportKind,generated),body = JSON.stringify({report,csv:reportEditionKinds[data.reportKind].csv(report)});
      if (Buffer.byteLength(body+canonical(grants)+data.title+data.reason,'utf8') > maxReportEditionBytes) throw requestError(413,'Report edition is too large; narrow the report cohort.');
      return withTransaction(pool,async (db) => {
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.accountId}:${data.requestKey}`]);
        const row = (await db.query(`${headerSelect} where created_by = $1 and request_key = $2`,[actor.accountId,data.requestKey])).rows[0],now = await clock(db);
        if (row) return replay(db,row,requestHash,actor,now);
        const distance = (Date.parse(data.retainUntil)-Date.parse(now.slice(0,10)))/86400000;
        if (distance < 0 || distance > 366) throw requestError(400,'Keep-until must be today through 366 days ahead in UTC.');
        if (Date.parse(report.generatedAt) > Date.parse(now)) throw requestError(409,'Report snapshot generation time requires reconciliation.');
        const saved = {id:`red_${randomUUID()}`,createdBy:actor.accountId,reportKind:data.reportKind,requestKey:data.requestKey,requestHash,definitionVersion:report.definitionVersion,
          sourceGeneratedAt:report.generatedAt,createdAt:now,retainUntil:data.retainUntil,grants,titleEncrypted:encode(data.title),reasonEncrypted:encode(data.reason),payloadEncrypted:encode(body),status:'retained'};
        saved.payloadDigest = digest(saved.payloadEncrypted);saved.custodyDigest = digest(canonical(custody(saved)));
        if (!await allowed(db,saved,actor)) throw requestError(404,'Report edition scope was not found.');
        await db.query(`insert into report_editions (id,created_by,report_kind,request_key,request_hash,definition_version,source_generated_at,created_at,retain_until,grants,title_encrypted,reason_encrypted,payload_encrypted,payload_digest,custody_digest)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[saved.id,saved.createdBy,saved.reportKind,saved.requestKey,saved.requestHash,saved.definitionVersion,saved.sourceGeneratedAt,saved.createdAt,saved.retainUntil,saved.grants,saved.titleEncrypted,saved.reasonEncrypted,saved.payloadEncrypted,saved.payloadDigest,saved.custodyDigest]);
        await audit(db,actor,'captured',saved,{sourceGeneratedAt:saved.sourceGeneratedAt,retainUntil:saved.retainUntil});return {...metadata(saved,now),replayed:false};
      });
    },
    async readReportEdition(id,actor,download = false) {
      if (!bounded(id,160)) throw requestError(400,'Use a bounded edition identifier.');
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');const now = await clock(db),row = (await db.query(`${headerSelect} where id = $1 and created_by = $2`,[id,actor.accountId])).rows[0];
        if (!row || status(row,now) !== 'retained' || !await allowed(db,row,actor)) throw requestError(404,'Retained report edition was not found.');
        const encrypted = (await db.query('select payload_encrypted as payload from report_editions where id = $1',[row.id])).rows[0]?.payload;
        if (typeof encrypted !== 'string' || !equal(row.payloadDigest,digest(encrypted))) throw requestError(409,'Report edition payload requires reconciliation.');
        let body;try {body = JSON.parse(decode(encrypted));} catch {throw requestError(409,'Report edition payload requires reconciliation.');}
        let bindingsValid = false;
        try {bindingsValid = body?.report?.definitionVersion === row.definitionVersion && iso(body.report.generatedAt) === iso(row.sourceGeneratedAt) && typeof body.csv === 'string';} catch { /* Malformed bindings must fail closed, not become a server error. */ }
        if (!bindingsValid) throw requestError(409,'Report edition payload bindings require reconciliation.');
        await audit(db,actor,download ? 'downloaded' : 'accessed',row);return download ? {edition:metadata(row,now),csv:body.csv,filename:`report-edition-${row.id}.csv`} : {edition:metadata(row,now),report:body.report};
      });
    },
    async withdrawReportEdition(id,input,actor) {
      fields(input,['reason']);if (!bounded(id,160) || !bounded(input.reason,2000)) throw requestError(400,'An edition and bounded withdrawal reason are required.');
      return withTransaction(pool,async (db) => {
        const row = (await db.query(`${headerSelect} where id = $1 and created_by = $2 for update`,[id,actor.accountId])).rows[0];if (!row) throw requestError(404,'Report edition was not found.');verify(row);
        if (row.status === 'withdrawn') return {id:row.id,status:'withdrawn',replayed:true};
        // The creator can withdraw even after scope loss; this action returns no report content or labels.
        await db.query("update report_editions set status = 'withdrawn',withdrawn_at = now(),withdrawal_reason_encrypted = $2 where id = $1",[row.id,encode(input.reason.trim())]);
        await audit(db,actor,'withdrawn',row);return {id:row.id,status:'withdrawn',replayed:false};
      });
    }
  };
}
