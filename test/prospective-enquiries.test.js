import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encryptSecret} from '../server/security.js';
import {enquiryCreate,enquiryAction,enquiryFilters,enquiryCan,enquiryNext,createProspectiveEnquiriesModule} from '../server/modules/prospective-enquiries.js';
const input = {intakeId:'I',subject:'Intake question',body:'Private prospective question',consent:true,requestKey:'enquiry-key'};
const row = {id:'E',ownerId:'owner',programmeCode:'P',intakeId:'I',status:'open',consentActive:true,consentPolicy:'portal-enquiry-v1',revision:1,assigneeId:null,escalated:false,escalationLevel:0};
const actor = {accountId:'officer',permissions:['enquiries.manage','audit.view'],roles:[{permissions:['enquiries.manage'],scope:{programmeCodes:['P'],intakeIds:['I']}},{permissions:['audit.view'],scope:{}}]};
const key = Buffer.alloc(32,3);
function moduleWith(query) {return createProspectiveEnquiriesModule({async connect(){return {query,release(){}};}},{dataEncryptionKey:key});}
test('prospective enquiries require explicit purpose consent and canonical bounded content',() => {
  assert.deepEqual(enquiryCreate(input),enquiryCreate(Object.fromEntries(Object.entries(input).reverse())));
  assert.equal(enquiryCreate(input).guidanceVersionId,null);
  for (const data of [null,{...input,consent:false},{...input,consent:'true'},{...input,ownerId:'other'},{...input,channel:'whatsapp'},{...input,subject:'x'.repeat(181)},{...input,body:'x'.repeat(4001)},{...input,body:'x\0'},{...input,requestKey:'../secret'},{...input,guidanceVersionId:42}]) assert.throws(() => enquiryCreate(data),{statusCode:400});
});
test('enquiry actions prohibit applicant triage, internal notes and implicit renewed consent',() => {
  assert.throws(() => enquiryAction('update',{revision:1},true),{statusCode:403});
  assert.throws(() => enquiryAction('withdraw',{revision:1,reason:'stop'},false),{statusCode:403});
  assert.throws(() => enquiryAction('comment',{revision:1,body:'private',visibility:'internal',requestKey:'comment-key'},true),{statusCode:400});
  assert.throws(() => enquiryAction('reopen',{revision:1,reason:'again'},true),{statusCode:400});
  assert.throws(() => enquiryAction('update',{revision:1,status:'resolved',assigneeId:'officer',reason:'resolved'}),{statusCode:400});
  assert.equal(enquiryAction('comment',{revision:1,body:' reply ',requestKey:'comment-key'},true).body,'reply');
});
test('enquiry filters are bounded, explicit and self queues cannot choose staff assignees',() => {
  assert.equal(enquiryFilters({offset:'25'},true).offset,25);
  for (const data of [{status:'deleted'},{offset:'-1'},{offset:'1000001'},{ownerId:'other'},{intakeId:'x\0'},{assignee:'all'}]) assert.throws(() => enquiryFilters(data),{statusCode:400});
  assert.throws(() => enquiryFilters({assignee:'mine'},true),{statusCode:400});
});
test('enquiry scope cannot borrow unrelated global permission; programme-wide admission roles cover their intakes',() => {
  assert.equal(enquiryCan(actor,row),true);assert.equal(enquiryCan(actor,{...row,intakeId:'hidden'}),false);assert.equal(enquiryCan(actor,{...row,programmeCode:'hidden'}),false);assert.equal(enquiryCan(actor,row,'enquiries.escalate'),false);
  assert.equal(enquiryCan({...actor,roles:[{permissions:['enquiries.manage'],scope:{programmeCodes:['P']}}]},row),true);
});
test('enquiry consent lifecycle requires explicit manager escalation resolution and owner renewal',() => {
  const escalated = enquiryNext(row,'escalate',{assigneeId:'manager'});assert.equal(escalated.escalationLevel,1);
  assert.throws(() => enquiryNext(escalated,'comment',{visibility:'public'},false,false),{statusCode:403});
  assert.throws(() => enquiryNext(escalated,'update',{status:'resolved',assigneeId:'manager',resolveEscalation:false},false,true),{statusCode:409});
  const resolved = enquiryNext(escalated,'update',{status:'resolved',assigneeId:'manager',resolveEscalation:true},false,true);assert.equal(resolved.consentActive,false);
  assert.throws(() => enquiryNext(resolved,'comment',{visibility:'public'},true),{statusCode:409});
  const reopened = enquiryNext(resolved,'reopen',{},true);assert.equal(reopened.consentActive,true);assert.equal(reopened.assigneeId,null);
  const withdrawn = enquiryNext(escalated,'withdraw',{},true);assert.equal(withdrawn.escalated,false);assert.equal(withdrawn.consentActive,false);assert.throws(() => enquiryNext(withdrawn,'reopen',{},true),{statusCode:409});
  assert.equal(enquiryNext({...row,status:'waiting_applicant'},'comment',{visibility:'public'},true).status,'in_progress');
});
test('wrong owner or staff scope is refused before private bodies and history are read',async () => {
  const calls = [],module = moduleWith(async (sql) => {calls.push(sql);return {rows:sql.startsWith('select e.id') ? [{...row,subjectEncrypted:'PRIVATE INVALID ENVELOPE'}] : []};});
  await assert.rejects(module.getProspectiveEnquiry('E',{accountId:'other',permissions:['enquiries.self']},true),{statusCode:404});
  await assert.rejects(module.getProspectiveEnquiry('E',{...actor,roles:[{permissions:['enquiries.manage'],scope:{programmeCodes:['P'],intakeIds:['other']}}]},false),{statusCode:404});
  assert.equal(calls.some((sql) => sql.includes('body_encrypted') || sql.includes('reason_encrypted')),false);
});
test('own views omit staff identities, internal messages and every private triage reason',async () => {
  const calls = [],module = moduleWith(async (sql,values) => {
    calls.push({sql,values});return {rows:sql.startsWith('select e.id') ? [{...row,subjectEncrypted:encryptSecret('Question',key),ownerName:'Owner'}] : sql.startsWith('select id,revision') ? [{id:'message',authorId:'staff',authorKind:'staff',visibility:'public',bodyEncrypted:encryptSecret('Safe reply',key)}] : sql.startsWith('select revision,action') ? [{revision:2,action:'triaged',actorId:'staff',assigneeId:'staff',reasonEncrypted:'INVALID PRIVATE REASON',toStatus:'in_progress'}] : []};
  });
  const result = await module.getProspectiveEnquiry('E',{accountId:'owner',permissions:['enquiries.self']},true);
  assert.equal(result.messages[0].body,'Safe reply');assert.equal(result.messages[0].authorId,undefined);assert.equal(result.assigneeId,undefined);assert.equal(result.ownerId,undefined);assert.equal(result.history[0].reason,undefined);assert.equal(result.history[0].actorId,undefined);
  assert.ok(calls.find((c) => c.sql.includes('visibility = \'public\'') && c.values[1] === true));
});
test('malformed authorized private text fails with a coarse reconciliation error',async () => {
  const module = moduleWith(async (sql) => ({rows:sql.startsWith('select e.id') ? [{...row,subjectEncrypted:'VERY PRIVATE BAD ENVELOPE'}] : []}));
  await assert.rejects(module.getProspectiveEnquiry('E',{accountId:'owner',permissions:['enquiries.self']},true),(e) => e.statusCode === 409 && e.message === 'Enquiry text requires reconciliation.');
});
test('own enquiry queue filters ownership before decryption and has bounded SQL pagination',async () => {
  const calls = [],module = moduleWith(async (sql,values) => {calls.push({sql,values});return {rows:[]};});
  await module.listProspectiveEnquiries({offset:'25'},{accountId:'owner',permissions:['enquiries.self']},true);
  const read = calls.find((c) => c.sql.startsWith('select e.id'));assert.match(read.sql,/e.owner_id = \$1/);assert.match(read.sql,/limit 25 offset \$6/);assert.equal(read.values[0],'owner');assert.equal(read.values[5],25);
});
test('a formerly authorized assignee cannot write after fresh role custody no longer matches',async () => {
  const calls = [],module = moduleWith(async (sql) => {
    calls.push(sql);return {rows:sql.startsWith('select e.id') ? [{...row,assigneeId:'officer'}] : sql.startsWith('select a.id,pe.preferred_name') ? [{id:'officer',name:'Officer',code:'admissions_officer',scope:{programmeCodes:['P'],intakeIds:['OTHER']},permissions:['enquiries.manage']}] : []};
  });
  await assert.rejects(module.actOnProspectiveEnquiry('E','comment',{revision:1,body:'Stale officer',visibility:'public',requestKey:'fresh-authority'},actor,false),{statusCode:403});
  const read = calls.find((sql) => sql.startsWith('select a.id,pe.preferred_name'));assert.match(read,/a.status = 'active'/);assert.match(read,/ra.effective_from <= current_date/);assert.match(read,/ra.effective_to >= current_date/);assert.equal(calls.some((sql) => sql.startsWith('update prospective_enquiries') || sql.startsWith('insert into prospective_enquiry_messages')),false);
});
test('creation and messages use keyed replay digests; live guidance context is locked, not decrypted',async () => {
  const source = await readFile('server/modules/prospective-enquiries.js','utf8');assert.match(source,/createHmac\('sha256',dataEncryptionKey\)/);assert.match(source,/pg_advisory_xact_lock/);assert.match(source,/for share of g,v/);assert.match(source,/order by version desc limit 1/);assert.match(source,/for update of e/);
  assert.doesNotMatch(source,/createHash\('sha256'\)/);
});
test('database guards retain custody, consent and append-only conversation evidence',async () => {
  const source = await readFile('migrations/066_prospective_enquiries.sql','utf8');
  for (const pattern of [/Enquiry custody is immutable/,/old.status = 'withdrawn'/,/consent_active = \(status in/,/ledger_append_only/,/unique\(enquiry_id,author_id,request_key\)/,/author_kind <> 'applicant' or visibility = 'public'/]) assert.match(source,pattern);
});
