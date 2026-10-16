import test from 'node:test';
import assert from 'node:assert/strict';
import {continuationMetrics,continuationMetricVersion,continuationReportFilters,continuationCounts,continuationControls,continuationReportCsv,createContinuationReportingModule} from '../server/modules/continuation-reporting.js';
const actor = {accountId:'office',permissions:['registry.view','audit.view'],roles:[{permissions:['registry.view'],scope:{programmeCodes:['P'],intakeIds:['I']}},{permissions:['audit.view'],scope:{}}]};
const pair = {baselinePeriodId:'B',followupPeriodId:'F'};
const periods = [{periodId:'B',intakeId:'I',programmeCode:'P',intakeLabel:'Cohort',name:'Baseline',startsOn:'2025-01-01',endsOn:'2025-06-30',academicPeriodId:'AB',programmeVersionId:'V',yearOfStudy:1,term:'S1'},
  {periodId:'F',intakeId:'I',programmeCode:'P',intakeLabel:'Cohort',name:'Follow-up',startsOn:'2026-01-01',endsOn:'2026-06-30',academicPeriodId:'AF',programmeVersionId:'V',yearOfStudy:1,term:'S2'},
  {periodId:'PRIVATE',intakeId:'OTHER',programmeCode:'P',startsOn:'2027-01-01'},
  {periodId:'X',intakeId:'I',programmeCode:'P',startsOn:'2027-01-01'}];
