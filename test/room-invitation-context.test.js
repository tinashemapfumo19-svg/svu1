import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';
const key=Buffer.alloc(32,23),actor={accountId:'actor',sessionId:'session',roles:[{scope:{},permissions:['rooms.self','rooms.manage']}]};
function fixture(){
  const calls=[],state={definition:{id:'room',status:'active',created_by:'actor'},own:{id:'own',role:'member',enabled:true,consent_revision:1,preference_revision:1},fresh:true,matches:[{id:'peer'}],roomVersion:'3',ownVersions:{membership:'4',preference:'5'},
    grants:[{id:'peer',account_version:'6',enabled:true,revision:1,preference_version:'7',assignment_id:'peer_grant',assignment_version:'8',role_code:'applicant',role_version:'9',permission_version:'10'}],consent:{enabled:true,version:'11'},latest:null,blocks:[],count:0,error:null,
    account:{accountId:'actor',sessionId:'session',accountVersion:'1',sessionVersion:'2',assurance:'password',authorizationDate:'2026-10-12'},authorityGrants:[{assignmentId:'grant',roleCode:'room_steward',permission:'rooms.manage',assignmentVersion:'12',roleVersion:'13',permissionVersion:'14'}]};
  const db={release(){calls.push({sql:'release'});},async query(sql,params){calls.push({sql,params});let rows=[];
    if(sql==='select * from message_rooms where id=$1'){if(state.error)throw {code:state.error};rows=state.definition?[state.definition]:[];}
    else if(sql.includes('current_date::text as "authorizationDate"'))rows=state.account?[state.account]:[];
    else if(sql.includes('as "assignmentId"'))rows=state.authorityGrants;
    else if(sql.startsWith('select a.id from accounts'))rows=state.fresh?[{id:'actor'}]:[];
    else if(sql.startsWith('select m.*,p.enabled'))rows=state.own?[state.own]:[];
    else if(sql.startsWith('select id from accounts where'))rows=state.matches;
    else if(sql.includes('ra.id as assignment_id'))rows=state.grants;
    else if(sql.includes('from room_message_preference_history'))rows=state.consent?[state.consent]:[];
    else if(sql.startsWith('select id,status,role,revision'))rows=state.latest?[state.latest]:[];
    else if(sql.startsWith('select xmin::text as version'))rows=[{version:state.roomVersion}];
    else if(sql.includes('as membership,p.xmin'))rows=state.ownVersions?[state.ownVersions]:[];
    else if(sql.includes('from private_contact_blocks'))rows=state.blocks;
    else if(sql.startsWith('select count(*)'))rows=[{total:state.count}];
    return {rows,rowCount:rows.length};
  }};
  return {state,calls,module:createMessageRoomsModule({async connect(){return db;}},{dataEncryptionKey:key})};
}
const read=f=>f.module.roomInvitationCommandContext('room',{email:'PEER@example.edu'},actor);

