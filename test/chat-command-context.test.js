import test from 'node:test';
import assert from 'node:assert/strict';
import {commandAuthorityEpoch,createChatCommandContextModule} from '../server/modules/chat-command-context.js';
const key=Buffer.alloc(32,31),account={accountId:'a',sessionId:'s',accountVersion:'1',sessionVersion:'2',assurance:'password',authorizationDate:'2026-10-12'};
const grant={assignmentId:'g',roleCode:'room_steward',permission:'rooms.manage',assignmentVersion:'3',roleVersion:'4',permissionVersion:'5'};
test('authority epochs bind account/session/current row versions/date/key and normalize grant ordering',()=>{
  const baseline=commandAuthorityEpoch(account,[grant],key);assert.match(baseline,/^[A-Za-z0-9_-]{43}$/);
  for(const changed of [{accountId:'b'},{sessionId:'other'},{accountVersion:'2'},{sessionVersion:'3'},{assurance:'mfa'},{authorizationDate:'2026-10-13'}])assert.notEqual(commandAuthorityEpoch({...account,...changed},[grant],key),baseline);
  for(const field of ['assignmentVersion','roleVersion','permissionVersion'])assert.notEqual(commandAuthorityEpoch(account,[{...grant,[field]:'6'}],key),baseline);
  assert.notEqual(commandAuthorityEpoch(account,[],key),baseline);assert.notEqual(commandAuthorityEpoch(account,[grant],Buffer.alloc(32,32)),baseline);
  const second={...grant,assignmentId:'g2',permission:'rooms.self'};assert.equal(commandAuthorityEpoch(account,[grant,second],key),commandAuthorityEpoch(account,[second,grant],key));
  assert.equal(commandAuthorityEpoch({...account,email:'not exposed'},[{...grant,scope:{secret:'not exposed'}}],key),baseline);
});
test('authority epochs reject insecure keys, ambiguous/malformed snapshots and unbounded grants',()=>{
  for(const value of [undefined,'secret',Buffer.alloc(31)])assert.throws(()=>commandAuthorityEpoch(account,[grant],value),{statusCode:503});
  for(const changed of [{accountId:'../other'},{sessionId:null},{accountVersion:'01'},{sessionVersion:'4294967296'},{assurance:'other'},{authorizationDate:0}])assert.throws(()=>commandAuthorityEpoch({...account,...changed},[grant],key),{statusCode:409});
  for(const rows of [null,Array(4097).fill(grant),[grant,grant],[{...grant,permission:'identity.admin'}],[{...grant,assignmentVersion:'-1'}]])assert.throws(()=>commandAuthorityEpoch(account,rows,key),{statusCode:409});
});
function fixture(){const calls=[],state={account:{...account},grants:[{...grant}],error:null};const db={release(){calls.push({sql:'release'});},async query(sql,params){calls.push({sql,params});if(state.error && sql.includes('from accounts'))throw {code:state.error};if(sql.includes('from accounts'))return {rows:state.account?[state.account]:[]};if(sql.includes('as "assignmentId"'))return {rows:state.grants};return {rows:[]};}};return {calls,state,module:createChatCommandContextModule({async connect(){return db;}},{dataEncryptionKey:key})};}
test('metadata context reads only fresh own identity and eligible row versions with no domain or audit writes',async()=>{
  const f=fixture(),actor={accountId:'a',sessionId:'s',permissions:['spoofed'],roles:[]},result=await f.module.chatCommandContext({},actor);assert.deepEqual(Object.keys(result).sort(),['accountId','epoch']);assert.equal(result.accountId,'a');assert.equal(result.epoch,commandAuthorityEpoch(account,[grant],key));
  assert.ok(f.calls.some(row=>row.sql==='set transaction isolation level repeatable read'));const roles=f.calls.find(row=>row.sql.includes('as "assignmentId"'));assert.equal(roles.params[0],'a');assert.deepEqual(roles.params[1],['messages.self','rooms.self','rooms.manage','rooms.approve','rooms.triage']);
  assert.match(roles.sql,/r.active/);assert.match(roles.sql,/ra.ended_at is null/);assert.match(roles.sql,/effective_from<=current_date/);assert.match(roles.sql,/effective_to>=current_date/);assert.match(roles.sql,/ra.scope='\{\}'::jsonb/);assert.match(roles.sql,/for share of ra,r,rp/);
  assert.equal(f.calls.some(row=>/insert|update|delete|envelope|private_messages|room_messages|audit_events/.test(row.sql)),false);assert.equal(f.calls.at(-2).sql,'commit');assert.equal(f.calls.at(-1).sql,'release');
  f.state.grants=[];assert.equal((await f.module.chatCommandContext({},actor)).epoch,commandAuthorityEpoch(account,[],key));
});
test('context refuses injected fields, stale/foreign identity, missing key and reconciliation conflicts without partial output',async()=>{
  for(const input of [null,[],{accountId:'b'},{epoch:'replay'},{permissions:['rooms.manage']}]){const f=fixture();await assert.rejects(f.module.chatCommandContext(input,{accountId:'a',sessionId:'s'}),{statusCode:400});assert.equal(f.calls.length,0);}
  const f=fixture();await assert.rejects(f.module.chatCommandContext({},{}),{statusCode:403});assert.equal(f.calls.length,0);
  for(const value of [null,{...account,accountId:'b'},{...account,sessionId:'other'}]){const f=fixture();f.state.account=value;await assert.rejects(f.module.chatCommandContext({},account),{statusCode:403});assert.equal(f.calls.at(-2).sql,'rollback');assert.equal(f.calls.some(row=>row.sql.includes('as "assignmentId"')),false);}
  for(const code of ['40001','40P01']){const f=fixture();f.state.error=code;await assert.rejects(f.module.chatCommandContext({},account),{statusCode:409});assert.equal(f.calls.at(-2).sql,'rollback');}
  const noKey=createChatCommandContextModule({connect(){assert.fail('No-key reads must not touch persistence');}});await assert.rejects(noKey.chatCommandContext({},account),{statusCode:503});
});
