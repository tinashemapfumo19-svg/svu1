import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistryReportingModule,registryMetrics,registryMetricVersion,registryReportFilters,registryReportControls,registryReportCsv} from '../server/modules/registry-reporting.js';

const actor = {accountId:'office',permissions:['registry.view','audit.view'],roles:[{permissions:['registry.view'],scope:{programmeCodes:['P1'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P1',label:'First',status:'published'},{intakeId:'I2',programmeCode:'P1',label:'Second',status:'closed'},{intakeId:'I3',programmeCode:'P2',label:'PRIVATE',status:'draft'}];
const zero = () => Object.fromEntries(registryMetrics.map((entry) => [entry.id,0]));
const source = (intakeId) => ({...zero(),intakeId,programmeRecords:'2',onboarded:'1',transferred:'1',registrationPeriods:'2',openPeriods:'1',closedPeriods:'1',registrationRecords:'3',draftRegistrations:'1',confirmedRegistrations:'2',courseEnrolments:'4'});
function fixture({badBindings = false,counts} = {}) {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id') && !values) return {rows:intakes};
    if (sql.startsWith('select 1 from student_registrations')) return {rows:badBindings ? [{found:1}] : []};
    if (sql.startsWith('select i.id') && values) return {rows:values[0].map((id) => ({...source(id),...counts?.[id]}))};
    return {rows:[]};
  }};
  return {calls,module:createRegistryReportingModule({async connect(){return db;}})};
}
test('registry dictionary versions current records versus retained period records, never headcounts',async () => {
  const data = await fixture().module.registryMetricDictionary(actor);assert.equal(data.definitionVersion,registryMetricVersion);assert.equal(data.metrics.length,17);
  for (const entry of registryMetrics) {assert.ok(Object.isFrozen(entry));for (const key of ['owner','unit','formula','exclusions','filters','refresh']) assert.ok(entry[key]);assert.match(entry.approval,/pending/);}
  assert.match(data.metrics.find((entry) => entry.id === 'confirmedRegistrations').exclusions,/retained confirmations/);
  assert.match(data.metrics.find((entry) => entry.id === 'programmeRecords').exclusions,/Not unique/);
  await assert.rejects(fixture().module.registryMetricDictionary({...actor,permissions:['registry.self']}),{statusCode:403});
});
test('registry filters reject invented historical, student, period and state criteria',() => {
  assert.deepEqual(registryReportFilters(),{programmeCode:'',intakeId:'',format:'json'});
  for (const input of [{asOf:'2026-10-05'},{periodId:'term'},{studentId:'person'},{status:'onboarded'},{intakeId:'x\n'},{programmeCode:'x'.repeat(161)},{intakeId:5},{format:'pdf'}]) assert.throws(() => registryReportFilters(input),{statusCode:400});
});
test('registry-specific scope precedes independent source counts in a repeatable-read snapshot',async () => {
  const f = fixture(),report = await f.module.registryOperationsReport({},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(report.generatedAt,'2026-10-05T11:00:00.000Z');assert.deepEqual(report.availableIntakes,intakes.slice(0,2));
  for (const call of f.calls.filter((call) => call.sql.includes('any($1::text[])'))) assert.deepEqual(call.values,[['I1','I2']]);
  assert.equal(report.totals.programmeRecords,4);assert.equal(report.totals.confirmedRegistrations,4);assert.equal(report.totals.courseEnrolments,8);
  assert.deepEqual(report.controls,{programmesReconcile:true,periodsReconcile:true,registrationsReconcile:true});assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
  const gate = f.calls.find((call) => call.sql.startsWith('select 1'));
  for (const term of ['sp.intake_id <> rp.intake_id','ce.student_id <> sp.student_id','ce.academic_period_id <> rp.academic_period_id','jsonb_array_length','sr.selected_courses ? ce.course_id']) assert.ok(gate.sql.includes(term));
});
test('inaccessible explicit intake fails, empty selection skips sources and self authority never suffices',async () => {
  await assert.rejects(fixture().module.registryOperationsReport({intakeId:'I3'},actor),{statusCode:404});
  const f = fixture(),empty = await f.module.registryOperationsReport({programmeCode:'P2'},actor);assert.deepEqual(empty.rows,[]);assert.ok(Object.values(empty.totals).every((count) => count === 0));assert.equal(f.calls.some((call) => call.sql.includes('any($1::text[])')),false);
  await assert.rejects(f.module.registryOperationsReport({}, {...actor,permissions:['registry.self']}),{statusCode:403});
});
test('bad source bindings fail before counting but scoped metadata discovery stays available',async () => {
  const f = fixture({badBindings:true});await assert.rejects(f.module.registryOperationsReport({},actor),{statusCode:409});assert.equal(f.calls.some((call) => call.sql.startsWith('select i.id') && call.values),false);assert.equal(f.calls.at(-1).sql,'rollback');
  const meta = fixture({badBindings:true});assert.deepEqual(await meta.module.listRegistryReportingIntakes(actor),intakes.slice(0,2));assert.equal(meta.calls.some((call) => call.sql.includes('any($1::text[])')),false);
});
test('partitions include unclassified states and opposing discrepancies cannot cancel',async () => {
  const counts = {...zero(),programmeRecords:1,unclassifiedProgrammes:1};assert.equal(registryReportControls(counts).programmesReconcile,true);
  const report = await fixture({counts:{I1:{programmeRecords:3},I2:{programmeRecords:1}}}).module.registryOperationsReport({},actor);
  assert.equal(registryReportControls(report.totals).programmesReconcile,true);assert.equal(report.controls.programmesReconcile,false);
});
test('row and aggregate counts cannot silently exceed exact precision',async () => {
  for (const counts of [{I1:{courseEnrolments:'9007199254740993'}},{I1:{courseEnrolments:'9007199254740991'},I2:{courseEnrolments:'1'}}]) await assert.rejects(fixture({counts}).module.registryOperationsReport({},actor),{statusCode:409});
});
test('fresh CSV carries version, scope, units and controls with safe labels and separate export audit',async () => {
  const f = fixture(),data = await f.module.registryOperationsReport({intakeId:'I1'},actor);data.rows[0].label='=HYPERLINK("attack")';assert.match(registryReportCsv(data),/"'=HYPERLINK\(""attack""\)"/);
  const file = await f.module.registryOperationsReport({intakeId:'I1',format:'csv'},actor);assert.match(file.csv,/owner approval pending/);assert.match(file.csv,/programme-period records/);assert.match(file.csv,/registrations_reconcile/);assert.doesNotMatch(file.csv,/PRIVATE/);
  assert.equal(f.calls.filter((call) => call.sql.startsWith('select 1')).length,2);assert.ok(f.calls.find((call) => call.sql.includes('insert into audit_events') && call.values.includes('reports.registry.exported')));
});
