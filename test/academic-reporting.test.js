import test from 'node:test';
import assert from 'node:assert/strict';
import {academicMetrics,academicMetricVersion,academicReportFilters,academicDomainAuthority,academicReportControls,academicReportCsv,createAcademicReportingModule} from '../server/modules/academic-reporting.js';
const actor = {accountId:'office',permissions:['results.view','academic.view','registry.view','audit.view'],roles:[{permissions:['results.view','academic.view','registry.view'],scope:{programmeCodes:['P'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P',label:'First'},{intakeId:'I2',programmeCode:'P',label:'Second'},{intakeId:'PRIVATE',programmeCode:'P',label:'PRIVATE'}];
const empty = () => Object.fromEntries(academicMetrics.map((m) => [m.id,m.unit === 'mark points' ? null : 0]));
function fixture(mismatch = '') {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id')) return {rows:intakes};
    if (sql.startsWith('select 1')) return {rows:mismatch && sql.includes(mismatch) ? [{found:1}] : []};
    if (sql.startsWith('select rp.intake_id') && sql.includes('resultBatches')) return {rows:[{intakeId:'I1',resultBatches:1,publishedBatches:1},{intakeId:'I2',resultBatches:1,publishedBatches:1},{intakeId:null,resultBatches:2,publishedBatches:2}]};
    if (sql.startsWith('select rp.intake_id')) return {rows:[{intakeId:'I1',confirmedEnrolments:2,officialResults:1,withoutOfficialResult:1,passingResults:1,resultProgrammeRecords:1,markSamples:1,meanOfficialMark:80},{intakeId:'I2',confirmedEnrolments:3,officialResults:3,failingResults:3,resultProgrammeRecords:1,markSamples:3,meanOfficialMark:40},{intakeId:null,confirmedEnrolments:5,officialResults:4,withoutOfficialResult:1,passingResults:1,failingResults:3,resultProgrammeRecords:2,markSamples:4,meanOfficialMark:50}]};
    if (sql.startsWith('select sp.intake_id') && sql.includes('awardRequests')) return {rows:[{intakeId:'I1',awardRequests:1,approvedAwards:1,awardedProgrammeRecords:1,completedProgrammeRecords:1},{intakeId:'I2',awardRequests:1,requestedAwards:1},{intakeId:null,awardRequests:2,approvedAwards:1,requestedAwards:1,awardedProgrammeRecords:1,completedProgrammeRecords:1}]};
    return {rows:[]};
  }};return {calls,module:createAcademicReportingModule({async connect(){return db;}})};
}
test('academic dictionary separates retained outcomes from eligibility, census, GPA and graduation rates',async () => {
  const r = await fixture().module.academicMetricDictionary(actor);assert.equal(r.definitionVersion,academicMetricVersion);assert.equal(r.metrics.length,28);
  for (const m of r.metrics) {assert.ok(Object.isFrozen(m));for (const k of ['owner','approval','formula','exclusions','filters','refresh']) assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(r.metrics.find((m) => m.id === 'approvedDecisions').exclusions,/not current registration eligibility/);assert.match(r.metrics.find((m) => m.id === 'meanOfficialMark').exclusions,/Not credit-weighted GPA/);
  await assert.rejects(fixture().module.academicMetricDictionary({...actor,permissions:['registry.self']}),{statusCode:403});
});
test('academic report filters refuse invented historical cohorts or unsupported domains',() => {
  assert.deepEqual(academicReportFilters(),{intakeId:'',domain:'',format:'json'});assert.equal(academicReportFilters({intakeId:' I1 ',domain:'awards'}).intakeId,'I1');
  for (const f of [null,[],{from:'2026-01-01'},{asOf:'2026-01-01'},{domain:'retention'},{domain:1},{intakeId:'x\n'},{intakeId:'x'.repeat(161)},{format:'pdf'}]) assert.throws(() => academicReportFilters(f),{statusCode:400});
});
test('academic report mirrors ordered native award authorization, not a scope-widening permission union',() => {
  const split = {...actor,roles:[{permissions:['registry.view'],scope:{programmeCodes:['P'],intakeIds:['I1']}},{permissions:['academic.view','results.view'],scope:{programmeCodes:['P'],intakeIds:['I2']}},actor.roles[1]]};
  assert.deepEqual(academicDomainAuthority(split,intakes[0]),{results:false,decisions:false,awards:true});assert.deepEqual(academicDomainAuthority(split,intakes[1]),{results:true,decisions:true,awards:false});
  assert.deepEqual(academicDomainAuthority({...actor,roles:[actor.roles[1]]},intakes[0]),{results:false,decisions:false,awards:false});
});
test('academic report captures one snapshot and computes direct sample-based current official totals',async () => {
  const f = fixture(),r = await f.module.academicOperationsReport({},actor);assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(r.generatedAt,'2026-10-05T11:00:00.000Z');assert.equal(r.totals.meanOfficialMark,50);assert.equal((r.rows[0].counts.meanOfficialMark+r.rows[1].counts.meanOfficialMark)/2,60);assert.ok(Object.values(r.controls).every(Boolean));assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
  for (const q of f.calls.filter((q) => q.sql.includes('any($1::text[])'))) assert.deepEqual(q.values,[['I1','I2']]);
  const rollup = f.calls.find((q) => q.sql.startsWith('select rp.intake_id') && q.sql.includes('confirmedEnrolments')).sql;assert.match(rollup,/grouping sets/);assert.match(rollup,/count\(distinct sr.student_programme_id\)/);assert.match(rollup,/avg\(\(ar.result_snapshot->>'mark'\)/);assert.doesNotMatch(rollup,/reason|student_number|account_id|source_snapshot/);
});
test('same-intake domain authority is required; missing selection-wide authority returns null, never partial totals',async () => {
  const split = {...actor,roles:[{permissions:['results.view','registry.view'],scope:{programmeCodes:['P'],intakeIds:['I1']}},{permissions:['academic.view'],scope:{programmeCodes:['P'],intakeIds:['I2']}},actor.roles[1]]};
  const f = fixture(),r = await f.module.academicOperationsReport({},split);assert.deepEqual(r.authority,{results:false,decisions:false,awards:false});assert.ok(Object.values(r.totals).every((v) => v === null));assert.ok(Object.values(r.controls).every((v) => v === null));
  assert.equal(r.rows[0].counts.officialResults,1);assert.equal(r.rows[0].counts.decisionRecords,null);assert.equal(r.rows[1].counts.officialResults,null);
  const resultQueries = f.calls.filter((q) => q.sql.includes('result_batches'));assert.ok(resultQueries.every((q) => q.values[0].join() === 'I1'));
  const restricted = await fixture().module.academicOperationsReport({domain:'results'},split);assert.equal(restricted.rows.length,1);assert.equal(restricted.authority.results,true);assert.equal(restricted.totals.awardRequests,null);
  await assert.rejects(fixture().module.academicOperationsReport({domain:'decisions'},{...actor,permissions:['results.view']}),{statusCode:403});
});
test('no visible intake reads no operational sources and absent domains remain null',async () => {
  const f = fixture(),r = await f.module.academicOperationsReport({}, {...actor,permissions:['results.view'],roles:[actor.roles[1]]});assert.deepEqual(r.rows,[]);assert.equal(r.totals.officialResults,0);assert.equal(r.totals.awardRequests,null);assert.equal(r.controls.awardsReconcile,null);assert.equal(f.calls.some((q) => q.sql.includes('any($1::text[])')),false);
  await assert.rejects(fixture().module.academicOperationsReport({intakeId:'PRIVATE'},actor),{statusCode:404});
});
test('academic source faults refuse counts with rollback before affected-domain rollups',async () => {
  for (const source of ['from student_programmes sp join intakes','student_registrations','from result_batches rb','from academic_results ar','academic_decisions','from award_requests a','sp.status = \'completed\' and not exists']) {
    const f = fixture(source);await assert.rejects(f.module.academicOperationsReport({},actor),{statusCode:409});assert.equal(f.calls.at(-1).sql,'rollback');
  }
  const f = fixture();await f.module.academicOperationsReport({},actor);const official = f.calls.find((q) => q.sql.startsWith('select 1 from academic_results')).sql;assert.match(official,/a.to_snapshot = ar.result_snapshot/);assert.match(official,/a.result_revision = ar.revision-1/);
  const batches = f.calls.find((q) => q.sql.startsWith('select 1 from result_batches')).sql;assert.match(batches,/rb.mark_total/);assert.match(batches,/count\(distinct \(original->>'registrationId'/);
});
test('domain controls reconcile current result/decision/award partitions without interpreting stale approvals',() => {
  const c = empty();assert.ok(Object.values(academicReportControls(c)).every(Boolean));
  for (const [field,control] of [['officialResults','resultsReconcile'],['decisionRecords','decisionsReconcile'],['completedProgrammeRecords','awardsReconcile']]) assert.equal(academicReportControls({...c,[field]:1})[control],false);
  assert.equal(academicReportControls({...c,meanOfficialMark:0}).resultsReconcile,false);assert.equal(academicReportControls(c,{results:false,decisions:false,awards:false}).resultsReconcile,null);
});
test('fresh academic CSV reauthorizes each domain, separately audits and neutralizes formula cells',async () => {
  const f = fixture(),r = await f.module.academicOperationsReport({format:'csv'},actor);assert.equal(r.filename,'academic-outcome-operations.csv');assert.match(r.csv,/owner approval pending/);assert.match(r.csv,/results_authority/);assert.doesNotMatch(r.csv,/PRIVATE/);
  assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.academic.exported'));
  const report = await fixture().module.academicOperationsReport({},actor);report.rows[0].label=' =HYPERLINK("unsafe")';assert.match(academicReportCsv(report),/"' =HYPERLINK\(""unsafe""\)"/);
  await assert.rejects(f.module.academicOperationsReport({format:'csv'},{...actor,permissions:[]}),{statusCode:403});
});
