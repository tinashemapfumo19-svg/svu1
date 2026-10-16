import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionsMetrics, admissionsMetricVersion, admissionsReportControls, admissionsReportFilters, admissionsReportCsv, createAdmissionsReportingModule } from '../server/modules/admissions-reporting.js';
import { admissionsPlacesSql, transferredSeatsSql } from '../server/modules/intake-capacity.js';

const actor = {accountId:'office',permissions:['admissions.review','results.view'],roles:[{permissions:['admissions.review'],scope:{programmeCodes:['P1'],intakeIds:['I1','I2']}},{permissions:['results.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P1',label:'Intake 1',status:'published',capacity:6},{intakeId:'I2',programmeCode:'P1',label:'Intake 2',status:'closed',capacity:1},{intakeId:'I3',programmeCode:'P2',label:'PRIVATE',capacity:100}];
const emptyCounts = () => Object.fromEntries(admissionsMetrics.map((entry) => [entry.id,0]));
const source = (intakeId) => ({...emptyCounts(),intakeId,applicationsTotal:4,draftApplications:1,underReview:1,openOffers:1,acceptedApplications:1});
function fixture({scopeMismatch = false,seats:seatOverride} = {}) {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id') && !values) return {rows:intakes};
    if (sql.startsWith('select 1 from applications')) return {rows:scopeMismatch ? [{found:1}] : []};
    if (sql.startsWith('select a.intake_id')) return {rows:values[0].map(source)};
    if (sql.startsWith('select i.id') && values) return {rows:values[0].map((intakeId) => ({intakeId,placesTaken:seatOverride?.[intakeId] ?? 3,transferPlaces:1}))};
    return {rows:[]};
  }};
  return {calls,module:createAdmissionsReportingModule({async connect(){return db;}})};
}
test('admissions dictionary defines current-state and policy-held-place meanings with unapproved ownership',async () => {
  const f = fixture(),dictionary = await f.module.admissionsMetricDictionary(actor);
  assert.equal(dictionary.definitionVersion,admissionsMetricVersion);assert.equal(dictionary.metrics.length,18);
  for (const entry of admissionsMetrics) {assert.ok(entry.owner && entry.formula && entry.filters && entry.refresh && entry.exclusions);assert.match(entry.approval,/pending/);assert.ok(Object.isFrozen(entry));}
  assert.match(dictionary.metrics.find((entry) => entry.id === 'openOffers').exclusions,/overdue/);
  await assert.rejects(f.module.admissionsMetricDictionary({...actor,permissions:['admissions.decide']}),{statusCode:403});
});
test('filters reject invented as-of/state criteria and unsafe or oversized identifiers',() => {
  assert.deepEqual(admissionsReportFilters(),{programmeCode:'',intakeId:'',format:'json'});
  assert.equal(admissionsReportFilters({intakeId:' I1 '}).intakeId,'I1');
  for (const input of [{asOf:'2026-01-01'},{state:'Accepted'},{intakeId:'x'.repeat(161)},{programmeCode:4},{intakeId:'x\n'},{format:'pdf'}]) assert.throws(() => admissionsReportFilters(input),{statusCode:400});
});
test('admissions scope precedes source counts, uses one snapshot and reuses the existing capacity formulas',async () => {
  const f = fixture(),report = await f.module.admissionsOperationsReport({},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(report.generatedAt,'2026-10-05T11:00:00.000Z');
  assert.deepEqual(report.availableIntakes,intakes.slice(0,2));assert.deepEqual(report.rows.map((row) => row.intakeId),['I1','I2']);
  for (const call of f.calls.filter((call) => call.sql.includes('any($1::text[])'))) assert.deepEqual(call.values,[['I1','I2']]);
  const seats = f.calls.find((call) => call.sql.includes('as "placesTaken"'));assert.ok(seats.sql.includes(admissionsPlacesSql));assert.ok(seats.sql.includes(transferredSeatsSql));
  assert.equal(report.totals.capacity,7);assert.equal(report.totals.placesTaken,6);assert.equal(report.totals.placesRemaining,3);assert.equal(report.totals.overCapacity,2);
  assert.deepEqual(report.controls,{applicationsReconcile:true,capacityReconciles:true});assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
});
test('explicit inaccessible intakes fail, empty scopes return zero counts and no operational source query',async () => {
  for (const input of [{intakeId:'I3'},{intakeId:'missing'},{intakeId:'I1',programmeCode:'P2'}]) await assert.rejects(fixture().module.admissionsOperationsReport(input,actor),{statusCode:404});
  const f = fixture(),empty = await f.module.admissionsOperationsReport({programmeCode:'P2'},actor);
  assert.equal(empty.rows.length,0);assert.ok(Object.values(empty.totals).every((value) => value === 0));assert.equal(f.calls.some((call) => call.sql.includes('any($1::text[])')),false);
  await assert.rejects(f.module.admissionsOperationsReport({}, {...actor,permissions:['admissions.self']}),{statusCode:403});
});
test('missing or mismatched application scope bindings refuse aggregate reporting and roll back',async () => {
  const f = fixture({scopeMismatch:true});await assert.rejects(f.module.admissionsOperationsReport({},actor),{statusCode:409});
  assert.equal(f.calls.some((call) => call.sql.startsWith('select a.intake_id')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  assert.ok(f.calls.find((call) => call.sql.startsWith('select 1')).sql.includes('is distinct from'));
});
test('authorized intake metadata remains discoverable without reading operational sources needing reconciliation',async () => {
  const f = fixture({scopeMismatch:true});assert.deepEqual(await f.module.listAdmissionsReportingIntakes(actor),intakes.slice(0,2));
  assert.equal(f.calls.some((call) => call.sql.includes('any($1::text[])')),false);
  await assert.rejects(f.module.listAdmissionsReportingIntakes({...actor,permissions:['admissions.self']}),{statusCode:403});
});
test('partition and capacity controls detect source discrepancies, including opposing intake differences',async () => {
  const f = fixture({seats:{I1:4,I2:2}}),report = await f.module.admissionsOperationsReport({},actor);
  assert.equal(admissionsReportControls(report.totals).capacityReconciles,true);assert.equal(report.controls.capacityReconciles,false);
  const counts = {...emptyCounts(),applicationsTotal:1,unclassifiedSubmitted:1};assert.equal(admissionsReportControls(counts).applicationsReconcile,true);
  assert.equal(admissionsReportControls({...counts,applicationsTotal:2}).applicationsReconcile,false);
});
test('CSV recalculates and audits separately, retaining filters, reconciliation and safe cell text',async () => {
  const f = fixture(),result = await f.module.admissionsOperationsReport({intakeId:'I1',format:'csv'},actor);
  assert.match(result.csv,/definition_approval/);assert.match(result.csv,/owner approval pending/);assert.match(result.csv,/filter_intake/);assert.match(result.csv,/capacity_reconciles/);assert.doesNotMatch(result.csv,/PRIVATE/);
  assert.ok(f.calls.find((call) => call.sql.includes('insert into audit_events')).values.includes('reports.admissions.exported'));
  const report = await fixture().module.admissionsOperationsReport({intakeId:'I1'},actor);report.rows[0].label='=HYPERLINK("attack")';
  assert.match(admissionsReportCsv(report),/"'=HYPERLINK\(""attack""\)"/);
});
