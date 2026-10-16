import {actorCanAccessScope,insertAudit,requestError,withTransaction} from '../support.js';
import {studyYearState} from './study-year.js';
import {programmeStates} from './registry-reporting.js';

export const continuationMetricVersion = 'confirmed-period-continuation-v1';
const metric = (id,label,formula,exclusions,unit = 'programme records') => Object.freeze({id,label,formula,exclusions,unit,
  owner:'Registry and academic management (proposed)',approval:'Development definition; owner approval pending',
  filters:'Explicit baseline and later follow-up registration periods in the same authorized intake; current retained confirmations',
  refresh:'One repeatable-read snapshot on request; not a historical census or approved retention rate'});
export const continuationMetrics = Object.freeze([
  metric('baselineProgrammeRecords','Baseline confirmed programme records','Distinct programme records with a confirmed registration in the baseline period','Not unique people, accepted applicants or a historical census'),
  metric('continuedProgrammeRecords','Confirmed in both periods','Baseline programme records also confirmed in the selected follow-up period','Includes future commitments and inactive programmes; not active attendance'),
  metric('withoutFollowupConfirmation','Without follow-up confirmation','Baseline records without a confirmed registration in the selected follow-up period','Includes unsaved and draft registrations; not dropouts, failures or overdue work'),
  metric('followupOnlyProgrammeRecords','Follow-up only programme records','Confirmed follow-up records absent from the baseline cohort','Excluded from the continuation numerator and denominator; transfers do not inherit source membership'),
  metric('baselineCourseEnrolments','Baseline retained course enrolments','Course enrolments on confirmed baseline registrations','Not active LMS access, attendance or recognized credit','enrolments'),
  metric('continuingCourseEnrolments','Follow-up enrolments of continuing records','Follow-up course enrolments for records confirmed in both periods','Not distinct courses/people, credit totals or passing outcomes','enrolments'),
  metric('followupCourseEnrolments','All retained follow-up enrolments','Course enrolments on all confirmed follow-up registrations','Includes follow-up-only records; not active access','enrolments'),
  metric('continuationSharePercent','Confirmed continuation share','100 * confirmed in both periods / baseline programme records; null for empty baseline or either period not started at snapshot UTC date','Development recorded-registration share, not approved retention, graduation or attendance rate','percent'),
  ...Object.entries(programmeStates).map(([id,status]) => metric(`${id}Baseline`,`${id === 'pendingOnboarding' ? 'Pending onboarding' : id.charAt(0).toUpperCase()+id.slice(1)} baseline records`,`Baseline programme records with CURRENT status ${status}`,'Current state, not status at either period start or a historical event')),
  metric('unclassifiedBaseline','Unclassified baseline states','Baseline records outside the recognized programme states','Source/definition review, not inferred lifecycle outcomes')
]);
export function continuationReportFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['baselinePeriodId','followupPeriodId','format'].includes(k))) throw requestError(400,'Unsupported continuation report filter.');
  const {baselinePeriodId,followupPeriodId,format = 'json'} = input;
  if ([baselinePeriodId,followupPeriodId].some((v) => typeof v !== 'string' || !v.trim() || v.length > 160 || /[\r\n\0]/.test(v)) || !['json','csv'].includes(format)) throw requestError(400,'Select an explicit baseline and follow-up period.');
  if (baselinePeriodId.trim() === followupPeriodId.trim()) throw requestError(400,'Choose two different registration periods.');
  return {baselinePeriodId:baselinePeriodId.trim(),followupPeriodId:followupPeriodId.trim(),format};
}
export function continuationCounts(raw,started) {
  const counts = Object.fromEntries(continuationMetrics.filter((m) => m.unit !== 'percent').map((m) => {
    const n = Number(raw[m.id] ?? 0);if (!Number.isSafeInteger(n) || n < 0) throw requestError(409,'Continuation counts exceed supported exact precision.');return [m.id,n];
  }));
  counts.continuationSharePercent = started && counts.baselineProgrammeRecords ? 100*counts.continuedProgrammeRecords/counts.baselineProgrammeRecords : null;
  return counts;
}
export function continuationControls(c) {
  return {cohortReconcile:c.baselineProgrammeRecords === c.continuedProgrammeRecords+c.withoutFollowupConfirmation,
    lifecycleReconcile:c.baselineProgrammeRecords === Object.keys(programmeStates).reduce((sum,k) => sum+c[`${k}Baseline`],c.unclassifiedBaseline),
    enrolmentsReconcile:c.continuingCourseEnrolments <= c.followupCourseEnrolments,
    shareReconcile:c.continuationSharePercent === null || Number.isFinite(c.continuationSharePercent) && c.continuationSharePercent >= 0 && c.continuationSharePercent <= 100};
}
const csvCell = (v) => {const raw = String(v ?? ''),safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;return `"${safe.replaceAll('"','""')}"`;};
export function continuationReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','programme_code','intake','baseline_period','followup_period','periods_started','metric_id','unit','value',...Object.keys(report.controls)];
  return [header,...report.metrics.map((m) => [report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.baseline.programmeCode,report.baseline.intakeLabel,report.baseline.name,report.followup.name,report.periodsStarted,m.id,m.unit,report.totals[m.id],...Object.values(report.controls)])].map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
