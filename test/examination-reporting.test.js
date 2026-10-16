import test from 'node:test';
import assert from 'node:assert/strict';
import { createExaminationReportingModule, examinationMetrics, examinationMetricVersion, examinationReportFilters, examinationReportCsv, examinationReportControls } from '../server/modules/examination-reporting.js';

const actor = {accountId:'office',permissions:['exams.schedule','results.view'],roles:[{permissions:['exams.schedule'],scope:{programmeCodes:['P1'],intakeIds:['I1']}},{permissions:['results.view'],scope:{}}]};
const periods = [
  {periodId:'p1',name:'Term 1',programmeCode:'P1',intakeId:'I1',intakeLabel:'Intake 1'},
  {periodId:'p2',name:'Term 2',programmeCode:'P1',intakeId:'I1',intakeLabel:'Intake 1'},
  {periodId:'p3',name:'PRIVATE',programmeCode:'P2',intakeId:'I2',intakeLabel:'PRIVATE'}
];
function fixture(transform = (rows) => rows) {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp')) return {rows:[{generatedAt:new Date('2026-10-05T10:00:00Z')}]};
    if (sql.includes('select rp.id') && !values) return {rows:periods};
    if (sql.includes('any($1::text[])')) return {rows:transform(values[0].map((periodId,index) => ({periodId,ordersSubmitted:index+1,ordersReturned:0,draftTimetables:1,scheduledSittings:2,publicationEditions:3,ordersTotal:index+1,ordersApproved:0,timetablesTotal:1,timetablesPublished:0,sittingsTotal:2,sittingsCancelled:0,sourceFaults:0})))};
    return {rows:[]};
  }};
  return {calls,module:createExaminationReportingModule({async connect(){return db;}})};
}
test('examination metric dictionary is versioned, bounded to operational meanings, and explicitly unapproved',async () => {
  const {module} = fixture(),dictionary = await module.examinationMetricDictionary(actor);
  assert.equal(dictionary.definitionVersion,examinationMetricVersion);assert.equal(dictionary.metrics.length,5);
  for (const metric of examinationMetrics) {assert.ok(metric.owner && metric.formula && metric.filters && metric.refresh && metric.exclusions);assert.match(metric.approval,/pending/);assert.ok(Object.isFrozen(metric));}
  await assert.rejects(module.examinationMetricDictionary({...actor,permissions:['results.view']}),{statusCode:403});
});
test('source partitions, custody faults and malformed counts fail closed before figures or audit',async () => {
  const valid = {ordersSubmitted:1,ordersReturned:2,ordersApproved:3,ordersTotal:6,draftTimetables:1,timetablesPublished:0,timetablesTotal:1,scheduledSittings:2,sittingsCancelled:4,sittingsTotal:6,publicationEditions:3,sourceFaults:0};
  assert.ok(Object.values(examinationReportControls(valid)).every(Boolean));
  for (const patch of [{ordersTotal:5},{timetablesTotal:2,timetablesPublished:1},{sittingsTotal:5},{sourceFaults:1},{publicationEditions:-1},{ordersApproved:'3'},{ordersTotal:NaN},{ordersTotal:Number.MAX_SAFE_INTEGER+1}]) assert.throws(() => examinationReportControls({...valid,...patch}),{statusCode:409});
  for (const transform of [(rows) => rows.slice(1),(rows) => [...rows,rows[0]],(rows) => rows.map((r) => ({...r,sourceFaults:1})),(rows) => rows.map((r) => ({...r,periodId:'private'}))]) {
    const f=fixture(transform);await assert.rejects(f.module.examinationOperationsReport({},actor),{statusCode:409});assert.equal(f.calls.some((call) => call.sql.includes('insert into audit_events')),false);
  }
});
test('controls are versioned per period and total and carried in native CSV without private custody',async () => {
  const report=await fixture().module.examinationOperationsReport({},actor);
  assert.equal(report.controlsVersion,'exam-source-controls-v1');assert.ok(Object.values(report.controls).every(Boolean));assert.equal(report.rows.length,2);assert.ok(report.rows.every((row) => Object.values(row.controls).every(Boolean)));
  const csv=examinationReportCsv(report);assert.match(csv,/control_total/);assert.match(csv,/control_period/);assert.match(csv,/publicationOriginsReconcile/);assert.match(csv,/exam-source-controls-v1/);assert.doesNotMatch(csv,/PRIVATE|published_snapshot|studentNumber|review_reason/);
});
test('report filters reject invented as-of dates, oversized identifiers and invalid formats',() => {
  assert.deepEqual(examinationReportFilters(),{programmeCode:'',intakeId:'',periodId:'',format:'json'});
  assert.equal(examinationReportFilters({periodId:' p1 '}).periodId,'p1');
  for (const input of [{asOf:'2026-01-01'},{periodId:'x'.repeat(161)},{programmeCode:5},{intakeId:'x\n'},{format:'pdf'}]) assert.throws(() => examinationReportFilters(input),{statusCode:400});
});
test('permission-specific scope is applied before SQL counts and totals reconcile exactly to visible periods',async () => {
  const f = fixture(),report = await f.module.examinationOperationsReport({},actor);
  assert.deepEqual(report.rows.map((row) => row.periodId),['p1','p2']);assert.deepEqual(report.availablePeriods,periods.slice(0,2));
  assert.deepEqual(report.totals,{ordersSubmitted:3,ordersReturned:0,draftTimetables:2,scheduledSittings:4,publicationEditions:6});
  assert.deepEqual(f.calls.find((call) => call.sql.includes('any($1::text[])')).values,[['p1','p2']]);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(report.generatedAt,'2026-10-05T10:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
  assert.ok(f.calls.find((call) => call.sql.includes('insert into audit_events')).values.includes('reports.examinations.accessed'));
});
test('filtered and zero reports retain definitions; inaccessible period filters fail without counting source data',async () => {
  const f = fixture(),report = await f.module.examinationOperationsReport({periodId:'p2'},actor);
  assert.deepEqual(report.rows.map((row) => row.periodId),['p2']);assert.deepEqual(report.filters,{programmeCode:'',intakeId:'',periodId:'p2'});
  for (const input of [{periodId:'p3'},{periodId:'missing'},{periodId:'p1',programmeCode:'P2'}]) await assert.rejects(fixture().module.examinationOperationsReport(input,actor),{statusCode:404});
  const empty = fixture();const zero = await empty.module.examinationOperationsReport({programmeCode:'P2'},actor);
  assert.equal(zero.rows.length,0);assert.ok(Object.values(zero.totals).every((value) => value === 0));assert.equal(empty.calls.some((call) => call.sql.includes('any($1::text[])')),false);
  await assert.rejects(f.module.examinationOperationsReport({}, {...actor,permissions:['exams.duties.self']}),{statusCode:403});
});
test('exports recalculate under authority and audit separately, with scope, version and formula-neutralized CSV cells',async () => {
  const f = fixture(),result = await f.module.examinationOperationsReport({periodId:'p1',format:'csv'},actor);
  assert.match(result.csv,/definition_version/);assert.match(result.csv,/Development definition; owner approval pending/);assert.doesNotMatch(result.csv,/PRIVATE/);
  assert.match(result.csv,/"filter_period"/);assert.match(result.fileName,/2026-10-05\.csv$/);
  assert.ok(f.calls.find((call) => call.sql.includes('insert into audit_events')).values.includes('reports.examinations.exported'));
  const report = await fixture().module.examinationOperationsReport({periodId:'p1'},actor);report.rows[0].intakeLabel='=HYPERLINK("attack")';
  assert.match(examinationReportCsv(report),/"'=HYPERLINK\(""attack""\)"/);
});
