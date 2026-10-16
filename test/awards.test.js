import test from "node:test";
import assert from "node:assert/strict";
import { auditHash, graduationAudit, isCalendarDate, validateCompletionRules } from "../server/modules/awards.js";

const scheme = {id:"gs",version:1,bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}],classifications:[{minGpa:3,label:"Distinction"},{minGpa:2,label:"Pass"}]};
const policy = {rule:{id:"gr",version:1,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}}},scheme};
const rules = {minCredits:60,minElectiveCredits:15,minCumulativeGpa:2,awardTitle:"BSc Computing"};
const curriculum = [
  {courseId:"c1",code:"CS101",title:"Programming",credits:15,requirementType:"core",yearOfStudy:1},
  {courseId:"c2",code:"CS102",title:"Data",credits:15,requirementType:"core",yearOfStudy:1},
  {courseId:"c3",code:"MA101",title:"Maths",credits:15,requirementType:"core",yearOfStudy:1},
  {courseId:"e1",code:"EL201",title:"Elective one",credits:15,requirementType:"elective",yearOfStudy:2},
  {courseId:"e2",code:"EL202",title:"Elective two",credits:15,requirementType:"elective",yearOfStudy:2}
];
const attempt = (courseId,code,mark,endsOn,periodId = endsOn) => ({courseId,code,credits:15,mark,passing:mark >= 40,endsOn,periodId});

test("completion rules are bounded and the elective minimum cannot exceed the total",() => {
  assert.deepEqual(validateCompletionRules({...rules,awardTitle:"  BSc Computing "}),rules);
  for (const bad of [{minCredits:-1},{minCredits:10.25},{minElectiveCredits:61},{minCumulativeGpa:11},{awardTitle:"BS"},{extra:true}]) assert.throws(() => validateCompletionRules({...rules,...bad}),{statusCode:400});
});

test("a passing latest attempt or never-attempted recognized credit satisfies a course; a failed retake does not",() => {
  const attempts = [attempt("c1","CS101",75,"2025-06-30"),attempt("c2","CS102",65,"2025-06-30"),attempt("c2","CS102",30,"2025-11-30"),attempt("e1","EL201",80,"2025-11-30")];
  const recognitions = [{courseId:"c3",credits:15},{courseId:"c2",credits:15}];
  const audit = graduationAudit({status:"onboarded",curriculum,attempts,recognitions,rules,policy});
  assert.deepEqual(audit.courses.map((row) => [row.code,row.outcome,row.attempts]),[["CS101","passed",1],["CS102","not passed",2],["MA101","recognised",0],["EL201","passed",1],["EL202","not attempted",0]]);
  assert.deepEqual(audit.checks.map((row) => [row.code,row.met]),[["status",true],["core",false],["credits",false],["electives",true],["gpa",true]]);
  assert.equal(audit.checks[1].detail,"Outstanding core courses: CS102.");
  assert.deepEqual([audit.creditsEarned,audit.electiveCredits,audit.eligible],[45,15,false]);
  // Latest-attempt GPA: CS101 A(4), CS102 F(0) replacing C, EL201 A(4) = 8/3.
  assert.equal(audit.cumulativeGpa,2.67);
});

test("meeting every check makes the student eligible, with the classification from the grading scheme",() => {
  const attempts = ["c1","c2","c3","e1"].map((id,index) => attempt(id,curriculum.find((row) => row.courseId === id).code,[72,74,70,90][index],"2025-06-30"));
  const audit = graduationAudit({status:"onboarded",curriculum,attempts,recognitions:[],rules,policy});
  assert.deepEqual([audit.eligible,audit.creditsEarned,audit.cumulativeGpa,audit.classification,audit.awardTitle],[true,60,4,"Distinction","BSc Computing"]);
  const suspended = graduationAudit({status:"suspended",curriculum,attempts,recognitions:[],rules,policy});
  assert.deepEqual([suspended.eligible,suspended.checks[0].detail],[false,"Programme status is suspended."]);
  const hash = auditHash("rule",0,audit);
  assert.equal(hash,auditHash("rule",0,graduationAudit({status:"onboarded",curriculum,attempts:[...attempts].reverse(),recognitions:[],rules,policy})));
  assert.notEqual(hash,auditHash("rule",1,audit));
});

test("conferral dates must be real calendar dates",() => {
  for (const good of ["2026-02-28","2028-02-29","2026-12-31"]) assert.equal(isCalendarDate(good),true);
  for (const bad of ["2026-02-30","2026-02-29","2026-13-01","2026-1-01","",null]) assert.equal(isCalendarDate(bad),false);
});
