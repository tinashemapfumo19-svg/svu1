import test from "node:test";
import assert from "node:assert/strict";
import { staffInvitationRoles, staffTransitions, validateEmploymentChange, validateNewStaff, validateStatusChange } from "../server/modules/staff.js";

const staff = (overrides = {}) => ({email:"Lecturer@Example.edu",legalName:"Rumbidzai Moyo",preferredName:"Rumbi",category:"LECTURER",grade:"L2",departmentId:"dept_computing",engagedOn:"2026-01-15",roleCode:"legacy_staff",reason:"Approved appointment",...overrides});

test("new staff records normalise email and refuse critical or self-service roles",() => {
  assert.deepEqual(validateNewStaff(staff()),{email:"lecturer@example.edu",engagedOn:"2026-01-15"});
  for (const role of ["system_administrator","auditor","student","applicant"]) assert.equal(staffInvitationRoles.includes(role),false);
  for (const change of [{roleCode:"system_administrator"},{email:"not-an-email"},{employeeNumber:"e 1"},{category:"lecturer"},{grade:""},{reason:" "},{engagedOn:"2026-02-30"},{scope:{faculties:["x"]}},{salary:1}]) {
    assert.throws(() => validateNewStaff(staff(change)),{statusCode:400});
  }
  assert.doesNotThrow(() => validateNewStaff(staff({employeeNumber:"EMP-0042",roleCode:"legacy_supervisor",scope:{programmeCodes:["BSC-IS"]}})));
  assert.throws(() => validateNewStaff(staff({roleCode:'lecturer'})),{statusCode:400});
});

test("employment changes and status changes follow explicit, dated rules",() => {
  assert.deepEqual(validateEmploymentChange({revision:1,departmentId:"dept_computing",category:"MANAGEMENT",grade:"M1",effectiveFrom:"2026-06-01",reason:"Promotion"}),{effectiveFrom:"2026-06-01"});
  assert.throws(() => validateEmploymentChange({revision:1,departmentId:"dept_computing",category:"MANAGEMENT",grade:"M1",reason:"No date"}),{statusCode:400});
  assert.deepEqual(staffTransitions("active"),["suspended","exited"]);
  assert.deepEqual(staffTransitions("exited"),[]);
  assert.deepEqual(validateStatusChange({revision:2,toStatus:"suspended",effectiveOn:"2026-10-01",reason:"Investigation"},"active","2026-10-04"),{effectiveOn:"2026-10-01"});
  assert.throws(() => validateStatusChange({revision:2,toStatus:"active",effectiveOn:"2026-10-01",reason:"x"},"exited","2026-10-04"),{statusCode:409});
  assert.throws(() => validateStatusChange({revision:2,toStatus:"suspended",effectiveOn:"2026-10-05",reason:"Future"},"active","2026-10-04"),{statusCode:400});
  assert.throws(() => validateStatusChange({revision:2,toStatus:"active",effectiveOn:"2026-10-01",reason:"x"},"invited","2026-10-04"),{statusCode:409});
});
