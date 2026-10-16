import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSeatPlan, freezeSeatPlan, validateSeatEntries } from '../server/modules/exam-seating-core.js';
import { createExamSeatingModule } from '../server/modules/exam-seating.js';
import { createExamManifestsModule } from '../server/modules/exam-manifests.js';
import { createExamsModule } from '../server/modules/exams.js';

const manifest = {sittingId:'s1',code:'C1',paper:'P1',sittingRevision:3,digest:'a'.repeat(64),rooms:[
  {key:'main',venue:'Main',startsAt:'2099-10-10T07:00:00Z',staffIds:['lead'],candidates:[{studentNumber:'S1'},{studentNumber:'S2'}]},
  {key:'quiet',venue:'Quiet',startsAt:'2099-10-10T07:00:00Z',staffIds:['alt'],candidates:[{studentNumber:'S3'}]}
]};
const seats = [{roomKey:'main',studentNumber:'S1',seat:'A1'},{roomKey:'main',studentNumber:'S2',seat:'A2'},{roomKey:'quiet',studentNumber:'S3',seat:'A1'}];
const input = {revision:0,publishedRevision:7,manifestDigest:manifest.digest,reason:'Synthetic seat plan',entries:seats};
const officer = {accountId:'maker',permissions:['exams.schedule','exams.publish'],roles:[{permissions:['exams.schedule','exams.publish'],scope:{programmeCodes:['P1'],intakeIds:['I1']}}]};
const publisher = {...officer,accountId:'publisher'};

test('seat labels are unique within a published room and each exact candidate appears at most once',() => {
  assert.deepEqual(validateSeatEntries(seats,manifest,{complete:true}),seats);
  const formatted = seats.map((entry) => ({...entry,seat:` ${entry.seat} `}));
  assert.deepEqual(validateSeatEntries(formatted.reverse(),manifest),seats);
  for (const bad of [null,{},[seats[0],seats[0]],[{...seats[0],studentNumber:'unknown'}],[{...seats[0],roomKey:'quiet'}],
    [{...seats[0],seat:'=1+1'}],[{...seats[0],seat:'a'.repeat(31)}],[{...seats[0],seat:'A\n1'}],[{...seats[0],note:'PRIVATE'}],
    [seats[0],{...seats[1],seat:'a1'}],[{...seats[0],seat:'A  1'},{...seats[1],seat:'a 1'}]]) assert.throws(() => validateSeatEntries(bad,manifest),{statusCode:400});
  assert.equal(validateSeatEntries(seats.slice(0,1),manifest).length,1);
  assert.throws(() => validateSeatEntries(seats.slice(0,1),manifest,{complete:true}),{statusCode:409});
  assert.deepEqual(validateSeatEntries([],manifest,{complete:true}),[]);
});

test('published seat snapshots bind the exact publication and manifest and do not alias mutable drafts',() => {
  const mutable = seats.map((entry) => ({...entry,secret:'PRIVATE'})),frozen = freezeSeatPlan(2,7,manifest.digest,mutable);
  mutable[0].seat = 'Z9';assert.equal(frozen.entries[0].seat,'A1');assert.doesNotMatch(JSON.stringify(frozen),/PRIVATE/);
  assert.match(frozen.digest,/^[a-f0-9]{64}$/);
  assert.notEqual(frozen.digest,freezeSeatPlan(3,7,manifest.digest,seats).digest);
  const publication = {status:'published',revision:7,publishedRevision:7};
  assert.equal(currentSeatPlan(frozen,publication,manifest),frozen);
  for (const changed of [{status:'draft'},{revision:8},{publishedRevision:8}]) assert.equal(currentSeatPlan(frozen,{...publication,...changed},manifest),null);
  assert.equal(currentSeatPlan(frozen,publication,{digest:'b'.repeat(64)}),null);
  assert.equal(currentSeatPlan(frozen,publication,null),null);
});

