import test from "node:test";
import assert from "node:assert/strict";
import { finalMark, importChecksum, marksHash, moderationComplete, moderationStages, submissionMatchesSheet, validateComponents, validateMarkImport } from "../server/modules/assessment.js";

const plan = [{code:"CW",name:"Coursework",weight:40,maxMark:50},{code:"EXAM",name:"Final examination",weight:60,maxMark:100}];

test("assessment plans need unique components whose whole-number weights total 100",() => {
  assert.deepEqual(validateComponents(plan),plan);
  for (const bad of [[],[{...plan[0],weight:40}],[plan[0],{...plan[1],code:"CW"}],[{...plan[0],weight:40.5},plan[1]],[{...plan[0],code:"cw"},plan[1]],[{...plan[0],maxMark:0},plan[1]],[{...plan[0],pass:40},plan[1]]]) {
    assert.throws(() => validateComponents(bad),{statusCode:400});
  }
});

test("final marks weight each component by its maximum and round half up",() => {
  assert.deepEqual(finalMark(plan,{CW:{state:"mark",mark:40},EXAM:{state:"mark",mark:70}}),{state:"final",mark:74});
  assert.deepEqual(finalMark(plan,{CW:{state:"mark",mark:25},EXAM:{state:"mark",mark:45}}),{state:"final",mark:47});
  assert.deepEqual(finalMark([{code:"A",weight:50,maxMark:100},{code:"B",weight:50,maxMark:100}],{A:{state:"mark",mark:44},B:{state:"mark",mark:45}}),{state:"final",mark:45});
});

test("absent scores zero, exempt rescales the rest, deferred and missing withhold the final mark",() => {
  assert.deepEqual(finalMark(plan,{CW:{state:"mark",mark:40},EXAM:{state:"absent"}}),{state:"final",mark:32});
  assert.deepEqual(finalMark(plan,{CW:{state:"exempt"},EXAM:{state:"mark",mark:70}}),{state:"final",mark:70});
  assert.deepEqual(finalMark(plan,{CW:{state:"mark",mark:40},EXAM:{state:"deferred"}}),{state:"deferred",mark:null});
  assert.deepEqual(finalMark(plan,{CW:{state:"mark",mark:40}}),{state:"missing",mark:null});
  assert.deepEqual(finalMark(plan,{CW:{state:"exempt"},EXAM:{state:"exempt"}}),{state:"exempt",mark:null});
});

test("the marks hash binds every entry and its revision regardless of order",() => {
  const rows = [{registrationId:"r1",componentCode:"CW",state:"mark",mark:40,revision:1},{registrationId:"r2",componentCode:"CW",state:"absent",mark:null,revision:2}];
  assert.equal(marksHash(rows),marksHash([...rows].reverse()));
  assert.notEqual(marksHash(rows),marksHash([{...rows[0],revision:2},rows[1]]));
});

const roster = [{registrationId:"r1",studentNumber:"S26000001"},{registrationId:"r2",studentNumber:"S26000002"}];

test("moderation gates require every configured stage signed against the current submission",() => {
  assert.deepEqual(moderationStages('none'),[]);
  assert.throws(() => moderationStages(null),{statusCode:400});
  assert.throws(() => moderationStages('optional'),{statusCode:400});
  const internal = {stage:'internal',outcome:'signed',marksHash:'hash'};
  const external = {stage:'external',outcome:'signed',marksHash:'hash'};
  assert.equal(moderationComplete('none',[],'hash'),true);
  assert.equal(moderationComplete('internal',[internal],'hash'),true);
  assert.equal(moderationComplete('internal_external',[internal],'hash'),false);
  assert.equal(moderationComplete('internal_external',[internal,external],'hash'),true);
  assert.equal(moderationComplete('internal_external',[internal,{...external,marksHash:'old'}],'hash'),false);
  assert.equal(moderationComplete('internal',[{...internal,outcome:'changes_requested'}],'hash'),false);
});

test("submission evidence detects replacement enrolments even when roster counts match",() => {
  const marks = [{registrationId:'r1',componentCode:'CW',state:'mark',mark:40,revision:1}];
  const submission = {marksHash:marksHash(marks),finals:[{registrationId:'r1'}]};
  const sheet = {marks,students:[{registrationId:'r1'}],missing:[]};
  assert.equal(submissionMatchesSheet(submission,sheet),true);
  assert.equal(submissionMatchesSheet(submission,{...sheet,students:[{registrationId:'r2'}]}),false);
  assert.equal(submissionMatchesSheet(submission,{...sheet,missing:[{componentCode:'EXAM'}]}),false);
  assert.equal(submissionMatchesSheet(submission,{...sheet,marks:[{...marks[0],revision:2}]}),false);
});

test("mark uploads report every problem by row and classify valid rows against current marks",() => {
  const current = [{registrationId:"r1",componentCode:"CW",state:"mark",mark:40,reason:null,revision:2},{registrationId:"r2",componentCode:"CW",state:"absent",mark:null,reason:"Ill",revision:1}];
  const report = validateMarkImport(plan,[...roster,{registrationId:"r3",studentNumber:"S26000003"},{registrationId:"r4",studentNumber:"S26000004"}],current,[
    {studentNumber:"S26000001",componentCode:"CW",value:"40"},
    {studentNumber:"S26000001",componentCode:"exam",value:" 70 "},
    {studentNumber:"S26000002",componentCode:"CW",value:"deferred",reason:"Medical certificate"},
    {studentNumber:"S26000099",componentCode:"CW",value:"10"},
    {studentNumber:"S26000002",componentCode:"LAB",value:"10"},
    {studentNumber:"S26000002",componentCode:"EXAM",value:"101"},
    {studentNumber:"S26000003",componentCode:"EXAM",value:"ABSENT"},
    {studentNumber:"S26000004",componentCode:"EXAM",value:"4.5"}
  ]);
  assert.deepEqual(report.accepted.map((row) => [row.row,row.componentCode,row.state,row.mark,row.change,row.revision]),
    [[1,"CW","mark",40,"unchanged",2],[2,"EXAM","mark",70,"new",0],[3,"CW","deferred",null,"changed",1]]);
  assert.deepEqual(report.rejected.map((row) => row.row),[4,5,6,7,8]);
  assert.match(report.rejected[2].problem,/maximum of 100/);
  assert.match(report.rejected[3].problem,/needs a reason/);
  assert.deepEqual(report.summary,{rows:8,new:1,changed:1,unchanged:1,rejected:5});
});

test("a student-component pair repeated in an upload rejects every copy",() => {
  const report = validateMarkImport(plan,roster,[],[{studentNumber:"S26000001",componentCode:"CW",value:"30"},{studentNumber:"S26000002",componentCode:"CW",value:"31"},{studentNumber:"S26000001",componentCode:"CW",value:"35"}]);
  assert.deepEqual(report.accepted.map((row) => row.row),[2]);
  assert.deepEqual(report.rejected.map((row) => [row.row,row.problem]),[[1,"Appears more than once in the file."],[3,"Appears more than once in the file."]]);
});

test("the upload checksum is order-sensitive and treats a missing reason as empty",() => {
  const rows = [{studentNumber:"S1",componentCode:"CW",value:"40"},{studentNumber:"S2",componentCode:"CW",value:"ABSENT",reason:"Ill"}];
  assert.equal(importChecksum(rows),importChecksum([{...rows[0],reason:""},rows[1]]));
  assert.notEqual(importChecksum(rows),importChecksum([...rows].reverse()));
});
