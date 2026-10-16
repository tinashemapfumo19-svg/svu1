import {actorCanAccessScope,insertAudit,requestError,withTransaction} from '../support.js';
import {finalMark,moderationComplete,moderationStages,submissionMatchesSheet,validateComponents} from './assessment.js';

export const assessmentReportPermissions = Object.freeze(['teaching.view','results.view','assessment.plan.manage','assessment.marks','assessment.review','assessment.moderate','assessment.external']);
export const assessmentMetricVersion = 'assessment-recording-operations-v1';
const metric = (id,label,formula,exclusions,group,unit='records') => Object.freeze({id,label,formula,exclusions,group,unit,
  owner:'Academic and examinations office (proposed)',approval:'Development definition; owner approval pending',
  filters:'Current staff permission-specific intake scope; optional intake, registration period and course; current approved plan',
  refresh:'On request in one repeatable-read source snapshot; not a historical census, student assignment-upload count or institutional SLA'});
export const assessmentMetrics = Object.freeze([
  metric('offerings','Course offerings','Selected registration offering records','Not distinct courses or students','plans','offerings'),
  metric('configuredOfferings','Offerings with an approved plan','Selected offerings with a current approved assessment plan','Draft plans do not configure a mark sheet','plans','offerings'),
  metric('unconfiguredOfferings','Offerings without an approved plan','Selected offerings minus configured offerings','Not necessarily overdue','plans','offerings'),
  metric('planVersions','Retained plan versions','All versions on selected offerings','Not distinct modules or approved institutional descriptors','plans','versions'),
  ...['draft','approved','superseded'].map((s) => metric(`${s}PlanVersions`,`${s.charAt(0).toUpperCase()+s.slice(1)} plan versions`,`Retained plan status = ${s}`,'Not every historic status transition','plans','versions')),
  metric('rosterEnrolments','Active confirmed course enrolments','Confirmed offering enrolments without a withdrawal marker','Not attendance, unique people or retained physical-enrolment census','plans','enrolments'),
  metric('configuredEnrolments','Enrolments under an approved plan','Active roster enrolments on configured offerings','Not unique students','plans','enrolments'),
  metric('unconfiguredEnrolments','Enrolments without an approved plan','Active roster enrolments on unconfigured offerings','No invented expected components','plans','enrolments'),
  metric('expectedCells','Expected component entries','Sum of active roster size times current approved component count','Draft/superseded plans and withdrawn enrolments','coverage','entries'),
  metric('populatedCells','Populated active component entries','Current-plan entries bound to active roster and declared component','No mark values or student identities are disclosed','coverage','entries'),
  metric('missingCells','Missing active component entries','Expected entries minus populated entries','Not student assignment non-submission or overdue work','coverage','entries'),
  ...['mark','absent','deferred','exempt'].map((s) => metric(`${s}Cells`,`${s.charAt(0).toUpperCase()+s.slice(1)} component entries`,`Populated active entries with state = ${s}`,'Component records, not student outcomes','coverage','entries')),
  metric('retainedCells','Retained current-plan entries','All component entries under the current approved plan','Not all historical plan versions or mark revisions','coverage','entries'),
  metric('outsideRosterCells','Entries outside the active roster','Retained current-plan entries bound to withdrawn enrolments','Retained evidence, not missing active work','coverage','entries'),
  ...[['final','finalEnrolments','Calculated final mark sheets'],['deferred','deferredEnrolments','Deferred mark sheets'],['exempt','exemptEnrolments','Exempt mark sheets'],['missing','incompleteEnrolments','Incomplete mark sheets']].map(([s,id,label]) => metric(id,label,`Current native finalMark state = ${s} on configured active roster`,'Not an official published result or student submission event','coverage','enrolments')),
  metric('submissions','Retained current-plan submissions','All retained mark-sheet submissions under current approved plans','Not student assignment uploads or historical superseded plan submissions','workflow','submissions'),
  ...['submitted','returned','approved','transferred','superseded'].map((s) => metric(`${s}Submissions`,`${s.charAt(0).toUpperCase()+s.slice(1)} mark-sheet submissions`,`Current submission status = ${s}`,'Not every transition; supersession preserves earlier evidence','workflow','submissions')),
  metric('awaitingInternal','Submitted sheets awaiting internal moderation','Current submitted sheet requiring an unsigned internal stage','May require return/resubmission; not necessarily overdue','workflow','submissions'),
  metric('awaitingExternal','Submitted sheets awaiting external moderation','Required internal stage signed but external stage not signed','External review cannot bypass native internal review','workflow','submissions'),
  metric('readyForReview','Submitted sheets with required sign-offs','Submitted sheet with native moderationComplete = true','Does not authorize review or bypass source freshness','workflow','submissions'),
  metric('changesRequested','Submitted sheets with requested changes','Submitted sheets with a changes_requested moderation decision','Overlaps moderation queue; not every historical return','workflow','submissions'),
  metric('approvedAllFinal','Approved sheets with current all-final source','Approved sheet with unchanged native source and only final states','Course-level evidence, not period transfer readiness or official publication','workflow','submissions'),
  metric('approvedWithheld','Approved sheets with changed or non-final source','Approved sheets minus approved current all-final sheets','Includes native deferred/exempt states; not failed students','workflow','submissions'),
  metric('changedLiveSources','Live sheets whose source changed','Native submissionMatchesSheet = false for submitted/approved/transferred sheets','A reconciliation workload, not repair or historical evidence deletion','workflow','submissions'),
  metric('oldestSubmittedHours','Oldest submitted sheet age (UTC hours)','Maximum elapsed submitted_at to snapshot time among submitted sheets; null when none','Elapsed calendar hours, not an approved business-hours SLA','workflow','hours')
]);
export function assessmentReportFilters(input={}) {
  if(!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !['intakeId','periodId','courseId','format'].includes(k)))throw requestError(400,'Unsupported assessment report filter.');
  const {intakeId='',periodId='',courseId='',format='json'}=input;
  if([intakeId,periodId,courseId].some((v) => typeof v !== 'string' || v.length > 160 || /[\r\n\0]/.test(v)) || !['json','csv'].includes(format))throw requestError(400,'Use bounded assessment report filters.');
  return {intakeId:intakeId.trim(),periodId:periodId.trim(),courseId:courseId.trim(),format};
}
export const assessmentReportScopeAllowed = (actor,row) => assessmentReportPermissions.some((p) => actor.permissions.includes(p) && actorCanAccessScope({...actor,authorizingPermission:p},row));
const empty = () => Object.fromEntries(assessmentMetrics.map((m) => [m.id,m.unit === 'hours' ? null : 0]));
const sourceFault = () => {throw requestError(409,'Assessment source evidence requires reconciliation.');};
const time = (v,now) => {const n=v instanceof Date ? v.getTime() : v == null ? NaN : Date.parse(v);if(!Number.isFinite(n) || n > now)sourceFault();return n;};
const key = (r) => JSON.stringify([r.periodId,r.courseId]);
export function assessmentOfferingCounts({offering,plans,roster,marks,submissions,moderations,editors},generatedAt) {
  const c=empty(),now=time(generatedAt,Infinity);c.offerings=1;c.planVersions=plans.length;
  const versions=new Set();for(const p of plans) {
    if(!['draft','approved','superseded'].includes(p.status) || !Number.isInteger(p.version) || p.version < 1 || versions.has(p.version))sourceFault();versions.add(p.version);c[`${p.status}PlanVersions`]++;
    try {validateComponents(p.components);moderationStages(p.moderation);}catch{sourceFault();}
  }
  if(c.approvedPlanVersions > 1 || new Set(roster.map((r) => r.registrationId)).size !== roster.length || roster.some((r) => !r.scopeValid || typeof r.active !== 'boolean' || r.registrationStatus !== 'confirmed'))sourceFault();
  for(const e of editors)if(!e.enteredBy || !Number.isFinite(time(e.firstEnteredAt,now)))sourceFault();
  const plan=plans.find((p) => p.status === 'approved'),active=roster.filter((r) => r.active),retainedIds=new Set(roster.map((r) => r.registrationId)),activeIds=new Set(active.map((r) => r.registrationId));
  c.rosterEnrolments=active.length;c.configuredOfferings=plan ? 1 : 0;c.unconfiguredOfferings=plan ? 0 : 1;c.configuredEnrolments=plan ? active.length : 0;c.unconfiguredEnrolments=plan ? 0 : active.length;
  if(!plan) {if(marks.length || submissions.length || moderations.length)sourceFault();return c;}
  const cells=new Set();for(const m of marks) {
    const component=plan.components.find((r) => r.code === m.componentCode),cell=JSON.stringify([m.registrationId,m.componentCode]);
    if(m.planId !== plan.id || !retainedIds.has(m.registrationId) || !component || cells.has(cell) || !['mark','absent','deferred','exempt'].includes(m.state) || !Number.isInteger(m.revision) || m.revision < 1
      || (m.state === 'mark' ? !Number.isInteger(m.mark) || m.mark < 0 || m.mark > component.maxMark : m.mark !== null))sourceFault();cells.add(cell);c.retainedCells++;
    if(activeIds.has(m.registrationId)) {c.populatedCells++;c[`${m.state}Cells`]++;}else c.outsideRosterCells++;
  }
  c.expectedCells=active.length*plan.components.length;c.missingCells=c.expectedCells-c.populatedCells;
  const students=active.map((r) => ({registrationId:r.registrationId,final:finalMark(plan.components,Object.fromEntries(marks.filter((m) => m.registrationId === r.registrationId).map((m) => [m.componentCode,m])))}));
  for(const s of students)c[({final:'finalEnrolments',deferred:'deferredEnrolments',exempt:'exemptEnrolments',missing:'incompleteEnrolments'})[s.final.state]]++;
  const sheet={students,marks,missing:c.missingCells ? [{}] : []},submissionIds=new Set();let live=0;
  for(const s of submissions) {
    if(s.planId !== plan.id || submissionIds.has(s.id) || !['submitted','returned','approved','transferred','superseded'].includes(s.status) || !/^[a-f0-9]{64}$/.test(s.marksHash || '') || !Array.isArray(s.finals) || !s.finals.length)sourceFault();submissionIds.add(s.id);
    const submitted=time(s.submittedAt,now),finalIds=new Set();for(const f of s.finals) {
      if(!retainedIds.has(f.registrationId) || finalIds.has(f.registrationId) || !['final','deferred','exempt'].includes(f.state) || (f.state === 'final' ? !Number.isInteger(f.mark) || f.mark < 0 || f.mark > 100 : f.mark !== null))sourceFault();finalIds.add(f.registrationId);
    }
    if(['returned','approved','transferred'].includes(s.status) && (!s.reviewedBy || s.reviewedBy === s.submittedBy || time(s.reviewedAt,now) < submitted) || (s.status === 'transferred' ? !s.resultBatchId || s.resultPeriodId !== offering.periodId : s.resultBatchId !== null))sourceFault();
    if(s.status === 'transferred') {
      if(!['draft','reviewed','published'].includes(s.resultStatus) || !Array.isArray(s.resultRows) || s.finals.some((f) => f.state !== 'final'))sourceFault();
      const recorded=s.resultRows.filter((r) => r.courseId === offering.courseId);
      if(recorded.length !== s.finals.length || new Set(recorded.map((r) => r.registrationId)).size !== recorded.length || recorded.some((r) => !s.finals.some((f) => f.registrationId === r.registrationId && f.mark === r.mark)))sourceFault();
    }
    if(s.status === 'superseded') {
      if(!s.completionId || s.completionStatus !== 'approved' || s.completionPlanId !== plan.id || s.completionSourceId !== s.id || s.completionMarksHash !== s.marksHash || !['submitted','approved'].includes(s.supersededFromStatus)
        || !s.completionReviewedBy || s.completionReviewedBy === s.completionSubmittedBy || s.completionReviewedBy !== s.supersededBy || time(s.completionSubmittedAt,now) < submitted
        || time(s.completionReviewedAt,now) < time(s.completionSubmittedAt,now) || time(s.supersededAt,now) !== time(s.completionReviewedAt,now))sourceFault();
    }else if(s.completionId != null)sourceFault();
    const reviews=moderations.filter((r) => r.submissionId === s.id),stages=new Set(),reviewers=new Set();for(const r of reviews) {
      if(!moderationStages(plan.moderation).includes(r.stage) || stages.has(r.stage) || reviewers.has(r.reviewedBy) || !['signed','changes_requested'].includes(r.outcome) || r.marksHash !== s.marksHash || !r.reviewedBy || r.reviewedBy === s.submittedBy || editors.some((e) => e.enteredBy === r.reviewedBy && time(e.firstEnteredAt,now) <= time(r.reviewedAt,now)) || time(r.reviewedAt,now) < submitted)sourceFault();stages.add(r.stage);reviewers.add(r.reviewedBy);
      if(r.stage === 'external') {const internal=reviews.find((x) => x.stage === 'internal');if(!internal || internal.outcome !== 'signed' || time(internal.reviewedAt,now) > time(r.reviewedAt,now))sourceFault();}
    }
    const complete=moderationComplete(plan.moderation,reviews,s.marksHash);if(['approved','transferred'].includes(s.status) && (!complete || reviews.some((r) => time(r.reviewedAt,now) > time(s.reviewedAt,now))))sourceFault();
    c.submissions++;c[`${s.status}Submissions`]++;
    if(['submitted','approved','transferred'].includes(s.status)) {
      if(++live > 1)sourceFault();const fresh=submissionMatchesSheet(s,sheet);if(!fresh)c.changedLiveSources++;
      if(fresh && s.finals.some((f) => {const expected=students.find((r) => r.registrationId === f.registrationId).final;return expected.state !== f.state || expected.mark !== f.mark;}))sourceFault();
      if(s.status === 'submitted') {
        c.oldestSubmittedHours=Math.max(c.oldestSubmittedHours ?? 0,(now-submitted)/3600000);if(reviews.some((r) => r.outcome === 'changes_requested'))c.changesRequested++;
        if(complete)c.readyForReview++;else if(moderationStages(plan.moderation).includes('internal') && !moderationComplete('internal',reviews,s.marksHash))c.awaitingInternal++;else c.awaitingExternal++;
      }
      if(s.status === 'approved') {if(fresh && s.finals.every((f) => f.state === 'final'))c.approvedAllFinal++;else c.approvedWithheld++;}
    }
  }
  if(moderations.some((r) => !submissionIds.has(r.submissionId)))sourceFault();return c;
}
export function assessmentReportControls(c) {
  return {plansReconcile:c.offerings === c.configuredOfferings+c.unconfiguredOfferings && c.planVersions === c.draftPlanVersions+c.approvedPlanVersions+c.supersededPlanVersions && c.approvedPlanVersions === c.configuredOfferings,
    rosterReconciles:c.rosterEnrolments === c.configuredEnrolments+c.unconfiguredEnrolments && c.configuredEnrolments === c.finalEnrolments+c.deferredEnrolments+c.exemptEnrolments+c.incompleteEnrolments,
    cellsReconcile:c.expectedCells === c.populatedCells+c.missingCells && c.populatedCells === c.markCells+c.absentCells+c.deferredCells+c.exemptCells && c.retainedCells === c.populatedCells+c.outsideRosterCells,
    submissionsReconcile:c.submissions === c.submittedSubmissions+c.returnedSubmissions+c.approvedSubmissions+c.transferredSubmissions+c.supersededSubmissions && c.submittedSubmissions === c.awaitingInternal+c.awaitingExternal+c.readyForReview && c.approvedSubmissions === c.approvedAllFinal+c.approvedWithheld && c.changesRequested <= c.submittedSubmissions && c.changedLiveSources <= c.submittedSubmissions+c.approvedSubmissions+c.transferredSubmissions,
    ageReconciles:c.submittedSubmissions ? Number.isFinite(c.oldestSubmittedHours) && c.oldestSubmittedHours >= 0 : c.oldestSubmittedHours === null};
}
const csvCell = (v) => {const s=String(v ?? ''),safe=/^[\s]*[=+@-]|^[\t\r\n]/.test(s) ? `'${s}` : s;return `"${safe.replaceAll('"','""')}"`;};
export function assessmentReportCsv(report) {
  const rows=[['definition_version','definition_approval','generated_at','filter_intake','filter_period','filter_course','row_type','intake_id','programme_code','intake','period_id','period','course_id','course','metric_id','unit','value',...Object.keys(report.controls)]];
  for(const r of [{counts:report.totals,controls:report.controls,type:'total'},...report.rows.map((r) => ({...r,type:'offering'}))])for(const m of report.metrics)rows.push([report.definitionVersion,'Development definition; owner approval pending',report.generatedAt,report.filters.intakeId,report.filters.periodId,report.filters.courseId,r.type,r.intakeId || '',r.programmeCode || '',r.intakeLabel || '',r.periodId || '',r.periodName || '',r.courseId || '',r.code || '',m.id,m.unit,r.counts[m.id],...Object.values(r.controls)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
const authority = (actor) => {if(!assessmentReportPermissions.some((p) => actor.permissions.includes(p)))throw requestError(403,'Staff assessment report viewing authority is required.');};
async function metadata(db,actor) {
  const availableIntakes=(await db.query('select i.id as "intakeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code,i.id')).rows.filter((r) => assessmentReportScopeAllowed(actor,r));
  if(!availableIntakes.length)return {availableIntakes,availablePeriods:[],availableCourses:[]};
  const availablePeriods=(await db.query(`select rp.id as "periodId",rp.intake_id as "intakeId",ap.name as "periodName",rp.status as "periodStatus" from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id where rp.intake_id = any($1::text[]) order by ap.starts_on desc,rp.id`,[availableIntakes.map((r) => r.intakeId)])).rows;
  const availableCourses=(await db.query(`select o.period_id as "periodId",o.course_id as "courseId",c.code,c.title,rp.intake_id as "intakeId" from registration_offerings o join courses c on c.id = o.course_id join registration_periods rp on rp.id = o.period_id where rp.intake_id = any($1::text[]) order by c.code,o.period_id`,[availableIntakes.map((r) => r.intakeId)])).rows;
  return {availableIntakes,availablePeriods,availableCourses};
}
export function createAssessmentReportingModule(pool) {
  const audit = (db,actor,action,extra) => insertAudit(db,{actorId:actor.accountId,action:`reports.assessment.${action}`,subjectType:'AssessmentOperationsReport',subjectId:assessmentMetricVersion,reason:'Scoped assessment operations report',metadata:{definitionVersion:assessmentMetricVersion,...extra}});
  return {
    async assessmentMetricDictionary(actor) {authority(actor);return {definitionVersion:assessmentMetricVersion,metrics:assessmentMetrics};},
    async assessmentReportingMetadata(actor) {authority(actor);return withTransaction(pool,async (db) => {await db.query('set transaction isolation level repeatable read');const data=await metadata(db,actor);await audit(db,actor,'metadata.accessed',{intakeCount:data.availableIntakes.length});return data;});},
    async assessmentOperationsReport(input,actor) {
      authority(actor);const filters=assessmentReportFilters(input);return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');const generatedAt=new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString(),available=await metadata(db,actor);
        let selection=available.availableIntakes.filter((r) => !filters.intakeId || r.intakeId === filters.intakeId);if(filters.intakeId && !selection.length)throw requestError(404,'Assessment reporting intake was not found.');
        const periods=available.availablePeriods.filter((r) => selection.some((i) => i.intakeId === r.intakeId) && (!filters.periodId || r.periodId === filters.periodId));if(filters.periodId && !periods.length)throw requestError(404,'Assessment reporting period was not found.');
        const offerings=available.availableCourses.filter((r) => periods.some((p) => p.periodId === r.periodId) && (!filters.courseId || r.courseId === filters.courseId));if(filters.courseId && !offerings.length)throw requestError(404,'Assessment reporting course was not found.');
        if(filters.periodId || filters.courseId)selection=selection.filter((r) => (filters.courseId ? offerings : periods).some((p) => p.intakeId === r.intakeId));
        const ids=selection.map((r) => r.intakeId);if(ids.length && (await db.query(`select 1 from registration_periods rp join intakes i on i.id = rp.intake_id join programme_versions pv on pv.id = rp.programme_version_id where rp.intake_id = any($1::text[]) and pv.programme_id is distinct from i.programme_id limit 1`,[ids])).rows.length)sourceFault();
        const rows=[],totals=empty();if(offerings.length) {
          const pairs=JSON.stringify(offerings.map(({periodId,courseId}) => ({periodId,courseId}))),selected=`in (select "periodId","courseId" from jsonb_to_recordset($1::jsonb) as selected("periodId" text,"courseId" text))`;
          const plans=(await db.query(`select p.id,p.period_id as "periodId",p.course_id as "courseId",p.version,p.status,p.components,p.moderation from assessment_plans p where (p.period_id,p.course_id) ${selected}`,[pairs])).rows;
          // The coordinated withdrawal marker is additive; absent markers are existing active custody.
          const roster=(await db.query(`select sr.period_id as "periodId",ce.course_id as "courseId",ce.registration_id as "registrationId",sr.status as "registrationStatus",to_jsonb(ce)->>'withdrawn_at' is null as active,
            (sp.student_id = ce.student_id and sp.intake_id = rp.intake_id and sp.programme_version_id = rp.programme_version_id) as "scopeValid"
            from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join student_programmes sp on sp.id = sr.student_programme_id join registration_periods rp on rp.id = sr.period_id where (sr.period_id,ce.course_id) ${selected}`,[pairs])).rows;
          const marks=(await db.query(`select p.period_id as "periodId",p.course_id as "courseId",m.plan_id as "planId",m.registration_id as "registrationId",m.component_code as "componentCode",m.state,m.mark,m.revision from assessment_marks m join assessment_plans p on p.id = m.plan_id where p.status = 'approved' and (p.period_id,p.course_id) ${selected}`,[pairs])).rows;
          const submissions=(await db.query(`select p.period_id as "periodId",p.course_id as "courseId",s.id::integer,s.plan_id as "planId",s.status,s.marks_hash as "marksHash",s.finals,s.submitted_by as "submittedBy",s.submitted_at as "submittedAt",s.reviewed_by as "reviewedBy",s.reviewed_at as "reviewedAt",s.result_batch_id as "resultBatchId",rb.period_id as "resultPeriodId",rb.status as "resultStatus",rb.rows as "resultRows",
            sx.previous_status as "supersededFromStatus",sx.recorded_at as "supersededAt",sx.actor_id as "supersededBy",dc.id::integer as "completionId",dc.plan_id as "completionPlanId",dc.source_submission_id::integer as "completionSourceId",dc.marks_hash as "completionMarksHash",dc.status as "completionStatus",dc.submitted_at as "completionSubmittedAt",dc.submitted_by as "completionSubmittedBy",dc.reviewed_at as "completionReviewedAt",dc.reviewed_by as "completionReviewedBy"
            from assessment_submissions s join assessment_plans p on p.id = s.plan_id left join result_batches rb on rb.id = s.result_batch_id left join assessment_submission_supersessions sx on sx.submission_id = s.id left join assessment_deferred_completions dc on dc.id = sx.completion_id where p.status = 'approved' and (p.period_id,p.course_id) ${selected}`,[pairs])).rows;
          const moderations=(await db.query(`select p.period_id as "periodId",p.course_id as "courseId",m.submission_id::integer as "submissionId",m.stage,m.outcome,m.marks_hash as "marksHash",m.reviewed_by as "reviewedBy",m.reviewed_at as "reviewedAt" from assessment_moderations m join assessment_submissions s on s.id = m.submission_id join assessment_plans p on p.id = s.plan_id where p.status = 'approved' and (p.period_id,p.course_id) ${selected}`,[pairs])).rows;
          const editors=(await db.query(`select p.period_id as "periodId",p.course_id as "courseId",h.entered_by as "enteredBy",min(h.entered_at) as "firstEnteredAt" from assessment_mark_history h join assessment_plans p on p.id = h.plan_id where p.status = 'approved' and (p.period_id,p.course_id) ${selected} group by p.period_id,p.course_id,h.entered_by`,[pairs])).rows;
          for(const offering of offerings) {
            const belongs=(r) => key(r) === key(offering),intake=selection.find((r) => r.intakeId === offering.intakeId),period=periods.find((r) => r.periodId === offering.periodId);
            const counts=assessmentOfferingCounts({offering,plans:plans.filter(belongs),roster:roster.filter(belongs),marks:marks.filter(belongs),submissions:submissions.filter(belongs),moderations:moderations.filter(belongs),editors:editors.filter(belongs)},generatedAt);
            rows.push({...offering,programmeCode:intake.programmeCode,intakeLabel:intake.label,periodName:period.periodName,periodStatus:period.periodStatus,counts,controls:assessmentReportControls(counts)});
            for(const m of assessmentMetrics)if(m.unit === 'hours') {if(counts[m.id] !== null)totals[m.id]=Math.max(totals[m.id] ?? 0,counts[m.id]);}else totals[m.id]+=counts[m.id];
          }
        }
        const controls=assessmentReportControls(totals);if(rows.some((r) => Object.values(r.controls).some((v) => !v)) || Object.values(controls).some((v) => !v))sourceFault();
        const report={definitionVersion:assessmentMetricVersion,generatedAt,filters,...available,selection,metrics:assessmentMetrics,totals,rows,controls};await audit(db,actor,filters.format === 'csv' ? 'exported' : 'generated',{intakeCount:selection.length,offeringCount:rows.length,controls});
        return filters.format === 'csv' ? {filename:'assessment-recording-operations.csv',csv:assessmentReportCsv(report),definitionVersion:assessmentMetricVersion,generatedAt} : report;
      });
    }
  };
}
