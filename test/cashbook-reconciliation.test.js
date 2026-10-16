import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cashbookPeriodsOverlap,reconcileCashbookEvidence} from '../server/modules/cashbook-reconciliation.js';

const today='2026-10-10';
const account=(id,kind='bank',currency='USD',openingMinor='10000',observedMinor=openingMinor)=>({id,kind,currency,openingMinor,observedMinor,openingEvidenceRef:`OPEN_${id}`,observationEvidenceRef:`CLOSE_${id}`});
const event=(id,kind,amountMinor,extra={})=>({id,kind,amountMinor,accountId:'bank',occurredOn:'2026-10-05',evidenceRef:`EV_${id}`,...extra});
const input=(accounts=[account('bank')],events=[])=>({from:'2026-10-01',to:'2026-10-10',accounts,events});
const run=value=>reconcileCashbookEvidence(value,today);

test('cashbook periods detect enclosing, enclosed and shared-boundary overlap',()=>{
  const period={from:'2026-01-10',to:'2026-01-20'};
  for(const other of [{from:'2026-01-01',to:'2026-01-31'},{from:'2026-01-12',to:'2026-01-14'},{from:'2026-01-20',to:'2026-01-25'}])assert.equal(cashbookPeriodsOverlap(period,other),true);
  assert.equal(cashbookPeriodsOverlap(period,{from:'2026-01-21',to:'2026-01-31'}),false);
  assert.throws(()=>cashbookPeriodsOverlap(period,{from:'2026-02-30',to:'2026-03-01'}));
  assert.throws(()=>cashbookPeriodsOverlap(period,{from:'2026-01-31',to:'2026-01-01'}));
});
test('zero-income periods retain expenditure, bank charges and negative variance',()=>{
  const report=run(input([account('bank','bank','USD','10000','6000')],[event('expense','expenditure','3000'),event('fee','bank_charge','500')]));
  assert.equal(report.rows[0].expectedMinor,'6500');assert.equal(report.rows[0].varianceMinor,'-500');
  assert.equal(report.currencyTotals[0].revenueMinor,'0');assert.equal(report.currencyTotals[0].expenditureMinor,'3500');assert.equal(report.currencyTotals[0].bankChargesMinor,'500');
  assert.equal(report.reconciles,false);
});
test('transfers conserve each currency and never double count physical cash as bank opening',()=>{
  const transfer={id:'deposit',kind:'transfer',amountMinor:'3000',fromAccountId:'cash',toAccountId:'bank',occurredOn:'2026-10-05',evidenceRef:'DEPOSIT_SLIP'};
  const report=run(input([account('bank','bank','USD','10000','13000'),account('cash','cash','USD','4000','1000')],[transfer]));
  assert.equal(report.reconciles,true);assert.equal(report.currencyTotals[0].openingMinor,'14000');assert.equal(report.currencyTotals[0].expectedMinor,'14000');assert.equal(report.currencyTotals[0].revenueMinor,'0');assert.equal(report.currencyTotals[0].expenditureMinor,'0');
  assert.equal(report.rows.find(row=>row.id==='bank').openingMinor,'10000');
  for(const change of [{toAccountId:'cash'},{toAccountId:'missing'},{accountId:'bank'}])assert.throws(()=>run(input([account('bank'),account('cash','cash')],[{...transfer,...change}])));
  assert.throws(()=>run(input([account('bank'),account('cash','cash','ZWL')],[transfer])));
});
test('currency totals cannot hide account-level discrepancies or convert currencies',()=>{
  const report=run(input([account('bank','bank','USD','100','90'),account('cash','cash','USD','100','110'),account('zwl','bank','ZWL','100','100')]));
  assert.equal(report.currencyTotals.length,2);assert.equal(report.currencyTotals[0].varianceMinor,'0');assert.equal(report.currencyTotals[0].reconciles,false);assert.equal(report.reconciles,false);
});
test('reversals restore exact effects independent of input order and refuse duplicate/early/unknown reversals',()=>{
  const original=event('payment','expenditure','700');
  const reversal={id:'void',kind:'reversal',reversesId:'payment',occurredOn:'2026-10-06',evidenceRef:'VOID_APPROVAL'};
  const report=run(input(undefined,[reversal,original]));assert.equal(report.reconciles,true);assert.equal(report.reversalCount,1);assert.equal(report.currencyTotals[0].expenditureMinor,'0');
  assert.equal(report.evidenceHash,run(input(undefined,[original,reversal])).evidenceHash);
  for(const invalid of [{...reversal,amountMinor:'700'},{...reversal,occurredOn:'2026-10-04'},{...reversal,reversesId:'absent'}])assert.throws(()=>run(input(undefined,[original,invalid])));
  assert.throws(()=>run(input(undefined,[original,reversal,{...reversal,id:'void_again'}])));
  assert.throws(()=>run(input(undefined,[original,reversal,{...reversal,id:'void_again',reversesId:'void'}])));
});
test('cashbook evidence is strict, bounded and does not invent omitted observations',()=>{
  for(const change of [{observedMinor:undefined},{openingEvidenceRef:''},{observedMinor:100},{observedMinor:'01'},{observedMinor:'1e3'},{observedMinor:'-0'},{observedMinor:'9223372036854775808'},{currency:'usd'},{id:'bad id'}])assert.throws(()=>run(input([{...account('bank'),...change}])));
  assert.throws(()=>run(input([account('cash','cash','USD','0','-1')])));
  for(const change of [{amountMinor:'0'},{amountMinor:'-1'},{occurredOn:'2026-09-30'},{occurredOn:'2026-10-11'},{accountId:'absent'},{kind:'bank_charge',accountId:'cash'},{currency:'USD'}])assert.throws(()=>run(input([account('bank'),account('cash','cash')],[event('ev','revenue','1',change)])));
  assert.throws(()=>run({...input(),asOf:today}));assert.throws(()=>run(input([],[])));
  assert.throws(()=>run(input([account('bank'),account('bank')])));
  assert.throws(()=>run(input(undefined,[event('same','revenue','1'),event('same','revenue','1')])));
});
test('exact arithmetic survives JavaScript precision limits and refuses storage overflow',()=>{
  const report=run(input([account('bank','bank','USD','9007199254740993','9007199254740994')],[event('receipt','revenue','1')]));
  assert.equal(report.rows[0].expectedMinor,'9007199254740994');assert.equal(report.reconciles,true);
  assert.throws(()=>run(input([account('bank','bank','USD','9223372036854775807')],[event('receipt','revenue','1')])),{statusCode:409});
  assert.throws(()=>run(input([account('bank','bank','USD','9223372036854775807'),account('second','bank','USD','1')])),{statusCode:409});
});
test('cashbook calculation preserves inputs and binds evidence changes deterministically',()=>{
  const original=input([account('bank'),account('cash','cash')],[event('receipt','revenue','20'),event('expense','expenditure','20')]);const before=JSON.stringify(original),report=run(original);
  assert.equal(JSON.stringify(original),before);assert.doesNotThrow(()=>JSON.stringify(report));
  assert.equal(report.evidenceHash,run({...original,accounts:[...original.accounts].reverse(),events:[...original.events].reverse()}).evidenceHash);
  assert.notEqual(report.evidenceHash,run({...original,accounts:original.accounts.map(row=>({...row,observationEvidenceRef:'OTHER_REFERENCE'}))}).evidenceHash);
});
test('later-period reversals use retained originals without reposting their earlier amounts',()=>{
  const original={...event('earlier_expense','expenditure','700'),occurredOn:'2026-09-20',priorReversalId:null};
  const reversal={id:'correction',kind:'reversal',reversesId:original.id,occurredOn:'2026-10-05',evidenceRef:'CORRECTION_APPROVAL'};
  const evidence={...input([account('bank','bank','USD','9300','10000')],[reversal]),originalMovements:[original]};
  const report=run(evidence);
  assert.equal(report.definitionVersion,'cashbook-reconciliation-v2');assert.equal(report.reconciles,true);
  assert.equal(report.rows[0].expectedMinor,'10000');assert.equal(report.currencyTotals[0].expenditureMinor,'-700');
  assert.equal(report.movementCount,1);assert.equal(report.originalMovementCount,1);
  assert.notEqual(report.evidenceHash,run({...evidence,originalMovements:[{...original,evidenceRef:'OTHER_RETAINED_EVIDENCE'}]}).evidenceHash);
  for (const changed of [{priorReversalId:undefined},{priorReversalId:'already_voided'},{occurredOn:'2026-10-01'},{accountId:'missing'},{kind:'reversal',reversesId:'other'}]) assert.throws(()=>run({...evidence,originalMovements:[{...original,...changed}]}));
  assert.throws(()=>run({...evidence,originalMovements:[]}));
  assert.throws(()=>run({...evidence,events:[reversal,{...reversal,id:'duplicate_correction'}]}));
});
test('earlier transfers and bank charges reverse exactly without becoming new revenue',()=>{
  const reversal=id=>({id:`reverse_${id}`,kind:'reversal',reversesId:id,occurredOn:'2026-10-05',evidenceRef:`CORRECTION_${id}`});
  const originalTransfer={id:'deposit',kind:'transfer',amountMinor:'3000',fromAccountId:'cash',toAccountId:'bank',occurredOn:'2026-09-20',evidenceRef:'ORIGINAL_DEPOSIT',priorReversalId:null};
  const originalCharge={...event('fee','bank_charge','500'),occurredOn:'2026-09-21',priorReversalId:null};
  const evidence={...input([account('bank','bank','USD','12500','10000'),account('cash','cash','USD','1000','4000')],[reversal('deposit'),reversal('fee')]),originalMovements:[originalTransfer,originalCharge]};
  const report=run(evidence);assert.equal(report.reconciles,true);assert.equal(report.currencyTotals[0].revenueMinor,'0');assert.equal(report.currencyTotals[0].transferredMinor,'-3000');assert.equal(report.currencyTotals[0].bankChargesMinor,'-500');
  assert.equal(report.evidenceHash,run({...evidence,events:[...evidence.events].reverse(),originalMovements:[...evidence.originalMovements].reverse()}).evidenceHash);
});
test('retained originals cannot be injected unused, duplicated or mixed with current-period identifiers',()=>{
  const original={...event('receipt','revenue','100'),occurredOn:'2026-09-20',priorReversalId:null};
  assert.throws(()=>run({...input(),originalMovements:[original]}));
  const reversal={id:'correction',kind:'reversal',reversesId:'receipt',occurredOn:'2026-10-05',evidenceRef:'APPROVAL'};
  assert.throws(()=>run({...input(undefined,[reversal]),originalMovements:[original,original]}));
  assert.throws(()=>run({...input(undefined,[event('receipt','revenue','100'),reversal]),originalMovements:[original]}));
  assert.throws(()=>run({...input(),originalMovements:'invalid'}));
  assert.throws(()=>run({...input(),originalMovements:Array(10001).fill(original)}));
});
