import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentMetrics,assessmentMetricVersion,assessmentReportPermissions,assessmentReportScopeAllowed,assessmentReportFilters,assessmentOfferingCounts,assessmentReportControls,assessmentReportCsv,createAssessmentReportingModule} from '../server/modules/assessment-reporting.js';
import {authority,marksHash} from '../server/modules/assessment.js';
import {reportEditionGrants,reportEditionScopeAllowed} from '../server/modules/report-editions.js';
const now='2026-10-05T12:00:00.000Z',actor={accountId:'reader',permissions:['assessment.review','teaching.view','audit.view'],roles:[{permissions:['assessment.review'],scope:{programmeCodes:['P'],intakeIds:['I1']}},{permissions:['teaching.view'],scope:{programmeCodes:['P'],intakeIds:['I2']}},{permissions:['audit.view'],scope:{}}]};
function evidence() {
  const offering={periodId:'RP1',courseId:'C1'},plans=[{id:'PLAN',...offering,version:1,status:'approved',moderation:'internal_external',components:[{code:'CW',name:'Coursework',weight:50,maxMark:50},{code:'EXAM',name:'Examination',weight:50,maxMark:100}]}];
  const roster=['R1','R2','R3'].map((registrationId) => ({registrationId,active:registrationId !== 'R3',scopeValid:true,registrationStatus:'confirmed'}));
  const marks=[['R1','CW','mark',40],['R1','EXAM','mark',80],['R2','CW','absent',null],['R2','EXAM','deferred',null],['R3','CW','mark',50],['R3','EXAM','mark',100]].map(([registrationId,componentCode,state,mark]) => ({planId:'PLAN',registrationId,componentCode,state,mark,revision:1}));
  const submissions=[{id:1,planId:'PLAN',status:'submitted',marksHash:marksHash(marks),finals:[{registrationId:'R1',state:'final',mark:80},{registrationId:'R2',state:'deferred',mark:null}],submittedBy:'editor',submittedAt:'2026-10-05T10:00:00Z',reviewedBy:null,reviewedAt:null,resultBatchId:null,resultPeriodId:null}];
  return {offering,plans,roster,marks,submissions,moderations:[],editors:[{enteredBy:'editor',firstEnteredAt:'2026-10-05T09:00:00Z'}]};
}
function sign(e,stage='internal',reviewedBy=stage,outcome='signed') {e.moderations.push({submissionId:1,stage,outcome,marksHash:e.submissions[0].marksHash,reviewedBy,reviewedAt:`2026-10-05T10:${stage === 'internal' ? '15' : '30'}:00Z`});}
const count=(e) => assessmentOfferingCounts(e,now);
test('assessment definitions distinguish staff mark-sheet records, active coverage and non-official outcomes',() => {
  assert.equal(assessmentMetricVersion,'assessment-recording-operations-v1');assert.equal(new Set(assessmentMetrics.map((m) => m.id)).size,assessmentMetrics.length);
  for(const m of assessmentMetrics) {assert.ok(Object.isFrozen(m));for(const k of ['owner','approval','formula','exclusions','unit','filters','refresh'])assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(assessmentMetrics.find((m) => m.id === 'submissions').exclusions,/Not student assignment uploads/);assert.match(assessmentMetrics.find((m) => m.id === 'oldestSubmittedHours').exclusions,/not an approved business-hours SLA/);
});
test('assessment filters normalize bounded selectors and reject invented historic/PDF/browser-count fields',() => {
  assert.deepEqual(assessmentReportFilters(),{intakeId:'',periodId:'',courseId:'',format:'json'});assert.equal(assessmentReportFilters({courseId:' C1 '}).courseId,'C1');
  for(const f of [null,[],{asOf:'2026-01-01'},{totals:1},{format:'pdf'},{courseId:2},{periodId:'x\n'},{intakeId:'x'.repeat(161)}])assert.throws(() => assessmentReportFilters(f),{statusCode:400});
});
test('standing staff report scopes match native per-offering view permissions without unrelated global widening',async () => {
  const row={programmeCode:'P',intakeId:'I1'};
  for(const p of assessmentReportPermissions) {const a={...actor,permissions:[p,'audit.view'],roles:[{permissions:[p],scope:{programmeCodes:['P'],intakeIds:['I1']}},actor.roles[2]]};assert.equal(assessmentReportScopeAllowed(a,row),(await authority({},row,a)).view);assert.equal(assessmentReportScopeAllowed(a,{...row,intakeId:'I2'}),false);}
  assert.equal(assessmentReportScopeAllowed({...actor,roles:[actor.roles[2]]},row),false);assert.equal(assessmentReportScopeAllowed({...actor,permissions:['teaching.self']},row),false);
});
test('coverage follows active enrolments and native arithmetic while retaining withdrawn component evidence',() => {
  const c=count(evidence());assert.equal(c.rosterEnrolments,2);assert.equal(c.expectedCells,4);assert.equal(c.populatedCells,4);assert.equal(c.retainedCells,6);assert.equal(c.outsideRosterCells,2);assert.equal(c.markCells,2);assert.equal(c.absentCells,1);assert.equal(c.deferredCells,1);assert.equal(c.finalEnrolments,1);assert.equal(c.deferredEnrolments,1);assert.equal(c.missingCells,0);assert.equal(c.oldestSubmittedHours,2);assert.ok(Object.values(assessmentReportControls(c)).every(Boolean));
  const e=evidence();e.marks=e.marks.filter((m) => m.registrationId !== 'R2');const missing=count(e);assert.equal(missing.missingCells,2);assert.equal(missing.incompleteEnrolments,1);assert.equal(missing.changedLiveSources,1);
});
test('unconfigured offerings do not invent component expectations or final outcomes',() => {
  const e=evidence();e.plans[0].status='draft';e.marks=[];e.submissions=[];const c=count(e);assert.equal(c.unconfiguredOfferings,1);assert.equal(c.unconfiguredEnrolments,2);assert.equal(c.expectedCells,0);assert.equal(c.incompleteEnrolments,0);assert.ok(Object.values(assessmentReportControls(c)).every(Boolean));
});
test('submitted moderation queues preserve ordered internal/external stages and changes requests',() => {
  const e=evidence();assert.equal(count(e).awaitingInternal,1);sign(e);assert.equal(count(e).awaitingExternal,1);sign(e,'external');assert.equal(count(e).readyForReview,1);
  const returned=evidence();sign(returned,'internal','internal','changes_requested');assert.equal(count(returned).changesRequested,1);assert.equal(count(returned).awaitingInternal,1);
});
test('approved source classification is course-level only, with changed/deferred evidence withheld',() => {
  const e=evidence();sign(e);sign(e,'external');Object.assign(e.submissions[0],{status:'approved',reviewedBy:'reviewer',reviewedAt:'2026-10-05T11:00:00Z'});assert.equal(count(e).approvedWithheld,1);
  e.marks.find((m) => m.registrationId === 'R2' && m.componentCode === 'EXAM').state='absent';e.submissions[0].marksHash=marksHash(e.marks);e.submissions[0].finals[1]={registrationId:'R2',state:'final',mark:0};for(const r of e.moderations)r.marksHash=e.submissions[0].marksHash;assert.equal(count(e).approvedAllFinal,1);
  e.submissions[0].finals[0].mark=99;assert.throws(() => count(e),{statusCode:409});
});
test('returned/superseded records survive roster changes rather than being repaired or reinterpreted',() => {
  const e=evidence();e.submissions[0].finals.push({registrationId:'R3',state:'final',mark:100});assert.equal(count(e).changedLiveSources,1);
  const old=structuredClone(e.submissions[0]);Object.assign(old,{status:'superseded',id:2,completionId:10,completionStatus:'approved',completionPlanId:'PLAN',completionSourceId:2,completionMarksHash:old.marksHash,supersededFromStatus:'submitted',supersededBy:'reviewer',supersededAt:'2026-10-05T11:00:00Z',completionSubmittedAt:'2026-10-05T10:45:00Z',completionSubmittedBy:'editor',completionReviewedBy:'reviewer',completionReviewedAt:'2026-10-05T11:00:00Z'});e.submissions.push(old);const c=count(e);assert.equal(c.submissions,2);assert.equal(c.supersededSubmissions,1);assert.equal(c.changedLiveSources,1);old.completionStatus='returned';assert.throws(() => count(e),{statusCode:409});
});
test('malformed component, roster, mark, submission and moderation evidence fails closed',() => {
  const faults=[(e) => e.plans.push({...e.plans[0],id:'OTHER',version:2}),(e) => e.plans[0].components[0].weight=20,(e) => e.roster[0].scopeValid=false,(e) => e.roster[0].registrationStatus='draft',(e) => e.marks[0].componentCode='BAD',(e) => e.marks[0].mark=51,(e) => e.marks.push({...e.marks[0]}),(e) => e.submissions[0].finals[0].registrationId='OTHER',(e) => e.submissions[0].submittedAt='2099-01-01',(e) => {sign(e);e.moderations[0].reviewedBy='editor';},(e) => sign(e,'external'),(e) => {sign(e);e.moderations[0].marksHash='0'.repeat(64);},(e) => {e.submissions[0].status='transferred';}];
  for(const fault of faults) {const e=evidence();fault(e);assert.throws(() => count(e),{statusCode:409});}
});
test('moderation separation is checked at the historical decision time, not against later editors',() => {
  const e=evidence();sign(e);e.editors.push({enteredBy:'internal',firstEnteredAt:'2026-10-05T11:00:00Z'});assert.equal(count(e).awaitingExternal,1);e.editors[1].firstEnteredAt='2026-10-05T09:00:00Z';assert.throws(() => count(e),{statusCode:409});
});
test('transferred sheets reconcile to the retained same-period course rows, not only a foreign-key reference',() => {
  const e=evidence();e.plans[0].moderation='none';e.marks.find((m) => m.registrationId === 'R2' && m.componentCode === 'EXAM').state='absent';const s=e.submissions[0];Object.assign(s,{status:'transferred',marksHash:marksHash(e.marks),reviewedBy:'reviewer',reviewedAt:'2026-10-05T11:00:00Z',resultBatchId:'BATCH',resultPeriodId:'RP1',resultStatus:'draft',resultRows:[{registrationId:'R1',courseId:'C1',mark:80},{registrationId:'R2',courseId:'C1',mark:0}]});s.finals[1]={registrationId:'R2',state:'final',mark:0};assert.equal(count(e).transferredSubmissions,1);s.resultRows[0].mark=99;assert.throws(() => count(e),{statusCode:409});s.resultRows[0].mark=80;s.resultStatus='rejected';assert.throws(() => count(e),{statusCode:409});
});
function fixture(fault=false) {
  const e=evidence(),calls=[],intakes=[{intakeId:'I1',programmeCode:'P',label:'First'},{intakeId:'I2',programmeCode:'P',label:'Second'},{intakeId:'PRIVATE',programmeCode:'P',label:'SECRET'}],periods=[{periodId:'RP1',intakeId:'I1',periodName:'First period',periodStatus:'open'},{periodId:'RP2',intakeId:'I2',periodName:'Second period',periodStatus:'open'}],courses=[{...e.offering,intakeId:'I1',code:'C1',title:'First course'},{periodId:'RP2',courseId:'C2',intakeId:'I2',code:'C2',title:'Second course'}];
  const extend=(rs) => rs.map((r) => ({...e.offering,...r})),db={release(){},async query(sql,values) {
    calls.push({sql,values});if(sql.includes('transaction_timestamp() as'))return {rows:[{generatedAt:now}]};if(sql.startsWith('select i.id'))return {rows:intakes};
    if(sql.startsWith('select rp.id'))return {rows:periods.filter((r) => values[0].includes(r.intakeId))};if(sql.startsWith('select o.period_id'))return {rows:courses.filter((r) => values[0].includes(r.intakeId))};
    if(sql.startsWith('select 1'))return {rows:fault ? [{}] : []};if(sql.includes('from assessment_plans p where'))return {rows:e.plans};if(sql.includes('from course_enrolments ce'))return {rows:extend(e.roster)};
    if(sql.includes('from assessment_marks m'))return {rows:extend(e.marks)};if(sql.includes('from assessment_submissions s'))return {rows:extend(e.submissions)};if(sql.includes('from assessment_moderations m'))return {rows:extend(e.moderations)};if(sql.includes('from assessment_mark_history h'))return {rows:extend(e.editors)};return {rows:[]};
  }};return {calls,module:createAssessmentReportingModule({async connect(){return db;}})};
}
test('assessment reports capture one snapshot, authorize before operational reads and roll up direct maximum age',async () => {
  const f=fixture(),r=await f.module.assessmentOperationsReport({},actor);assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(r.rows.length,2);assert.equal(r.totals.offerings,2);assert.equal(r.totals.configuredOfferings,1);assert.equal(r.totals.oldestSubmittedHours,2);assert.ok(Object.values(r.controls).every(Boolean));assert.doesNotMatch(JSON.stringify(r),/SECRET|R1|editor|reviewedBy|marksHash|finals/);
  for(const q of f.calls.filter((q) => q.sql.includes('jsonb_to_recordset')))assert.deepEqual(JSON.parse(q.values[0]),[{periodId:'RP1',courseId:'C1'},{periodId:'RP2',courseId:'C2'}]);
  assert.match(f.calls.find((q) => q.sql.includes('from course_enrolments ce')).sql,/to_jsonb\(ce\)->>'withdrawn_at' is null/);
  await assert.rejects(fixture().module.assessmentOperationsReport({intakeId:'PRIVATE'},actor),{statusCode:404});await assert.rejects(fixture(true).module.assessmentOperationsReport({},actor),{statusCode:409});
  const none=fixture(),empty=await none.module.assessmentOperationsReport({}, {...actor,roles:[actor.roles[2]]});assert.equal(empty.rows.length,0);assert.equal(none.calls.some((q) => q.sql.includes('jsonb_to_recordset')),false);assert.equal(empty.totals.oldestSubmittedHours,null);
});
test('fresh assessment CSV is audited and formula-safe without identities, raw grades or reasons',async () => {
  const f=fixture(),r=await f.module.assessmentOperationsReport({format:'csv'},actor);assert.match(r.csv,/assessment-recording-operations-v1/);assert.equal(r.filename,'assessment-recording-operations.csv');assert.doesNotMatch(r.csv,/marksHash|reviewedBy|R1|editor|SECRET/);assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.assessment.exported'));
  const report=await fixture().module.assessmentOperationsReport({},actor);report.rows[0].code=' =FORMULA';assert.match(assessmentReportCsv(report),/"' =FORMULA"/);await assert.rejects(fixture().module.assessmentOperationsReport({}, {...actor,permissions:['teaching.self']}),{statusCode:403});
});
test('assessment edition scopes include empty selected intakes and reauthorize birth plus current bindings',() => {
  const selection=[{intakeId:'I1',programmeCode:'P'}],grants=reportEditionGrants('assessment',{selection,rows:[]});assert.deepEqual(grants.intakes,selection);assert.equal(reportEditionScopeAllowed(actor,'assessment',grants,selection),true);assert.equal(reportEditionScopeAllowed(actor,'assessment',grants,[{...selection[0],programmeCode:'CHANGED'}]),false);assert.equal(reportEditionScopeAllowed({...actor,roles:[actor.roles[2]]},'assessment',grants,selection),false);
});
