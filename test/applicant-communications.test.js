import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptSecret} from '../server/security.js';
import {communicationFilters,validateCommunicationPreview,validateCommunicationPreferences,communicationsCan,communicationAudience,createApplicantCommunicationsModule} from '../server/modules/applicant-communications.js';

const input = {filters:{intakeId:'I',status:'submitted',workflowState:'Accepted'},subject:'An update',body:'A private message',reason:'Optional intake update',channels:['in_app','email'],requestKey:'request-one'};
const row = {id:'A',status:'submitted',workflowState:'Accepted',accountId:'person',accountStatus:'active',name:'Person',email:'person@example.com',inApp:true,emailConsent:true,preferenceRevision:1};
test('communication filters and preview reject unsupported fields, injection and implicit consent',() => {
  assert.deepEqual(communicationFilters({intakeId:'I'}),{intakeId:'I',status:'submitted',workflowState:''});
  for (const filters of [{intakeId:''},{intakeId:'I',status:'deleted'},{intakeId:'I',status:'draft',workflowState:'Accepted'},{intakeId:'I',workflowState:'x\0'},{intakeId:'I',accountId:'private'},null]) assert.throws(() => communicationFilters(filters),{statusCode:400});
  for (const value of [{...input,subject:'Injected\r\nSubject'},{...input,body:'x'.repeat(4001)},{...input,channels:['sms']},{...input,channels:['email','email']},{...input,channels:[]},{...input,requestKey:'../../key'},{...input,recipients:['person']},null]) assert.throws(() => validateCommunicationPreview(value),{statusCode:400});
  assert.deepEqual(validateCommunicationPreview(input),validateCommunicationPreview(Object.fromEntries(Object.entries(input).reverse())));
});
test('preferences require explicit booleans and exact revision',() => {
  assert.deepEqual(validateCommunicationPreferences({revision:0,inApp:false,email:false}),{revision:0,inApp:false,email:false});
  for (const v of [{revision:0,inApp:'true',email:false},{revision:-1,inApp:true,email:true},{revision:0,inApp:true},{revision:1,inApp:true,email:true,accountId:'other'}]) assert.throws(() => validateCommunicationPreferences(v),{statusCode:400});
});
test('communication scope cannot borrow unrelated global authority',() => {
  const actor = {permissions:['admissions.communicate','audit.view'],roles:[{permissions:['admissions.communicate'],scope:{programmeCodes:['P'],intakeIds:['I']}},{permissions:['audit.view'],scope:{}}]};
  assert.equal(communicationsCan(actor,{programmeCode:'P',intakeId:'I'}),true);
  assert.equal(communicationsCan(actor,{programmeCode:'P',intakeId:'HIDDEN'}),false);
});
test('audience deduplicates accounts per channel and reports suppressed recipients without adding them',() => {
  const result = communicationAudience([row,{...row,id:'B'},{...row,id:'C',accountId:'off',inApp:false,emailConsent:false},{...row,id:'D',accountId:'inactive',accountStatus:'disabled'},{...row,id:'E',workflowState:'Rejected'}],input);
  assert.equal(result.recipients.length,2);assert.deepEqual(result.counts,{applications:4,accounts:3,recipientChannels:2,inApp:1,email:1,excludedInApp:2,excludedEmail:2});
  assert.deepEqual(result.recipients.map((r) => r.accountId),['person','person']);
});
test('channel consent is independent and invalid email cannot become a queued recipient',() => {
  const result = communicationAudience([{...row,inApp:false},{...row,accountId:'no-email',email:'invalid'}],input);
  assert.deepEqual(result.recipients.map((r) => [r.accountId,r.channel]),[['no-email','in_app'],['person','email']]);
  assert.equal(communicationAudience([{...row,inApp:false,emailConsent:false}],input).recipients.length,0);
});
test('audience refuses oversize campaigns rather than truncating approved recipients',() => {
  assert.throws(() => communicationAudience(Array.from({length:251},(_,i) => ({...row,accountId:String(i)})),input),{statusCode:413});
});

