import test from 'node:test';
import assert from 'node:assert/strict';
import {privateMessageInput,privateMessagePage,privatePosition,privatePairKey,createPrivateMessagesModule} from '../server/modules/private-messages.js';
import {createSeedData} from '../scripts/seed-data.js';
import {encryptSecret} from '../server/security.js';

test('private contact pair lock keys are order independent and unambiguous',()=>{
  assert.equal(privatePairKey('b','a'),'private-pair:["a","b"]');
  assert.equal(privatePairKey('a','b'),privatePairKey('b','a'));
  assert.notEqual(privatePairKey('a,b','c'),privatePairKey('a','b,c'));
  assert.equal(privatePairKey('a"','b'),`private-pair:${JSON.stringify(['a"','b'])}`);
});

test('fresh seeds grant private self authority to human institutional roles, not service or sharing-only roles',()=>{
  const seed=createSeedData();assert.ok(seed.permissions.includes('messages.self'));
  for(const role of ['applicant','student','lecturer','system_administrator','admissions_officer','academic_registrar'])assert.ok(seed.rolePermissions[role].includes('messages.self'));
  for(const role of ['auditor','lms_connector','report_scheduler','record_recipient'])assert.equal(seed.rolePermissions[role].includes('messages.self'),false);
});

test('private message inputs are bounded and cannot supply peer authority or content fields to other actions',()=>{
  assert.equal(privateMessageInput({body:'Hello',requestKey:'message_1'},'send').body,'Hello');
  assert.equal(privateMessageInput({email:'person@example.edu',requestKey:'request_1'},'invite').email,'person@example.edu');
  for(const [operation,input] of [['send',{body:' ',requestKey:'message_1'}],['send',{body:'x\0',requestKey:'message_1'}],['send',{body:'x'.repeat(4001),requestKey:'message_1'}],['send',{body:'x',requestKey:'short'}],['send',{body:'x',requestKey:'message_1',authorId:'other'}],['invite',{email:'a,b@example.edu',requestKey:'request_1'}],['preferences',{enabled:true,revision:-1}],['accept',{revision:0}],['block',{revision:0,blocked:'yes'}],['read',{through:'1',accountId:'other'}],['report',{reason:'x'.repeat(2001)}]])assert.throws(()=>privateMessageInput(input,operation),{statusCode:400});
});
test('message positions remain exact bigint strings and conversation pagination is bounded',()=>{
  assert.equal(privatePosition('9223372036854775807'),'9223372036854775807');
  assert.deepEqual(privateMessagePage({before:'9007199254740993'}),{offset:0,before:'9007199254740993'});
  for(const value of ['0','01','-1','1e3','9223372036854775808',1,'a'])assert.throws(()=>privatePosition(value,false),{statusCode:400});
  for(const input of [null,[],{offset:'1000001'},{offset:2},{peerId:'other'},{limit:'10000'}])assert.throws(()=>privateMessagePage(input),{statusCode:400});
});
test('private operations deny unrelated authorities before querying private records',async()=>{
  const module=createPrivateMessagesModule({query(){throw new Error('Private query must not run');},connect(){throw new Error('Private connection must not run');}});
  const actor={accountId:'admin',permissions:['audit.view','notification.send']};
  for(const work of [()=>module.getPrivateMessagePreferences(actor),()=>module.listPrivateConversations({},actor),()=>module.privateConversationSummary('thread',{},actor),()=>module.listPrivateMessages('thread',{},actor),()=>module.privateMessageChanges(actor),()=>module.sendPrivateMessage('thread',{body:'x',requestKey:'request_1'},actor)])await assert.rejects(work(),{statusCode:403});
});

