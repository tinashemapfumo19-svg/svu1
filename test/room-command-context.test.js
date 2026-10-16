import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';
const key=Buffer.alloc(32,19),actor={accountId:'actor',sessionId:'session',roles:[{scope:{},permissions:['rooms.self','rooms.manage']}]};
const input={targetType:'member',targetId:'target'};
function fixture(){
  const calls=[],state={definition:{id:'room',status:'active',created_by:'actor'},own:{id:'own',role:'member',enabled:true,consent_revision:1,preference_revision:1},roomVersion:'3',ownVersions:{membership:'4',preference:'5'},target:{id:'target',account_id:'peer',status:'accepted',role:'member',revision:1,consent_revision:1,account_status:'active',command_version:'6',account_version:'7'},peerPreference:{enabled:true,revision:1,history_enabled:true,version:'11',history_version:'12'},moderation:null,blocks:[],fresh:true,error:null,
    account:{accountId:'actor',sessionId:'session',accountVersion:'1',sessionVersion:'2',assurance:'password',authorizationDate:'2026-10-12'},grants:[{assignmentId:'grant',roleCode:'room_steward',permission:'rooms.manage',assignmentVersion:'8',roleVersion:'9',permissionVersion:'10'}]};
  const db={release(){calls.push({sql:'release'});},async query(sql,params){calls.push({sql,params});if(state.error && sql.includes('from message_rooms'))throw {code:state.error};let rows=[];
    if(sql==='select * from message_rooms where id=$1')rows=state.definition?[state.definition]:[];
    else if(sql.includes('current_date::text as "authorizationDate"'))rows=state.account?[state.account]:[];
    else if(sql.includes('as "assignmentId"'))rows=state.grants;
    else if(sql.startsWith('select a.id from accounts'))rows=state.fresh?[{id:'actor'}]:[];
    else if(sql.startsWith('select m.*,p.enabled'))rows=state.own?[state.own]:[];
    else if(sql.startsWith('select xmin::text as version'))rows=[{version:state.roomVersion}];
    else if(sql.includes('as membership,p.xmin'))rows=state.ownVersions?[state.ownVersions]:[];
    else if(sql.includes('from room_message_preferences p join room_message_preference_history h'))rows=state.peerPreference?[state.peerPreference]:[];
    else if(sql.includes('from message_room_memberships m join accounts') || sql.includes('from room_messages m join accounts'))rows=state.target?[state.target]:[];
    else if(sql.includes('select revision,hidden from room_message_moderation'))rows=state.moderation?[state.moderation]:[];
    else if(sql.includes('from private_contact_blocks'))rows=state.blocks;
    return {rows,rowCount:rows.length};
  }};
  return {calls,state,module:createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:key})};
}
const read=f=>f.module.roomCommandContext('room',input,actor);

test('target metadata reuses fresh moderator/participant gates and exposes only scoped current controls',async()=>{
  const f=fixture(),result=await read(f);assert.deepEqual(Object.keys(result).sort(),['accountId','authorityEpoch','epoch','operations','revision','targetId','targetType']);assert.equal(result.accountId,'actor');assert.equal(result.targetId,'target');assert.equal(result.targetType,'member');assert.equal(result.revision,1);assert.deepEqual(result.operations,['remove','ban','promote']);assert.match(result.epoch,/^[A-Za-z0-9_-]{43}$/);assert.match(result.authorityEpoch,/^[A-Za-z0-9_-]{43}$/);assert.deepEqual(await read(f),result);
  assert.ok(f.calls.some(call=>call.sql==='set transaction isolation level repeatable read'));assert.ok(f.calls.some(call=>/for share of m,p/.test(call.sql)));assert.equal(f.calls.some(call=>/\b(insert|update|delete)\b|envelope|reason_encrypted|audit_events|notifications|room_message_receipts/.test(call.sql)),false);assert.equal(f.calls.at(-2).sql,'commit');assert.equal(f.calls.at(-1).sql,'release');
  f.state.target.role='moderator';assert.deepEqual((await read(f)).operations,['remove','ban','demote']);f.state.target.status='banned';assert.deepEqual((await read(f)).operations,['unban']);
});

