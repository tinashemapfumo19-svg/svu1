import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetReportFilters,assetReportCsv,createAssetReportingModule} from '../server/modules/asset-reporting.js';

test('asset report filters are bounded, strict and date-aware',()=>{
  assert.equal(assetReportFilters().kind,'register');
  assert.equal(assetReportFilters({kind:'stock_checks',from:'2026-01-01',to:'2026-10-09'},'2026-10-10').from,'2026-01-01');
  for (const input of [{kind:'unknown'},{offset:'25'},{q:['x']},{q:'x\n'},{status:'deleted'},{from:'2026-01-01'},{kind:'stock_checks',from:'2026-02-30'},{kind:'stock_checks',to:'2027-01-01'},{kind:'stock_checks',from:'2026-10-09',to:'2026-01-01'}]) assert.throws(()=>assetReportFilters(input,'2026-10-10'));
});
test('asset report CSV preserves exact minor units and escapes formula cells',()=>{
  const csv=assetReportCsv({definitionVersion:'v1',generatedAt:'2026-10-10',filters:{kind:'register'},rows:[{assetTag:'AS_001',name:' =HYPERLINK("x")',valueMinor:'9007199254740993',currency:'USD'}]});
  assert.ok(csv.includes('"\' =HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"9007199254740993"'));
  assert.ok(csv.endsWith('\r\n'));
});
test('asset reporting rejects scoped authority before database access',async()=>{
  const module=createAssetReportingModule({connect(){throw new Error('Must not connect');}});
  await assert.rejects(module.assetReport({}, {roles:[{code:'asset_officer',scope:{programmeCodes:['BSC']},permissions:['assets.manage']},{code:'hr_officer',scope:{},permissions:['staff.manage']}]}),{statusCode:403});
});
test('oversized asset exports and audit faults roll back without a partial report',async()=>{
  const actor={accountId:'officer',roles:[{code:'asset_officer',scope:{},permissions:['assets.manage']}]};
  for (const oversized of [true,false]) {
    const commands=[];
    const db={release(){},async query(sql){commands.push(sql);if(sql.includes('transaction_timestamp'))return {rows:[{generatedAt:'2026-10-10T00:00:00Z'}]};if(sql.includes('from institution_assets'))return {rows:Array(oversized ? 5001 : 1).fill({assetTag:'AS_001'})};if(sql.toLowerCase().includes('insert into'))throw new Error('Audit storage fault');return {rows:[]};}};
    const module=createAssetReportingModule({connect:async()=>db});
    await assert.rejects(module.assetReport({},actor),oversized ? /exceeds 5,000/ : /Audit storage fault/);
    assert.ok(commands.includes('ROLLBACK') || commands.includes('rollback'));
    assert.ok(!commands.some(sql=>sql.toLowerCase()==='commit'));
  }
});
