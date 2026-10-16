import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceReportingModule,financeMetrics,financeMetricVersion,financeReportFilters,financeReportCsv,financeMajorUnits } from '../server/modules/finance-reporting.js';

const actor = {accountId:'finance',permissions:['finance.view','audit.view'],roles:[{permissions:['finance.view'],scope:{programmeCodes:['P1'],intakeIds:['I1','I2']}},{permissions:['audit.view'],scope:{}}]};
const intakes = [{intakeId:'I1',intakeLabel:'First',programmeCode:'P1'},{intakeId:'I2',intakeLabel:'Second',programmeCode:'P1'},{intakeId:'I3',intakeLabel:'PRIVATE',programmeCode:'P2'}];
const row = (intakeId,currency = 'USD',changes = {}) => ({intakeId,currency,accounts:1,charged:'12000',paid:'1000',credited:'3000',outstanding:'11000',due:'11000',unallocated:'3000',opening:'9000',...changes});
function fixture(source = [row('I1'),row('I2','ZWL')]) {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('transaction_timestamp() as')) return {rows:[{generatedAt:'2026-10-05T11:00:00Z'}]};
    if (sql.startsWith('select i.id')) return {rows:intakes};
    if (sql.startsWith('with open_amounts')) return {rows:source.filter((entry) => values[1].includes(entry.intakeId) && (!values[2] || entry.currency === values[2]))};
    if (sql.startsWith('select count(*)')) return {rows:[{currency:'USD',lines:1,amount:'1000'}]};
    return {rows:[]};
  }};
  return {calls,module:createFinanceReportingModule({async connect(){return db;}})};
}
test('finance definitions distinguish account, recording cutoff, opening subset and currency meanings',async () => {
  const data = await fixture().module.financeMetricDictionary(actor);
  assert.equal(data.definitionVersion,financeMetricVersion);assert.equal(data.metrics.length,9);
  for (const metric of financeMetrics) {assert.ok(Object.isFrozen(metric));for (const key of ['owner','unit','formula','exclusions','filters','refresh']) assert.ok(metric[key]);assert.match(metric.approval,/pending/);}
  assert.match(data.metrics.find((entry) => entry.id === 'accounts').exclusions,/Not unique/);
  assert.match(data.metrics.find((entry) => entry.id === 'paid').exclusions,/not received_on/);
  await assert.rejects(fixture().module.financeMetricDictionary({...actor,permissions:['registry.self']}),{statusCode:403});
});
test('report filter dates, identifiers, currencies and formats are bounded and explicit',() => {
  assert.deepEqual(financeReportFilters({},'2026-10-05'),{asOf:'2026-10-05',currency:'',programmeCode:'',intakeId:'',format:'json'});
  for (const input of [{asOf:'2026-02-30'},{asOf:'2026-10-06'},{asOf:4},{asOf:''},{currency:'usd'},{currency:'USD\n'},{intakeId:'x'.repeat(161)},{programmeCode:4},{format:'pdf'},{state:'paid'}]) assert.throws(() => financeReportFilters(input,'2026-10-05'),{statusCode:400});
});
test('finance-specific scope precedes ledger aggregation in one UTC repeatable-read snapshot',async () => {
  const f = fixture(),report = await f.module.financeControlTotals({asOf:'2026-10-05'},actor);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(report.generatedAt,'2026-10-05T11:00:00.000Z');
  assert.deepEqual(report.availableIntakes,intakes.slice(0,2));assert.equal(report.rows.length,2);assert.equal(report.totals.length,2);
  assert.deepEqual(report.rows[0],{...intakes[0],currency:'USD',accounts:1,charged:12000,paid:1000,credited:3000,outstanding:11000,due:11000,unallocated:3000,opening:9000,balance:8000,reconciles:true});
  const query = f.calls.find((call) => call.sql.startsWith('with open_amounts'));
  assert.deepEqual(query.values,['2026-10-05',['I1','I2'],'']);assert.match(query.sql,/sp.intake_id = any\(\$2::text\[\]\)/);assert.match(query.sql,/at time zone 'UTC'/);assert.match(query.sql,/a.allocated_at </);assert.doesNotMatch(query.sql,/received_on/);
  assert.equal(report.unmatchedQueue,null);assert.doesNotMatch(JSON.stringify(report),/PRIVATE/);
});
test('explicit denied intake fails, empty selection skips ledger SQL, currency remains separate',async () => {
  await assert.rejects(fixture().module.financeControlTotals({intakeId:'I3'},actor),{statusCode:404});
  const f = fixture(),empty = await f.module.financeControlTotals({programmeCode:'P2'},actor);
  assert.deepEqual(empty.rows,[]);assert.deepEqual(empty.totals,[]);assert.equal(f.calls.some((call) => call.sql.startsWith('with open_amounts')),false);
  const usd = await fixture().module.financeControlTotals({currency:'USD'},actor);assert.equal(usd.totals.length,1);assert.equal(usd.totals[0].currency,'USD');
  await assert.rejects(fixture().module.financeControlTotals({}, {...actor,permissions:['registry.self']}),{statusCode:403});
});
test('current unmatched queue needs global import authority and has its own snapshot meaning',async () => {
  const f = fixture(),report = await f.module.financeControlTotals({asOf:'2025-01-01',currency:'USD'},{...actor,roles:[...actor.roles,{permissions:['finance.import'],scope:{}}]});
  assert.deepEqual(report.unmatchedQueue,[{currency:'USD',lines:1,amount:1000}]);assert.equal(report.unmatchedQueueAsOf,report.generatedAt);
  assert.deepEqual(f.calls.find((call) => call.sql.startsWith('select count(*)')).values,['USD']);
});
test('opposing per-intake differences cannot cancel a failed currency control',async () => {
  const report = await fixture([row('I1','USD',{outstanding:'11001'}),row('I2','USD',{outstanding:'10999'})]).module.financeControlTotals({},actor);
  assert.equal(report.totals[0].outstanding-report.totals[0].unallocated,report.totals[0].balance);assert.equal(report.totals[0].reconciles,false);
});
test('unsafe row, balance or aggregate arithmetic fails rather than rounding financial totals',async () => {
  for (const source of [[row('I1','USD',{charged:'9007199254740993'})],[row('I1','USD',{charged:'9007199254740991',paid:'-1',credited:'0'})],[row('I1','USD',{charged:'9007199254740990'}),row('I2')]]) {
    const f = fixture(source);await assert.rejects(f.module.financeControlTotals({},actor),{statusCode:409});assert.equal(f.calls.at(-1).sql,'rollback');
  }
  assert.equal(financeMajorUnits(9007199254740991),'90071992547409.91');assert.equal(financeMajorUnits(-1),'-0.01');
});
test('fresh server CSV audits export independently and neutralizes text, not legitimate negative money',async () => {
  const f = fixture([row('I1','USD',{charged:'0',paid:'0',credited:'3000',outstanding:'0',due:'0',opening:'-3000'})]);
  const data = await f.module.financeControlTotals({},actor);data.rows[0].intakeLabel=' =HYPERLINK("attack")';
  const csv = financeReportCsv(data);assert.match(csv,/"' =HYPERLINK\(""attack""\)"/);assert.match(csv,/"-30.00"/);assert.match(csv,/owner approval pending/);assert.match(csv,/currency_total/);assert.doesNotMatch(csv,/PRIVATE/);
  await f.module.financeControlTotals({format:'csv'},actor);
  assert.equal(f.calls.filter((call) => call.sql.startsWith('with open_amounts')).length,2);
  assert.ok(f.calls.find((call) => call.sql.includes('insert into audit_events') && call.values.includes('reports.finance.exported')));
});
