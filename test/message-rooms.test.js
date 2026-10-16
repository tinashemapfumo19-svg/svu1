import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageRoomsModule,roomAuthority,roomPage} from '../server/modules/message-rooms.js';
import {createSeedData} from '../scripts/seed-data.js';
import {encryptSecret} from '../server/security.js';
const actor={accountId:'a',roles:[{permissions:['rooms.self'],scope:{}}]};
test('room invitations lock active current recipient grants before capacity and insertion',async()=>{
  const calls=[],owner={accountId:'a',roles:[{permissions:['rooms.self','rooms.manage'],scope:{}}]};
  const db={release(){},async query(sql,params){calls.push({sql,params});
    if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r',status:'active',created_by:'a'}]};
    if(sql==='select id from accounts where lower(btrim(email))=$1 limit 2')return {rows:[{id:'b'}]};
    if(sql.includes('where lower(btrim(a.email))=$1'))return {rows:[],rowCount:0};
    if(sql.includes('select a.id from accounts'))return {rows:[{id:'a'}],rowCount:1};
    if(sql.includes('select m.*,p.enabled'))return {rows:[{enabled:true,consent_revision:1,preference_revision:1,role:'moderator'}]};
    return {rows:[]};
  }};
  await assert.rejects(createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,2)}).inviteRoomMember('r',{email:'peer@example.com',requestKey:'valid_request_key'},owner),{statusCode:404});
  const recipient=calls.find(call=>call.sql.includes('where lower(btrim(a.email))=$1'));
  const pair=calls.findIndex(call=>call.params?.[0]==='private-pair:["a","b"]');
  assert.ok(pair>=0,'Room invitation must lock the private contact pair');
  assert.ok(pair<calls.indexOf(recipient),'Eligibility must be rechecked after the pair lock');
  assert.match(recipient.sql,/join roles r on r.code=ra.role_code and r.active/);
  assert.match(recipient.sql,/ra.ended_at is null/);assert.match(recipient.sql,/ra.effective_from<=current_date/);
  assert.match(recipient.sql,/ra.effective_to>=current_date/);assert.match(recipient.sql,/rp.permission_code='rooms.self'/);
  assert.match(recipient.sql,/for share of a,p,ra,r,rp/);
  assert.doesNotMatch(recipient.sql,/limit 1/);
  assert.match(recipient.sql,/a.id=\$3/);
  assert.deepEqual(recipient.params,['peer@example.com','a','b']);
  assert.equal(calls.some(call=>call.sql.includes('select count(*)') || call.sql.includes('insert into')),false);
  assert.equal(calls.at(-1).sql,'rollback');
});
test('rooms have separate human self authority and unassigned institutional stewardship roles',()=>{
  const seed=createSeedData();assert.ok(seed.permissions.includes('rooms.self'));
  for(const code of ['applicant','student','system_administrator','cashbook_officer'])assert.ok(seed.rolePermissions[code].includes('rooms.self'));
  for(const code of ['auditor','lms_connector','report_scheduler','record_recipient'])assert.equal(seed.rolePermissions[code].includes('rooms.self'),false);
  assert.deepEqual(seed.rolePermissions.room_steward,['rooms.self','rooms.manage']);assert.deepEqual(seed.rolePermissions.room_approver,['rooms.self','rooms.approve']);
  assert.deepEqual(seed.rolePermissions.room_safety_reviewer,['rooms.self','rooms.triage']);
  assert.equal(seed.rolePermissions.room_steward.includes('rooms.triage'),false);
  assert.equal(roomAuthority({accountId:'a',roles:[{permissions:['rooms.manage'],scope:{programmeCodes:['x']}}]},'rooms.manage'),false);
  assert.equal(roomAuthority({...actor,permissions:['rooms.manage']},'rooms.manage'),false);
});
test('report intake requires explicit disclosure and refuses spoofed evidence or invalid triage before connection',async()=>{
  const module=createMessageRoomsModule({connect(){throw new Error('must not connect');}},{dataEncryptionKey:Buffer.alloc(32,2)});
  const report={category:'harassment',reason:'Observed conduct',disclose:true,requestKey:'valid_request_key'};
  for(const data of [{...report,disclose:false},{...report,disclose:'true'},{...report,category:'emergency'},{...report,reason:' '},{...report,authorId:'b'},{...report,body:'Invented evidence'}])await assert.rejects(module.reportRoomMessage('r','m',data,actor),{statusCode:400});
  await assert.rejects(module.triageRoomReport('q',{revision:0,operation:'claim',details:'Reason',requestKey:'valid_request_key'},actor),{statusCode:403});
  for(const revision of [null,-1,1.5,2147483647,'1'])await assert.rejects(module.triageRoomReport('q',{revision,operation:'claim',details:'Reason'},actor),{statusCode:400});
  await assert.rejects(module.listRoomReports({view:'triage'},actor),{statusCode:403});
  await assert.rejects(module.listRoomReports({reporterId:'other'},actor),{statusCode:400});
  await assert.rejects(module.listRoomReports({status:'urgent'},actor),{statusCode:400});
});
test('report evidence rejects swapped identity or keys before returning any detail',async()=>{
  const key=Buffer.alloc(32,2),snapshot={id:'q',roomId:'r',messageId:'m',reporterId:'a',membershipId:'ma',authorId:'b',category:'privacy',reason:'PRIVATE REASON',body:'PRIVATE MESSAGE',kind:'text',roomTitle:'Room'};
  for(const mismatch of ['id','roomId','messageId','reporterId','membershipId','authorId','category','key']){
    const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql.includes('from room_abuse_reports q join room_messages'))return {rows:[{id:'q',room_id:'r',message_id:'m',reporter_id:'a',membership_id:'ma',author_id:'b',category:'privacy',revision:0,status:'open',envelope:encryptSecret(JSON.stringify(mismatch==='key'?snapshot:{...snapshot,[mismatch]:'swapped'}),key)}]};if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r'}]};if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};return {rows:[]};}};
    await assert.rejects(createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:mismatch==='key'?Buffer.alloc(32,3):key}).roomReportDetail('q',{},actor),{statusCode:409});
    assert.equal(calls.some(sql=>sql.includes('insert into audit_events')),false);assert.equal(calls.at(-1),'rollback');
  }
});
test('room pagination refuses injected authorities and preserves exact positions',()=>{
  assert.deepEqual(roomPage({before:'9007199254740993'},true),{before:'9007199254740993'});
  for(const input of [null,[],{offset:'01'},{offset:1},{offset:'100001'},{accountId:'b'},{limit:'999'}])assert.throws(()=>roomPage(input),{statusCode:400});
  assert.throws(()=>roomPage({before:'9223372036854775808'},true),{statusCode:400});
});
test('room commands deny missing authority and unavailable encryption before connection',async()=>{
  const module=createMessageRoomsModule({connect(){throw new Error('must not connect');}});
  await assert.rejects(module.roomWorkspace({},{}),{statusCode:403});
  await assert.rejects(module.roomSummary('r',{},{}),{statusCode:403});
  await assert.rejects(module.roomSummary('r',{offset:'0'},actor),{statusCode:400});
  await assert.rejects(module.roomChanges({},{}),{statusCode:403});
  await assert.rejects(module.roomChanges({accountId:'b'},actor),{statusCode:400});
  await assert.rejects(module.sendRoomMessage('r',{body:'x',requestKey:'valid_request_key'},actor),{statusCode:503});
  await assert.rejects(module.sendRoomMessage('r',{body:'x',authorId:'b'},actor),{statusCode:400});
  await assert.rejects(module.sendRoomMessage('r',{body:'x',kind:'debug'},actor),{statusCode:400});
});
test('room history rejects stale consent before querying ciphertext',async()=>{
  const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r'}]};if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};if(sql.includes('select m.*,p.enabled'))return {rows:[{enabled:true,consent_revision:1,preference_revision:3}]};return {rows:[]};}};
  const module=createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,2)});
  await assert.rejects(module.listRoomMessages('r',{},actor),{statusCode:404});assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('m.envelope')),false);
});
test('creator moderation cannot survive loss of native stewardship or bypass receipt gating',async()=>{
  const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r',status:'active',created_by:'a'}]};if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};if(sql.includes('select m.*,p.enabled'))return {rows:[{enabled:true,consent_revision:1,preference_revision:1,role:'member'}]};return {rows:[]};}};
  const module=createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,2)});
  await assert.rejects(module.sendRoomMessage('r',{body:'notice',kind:'notice',requestKey:'valid_request_key'},actor),{statusCode:403});
  assert.equal(calls.some(sql=>sql.includes('select input_hash,result')),false);assert.equal(calls.at(-1),'rollback');
});
test('room envelopes bind every identity and hidden content is never decrypted',async()=>{
  const key=Buffer.alloc(32,2),content={id:'m',roomId:'r',authorId:'b',membershipId:'mb',kind:'text',body:'SECRET'};
  for(const mismatch of ['id','roomId','authorId','membershipId','kind','key','hidden']) {
    const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r'}]};if(sql.includes('select a.id from accounts'))return {rowCount:1,rows:[{id:'a'}]};if(sql.includes('select m.*,p.enabled'))return {rows:[{enabled:true,consent_revision:1,preference_revision:1,accepted_at:new Date()}]};if(sql.includes('m.envelope'))return {rows:[{id:'m',position:'1',authorId:'b',membershipId:'mb',kind:'text',hidden:mismatch==='hidden',envelope:mismatch==='hidden' ? 'corrupt' : encryptSecret(JSON.stringify(mismatch==='key' ? content : {...content,[mismatch]:'wrong'}),key)}]};return {rows:[]};}};
    const module=createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:mismatch==='key' ? Buffer.alloc(32,3) : key});
    if(mismatch==='hidden'){const result=await module.listRoomMessages('r',{},actor);assert.equal(result.items[0].body,null);}
    else {await assert.rejects(module.listRoomMessages('r',{},actor),{statusCode:409});assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('insert into audit_events')),false);}
  }
});