test('invitation context is read-only, opaque and uses canonical unique eligible recipient checks',async()=>{
  const f=fixture(),result=await read(f);assert.deepEqual(Object.keys(result).sort(),['accountId','authorityEpoch','epoch','operations','targetId','targetType']);assert.equal(result.accountId,'actor');assert.equal(result.targetType,'invitation');assert.deepEqual(result.operations,['invite']);
  for(const field of ['authorityEpoch','epoch','targetId'])assert.match(result[field],/^[A-Za-z0-9_-]{43}$/);assert.deepEqual(await read(f),result);assert.doesNotMatch(JSON.stringify(result),/peer|example|assignment|preference/);
  const recipient=f.calls.find(call=>call.sql.includes('ra.id as assignment_id'));assert.deepEqual(recipient.params,['peer@example.edu','actor','peer']);assert.match(recipient.sql,/a.status='active' and p.enabled/);assert.match(recipient.sql,/not exists\(select 1 from accounts other/);assert.match(recipient.sql,/rp.permission_code='rooms.self'/);assert.match(recipient.sql,/private_contact_blocks b where b.active/);assert.match(recipient.sql,/limit 4097 for share of a,p,ra,r,rp/);
  assert.ok(f.calls.some(call=>call.sql==='set transaction isolation level repeatable read'));assert.equal(f.calls.some(call=>/\b(insert|update|delete)\b|envelope|reason_encrypted|audit_events|notifications|room_message_receipts/.test(call.sql)),false);assert.equal(f.calls.at(-2).sql,'commit');
});

test('recipient, room, own membership, consent, authority grants and retained inactive block lifetimes bind context',async()=>{
  const initial=await read(fixture());
  for(const change of [s=>s.roomVersion='15',s=>s.ownVersions.membership='15',s=>s.ownVersions.preference='15',s=>s.account.sessionVersion='15',s=>s.authorityGrants[0].assignmentVersion='15',s=>s.grants[0].account_version='15',s=>s.grants[0].preference_version='15',s=>s.grants[0].assignment_version='15',s=>s.grants[0].role_version='15',s=>s.grants[0].permission_version='15',s=>s.consent.version='15',s=>s.latest={id:'old',status:'left',role:'member',revision:3,version:'15'},s=>s.blocks=[{account_id:'peer',peer_id:'actor',active:false,revision:'2',version:'15'}]]){
    const f=fixture();change(f.state);const next=await read(f);assert.notEqual(next.epoch,initial.epoch);assert.equal(next.targetId,initial.targetId);
  }
  const f=fixture();f.state.matches=[{id:'other'}];f.state.grants[0].id='other';assert.notEqual((await read(f)).targetId,initial.targetId);
});

test('unavailable, self, ambiguous and already participating recipients are uniformly refused',async()=>{
  for(const change of [s=>s.matches=[],s=>s.matches=[{id:'peer'},{id:'other'}],s=>s.matches=[{id:'actor'}],s=>s.grants=[],s=>s.blocks=[{account_id:'actor',peer_id:'peer',active:true,revision:'1',version:'16'}],...['pending','accepted','banned'].map(status=>s=>s.latest={id:'existing',status,role:'member',revision:1,version:'16'})]){
    const f=fixture();change(f.state);await assert.rejects(read(f),{statusCode:404,message:'An available room contact was not found.'});assert.equal(f.calls.at(-2).sql,'rollback');
  }
});

test('invalid input, nonmoderators, stale consent, corrupt snapshots and daily limit cannot yield invitation authority',async()=>{
  for(const input of [null,[],{}, {email:'bad'}, {email:' peer@example.edu '}, {email:'peer@example.edu',requestKey:'replay'},{email:['peer@example.edu']}]){const f=fixture();await assert.rejects(f.module.roomInvitationCommandContext('room',input,actor),{statusCode:400});assert.equal(f.calls.length,0);}
  for(const [change,statusCode] of [[s=>s.definition=null,404],[s=>s.definition.status='closed',409],[s=>s.fresh=false,403],[s=>s.own=null,404],[s=>s.own.preference_revision=2,404],[s=>s.definition.created_by='other',403],[s=>s.roomVersion='01',409],[s=>s.own.role='bad',409],[s=>s.grants[0].revision=0,409],[s=>s.grants[0].id='foreign',409],[s=>s.grants.push({...s.grants[0]}),409],[s=>s.consent=null,409],[s=>s.consent.enabled=false,409],[s=>s.latest={id:'old',status:'unknown',role:'member',revision:3,version:'15'},409],[s=>s.blocks=[{account_id:'foreign',peer_id:'peer',active:false,revision:'1',version:'16'}],409],[s=>s.count=-1,409],[s=>s.count=50,429]]){
    const f=fixture();change(f.state);await assert.rejects(read(f),{statusCode});assert.equal(f.calls.at(-2).sql,'rollback');
  }
  const f=fixture();f.state.definition.created_by='other';f.state.own.role='moderator';assert.deepEqual((await read(f)).operations,['invite']);
  const module=createMessageRoomsModule({connect(){assert.fail('No persistence without a key');}});await assert.rejects(module.roomInvitationCommandContext('room',{email:'peer@example.edu'},actor),{statusCode:503});
});

test('repeatable-read and lock conflicts fail closed without a partial context',async()=>{
  for(const code of ['40001','40P01']){const f=fixture();f.state.error=code;await assert.rejects(read(f),{statusCode:409});assert.equal(f.calls.at(-2).sql,'rollback');}
});
