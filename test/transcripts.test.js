import test from "node:test";
import assert from "node:assert/strict";
import { buildCertificate, buildTranscript, normaliseVerificationCode, transcriptHash, verificationCode } from "../server/modules/transcripts.js";

const scheme = {id:"gs1",version:1,bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}],classifications:[{minGpa:3,label:"Distinction"},{minGpa:0,label:"Pass"}]};
const rule = (retakePolicy) => ({id:`gr_${retakePolicy}`,version:2,rules:{creditWeighted:true,retakePolicy,includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}}});
const result = (code,mark,credits = 15,revision = 0) => ({code,title:`${code} title`,credits,mark,revision,...(mark >= 70 ? {grade:"A",points:4,passing:true} : mark >= 40 ? {grade:"C",points:2,passing:true} : {grade:"F",points:0,passing:false})});
const student = {studentNumber:"S26000001",legalName:"Tariro Moyo"};
const programme = {code:"BSC-CS",name:"Computer Science",versionLabel:"2025",intakeLabel:"2025 intake",status:"active"};
const terms = [
  {periodId:"p2",name:"2025 S2",yearOfStudy:1,term:"S2",startsOn:"2025-07-01",endsOn:"2025-11-30",policy:{rule:rule("latest"),scheme},results:[result("CS102",30),result("CS101",55,15,1)]},
  {periodId:"p1",name:"2025 S1",yearOfStudy:1,term:"S1",startsOn:"2025-02-01",endsOn:"2025-06-30",policy:{rule:rule("latest"),scheme},results:[result("CS101",35),result("MA101",80,30)]}
];

test("transcripts order terms, grade each term under its own policy, and apply the retake rule cumulatively",() => {
  const content = buildTranscript({student,programme,terms,recognitions:[]});
  assert.deepEqual(content.terms.map((row) => [row.name,row.gpa,row.creditsAttempted,row.creditsPassed]),[["2025 S1",2.67,45,30],["2025 S2",1,30,15]]);
  assert.deepEqual(content.terms[1].results.map((row) => [row.code,row.amended]),[["CS101",true],["CS102",false]]);
  // Latest attempt of CS101 (55, C) replaces the first (35, F): (2*15 + 4*30 + 0*15) / 60 = 2.5.
  assert.equal(content.summary.cumulativeGpa,2.5);
  assert.equal(content.summary.classification,"Pass");
  assert.equal(content.summary.creditsPassed,45);
  assert.deepEqual(content.summary.policy,{ruleSetId:"gr_latest",ruleSetVersion:2,gradingSchemeId:"gs1",gradingSchemeVersion:1});
});

test("recognized credit is earned outside the GPA and is not listed once the course is passed here",() => {
  const recognitions = [{code:"EN101",title:"English",credits:15,kind:"external_transfer",completedOn:"2024-12-01"},{code:"MA101",title:"Maths",credits:30,kind:"exemption",completedOn:"2024-12-01"}];
  const content = buildTranscript({student,programme,terms,recognitions});
  assert.deepEqual(content.recognitions.map((row) => row.code),["EN101"]);
  assert.equal(content.summary.creditsRecognised,15);
  assert.equal(content.summary.cumulativeGpa,2.5);
  const onlyCredit = buildTranscript({student,programme,terms:[],recognitions});
  assert.deepEqual([onlyCredit.summary.cumulativeGpa,onlyCredit.summary.creditsRecognised,onlyCredit.summary.policy],[null,45,null]);
});

test("the same record always hashes the same, and any change to it changes the hash",() => {
  const a = buildTranscript({student,programme,terms,recognitions:[]});
  const b = buildTranscript({student,programme,terms:[...terms].reverse(),recognitions:[]});
  assert.equal(transcriptHash(a),transcriptHash(b));
  const amended = structuredClone(terms); amended[0].results[0] = result("CS102",41,15,1);
  assert.notEqual(transcriptHash(a),transcriptHash(buildTranscript({student,programme,terms:amended,recognitions:[]})));
});

test("verification codes avoid ambiguous characters and normalise from what a person types",() => {
  const code = verificationCode();
  assert.match(code,/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(verificationCode(Buffer.alloc(16,0)),"AAAA-AAAA-AAAA-AAAA");
  assert.equal(verificationCode(Buffer.alloc(16,63)),"9999-9999-9999-9999");
  assert.equal(normaliseVerificationCode(` ${code.toLowerCase().replaceAll("-"," ")} `),code);
  for (const bad of ["","ABCD-EFGH","ABCD-EFGH-JKLM-NPQ0","ABCD-EFGH-JKLM-NPQRS",null]) assert.equal(normaliseVerificationCode(bad),null);
});

test("certificates state only the holder, programme, and award, and hash stably",() => {
  const award = {awardTitle:"BSc Computing",classification:"Distinction",conferredOn:"2026-07-01"};
  const certificate = buildCertificate({student,programme,award});
  assert.deepEqual(certificate,{schemaVersion:1,kind:"certificate",student,programme:{code:"BSC-CS",name:"Computer Science"},award:{title:"BSc Computing",classification:"Distinction",conferredOn:"2026-07-01"}});
  assert.equal(transcriptHash(certificate),transcriptHash(buildCertificate({student,programme,award:{...award}})));
  assert.notEqual(transcriptHash(certificate),transcriptHash(buildCertificate({student,programme,award:{...award,classification:"Pass"}})));
  // An award adds a section to the transcript only when present, so earlier transcript content is unchanged.
  assert.equal(buildTranscript({student,programme,terms,recognitions:[]}).award,undefined);
  assert.deepEqual(buildTranscript({student,programme,terms,recognitions:[],award}).award,{title:"BSc Computing",classification:"Distinction",conferredOn:"2026-07-01"});
});