function fixture({plan = null,publication = {},staff = {id:'alt'},roster = manifest} = {}) {
  const calls = [],history = [],row = {periodId:'period',programmeCode:'P1',intakeId:'I1',status:'published',revision:7,publishedRevision:7,
    snapshot:{sittings:[{id:'s1',invigilators:[{staffId:'alt',accountId:'invigilator'}]}],manifests:[roster]},...publication};
  const db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('from exam_sittings es')) return {rows:[row]};
    if (sql.includes('period_id as "periodId" from exam_sittings')) return {rows:[{periodId:'period'}]};
    if (sql.includes('from staff_members')) return {rows:staff ? [staff] : []};
    if (sql.includes('from notification_templates')) return {rowCount:1,rows:[{id:'template',subject:'Seats {{action}}',body:'Check your portal'}]};
    if (sql.includes('from exam_seating_plans')) return {rows:plan ? [sql.startsWith('select published_snapshot') ? {snapshot:plan.publishedSnapshot} : plan] : []};
    if (sql.startsWith('insert into exam_seating_plans')) plan = {revision:(plan?.revision || 0)+1,status:'draft',publishedRevision:values[1],manifestDigest:values[2],entries:JSON.parse(values[3]),preparedBy:values[4],publishedSnapshot:plan?.publishedSnapshot || null};
    if (sql.startsWith('update exam_seating_plans')) plan = {...plan,status:'published',publishedSnapshot:JSON.parse(values[3])};
    if (sql.startsWith('insert into exam_seating_history')) history.push(values);
    return {rows:[],rowCount:0};
  }};
  const pool = {async connect(){return db;}};
  return {calls,history,module:createExamSeatingModule(pool),manifests:createExamManifestsModule(pool)};
}

test('preparation locks the period, preserves publication and records a draft without disclosing seats to invigilators',async () => {
  const f = fixture(),result = await f.module.saveExamSeating('s1',input,officer);
  assert.equal(result.plan.revision,1);assert.equal(result.plan.status,'draft');assert.equal(result.plan.preparedBy,'maker');
  const advisory = f.calls.findIndex((entry) => entry.sql.includes('pg_advisory_xact_lock'));
  assert.ok(advisory < f.calls.findIndex((entry) => entry.sql.includes('for share of et')));
  assert.equal(f.calls.some((entry) => entry.sql.includes('update exam_timetables') || entry.sql.includes('update exam_sittings')),false);
  const own = await f.manifests.getExamManifest('s1',{accountId:'invigilator',permissions:['exams.duties.self']},true);
  assert.equal(own.seating,undefined);assert.equal(own.rooms[0].candidates[0].seat,undefined);
  assert.equal(f.history.length,1);
  assert.doesNotMatch(JSON.stringify(f.calls.filter((entry) => entry.sql.includes('insert into audit_events'))),/S1|S2|S3|A1/);
});

test('seating mutations refuse stale revisions, changed publication, started sittings and wrong permission-specific scope',async () => {
  for (const changed of [{revision:1},{publishedRevision:6},{manifestDigest:'b'.repeat(64)}]) await assert.rejects(fixture().module.saveExamSeating('s1',{...input,...changed},officer),{statusCode:409});
  await assert.rejects(fixture({publication:{status:'draft'}}).module.saveExamSeating('s1',input,officer),{statusCode:409});
  await assert.rejects(fixture({roster:{...manifest,rooms:manifest.rooms.map((room) => ({...room,startsAt:'2000-01-01T00:00:00Z'}))}}).module.saveExamSeating('s1',input,officer),{statusCode:409});
  const wrongScope = {...officer,roles:[{permissions:['exams.schedule'],scope:{programmeCodes:['P2'],intakeIds:['I1']}},{permissions:['exams.publish'],scope:{}}]};
  await assert.rejects(fixture().module.saveExamSeating('s1',input,wrongScope),{statusCode:404});
  await assert.rejects(fixture().module.saveExamSeating('s1',input,{...officer,permissions:['exams.publish']}),{statusCode:404});
  for (const bad of [{...input,revision:-1},{...input,publishedRevision:0},{...input,reason:''},{...input,extra:true}]) await assert.rejects(fixture().module.saveExamSeating('s1',bad,officer),{statusCode:400});
});

