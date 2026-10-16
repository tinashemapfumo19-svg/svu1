import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLeaveDays, leaveDate, leaveManager, leaveNextStatus, validateLeaveCategory, validateLeaveRequest } from '../server/modules/staff-leave.js';

test('leave counting uses immutable explicit policy, real dates and one calendar year',() => {
  assert.equal(countLeaveDays('2026-10-09','2026-10-12',{dayBasis:'calendar',excludedDates:[]}),4);
  assert.equal(countLeaveDays('2026-10-09','2026-10-12',{dayBasis:'weekdays',excludedDates:['2026-10-12']}),1);
  assert.throws(() => countLeaveDays('2026-10-10','2026-10-11',{dayBasis:'weekdays',excludedDates:[]}));
  for (const invalid of ['2026-02-30','2026-13-01',null,'1999-12-31','2201-01-01']) assert.throws(() => leaveDate(invalid));
  assert.throws(() => countLeaveDays('2026-12-31','2027-01-01',{dayBasis:'calendar',excludedDates:[]}));
  assert.throws(() => countLeaveDays('2026-10-12','2026-10-09',{dayBasis:'calendar',excludedDates:[]}));
});
test('leave policies and requests reject unsupported fields and ambiguous data',() => {
  const category = {code:'ANNUAL',name:'Annual leave',dayBasis:'weekdays',excludedDates:[],reason:'Approved policy'};
  assert.equal(validateLeaveCategory(category).name,'Annual leave');
  for (const change of [{days:30},{dayBasis:'guess'},{excludedDates:['2026-10-09','2026-10-09']},{code:'bad'},{reason:''}]) assert.throws(() => validateLeaveCategory({...category,...change}));
  const input = {categoryCode:'ANNUAL',startsOn:'2026-10-12',endsOn:'2026-10-13',reason:' Rest ',replayKey:'request_key_123456'};
  assert.equal(validateLeaveRequest(input,'2026-10-09').reason,'Rest');
  assert.deepEqual(validateLeaveRequest(Object.fromEntries(Object.entries(input).reverse()),'2026-10-09'),validateLeaveRequest(input,'2026-10-09'));
  for (const change of [{startsOn:'2026-10-01'},{replayKey:'short'},{days:999},{endsOn:'2027-01-01'}]) assert.throws(() => validateLeaveRequest({...input,...change},'2026-10-09'));
});
test('leave transitions separate self, supervisor and independent manager authority',() => {
  const row = {status:'requested',startsOn:'2026-10-12'};
  assert.equal(leaveNextStatus(row,'recommend',{supervisor:true}),'recommended');
  assert.equal(leaveNextStatus(row,'cancel',{self:true}),'cancelled');
  assert.throws(() => leaveNextStatus(row,'approve',{manager:true}));
  assert.throws(() => leaveNextStatus(row,'recommend',{supervisor:true,self:true}));
  assert.equal(leaveNextStatus({...row,status:'recommended'},'approve',{manager:true}),'approved');
  assert.throws(() => leaveNextStatus({...row,status:'recommended'},'approve',{manager:true,self:true}));
  assert.equal(leaveNextStatus({...row,status:'approved'},'cancel',{self:true},'2026-10-09'),'cancelled');
  assert.throws(() => leaveNextStatus({...row,status:'approved'},'cancel',{self:true},'2026-10-12'));
  assert.equal(leaveNextStatus({...row,status:'approved'},'reverse',{manager:true}),'reversed');
  assert.throws(() => leaveNextStatus({...row,status:'cancelled'},'approve',{manager:true}));
});
test('leave management cannot borrow scope from unrelated global roles',() => {
  assert.equal(leaveManager({roles:[{code:'hr_officer',permissions:['leave.manage'],scope:{programmeCodes:['BSC']}}]}),false);
  assert.equal(leaveManager({roles:[{code:'hr_officer',permissions:['leave.manage'],scope:{programmeCodes:['BSC']}},{code:'lecturer',permissions:['leave.self'],scope:{}}]}),false);
  assert.equal(leaveManager({roles:[{code:'hr_officer',permissions:['leave.manage'],scope:{}}]}),true);
});
