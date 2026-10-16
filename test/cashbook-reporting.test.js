import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cashbookReportFilters,cashbookReportCsv,createCashbookReportingModule} from '../server/modules/cashbook-reporting.js';

test('cashbook export filters reject invalid dates, wrong-kind filters and unknown fields',()=>{
  assert.equal(cashbookReportFilters().kind,'movements');
  assert.equal(cashbookReportFilters({from:'2026-01-01',to:'2026-01-31'},'2026-10-10').to,'2026-01-31');
  for(const input of [null,[],{kind:'unknown'},{offset:'25'},{from:[]},{from:'2026-02-30'},{to:'2027-01-01'},{from:'2026-01-31',to:'2026-01-01'},{kind:'accounts',from:'2026-01-01'},{periodId:'x'},{kind:'reconciliation'},{kind:'reconciliation',periodId:'\n'}])assert.throws(()=>cashbookReportFilters(input,'2026-10-10'));
});
test('cashbook CSV preserves exact monetary strings and protects all formula-like cells',()=>{
  const csv=cashbookReportCsv({filters:{kind:'reconciliation'},bookName:' =HYPERLINK("x")',rows:[{openingMinor:'9007199254740993',varianceMinor:'-3',reason:'\t@SUM(A1)',status:'draft',revision:2}]});
  assert.ok(csv.includes('"\' =HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"9007199254740993"'));assert.ok(csv.includes('"\'-3"'));assert.ok(csv.includes('"\'\t@SUM(A1)"'));assert.ok(csv.includes('"draft","2"'));assert.ok(csv.endsWith('\r\n'));
});
test('cashbook exports cannot borrow global scope from unrelated roles',async()=>{
  const module=createCashbookReportingModule({connect(){throw new Error('Must not connect');}});
  await assert.rejects(module.cashbookReport('book',{}, {roles:[{scope:{programmeCodes:['BSC']},permissions:['cashbook.view']},{scope:{},permissions:['staff.manage']}]}),{statusCode:403});
});
test('oversized cashbook reports and failed export audits roll back without output',async()=>{
  const actor={accountId:'officer',roles:[{scope:{},permissions:['cashbook.view']}]};
  for(const oversized of [true,false]) {
    const queries=[];const db={release(){},async query(sql){queries.push(sql);if(sql.includes('from cashbooks'))return {rows:[{bookId:'book',currency:'USD'}]};if(sql.includes('transaction_timestamp'))return {rows:[{generatedAt:'2026-10-10T00:00:00Z'}]};if(sql.includes('from cashbook_movements'))return {rows:Array(oversized ? 5001 : 1).fill({amountMinor:'1'})};if(sql.toLowerCase().includes('insert into'))throw new Error('Audit fault');return {rows:[]};}};
    await assert.rejects(createCashbookReportingModule({connect:async()=>db}).cashbookReport('book',{},actor),oversized ? /exceeds 5,000/ : /Audit fault/);
    assert.ok(queries.some(sql=>sql.toLowerCase()==='rollback'));assert.ok(!queries.some(sql=>sql.toLowerCase()==='commit'));
  }
});
