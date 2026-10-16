import test from "node:test";
import assert from "node:assert/strict";
import { applicableCreditRecognitions, creditEvidenceHash, hasPrerequisiteCredit, usedCreditRecognitions, validateCreditSource } from "../server/modules/credit-evidence.js";
import { academicEvidenceHash, assessAcademicDecision, validateAcademicRules } from "../server/modules/academic-evidence.js";
import { registrationEligibility } from "../server/modules/course-registration.js";

const context = () => ({policy:{id:"p",status:"published",programmeVersionId:"v",effectiveFrom:"2024-01-01",rules:{minGpa:2,minPassedCredits:30,maxFailedCredits:0,maxOutstandingCoreCourses:0,maxAttempts:2,allowPassedRetake:false,recognisedCredits:true},
  gpaSnapshot:{scheme:{id:"gs",bands:[{grade:"A",points:4,passing:true,minMark:70,maxMark:100}],classifications:[]},rule:{rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}}}}},
  period:{id:"period",programmeVersionId:"v",startsOn:"2027-01-01",yearOfStudy:2},curriculum:[{courseId:"a",code:"A",yearOfStudy:1,requirementType:"core",credits:15},{courseId:"b",code:"B",yearOfStudy:1,requirementType:"core",credits:15}],
  attempts:[{registrationId:"reg",courseId:"a",startsOn:"2025-01-01",endsOn:"2025-06-01",yearOfStudy:1,courseSnapshot:{code:"A"},gradingSchemeId:"gs",result:{code:"A",grade:"A",credits:15,passing:true}}],
  recognitions:[{id:"1",courseId:"b",programmeVersionId:"v",policyId:"p",credits:15,completedOn:"2025-01-01",status:"approved"}],latestResults:[],decisions:[]});

test("credit recognition source validation forbids marks, unknown fields and future completions",() => {
  assert.deepEqual(validateCreditSource("internal_transfer",{registrationId:"r",courseId:"c"}),{registrationId:"r",courseId:"c"});
  const external = {institution:"Sample",course:"Course",reference:"SAMPLE",credits:15,completedOn:"2025-01-01"};
  assert.deepEqual(validateCreditSource("exemption",external),external);
  assert.doesNotThrow(() => validateAcademicRules(context().policy.rules));
  assert.throws(() => validateAcademicRules({...context().policy.rules,recognisedCredits:"true"}),{statusCode:400});
  for (const [kind,source] of [["unknown",external],["external_transfer",{...external,mark:75}],["exemption",{...external,credits:15.25}],["exemption",{...external,completedOn:"2099-01-01"}],["internal_transfer",{registrationId:"r"}]]) assert.throws(() => validateCreditSource(kind,source),{statusCode:400});
});
test("recognition evidence hashes survive JSONB key ordering while binding source/policy facts",() => {
  const snapshot = {policy:{id:"p",rules:{recognisedCredits:true}},source:{institution:"Sample",credits:15,reference:"SAMPLE"}};
  const reordered = {source:{reference:"SAMPLE",credits:15,institution:"Sample"},policy:{rules:{recognisedCredits:true},id:"p"}};
  assert.equal(creditEvidenceHash(snapshot),creditEvidenceHash(reordered));
  reordered.source.credits = 16; assert.notEqual(creditEvidenceHash(snapshot),creditEvidenceHash(reordered));
});
test("recognition requires explicit policy, approved prior source, pinned credits and no attempt",() => {
  const state = context(); assert.equal(applicableCreditRecognitions(state).length,1); assert.equal(hasPrerequisiteCredit(state,"b"),true);
  for (const change of [(s) => s.policy.rules.recognisedCredits = false,(s) => s.policy.rules.recognisedCredits = "true",(s) => s.recognitions[0].status = "requested",(s) => s.recognitions[0].status = "revoked",(s) => s.recognitions[0].completedOn = "2027-01-01",(s) => s.recognitions[0].credits = 14,(s) => s.recognitions[0].programmeVersionId = "other",(s) => s.attempts.push({...s.attempts[0],courseId:"b",result:null})]) {
    const copy = structuredClone(state); change(copy); assert.equal(applicableCreditRecognitions(copy).length,0);
  }
});
test("recognized credit satisfies core progression credit but never invents GPA or hides missing results",() => {
  const state = context(); const assessment = assessAcademicDecision(state,"progression");
  assert.equal(assessment.ready,true); assert.equal(assessment.gpa,4); assert.equal(assessment.passedCredits,30); assert.equal(assessment.recognisedCredits,15);
  state.attempts[0].result = null; assert.ok(assessAcademicDecision(state,"progression").blockers.some((row) => row.code === "UNPUBLISHED_RESULT"));
  state.attempts = []; assert.equal(assessAcademicDecision(state,"progression").gpa,null);
  const hash = academicEvidenceHash(state); state.recognitions[0].status = "revoked"; assert.notEqual(academicEvidenceHash(state),hash);
  state.recognitions = []; assert.notEqual(academicEvidenceHash(state),hash);
});
test("recognized core waiver and prerequisites retain finance and prevent duplicate enrolment",() => {
  const academic = context(); academic.period.yearOfStudy = 1;
  const input = {today:"2026-10-02",programme:{status:"onboarded",programmeVersionId:"v"},period:{...academic.period,status:"open",calendarStatus:"published",creditLimit:30,windows:{registration:["2026-10-01","2026-10-30"]}},
    offerings:[{courseId:"b",code:"B",requirementType:"core",credits:15,status:"active",effectiveFrom:"2024-01-01",delivery:"asynchronous",meetings:[],prerequisites:[]},{courseId:"c",code:"C",requirementType:"elective",credits:15,status:"active",effectiveFrom:"2024-01-01",delivery:"asynchronous",meetings:[],prerequisites:["b"]}],selectedCourses:["c"],revision:1,academic,checks:[]};
  assert.deepEqual(registrationEligibility(input).blockers.map((row) => row.code),["ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
  assert.equal(usedCreditRecognitions(academic,input.offerings,input.selectedCourses).length,1);
  const unused = structuredClone(input.offerings); unused[0].requirementType = "elective"; unused[1].prerequisites = [];
  assert.equal(usedCreditRecognitions(academic,unused,input.selectedCourses).length,0);
  input.selectedCourses.push("b"); assert.ok(registrationEligibility(input).blockers.some((row) => row.code === "RECOGNISED_COURSE"));
});