test('room, actor membership/consent, target, peer, block and account/session grant versions bind epochs',async()=>{
  const baseline=(await read(fixture())).epoch;
  for(const change of [s=>s.roomVersion='13',s=>s.ownVersions.membership='13',s=>s.ownVersions.preference='13',s=>s.target.command_version='13',s=>s.target.account_version='13',s=>s.peerPreference.version='13',s=>s.peerPreference.history_version='13',s=>s.account.sessionVersion='13',s=>s.grants[0].assignmentVersion='13',s=>s.grants[0].roleVersion='13',s=>s.grants[0].permissionVersion='13',s=>s.blocks=[{account_id:'actor',peer_id:'peer',active:false,revision:'1',command_version:'13'}]]){
    const f=fixture();change(f.state);assert.notEqual((await read(f)).epoch,baseline);
  }
  const f=fixture();f.state.blocks=[{account_id:'actor',peer_id:'peer',active:false,revision:'1',command_version:'11'}];const previous=(await read(f)).epoch;f.state.blocks[0].command_version='12';assert.notEqual((await read(f)).epoch,previous);
});

test('appointment operations reflect the native active-account/current-consent guard without disabling removal or historical moderation',async()=>{
  for(const change of [s=>s.target.account_status='disabled',s=>s.peerPreference.enabled=false,s=>s.peerPreference.history_enabled=false,s=>s.peerPreference.revision=2,s=>s.peerPreference=null]){
    const f=fixture();change(f.state);assert.deepEqual((await read(f)).operations,['remove','ban']);assert.deepEqual((await f.module.roomCommandContext('room',{targetType:'message',targetId:'target'},actor)).operations,['hide']);
  }
  const f=fixture();f.state.peerPreference.version='01';await assert.rejects(read(f),{statusCode:409});f.state.peerPreference.version='11';f.state.own.role='invalid';await assert.rejects(read(f),{statusCode:409});
});

test('message context uses exact accepted-at/block visibility and latest revision without fetching bodies or moderation reasons',async()=>{
  const f=fixture(),query={targetType:'message',targetId:'target'},first=await f.module.roomCommandContext('room',query,actor);assert.deepEqual(first.operations,['hide']);assert.equal(first.revision,0);
  const visible=f.calls.find(call=>call.sql.includes('from room_messages m join accounts'));assert.deepEqual(visible.params,['room','actor','target','own']);assert.match(visible.sql,/created_at>=\(select accepted_at/);assert.match(visible.sql,/not exists\(select 1 from private_contact_blocks b where b.active/);assert.match(visible.sql,/for share of m,a/);
  f.state.moderation={hidden:true,revision:1};const hidden=await f.module.roomCommandContext('room',query,actor);assert.deepEqual(hidden.operations,['restore']);assert.equal(hidden.revision,1);assert.equal(hidden.epoch,first.epoch);
  f.state.moderation={hidden:false,revision:2};assert.deepEqual((await f.module.roomCommandContext('room',query,actor)).operations,['hide']);
  f.state.target=null;await assert.rejects(f.module.roomCommandContext('room',query,actor),{statusCode:404});assert.equal(f.calls.at(-2).sql,'rollback');
});

test('injected, stale, nonparticipant, nonmoderator, protected, retired and malformed targets fail closed',async()=>{
  for(const value of [null,[],{}, {...input,revision:1},{...input,epoch:'replay'},{...input,targetType:'invite'},{...input,targetId:'../peer'}]){const f=fixture();await assert.rejects(f.module.roomCommandContext('room',value,actor),{statusCode:400});assert.equal(f.calls.length,0);}
  for(const [change,statusCode] of [[s=>s.definition=null,404],[s=>s.definition.status='closed',409],[s=>s.fresh=false,403],[s=>s.own=null,404],[s=>s.own.enabled=false,404],[s=>s.own.preference_revision=2,404],[s=>s.definition.created_by='other',403],[s=>s.target=null,404],[s=>s.target.account_id='actor',403],[s=>s.target.status='removed',404],[s=>s.target.role='invalid',409],[s=>s.target.command_version='01',409],[s=>s.ownVersions=null,409],[s=>s.target.revision=-1,409],[s=>s.blocks=Array(3).fill({account_id:'actor',peer_id:'peer',active:false,revision:'1',command_version:'1'}),409]]){
    const f=fixture();change(f.state);await assert.rejects(read(f),{statusCode});assert.equal(f.calls.at(-2).sql,'rollback');
  }
  const f=fixture();f.state.definition.created_by='other';f.state.own.role='moderator';f.state.target.role='moderator';await assert.rejects(read(f),{statusCode:403});f.state.target.role='member';assert.deepEqual((await read(f)).operations,['remove','ban']);
  for(const code of ['40001','40P01']){const f=fixture();f.state.error=code;await assert.rejects(read(f),{statusCode:409});}
  const module=createMessageRoomsModule({connect(){assert.fail('Missing keys must not touch persistence');}});await assert.rejects(module.roomCommandContext('room',input,actor),{statusCode:503});
});