const raw = {baselineProgrammeRecords:'3',continuedProgrammeRecords:'1',withoutFollowupConfirmation:'2',followupOnlyProgrammeRecords:'1',baselineCourseEnrolments:'6',continuingCourseEnrolments:'2',followupCourseEnrolments:'4',onboardedBaseline:'2',completedBaseline:'1'};
function fixture(options = {}) {
  const calls = [],receipts = [periods[0],periods[0],periods[0],periods[1],periods[1]].map((p,i) => ({...p,registrationId:`R${i}`,referenceNumber:`REG${i}`,receiptReference:`REG${i}`,confirmedAt:'2026-09-01T00:00:00Z',storedConfirmedAt:new Date('2026-09-01T00:00:00Z')}));
  options.change?.(receipts);
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select rp.id')) return {rows:options.periods || periods};if (sql.startsWith('select 1')) return {rows:options.sourceFault ? [{}] : []};
    if (sql.startsWith('select sr.id')) return {rows:receipts};if (sql.startsWith('with confirmed')) return {rows:[options.raw || raw]};return {rows:[]};
  }};return {calls,module:createContinuationReportingModule({async connect(){return db;}})};
}
test('continuation dictionary identifies its actual baseline, exclusions and pending approval',async () => {
  const d = await fixture().module.continuationMetricDictionary(actor);assert.equal(d.definitionVersion,continuationMetricVersion);assert.equal(d.metrics.length,16);
  for (const m of d.metrics) {assert.ok(Object.isFrozen(m));for (const k of ['owner','approval','formula','exclusions','filters','refresh']) assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(d.metrics.find((m) => m.id === 'continuationSharePercent').exclusions,/not approved retention/);
});
test('continuation requires explicit distinct periods and rejects invented census inputs',() => {
  assert.deepEqual(continuationReportFilters(pair),{...pair,format:'json'});
  for (const f of [undefined,null,[],{}, {...pair,followupPeriodId:'B'},{...pair,asOf:'2025-01-01'},{...pair,baselinePeriodId:'x\n'},{...pair,format:'pdf'}]) assert.throws(() => continuationReportFilters(f),{statusCode:400});
});
test('cohort counts use exact safe integers and null empty or future percentages',() => {
  const c = continuationCounts(raw,true);assert.equal(c.continuationSharePercent,100/3);assert.ok(Object.values(continuationControls(c)).every(Boolean));
  assert.equal(continuationCounts(raw,false).continuationSharePercent,null);assert.equal(continuationCounts({},true).continuationSharePercent,null);
  for (const n of ['1.5','-1','9007199254740992','NaN']) assert.throws(() => continuationCounts({...raw,baselineProgrammeRecords:n},true),{statusCode:409});
  assert.equal(continuationControls({...c,withoutFollowupConfirmation:0}).cohortReconcile,false);assert.equal(continuationControls({...c,onboardedBaseline:0}).lifecycleReconcile,false);
});
test('native registry authority and exact intake scope govern metadata and source selection',async () => {
  const f = fixture(),r = await f.module.continuationOperationsReport(pair,actor);assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(r.availablePeriods.some((p) => p.periodId === 'PRIVATE'),false);
  assert.equal(r.totals.baselineProgrammeRecords,3);assert.equal(r.totals.continuationSharePercent,100/3);assert.ok(Object.values(r.controls).every(Boolean));
  assert.ok(f.calls.filter((q) => q.sql.includes('any($1::text[])')).every((q) => q.values[0].join() === 'B,F'));
  const sql = f.calls.find((q) => q.sql.startsWith('with confirmed')).sql;assert.match(sql,/full join followup/);assert.doesNotMatch(sql,/account_id|student_number|reason|sum\(.*Percent/);
  const receiptSql = f.calls.find((q) => q.sql.startsWith('select sr.id')).sql;assert.doesNotMatch(receiptSql,/studentNumber|checks|source_snapshot|grades/);
  const custody = f.calls.find((q) => q.sql.startsWith('select 1')).sql;assert.match(custody,/d.student_programme_id = sr.student_programme_id/);assert.match(custody,/d.period_id = sr.period_id/);assert.match(custody,/d.evidence_hash = sr.confirmation/);assert.doesNotMatch(custody,/expires_on|current_date/);
  await assert.rejects(fixture().module.continuationOperationsReport({...pair,followupPeriodId:'PRIVATE'},actor),{statusCode:404});
  await assert.rejects(fixture().module.continuationMetricDictionary({...actor,permissions:['registry.self']}),{statusCode:403});
  assert.deepEqual(await fixture().module.listContinuationReportingPeriods({...actor,roles:[actor.roles[1]]}),[]);
});
test('cross-intake and reversed pairs fail before operational source reads',async () => {
  for (const list of [[{...periods[0]},{...periods[1],intakeId:'OTHER'}],[{...periods[0]},{...periods[1],startsOn:'2024-01-01'}]]) {
    const f = fixture({periods:list}),global = {...actor,roles:[{permissions:['registry.view'],scope:{}}]};await assert.rejects(f.module.continuationOperationsReport(pair,global),{statusCode:400});assert.equal(f.calls.some((q) => q.sql.startsWith('select sr.id')),false);
  }
});
test('custody, receipt, progression and aggregate faults roll back instead of repairing or guessing cohorts',async () => {
  const cases = [{sourceFault:true},{change:(r) => {r[0].startsOn='2025-02-30';}},{change:(r) => {r[0].receiptReference='OTHER';}},{change:(r) => {r[0].storedConfirmedAt=null;}},{change:(r) => {r[0].confirmedAt='2099-01-01T00:00:00Z';}},{change:(r) => {r[0].yearOfStudy=2;}},{raw:{...raw,baselineProgrammeRecords:4}}];
  for (const options of cases) {const f = fixture(options);await assert.rejects(f.module.continuationOperationsReport(pair,actor),{statusCode:409});assert.equal(f.calls.at(-1).sql,'rollback');}
});
test('future confirmed cohorts remain counts but never acquire a started-period percentage',async () => {
  const list = periods.map((p) => p.periodId === 'F' ? {...p,startsOn:'2027-01-01',endsOn:'2027-06-30'} : p);
  const r = await fixture({periods:list,change:(rows) => {for(const r of rows.filter((r) => r.periodId === 'F')) Object.assign(r,{startsOn:'2027-01-01',endsOn:'2027-06-30'});}}).module.continuationOperationsReport(pair,actor);
  assert.equal(r.periodsStarted,false);assert.equal(r.totals.continuedProgrammeRecords,1);assert.equal(r.totals.continuationSharePercent,null);
  const higher = await fixture({periods:periods.map((p) => p.periodId === 'F' ? {...p,yearOfStudy:2} : p),change:(rows) => {for(const r of rows.filter((r) => r.periodId === 'F'))Object.assign(r,{yearOfStudy:2,progression:{id:1,kind:'progression',status:'approved',policyId:'POLICY',evidenceHash:'a'.repeat(64)}});}}).module.continuationOperationsReport(pair,actor);
  assert.equal(higher.totals.continuedProgrammeRecords,1);
});
test('fresh CSV carries definitions, source counts, formula-safe labels and metadata-only export audit',async () => {
  const f = fixture(),r = await f.module.continuationOperationsReport({...pair,format:'csv'},actor);assert.equal(r.filename,'confirmed-period-continuation.csv');assert.match(r.csv,/owner approval pending/);
  assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.continuation.exported'));
  const report = await fixture().module.continuationOperationsReport(pair,actor);report.baseline.intakeLabel='=FORMULA';report.followup.name='@FORMULA';const csv = continuationReportCsv(report);assert.match(csv,/"'=FORMULA"/);assert.match(csv,/"'@FORMULA"/);assert.doesNotMatch(csv,/REG0|R0|confirmedAt|studentNumber/);
});
