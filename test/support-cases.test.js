import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportCasesModule,supportCategories,supportPriorities,supportStatuses,supportCan,supportNextStatus,supportListFilters,validateSupportCreate,validateSupportAction} from '../server/modules/support-cases.js';
import {encryptSecret} from '../server/security.js';
import {createHash,createHmac} from 'node:crypto';

const key = Buffer.alloc(32,7),cipher = (text) => encryptSecret(text,key);
const student = {accountId:'student',permissions:['support.self'],roles:[{scope:{},permissions:['support.self']}]};
const officer = {accountId:'officer',permissions:['support.view','support.manage','audit.view'],roles:[{scope:{programmeCodes:['P'],intakeIds:['I']},permissions:['support.view','support.manage']},{scope:{},permissions:['audit.view']}]};
const create = {programmeId:'SP',subject:'A private subject',category:'feedback',body:'Private student message',requestKey:'request-one'};
function fixture({owner = 'student',intakeId = 'I',badCipher = false,dataKey = key} = {}) {
  const calls = [],comments = [],history = [];let saved = null,request = null;
  const row = () => saved || {id:'case',programmeId:'SP',intakeId,programmeCode:'P',intakeLabel:'Intake',subjectEncrypted:badCipher ? 'invalid' : cipher(create.subject),ownerId:owner,studentNumber:'S123',category:'feedback',priority:'normal',status:'open',assigneeId:null,escalated:false,escalationLevel:0,revision:1};
  const db = {release(){},async query(sql,v) {
    calls.push({sql,v});
    if (sql.startsWith('select sp.id')) return {rows:owner === v[1] ? [{id:'SP',intakeId}] : []};
    if (sql.startsWith('select i.id')) return {rows:[{intakeId:'I',programmeCode:'P',label:'Intake'},{intakeId:'OTHER',programmeCode:'P',label:'Hidden'}]};
    if (sql.startsWith('select id,request_hash')) return {rows:request ? [request] : []};
    if (sql.startsWith('select request_hash')) return {rows:comments.filter((row) => row.requestKey === v[2] && row.authorId === v[1]).map((row) => ({requestHash:row.requestHash}))};
    if (sql.startsWith('select c.status')) return {rows:[{status:'open',count:1}]};
    if (sql.startsWith('select c.id')) return {rows:[row()]};
    if (sql.startsWith('select a.id')) return {rows:[{id:'officer',name:'Officer',code:'support_officer',scope:{programmeCodes:['P'],intakeIds:['I']},permissions:['support.manage']},{id:'manager',name:'Manager',code:'support_manager',scope:{},permissions:['support.manage','support.escalate']},{id:'outside',name:'Hidden',code:'support_officer',scope:{programmeCodes:['OTHER'],intakeIds:['OTHER']},permissions:['support.manage']}]};
    if (sql.startsWith('insert into support_cases')) {saved = {...row(),id:v[0],subjectEncrypted:v[6],category:v[7]};request = {id:v[0],requestHash:v[5]};}
    if (sql.startsWith('update support_cases')) saved = {...row(),category:v[1],priority:v[2],status:v[3],assigneeId:v[4],escalated:v[5],escalationLevel:v[6],revision:v[7]};
    if (sql.startsWith('insert into support_case_comments')) {
      const first = sql.includes("1,$3,'student'");comments.push(first ? {id:v[0],revision:1,authorId:v[2],authorKind:'student',visibility:'public',bodyEncrypted:v[3],requestKey:v[4],requestHash:v[5]}
        : {id:v[0],revision:v[2],authorId:v[3],authorKind:v[4],visibility:v[5],bodyEncrypted:v[6],requestKey:v[7],requestHash:v[8]});
    }
    if (sql.startsWith('insert into support_case_history')) history.push({revision:v[1],action:v[2],fromStatus:v[3],toStatus:v[4],visibility:v[11],reasonEncrypted:v[12]});
    if (sql.startsWith('select id,revision')) return {rows:comments.filter((row) => !v[1] || row.visibility === 'public').map(({authorId,requestKey,requestHash,...row}) => row)};
    if (sql.startsWith('select revision,action')) return {rows:history.filter((row) => !v[1] || row.visibility === 'public' || row.toStatus !== row.fromStatus && row.action !== 'comment')};
    return {rows:[]};
  }};
  return {calls,module:createSupportCasesModule({async connect(){return db;}},{dataEncryptionKey:dataKey})};
}
test('support request/action validation bounds private data and blocks student staff fields',() => {
  assert.equal(supportCategories.length,6);assert.equal(supportPriorities.length,4);assert.equal(supportStatuses.length,5);
  assert.ok(Object.isFrozen(supportCategories));assert.deepEqual(validateSupportCreate({...create,subject:' A private subject '}),create);
  for (const input of [{...create,priority:'urgent'},{...create,body:''},{...create,subject:'x'.repeat(161)},{...create,body:'bad\0'},{...create,requestKey:'../secret'},null,[]]) assert.throws(() => validateSupportCreate(input),{statusCode:400});
  for (const input of [{revision:0,body:'hello',requestKey:'comment-key'},{revision:1,body:'hello',requestKey:'comment-key',visibility:'internal'},{revision:1,body:'hello',requestKey:'comment-key',visibility:null},{revision:1,body:'hello',requestKey:'comment-key',authorId:'staff'}]) assert.throws(() => validateSupportAction('comment',input,true),{statusCode:400});
  assert.throws(() => validateSupportAction('update',{revision:1,reason:'triage'},true),{statusCode:403});
});
test('support filters are bounded, explicit and permission-specific scopes cannot borrow global roles',() => {
  assert.equal(supportListFilters().limit,25);
  for (const f of [{limit:'0'},{offset:'1e4'},{limit:101},{status:'deleted'},{category:'private'},{assignee:'anyone'},{q:'secret'},{programmeId:'bad\n'}]) assert.throws(() => supportListFilters(f),{statusCode:400});
  assert.equal(supportCan(officer,{programmeCode:'P',intakeId:'OTHER'},'support.manage'),false);
  assert.equal(supportCan(officer,{programmeCode:'P',intakeId:'I'},'support.manage'),true);
  assert.equal(supportCan(officer,{programmeCode:'P',intakeId:'I'},'support.escalate'),false);
});
test('support lifecycle requires assignment, manager escalation resolution and explicit reopen/close',() => {
  const row = {status:'open',escalated:false};assert.equal(supportNextStatus({...row,status:'waiting_student'},'comment',{},true),'in_progress');
  assert.throws(() => supportNextStatus(row,'close',{},true),{statusCode:409});
  assert.throws(() => supportNextStatus(row,'update',{status:'resolved',assigneeId:null}),{statusCode:400});
  assert.throws(() => supportNextStatus({...row,escalated:true},'update',{status:'resolved',assigneeId:'manager'}),{statusCode:403});
  assert.equal(supportNextStatus({...row,escalated:true},'update',{status:'resolved',assigneeId:'manager'},false,true),'resolved');
  assert.equal(supportNextStatus({status:'closed'},'reopen',{},true),'open');
  assert.throws(() => supportNextStatus({status:'closed'},'comment',{},true),{statusCode:409});
  assert.throws(() => supportNextStatus({status:'resolved'},'update',{status:'open',assigneeId:'officer'}),{statusCode:409});
});
test('own case creation encrypts subject/message, records private-safe audit and replays once',async () => {
  const f = fixture(),first = await f.module.createSupportCase(create,student),again = await f.module.createSupportCase(create,student);
  assert.equal(first.id,again.id);assert.equal(first.subject,create.subject);assert.equal(first.comments[0].body,create.body);
  assert.equal(f.calls.filter((call) => call.sql.startsWith('insert into support_cases')).length,1);
  const insert = f.calls.find((call) => call.sql.startsWith('insert into support_cases'));assert.ok(!insert.v.includes(create.subject));assert.ok(f.calls.some((call) => call.sql.endsWith('for update of sp')));
  const audits = f.calls.filter((call) => call.sql.includes('insert into audit_events'));assert.equal(audits.length,1);assert.doesNotMatch(JSON.stringify(audits),/Private student message|A private subject/);
  await assert.rejects(f.module.createSupportCase({...create,body:'Different'},student),{statusCode:409});
});
test('private case bodies are never decrypted for wrong ownership or unrelated global scope',async () => {
  for (const [f,actor,self] of [[fixture({owner:'other',badCipher:true}),student,true],[fixture({intakeId:'OTHER',badCipher:true}),officer,false]]) {
    await assert.rejects(f.module.getSupportCase('case',actor,self),{statusCode:404});assert.equal(f.calls.some((call) => call.sql.startsWith('select id,revision')),false);assert.equal(f.calls.at(-1).sql,'rollback');
  }
  await assert.rejects(fixture({owner:'other'}).module.createSupportCase(create,student),{statusCode:404});
});
test('private retry digests are keyed rather than usable as unkeyed message guesses',async () => {
  const f = fixture(),other = fixture({dataKey:Buffer.alloc(32,8)});await f.module.createSupportCase(create,student);await other.module.createSupportCase(create,student);
  const digest = f.calls.find((call) => call.sql.startsWith('insert into support_cases')).v[5],payload = JSON.stringify([create.subject,create.category,create.body]);
  assert.equal(digest,createHmac('sha256',key).update(payload).digest('hex'));assert.notEqual(digest,createHash('sha256').update(payload).digest('hex'));
  assert.notEqual(digest,other.calls.find((call) => call.sql.startsWith('insert into support_cases')).v[5]);
});
test('authorized malformed ciphertext fails coarsely without private envelope text or partial view',async () => {
  const f = fixture({badCipher:true});await assert.rejects(f.module.getSupportCase('case',student,true),{statusCode:409,message:'Support case text requires reconciliation.'});
  assert.equal(f.calls.at(-1).sql,'rollback');assert.equal(f.calls.some((call) => call.sql.includes('insert into audit_events')),false);
});
test('support queue chooses scoped metadata before sources, has bounded SQL pagination and no note bodies',async () => {
  const f = fixture(),list = await f.module.listSupportCases({},officer);
  assert.equal(f.calls[1].sql,'set transaction isolation level repeatable read');assert.equal(list.total,1);assert.deepEqual(list.availableIntakes.map((row) => row.intakeId),['I']);
  const query = f.calls.find((call) => call.sql.startsWith('select c.id'));assert.deepEqual(query.v[1],['I']);assert.match(query.sql,/limit \$9 offset \$10/);assert.doesNotMatch(JSON.stringify(list),/subjectEncrypted|ownerId|Private student message/);
  await assert.rejects(f.module.listSupportCases({intakeId:'OTHER'},officer),{statusCode:404});
  await assert.rejects(f.module.listSupportCases({assignee:'mine'},student,true),{statusCode:400});
});
test('the own-case index covers retained owned programmes without application or staff-scope borrowing',async () => {
  const f = fixture(),list = await f.module.listSupportCases({},student,true);
  const query = f.calls.find((call) => call.sql.startsWith('select c.id'));assert.equal(query.v[0],student.accountId);assert.deepEqual(query.v[1],[]);assert.equal(query.v[2],null);
  assert.match(query.sql,/s.account_id = \$1/);assert.doesNotMatch(query.sql,/applicant_account_id|sp.status/);assert.deepEqual(list.availableIntakes,[]);assert.equal(f.calls.some((call) => call.sql.startsWith('select i.id')),false);
});
test('messages are revision-guarded, idempotent and internal content/history stays off self views',async () => {
  const f = fixture();await f.module.createSupportCase(create,student);
  const data = {revision:1,body:'STAFF PRIVATE NOTE',visibility:'internal',requestKey:'note-one'};
  const staff = await f.module.actOnSupportCase('case','comment',data,officer),replay = await f.module.actOnSupportCase('case','comment',data,officer);
  assert.equal(staff.revision,2);assert.equal(replay.revision,2);assert.equal(staff.comments.length,2);
  const own = await f.module.getSupportCase('case',student,true);assert.equal(own.comments.length,1);assert.equal(own.history.length,1);assert.doesNotMatch(JSON.stringify(own),/STAFF PRIVATE|subjectEncrypted|bodyEncrypted|assigneeId/);
  await assert.rejects(f.module.actOnSupportCase('case','comment',{...data,body:'DIFFERENT'},officer),{statusCode:409});
  await assert.rejects(f.module.actOnSupportCase('case','comment',{...data,requestKey:'new-note'},officer),{statusCode:409});
});
test('fresh active assignee authority and escalation manager checks precede mutations',async () => {
  const f = fixture();await f.module.createSupportCase(create,student);
  const input = {revision:1,category:'feedback',priority:'high',status:'in_progress',assigneeId:'outside',reason:'Private triage reason'};
  await assert.rejects(f.module.actOnSupportCase('case','update',input,officer),{statusCode:400});
  await assert.rejects(f.module.actOnSupportCase('case','escalate',{revision:1,assigneeId:'officer',reason:'Private escalation'},officer),{statusCode:400});
  const updated = await f.module.actOnSupportCase('case','escalate',{revision:1,assigneeId:'manager',reason:'Private escalation'},officer);
  assert.equal(updated.escalated,true);assert.equal(updated.escalationLevel,1);assert.equal(updated.assigneeId,'manager');assert.equal(updated.history.at(-1).visibility,'internal');
  const own = await f.module.getSupportCase('case',student,true);assert.doesNotMatch(JSON.stringify(own),/Private escalation|assigneeId/);
  assert.equal(own.history.at(-1).action,'status_changed');assert.equal(own.history.at(-1).reason,null);
  await assert.rejects(f.module.actOnSupportCase('case','update',{...input,revision:2,assigneeId:'manager',status:'resolved'},officer),{statusCode:403});
  const assigneeSQL = f.calls.find((call) => call.sql.startsWith('select a.id')).sql;assert.match(assigneeSQL,/a.status = 'active'/);assert.match(assigneeSQL,/effective_from <= current_date/);assert.match(assigneeSQL,/effective_to >= current_date/);
});