async function periods(db,actor) {
  return (await db.query(`select rp.id as "periodId",rp.intake_id as "intakeId",p.code as "programmeCode",i.label as "intakeLabel",ap.name,
    to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn",rp.academic_period_id as "academicPeriodId",rp.programme_version_id as "programmeVersionId",rp.year_of_study as "yearOfStudy",rp.term,rp.status
    from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id order by ap.starts_on,p.code,rp.id`)).rows
    .filter((r) => actorCanAccessScope({...actor,authorizingPermission:'registry.view'},r));
}
export function createContinuationReportingModule(pool) {
  const authority = (actor) => {if (!actor.permissions.includes('registry.view')) throw requestError(403,'Registry viewing authority is required.');};
  const audit = (db,actor,action,metadata) => insertAudit(db,{actorId:actor.accountId,action:`reports.continuation.${action}`,subjectType:'ConfirmedPeriodContinuationReport',subjectId:continuationMetricVersion,reason:'Scoped confirmed-period cohort comparison',metadata});
  return {
    async continuationMetricDictionary(actor) {authority(actor);return {definitionVersion:continuationMetricVersion,metrics:continuationMetrics};},
    async listContinuationReportingPeriods(actor) {authority(actor);return withTransaction(pool,async (db) => {const rows = await periods(db,actor);await audit(db,actor,'periods.accessed',{periodCount:rows.length});return rows;});},
    async continuationOperationsReport(input,actor) {
      authority(actor);const filters = continuationReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString(),asOf = generatedAt.slice(0,10);
        const availablePeriods = await periods(db,actor),baseline = availablePeriods.find((p) => p.periodId === filters.baselinePeriodId),followup = availablePeriods.find((p) => p.periodId === filters.followupPeriodId);
        if (!baseline || !followup) throw requestError(404,'Continuation reporting period was not found.');
        if (baseline.intakeId !== followup.intakeId || followup.startsOn <= baseline.startsOn) throw requestError(400,'Follow-up must start later within the same intake.');
        const ids = [baseline.periodId,followup.periodId];
        if ((await db.query(`select 1 from registration_periods rp join intakes i on i.id = rp.intake_id join programme_versions pv on pv.id = rp.programme_version_id
          where rp.id = any($1::text[]) and pv.programme_id is distinct from i.programme_id
          union all select 1 from student_registrations sr join registration_periods rp on rp.id = sr.period_id join student_programmes sp on sp.id = sr.student_programme_id
          where rp.id = any($1::text[]) and (sp.intake_id is distinct from rp.intake_id or sp.programme_version_id is distinct from rp.programme_version_id
            or exists(select 1 from course_enrolments ce where ce.registration_id = sr.id and (sr.status <> 'confirmed' or ce.student_id is distinct from sp.student_id or ce.academic_period_id is distinct from rp.academic_period_id))
            or sr.status = 'confirmed' and (jsonb_typeof(sr.selected_courses) is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(sr.selected_courses) = 'array' then sr.selected_courses else '[]'::jsonb end) <> (select count(*) from course_enrolments ce where ce.registration_id = sr.id)
              or exists(select 1 from course_enrolments ce where ce.registration_id = sr.id and not (sr.selected_courses ? ce.course_id))
              or rp.year_of_study > 1 and not exists(select 1 from academic_decisions d join academic_policies p on p.id = d.policy_id
                where d.id::text = sr.confirmation->'academicEvidence'->'progression'->>'id' and d.student_programme_id = sr.student_programme_id and d.period_id = sr.period_id
                  and d.kind = 'progression' and d.status = 'approved' and p.programme_version_id = rp.programme_version_id
                  and d.policy_id = sr.confirmation->'academicEvidence'->'progression'->>'policyId' and d.evidence_hash = sr.confirmation->'academicEvidence'->'progression'->>'evidenceHash'))) limit 1`,[ids])).rows.length) throw requestError(409,'Continuation enrolment custody requires reconciliation.');
        // Read only receipt fields needed by the existing projection, never personal/clearance evidence.
        const receipts = (await db.query(`select sr.id as "registrationId",sr.period_id as "periodId",sr.reference_number as "referenceNumber",sr.confirmed_at as "storedConfirmedAt",
          sr.confirmation->>'referenceNumber' as "receiptReference",sr.confirmation->>'academicPeriodId' as "academicPeriodId",sr.confirmation->>'programmeVersionId' as "programmeVersionId",sr.confirmation->>'periodName' as "periodName",
          sr.confirmation->>'startsOn' as "startsOn",sr.confirmation->>'endsOn' as "endsOn",sr.confirmation->'yearOfStudy' as "yearOfStudy",sr.confirmation->>'term' as term,sr.confirmation->>'confirmedAt' as "confirmedAt",
          jsonb_build_object('id',sr.confirmation->'academicEvidence'->'progression'->'id','kind',sr.confirmation->'academicEvidence'->'progression'->'kind','status',sr.confirmation->'academicEvidence'->'progression'->'status','policyId',sr.confirmation->'academicEvidence'->'progression'->'policyId','evidenceHash',sr.confirmation->'academicEvidence'->'progression'->'evidenceHash') as progression
          from student_registrations sr where sr.period_id = any($1::text[]) and sr.status = 'confirmed'`,[ids])).rows;
        for (const r of receipts) {
          const p = r.periodId === baseline.periodId ? baseline : followup,recordedAt = new Date(r.storedConfirmedAt).getTime(),receiptAt = Date.parse(r.confirmedAt);
          if (studyYearState([r],'onboarded',asOf).state === 'reconciliation_required' || r.receiptReference !== r.referenceNumber
            || ['academicPeriodId','programmeVersionId','startsOn','endsOn','yearOfStudy','term'].some((k) => r[k] !== p[k])
            || !r.storedConfirmedAt || !Number.isFinite(recordedAt) || !Number.isFinite(receiptAt) || receiptAt > Date.parse(generatedAt) || recordedAt > Date.parse(generatedAt)) throw requestError(409,'Continuation confirmation receipts require reconciliation.');
        }
        const raw = (await db.query(`with confirmed as (select sr.student_programme_id,sr.period_id,count(ce.course_id)::bigint as enrolments from student_registrations sr left join course_enrolments ce on ce.registration_id = sr.id where sr.period_id = any($1::text[]) and sr.status = 'confirmed' group by sr.student_programme_id,sr.period_id),
          baseline as (select * from confirmed where period_id = $2),followup as (select * from confirmed where period_id = $3)
          select count(*) filter(where b.student_programme_id is not null)::bigint as "baselineProgrammeRecords",
            count(*) filter(where b.student_programme_id is not null and f.student_programme_id is not null)::bigint as "continuedProgrammeRecords",
            count(*) filter(where b.student_programme_id is not null and f.student_programme_id is null)::bigint as "withoutFollowupConfirmation",
            count(*) filter(where b.student_programme_id is null and f.student_programme_id is not null)::bigint as "followupOnlyProgrammeRecords",
            coalesce(sum(b.enrolments),0)::bigint as "baselineCourseEnrolments",coalesce(sum(f.enrolments) filter(where b.student_programme_id is not null),0)::bigint as "continuingCourseEnrolments",coalesce(sum(f.enrolments),0)::bigint as "followupCourseEnrolments",
            ${Object.entries(programmeStates).map(([k,s]) => `count(*) filter(where b.student_programme_id is not null and sp.status = '${s}')::bigint as "${k}Baseline"`).join(',')},
            count(*) filter(where b.student_programme_id is not null and sp.status not in (${Object.values(programmeStates).map((s) => `'${s}'`).join(',')}))::bigint as "unclassifiedBaseline"
          from baseline b full join followup f on f.student_programme_id = b.student_programme_id join student_programmes sp on sp.id = coalesce(b.student_programme_id,f.student_programme_id)`,[ids,baseline.periodId,followup.periodId])).rows[0];
        const periodsStarted = baseline.startsOn <= asOf && followup.startsOn <= asOf,totals = continuationCounts(raw,periodsStarted),controls = continuationControls(totals);
        if (Object.values(controls).some((v) => !v) || totals.baselineProgrammeRecords !== receipts.filter((r) => r.periodId === baseline.periodId).length || totals.continuedProgrammeRecords+totals.followupOnlyProgrammeRecords !== receipts.filter((r) => r.periodId === followup.periodId).length) throw requestError(409,'Continuation aggregate controls require reconciliation.');
        const report = {definitionVersion:continuationMetricVersion,generatedAt,asOf,filters,availablePeriods,baseline,followup,periodsStarted,metrics:continuationMetrics,totals,controls};
        await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{definitionVersion:continuationMetricVersion,baselinePeriodId:baseline.periodId,followupPeriodId:followup.periodId,periodsStarted,baselineProgrammeRecords:totals.baselineProgrammeRecords,continuedProgrammeRecords:totals.continuedProgrammeRecords,controls});
        return filters.format === 'csv' ? {filename:'confirmed-period-continuation.csv',csv:continuationReportCsv(report)} : report;
      });
    }
  };
}