test('draft no-op detection is independent of PostgreSQL JSONB object-key ordering',async () => {
  const reordered = seats.map(({roomKey,studentNumber,seat}) => ({seat,studentNumber,roomKey}));
  const f = fixture({plan:{revision:1,status:'draft',publishedRevision:7,manifestDigest:manifest.digest,entries:reordered}});
  await assert.rejects(f.module.saveExamSeating('s1',{...input,revision:1},officer),{statusCode:409});
  assert.equal(f.calls.some((row) => row.sql.startsWith('insert into exam_seating_plans')),false);
});

test('publication requires independent review of a complete current draft and preserves previous seats through draft editing',async () => {
  const f = fixture();await f.module.saveExamSeating('s1',input,officer);
  const {entries,...publishInput} = {...input,revision:1};
  await assert.rejects(f.module.publishExamSeating('s1',publishInput,officer),{statusCode:403});
  const result = await f.module.publishExamSeating('s1',publishInput,publisher);
  assert.equal(result.plan.status,'published');assert.equal(result.plan.publishedSnapshot.entries.length,3);
  const own = await f.manifests.getExamManifest('s1',{accountId:'invigilator',permissions:['exams.duties.self']},true);
  assert.equal(own.rooms.length,1);assert.equal(own.rooms[0].candidates[0].seat,'A1');assert.doesNotMatch(JSON.stringify(own),/S1|S2/);
  await assert.rejects(f.module.publishExamSeating('s1',publishInput,publisher),{statusCode:409});
  await f.module.saveExamSeating('s1',{...input,revision:1,entries:[{...seats[2],seat:'Q2'}]},officer);
  assert.equal((await f.manifests.getExamManifest('s1',{accountId:'invigilator',permissions:['exams.duties.self']},true)).rooms[0].candidates[0].seat,'A1');
  await assert.rejects(f.module.publishExamSeating('s1',{...publishInput,revision:2},publisher),{statusCode:409});
  await f.module.saveExamSeating('s1',{...input,revision:2,entries:[]},officer);
  await f.module.publishExamSeating('s1',{...publishInput,revision:3},publisher);
  assert.equal((await f.manifests.getExamManifest('s1',{accountId:'invigilator',permissions:['exams.duties.self']},true)).rooms[0].candidates[0].seat,undefined);
});

test('stale plans are visible to scoped officers but never populate the current editor or manifest',async () => {
  const f = fixture({plan:{revision:3,status:'published',publishedRevision:6,manifestDigest:manifest.digest,entries:seats,publishedSnapshot:freezeSeatPlan(3,6,manifest.digest,seats)}});
  const result = await f.module.getExamSeating('s1',officer);
  assert.equal(result.plan.stale,true);assert.deepEqual(result.plan.entries,[]);assert.equal(result.plan.publishedSnapshot,null);
  assert.equal((await f.manifests.getExamManifest('s1',officer)).seating,undefined);
});

test('own timetable projection exposes only the student seat and removes it on stale or draft publication',async () => {
  let status = 'published',publishedRevision = 7;
  const snapshot = freezeSeatPlan(2,7,manifest.digest,seats);
  const db = {release(){},async query(sql) {
    if (sql.includes('from student_programmes')) return {rows:[{accountId:'student',studentNumber:'S1'}]};
    return {rows:[{periodId:'period',name:'Term',status,revision:7,publishedRevision,staffSnapshot:{manifests:[manifest]},seatPlans:[{sittingId:'s1',snapshot}],
      courses:['course'],snapshot:{sittings:[{id:'s1',courseId:'course',startsAt:'2099-10-10T07:00:00Z',candidates:['S1','S2','S3']}]}}]};
  }};
  const module = createExamsModule({async connect(){return db;}}),actor = {accountId:'student'};
  const result = await module.listOwnExams('programme',actor);assert.equal(result[0].sittings[0].seat,'A1');assert.doesNotMatch(JSON.stringify(result),/S2|S3|seatPlans|staffSnapshot/);
  status = 'draft';assert.equal((await module.listOwnExams('programme',actor))[0].sittings[0].seat,undefined);
  status = 'published';publishedRevision = 8;assert.equal((await module.listOwnExams('programme',actor))[0].sittings[0].seat,undefined);
});
