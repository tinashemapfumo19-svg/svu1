import test from 'node:test';
import assert from 'node:assert/strict';
import {supportMetrics,supportMetricVersion,supportReportFilters,supportReportControls,supportReportCsv,createSupportReportingModule} from '../server/modules/support-reporting.js';

const actor = {accountId:'office',permissions:['support.view','audit.view'],roles:[{permissions:['support.view'],scope:{programmeCodes:['P'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P',label:'First'},{intakeId:'I2',programmeCode:'P',label:'Second'},{intakeId:'PRIVATE',programmeCode:'P',label:'PRIVATE'}];
const empty = () => Object.fromEntries(supportMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
function fixture(mismatch = false) {
  const calls = [],source = {...empty(),casesTotal:1,ownerAccounts:1,programmeRecords:1,open:1,activeCases:1,unassignedActive:1,awaitingFirstReply:1,priority_normal:1,category_other:1};
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id')) return {rows:intakes};
    if (sql.startsWith('select 1 from support_cases')) return {rows:mismatch ? [{found:1}] : []};
    if (sql.startsWith('with cohort')) return {rows:[{...source,intakeId:'I1'},{...source,intakeId:'I2'},{...source,casesTotal:2,programmeRecords:2,open:2,activeCases:2,unassignedActive:2,awaitingFirstReply:2,priority_normal:2,category_other:2,intakeId:null}]};
    return {rows:[]};
  }};
  return {calls,module:createSupportReportingModule({async connect(){return db;}})};
}
test('support dictionary distinguishes current owners, retained resolutions and unapproved elapsed policy',async () => {
  const r = await fixture().module.supportMetricDictionary(actor);assert.equal(r.definitionVersion,supportMetricVersion);assert.equal(r.metrics.length,29);
  for (const m of r.metrics) {assert.ok(Object.isFrozen(m));for (const k of ['owner','approval','formula','exclusions','filters','refresh']) assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(r.metrics.find((m) => m.id === 'ownerAccounts').exclusions,/not additive/);
  assert.match(r.metrics.find((m) => m.id === 'meanResolutionMinutes').exclusions,/Closed cases retain/);
  await assert.rejects(fixture().module.supportMetricDictionary({...actor,permissions:['support.self']}),{statusCode:403});
});
test('support cohorts require paired valid inclusive dates and exact current classifications',() => {
  assert.deepEqual(supportReportFilters(),{intakeId:'',category:'',priority:'',from:'',to:'',format:'json'});
  assert.equal(supportReportFilters({from:'2024-02-29',to:'2024-02-29',category:'finance',priority:'urgent'}).category,'finance');
  for (const f of [null,[],{status:'open'},{category:'bad'},{priority:1},{intakeId:'x\n'},{intakeId:'x'.repeat(161)},{format:'pdf'},{from:'2026-01-01'},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-02-01',to:'2026-01-01'},{from:'2024-01-01',to:'2025-01-01'},{from:'0000-01-01',to:'0000-01-02'}]) assert.throws(() => supportReportFilters(f),{statusCode:400});
});
test('support report takes one snapshot with exact native scope and direct non-additive SQL totals',async () => {
  const f = fixture(),r = await f.module.supportOperationsReport({from:'2026-10-01',to:'2026-10-05',category:'other',priority:'normal'},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(r.generatedAt,'2026-10-05T11:00:00.000Z');assert.deepEqual(r.availableIntakes,intakes.slice(0,2));
  assert.equal(r.totals.ownerAccounts,1);assert.equal(r.rows.reduce((s,x) => s+x.counts.ownerAccounts,0),2);assert.ok(Object.values(r.controls).every(Boolean));
  for (const q of f.calls.filter((q) => q.sql.includes('any($1::text[])'))) assert.deepEqual(q.values,[['I1','I2'],'2026-10-01T00:00:00.000Z','2026-10-06T00:00:00.000Z','other','normal']);
  const aggregate = f.calls.find((q) => q.sql.startsWith('with cohort')).sql;assert.match(aggregate,/grouping sets/);assert.match(aggregate,/count\(distinct owner_id\)/);assert.match(aggregate,/m.author_kind = 'staff' and m.visibility = 'public'/);assert.doesNotMatch(aggregate,/body_encrypted|subject_encrypted|reason_encrypted/);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('unrelated global roles and empty intake arrays cannot widen native support scope',async () => {
  for (const roles of [actor.roles.slice(1),[{permissions:['support.view'],scope:{programmeCodes:['P'],intakeIds:[]}},actor.roles[1]]]) {
    const f = fixture(),r = await f.module.supportOperationsReport({}, {...actor,roles});assert.deepEqual(r.rows,[]);assert.deepEqual(r.totals,empty());assert.equal(f.calls.some((q) => q.sql.startsWith('with cohort')),false);
  }
  await assert.rejects(fixture().module.supportOperationsReport({intakeId:'PRIVATE'},actor),{statusCode:404});
  await assert.rejects(fixture().module.supportOperationsReport({from:'2026-10-05',to:'2026-10-06'},actor),{statusCode:400});
});
test('custody history and timestamp source faults fail before aggregation and rollback',async () => {
  const f = fixture(true);await assert.rejects(f.module.supportOperationsReport({},actor),{statusCode:409});assert.equal(f.calls.some((q) => q.sql.startsWith('with cohort')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  const guard = f.calls.find((q) => q.sql.startsWith('select 1')).sql;assert.match(guard,/sp.intake_id is distinct from c.intake_id/);assert.match(guard,/h.revision = c.revision/);assert.match(guard,/h.category = c.category and h.priority = c.priority/);assert.match(guard,/c.closed_at < c.resolved_at/);
  assert.deepEqual(await f.module.listSupportReportingIntakes(actor),intakes.slice(0,2));
});
test('support reconciliation checks classifications, active subsets and absent timing',() => {
  const c = empty();assert.ok(Object.values(supportReportControls(c)).every(Boolean));
  for (const [field,control] of [['casesTotal','statusReconciles'],['priority_high','priorityReconciles'],['category_other','categoryReconciles'],['unassignedActive','workloadReconciles'],['publiclyAnswered','repliesReconcile'],['meanFirstReplyMinutes','timingReconciles']]) assert.equal(supportReportControls({...c,[field]:1})[control],false);
  assert.equal(supportReportControls({...c,firstReplySamples:1,meanFirstReplyMinutes:NaN}).timingReconciles,false);
});
test('support CSV is freshly authorized, separately audited and formula-safe',async () => {
  const f = fixture(),r = await f.module.supportOperationsReport({format:'csv'},actor);assert.equal(r.filename,'student-support-operations.csv');assert.match(r.csv,/owner approval pending/);assert.doesNotMatch(r.csv,/PRIVATE/);
  assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.support.exported'));
  const report = await fixture().module.supportOperationsReport({},actor);report.rows[0].label=' =HYPERLINK("unsafe")';assert.match(supportReportCsv(report),/"' =HYPERLINK\(""unsafe""\)"/);
  await assert.rejects(f.module.supportOperationsReport({format:'csv'},{...actor,permissions:[]}),{statusCode:403});
});
