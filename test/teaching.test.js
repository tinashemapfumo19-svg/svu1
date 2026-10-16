import test from "node:test";
import assert from "node:assert/strict";
import { allocationConflicts, meetingsClash, offeringCoverage, validateAllocation } from "../server/modules/teaching.js";

const allocation = (overrides = {}) => ({courseId:"c1",staffId:"stf_a",role:"lead",workloadUnits:3.5,effectiveFrom:"2026-02-01",reason:"Approved teaching plan",...overrides});
const existing = (overrides = {}) => ({id:1,periodId:"p1",courseId:"c2",staffId:"stf_a",role:"lead",status:"active",academicPeriodId:"ap1",meetings:[{day:1,start:540,end:600}],code:"C2",...overrides});

test("allocations need a known role and bounded two-decimal workload",() => {
  assert.deepEqual(validateAllocation(allocation()),{effectiveFrom:"2026-02-01"});
  for (const change of [{role:"assistant"},{workloadUnits:-1},{workloadUnits:1.234},{workloadUnits:"3"},{reason:""},{effectiveFrom:"2026-02-30"},{replacesAllocationId:"1"},{hours:3}]) {
    assert.throws(() => validateAllocation(allocation(change)),{statusCode:400});
  }
});

test("teaching clashes and moderator independence are detected; other overlaps are allowed",() => {
  const candidate = {periodId:"p1",courseId:"c1",staffId:"stf_a",role:"co_lecturer",academicPeriodId:"ap1",meetings:[{day:1,start:570,end:630}]};
  assert.match(allocationConflicts(candidate,[existing()])[0],/meets at the same time/);
  assert.deepEqual(allocationConflicts({...candidate,academicPeriodId:"ap2"},[existing()]),[]);
  assert.deepEqual(allocationConflicts({...candidate,role:"moderator"},[existing()]),[]);
  assert.deepEqual(allocationConflicts({...candidate,effectiveFrom:"2026-04-01"},[existing({status:"ended",effectiveFrom:"2026-02-01",effectiveTo:"2026-03-31"})]),[]);
  assert.equal(allocationConflicts({...candidate,effectiveFrom:"2026-03-01"},[existing({status:"ended",effectiveFrom:"2026-02-01",effectiveTo:"2026-03-31"})]).length,1);
  assert.deepEqual(allocationConflicts(candidate,[existing({status:"rejected"})]),[]);
  assert.deepEqual(allocationConflicts(candidate,[existing({staffId:"stf_b"})]),[]);
  assert.match(allocationConflicts({...candidate,role:"examiner"},[existing({courseId:"c1"})])[0],/cannot also teach/);
  assert.deepEqual(allocationConflicts({...candidate,replacesAllocationId:1},[existing()]),[]);
  assert.equal(meetingsClash([{day:2,start:540,end:600}],[{day:2,start:600,end:660}]),false);
});

test("an offering is covered only by an approved lead whose staff record is active",() => {
  assert.deepEqual(offeringCoverage([]),{covered:false,reason:"No lead lecturer allocated."});
  assert.deepEqual(offeringCoverage([{role:"lead",status:"proposed"}]),{covered:false,reason:"Lead lecturer awaiting approval."});
  assert.deepEqual(offeringCoverage([{role:"lead",status:"active",staffStatus:"suspended"}]),{covered:false,reason:"Lead lecturer is suspended."});
  assert.equal(offeringCoverage([{role:"tutor",status:"active",staffStatus:"active"},{role:"lead",status:"active",staffStatus:"active"}]).covered,true);
});
