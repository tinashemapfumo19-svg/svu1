import test from "node:test";
import assert from "node:assert/strict";
import { academicEvidenceHash, assessAcademicDecision, currentAcademicDecision, latestAcademicAttempts, validateAcademicRules } from "../server/modules/academic-evidence.js";
import { registrationEligibility } from "../server/modules/course-registration.js";

const rules = () => ({minGpa:2,minPassedCredits:30,maxFailedCredits:0,maxOutstandingCoreCourses:0,maxAttempts:2,allowPassedRetake:false});
const context = () => {
  const scheme = {id:"gs",bands:[{grade:"F",points:0,passing:false},{grade:"C",points:2,passing:true},{grade:"A",points:4,passing:true}],classifications:[{minGpa:2,label:"Pass"}]};
  const curriculum = ["c1","c2"].map((courseId) => ({courseId,code:courseId,credits:15,yearOfStudy:1,term:"S1",requirementType:"core"}));
  const attempts = curriculum.map((row,index) => ({registrationId:"r1",courseId:row.courseId,courseSnapshot:row,yearOfStudy:1,startsOn:"2027-02-01",endsOn:"2027-06-30",batchId:"b1",gradingSchemeId:"gs",
    result:{courseId:row.courseId,code:row.code,credits:15,grade:index ? "C" : "A",mark:index ? 50 : 75,passing:true}}));
  const state = {period:{id:"p2",yearOfStudy:2,programmeVersionId:"v1",startsOn:"2028-02-01"},policy:{id:"pol",programmeVersionId:"v1",status:"published",effectiveFrom:"2026-01-01",rules:rules(),gpaSnapshot:{scheme,rule:{rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}}}}},curriculum,attempts,decisions:[]};
  state.evidenceHash = academicEvidenceHash(state); state.latestResults = latestAcademicAttempts(attempts,state.period.startsOn);
  return state;
};
const approve = (state,kind = "progression",courseId = null,revision = null) => state.decisions.unshift({id:1,kind,courseId,registrationRevision:revision,status:"approved",expiresOn:"2026-10-31",policyId:"pol",evidenceHash:state.evidenceHash});

test("academic policy thresholds and repeat rules are explicit and bounded", () => {
  assert.doesNotThrow(() => validateAcademicRules(rules()));
  for (const change of [{minGpa:NaN},{minPassedCredits:0.3},{maxAttempts:0},{allowPassedRetake:undefined},{bypass:true}]) assert.throws(() => validateAcademicRules({...rules(),...change}),{statusCode:400});
});
test("progression explains GPA, credits and outstanding core courses", () => {
  assert.equal(assessAcademicDecision(context(),"progression").gpa,3);
  assert.equal(assessAcademicDecision(context(),"progression").ready,true);
  const failed = context(); failed.attempts[1].result = {...failed.attempts[1].result,grade:"F",mark:20,passing:false};
  assert.deepEqual(assessAcademicDecision(failed,"progression").blockers.map((row) => row.code),["PASSED_CREDITS","FAILED_CREDITS","OUTSTANDING_CORE"]);
});
test("missing, future and incompatible result evidence cannot authorize progression", () => {
  const missing = context(); missing.attempts[0].result = null;
  assert.ok(assessAcademicDecision(missing,"progression").blockers.some((row) => row.code === "UNPUBLISHED_RESULT"));
  const future = context(); future.attempts[0].endsOn = "2029-01-01";
  assert.ok(assessAcademicDecision(future,"progression").blockers.some((row) => row.code === "SOURCE_CHRONOLOGY"));
  const mixed = context(); mixed.attempts[0].gradingSchemeId = "different";
  assert.ok(assessAcademicDecision(mixed,"progression").blockers.some((row) => row.code === "GRADING_POLICY"));
});
test("latest unrecorded attempts supersede older passes and future results do not count", () => {
  const state = context(); state.attempts.push({...state.attempts[0],registrationId:"r2",endsOn:"2027-12-31",result:null});
  assert.equal(latestAcademicAttempts(state.attempts,state.period.startsOn).find((row) => row.courseId === "c1").result,null);
  state.attempts.push({...state.attempts[0],registrationId:"future",endsOn:"2029-12-31"});
  assert.notEqual(latestAcademicAttempts(state.attempts,state.period.startsOn).find((row) => row.courseId === "c1").registrationId,"future");
});
test("repeat assessment requires known latest results and respects passed-retake and attempt limits", () => {
  const state = context();
  assert.equal(assessAcademicDecision(state,"repeat","c1").blockers[0].code,"PASSED_RETAKE");
  state.policy.rules.allowPassedRetake = true;
  assert.equal(assessAcademicDecision(state,"repeat","c1").ready,true);
  state.attempts.push({...state.attempts[0],registrationId:"r2"});
  assert.ok(assessAcademicDecision(state,"repeat","c1").blockers.some((row) => row.code === "ATTEMPT_LIMIT"));
});
test("approvals are tied to source evidence, policy, expiry and repeat selection revision", () => {
  const state = context(); approve(state,"repeat","c1",2);
  assert.equal(currentAcademicDecision(state,"repeat","c1",2,"2026-10-02").id,1);
  assert.equal(currentAcademicDecision(state,"repeat","c1",3,"2026-10-02"),null);
  assert.equal(currentAcademicDecision(state,"repeat","c1",2,"2026-11-01"),null);
  state.attempts[0].result.mark++;
  state.evidenceHash = academicEvidenceHash(state);
  assert.equal(currentAcademicDecision(state,"repeat","c1",2,"2026-10-02"),null);
});
test("academic evidence hashes ignore row order but bind target year and source facts", () => {
  const state = context(),hash = state.evidenceHash;
  state.attempts.reverse(); state.curriculum.reverse(); assert.equal(academicEvidenceHash(state),hash);
  state.period.yearOfStudy = 3; assert.notEqual(academicEvidenceHash(state),hash);
});
test("registration requires published prerequisite passes and an independent higher-year approval", () => {
  const academic = context();
  const input = {today:"2026-10-02",programme:{status:"onboarded",programmeVersionId:"v1"},period:{...academic.period,status:"open",calendarStatus:"published",windows:{registration:["2026-10-01","2026-10-31"]},creditLimit:15},
    offerings:[{courseId:"c3",code:"ADV201",credits:15,requirementType:"core",status:"active",effectiveFrom:"2026-01-01",delivery:"asynchronous",meetings:[],prerequisites:["c1"]}],selectedCourses:["c3"],revision:2,
    checks:["academic","financial"].map((checkType) => ({checkType,registrationRevision:2,outcome:"eligible",expiresOn:"2026-10-31"})),academic};
  assert.equal(registrationEligibility(input).blockers[0].code,"PROGRESSION_APPROVAL");
  approve(academic); assert.equal(registrationEligibility(input).ready,true);
  academic.latestResults[0].result = null;
  assert.ok(registrationEligibility(input).blockers.some((row) => row.code === "PREREQUISITE_EVIDENCE"));
});
