import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationMetrics,communicationMetricVersion,communicationReportFilters,communicationReportControls,communicationReportCsv,createCommunicationReportingModule} from '../server/modules/communication-reporting.js';
const actor = {accountId:'office',permissions:['admissions.communicate','audit.view'],roles:[{permissions:['admissions.communicate'],scope:{programmeCodes:['P'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',programmeCode:'P',label:'First'},{intakeId:'I2',programmeCode:'P',label:'Second'},{intakeId:'PRIVATE',programmeCode:'P',label:'PRIVATE'}];
const empty = () => Object.fromEntries(communicationMetrics.map((m) => [m.id,m.unit === 'minutes' ? null : 0]));
function fixture(mismatch = false) {
  const calls = [],campaign = {campaignsTotal:1,publishedCampaigns:1,publishedApplications:1,publishedAccountOpportunities:1,publishedRecipientChannels:1,publishedInAppCampaigns:1,publishSamples:1,meanPublishMinutes:2},recipient = {recipientChannels:1,recipientAccounts:1,inAppAvailable:1,inAppUnread:1};
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id')) return {rows:intakes};
    if (sql.startsWith('with sources')) return {rows:mismatch ? [{found:1}] : []};
    if (sql.startsWith('select c.intake_id')) {
      const isRecipient = sql.includes('count(distinct r.account_id)');
      const source = isRecipient ? recipient : campaign;
      return {rows:[{...source,intakeId:'I1'},{...source,intakeId:'I2'},{...Object.fromEntries(Object.entries(source).map(([k,v]) => [k,k.startsWith('mean') || k === 'recipientAccounts' ? v : v*2])),intakeId:null}]};
    }
    return {rows:[]};
  }};
  return {calls,module:createCommunicationReportingModule({async connect(){return db;}})};
}
test('campaign definitions preserve own-preview privacy and distinguish queued email from delivery',async () => {
  const r = await fixture().module.communicationMetricDictionary(actor);assert.equal(r.definitionVersion,communicationMetricVersion);assert.equal(r.metrics.length,29);assert.equal(r.providerDeliveryEvidenceAvailable,false);
  for (const m of r.metrics) {assert.ok(Object.isFrozen(m));for (const k of ['owner','approval','formula','exclusions','filters','refresh']) assert.ok(m[k]);assert.match(m.approval,/pending/);}
  assert.match(r.metrics.find((m) => m.id === 'ownPreviews').exclusions,/Other staff previews/);assert.match(r.metrics.find((m) => m.id === 'emailQueued').exclusions,/not sent email/);
  await assert.rejects(fixture().module.communicationMetricDictionary({...actor,permissions:['communications.self']}),{statusCode:403});
});
test('campaign cohorts accept only exact statuses and paired bounded valid UTC creation dates',() => {
  assert.deepEqual(communicationReportFilters(),{intakeId:'',status:'',from:'',to:'',format:'json'});
  assert.equal(communicationReportFilters({from:'2024-02-29',to:'2024-02-29',status:'preview'}).status,'preview');
  for (const f of [null,[],{channel:'email'},{status:'queued'},{status:1},{intakeId:'x\n'},{intakeId:'x'.repeat(161)},{format:'pdf'},{from:'2026-01-01'},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-02-01',to:'2026-01-01'},{from:'2024-01-01',to:'2025-01-01'},{from:'0000-01-01',to:'0000-01-02'}]) assert.throws(() => communicationReportFilters(f),{statusCode:400});
});
test('campaign report uses one snapshot, creator-aware source scope and direct distinct recipient totals',async () => {
  const f = fixture(),r = await f.module.communicationOperationsReport({from:'2026-10-01',to:'2026-10-05'},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.deepEqual(r.availableIntakes,intakes.slice(0,2));assert.equal(r.totals.recipientAccounts,1);assert.equal(r.rows.reduce((sum,row) => sum+row.counts.recipientAccounts,0),2);assert.ok(Object.values(r.controls).every(Boolean));
  for (const q of f.calls.filter((q) => q.sql.includes('any($1::text[])'))) {assert.deepEqual(q.values,[['I1','I2'],'office','2026-10-01T00:00:00.000Z','2026-10-06T00:00:00.000Z','']);assert.match(q.sql,/c.status = 'published' or c.created_by = \$2/);assert.doesNotMatch(q.sql,/subject_encrypted|body_encrypted|reason_encrypted|audience_encrypted|recipient_encrypted/);}
  const source = f.calls.find((q) => q.sql.includes('count(distinct r.account_id)')).sql;assert.match(source,/grouping sets/);assert.match(source,/avg\(extract\(epoch from r.read_at-r.created_at\)/);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('empty intake scopes and unrelated global roles expose no campaign sources',async () => {
  for (const roles of [actor.roles.slice(1),[{permissions:['admissions.communicate'],scope:{programmeCodes:['P'],intakeIds:[]}},actor.roles[1]]]) {
    const f = fixture(),r = await f.module.communicationOperationsReport({}, {...actor,roles});assert.deepEqual(r.rows,[]);assert.deepEqual(r.totals,empty());assert.equal(f.calls.some((q) => q.sql.includes('any($1::text[])')),false);
  }
  await assert.rejects(fixture().module.communicationOperationsReport({intakeId:'PRIVATE'},actor),{statusCode:404});
  await assert.rejects(fixture().module.communicationOperationsReport({from:'2026-10-05',to:'2026-10-06'},actor),{statusCode:400});
});
test('publication snapshot and historical-consent mismatches fail before aggregate reads',async () => {
  const f = fixture(true);await assert.rejects(f.module.communicationOperationsReport({},actor),{statusCode:409});assert.equal(f.calls.some((q) => q.sql.startsWith('select c.intake_id')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  const check = f.calls.find((q) => q.sql.startsWith('with sources')).sql;assert.match(check,/jsonb_typeof\(c.counts->/);assert.match(check,/h.revision = r.preference_revision/);assert.match(check,/c.status = 'preview' and exists/);assert.match(check,/c.published_at >= c.expires_at/);assert.match(check,/count\(\*\).*c\."recipientChannels"/s);
  assert.deepEqual(await f.module.listCommunicationReportingIntakes(actor),intakes.slice(0,2));
});
test('campaign controls distinguish snapshots, channels, read partitions and null sample durations',() => {
  const c = empty();assert.ok(Object.values(communicationReportControls(c)).every(Boolean));
  for (const [field,control] of [['campaignsTotal','campaignsReconcile'],['publishedAccountOpportunities','audienceReconciles'],['emailQueued','channelsReconcile'],['inAppUnread','readsReconcile'],['meanReadMinutes','timingReconciles']]) assert.equal(communicationReportControls({...c,[field]:1})[control],false);
  assert.equal(communicationReportControls({...c,readSamples:1,meanReadMinutes:NaN}).timingReconciles,false);
  const delivered={...c,recipientChannels:6,publishedRecipientChannels:6,recipientAccounts:1,emailAccepted:1,emailDelivered:1,emailBounced:1,emailComplained:1,emailFailed:1,emailDead:1};
  assert.ok(Object.values(communicationReportControls(delivered)).every(Boolean));
  assert.equal(communicationReportControls({...delivered,emailDelivered:0}).channelsReconcile,false);
});
test('fresh campaign CSV reauthorizes, audits export and neutralizes formula-bearing intake labels',async () => {
  const f = fixture(),r = await f.module.communicationOperationsReport({format:'csv'},actor);assert.equal(r.filename,'applicant-campaign-operations.csv');assert.match(r.csv,/owner approval pending/);assert.match(r.csv,/provider_delivery_evidence_available/);assert.doesNotMatch(r.csv,/PRIVATE/);
  assert.ok(f.calls.find((q) => q.sql.includes('insert into audit_events')).values.includes('reports.communications.exported'));
  const report = await fixture().module.communicationOperationsReport({},actor);report.rows[0].label=' =HYPERLINK("unsafe")';assert.match(communicationReportCsv(report),/"' =HYPERLINK\(""unsafe""\)"/);
  await assert.rejects(f.module.communicationOperationsReport({format:'csv'},{...actor,permissions:[]}),{statusCode:403});
});
