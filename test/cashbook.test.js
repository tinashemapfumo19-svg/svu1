import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cashbookAuthority,cashbookReadFilters,createCashbookModule} from '../server/modules/cashbook.js';
import {createSeedData} from '../scripts/seed-data.js';
test('cashbook authority must belong to the permission-bearing institution-wide role',()=>{
  assert.equal(cashbookAuthority({roles:[{permissions:['cashbook.manage'],scope:{programmeCodes:['BSC']}},{permissions:['staff.manage'],scope:{}}]},'cashbook.manage'),false);
  assert.equal(cashbookAuthority({roles:[{permissions:['cashbook.manage'],scope:{}}]},'cashbook.manage'),true);
});
test('cashbook read filters cannot select arbitrary content or unbounded pages',()=>{
  assert.deepEqual(cashbookReadFilters({},['bookOffset']),{bookOffset:0});
  for(const input of [{bookOffset:'01'},{bookOffset:1},{bookOffset:'100001'},{bookOffset:['1']},{format:'csv'}])assert.throws(()=>cashbookReadFilters(input,['bookOffset']),{statusCode:400});
});
test('cashbook permissions remain separate from student finance and service roles',()=>{
  const seed=createSeedData();assert.ok(seed.rolePermissions.cashbook_officer.includes('cashbook.manage'));assert.ok(!seed.rolePermissions.cashbook_officer.includes('cashbook.approve'));
  assert.ok(seed.rolePermissions.cashbook_approver.includes('cashbook.approve'));assert.ok(!seed.rolePermissions.cashbook_approver.includes('cashbook.manage'));
  for(const role of ['student','finance_officer','auditor','lms_connector'])assert.ok(!seed.rolePermissions[role].some(permission=>permission.startsWith('cashbook.')));
});
test('cashbook commands deny absent authority before connecting to retained records',async()=>{
  const module=createCashbookModule({connect(){throw new Error('Must not connect');}},{dataEncryptionKey:Buffer.alloc(32,1)});
  await assert.rejects(module.createCashbookPolicy({title:'Title',owner:'Owner',policyReference:'Reference',retentionRule:'Retained',reason:'Reason',requestKey:'command_123456789'}, {accountId:'actor',roles:[]}),{statusCode:403});
});
