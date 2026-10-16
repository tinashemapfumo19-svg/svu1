import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createPrivateMessagesModule} from '../server/modules/private-messages.js';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';
import {decryptSecret,encryptSecret} from '../server/security.js';

const key=Buffer.alloc(32,17),body=' \tUnchanged <text>\r\nSecond line  \n';
const actor={accountId:'a',permissions:['messages.self'],roles:[{permissions:['rooms.self'],scope:{}}]};
function fixture(mode,{old=null,rows=[]}={}) {
  const calls=[];
  const db={release(){},async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('select a.id from accounts') || sql.includes('join roles r'))return {rows:(Array.isArray(params[0])?params[0]:['a']).map(id=>({id})),rowCount:1};
    if(sql.includes('select c.*'))return {rows:[{id:'c',account_a:'a',account_b:'b',status:'accepted',revision:2}]};
    if(sql.includes('select account_id,enabled'))return {rows:[{account_id:'a',enabled:true},{account_id:'b',enabled:true}]};
    if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r',status:'active',created_by:'a'}]};
    if(sql.includes('select m.*,p.enabled'))return {rows:[{id:'ma',enabled:true,consent_revision:1,preference_revision:1,role:'moderator',accepted_at:new Date()}]};
    if(sql.includes('select id,position::text,request_digest') || sql.includes('select input_hash,result'))return {rows:old?[old]:[]};
    if(sql.includes('count(*)::int as total'))return {rows:[{total:0}]};
    if(sql.includes('insert into private_messages(') || sql.includes('insert into room_messages('))return {rows:[{id:'m',position:'1'}]};
    if(sql.includes('select m.id,m.position::text'))return {rows};
    return {rows:[],rowCount:0};
  }};
  const pool={async connect(){return db;}};
  return {calls,module:mode==='private'?createPrivateMessagesModule(pool,{dataEncryptionKey:key}):createMessageRoomsModule(pool,{dataEncryptionKey:key})};
}

test('new private receipts and encrypted bodies bind exact whitespace and line endings',async()=>{
  const f=fixture('private');await f.module.sendPrivateMessage('c',{body,requestKey:'exact_text_key'},actor);
  const insert=f.calls.find(c=>c.sql.includes('insert into private_messages('));
  assert.equal(JSON.parse(decryptSecret(insert.params[3],key)).body,body);
  assert.equal(insert.params[5],`v3:${createHmac('sha256',key).update(JSON.stringify({id:'c',body,kind:'text'})).digest('hex')}`);
  assert.equal(f.calls.some(c=>c.sql.includes('update private_messages')),false);
  for(const retryBody of [body,body.trim(),`${body} `]){
    const replay=fixture('private',{old:{id:'m',position:'1',request_digest:insert.params[5]}});
    if(retryBody===body)assert.deepEqual(await replay.module.sendPrivateMessage('c',{body:retryBody,requestKey:'exact_text_key'},actor),{id:'m',position:'1'});
    else await assert.rejects(replay.module.sendPrivateMessage('c',{body:retryBody,requestKey:'exact_text_key'},actor),{statusCode:409});
    assert.equal(replay.calls.some(c=>c.sql.includes('insert into private_messages(') || c.sql.includes('count(*)::int as total')),false);
  }
});

test('legacy private receipts retain trimmed retry compatibility without rewriting records',async()=>{
  const hash=createHmac('sha256',key).update(JSON.stringify({id:'c',body:body.trim()})).digest('hex');
  for(const retryBody of [body,body.trim()]){
    const f=fixture('private',{old:{id:'old',position:'2',request_digest:hash}});
    assert.deepEqual(await f.module.sendPrivateMessage('c',{body:retryBody,requestKey:'legacy_text_key'},actor),{id:'old',position:'2'});
    assert.equal(f.calls.some(c=>c.sql.includes('insert into') || c.sql.includes('update private_messages')),false);
  }
  for(const request_digest of [hash,'v3:unknown','v2:unknown']){
    const f=fixture('private',{old:{id:'old',position:'2',request_digest}});
    await assert.rejects(f.module.sendPrivateMessage('c',{body:'different',requestKey:'legacy_text_key'},actor),{statusCode:409});
  }
});

test('private history returns new exact and existing normalized encrypted bodies unchanged',async()=>{
  for(const stored of [body,body.trim()]){
    const envelope=encryptSecret(JSON.stringify({id:'m',conversationId:'c',authorId:'b',body:stored}),key);
    const f=fixture('private',{rows:[{id:'m',position:'1',authorId:'b',envelope,own:false}]});
    assert.equal((await f.module.listPrivateMessages('c',{},actor)).items[0].body,stored);
  }
});

test('all room message kinds preserve exact encrypted text and exact-input receipts',async()=>{
  for(const kind of ['text','action','notice']){
    const f=fixture('room');const input={body,kind,requestKey:'exact_room_text_key'};
    await f.module.sendRoomMessage('r',input,actor);
    const insert=f.calls.find(c=>c.sql.includes('insert into room_messages('));
    assert.equal(JSON.parse(decryptSecret(insert.params[5],key)).body,body);
    const receipt=f.calls.find(c=>c.sql.includes('insert into room_message_receipts('));
    for(const retryBody of [body,body.trim()]){
      const replay=fixture('room',{old:{input_hash:receipt.params[2],result:{id:'m',position:'1'}}});
      if(retryBody===body)assert.deepEqual(await replay.module.sendRoomMessage('r',{...input,body:retryBody},actor),{id:'m',position:'1'});
      else await assert.rejects(replay.module.sendRoomMessage('r',{...input,body:retryBody},actor),{statusCode:409});
      assert.equal(replay.calls.some(c=>c.sql.includes('insert into room_messages(')),false);
    }
  }
});

