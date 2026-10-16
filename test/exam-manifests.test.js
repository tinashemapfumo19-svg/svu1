import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeExamManifests, manifestView, createExamManifestsModule } from '../server/modules/exam-manifests.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sitting = {id:'s1',courseId:'course',code:'EX1',paper:'Paper 1',revision:4,startsAt:'2026-10-10T07:00:00Z',durationMinutes:180,venueId:'hall',venue:'Hall',venueLocation:'Main campus',
  invigilators:[{staffId:'lead',accountId:'PRIVATE-account'},{staffId:'quiet'}],
  arrangements:[{studentNumber:'S1',extraMinutes:30,venueId:'quiet-room',venue:'Quiet room',invigilatorStaffId:'quiet',instruction:'Allow rest',requestNote:'PRIVATE-note'},
    {studentNumber:'S2',extraMinutes:15,venueId:null,instruction:'Allow extra time'}]};
const candidates = [{studentNumber:'S2',registrationId:'PRIVATE-reg',accountId:'PRIVATE-account'},{studentNumber:'S1'},{studentNumber:'S3'}];
const freeze = () => freezeExamManifests([sitting],{course:candidates})[0];

test('the examination UI module loads and renders an empty workspace without browser globals',() => {
  const window = {};
  runInNewContext(readFileSync(new URL('../src/registry-exams.js',import.meta.url),'utf8'),{window});
  assert.equal(window.registryExamsUI.render({}), '');
  assert.equal(typeof window.registryExamsUI.bind,'function');
});

test('published manifests split room rosters and freeze individual end times, not room maximums',() => {
  const manifest = freeze();
  assert.deepEqual(manifest.rooms.map((room) => [room.key,room.candidates.map((candidate) => candidate.studentNumber)]),[['hall',['S2','S3']],['quiet-room',['S1']]]);
  assert.equal(manifest.rooms[0].durationMinutes,195);
  assert.deepEqual(manifest.rooms[0].candidates.map((row) => row.endsAt),['2026-10-10T10:15:00.000Z','2026-10-10T10:00:00.000Z']);
  assert.equal(manifest.rooms[1].candidates[0].endsAt,'2026-10-10T10:30:00.000Z');
  assert.doesNotMatch(JSON.stringify(manifest),/PRIVATE/);
});

test('deferred manifest candidates are the exact assigned cohort, not all enrolled candidates',() => {
  const manifest = freezeExamManifests([{...sitting,planId:'deferred',candidates:[candidates[0]],arrangements:[]}],{course:candidates})[0];
  assert.deepEqual(manifest.rooms[0].candidates.map((row) => row.studentNumber),['S2']);
});

test('manifest digest is deterministic across candidate ordering and binds revisions and room instructions',() => {
  const manifest = freeze(),reordered = freezeExamManifests([sitting],{course:[...candidates].reverse()})[0];
  assert.equal(manifest.digest,reordered.digest);
  assert.notEqual(manifest.digest,freezeExamManifests([{...sitting,revision:5}],{course:candidates})[0].digest);
  assert.notEqual(manifest.digest,freezeExamManifests([{...sitting,arrangements:sitting.arrangements.map((row) => ({...row,instruction:'Changed instruction'}))}],{course:candidates})[0].digest);
  candidates.push({studentNumber:'later'});
  assert.equal(manifest.rooms.flatMap((room) => room.candidates).length,3);
  candidates.pop();
  assert.match(manifest.digest,/^[a-f0-9]{64}$/);
});

test('assigned invigilators see only their room roster; output omits internal staff and arbitrary fields',() => {
  const frozen = freeze();frozen.rooms[0].secret='PRIVATE';frozen.rooms[0].candidates[0].accountId='PRIVATE';
  const own = manifestView(frozen,'quiet');
  assert.deepEqual(own.rooms.map((room) => room.key),['quiet-room']);
  assert.deepEqual(manifestView(frozen,'unknown').rooms,[]);
  assert.doesNotMatch(JSON.stringify(manifestView(frozen)),/PRIVATE|staffIds/);
});

const officer = {accountId:'office',permissions:['exams.schedule'],roles:[{permissions:['exams.schedule'],scope:{programmeCodes:['P1'],intakeIds:['I1']}}]};
const invigilator = {accountId:'invigilator',permissions:['exams.duties.self'],roles:[]};
function fixture(overrides = {},staff = {id:'quiet'}) {
  const calls = [],manifest = freeze(),row = {periodId:'p1',programmeCode:'P1',intakeId:'I1',status:'published',revision:7,publishedRevision:7,publishedAt:'2026-10-01T07:00:00Z',
    snapshot:{sittings:[{id:'s1',invigilators:[{staffId:'quiet',accountId:'invigilator'}]}],manifests:[manifest]},...overrides};
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('from exam_sittings es')) return {rows:row ? [row] : []};
    if (sql.includes('from staff_members')) return {rows:staff ? [staff] : []};
    return {rows:[]};
  }};
  return {calls,module:createExamManifestsModule({connect:async () => db})};
}

test('office manifest reads enforce permission-specific programme and intake scope before auditing',async () => {
  const valid = fixture();assert.equal((await valid.module.getExamManifest('s1',officer)).rooms.length,2);
  assert.equal(valid.calls.filter((call) => call.sql.includes('insert into audit_events')).length,1);
  assert.doesNotMatch(JSON.stringify(valid.calls.filter((call) => call.sql.includes('insert into audit_events'))),/S1|S2|Allow rest/);
  for (const overrides of [{programmeCode:'P2'},{intakeId:'I2'}]) {
    const denied = fixture(overrides);await assert.rejects(denied.module.getExamManifest('s1',officer),{statusCode:404});
    assert.equal(denied.calls.some((call) => call.sql.includes('insert into audit_events')),false);
  }
  await assert.rejects(fixture().module.getExamManifest('s1',{...officer,permissions:['results.view']}),{statusCode:404});
});

test('own manifest reads require an active staff record and exact published assignment',async () => {
  assert.equal((await fixture().module.getExamManifest('s1',invigilator,true)).rooms[0].key,'quiet-room');
  for (const staff of [null,{id:'other'}]) await assert.rejects(fixture({},staff).module.getExamManifest('s1',invigilator,true),{statusCode:404});
  const wrongSitting = fixture({snapshot:{sittings:[{id:'another',invigilators:[{staffId:'quiet'}]}],manifests:[freeze()]}});
  await assert.rejects(wrongSitting.module.getExamManifest('s1',invigilator,true),{statusCode:404});
  await assert.rejects(fixture().module.getExamManifest('s1',{...invigilator,accountId:'replacement-account'},true),{statusCode:404});
});

test('draft, mismatched revision, legacy publication and cancelled-sitting manifests fail closed',async () => {
  for (const overrides of [{status:'draft'},{revision:8},{snapshot:{sittings:[]}},{snapshot:{sittings:[{id:'s1',invigilators:[]}]}}]) {
    const current = fixture(overrides);await assert.rejects(current.module.getExamManifest('s1',officer),{statusCode:409});
    assert.equal(current.calls.some((call) => call.sql.includes('insert into audit_events')),false);
  }
});
