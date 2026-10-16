import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const sources=['chat-command-history','room-invitation-history'].map(name=>readFileSync(new URL(`../src/${name}.js`,import.meta.url),'utf8'));
const own={roomId:'room_1',accountId:'account_1'},plain=value=>JSON.parse(JSON.stringify(value));
const metadata=email=>({accountId:'account_1',authorityEpoch:'a'.repeat(43),epoch:'b'.repeat(43),targetType:'invitation',targetId:createHash('sha256').update(email.toLowerCase()).digest('base64url'),operations:['invite']});
const draft=()=>({values:{email:'unfinished@'},focus:'email',start:2,end:6});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){const window={};for(const source of sources)runInNewContext(source,{window});const ui=window.roomInvitationHistory.create();let serial=0,live=true,unchanged=true,reader=async email=>metadata(email);const reads=[];
  const callbacks={request:async email=>{reads.push(email);return reader(email);},current:()=>live,unchanged:()=>unchanged};
  return {ui,reads,callbacks,set reader(value){reader=value;},set live(value){live=value;},set unchanged(value){unchanged=value;},attempt(email='PEER@example.edu',extra={}){return ui.attempt({...own,email,requestKey:`room_attempt_${String(++serial).padStart(16,'0')}`,...extra},callbacks);},key(descriptor=own){return ui.contacts(descriptor)[0]?.key;},navigate(key=this.key(),extra={}){return ui.navigate({...own,key,direction:'previous',draft:draft(),...extra},callbacks);}};
}

test('attempts retain exact mailbox text, deduplicate frozen keys and expose only owned recent contact choices',async()=>{
  const f=fixture(),requestKey='room_frozen_request_001';assert.equal(await f.attempt('PEER@example.edu',{requestKey}),true);assert.equal(await f.attempt('peer@example.edu',{requestKey}),false);
  assert.deepEqual(plain(f.ui.contacts(own)),[{key:f.key(),email:'PEER@example.edu'}]);assert.match(f.ui.controls({...own,key:f.key()}),/>0\/1</);assert.doesNotMatch(f.ui.controls({...own,key:f.key()}),/PEER|example|frozen|targetId|epoch/);
  const rows=f.ui.contacts(own);rows[0].email='mutated';assert.equal(f.ui.contacts(own)[0].email,'PEER@example.edu');
});

test('recall checks the selected recipient, preserves case variants and returns the full unfinished tail/caret without transport',async()=>{
  const f=fixture();await f.attempt('PEER@example.edu');await f.attempt('peer@example.edu');const key=f.key(),tail=draft();
  const previous=await f.navigate(key,{draft:tail});assert.deepEqual(Object.keys(previous).sort(),['end','focus','start','values']);assert.equal(previous.values.email,'peer@example.edu');
  assert.deepEqual(plain(await f.navigate(key,{direction:'next',draft:draft()})),tail);assert.equal(f.reads.at(-1),'peer@example.edu');assert.equal(f.reads.length,4);
  const other=await f.attempt('other@example.edu');assert.equal(other,true);assert.equal((await f.navigate(key)).values.email,'peer@example.edu');assert.equal(f.reads.at(-1),'peer@example.edu');
});

test('recipient epoch or opaque recipient changes invalidate old attempts and require a new deliberate attempt',async()=>{
  for(const field of ['epoch','targetId']){const f=fixture();await f.attempt();const key=f.key();f.reader=async email=>({...metadata(email),[field]:'c'.repeat(43)});
    assert.equal(await f.navigate(key),null);assert.equal(f.ui.contacts(own).length,0);assert.equal(await f.attempt(),true);assert.match(f.ui.controls({...own,key:f.key()}),/>0\/1</);
  }
  const f=fixture();await f.attempt();f.reader=async email=>({...metadata(email),epoch:'c'.repeat(43)});assert.equal(await f.attempt(),false);assert.equal(await f.attempt(),true);
});

test('new authority clears all histories and suppresses older in-flight responses from another room',async()=>{
  const f=fixture();await f.attempt();await f.attempt('second@example.edu',{roomId:'room_2'});const pending=deferred();f.reader=email=>email.toLowerCase()==='peer@example.edu'?pending.promise:Promise.resolve({...metadata(email),authorityEpoch:'c'.repeat(43),epoch:'d'.repeat(43)});
  const obsolete=f.attempt();assert.equal(await f.attempt('second@example.edu',{roomId:'room_2'}),false);assert.equal(await f.attempt('second@example.edu',{roomId:'room_2'}),true);
  pending.resolve(metadata('peer@example.edu'));assert.equal(await obsolete,false);assert.equal(f.ui.contacts(own).length,0);assert.equal(f.ui.contacts({...own,roomId:'room_2'}).length,1);
});

test('reset permits a replacement check while an old finalizer cannot unlock its new flight',async()=>{
  const f=fixture(),old=deferred(),replacement=deferred();let calls=0;f.reader=()=>++calls===1?old.promise:replacement.promise;const first=f.attempt();f.ui.reset();const second=f.attempt();old.resolve(metadata('peer@example.edu'));assert.equal(await first,false);
  assert.equal(await f.attempt(),false);assert.equal(calls,2);replacement.resolve(metadata('peer@example.edu'));assert.equal(await second,true);
});

test('detached contexts, async typing and draft mutations cannot record or restore intent',async()=>{
  const f=fixture();await f.attempt();const key=f.key(),pending=deferred();f.reader=()=>pending.promise;const restoring=f.navigate(key);f.unchanged=false;pending.resolve(metadata('peer@example.edu'));assert.equal(await restoring,null);assert.match(f.ui.controls({...own,key}),/>0\/1</);
  f.unchanged=true;const next=deferred();f.reader=()=>next.promise;const attempted=f.attempt();f.live=false;next.resolve(metadata('peer@example.edu'));assert.equal(await attempted,false);
  f.live=true;const changed=deferred(),tail=draft();f.reader=()=>changed.promise;const mutation=f.navigate(key,{draft:tail});tail.values.email='typed later';changed.resolve(metadata('peer@example.edu'));assert.equal(await mutation,null);
});

