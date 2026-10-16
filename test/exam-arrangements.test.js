import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangementHistoryFilters, arrangementHistoryPage, arrangementPrivateView, arrangementSittingHash, createExamArrangementsModule, examResourceSegments, operationalArrangement, personalExamDuty, personalExamSitting, validateArrangementRequest } from '../server/modules/exam-arrangements.js';
import { encryptSecret } from '../server/security.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { timetableIssues } from '../server/modules/exams.js';
import { publishedExamCommitments } from '../server/modules/exam-resources.js';
import { assertDeferredSittingReady } from '../server/modules/deferred-assessment.js';
import { paperRecipientDuration } from '../server/modules/exam-papers.js';
import { createSeedData } from '../scripts/seed-data.js';

const sitting = {id:'s1',courseId:'c1',status:'scheduled',revision:1,paper:'Paper 1',startsAt:'2026-10-10T07:00:00Z',durationMinutes:180,venueId:'main',venueRevision:1,venue:'Main hall',capacity:1,
  invigilators:[{staffId:'lead',role:'lead'},{staffId:'alt',role:'invigilator'}]};
const candidates = [{studentNumber:'S1'},{studentNumber:'S2'}];
const cases = [{studentNumber:'S1',extraMinutes:30,instruction:'Use assigned quiet room',venueId:'quiet',venueRevision:1,venue:'Quiet room',capacity:1,invigilatorStaffId:'alt'},
  {studentNumber:'S2',extraMinutes:15,instruction:'Allow supervised rest',venueId:null}];
const arranged = {...sitting,arrangements:cases};

test('case history searches have bounded integer pagination and enumerated status',() => {
  assert.deepEqual(arrangementHistoryFilters(),{limit:25,offset:0,status:'all',q:''});
  assert.deepEqual(arrangementHistoryFilters({limit:'1',offset:'2',status:'returned',q:' C1 '}),{limit:1,offset:2,status:'returned',q:'C1'});
  for (const bad of [{limit:0},{limit:101},{offset:-1},{offset:1.5},{offset:1000001},{limit:'1;select'},{status:'deleted'},{q:'x'.repeat(101)}]) assert.throws(() => arrangementHistoryFilters(bad),{statusCode:400});
});

test('archive metadata is an explicit whitelist, without private notes, identities or scope data',() => {
  const row = {id:'case1',sittingId:'s1',code:'C1',paper:'P',startsAt:sitting.startsAt,status:'revoked',revision:3,sittingStatus:'cancelled',intakeLabel:'Pilot',studentNumber:'S1',requestNote:'PRIVATE',evidenceRef:'PRIVATE',accountId:'owner',requestedBy:'officer',programmeCode:'hidden'};
  const filters = arrangementHistoryFilters({limit:1,offset:1});
  const page = arrangementHistoryPage([row,{...row,id:'case2'}],filters,true);
  assert.equal(page.total,2);assert.equal(page.items[0].id,'case2');
  for (const key of ['studentNumber','requestNote','evidenceRef','accountId','requestedBy','programmeCode']) assert.equal(key in page.items[0],false);
  assert.equal(arrangementHistoryPage([row],arrangementHistoryFilters()).items[0].studentNumber,'S1');
});

test('staff archive counts are scope-filtered and own programme ownership is required before querying cases',async () => {
  const actor = {accountId:'owner',permissions:['exams.arrangements.manage'],roles:[{permissions:['exams.arrangements.manage'],scope:{programmeCodes:['P1'],intakeIds:['I1']}}]};
  const queries = [],rows = [{id:'visible',programmeCode:'P1',intakeId:'I1'},{id:'hidden',programmeCode:'P1',intakeId:'I2'}];
  const pool = {query:async (sql,values) => {queries.push({sql,values});return {rows,rowCount:0};}};
  const module = createExamArrangementsModule(pool);
  const page = await module.listArrangementHistory({},actor);
  assert.equal(page.total,1);assert.equal(page.items[0].id,'visible');
  assert.doesNotMatch(queries[0].sql,/request_note|evidence_ref|review_note|close_note|snapshot/);
  await assert.rejects(module.listArrangementHistory({},actor,'other-programme'),{statusCode:404});
  assert.equal(queries.length,2);assert.deepEqual(queries[1].values,['other-programme','owner']);
});