test('room history and disclosed evidence preserve exact message text but normalized report reasons',async()=>{
  const snapshot={id:'q',roomId:'r',messageId:'m',reporterId:'a',membershipId:'ma',authorId:'b',category:'privacy',reason:'Reason',body,kind:'action'};
  const content={id:'m',roomId:'r',authorId:'b',membershipId:'mb',kind:'action',body};
  const f=fixture('room',{rows:[{id:'m',position:'1',authorId:'b',membershipId:'mb',kind:'action',hidden:false,envelope:encryptSecret(JSON.stringify(content),key)}]});
  assert.equal((await f.module.listRoomMessages('r',{},actor)).items[0].body,body);
  const db={release(){},async query(sql){
    if(sql.includes('from room_abuse_reports q join room_messages'))return {rows:[{id:'q',room_id:'r',message_id:'m',reporter_id:'a',membership_id:'ma',author_id:'b',category:'privacy',revision:0,envelope:encryptSecret(JSON.stringify(snapshot),key)}]};
    if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r'}]};
    if(sql.includes('select a.id from accounts'))return {rows:[{id:'a'}],rowCount:1};
    return {rows:[]};
  }};
  const detail=await createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:key}).roomReportDetail('q',{},actor);
  assert.equal(detail.body,body);assert.equal(detail.reason,'Reason');
});

test('exact preservation does not admit blank, NUL or oversized message text',async()=>{
  for(const mode of ['private','room'])for(const invalid of [' \t\r\n','x\0','x'.repeat(4001),null,5]){
    const f=fixture(mode),input={body:invalid,requestKey:'invalid_message_key'};
    await assert.rejects(mode==='private'?f.module.sendPrivateMessage('c',input,actor):f.module.sendRoomMessage('r',input,actor),{statusCode:400});
    assert.equal(f.calls.length,0);
  }
});

test('private actions bind kind to encrypted content and the immutable retry intent',async()=>{
  for(const kind of ['text','action']){
    const f=fixture('private');await f.module.sendPrivateMessage('c',{body,kind,requestKey:'private_kind_key'},actor);
    const insert=f.calls.find(c=>c.sql.includes('insert into private_messages('));
    const content=JSON.parse(decryptSecret(insert.params[3],key));assert.equal(content.kind,kind);assert.equal(content.authorId,'a');assert.equal(content.body,body);
    const rows=[{id:content.id,position:'1',authorId:'a',envelope:insert.params[3],own:true}];
    assert.equal((await fixture('private',{rows}).module.listPrivateMessages('c',{},actor)).items[0].kind,kind);
    const old={id:'m',position:'1',request_digest:insert.params[5]};
    assert.deepEqual(await fixture('private',{old}).module.sendPrivateMessage('c',{body,kind,requestKey:'private_kind_key'},actor),{id:'m',position:'1'});
    await assert.rejects(fixture('private',{old}).module.sendPrivateMessage('c',{body,kind:kind==='text'?'action':'text',requestKey:'private_kind_key'},actor),{statusCode:409});
  }
});

test('historical exact v2 and trimmed receipts accept text only without changing their format',async()=>{
  for(const version of [1,2]){
    const hash=createHmac('sha256',key).update(JSON.stringify({id:'c',body:version===1?body.trim():body})).digest('hex');
    const old={id:'old',position:'1',request_digest:version===2?`v2:${hash}`:hash};
    for(const kind of [undefined,'text','action']){
      const f=fixture('private',{old}),input={body,requestKey:'old_kind_key',...(kind===undefined?{}:{kind})};
      if(kind==='action')await assert.rejects(f.module.sendPrivateMessage('c',input,actor),{statusCode:409});
      else assert.deepEqual(await f.module.sendPrivateMessage('c',input,actor),{id:'old',position:'1'});
      assert.equal(f.calls.some(c=>c.sql.includes('insert into') || c.sql.includes('update private_messages')),false);
    }
  }
});

test('private kinds reject notices, null, spoofed identities and malformed encrypted kinds',async()=>{
  for(const kind of ['notice','me','',null,5,{},['action']]){
    const f=fixture('private');await assert.rejects(f.module.sendPrivateMessage('c',{body,kind,requestKey:'invalid_kind_key'},actor),{statusCode:400});assert.equal(f.calls.length,0);
    const content={id:'m',conversationId:'c',authorId:'b',body,kind};
    const rows=[{id:'m',position:'1',authorId:'b',envelope:encryptSecret(JSON.stringify(content),key)}];
    await assert.rejects(fixture('private',{rows}).module.listPrivateMessages('c',{},actor),{statusCode:409});
  }
  const f=fixture('private');await assert.rejects(f.module.sendPrivateMessage('c',{body,kind:'action',authorId:'b',requestKey:'spoofed_kind_key'},actor),{statusCode:400});assert.equal(f.calls.length,0);
  const content={id:'m',conversationId:'c',authorId:'b',body};
  const rows=[{id:'m',position:'1',authorId:'b',envelope:encryptSecret(JSON.stringify(content),key)}];
  assert.equal((await fixture('private',{rows}).module.listPrivateMessages('c',{},actor)).items[0].kind,'text');
});
