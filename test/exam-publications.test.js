import test from 'node:test';
import assert from 'node:assert/strict';
import { createExamPublicationsModule, publicationDigest, publicationFilters, publicationView } from '../server/modules/exam-publications.js';

const officer = {accountId:'office',permissions:['exams.schedule','results.view'],roles:[{permissions:['exams.schedule'],scope:{programmeCodes:['P1'],intakeIds:['I1']}},{permissions:['results.view'],scope:{}}]};
const manifest = {sittingId:'s1',code:'C1',paper:'P1',sittingRevision:3,digest:'a'.repeat(64),rooms:[{key:'main',staffIds:['staff1'],venue:'Hall',candidates:[{studentNumber:'S1',extraMinutes:0,endsAt:'2099-01-01T09:00:00Z',instruction:'Operational instruction',secret:'PRIVATE'}]}]};
const row = {periodId:'period',revision:7,publishedAt:'2026-10-05T07:00:00Z',origin:'published',reason:'Publication reason',name:'Term',programmeCode:'P1',intakeId:'I1',intakeLabel:'Intake',
  snapshot:{sittings:[{id:'s1',code:'C1',courseId:'c1',paper:'P1',startsAt:'2099-01-01T07:00:00Z',candidates:['S1'],arrangements:[{requestNote:'PRIVATE'}]}]},
  staffSnapshot:{candidateAccounts:[{accountId:'PRIVATE'}],sittings:[{id:'s1',invigilators:[{staffId:'PRIVATE',accountId:'PRIVATE',employeeNumber:'E1',legalName:'Exam Colleague',role:'lead'}]}],manifests:[manifest]}};
const seats = (revision,publishedRevision = 7) => ({revision,publishedRevision,manifestDigest:manifest.digest,digest:'b'.repeat(64),entries:[{roomKey:'main',studentNumber:'S1',seat:`A${revision}`} ]});
function fixture({records = [row],history = []} = {}) {
  const calls = [],db = {release(){},async query(sql,values) {
    calls.push({sql,values});
    if (sql.includes('from exam_seating_history')) return {rows:history};
    if (sql.includes('from exam_publications ep')) return {rows:values ? records.filter((record) => record.periodId === values[0] && record.revision === values[1]) : records};
    return {rows:[]};
  }};
  return {calls,module:createExamPublicationsModule({async connect(){return db;}})};
}

