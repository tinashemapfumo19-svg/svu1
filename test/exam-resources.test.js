import test from 'node:test';
import assert from 'node:assert/strict';
import { examResourceIssues, examsOverlap, publishedExamCommitments, resolveSittingVenue, validateInvigilators, validateVenue, venueLabel } from '../server/modules/exam-resources.js';
import { createSeedData } from '../scripts/seed-data.js';

const venue = {id:'v1',code:'RM1',name:'Hall',campus:'Main',location:'East wing',capacity:100,status:'active',revision:2};
const sitting = {id:'s1',status:'scheduled',startsAt:'2026-10-10T09:00:00Z',durationMinutes:60,localDate:'2026-10-10',venueId:'v1',venueRevision:2,venue:'RM1 - Hall',invigilators:[]};
const now = Date.parse('2026-10-01T09:00:00Z');
test('published resource commitments survive draft changes and produce one issue per kind',async () => {
  const db = {query:async (sql,parameters) => {
    assert.match(sql,/period_id <> \$1/);assert.deepEqual(parameters,['current']);
    return {rows:[{snapshot:{sittings:[{...sitting,id:'published',invigilators:[{staffId:'staff1'}]}]}}]};
  }};
  const commitments = await publishedExamCommitments(db,'current');
  assert.equal(commitments[0].status,'scheduled');
  const issues = examResourceIssues([{...sitting,invigilators:[{staffId:'staff1',status:'active',engagedOn:'2020-01-01'}]}],[...commitments,...commitments],[venue],now);
  assert.deepEqual(issues.map((row) => row.kind),['room','invigilator']);
});
test('fresh development seeds retain migrated exam-resource authority',() => {
  const seed = createSeedData();
  for (const role of ['system_administrator','examinations_officer']) assert.ok(seed.rolePermissions[role].includes('exams.venues.manage'));
  for (const role of ['system_administrator','examinations_officer','academic_registrar','lecturer','exam_invigilator']) assert.ok(seed.rolePermissions[role].includes('exams.duties.self'));
  assert.ok(seed.roles.some((role) => role.code === 'exam_invigilator'));
  assert.ok(seed.permissions.includes('exams.venues.manage'));
  assert.ok(seed.permissions.includes('exams.duties.self'));
});
test('venue records need bounded fields, fixed capacity and revisioned lifecycle changes',() => {
  const input = {code:'RM1',name:' Hall ',campus:'Main',location:'East wing',capacity:100,reason:'Room register'};
  assert.equal(validateVenue(input).name,'Hall');
  for (const bad of [{code:'rm1'},{capacity:0},{capacity:1.5},{capacity:5001},{name:''},{location:''},{unknown:true}]) assert.throws(() => validateVenue({...input,...bad}),{statusCode:400});
  const {code,...update} = input;
  assert.doesNotThrow(() => validateVenue({...update,status:'inactive',revision:1},true));
  assert.throws(() => validateVenue({...update,status:'deleted',revision:1},true));
});
test('invigilator rosters need distinct staff, at most one lead and a sitting revision',() => {
  const input = {revision:1,reason:'Exam duty',entries:[{staffId:'m1',role:'lead'},{staffId:'m2',role:'invigilator'}]};
  assert.doesNotThrow(() => validateInvigilators(input));
  assert.doesNotThrow(() => validateInvigilators({...input,entries:[]}));
  for (const entries of [[input.entries[0],input.entries[0]],[{staffId:'m1',role:'lead'},{staffId:'m2',role:'lead'}],[{staffId:'m1',role:'teacher'}]]) assert.throws(() => validateInvigilators({...input,entries}),{statusCode:400});
});
test('managed venues cannot have their capacity overridden or silently adopt a changed version',async () => {
  const db = {query:async () => ({rows:[venue]})};
  assert.equal((await resolveSittingVenue(db,{venueId:'v1'})).venue,venueLabel(venue));
  await assert.rejects(resolveSittingVenue(db,{venueId:'v1',capacity:101}),{statusCode:400});
  await assert.rejects(resolveSittingVenue(db,{venueId:'v1',venue:'Another room'}),{statusCode:400});
  await assert.rejects(resolveSittingVenue(db,{durationMinutes:120},{venueId:'v1',venueRevision:1}),{statusCode:409});
  await assert.rejects(resolveSittingVenue({query:async () => ({rows:[{...venue,status:'inactive'}]})},{venueId:'v1'}),{statusCode:409});
  assert.equal((await resolveSittingVenue({query:async () => ({rows:[]})},{venue:'Manual hall'})).venueId,null);
  await assert.rejects(resolveSittingVenue(db,{venue:venueLabel(venue)}),{statusCode:409});
});
test('managed rooms are exclusive across timetables regardless of spare capacity',() => {
  const other = {...sitting,id:'s2',periodId:'private-period',venueRevision:1,venue:'Old room label'};
  assert.deepEqual(examResourceIssues([sitting],[other],[venue],now),[{sittingId:'s1',kind:'room',problem:'The managed room overlaps another active sitting.'}]);
  assert.equal(examResourceIssues([sitting],[{...other,status:'cancelled'}],[venue],now).length,0);
  assert.equal(examsOverlap(sitting,{...other,startsAt:'2026-10-10T10:00:00Z'}),false);
  assert.equal(examResourceIssues([sitting],[{...other,venueId:null,venue:sitting.venue}],[venue],now)[0].kind,'room');
});
test('publication detects changed rooms, inactive staff and cross-period invigilator conflicts',() => {
  const allocated = {...sitting,invigilators:[{staffId:'m1',status:'active',engagedOn:'2020-01-01'}]};
  const other = {...sitting,id:'s2',venueId:'v2',invigilators:[{staffId:'m1'}]};
  assert.equal(examResourceIssues([allocated],[other],[venue],now)[0].kind,'invigilator');
  assert.equal(examResourceIssues([sitting],[],[{...venue,revision:3}],now)[0].kind,'venue');
  assert.equal(examResourceIssues([{...allocated,invigilators:[{staffId:'m1',status:'leave'}]}],[],[venue],now)[0].kind,'staff');
  assert.equal(examResourceIssues([sitting],[],[{...venue,status:'inactive'}],Date.parse('2026-10-11T00:00:00Z')).length,0);
});