test('former candidates can read their own retained cases but cannot request new arrangements',async () => {
  const key = Buffer.alloc(32,7),historical = {...sitting,status:'cancelled',startsAt:'2000-01-01T09:00:00Z',periodId:'period',programmeCode:'P1',intakeId:'I1'};
  const caseRow = {id:'case1',registrationId:'reg1',privateNotesEncrypted:true,requestNote:encryptSecret('Retained private note',key),evidenceRef:encryptSecret('Retained reference',key),accountId:'owner',sittingHash:arrangementSittingHash(historical),status:'withdrawn'};
  let currentCandidates = [],publishedCandidates;
  const db = {release() {},query:async (sql,values) => {
    if (sql.includes('from exam_sittings s')) return {rows:[historical],rowCount:1};
    if (sql.includes('from student_registrations sr join course_enrolments')) return {rows:currentCandidates,rowCount:currentCandidates.length};
    if (sql.includes('published_snapshot')) return {rows:[{status:'published',snapshot:{sittings:[{id:historical.id,revision:historical.revision,candidates:publishedCandidates}]}}],rowCount:1};
    if (sql.includes('select 1 from exam_arrangements')) return {rows:[],rowCount:values[1] === 'owner' ? 1 : 0};
    if (sql.includes('a.private_notes_encrypted')) {assert.deepEqual(values,['s1','owner']);assert.match(sql,/s\.account_id = \$2/);return {rows:[caseRow],rowCount:1};}
    return {rows:[],rowCount:0};
  }};
  const module = createExamArrangementsModule({...db,connect:async () => db},{dataEncryptionKey:key}),actor = {accountId:'owner',permissions:['registry.self'],roles:[]};
  const view = await module.getExamArrangements('s1',actor,true);
  assert.equal(view.cases[0].requestNote,'Retained private note');assert.equal(view.capabilities.request,false);assert.equal(view.capabilities.approve,false);assert.equal(view.capabilities.revoke,false);
  await assert.rejects(module.getExamArrangements('s1',{...actor,accountId:'other'},true),{statusCode:404});
  await assert.rejects(module.requestExamArrangement('s1',{extraMinutes:0,separateRoom:false,requestNote:'Request',evidenceRef:'Ref'},actor,true),{statusCode:404});
  historical.status = 'scheduled';historical.startsAt = new Date(Date.now()+86400000).toISOString();currentCandidates = [{registrationId:'reg1',accountId:'owner',studentNumber:'S1'}];
  const activeView = await module.getExamArrangements('s1',actor,true);
  assert.equal(activeView.capabilities.request,true);assert.equal(activeView.capabilities.approve,false);
  publishedCandidates = ['S2'];
  assert.equal((await module.getExamArrangements('s1',actor,true)).capabilities.request,false);
  await assert.rejects(module.requestExamArrangement('s1',{extraMinutes:0,separateRoom:false,requestNote:'Late request',evidenceRef:'Ref'},actor,true),{statusCode:409});
  publishedCandidates = ['S1'];
  assert.equal((await module.getExamArrangements('s1',actor,true)).capabilities.request,true);
});

test('late student archive reads cannot restore private state after a programme switch or sign-out',async () => {
  const window = {};runInNewContext(readFileSync(new URL('../src/registry-exam-arrangements.js',import.meta.url),'utf8'),{window,URLSearchParams});
  const ui = window.registryExamArrangementsUI,state = {};let release;
  const old = ui.loadStudent(state,async () => new Promise((resolve) => {release = resolve;}),'programme-old');
  const current = {items:[],total:0};await ui.loadStudent(state,async () => current,'programme-new');
  release({items:[{id:'private-old-case'}]});await old;assert.equal(state.studentArrangementHistory,current);
  const pending = ui.loadStudent(state,async () => new Promise((resolve) => {release = resolve;}),'programme-new');
  ui.clearStudent(state);release({items:[{id:'private-after-logout'}]});await pending;
  assert.equal(state.studentArrangementHistory,null);assert.equal(state.studentArrangement,null);assert.equal(state.studentArrangementProgrammeId,null);
});

