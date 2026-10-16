import test from "node:test";
import assert from "node:assert/strict";
import { createExamsModule, examCandidateChanges, timetableIssues, validateSitting } from "../server/modules/exams.js";

test("sittings need an explicit offset, a bounded duration in 15-minute steps, and a venue",() => {
  assert.deepEqual(validateSitting({paper:" Paper 1 ",startsAt:"2025-06-02T09:00+02:00",durationMinutes:180,venue:" Great Hall "}),
    {paper:"Paper 1",startsAt:"2025-06-02T07:00:00.000Z",localDate:"2025-06-02",durationMinutes:180,venue:"Great Hall"});
  // The local date is the date as entered, even when the UTC instant falls on the previous day.
  assert.equal(validateSitting({paper:"P",startsAt:"2025-06-02T01:00+02:00",durationMinutes:60,venue:"V"}).localDate,"2025-06-02");
  for (const bad of [{startsAt:"2025-06-02T09:00"},{startsAt:"2025-06-02"},{startsAt:"2026-02-30T09:00+02:00"},{startsAt:"2026-06-02T24:00+02:00"},{durationMinutes:10},{durationMinutes:100},{durationMinutes:495},{venue:""},{paper:""},{capacity:0},{capacity:2.5}]) {
    assert.throws(() => validateSitting({paper:"P",startsAt:"2025-06-02T09:00Z",durationMinutes:60,venue:"V",...bad}),{statusCode:400});
  }
  assert.deepEqual(validateSitting({venue:"Hall B",capacity:null},{partial:true}),{venue:"Hall B",capacity:null});
  assert.throws(() => validateSitting({},{partial:true}),{statusCode:400});
});

const sitting = (id,courseId,startsAt,durationMinutes,venue = "Hall",capacity = null,status = "scheduled") => ({id,courseId,startsAt,durationMinutes,venue,capacity,status});
const people = (...numbers) => numbers.map((studentNumber) => ({studentNumber}));

test('candidate changes compare frozen identities rather than counts and disclose counts only',() => {
  const rows = [sitting('a','A','2099-06-02T07:00:00.000Z',60)];
  const snapshot = {sittings:[{id:'a',candidates:['S1','S2']}]};
  assert.deepEqual(examCandidateChanges(rows,{A:people('S2','S3','S3')},snapshot),[{sittingId:'a',added:1,removed:1,published:2,current:2,started:false}]);
  assert.deepEqual(examCandidateChanges(rows,{A:people('S2','S1')},snapshot),[]);
  assert.deepEqual(examCandidateChanges(rows,{A:people('S3')},{sittings:[{id:'a'}]}),[]);
  assert.deepEqual(examCandidateChanges([{...rows[0],planId:'deferred'}],{A:people('S3')},snapshot),[]);
  assert.deepEqual(examCandidateChanges([{...rows[0],status:'cancelled'}],{},snapshot),[]);
  assert.equal(examCandidateChanges([{...rows[0],startsAt:'2000-01-01T00:00:00Z'}],{},snapshot)[0].started,true);
  assert.deepEqual(snapshot.sittings[0].candidates,['S1','S2']);
});

test('candidate refresh validates input, permission-specific scope and locked publication revision before changes',async () => {
  const actor = {accountId:'maker',permissions:['exams.schedule','results.view'],roles:[
    {code:'scheduler',permissions:['exams.schedule'],scope:{programmeCodes:['P1'],intakeIds:['I1']}},
    {code:'reader',permissions:['results.view'],scope:{}}
  ]};
  function fixture(period = {id:'period',programmeCode:'P1',intakeId:'I1'},timetable = {status:'published',revision:4}) {
    const calls = [],db = {release(){},async query(sql,values) {
      calls.push({sql,values});
      if (sql.includes('join academic_periods ap')) return {rows:[period]};
      if (sql.includes('from exam_timetables')) return {rows:timetable ? [timetable] : []};
      return {rows:[]};
    }};
    return {calls,module:createExamsModule({async connect(){return db;}})};
  }
  for (const input of [null,{revision:'4',reason:'Refresh'},{revision:4,reason:''},{revision:4,reason:'Refresh',candidates:['S1']}]) {
    const f = fixture();await assert.rejects(f.module.refreshExamCandidates('period',input,actor),{statusCode:400});assert.equal(f.calls.length,0);
  }
  for (const target of [{id:'period',programmeCode:'P2',intakeId:'I1'},{id:'period',programmeCode:'P1',intakeId:'I2'}]) {
    const f = fixture(target);await assert.rejects(f.module.refreshExamCandidates('period',{revision:4,reason:'Refresh'},actor),{statusCode:404});
    assert.equal(f.calls.some((row) => row.sql.includes('pg_advisory')),false);
  }
  for (const timetable of [null,{status:'draft',revision:4},{status:'published',revision:5}]) {
    const f = fixture(undefined,timetable);await assert.rejects(f.module.refreshExamCandidates('period',{revision:4,reason:'Refresh'},actor),{statusCode:409});
    const periodLock = f.calls.findIndex((row) => row.sql.includes('registration_periods where id = $1 for share'));
    assert.ok(periodLock > 0);assert.ok(f.calls.findIndex((row) => row.sql.includes('exam_timetables')) > periodLock);
    assert.equal(f.calls.some((row) => /insert|update exam_timetables/i.test(row.sql)),false);
    assert.equal(f.calls.at(-1).sql,'rollback');
  }
});

test("clashes are overlapping sittings that share a candidate; touching sittings do not clash",() => {
  const candidates = {A:people("S1","S2"),B:people("S2","S3"),C:people("S1")};
  const sittings = [sitting("a","A","2025-06-02T07:00:00.000Z",120),sitting("b","B","2025-06-02T08:00:00.000Z",60),sitting("c","C","2025-06-02T09:00:00.000Z",60),
    sitting("x","B","2025-06-02T07:30:00.000Z",30,"Hall",null,"cancelled")];
  const {clashes} = timetableIssues(sittings,candidates);
  assert.deepEqual(clashes,[{sittingIds:["a","b"],students:["S2"]}]);
});

test("venue problems cover a single over-capacity sitting and overlapping sittings sharing a venue",() => {
  const candidates = {A:people("S1","S2","S3"),B:people("S4","S5")};
  const single = timetableIssues([sitting("a","A","2025-06-02T07:00:00.000Z",60,"Lab",2)],candidates);
  assert.deepEqual(single.capacity,[{sittingIds:["a"],venue:"Lab",candidates:3,capacity:2}]);
  const shared = timetableIssues([sitting("a","A","2025-06-02T07:00:00.000Z",60,"Great Hall",4),sitting("b","B","2025-06-02T07:30:00.000Z",60,"great hall")],candidates);
  assert.deepEqual([shared.clashes,shared.capacity],[[],[{sittingIds:["a","b"],venue:"Great Hall",candidates:5,capacity:4}]]);
  assert.deepEqual(timetableIssues([sitting("a","A","2025-06-02T07:00:00.000Z",60,"Hall 1",4),sitting("b","B","2025-06-02T07:30:00.000Z",60,"Hall 2",4)],candidates).capacity,[]);
});
