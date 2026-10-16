import test from "node:test";
import assert from "node:assert/strict";
import { exceptionKey, validateExceptionParameters } from "../server/modules/registration-exceptions.js";
import { registrationEligibility } from "../server/modules/course-registration.js";

test("prerequisite waivers name exactly one course and are keyed per course",() => {
  assert.deepEqual(validateExceptionParameters("prerequisite_waiver",{courseId:"c2"}),{courseId:"c2"});
  for (const bad of [{},{courseId:""},{courseId:"c2",extra:1}]) assert.throws(() => validateExceptionParameters("prerequisite_waiver",bad),{statusCode:400});
  assert.notEqual(exceptionKey("prerequisite_waiver",{courseId:"c1"}),exceptionKey("prerequisite_waiver",{courseId:"c2"}));
});

const programme = {status:"onboarded",programmeVersionId:"v1"};
const period = {status:"open",calendarStatus:"published",programmeVersionId:"v1",creditLimit:60,yearOfStudy:1,startsOn:"2026-02-01",windows:{registration:["2026-01-01","2026-01-31"]}};
const offering = (courseId,prerequisites = []) => ({courseId,code:courseId.toUpperCase(),credits:15,requirementType:"elective",status:"active",effectiveFrom:"2020-01-01",delivery:"asynchronous",meetings:[],prerequisites});
const codes = (result) => result.blockers.map((row) => row.code);

test("an approved, current prerequisite waiver clears only the named course's prerequisite blocker",() => {
  const offerings = [offering("c1"),offering("c2",["c1"])];
  const base = {programme,period,offerings,selectedCourses:["c2"],revision:3,today:"2026-01-15",academic:{latestResults:[],recognitions:[],attempts:[],curriculum:[],period:{startsOn:"2026-02-01",programmeVersionId:"v1"},policy:null}};
  assert.ok(codes(registrationEligibility(base)).includes("PREREQUISITE_EVIDENCE"));
  const waiver = {id:1,kind:"prerequisite_waiver",parameters:{courseId:"c2"},status:"approved",registrationRevision:3,evidenceHash:"h",expiresOn:"2026-01-31"};
  assert.ok(!codes(registrationEligibility({...base,exceptions:[waiver],exceptionEvidenceHash:"h"})).includes("PREREQUISITE_EVIDENCE"));
  assert.ok(codes(registrationEligibility({...base,exceptions:[{...waiver,parameters:{courseId:"c9"}}],exceptionEvidenceHash:"h"})).includes("PREREQUISITE_EVIDENCE"));
  assert.ok(codes(registrationEligibility({...base,exceptions:[{...waiver,evidenceHash:"old"}],exceptionEvidenceHash:"h"})).includes("PREREQUISITE_EVIDENCE"));
});

test("a window extension keeps registration open after the window closes until its date, but never for a closed period",() => {
  const base = {programme,period,offerings:[offering("c1")],selectedCourses:["c1"],today:"2026-02-05"};
  assert.ok(codes(registrationEligibility(base)).includes("WINDOW"));
  assert.ok(!codes(registrationEligibility({...base,windowExtension:{until:"2026-02-10"}})).includes("WINDOW"));
  assert.ok(codes(registrationEligibility({...base,windowExtension:{until:"2026-02-04"}})).includes("WINDOW"));
  assert.ok(codes(registrationEligibility({...base,period:{...period,status:"closed"},windowExtension:{until:"2026-02-10"}})).includes("WINDOW"));
  assert.ok(codes(registrationEligibility({...base,today:"2025-12-20",windowExtension:{until:"2026-02-10"}})).includes("WINDOW"));
});