test('authorized private views decrypt authenticated notes without altering encrypted history',() => {
  const key = Buffer.alloc(32,7),source = {privateNotesEncrypted:true,requestNote:encryptSecret('Restricted request',key),evidenceRef:encryptSecret('Restricted evidence',key),reviewNote:null,closeNote:encryptSecret('Restricted closure',key)};
  const view = arrangementPrivateView(source,key);
  assert.equal(view.requestNote,'Restricted request');assert.equal(view.evidenceRef,'Restricted evidence');assert.equal(view.closeNote,'Restricted closure');assert.equal(view.reviewNote,null);
  assert.equal('privateNotesEncrypted' in view,false);assert.match(source.requestNote,/^v1\./);
  assert.throws(() => arrangementPrivateView(source,Buffer.alloc(32,8)));
  assert.deepEqual(arrangementPrivateView({privateNotesEncrypted:false,requestNote:'Legacy pilot note'},key),{requestNote:'Legacy pilot note'});
});

test('requests have strictly typed, bounded fields without entitlement or approval fields',() => {
  const input = {extraMinutes:30,separateRoom:true,requestNote:'Private assessment reference',evidenceRef:'Restricted case 1'};
  assert.doesNotThrow(() => validateArrangementRequest(input));
  assert.doesNotThrow(() => validateArrangementRequest({...input,extraMinutes:0,separateRoom:false}));
  for (const bad of [{extraMinutes:'30'},{extraMinutes:-15},{extraMinutes:245},{extraMinutes:31},{separateRoom:'false'},{requestNote:''},{evidenceRef:'x'.repeat(201)},{instruction:'Approve automatically'},{registrationId:null}]) {
    assert.throws(() => validateArrangementRequest({...input,...bad}),{statusCode:400});
  }
});

test('request source hashes change for base facts, not approvals or roster revisions',() => {
  const hash = arrangementSittingHash(sitting);
  assert.equal(arrangementSittingHash({...arranged,revision:5,invigilators:[]}),hash);
  for (const change of [{startsAt:'2026-10-10T08:00:00Z'},{durationMinutes:195},{venueRevision:2},{capacity:2},{venueId:'other'},{planId:'p1'}]) assert.notEqual(arrangementSittingHash({...sitting,...change}),hash);
});

test('separate rooms split candidates, dedicated staff and extended booking durations',() => {
  const groups = examResourceSegments(arranged,candidates);
  assert.deepEqual(groups.map((row) => [row.venue,row.durationMinutes,row.candidates.map((person) => person.studentNumber),row.invigilators.map((person) => person.staffId)]),
    [['Main hall',195,['S2'],['lead']],['Quiet room',210,['S1'],['alt']]]);
  assert.deepEqual(timetableIssues([arranged],{c1:candidates}),{clashes:[],capacity:[]});
  assert.equal(timetableIssues([{...arranged,arrangements:[...cases,{...cases[0],studentNumber:'S2'}]}],{c1:candidates}).capacity[0].venue,'Quiet room');
});

test('extra-time clashes are per candidate and preserve the half-open boundary',() => {
  const next = {...sitting,id:'s2',courseId:'c2',venue:'Other hall',venueId:'other',capacity:10,startsAt:'2026-10-10T10:15:00Z',durationMinutes:60};
  const issues = timetableIssues([arranged,next],{c1:candidates,c2:candidates});
  assert.deepEqual(issues.clashes,[{sittingIds:['s1','s2'],students:['S1']}]);
  assert.deepEqual(timetableIssues([arranged,{...next,startsAt:'2026-10-10T10:30:00Z'}],{c1:candidates,c2:candidates}).clashes,[]);
});

