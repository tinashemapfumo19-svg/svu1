import {insertAudit,parseEffectiveDate,requestError,withTransaction} from '../support.js';
import {supportCan,supportCategories,supportPriorities} from './support-cases.js';

export const supportMetricVersion = 'student-support-operations-v1';
const metric = (id,label,formula,exclusions,group = 'workload',unit = 'cases') => Object.freeze({id,label,formula,exclusions,group,unit,
  owner:'Student support office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current support.view programme/intake scope; optional intake, current category/priority and inclusive UTC created-date cohort',
  refresh:'On request; one repeatable-read current-record snapshot. Not historical status reconstruction or a business-hours SLA.'});
export const supportMetrics = Object.freeze([
  metric('casesTotal','Support cases','Count retained cases in the selected cohort','Not unique people or external requests'),
  metric('ownerAccounts','Current owner accounts','Distinct current students.account_id links','Not unique people or proof of verified email; intake counts are not additive','workload','accounts'),
  metric('programmeRecords','Programme records','Distinct captured student programme records','Not unique people; intake counts are not additive','workload','records'),
  ...[['open','Open'],['in_progress','In progress'],['waiting_student','Waiting for student'],['resolved','Resolved'],['closed','Closed']].map(([status,label]) => metric(status.replace(/_([a-z])/g,(_,c) => c.toUpperCase()),label,`Current status = ${status}`,'Reopened cases count in their current status')),
  metric('activeCases','Active cases','Current status is open, in_progress or waiting_student','Resolved and closed records','responses'),
  metric('unassignedActive','Unassigned active cases','Active case with no current assignee','Historical assignments and terminal cases','responses'),
  metric('escalatedActive','Escalated active cases','Active and currently escalated','Not historical escalation events','responses'),
  metric('urgentActive','Urgent active cases','Active and current priority urgent','Not an emergency-service guarantee or approved response deadline','responses'),
  metric('publiclyAnswered','Ever publicly answered','At least one public staff comment','Internal notes and student messages; not a read receipt','responses'),
  metric('awaitingFirstReply','Active without a public staff reply','Active with no public staff comment','Reopened cases retain earlier replies; internal notes are not replies','responses'),
  metric('activePubliclyAnswered','Active with a public staff reply','Active with a public staff comment','Not proof the student read it','responses'),
  ...supportPriorities.map((p) => metric(`priority_${p}`,p.charAt(0).toUpperCase()+p.slice(1),`Current priority = ${p}`,'Not historical priority changes','priority')),
  ...supportCategories.map((c) => metric(`category_${c}`,c.charAt(0).toUpperCase()+c.slice(1),`Current category = ${c}`,'Not historical reclassification','category')),
  metric('firstReplySamples','First-reply timing samples','Cases with a public staff comment','Unanswered cases and private notes','timing'),
  metric('meanFirstReplyMinutes','Mean first public reply','Mean elapsed UTC minutes from creation to first public staff comment','Not business hours, a reopening-cycle duration, delivery or approved SLA','timing','minutes'),
  metric('resolvedSamples','Resolution timing samples','Currently resolved or closed cases with a retained resolution timestamp','Active and reopened cases','timing'),
  metric('meanResolutionMinutes','Mean current resolution duration','Mean elapsed UTC minutes from original creation to current retained resolution','Closed cases retain their resolution time; includes time before reopening; not handling time or approved SLA','timing','minutes')
]);
export function supportReportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['intakeId','category','priority','from','to','format'].includes(k))) throw requestError(400,'Unsupported support report filter.');
  const {intakeId = '',category = '',priority = '',from = '',to = '',format = 'json'} = input;
  if (typeof intakeId !== 'string' || intakeId.length > 160 || /[\r\n\0]/.test(intakeId) || typeof from !== 'string' || typeof to !== 'string' || !['json','csv'].includes(format) || !['',...supportCategories].includes(category) || !['',...supportPriorities].includes(priority)) throw requestError(400,'Use bounded support report filters.');
  if (Boolean(from) !== Boolean(to)) throw requestError(400,'Choose both created-date bounds or leave both empty.');
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < '0001-01-01') throw requestError(400,'Use valid UTC calendar dates.');
    parseEffectiveDate(from);parseEffectiveDate(to);
    const days = (Date.parse(to)-Date.parse(from))/86400000;
    if (days < 0 || days > 365) throw requestError(400,'Choose an inclusive created-date range of at most 366 days.');
  }
  return {intakeId:intakeId.trim(),category,priority,from,to,format};
}
const empty = () => Object.fromEntries(supportMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
export function supportReportControls(c) {
  const sample = (count,value) => count === 0 ? value === null : Number.isFinite(value) && value >= 0;
  return {
    statusReconciles:c.casesTotal === c.open+c.inProgress+c.waitingStudent+c.resolved+c.closed,
    priorityReconciles:c.casesTotal === supportPriorities.reduce((n,p) => n+c[`priority_${p}`],0),
    categoryReconciles:c.casesTotal === supportCategories.reduce((n,p) => n+c[`category_${p}`],0),
    workloadReconciles:c.activeCases === c.open+c.inProgress+c.waitingStudent && c.ownerAccounts <= c.casesTotal && c.programmeRecords <= c.casesTotal && [c.unassignedActive,c.escalatedActive,c.urgentActive].every((n) => n <= c.activeCases),
    repliesReconcile:c.publiclyAnswered === c.firstReplySamples && c.publiclyAnswered <= c.casesTotal && c.activeCases === c.awaitingFirstReply+c.activePubliclyAnswered && c.activePubliclyAnswered <= c.publiclyAnswered,
    timingReconciles:c.resolvedSamples === c.resolved+c.closed && sample(c.firstReplySamples,c.meanFirstReplyMinutes) && sample(c.resolvedSamples,c.meanResolutionMinutes)
  };
}
const csvCell = (v) => {const raw = String(v ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function supportReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_intake','current_category','current_priority','created_from_utc','created_to_utc','row_type','intake_id','programme_code','intake','metric_id','unit','value',...Object.keys(report.controls)];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.intakeId,report.filters.category,report.filters.priority,report.filters.from,report.filters.to];
  const rows = [];
  for (const row of [{type:'total',counts:report.totals,controls:report.controls},...report.rows.map((r) => ({...r,type:'intake'}))]) for (const m of supportMetrics) rows.push([...prefix,row.type,row.intakeId || '',row.programmeCode || '',row.label || '',m.id,m.unit,row.counts[m.id],...Object.values(row.controls)]);
  return [header,...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
const authority = (actor) => {if (!actor.permissions.includes('support.view')) throw requestError(403,'Support viewing authority is required.');};
async function visibleIntakes(db,actor) {
  return (await db.query('select i.id as "intakeId",i.label,i.status,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code,i.id')).rows.filter((r) => supportCan(actor,r,'support.view'));
}
export function createSupportReportingModule(pool) {
  const audit = (db,actor,action,metadata) => insertAudit(db,{actorId:actor.accountId,action:`reports.support.${action}`,subjectType:'StudentSupportOperationsReport',subjectId:supportMetricVersion,reason:'Scoped student support operations report',metadata});
  return {
    async supportMetricDictionary(actor) {authority(actor);return {definitionVersion:supportMetricVersion,metrics:supportMetrics};},
    async listSupportReportingIntakes(actor) {authority(actor);return withTransaction(pool,async (db) => {const rows = await visibleIntakes(db,actor);await audit(db,actor,'intakes.accessed',{intakeCount:rows.length});return rows;});},
    async supportOperationsReport(input,actor) {
      authority(actor);const filters = supportReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        if (filters.to && filters.to > generatedAt.slice(0,10)) throw requestError(400,'Created-date bounds cannot extend beyond the current UTC date.');
        const availableIntakes = await visibleIntakes(db,actor),selected = availableIntakes.filter((r) => !filters.intakeId || r.intakeId === filters.intakeId);
        if (filters.intakeId && !selected.length) throw requestError(404,'Support reporting intake was not found.');
        const ids = selected.map((r) => r.intakeId),bounds = [ids,filters.from ? `${filters.from}T00:00:00.000Z` : null,filters.to ? new Date(Date.parse(filters.to)+86400000).toISOString() : null,filters.category,filters.priority];
        const cohort = `c.intake_id = any($1::text[]) and ($2::timestamptz is null or c.created_at >= $2) and ($3::timestamptz is null or c.created_at < $3) and ($4::text = '' or c.category = $4) and ($5::text = '' or c.priority = $5)`;
        // Case custody is immutable; transfers create new programme records, not a new intake for this case.
        if (ids.length && (await db.query(`select 1 from support_cases c join student_programmes sp on sp.id = c.student_programme_id where ${cohort} and (
          sp.intake_id is distinct from c.intake_id or c.created_at > transaction_timestamp() or c.updated_at < c.created_at or c.updated_at > transaction_timestamp()
          or c.resolved_at < c.created_at or c.resolved_at > transaction_timestamp() or c.closed_at < c.resolved_at or c.closed_at > transaction_timestamp()
          or not exists(select 1 from support_case_history h where h.case_id = c.id and h.revision = c.revision and h.to_status = c.status
            and h.category = c.category and h.priority = c.priority and h.assignee_id is not distinct from c.assignee_id and h.escalated = c.escalated and h.escalation_level = c.escalation_level)
          or exists(select 1 from support_case_comments m where m.case_id = c.id and (m.created_at < c.created_at or m.created_at > transaction_timestamp()))
        ) limit 1`,bounds)).rows.length) throw requestError(409,'Support custody, history or timestamps require reconciliation before reporting.');
        const aggregates = ids.length ? (await db.query(`with cohort as (
          select c.intake_id,c.student_programme_id,s.account_id as owner_id,c.status,c.priority,c.category,c.assignee_id,c.escalated,c.created_at,c.resolved_at,
            c.status not in ('resolved','closed') as active,
            (select min(m.created_at) from support_case_comments m where m.case_id = c.id and m.author_kind = 'staff' and m.visibility = 'public') as first_reply_at
          from support_cases c join student_programmes sp on sp.id = c.student_programme_id join students s on s.id = sp.student_id where ${cohort}
        ) select intake_id as "intakeId",count(*)::integer as "casesTotal",count(distinct owner_id)::integer as "ownerAccounts",count(distinct student_programme_id)::integer as "programmeRecords",
          count(*) filter(where status = 'open')::integer as "open",count(*) filter(where status = 'in_progress')::integer as "inProgress",count(*) filter(where status = 'waiting_student')::integer as "waitingStudent",
          count(*) filter(where status = 'resolved')::integer as "resolved",count(*) filter(where status = 'closed')::integer as "closed",
          count(*) filter(where active)::integer as "activeCases",count(*) filter(where active and assignee_id is null)::integer as "unassignedActive",
          count(*) filter(where active and escalated)::integer as "escalatedActive",count(*) filter(where active and priority = 'urgent')::integer as "urgentActive",
          count(first_reply_at)::integer as "publiclyAnswered",count(*) filter(where active and first_reply_at is null)::integer as "awaitingFirstReply",count(*) filter(where active and first_reply_at is not null)::integer as "activePubliclyAnswered",
          ${supportPriorities.map((p) => `count(*) filter(where priority = '${p}')::integer as "priority_${p}"`).join(',')},
          ${supportCategories.map((p) => `count(*) filter(where category = '${p}')::integer as "category_${p}"`).join(',')},
          count(first_reply_at)::integer as "firstReplySamples",avg(extract(epoch from first_reply_at-created_at)/60)::double precision as "meanFirstReplyMinutes",
          count(resolved_at)::integer as "resolvedSamples",avg(extract(epoch from resolved_at-created_at)/60)::double precision as "meanResolutionMinutes"
        from cohort group by grouping sets ((intake_id),())`,bounds)).rows : [];
        const byId = new Map(aggregates.map(({intakeId,...counts}) => [intakeId,counts])),totals = byId.get(null) || empty();
        const rows = selected.map((r) => {const counts = byId.get(r.intakeId) || empty();return {...r,counts,controls:supportReportControls(counts)};});
        const controls = Object.fromEntries(Object.entries(supportReportControls(totals)).map(([k,v]) => [k,v && rows.every((r) => r.controls[k])]));
        const report = {definitionVersion:supportMetricVersion,generatedAt,filters,availableIntakes,metrics:supportMetrics,totals,rows,controls};
        await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{definitionVersion:supportMetricVersion,intakeCount:rows.length,caseCount:totals.casesTotal,from:filters.from,to:filters.to,category:filters.category,priority:filters.priority,controls});
        return filters.format === 'csv' ? {filename:'student-support-operations.csv',csv:supportReportCsv(report),definitionVersion:supportMetricVersion,generatedAt} : report;
      });
    }
  };
}