test('consented campaign audiences canonicalize preserved account email without changing source rows',()=>{
  const source={...row,email:' PERSON@EXAMPLE.COM '};
  const audience=communicationAudience([source],input);
  assert.equal(audience.recipients.find(r=>r.channel==='email').email,'person@example.com');
  assert.equal(source.email,' PERSON@EXAMPLE.COM ');
  for(const email of ['person@example.com\t','person@example.com\r\nBcc: other@example.com','a,b@example.com','a..b@example.com'])assert.equal(communicationAudience([{...source,email}],input).counts.email,0);
});
test('own preferences default off and reject stale writes before mutations',async () => {
  const calls = [],db = {release(){},async query(sql,v){calls.push({sql,v});return {rows:[]};}},module = createApplicantCommunicationsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,3)}),actor = {accountId:'owner',permissions:['communications.self']};
  assert.deepEqual(await module.getCommunicationPreferences(actor),{inApp:false,email:false,revision:0,updatedAt:null});
  await assert.rejects(module.setCommunicationPreferences({revision:2,inApp:true,email:false},actor),{statusCode:409});
  assert.equal(calls.some((c) => c.sql.startsWith('insert into applicant_communication_preferences')),false);
  assert.equal(calls.at(-1).sql,'rollback');
});
test('wrong-scope campaign is denied before malformed private text is decrypted',async () => {
  const calls = [],db = {release(){},async query(sql){calls.push(sql);return {rows:sql.startsWith('select c.id') ? [{id:'hidden',status:'preview',createdBy:'owner',intakeId:'OTHER',programmeCode:'P',audienceEncrypted:'INVALID'}] : []};}},actor = {accountId:'owner',permissions:['admissions.communicate'],roles:[{permissions:['admissions.communicate'],scope:{programmeCodes:['P'],intakeIds:['I']}}]};
  const module = createApplicantCommunicationsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,3)});
  await assert.rejects(module.getApplicantCommunication('hidden',actor),{statusCode:404});assert.equal(calls.at(-1),'rollback');
});

test('authorized malformed encrypted audience fails coarsely and rolls back without text echo',async () => {
  const key = Buffer.alloc(32,3),calls = [],db = {release(){},async query(sql){calls.push(sql);return {rows:sql.startsWith('select c.id') ? [{id:'case',status:'preview',createdBy:'owner',intakeId:'I',programmeCode:'P',audienceEncrypted:encryptSecret('PRIVATE BROKEN JSON',key)}] : []};}};
  const actor = {accountId:'owner',permissions:['admissions.communicate'],roles:[{permissions:['admissions.communicate'],scope:{}}]};
  await assert.rejects(createApplicantCommunicationsModule({async connect(){return db;}},{dataEncryptionKey:key}).getApplicantCommunication('case',actor),{statusCode:409,message:'Communication text requires reconciliation.'});
  assert.equal(calls.at(-1),'rollback');
});
test('expired previews refuse publication before source reads or recipient inserts',async () => {
  const calls = [],db = {release(){},async query(sql){calls.push(sql);return {rows:sql.startsWith('select c.id') ? [{id:'case',status:'preview',createdBy:'owner',intakeId:'I',programmeCode:'P',expired:true}] : []};}},actor = {accountId:'owner',permissions:['admissions.communicate'],roles:[{permissions:['admissions.communicate'],scope:{}}]};
  await assert.rejects(createApplicantCommunicationsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,3)}).publishApplicantCommunication('case',{},actor),{statusCode:409});
  assert.equal(calls.some((sql) => sql.startsWith('insert into applicant_communication_recipients') || sql.includes('for update of i')),false);
});
test('explicit initial refusal records history and cancels unsent email under the consent lock',async () => {
  const calls = [],db = {release(){},async query(sql,v){calls.push({sql,v});return {rows:[]};}},actor = {accountId:'owner',permissions:['communications.self']};
  await createApplicantCommunicationsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,3)}).setCommunicationPreferences({revision:0,inApp:false,email:false},actor);
  assert.ok(calls.find((c) => c.sql.startsWith('select pg_advisory_xact_lock')));
  assert.deepEqual(calls.find((c) => c.sql.startsWith('insert into applicant_communication_preference_history')).v,['owner',false,false,1]);
  assert.deepEqual(calls.find((c) => c.sql.startsWith('update applicant_communication_recipients')).v,['owner']);
});
