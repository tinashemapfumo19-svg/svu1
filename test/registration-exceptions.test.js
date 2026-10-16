import test from "node:test";
import assert from "node:assert/strict";
import { applicableRegistrationException, exceptionHasTarget, registrationExceptionEvidence, validateExceptionParameters } from "../server/modules/registration-exceptions.js";
import { registrationEligibility } from "../server/modules/course-registration.js";

const row = (kind,parameters,changes = {}) => ({id:"1",kind,parameters,status:"approved",registrationRevision:2,evidenceHash:"source",expiresOn:"2026-10-30",...changes});
const context = () => ({today:"2026-10-02",programme:{id:"sp",status:"onboarded",programmeVersionId:"v1"},
  period:{id:"p",status:"open",programmeVersionId:"v1",calendarStatus:"published",startsOn:"2027-01-01",creditLimit:20,windows:{registration:["2026-10-01","2026-10-30"]}},
  offerings:["c1","c2"].map((courseId) => ({courseId,code:courseId,credits:15,requirementType:"core",status:"active",effectiveFrom:"2026-01-01",delivery:"scheduled",meetings:[{day:1,start:540,end:600}],prerequisites:[]})),
  selectedCourses:["c1","c2"],revision:2,checks:["academic","financial"].map((checkType) => ({checkType,registrationRevision:2,outcome:"eligible",expiresOn:"2026-10-30"})),exceptionEvidenceHash:"source",exceptions:[]});

test("registration exceptions accept only explicit bounded credit and clash parameters",() => {
  assert.deepEqual(validateExceptionParameters("credit_limit",{maxCredits:30.5}),{maxCredits:30.5});
  assert.deepEqual(validateExceptionParameters("timetable_clash",{courseIds:["b","a"]}),{courseIds:["a","b"]});
  for (const [kind,parameters] of [["financial",{}],["credit_limit",{maxCredits:0}],["credit_limit",{maxCredits:481}],["credit_limit",{maxCredits:30.25}],["credit_limit",{maxCredits:30,override:true}],["timetable_clash",{courseIds:["a","a"]}],["timetable_clash",{courseIds:["a","b","c"]}]]) assert.throws(() => validateExceptionParameters(kind,parameters),{statusCode:400});
});

test("exceptions require latest independent approval, revision, evidence and unexpired validity",() => {
  const approved = row("credit_limit",{maxCredits:30});
  assert.equal(applicableRegistrationException([approved],"credit_limit",{},2,"source","2026-10-02"),approved);
  for (const changes of [{status:"requested"},{status:"rejected"},{status:"revoked"},{registrationRevision:3},{evidenceHash:"changed"},{expiresOn:"2026-10-01"}]) assert.equal(applicableRegistrationException([{...approved,...changes}],"credit_limit",{},2,"source","2026-10-02"),null);
  assert.equal(applicableRegistrationException([row("credit_limit",{maxCredits:45},{status:"rejected"}),approved],"credit_limit",{},2,"source","2026-10-02"),null);
});

test("credit ceiling and exact clash pair waive only addressed blockers",() => {
  const input = context();
  input.exceptions = [row("credit_limit",{maxCredits:30}),row("timetable_clash",{courseIds:["c2","c1"]},{id:"2"})];
  const result = registrationEligibility(input);
  assert.equal(result.ready,true); assert.equal(result.appliedExceptions.length,2);
  input.exceptions[0].parameters.maxCredits = 29;
  assert.deepEqual(registrationEligibility(input).blockers.map((entry) => entry.code),["CREDIT_LIMIT"]);
  input.exceptions[1].parameters.courseIds = ["c1","other"];
  assert.deepEqual(registrationEligibility(input).blockers.map((entry) => entry.code),["CREDIT_LIMIT","CLASH"]);
});

test("exceptions cannot bypass unknown prerequisites, finance, progression, repeats or windows",() => {
  const input = context(); input.exceptions = [row("credit_limit",{maxCredits:30}),row("timetable_clash",{courseIds:["c1","c2"]})];
  input.period.yearOfStudy = 2; input.period.status = "closed"; input.offerings[0].prerequisites = ["unknown"]; input.priorCourses = ["c1"]; input.checks = [];
  assert.deepEqual(registrationEligibility(input).blockers.map((entry) => entry.code),["WINDOW","PROGRESSION_APPROVAL","PREREQUISITE_EVIDENCE","REPEAT_EVIDENCE","ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
});

test("exception targets must be current overloads or actual selected-course overlaps",() => {
  const input = context(); input.registration = {selectedCourses:input.selectedCourses};
  assert.equal(exceptionHasTarget(input,"credit_limit",{maxCredits:30}),true);
  assert.equal(exceptionHasTarget(input,"credit_limit",{maxCredits:29}),false);
  assert.equal(exceptionHasTarget(input,"timetable_clash",{courseIds:["c1","c2"]}),true);
  input.offerings[1].meetings[0].start = 600; input.offerings[1].meetings[0].end = 660;
  assert.equal(exceptionHasTarget(input,"timetable_clash",{courseIds:["c1","c2"]}),false);
  input.period.creditLimit = 30;
  assert.equal(exceptionHasTarget(input,"credit_limit",{maxCredits:45}),false);
});

test("exception evidence binds selection, schedules, credits, policy and calendar but not clearances",() => {
  const input = context(); input.registration = {id:"reg",revision:2,selectedCourses:input.selectedCourses}; input.academic = {evidenceHash:"results",policy:null}; input.existingCourses = []; input.priorCourses = [];
  const hash = registrationExceptionEvidence(input).hash;
  input.offerings.reverse(); input.registration.selectedCourses.reverse(); input.checks = [];
  assert.equal(registrationExceptionEvidence(input).hash,hash);
  for (const alter of [(copy) => copy.registration.revision++, (copy) => copy.offerings[0].credits++, (copy) => copy.offerings[0].meetings[0].start++, (copy) => copy.academic.evidenceHash = "new",(copy) => copy.period.windows.registration[1] = "2026-11-01",(copy) => copy.academic.policy = {id:"new"}]) {
    const copy = structuredClone(input); alter(copy); assert.notEqual(registrationExceptionEvidence(copy).hash,hash);
  }
});