test('private summary refuses supplied filters before querying participant metadata',async()=>{
  const module=createPrivateMessagesModule({connect(){throw new Error('Connection must not run');}});
  for(const input of [{offset:'0'},{before:'1'},{accountId:'other'},null,[]])await assert.rejects(module.privateConversationSummary('c',input,{accountId:'a',permissions:['messages.self']}),{statusCode:400});
});
test('unknown conversations fail before reading or decrypting private history',async()=>{
  const calls=[];const db={release(){},async query(sql){calls.push(sql);return {rows:sql.includes('join roles r')?[{id:'stranger'}]:[]};}};
  const module=createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,3)});
  await assert.rejects(module.listPrivateMessages('unknown',{}, {accountId:'stranger',permissions:['messages.self']}),{statusCode:404});
  assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('from private_messages m')),false);
});
test('private history refuses wrong keys and identity-swapped envelopes without partial content or cryptographic errors',async()=>{
  const original=Buffer.alloc(32,4),actor={accountId:'a',permissions:['messages.self']};
  for(const [key,content] of [[Buffer.alloc(32,5),{id:'m',conversationId:'c',authorId:'b',body:'PRIVATE'}],[original,{id:'other',conversationId:'c',authorId:'b',body:'PRIVATE'}],[original,{id:'m',conversationId:'other',authorId:'b',body:'PRIVATE'}],[original,{id:'m',conversationId:'c',authorId:'other',body:'PRIVATE'}]]) {
    const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql.includes('join roles r'))return {rows:[{id:'a'}]};if(sql.includes('select c.*'))return {rows:[{id:'c',account_a:'a',account_b:'b',status:'accepted',revision:2}]};if(sql.includes('select m.id'))return {rows:[{id:'m',position:'1',authorId:'b',envelope:encryptSecret(JSON.stringify(content),original),own:false}]};return {rows:[]};}};
    const module=createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:key});
    await assert.rejects(module.listPrivateMessages('c',{},actor),error=>error.statusCode===409 && error.message==='Private message content requires secure reconciliation.');
    assert.equal(calls.at(-1),'rollback');assert.equal(calls.some(sql=>sql.includes('insert into audit_events')),false);
  }
});

test('every private transaction denies a stale actor before domain reads, writes or replay lookup',async()=>{
  const actor={accountId:'a',permissions:['messages.self']};
  const operations=[['getPrivateMessagePreferences',[]],['listPrivateConversations',[{}]],['privateConversationSummary',['c',{}]],['listPrivateMessages',['c',{}]],['privateMessageChanges',[]],['setPrivateMessagePreferences',[{enabled:false,revision:1}]],['invitePrivateContact',[{email:'peer@example.edu',requestKey:'invite_key'}]],...['accept','decline','close'].map(action=>['changePrivateConversation',['c',action,{revision:1}]]),['sendPrivateMessage',['c',{body:'PRIVATE',requestKey:'message_key'}]],['markPrivateMessagesRead',['c',{through:'9007199254740993'}]],['setPrivateContactBlock',['c',{revision:0,blocked:true}]],['reportPrivateMessage',['c','m',{reason:'PRIVATE REASON'}]]];
  for(const [method,args] of operations){
    const calls=[],db={release(){},async query(sql,params){calls.push({sql,params});return {rows:[]};}},module=createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,6)});
    await assert.rejects(module[method](...args,actor),{statusCode:403,message:'Current private message authority is required.'});
    const fresh=calls.find(call=>call.sql.includes('join roles r'));assert.ok(fresh,method);assert.deepEqual(fresh.params,[['a'],'messages.self']);
    assert.match(fresh.sql,/r\.active/);assert.match(fresh.sql,/a\.status='active'/);assert.match(fresh.sql,/ra\.ended_at is null/);assert.match(fresh.sql,/for share of a,ra,r,rp/);
    assert.equal(calls.at(-1).sql,'rollback');assert.equal(calls.some(call=>/\b(?:from|into|update) private_/.test(call.sql)),false,method);
    if(['getPrivateMessagePreferences','listPrivateConversations','privateConversationSummary','listPrivateMessages','privateMessageChanges'].includes(method))assert.equal(calls.some(call=>call.params?.[0]==='private-command:a'),false);
    else assert.equal(calls[1].params[0],'private-command:a');
  }
});

test('private authority snapshot/deadlock errors roll back with a coarse conflict',async()=>{
  for(const code of ['40001','40P01']){
    const calls=[],db={release(){},async query(sql){calls.push(sql);if(sql.includes('join roles r'))throw Object.assign(new Error('PRIVATE DATABASE DETAIL'),{code});return {rows:[]};}},module=createPrivateMessagesModule({async connect(){return db;}});
    await assert.rejects(module.listPrivateConversations({},{accountId:'a',permissions:['messages.self']}),{statusCode:409,message:'Private message authority or records changed. Refresh before continuing.'});assert.equal(calls.at(-1),'rollback');
  }
});

