import {actorCanAccessScope,insertAudit,requestError,withTransaction} from '../support.js';

export const academicReportPermissions = Object.freeze(['results.view','academic.view','registry.view','registry.award.request','registry.award.approve']);
const awardPermissions = ['registry.view','academic.view','registry.award.request','registry.award.approve'];
export const academicMetricVersion = 'academic-outcome-operations-v1';
const metric = (id,label,formula,exclusions,group,unit = 'records') => Object.freeze({id,label,formula,exclusions,group,unit,
  owner:group === 'awards' ? 'Registry awards office (proposed)' : 'Academic and examinations office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current permission-specific intake scope; optional intake/domain; all retained periods and current statuses',
  refresh:'On request; one repeatable-read snapshot. Not historical eligibility reconstruction, a retention/graduation rate or unique-person census.'});
export const academicMetrics = Object.freeze([
  metric('resultBatches','Retained result batches','Count result_batches for scoped periods','Includes rejected batches; not unique semesters','results','batches'),
  ...['draft','reviewed','rejected','published'].map((s) => metric(`${s}Batches`,`${s.charAt(0).toUpperCase()+s.slice(1)} batches`,`Current result batch status = ${s}`,'Not every historical transition','results','batches')),
  metric('confirmedEnrolments','Retained confirmed course enrolments','Count course enrolments bound to confirmed registrations','Not current attendance/access, unique students or recognized credits','results','enrolments'),
  metric('officialResults','Current official result records','Published-batch academic_results bound to scoped confirmed enrolments','Amendments replace the current snapshot; not latest-attempt completion/GPA','results','results'),
  metric('withoutOfficialResult','Enrolments without an official result','Confirmed course enrolments with no published official result','Includes future/open periods; not necessarily overdue or failed','results','enrolments'),
  metric('passingResults','Passing official results','Current official snapshot passing = true','Retained attempts, not unique passed courses/students or a standardized pass rate','results','results'),
  metric('failingResults','Non-passing official results','Current official snapshot passing = false','Published attempts only; absent results are not fails','results','results'),
  metric('amendedResults','Amended official result records','Current official result revision > 0','Not amendment request/event counts','results','results'),
  metric('resultProgrammeRecords','Programme records with official results','Direct distinct programme IDs across official result records','Not unique people; intake counts are not additive','results','programme records'),
  metric('markSamples','Official mark samples','Current official result records with a valid whole-number mark','Unpublished and missing results','results','results'),
  metric('meanOfficialMark','Mean current official mark','Direct arithmetic mean of current official marks, each retained attempt once','Not credit-weighted GPA, latest-attempt performance, standardized classification or an approved comparison across grading policies','results','mark points'),
  metric('decisionRecords','Retained academic decisions','Count progression/repeat decision records','Includes superseded, expired and evidence-stale records','decisions'),
  ...['requested','approved','rejected'].map((s) => metric(`${s}Decisions`,`${s.charAt(0).toUpperCase()+s.slice(1)} decisions`,`Current decision status = ${s}`,'Approval alone is not current registration eligibility; no latest/evidence/revision evaluation','decisions')),
  metric('progressionDecisions','Progression decision records','Retained kind = progression','Not progressed/retained student headcount or confirmed next-year registrations','decisions'),
  metric('repeatDecisions','Repeat decision records','Retained kind = repeat','Not actual confirmed repeat attempts','decisions'),
  metric('expiredApprovals','Date-expired approved decisions','Approved records with expires_on before snapshot UTC date','Only calendar expiry, not every reason an approval may be unusable','decisions'),
  metric('decisionProgrammeRecords','Programme records with decisions','Direct distinct programme IDs across retained decisions','Not unique people; intake counts are not additive','decisions','programme records'),
  metric('awardRequests','Retained award requests','Count retained award_requests','Repeated rejected/requested records are not unique people','awards'),
  ...['requested','approved','rejected'].map((s) => metric(`${s}Awards`,s === 'approved' ? 'Approved conferral records' : `${s.charAt(0).toUpperCase()+s.slice(1)} award requests`,`Current award request status = ${s}`,'Retained approval/queue record, not a graduation rate or current readiness assessment','awards')),
  metric('awardedProgrammeRecords','Programme records with an approved award','Direct distinct programme IDs with an approved award','Not unique graduates or certificates issued','awards','programme records'),
  metric('completedProgrammeRecords','Completed programme records','Current programme status completed','Reconciles to retained approved award and completion history; not a census denominator','awards','programme records')
]);
export function academicReportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['intakeId','domain','format'].includes(k))) throw requestError(400,'Unsupported academic report filter.');
  const {intakeId = '',domain = '',format = 'json'} = input;
  if (typeof intakeId !== 'string' || intakeId.length > 160 || /[\r\n\0]/.test(intakeId) || !['','results','decisions','awards'].includes(domain) || !['json','csv'].includes(format)) throw requestError(400,'Use bounded academic report filters.');
  return {intakeId:intakeId.trim(),domain,format};
}
const empty = () => Object.fromEntries(academicMetrics.map((m) => [m.id,m.unit === 'mark points' ? null : 0]));
export function academicDomainAuthority(actor,row) {
  const can = (permission) => Boolean(permission && actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},row));
  // Mirror the native award GET's first granted permission, not a union that could widen its scope.
  return {results:can('results.view'),decisions:can('academic.view'),awards:can(awardPermissions.find((p) => actor.permissions.includes(p)))};
}
export function academicReportControls(c,authority = {results:true,decisions:true,awards:true}) {
  return {
    resultsReconcile:authority.results ? c.resultBatches === c.draftBatches+c.reviewedBatches+c.rejectedBatches+c.publishedBatches && c.confirmedEnrolments === c.officialResults+c.withoutOfficialResult && c.officialResults === c.passingResults+c.failingResults && c.markSamples === c.officialResults && c.amendedResults <= c.officialResults && c.resultProgrammeRecords <= c.officialResults && (c.markSamples ? Number.isFinite(c.meanOfficialMark) && c.meanOfficialMark >= 0 && c.meanOfficialMark <= 100 : c.meanOfficialMark === null) : null,
    decisionsReconcile:authority.decisions ? c.decisionRecords === c.requestedDecisions+c.approvedDecisions+c.rejectedDecisions && c.decisionRecords === c.progressionDecisions+c.repeatDecisions && c.expiredApprovals <= c.approvedDecisions && c.decisionProgrammeRecords <= c.decisionRecords : null,
    awardsReconcile:authority.awards ? c.awardRequests === c.requestedAwards+c.approvedAwards+c.rejectedAwards && c.approvedAwards === c.awardedProgrammeRecords && c.completedProgrammeRecords === c.awardedProgrammeRecords : null
  };
}
const csvCell = (v) => {const raw = String(v ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function academicReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','filter_intake','filter_domain','row_type','intake_id','programme_code','intake','results_authority','decisions_authority','awards_authority','metric_id','unit','value',...Object.keys(report.controls)];
  const prefix = [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.intakeId,report.filters.domain],rows = [];
  for (const row of [{counts:report.totals,controls:report.controls,authority:report.authority,type:'total'},...report.rows.map((r) => ({...r,type:'intake'}))]) for (const m of academicMetrics) rows.push([...prefix,row.type,row.intakeId || '',row.programmeCode || '',row.label || '',row.authority.results,row.authority.decisions,row.authority.awards,m.id,m.unit,row.counts[m.id],...Object.values(row.controls)]);
  return [header,...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
const authority = (actor) => {if (!academicReportPermissions.some((p) => actor.permissions.includes(p))) throw requestError(403,'Academic report viewing authority is required.');};
async function visibleIntakes(db,actor,domain = '') {
  return (await db.query('select i.id as "intakeId",i.label,i.status,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code,i.id')).rows
    .map((r) => ({...r,authority:academicDomainAuthority(actor,r)})).filter((r) => domain ? r.authority[domain] : Object.values(r.authority).some(Boolean));
}
export function createAcademicReportingModule(pool) {
  const audit = (db,actor,action,metadata) => insertAudit(db,{actorId:actor.accountId,action:`reports.academic.${action}`,subjectType:'AcademicOutcomeOperationsReport',subjectId:academicMetricVersion,reason:'Scoped academic outcome operations report',metadata});
  return {
    async academicMetricDictionary(actor) {authority(actor);return {definitionVersion:academicMetricVersion,metrics:academicMetrics};},
    async listAcademicReportingIntakes(actor) {authority(actor);return withTransaction(pool,async (db) => {const rows = await visibleIntakes(db,actor);await audit(db,actor,'intakes.accessed',{intakeCount:rows.length});return rows;});},
    async academicOperationsReport(input,actor) {
      authority(actor);const filters = academicReportFilters(input),granted = {results:actor.permissions.includes('results.view'),decisions:actor.permissions.includes('academic.view'),awards:awardPermissions.some((p) => actor.permissions.includes(p))};
      if (filters.domain && !granted[filters.domain]) throw requestError(403,'Viewing authority for this academic report domain is required.');
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const availableIntakes = await visibleIntakes(db,actor),selected = availableIntakes.filter((r) => (!filters.domain || r.authority[filters.domain]) && (!filters.intakeId || r.intakeId === filters.intakeId));
        if (filters.intakeId && !selected.length) throw requestError(404,'Academic reporting intake was not found for this domain.');
        const domainIds = Object.fromEntries(['results','decisions','awards'].map((d) => [d,selected.filter((r) => (!filters.domain || filters.domain === d) && r.authority[d]).map((r) => r.intakeId)]));
        const ids = [...new Set(Object.values(domainIds).flat())];
        if (ids.length && (await db.query(`select 1 from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
          join programme_versions pv on pv.id = sp.programme_version_id
          where sp.intake_id = any($1::text[]) and pv.programme_id is distinct from i.programme_id limit 1`,[ids])).rows.length) throw requestError(409,'Academic programme scope bindings require reconciliation.');
        const byId = new Map(),merge = (rows) => {for (const {intakeId,...counts} of rows) byId.set(intakeId,{...empty(),...byId.get(intakeId),...counts});};
        if (domainIds.results.length) {
          const values = [domainIds.results];
          if ((await db.query(`select 1 from student_registrations sr join registration_periods rp on rp.id = sr.period_id join student_programmes sp on sp.id = sr.student_programme_id where rp.intake_id = any($1::text[]) and (
            sp.intake_id is distinct from rp.intake_id or sp.programme_version_id is distinct from rp.programme_version_id
            or exists(select 1 from course_enrolments ce where ce.registration_id = sr.id and (sr.status <> 'confirmed' or ce.student_id is distinct from sp.student_id or ce.academic_period_id is distinct from rp.academic_period_id))
            or sr.status = 'confirmed' and (jsonb_typeof(sr.selected_courses) is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(sr.selected_courses) = 'array' then sr.selected_courses else '[]'::jsonb end) <> (select count(*) from course_enrolments ce where ce.registration_id = sr.id)
              or exists(select 1 from course_enrolments ce where ce.registration_id = sr.id and not (sr.selected_courses ? ce.course_id)))
          ) limit 1`,values)).rows.length) throw requestError(409,'Academic result enrolment custody requires reconciliation.');
          if ((await db.query(`select 1 from result_batches rb join registration_periods rp on rp.id = rb.period_id where rp.intake_id = any($1::text[]) and (
            jsonb_typeof(rb.rows) is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(rb.rows) = 'array' then rb.rows else '[]'::jsonb end) <> rb.row_count
            or rb.created_at > transaction_timestamp() or rb.reviewed_at < rb.created_at or rb.reviewed_at > transaction_timestamp() or rb.published_at < rb.reviewed_at or rb.published_at > transaction_timestamp()
            or (rb.status = 'draft') <> (rb.reviewed_by is null) or (rb.status = 'published') <> (rb.published_at is not null)
            or rb.status <> 'draft' and rb.reviewed_at is null
            or rb.row_count <> (select count(*) from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id where sr.period_id = rb.period_id and sr.status = 'confirmed')
            or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(rb.rows) = 'array' then rb.rows else '[]'::jsonb end) original where
              jsonb_typeof(original->'mark') is distinct from 'number' or case when jsonb_typeof(original->'mark') = 'number' then (original->>'mark')::numeric not between 0 and 100 or (original->>'mark')::numeric <> trunc((original->>'mark')::numeric) else true end
              or not exists(select 1 from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id where sr.period_id = rb.period_id and sr.status = 'confirmed' and ce.registration_id = original->>'registrationId' and ce.course_id = original->>'courseId'))
            or (select count(distinct (original->>'registrationId',original->>'courseId')) from jsonb_array_elements(case when jsonb_typeof(rb.rows) = 'array' then rb.rows else '[]'::jsonb end) original) <> rb.row_count
            or (select coalesce(sum(case when jsonb_typeof(original->'mark') = 'number' then (original->>'mark')::numeric else null end),0) from jsonb_array_elements(case when jsonb_typeof(rb.rows) = 'array' then rb.rows else '[]'::jsonb end) original) <> rb.mark_total
            or rb.status = 'published' and (rb.reviewed_at is null or rb.published_by is null or rb.published_by = rb.created_by or rb.row_count <> (select count(*) from academic_results ar where ar.batch_id = rb.id))
          ) limit 1`,values)).rows.length) throw requestError(409,'Academic result batch controls require reconciliation.');
          if ((await db.query(`select 1 from academic_results ar join student_registrations sr on sr.id = ar.registration_id join registration_periods rp on rp.id = sr.period_id join result_batches rb on rb.id = ar.batch_id
            where (rp.intake_id = any($1::text[]) or exists(select 1 from registration_periods brp where brp.id = rb.period_id and brp.intake_id = any($1::text[]))) and (
              rb.period_id is distinct from sr.period_id or rb.status <> 'published' or sr.status <> 'confirmed'
              or jsonb_typeof(ar.result_snapshot->'mark') is distinct from 'number' or jsonb_typeof(ar.result_snapshot->'passing') is distinct from 'boolean'
              or case when jsonb_typeof(ar.result_snapshot->'mark') = 'number' then (ar.result_snapshot->>'mark')::numeric not between 0 and 100 or (ar.result_snapshot->>'mark')::numeric <> trunc((ar.result_snapshot->>'mark')::numeric) else true end
              or ar.revision = 0 and (ar.amended_at is not null or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(rb.rows) = 'array' then rb.rows else '[]'::jsonb end) original where original = ar.result_snapshot))
              or ar.revision > 0 and (ar.amended_at is null or ar.amended_at < rb.published_at or ar.amended_at > transaction_timestamp() or not exists(select 1 from result_amendments a where a.registration_id = ar.registration_id and a.course_id = ar.course_id and a.batch_id = ar.batch_id and a.status = 'approved' and a.result_revision = ar.revision-1 and a.to_snapshot = ar.result_snapshot and a.reviewed_at = ar.amended_at))
            ) limit 1`,values)).rows.length) throw requestError(409,'Official result publication/amendment evidence requires reconciliation.');
          merge((await db.query(`select rp.intake_id as "intakeId",count(*)::integer as "resultBatches",${['draft','reviewed','rejected','published'].map((s) => `count(*) filter(where rb.status = '${s}')::integer as "${s}Batches"`).join(',')}
            from result_batches rb join registration_periods rp on rp.id = rb.period_id where rp.intake_id = any($1::text[]) group by grouping sets ((rp.intake_id),())`,values)).rows);
          merge((await db.query(`select rp.intake_id as "intakeId",count(*)::integer as "confirmedEnrolments",count(ar.registration_id)::integer as "officialResults",count(*) filter(where ar.registration_id is null)::integer as "withoutOfficialResult",
            count(*) filter(where (ar.result_snapshot->>'passing')::boolean)::integer as "passingResults",count(*) filter(where (ar.result_snapshot->>'passing')::boolean = false)::integer as "failingResults",count(*) filter(where ar.revision > 0)::integer as "amendedResults",
            count(distinct sr.student_programme_id) filter(where ar.registration_id is not null)::integer as "resultProgrammeRecords",count(ar.registration_id)::integer as "markSamples",avg((ar.result_snapshot->>'mark')::numeric)::double precision as "meanOfficialMark"
            from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join registration_periods rp on rp.id = sr.period_id left join academic_results ar on ar.registration_id = ce.registration_id and ar.course_id = ce.course_id
            where rp.intake_id = any($1::text[]) and sr.status = 'confirmed' group by grouping sets ((rp.intake_id),())`,values)).rows);
        }
        if (domainIds.decisions.length) {
          const values = [domainIds.decisions];
          if ((await db.query(`select 1 from academic_decisions d join student_programmes sp on sp.id = d.student_programme_id join registration_periods rp on rp.id = d.period_id join academic_policies p on p.id = d.policy_id
            where (sp.intake_id = any($1::text[]) or rp.intake_id = any($1::text[])) and (sp.intake_id is distinct from rp.intake_id or sp.programme_version_id is distinct from rp.programme_version_id or p.programme_version_id is distinct from sp.programme_version_id
              or d.requested_at > transaction_timestamp() or d.reviewed_at < d.requested_at or d.reviewed_at > transaction_timestamp() or (d.status = 'requested') <> (d.reviewed_by is null) or d.status <> 'requested' and d.reviewed_at is null
              or d.status = 'approved' and (d.reviewed_by = d.requested_by or d.expires_on < (d.reviewed_at at time zone 'UTC')::date or d.assessment->'ready' is distinct from 'true'::jsonb)) limit 1`,values)).rows.length) throw requestError(409,'Academic decision custody/review evidence requires reconciliation.');
          merge((await db.query(`select sp.intake_id as "intakeId",count(*)::integer as "decisionRecords",${['requested','approved','rejected'].map((s) => `count(*) filter(where d.status = '${s}')::integer as "${s}Decisions"`).join(',')},
            count(*) filter(where d.kind = 'progression')::integer as "progressionDecisions",count(*) filter(where d.kind = 'repeat')::integer as "repeatDecisions",count(*) filter(where d.status = 'approved' and d.expires_on < (transaction_timestamp() at time zone 'UTC')::date)::integer as "expiredApprovals",count(distinct d.student_programme_id)::integer as "decisionProgrammeRecords"
            from academic_decisions d join student_programmes sp on sp.id = d.student_programme_id where sp.intake_id = any($1::text[]) group by grouping sets ((sp.intake_id),())`,values)).rows);
        }
        if (domainIds.awards.length) {
          const values = [domainIds.awards];
          if ((await db.query(`select 1 from award_requests a join student_programmes sp on sp.id = a.student_programme_id join completion_rules cr on cr.id = a.completion_rule_id where sp.intake_id = any($1::text[]) and (
            cr.programme_version_id is distinct from sp.programme_version_id or cr.status = 'draft' or cr.published_at is null or a.audit->'eligible' is distinct from 'true'::jsonb or a.requested_at > transaction_timestamp() or a.reviewed_at < a.requested_at or a.reviewed_at > transaction_timestamp()
            or a.status <> 'requested' and a.reviewed_at is null or a.status = 'approved' and (sp.status <> 'completed' or a.reviewed_by = a.requested_by or not exists(select 1 from student_programme_history h where h.student_programme_id = sp.id and h.award_request_id = a.id and h.to_status = 'completed' and h.actor_id = a.reviewed_by))
          ) limit 1`,values)).rows.length) throw requestError(409,'Award request/completion history evidence requires reconciliation.');
          if ((await db.query(`select 1 from student_programmes sp where sp.intake_id = any($1::text[]) and sp.status = 'completed' and not exists(select 1 from award_requests a where a.student_programme_id = sp.id and a.status = 'approved') limit 1`,values)).rows.length) throw requestError(409,'Completed programmes require retained approved award evidence.');
          merge((await db.query(`select sp.intake_id as "intakeId",count(a.id)::integer as "awardRequests",${['requested','approved','rejected'].map((s) => `count(*) filter(where a.status = '${s}')::integer as "${s}Awards"`).join(',')},
            count(distinct sp.id) filter(where a.status = 'approved')::integer as "awardedProgrammeRecords",count(distinct sp.id) filter(where sp.status = 'completed')::integer as "completedProgrammeRecords"
            from student_programmes sp left join award_requests a on a.student_programme_id = sp.id where sp.intake_id = any($1::text[]) group by grouping sets ((sp.intake_id),())`,values)).rows);
        }
        const selectedAuthority = Object.fromEntries(['results','decisions','awards'].map((d) => [d,granted[d] && (!filters.domain || filters.domain === d) && selected.every((r) => r.authority[d])]));
        const mask = (counts,authority) => {for (const m of academicMetrics) if (!authority[m.group]) counts[m.id] = null;return counts;};
        const totals = mask(byId.get(null) || empty(),selectedAuthority),rows = selected.map((r) => {const effective = Object.fromEntries(Object.entries(r.authority).map(([d,v]) => [d,v && (!filters.domain || filters.domain === d)])),counts = mask(byId.get(r.intakeId) || empty(),effective);return {...r,authority:effective,counts,controls:academicReportControls(counts,effective)};});
        const controls = Object.fromEntries(Object.entries(academicReportControls(totals,selectedAuthority)).map(([k,v]) => [k,v === null ? null : v && rows.every((r) => r.controls[k] !== false)]));
        const report = {definitionVersion:academicMetricVersion,generatedAt,filters,availableIntakes,metrics:academicMetrics,totals,rows,controls,authority:selectedAuthority};
        await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{definitionVersion:academicMetricVersion,intakeCount:rows.length,domain:filters.domain,authority:selectedAuthority,controls});
        return filters.format === 'csv' ? {filename:'academic-outcome-operations.csv',csv:academicReportCsv(report),definitionVersion:academicMetricVersion,generatedAt} : report;
      });
    }
  };
}
