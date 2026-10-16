import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaperDelivery, createExamPapersModule, validatePaperAction, validatePaperRelease, validatePaperUpload } from '../server/modules/exam-papers.js';
import { createSeedData } from '../scripts/seed-data.js';

const sitting = {id:'s1',revision:3,status:'scheduled',startsAt:'2026-10-10T09:00:00Z',durationMinutes:60};
const paper = {status:'approved',scanStatus:'clean',signatureVerified:true};
const staff = {status:'active',accountId:'a1'};
const release = {status:'active',staffId:'m1',recipientAccountId:'a1',sittingRevision:3,publishedRevision:5,availableAt:'2026-10-10T08:00:00Z',expiresAt:'2026-10-10T10:00:00Z'};
const timetable = {status:'published',publishedRevision:5,publishedStaffSnapshot:{sittings:[{id:'s1',revision:3,invigilators:[{staffId:'m1',accountId:'a1'}]}]}};
const now = Date.parse('2026-10-10T09:00:00Z');
test('paper upload intents pin PDF metadata, bounded bytes and an exact digest',() => {
  const input = {fileName:'paper.pdf',sizeBytes:100,checksum:'a'.repeat(64),reason:'Confidential version'};
  assert.doesNotThrow(() => validatePaperUpload(input));
  for (const bad of [{fileName:'../paper.pdf'},{fileName:'paper.jpg'},{sizeBytes:'100'},{sizeBytes:0},{sizeBytes:10485761},{checksum:'pending'},{classification:'public'},{reason:''}]) assert.throws(() => validatePaperUpload({...input,...bad}),{statusCode:400});
  assert.throws(() => validatePaperAction({revision:0,reason:'Old'}),{statusCode:400});
});
test('release windows are explicit, unexpired and bounded by the ordered sitting',() => {
  const input = {revision:3,reason:'Sealed dispatch',staffId:'m1',availableAt:release.availableAt,expiresAt:release.expiresAt,copies:20,packageRef:'SEAL-001'};
  assert.doesNotThrow(() => validatePaperRelease(input,sitting,now));
  for (const bad of [{availableAt:'2026-10-10T08:00'},{expiresAt:'2026-10-10T10:01:00Z'},{expiresAt:input.availableAt},{copies:0},{copies:1.5},{staffId:''},{packageRef:''}]) assert.throws(() => validatePaperRelease({...input,...bad},sitting,now),{statusCode:400});
  assert.throws(() => validatePaperRelease({...input,availableAt:'2026-02-30T08:00:00Z'},sitting,now),{statusCode:400});
});
test('delivery fails closed on changed paper, draft/republication, sitting, staff or recipient',() => {
  assert.doesNotThrow(() => assertPaperDelivery(release,paper,sitting,timetable,staff,{now}));
  for (const state of ['withdrawn','superseded','returned','quarantined','submitted']) assert.throws(() => assertPaperDelivery(release,{...paper,status:state},sitting,timetable,staff,{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery({...release,status:'revoked'},paper,sitting,timetable,staff,{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,{...timetable,status:'draft'},staff,{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,{...timetable,publishedRevision:6},staff,{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,{...sitting,revision:4},timetable,staff,{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,timetable,{...staff,status:'suspended'},{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,timetable,{...staff,accountId:'a2'},{now}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,{...timetable,publishedStaffSnapshot:{sittings:[]}},staff,{now}),{statusCode:409});
});
test('delivery uses a half-open access window; custody acknowledgement can follow expiry',() => {
  assert.doesNotThrow(() => assertPaperDelivery(release,paper,sitting,timetable,staff,{now:Date.parse(release.availableAt)}));
  assert.throws(() => assertPaperDelivery(release,paper,sitting,timetable,staff,{now:Date.parse(release.expiresAt)}),{statusCode:409});
  assert.throws(() => assertPaperDelivery(release,paper,sitting,timetable,staff,{now:Date.parse(release.availableAt)-1}),{statusCode:409});
  assert.doesNotThrow(() => assertPaperDelivery(release,paper,sitting,timetable,staff,{now:Date.parse(release.expiresAt),checkTime:false}));
});
test('fresh seeds retain custody permissions without giving invigilators generic paper access',() => {
  const seed = createSeedData();
  for (const permission of ['exams.papers.manage','exams.papers.review','exams.papers.scan','exams.papers.release']) assert.ok(seed.rolePermissions.system_administrator.includes(permission));
  assert.ok(seed.rolePermissions.examinations_officer.includes('exams.papers.release'));
  assert.ok(seed.rolePermissions.academic_registrar.includes('exams.papers.review'));
  assert.ok(!seed.rolePermissions.exam_invigilator.some((permission) => permission.startsWith('exams.papers.')));
});
test('personal package reads are account-limited, bounded to one query and omit custody identities',async () => {
  let queries = 0;
  const pool = {query:async (sql,values) => {
    queries++;assert.match(sql,/where r.recipient_account_id = \$1/);assert.deepEqual(values,['a1']);
    return {rows:[{...release,id:'r1',paperId:'p1',sittingId:'s1',fileName:'paper.pdf',version:1,checksum:'a'.repeat(64),copies:2,packageRef:'SEALED',createdBy:'other-account',reason:'Internal custody reason',
      paperFacts:paper,sittingFacts:sitting,timetableFacts:timetable,staffFacts:staff}]};
  }};
  const rows = await createExamPapersModule(pool).ownExamPaperReleases({accountId:'a1'});
  assert.equal(queries,1);assert.equal(rows[0].eligible,true);
  for (const field of ['createdBy','recipientAccountId','staffId','reason','paperFacts','timetableFacts']) assert.ok(!(field in rows[0]));
});
