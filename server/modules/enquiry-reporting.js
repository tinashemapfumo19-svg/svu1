import {insertAudit,parseEffectiveDate,requestError,withTransaction} from '../support.js';
import {enquiryCan} from './prospective-enquiries.js';

export const enquiryMetricVersion = 'prospective-enquiry-operations-v1';
const metric = (id,label,formula,exclusions,group = 'workload',unit = 'enquiries') => Object.freeze({id,label,formula,exclusions,group,unit,
  owner:'Admissions office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current enquiries.manage programme/intake scope; optional intake and inclusive UTC created-date cohort',
  refresh:'On request; one repeatable-read snapshot of current records. Not historical status reconstruction or a business-hours SLA.'});
export const enquiryMetrics = Object.freeze([
  metric('enquiriesTotal','Enquiry records','Count retained enquiries in the selected created-date cohort','Not unique people, external leads or deleted records'),
  metric('verifiedAccounts','Verified accounts','Distinct owner accounts across the selected cohort','Not unique people; intake counts are not additive','applications','accounts'),
  metric('open','Open','Current status = open','Not every historical opening'),
  metric('inProgress','In progress','Current status = in_progress','Includes applicant follow-up and escalation'),
  metric('waitingApplicant','Waiting for applicant','Current status = waiting_applicant','Not a delivery receipt or read acknowledgement'),
  metric('resolved','Resolved','Current status = resolved','Reopened enquiries are counted in their current status'),
  metric('withdrawn','Consent withdrawn','Current status = withdrawn','Terminal portal reply consent withdrawal, not a marketing preference'),
  metric('activeConsent','Active reply consent','Current consent_active = true','Only this in-app enquiry; not marketing or another channel','replies'),
  metric('endedConsent','Ended reply consent','Current consent_active = false','Includes resolution and withdrawal','replies'),
  metric('unassignedActive','Unassigned active enquiries','Active reply consent and no current assignee','Resolved/withdrawn records and historical assignments','replies'),
  metric('escalatedActive','Escalated active enquiries','Active reply consent and currently escalated','Not historical escalation event counts','replies'),
  metric('awaitingFirstReply','Active without a public staff reply','Active consent and no recorded public staff message','Internal notes are not replies; reopened cases retain earlier public replies','replies'),
  metric('activePubliclyAnswered','Active with a public staff reply','Active consent and at least one public staff message','Not proof the applicant read it','replies'),
  metric('publiclyAnswered','Ever publicly answered','At least one recorded public staff message','Internal notes and applicant messages','replies'),
  metric('enquiriesWithApplication','Enquiries with an application','Same owner account and intake have any retained application','Requires same-intake admissions.review; includes pre-existing/withdrawn records; association, not conversion attribution','applications'),
  metric('enquiriesWithLaterApplication','Enquiries with a later application','Same owner/intake application created at or after enquiry creation','Requires same-intake admissions.review; not proof of causation or an admission outcome','applications'),
  metric('firstReplySamples','First-reply timing samples','Enquiries with a first public staff reply','Unanswered cases and private notes','timing'),
  metric('meanFirstReplyMinutes','Mean first public reply','Mean elapsed UTC minutes from creation to first public staff message','Not business hours, latest reopening response time, delivery or an approved SLA','timing','minutes'),
  metric('resolvedSamples','Resolution timing samples','Currently resolved enquiries with a retained resolution timestamp','Active, withdrawn and reopened enquiries','timing'),
  metric('meanResolutionMinutes','Mean current resolution duration','Mean elapsed UTC minutes from original creation to latest current resolution','Includes time before reopening; not handling time, business hours or an approved SLA','timing','minutes')
]);
export function enquiryReportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['intakeId','from','to','format'].includes(k))) throw requestError(400,'Unsupported enquiry report filter.');
  const intakeId = input.intakeId ?? '',from = input.from ?? '',to = input.to ?? '',format = input.format ?? 'json';
  if (typeof intakeId !== 'string' || intakeId.length > 160 || /[\r\n\0]/.test(intakeId) || typeof from !== 'string' || typeof to !== 'string' || !['json','csv'].includes(format)) throw requestError(400,'Use bounded enquiry report filters.');
  if (Boolean(from) !== Boolean(to)) throw requestError(400,'Choose both created-date bounds or leave both empty.');
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < '0001-01-01') throw requestError(400,'Use valid UTC calendar dates.');
    parseEffectiveDate(from);parseEffectiveDate(to);
    const days = (Date.parse(to)-Date.parse(from))/86400000;
    if (days < 0 || days > 365) throw requestError(400,'Choose an inclusive created-date range of at most 366 days.');
  }
  return {intakeId:intakeId.trim(),from,to,format};
}
const empty = () => Object.fromEntries(enquiryMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
export function enquiryReportControls(c) {
  const sample = (count,value) => count === 0 ? value === null : Number.isFinite(value) && value >= 0;
  return {
    statusReconciles:c.enquiriesTotal === c.open+c.inProgress+c.waitingApplicant+c.resolved+c.withdrawn,
    consentReconciles:c.activeConsent === c.open+c.inProgress+c.waitingApplicant && c.endedConsent === c.resolved+c.withdrawn,
    repliesReconcile:c.publiclyAnswered === c.firstReplySamples && c.activeConsent === c.awaitingFirstReply+c.activePubliclyAnswered && c.publiclyAnswered <= c.enquiriesTotal,
    applicationsReconcile:c.enquiriesWithApplication === null && c.enquiriesWithLaterApplication === null ? null : c.enquiriesWithLaterApplication <= c.enquiriesWithApplication && c.enquiriesWithApplication <= c.enquiriesTotal && c.verifiedAccounts <= c.enquiriesTotal,
    timingReconciles:c.resolvedSamples === c.resolved && sample(c.firstReplySamples,c.meanFirstReplyMinutes) && sample(c.resolvedSamples,c.meanResolutionMinutes)
  };
}
const csvCell = (v) => {const raw = String(v ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function enquiryReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_intake','created_from_utc','created_to_utc','row_type','intake_id','programme_code','intake','application_authority','metric_id','unit','value',...Object.keys(report.controls)];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.intakeId,report.filters.from,report.filters.to];
  const rows = [];
  for (const row of [{type:'total',counts:report.totals,controls:report.controls,applicationAuthority:report.applicationAuthority},...report.rows.map((r) => ({...r,type:'intake'}))]) {
    for (const m of enquiryMetrics) rows.push([...prefix,row.type,row.intakeId || '',row.programmeCode || '',row.label || '',row.applicationAuthority,m.id,m.unit,row.counts[m.id],...Object.values(row.controls)]);
  }
  return [header,...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
const authority = (actor) => {if (!actor.permissions.includes('enquiries.manage')) throw requestError(403,'Enquiry management authority is required.');};
async function visibleIntakes(db,actor) {
  return (await db.query('select i.id as "intakeId",i.label,i.status,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code,i.id')).rows.filter((r) => enquiryCan(actor,r));
}
export function createEnquiryReportingModule(pool) {
  const audit = (db,actor,action,metadata) => insertAudit(db,{actorId:actor.accountId,action:`reports.enquiries.${action}`,subjectType:'ProspectiveEnquiryOperationsReport',subjectId:enquiryMetricVersion,reason:'Scoped enquiry operations report',metadata});
  return {
    async enquiryMetricDictionary(actor) {authority(actor);return {definitionVersion:enquiryMetricVersion,metrics:enquiryMetrics};},
    async listEnquiryReportingIntakes(actor) {
      authority(actor);return withTransaction(pool,async (db) => {const rows = await visibleIntakes(db,actor);await audit(db,actor,'intakes.accessed',{intakeCount:rows.length});return rows;});
    },
    async enquiryOperationsReport(input,actor) {
      authority(actor);const filters = enquiryReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        if (filters.to && filters.to > generatedAt.slice(0,10)) throw requestError(400,'Created-date bounds cannot extend beyond the current UTC date.');
        const availableIntakes = await visibleIntakes(db,actor),selected = availableIntakes.filter((r) => !filters.intakeId || r.intakeId === filters.intakeId);
        if (filters.intakeId && !selected.length) throw requestError(404,'Enquiry reporting intake was not found.');
        const ids = selected.map((r) => r.intakeId),applicationIds = selected.filter((r) => enquiryCan(actor,r,'admissions.review')).map((r) => r.intakeId);
        const bounds = [ids,filters.from ? `${filters.from}T00:00:00.000Z` : null,filters.to ? new Date(Date.parse(filters.to)+86400000).toISOString() : null];
        const cohort = `e.intake_id = any($1::text[]) and ($2::timestamptz is null or e.created_at >= $2) and ($3::timestamptz is null or e.created_at < $3)`;
        if (ids.length && (await db.query(`select 1 from prospective_enquiries e join intakes i on i.id = e.intake_id where ${cohort} and (
          e.programme_id is distinct from i.programme_id or e.created_at > transaction_timestamp() or not exists (
            select 1 from prospective_enquiry_history h where h.enquiry_id = e.id and h.revision = e.revision and h.to_status = e.status
            and h.consent_active = e.consent_active and h.consent_policy = e.consent_policy and h.assignee_id is not distinct from e.assignee_id
            and h.escalated = e.escalated and h.escalation_level = e.escalation_level)
          or exists(select 1 from prospective_enquiry_messages m where m.enquiry_id = e.id and (m.created_at < e.created_at or m.created_at > transaction_timestamp()))
        ) limit 1`,bounds)).rows.length) throw requestError(409,'Enquiry custody or history requires reconciliation before reporting.');
        if (applicationIds.length && (await db.query(`select 1 from applications a join prospective_enquiries e on e.owner_id = a.applicant_account_id and e.intake_id = a.intake_id
          join intakes i on i.id = a.intake_id join programmes p on p.id = i.programme_id
          left join resource_scopes rs on rs.resource_type = 'Application' and rs.resource_id = a.id
          where ${cohort} and e.intake_id = any($4::text[]) and (rs.resource_id is null or rs.programme_code is distinct from p.code or rs.intake_id is distinct from i.id) limit 1`,[...bounds,applicationIds])).rows.length) throw requestError(409,'Application scope bindings require reconciliation before enquiry reporting.');
        const aggregates = ids.length ? (await db.query(`with cohort as (
          select e.intake_id,e.owner_id,e.status,e.consent_active,e.assignee_id,e.escalated,e.created_at,e.resolved_at,
            (select min(m.created_at) from prospective_enquiry_messages m where m.enquiry_id = e.id and m.author_kind = 'staff' and m.visibility = 'public') as first_reply_at,
            case when e.intake_id = any($4::text[]) then exists(select 1 from applications a where a.applicant_account_id = e.owner_id and a.intake_id = e.intake_id) end as has_application,
            case when e.intake_id = any($4::text[]) then exists(select 1 from applications a where a.applicant_account_id = e.owner_id and a.intake_id = e.intake_id and a.created_at >= e.created_at) end as has_later_application
          from prospective_enquiries e where ${cohort}
        ) select intake_id as "intakeId",count(*)::integer as "enquiriesTotal",count(distinct owner_id)::integer as "verifiedAccounts",
          count(*) filter(where status = 'open')::integer as "open",count(*) filter(where status = 'in_progress')::integer as "inProgress",
          count(*) filter(where status = 'waiting_applicant')::integer as "waitingApplicant",count(*) filter(where status = 'resolved')::integer as "resolved",
          count(*) filter(where status = 'withdrawn')::integer as "withdrawn",count(*) filter(where consent_active)::integer as "activeConsent",
          count(*) filter(where not consent_active)::integer as "endedConsent",count(*) filter(where consent_active and assignee_id is null)::integer as "unassignedActive",
          count(*) filter(where consent_active and escalated)::integer as "escalatedActive",count(*) filter(where consent_active and first_reply_at is null)::integer as "awaitingFirstReply",
          count(*) filter(where consent_active and first_reply_at is not null)::integer as "activePubliclyAnswered",count(first_reply_at)::integer as "publiclyAnswered",
          count(*) filter(where has_application)::integer as "enquiriesWithApplication",count(*) filter(where has_later_application)::integer as "enquiriesWithLaterApplication",
          count(first_reply_at)::integer as "firstReplySamples",avg(extract(epoch from first_reply_at-created_at)/60)::double precision as "meanFirstReplyMinutes",
          count(resolved_at)::integer as "resolvedSamples",avg(extract(epoch from resolved_at-created_at)/60)::double precision as "meanResolutionMinutes"
        from cohort group by grouping sets ((intake_id),())`,[...bounds,applicationIds])).rows : [];
        const byId = new Map(aggregates.map(({intakeId,...counts}) => [intakeId,counts]));
        const applicationAuthority = applicationIds.length === ids.length,totals = byId.get(null) || empty();
        if (!applicationAuthority) {totals.enquiriesWithApplication = null;totals.enquiriesWithLaterApplication = null;}
        const rows = selected.map((r) => {const counts = byId.get(r.intakeId) || empty(),authorized = applicationIds.includes(r.intakeId);if (!authorized) {counts.enquiriesWithApplication = null;counts.enquiriesWithLaterApplication = null;}return {...r,counts,applicationAuthority:authorized,controls:enquiryReportControls(counts)};});
        const controls = Object.fromEntries(Object.entries(enquiryReportControls(totals)).map(([k,v]) => [k,v === null ? null : v && rows.every((r) => r.controls[k] !== false)]));
        const report = {definitionVersion:enquiryMetricVersion,generatedAt,filters,availableIntakes,metrics:enquiryMetrics,totals,rows,controls,applicationAuthority};
        await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{definitionVersion:enquiryMetricVersion,intakeCount:rows.length,enquiryCount:totals.enquiriesTotal,from:filters.from,to:filters.to,controls});
        return filters.format === 'csv' ? {filename:'prospective-enquiry-operations.csv',csv:enquiryReportCsv(report),definitionVersion:enquiryMetricVersion,generatedAt} : report;
      });
    }
  };
}