test('publication search is bounded, literal and scope-filtered before pagination and totals',async () => {
  assert.deepEqual(publicationFilters(),{limit:25,offset:0,q:''});
  for (const bad of [{limit:0},{limit:101},{offset:-1},{offset:1.5},{offset:1000001},{q:'x'.repeat(101)}]) assert.throws(() => publicationFilters(bad),{statusCode:400});
  const f = fixture({records:[row,{...row,revision:8},{...row,revision:9,intakeId:'I2'},{...row,programmeCode:'P2'}]});
  const page = await f.module.listExamPublications({limit:1,offset:1,q:' P1 '},officer);
  assert.equal(page.total,2);assert.equal(page.items[0].revision,8);assert.equal(page.items[0].intakeId,undefined);
  assert.equal((await f.module.listExamPublications({q:'%'},officer)).total,0);
  assert.equal((await f.module.listExamPublications({}, {...officer,permissions:['results.view']})).total,0);
  assert.doesNotMatch(f.calls.find((call) => call.sql.includes('jsonb_array_length')).sql,/ep\.staff_snapshot|ep\.snapshot,/);
});
test('edition projections disclose operational facts and counts, not candidate lists, private cases or internal accounts',() => {
  const view = publicationView(row);assert.equal(view.sittings[0].candidateCount,1);assert.equal(view.sittings[0].manifestAvailable,true);
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE|S1|staffId|accountId|intakeId|arrangements|candidateAccounts/);
  assert.deepEqual(view.sittings[0].invigilators,[{employeeNumber:'E1',legalName:'Exam Colleague',role:'lead'}]);
  assert.equal(publicationView({...row,snapshot:{sittings:[{id:'s1'}]},staffSnapshot:null}).sittings[0].candidateCount,null);
});
test('edition checksums survive JSONB key ordering and bind complete frozen source facts',() => {
  const reordered = JSON.parse(JSON.stringify(row),(_key,value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key,value[key]])) : value);
  assert.equal(publicationDigest(row),publicationDigest(reordered));
  assert.notEqual(publicationDigest(row),publicationDigest({...row,revision:8}));
  assert.notEqual(publicationDigest(row),publicationDigest({...row,staffSnapshot:null}));
  assert.notEqual(publicationDigest(row),publicationDigest({...row,reason:'Changed reason'}));
  assert.notEqual(publicationDigest(row),publicationDigest({...row,name:'Changed period label'}));
});
test('historical edition access does not depend on current timetable status but does enforce current permission-specific scope',async () => {
  const f = fixture();assert.equal((await f.module.getExamPublication('period',7,officer)).revision,7);
  assert.equal(f.calls.some((call) => call.sql.includes('from exam_timetables')),false);
  for (const records of [[{...row,intakeId:'I2'}],[{...row,programmeCode:'P2'}],[]]) await assert.rejects(fixture({records}).module.getExamPublication('period',7,officer),{statusCode:404});
  for (const revision of [0,-1,1.5,2147483648]) await assert.rejects(f.module.getExamPublication('period',revision,officer),{statusCode:400});
  await assert.rejects(f.module.getExamPublication('period',7,{...officer,permissions:['exams.duties.self']}),{statusCode:404});
  await assert.rejects(fixture({records:[{...row,scopeProgrammeCode:'P2'}]}).module.getExamPublication('period',7,officer),{statusCode:404});
  assert.doesNotMatch(JSON.stringify(f.calls.filter((call) => call.sql.includes('insert into audit_events'))),/PRIVATE|S1/);
});
test('historical manifests select only published seating editions bound to that exact manifest and publication',async () => {
  const f = fixture({history:[{revision:3,snapshot:seats(3,8)},{revision:2,snapshot:seats(2),publishedAt:row.publishedAt},{revision:1,snapshot:seats(1),publishedAt:row.publishedAt}]});
  const latest = await f.module.getPublicationManifest('period',7,'s1',{},officer);
  assert.equal(latest.archived,true);assert.equal(latest.seatRevision,2);assert.equal(latest.rooms[0].candidates[0].seat,'A2');
  assert.deepEqual(latest.seatingEditions.map((entry) => entry.revision),[2,1]);
  const original = await f.module.getPublicationManifest('period',7,'s1',{seatRevision:'0'},officer);assert.equal(original.rooms[0].candidates[0].seat,undefined);
  assert.equal((await f.module.getPublicationManifest('period',7,'s1',{seatRevision:'1'},officer)).rooms[0].candidates[0].seat,'A1');
  await assert.rejects(f.module.getPublicationManifest('period',7,'s1',{seatRevision:'3'},officer),{statusCode:404});
  await assert.rejects(f.module.getPublicationManifest('period',7,'s1',{seatRevision:'-1'},officer),{statusCode:400});
  assert.doesNotMatch(JSON.stringify(latest),/PRIVATE|staffIds|candidateAccounts/);
  assert.ok(f.calls.find((call) => call.sql.includes('from exam_seating_history')).sql.includes("action = 'published'"));
});
test('retained legacy editions never reconstruct unfrozen candidates and cancelled editions have no sitting manifest',async () => {
  await assert.rejects(fixture({records:[{...row,origin:'retained',staffSnapshot:null}]}).module.getPublicationManifest('period',7,'s1',{},officer),{statusCode:409});
  await assert.rejects(fixture({records:[{...row,snapshot:{sittings:[]}}]}).module.getPublicationManifest('period',7,'s1',{},officer),{statusCode:404});
});