test('recipient denial clears only that contact; transient rate limits preserve memory but cannot restore it',async()=>{
  const f=fixture();await f.attempt();const key=f.key();await f.attempt('other@example.edu');f.reader=async()=>{throw Object.assign(new Error('unavailable'),{statusCode:404});};await assert.rejects(f.navigate(key),{statusCode:404});assert.deepEqual(plain(f.ui.contacts(own).map(row=>row.email)),['other@example.edu']);
  const other=f.key();f.reader=async()=>{throw Object.assign(new Error('rate limited'),{statusCode:429});};await assert.rejects(f.navigate(other),{statusCode:429});assert.match(f.ui.controls({...own,key:other}),/>0\/1</);
});

test('foreign and malformed metadata clear retained authority without returning private fields',async()=>{
  for(const change of [m=>({...m,accountId:'foreign'}),m=>({...m,targetType:'member'}),m=>({...m,targetId:'bad'}),m=>({...m,operations:['invite','invite']}),m=>({...m,body:'private'})]){
    const f=fixture();await f.attempt();const key=f.key();f.reader=async email=>change(metadata(email));await assert.rejects(f.navigate(key),/secure reconciliation/);assert.equal(f.ui.contacts(own).length,0);
  }
});

test('contact, room and account selectors cannot cross histories; clear removes remembered addresses too',async()=>{
  const f=fixture();await f.attempt();const key=f.key();assert.equal(await f.navigate(key,{roomId:'room_2'}),null);assert.equal(await f.navigate(key,{accountId:'foreign'}),null);assert.equal(f.ui.clear({...own,key,accountId:'foreign'}),false);assert.equal(f.ui.contacts(own).length,1);
  assert.equal(f.ui.clear({...own,key}),true);assert.equal(f.ui.contacts(own).length,0);await f.attempt();f.ui.forgetRoom('room_1');assert.equal(f.ui.contacts(own).length,0);
});

test('descriptors are copied before async reads and unsupported drafts/keys are rejected before metadata',async()=>{
  const f=fixture(),pending=deferred();f.reader=()=>pending.promise;const descriptor={...own,email:'PEER@example.edu',requestKey:'room_original_request_001'},recording=f.ui.attempt(descriptor,f.callbacks);descriptor.roomId='room_2';descriptor.email='changed@example.edu';descriptor.requestKey='room_changed_request_001';pending.resolve(metadata('peer@example.edu'));assert.equal(await recording,true);assert.equal(f.ui.contacts(own)[0].email,'PEER@example.edu');assert.equal(f.ui.contacts({...own,roomId:'room_2'}).length,0);
  const reads=f.reads.length;assert.equal(await f.attempt('peer@example.edu',{requestKey:'short'}),false);assert.equal(await f.navigate(f.key(),{draft:{...draft(),requestKey:'forbidden'}}),null);assert.equal(await f.navigate(f.key(),{draft:{...draft(),values:{email:'x'.repeat(255)}}}),null);assert.equal(f.reads.length,reads);
});

test('recipient slots and per-recipient attempts stay bounded without storage or native command transport',async()=>{
  const f=fixture();await f.attempt();const first=f.key();for(let i=0;i<33;i++)await f.attempt(`peer${i}@example.edu`);assert.ok(f.ui.contacts(own).length<=32);assert.equal(await f.navigate(first),null);
  for(let i=0;i<30;i++)await f.attempt('recent@example.edu');assert.match(f.ui.controls({...own,key:f.key()}),/>0\/25</);
  assert.doesNotMatch(sources[1],/\b(?:fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest|send|document|location)\b/);
});

test('invalid selectors and array drafts cannot read metadata or clear another contact',async()=>{
  const f=fixture();await f.attempt();const key=f.key(),reads=f.reads.length;assert.equal(f.ui.contacts().length,0);assert.equal(f.ui.clear({key}),false);f.ui.forgetRoom(null);
  const values=[];values.email='unfinished@';assert.equal(await f.navigate(key,{draft:{...draft(),values}}),null);assert.equal(f.reads.length,reads);assert.equal(f.ui.contacts(own).length,1);
});

test('a metadata flight disables recall and clearing without unlocking another attempt or losing history',async()=>{
  const f=fixture();await f.attempt();const key=f.key(),pending=deferred();f.reader=()=>pending.promise;const restoring=f.navigate(key);assert.equal(f.ui.busy(own),true);assert.equal((f.ui.controls({...own,key}).match(/disabled/g)||[]).length,3);assert.equal(f.ui.clear({...own,key}),false);assert.equal(await f.attempt(),false);
  pending.resolve(metadata('peer@example.edu'));assert.equal((await restoring).values.email,'PEER@example.edu');assert.equal(f.ui.busy(own),false);assert.match(f.ui.controls({...own,key}),/>1\/1</);
});

test('combined retained text eviction cannot be resurrected by the recent-contact index',async()=>{
  const f=fixture();let first;
  for(let i=0;i<32;i++){const email=String(i).padStart(2,'0')+'x'.repeat(236)+'@example.edu';for(let n=0;n<25;n++)await f.attempt(email);if(i===0)first=f.key();}
  assert.ok(f.ui.contacts(own).length<32);const reads=f.reads.length;assert.equal(await f.navigate(first),null);assert.equal(f.reads.length,reads);assert.match(f.ui.controls({...own,key:f.key()}),/>0\/25</);
});
