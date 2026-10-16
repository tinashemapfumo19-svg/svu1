import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {activityAfter,activityCursor,activityEpoch,activityResult} from '../server/modules/chat-activity.js';
import {createPrivateMessagesModule} from '../server/modules/private-messages.js';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';

const key=Buffer.alloc(32,21),actor={accountId:'a',permissions:['messages.self'],roles:[{permissions:['rooms.self'],scope:{}}]},scope='["private","c"]',epoch=activityEpoch({grant:'g'},key);
test('activity cursors bind actor, scope and epoch without body/name fields and preserve exact bigints',()=>{
  const snapshot={latest:'9007199254740993',own:'1',others:'2'};
  const initial=activityResult(snapshot,null,epoch,actor,scope,key,1000);assert.deepEqual(Object.keys(initial).sort(),['cursor','others','own','reset']);assert.equal(initial.reset,true);assert.equal(initial.own,'0');assert.equal(initial.others,'0');
  const previous=activityCursor({cursor:initial.cursor},actor,scope,key);assert.equal(previous.p,snapshot.latest);assert.equal(activityAfter(previous,epoch,1001),snapshot.latest);
  const next=activityResult({...snapshot,latest:'9007199254741000'},previous.p,epoch,actor,scope,key,1001);assert.equal(next.reset,false);assert.equal(next.own,'1');assert.equal(next.others,'2');
  for(const [who,where,k] of [[{accountId:'b'},scope,key],[actor,'["private","other"]',key],[actor,'["room","c"]',key],[actor,scope,Buffer.alloc(32,22)]])assert.throws(()=>activityCursor({cursor:initial.cursor},who,where,k),{statusCode:400});
});
test('activity expiry, clock rollback, epoch changes and restored lower positions reset without historical alerts',()=>{
  const token=activityResult({latest:'10',own:'0',others:'0'},null,epoch,actor,scope,key,1000).cursor,previous=activityCursor({cursor:token},actor,scope,key);
  assert.equal(activityAfter(previous,epoch,1000+30*60*1000),'10');assert.equal(activityAfter(previous,epoch,1001+30*60*1000),null);assert.equal(activityAfter(previous,epoch,999),null);assert.equal(activityAfter(previous,activityEpoch({grant:'new'},key),1001),null);
  const reset=activityResult({latest:'5',own:'1',others:'1'},'10',epoch,actor,scope,key,1001);assert.equal(reset.reset,true);assert.equal(reset.own,'0');assert.equal(reset.others,'0');
});
test('activity inputs reject tampering, unbounded/extra fields and malformed signed payloads',()=>{
  for(const input of [null,[],{cursor:null},{cursor:5},{cursor:'x'.repeat(1201)},{cursor:'invalid'},{after:'1'},{cursor:'',actorId:'b'}])assert.throws(()=>activityCursor(input,actor,scope,key),{statusCode:400});
  assert.equal(activityCursor({},actor,scope,key),null);assert.equal(activityCursor({cursor:''},actor,scope,key),null);
  const original={v:1,a:'a',s:scope,p:'1',e:epoch,t:1000};
  for(const payload of ['invalid',null,[],{...original,v:2},{...original,p:'01'},{...original,p:1},{...original,p:'9223372036854775808'},{...original,p:'-1'},{...original,e:'x'},{...original,t:-1},{...original,t:1.5},{...original,t:9007199254740992},{...original,extra:true}]){
    const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url'),signature=createHmac('sha256',key).update(`chat-activity-cursor\0${encoded}`).digest('base64url');
    assert.throws(()=>activityCursor({cursor:`${encoded}.${signature}`},actor,scope,key),{statusCode:400});
  }
});
test('activity snapshots reject reconciliation faults and missing keys coarsely',()=>{
  for(const snapshot of [null,{latest:'1',own:'1',others:'1'},{latest:'01',own:'0',others:'0'},{latest:'1',own:-1,others:'0'},{latest:'1',own:'0',others:'9223372036854775808'}])assert.throws(()=>activityResult(snapshot,null,epoch,actor,scope,key),{statusCode:409});
  for(const k of [undefined,'secret',Buffer.alloc(31)])assert.throws(()=>activityCursor({},actor,scope,k),{statusCode:503});
});