test('student snapshots contain only their own operational instruction and personalised time',() => {
  const source = {...arranged,candidates,resourceSegments:examResourceSegments(arranged,candidates)};
  const own = personalExamSitting(source,'S1');
  assert.equal(own.durationMinutes,210);assert.equal(own.venue,'Quiet room');
  assert.deepEqual(own.arrangement,{extraMinutes:30,instruction:cases[0].instruction});
  for (const key of ['arrangements','candidates','resourceSegments']) assert.equal(key in own,false);
  assert.equal(JSON.stringify(own).includes('S2'),false);
  assert.equal(personalExamSitting(source,'unknown').durationMinutes,180);
});

test('invigilator snapshots expose only assigned-room operations, without case evidence or colleagues',() => {
  const source = {...arranged,requestNote:'PRIVATE',resourceSegments:examResourceSegments(arranged,candidates)};
  const own = personalExamDuty(source,'alt');
  assert.equal(own.venue,'Quiet room');assert.equal(own.durationMinutes,210);
  assert.deepEqual(own.arrangements,[{studentNumber:'S1',extraMinutes:30,instruction:cases[0].instruction}]);
  for (const key of ['requestNote','resourceSegments','invigilators','capacity']) assert.equal(key in own,false);
  assert.deepEqual(personalExamDuty(source,'lead').arrangements,[{studentNumber:'S2',extraMinutes:15,instruction:cases[1].instruction}]);
  assert.equal(personalExamDuty(source,'unassigned'),null);
  assert.equal('requestNote' in operationalArrangement({...cases[0],requestNote:'PRIVATE',evidenceRef:'PRIVATE'}),false);
});

test('published resource holds retain separate-room extended bookings through later drafts',async () => {
  const snapshot = {sittings:[{...arranged,resourceSegments:examResourceSegments(arranged,candidates)}]};
  const holds = await publishedExamCommitments({query:async () => ({rows:[{snapshot}]})},'other-period');
  assert.deepEqual(holds.map((row) => [row.id,row.venue,row.durationMinutes,row.status]),[['s1','Main hall',195,'scheduled'],['s1','Quiet room',210,'scheduled']]);
  assert.equal(paperRecipientDuration(snapshot.sittings[0],arranged,'lead'),195);
  assert.equal(paperRecipientDuration(snapshot.sittings[0],arranged,'alt'),210);
});

test('all invigilators sharing an alternative room see its full operational candidate roster',() => {
  const source = {...arranged,invigilators:[...sitting.invigilators,{staffId:'alt2',role:'invigilator'}],arrangements:[cases[0],{...cases[0],studentNumber:'S2',extraMinutes:15,invigilatorStaffId:'alt2'}]};
  source.resourceSegments = examResourceSegments(source,candidates);
  for (const staffId of ['alt','alt2']) assert.deepEqual(personalExamDuty(source,staffId).arrangements.map((row) => row.studentNumber),['S1','S2']);
  assert.equal(personalExamDuty(source,'lead'),null);
});

test('deferred completion waits for the latest personalised exam end',() => {
  const source = {...arranged,planId:'p1'},snapshot = {sittings:[arranged]};
  assert.throws(() => assertDeferredSittingReady(source,snapshot,Date.parse('2026-10-10T10:15:00Z')),{statusCode:409});
  assert.doesNotThrow(() => assertDeferredSittingReady(source,snapshot,Date.parse('2026-10-10T10:30:00Z')));
});

test('private arrangement permissions are not inherited by ordinary exam or teaching roles',() => {
  const seed = createSeedData();
  for (const permission of ['exams.arrangements.manage','exams.arrangements.review']) {
    for (const role of ['system_administrator','exam_arrangements_officer']) assert.ok(seed.rolePermissions[role].includes(permission));
    for (const role of ['examinations_officer','academic_registrar','lecturer','exam_invigilator']) assert.equal(seed.rolePermissions[role].includes(permission),false);
  }
});
