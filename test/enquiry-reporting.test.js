import test from 'node:test';
import assert from 'node:assert/strict';
import {enquiryMetrics,enquiryMetricVersion,enquiryReportFilters,enquiryReportControls,enquiryReportCsv,createEnquiryReportingModule} from '../server/modules/enquiry-reporting.js';

const actor = {accountId:'office',permissions:['enquiries.manage','admissions.review','audit.view'],roles:[{permissions:['enquiries.manage','admissions.review'],scope:{programmeCodes:['P'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P',label:'First',status:'published'},{intakeId:'I2',programmeCode:'P',label:'Second',status:'closed'},{intakeId:'PRIVATE',programmeCode:'P',label:'PRIVATE',status:'published'}];
const empty = () => Object.fromEntries(enquiryMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
function fixture({mismatch = false,applicationMismatch = false} = {}) {
  const calls = [],source = {...empty(),enquiriesTotal:1,verifiedAccounts:1,open:1,activeConsent:1,unassignedActive:1,awaitingFirstReply:1};
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id')) return {rows:intakes};
    if (sql.startsWith('select 1 from prospective_enquiries')) return {rows:mismatch ? [{found:1}] : []};
    if (sql.startsWith('select 1 from applications')) return {rows:applicationMismatch ? [{found:1}] : []};
    if (sql.startsWith('with cohort')) return {rows:[{...source,intakeId:'I1'},{...source,intakeId:'I2'},{...source,enquiriesTotal:2,open:2,activeConsent:2,unassignedActive:2,awaitingFirstReply:2,intakeId:null}]};
    return {rows:[]};
  }};
  return {calls,module:createEnquiryReportingModule({async connect(){return db;}})};
}
test('enquiry definitions distinguish accounts, notes, associations and unapproved elapsed-time policy',async () => {
  const data = await fixture().module.enquiryMetricDictionary(actor);assert.equal(data.definitionVersion,enquiryMetricVersion);assert.equal(data.metrics.length,20);
  for (const m of enquiryMetrics) {assert.ok(Object.isFrozen(m));for (const k of ['owner','approval','formula','exclusions','filters','refresh']) assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(data.metrics.find((m) => m.id === 'verifiedAccounts').exclusions,/not additive/);
  assert.match(data.metrics.find((m) => m.id === 'publiclyAnswered').exclusions,/Internal notes/);
  assert.match(data.metrics.find((m) => m.id === 'enquiriesWithApplication').exclusions,/not conversion/);
  await assert.rejects(fixture().module.enquiryMetricDictionary({...actor,permissions:['enquiries.self']}),{statusCode:403});
});
test('created cohorts require calendar dates, paired inclusive bounds and bounded ranges',() => {
  assert.deepEqual(enquiryReportFilters(),{intakeId:'',from:'',to:'',format:'json'});
  assert.equal(enquiryReportFilters({intakeId:' I1 ',from:'2024-02-29',to:'2024-02-29'}).from,'2024-02-29');
  for (const f of [null,[],{status:'open'},{asOf:'2026-01-01'},{intakeId:5},{intakeId:'x\n'},{intakeId:'x'.repeat(161)},{format:'pdf'},{from:'2026-01-01'},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-02-01',to:'2026-01-01'},{from:'2024-01-01',to:'2025-01-01'},{from:'0000-01-01',to:'0000-01-02'},{from:'x'.repeat(1000),to:'2026-01-01'}]) assert.throws(() => enquiryReportFilters(f),{statusCode:400});
});
test('report scopes all source reads, takes one snapshot and computes non-additive totals in SQL',async () => {
  const f = fixture(),r = await f.module.enquiryOperationsReport({from:'2026-10-01',to:'2026-10-05'},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(r.generatedAt,'2026-10-05T11:00:00.000Z');
  assert.deepEqual(r.availableIntakes,intakes.slice(0,2));assert.equal(r.totals.verifiedAccounts,1);assert.equal(r.rows.reduce((s,x) => s+x.counts.verifiedAccounts,0),2);
  for (const q of f.calls.filter((q) => q.sql.includes('any($1::text[])'))) assert.deepEqual(q.values,[['I1','I2'],'2026-10-01T00:00:00.000Z','2026-10-06T00:00:00.000Z',...(q.sql.startsWith('select 1 from prospective') ? [] : [['I1','I2']])]);
  const aggregate = f.calls.find((q) => q.sql.startsWith('with cohort')).sql;assert.match(aggregate,/grouping sets/);assert.match(aggregate,/count\(distinct owner_id\)/);assert.match(aggregate,/m.author_kind = 'staff' and m.visibility = 'public'/);assert.match(aggregate,/a.applicant_account_id = e.owner_id/);
  assert.doesNotMatch(aggregate,/body_encrypted|subject_encrypted|reason_encrypted|people/);assert.ok(Object.values(r.controls).every(Boolean));assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('inaccessible intakes and future cohorts fail; ungranted unrelated global roles expose no sources',async () => {
  await assert.rejects(fixture().module.enquiryOperationsReport({intakeId:'PRIVATE'},actor),{statusCode:404});
  await assert.rejects(fixture().module.enquiryOperationsReport({from:'2026-10-05',to:'2026-10-06'},actor),{statusCode:400});
  const f = fixture(),r = await f.module.enquiryOperationsReport({}, {...actor,roles:actor.roles.slice(1)});
  assert.deepEqual(r.rows,[]);assert.deepEqual(r.totals,empty());assert.ok(Object.values(r.controls).every(Boolean));assert.equal(f.calls.some((q) => q.sql.includes('any($1::text[])')),false);
});
test('custody or current history mismatch refuses aggregate reads and rolls back while metadata remains accessible',async () => {
  const f = fixture({mismatch:true});await assert.rejects(f.module.enquiryOperationsReport({},actor),{statusCode:409});
  assert.equal(f.calls.some((q) => q.sql.startsWith('with cohort')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  const check = f.calls.find((q) => q.sql.startsWith('select 1')).sql;assert.match(check,/h.revision = e.revision/);assert.match(check,/is distinct from i.programme_id/);
  assert.deepEqual(await f.module.listEnquiryReportingIntakes(actor),intakes.slice(0,2));
});
test('application associations require separately granted same-intake admissions review, not an unrelated global role',async () => {
  const f = fixture(),r = await f.module.enquiryOperationsReport({}, {...actor,roles:[{permissions:['enquiries.manage'],scope:{programmeCodes:['P'],intakeIds:['I1','I2']}},{permissions:['admissions.review'],scope:{programmeCodes:['P'],intakeIds:['I2']}},{permissions:['audit.view'],scope:{}}]});
  assert.equal(r.applicationAuthority,false);assert.equal(r.totals.enquiriesWithApplication,null);assert.equal(r.controls.applicationsReconcile,null);
  assert.equal(r.rows[0].counts.enquiriesWithApplication,null);assert.equal(r.rows[1].counts.enquiriesWithApplication,0);
  assert.deepEqual(f.calls.find((q) => q.sql.startsWith('with cohort')).values[3],['I2']);
});
test('mismatched associated application resource scopes refuse counts before aggregation',async () => {
  const f = fixture({applicationMismatch:true});await assert.rejects(f.module.enquiryOperationsReport({},actor),{statusCode:409});
  assert.equal(f.calls.some((q) => q.sql.startsWith('with cohort')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  const guard = f.calls.find((q) => q.sql.startsWith('select 1 from applications'));assert.match(guard.sql,/rs.intake_id is distinct from i.id/);assert.deepEqual(guard.values[3],['I1','I2']);
});
test('status, consent, response, association and null timing controls identify discrepancies',() => {
  const c = empty();assert.ok(Object.values(enquiryReportControls(c)).every(Boolean));
  assert.equal(enquiryReportControls({...c,enquiriesTotal:1}).statusReconciles,false);
  assert.equal(enquiryReportControls({...c,activeConsent:1}).consentReconciles,false);
  assert.equal(enquiryReportControls({...c,publiclyAnswered:1}).repliesReconcile,false);
  assert.equal(enquiryReportControls({...c,enquiriesWithLaterApplication:1}).applicationsReconcile,false);
  assert.equal(enquiryReportControls({...c,meanFirstReplyMinutes:0}).timingReconciles,false);
  assert.equal(enquiryReportControls({...c,firstReplySamples:1,meanFirstReplyMinutes:NaN}).timingReconciles,false);
});
test('fresh CSV reauthorizes, audits export and neutralizes spreadsheet formula cells',async () => {
  const f = fixture(),r = await f.module.enquiryOperationsReport({format:'csv'},actor);assert.equal(r.filename,'prospective-enquiry-operations.csv');assert.match(r.csv,/definition_approval/);assert.match(r.csv,/owner approval pending/);assert.doesNotMatch(r.csv,/PRIVATE/);
  assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.enquiries.exported'));
  const report = await fixture().module.enquiryOperationsReport({},actor);report.rows[0].label=' =HYPERLINK("unsafe")';assert.match(enquiryReportCsv(report),/"' =HYPERLINK\(""unsafe""\)"/);
  await assert.rejects(f.module.enquiryOperationsReport({format:'csv'},{...actor,permissions:[]}),{statusCode:403});
});