function fixture(mode) {
  const calls=[],state={authorized:true,status:mode==='private'?'accepted':'active',eligible:true,consent:1,blocks:'0',grant:'g',snapshot:{latest:'10',own:'0',others:'0'}};
  const db={release(){},async query(sql,params){calls.push({sql,params});
    if(sql.includes('as "assignmentId"'))return {rows:[{accountId:'a',assignmentId:state.grant,roleCode:'applicant'}]};
    if(sql.includes('join roles r'))return {rows:state.authorized?(Array.isArray(params[0])?params[0]:['a']).map(id=>({id})):[],rowCount:state.authorized?1:0};
    if(sql.includes('select c.*'))return {rows:[{id:'c',account_a:'a',account_b:'b',status:state.status,revision:2}]};
    if(sql.includes('select account_id,enabled'))return {rows:[{account_id:'a',enabled:state.eligible},{account_id:'b',enabled:true}]};
    if(sql.includes('select account_id,revision'))return {rows:[{account_id:'a',revision:state.consent},{account_id:'b',revision:1}]};
    if(sql==='select * from message_rooms where id=$1')return {rows:[{id:'r',status:state.status}]};
    if(sql.includes('select m.*,p.enabled'))return {rows:[{id:'membership',enabled:state.eligible,consent_revision:1,preference_revision:state.consent}]};
    if(sql.includes('sum(revision)'))return {rows:[{revision:state.blocks}]};
    if(sql.includes('coalesce(max(position),0)::text as latest'))return {rows:[state.snapshot]};
    return {rows:[],rowCount:0};
  }};
  const pool={async connect(){return db;}},module=mode==='private'?createPrivateMessagesModule(pool,{dataEncryptionKey:key}):createMessageRoomsModule(pool,{dataEncryptionKey:key});
  return {calls,state,read:input=>mode==='private'?module.privateMessageActivity('c',input,actor):module.roomMessageActivity('r',input,actor)};
}
for(const mode of ['private','room']){
  test(`${mode} activity uses a repeatable participant snapshot, metadata-only counts and grant-bound baseline`,async()=>{
    const f=fixture(mode),baseline=await f.read({});assert.equal(baseline.reset,true);
    f.state.snapshot={latest:'12',own:'1',others:'1'};const next=await f.read({cursor:baseline.cursor});assert.equal(next.reset,false);assert.equal(next.own,'1');assert.equal(next.others,'1');
    const query=f.calls.findLast(c=>c.sql.includes('coalesce(max(position)'));assert.equal(query.params[2],'10');assert.ok(f.calls.some(c=>c.sql==='set transaction isolation level repeatable read'));
    assert.equal(f.calls.some(c=>/envelope|insert into|update private|update room/.test(c.sql)),false);
    if(mode==='room'){assert.match(query.sql,/kind in \('text','action'\) and not hidden/);assert.match(query.sql,/select accepted_at from message_room_memberships where id=\$4/);assert.match(query.sql,/private_contact_blocks/);assert.equal(query.params[3],'membership');}
    f.state.grant='replacement';const reset=await f.read({cursor:next.cursor});assert.equal(reset.reset,true);assert.equal(reset.others,'0');
    if(mode==='room'){f.state.blocks='1';assert.equal((await f.read({cursor:reset.cursor})).reset,true);}
  });
  test(`${mode} activity denies withdrawn access and closed contexts before querying message metadata`,async()=>{
    for(const change of ['authorized','eligible','status',...(mode==='room'?['consent']:[])]){
      const f=fixture(mode);f.state[change]=change==='status'?'closed':change==='consent'?2:false;
      await assert.rejects(f.read({}),error=>[403,404,409].includes(error.statusCode));assert.equal(f.calls.some(c=>c.sql.includes('coalesce(max(position)')),false);assert.equal(f.calls.at(-1).sql,'rollback');
    }
  });
}