test('duplicate qualifying actor grants cannot stand in for a missing peer authority',async()=>{
  const calls=[],db={release(){},async query(sql,params){calls.push(sql);if(sql.includes('join roles r'))return {rows:params[0].length===1?[{id:'a'}]:[{id:'a'},{id:'a'}]};if(sql.includes('select id from accounts where email'))return {rows:[{id:'b'}]};if(sql.includes('select account_id,enabled'))return {rows:[{account_id:'a',enabled:true},{account_id:'b',enabled:true}]};return {rows:[],rowCount:0};}};
  const module=createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,6)});
  await assert.rejects(module.invitePrivateContact({email:'peer@example.edu',requestKey:'invite_key'},{accountId:'a',permissions:['messages.self']}),{statusCode:404});
  assert.equal(calls.some(sql=>sql.includes('insert into private_conversations')),false);assert.equal(calls.at(-1),'rollback');
});

test('private quota windows and new counted records use wall time after command locks',async()=>{
  for(const method of ['sendPrivateMessage','invitePrivateContact']) {
    const calls=[],actor={accountId:'a',permissions:['messages.self']};
    const db={release(){},async query(sql,params){
      calls.push({sql,params});
      if(sql.includes('join roles r'))return {rows:params[0].map(id=>({id})),rowCount:params[0].length};
      if(sql.includes('select account_id,enabled'))return {rows:[{account_id:'a',enabled:true},{account_id:'b',enabled:true}]};
      if(sql.includes('select c.*'))return {rows:[{id:'c',account_a:'a',account_b:'b',status:'accepted'}]};
      if(sql==='select id from accounts where lower(btrim(email))=$1 limit 2')return {rows:[{id:'b'}]};
      if(sql.includes('count(*)::int as total'))return {rows:[{total:0}]};
      if(sql.includes('insert into private_messages('))return {rows:[{id:'m',position:'1'}]};
      return {rows:[],rowCount:0};
    }};
    const module=createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,7)});
    if(method==='sendPrivateMessage')await module[method]('c',{body:'Unchanged words',requestKey:'clock_message'},actor);
    else await module[method]({email:'peer@example.edu',requestKey:'clock_invite'},actor);
    const quota=calls.find(c=>c.sql.includes('count(*)::int as total'));
    assert.match(quota.sql,/created_at>clock_timestamp\(\)-interval/);
    const insert=calls.find(c=>c.sql.startsWith(`insert into ${method==='sendPrivateMessage'?'private_messages':'private_conversations'}(`));
    assert.match(insert.sql,/created_at\)/);
    assert.match(insert.sql,/clock_timestamp\(\)/);
    assert.ok(calls.findIndex(c=>c.params?.[0]==='private-command:a')<calls.indexOf(quota));
  }
});

test('private canonical recipients refuse initial ambiguity and post-pair identity reassignment before any write',async()=>{
  for(const lookups of [[[{id:'b'},{id:'c'}]],[[{id:'b'}],[{id:'c'}]],[[{id:'b'}],[{id:'b'},{id:'c'}]]]) {
    const calls=[];let index=0;
    const db={release(){},async query(sql,params){calls.push({sql,params});
      if(sql.includes('join roles r'))return {rows:params[0].map(id=>({id})),rowCount:params[0].length};
      if(sql==='select id from accounts where lower(btrim(email))=$1 limit 2')return {rows:lookups[index++]};
      if(sql.includes('select account_id,enabled'))return {rows:[{account_id:'a',enabled:true},{account_id:'b',enabled:true}]};
      return {rows:[],rowCount:0};
    }};
    await assert.rejects(createPrivateMessagesModule({async connect(){return db;}},{dataEncryptionKey:Buffer.alloc(32,7)}).invitePrivateContact({email:'peer@example.edu',requestKey:'canonical_peer'}, {accountId:'a',permissions:['messages.self']}),{statusCode:404});
    assert.equal(calls.at(-1).sql,'rollback');
    assert.ok(!calls.some(c=>c.sql.includes('insert into') || c.sql.includes('count(*)')));
    if(lookups.length===2)assert.ok(calls.findIndex(c=>c.params?.[0]==='private-pair:["a","b"]')<calls.findLastIndex(c=>c.sql==='select id from accounts where lower(btrim(email))=$1 limit 2'));
  }
});
