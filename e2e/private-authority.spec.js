import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {createPrivateMessagesModule} from '../server/modules/private-messages.js';
import {loadConfig} from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Authority fixtures require an isolated database.');

test('private transactions retain current authority, roll back audit faults and refuse in-flight withdrawn grants',async({request},info)=>{
  test.setTimeout(420000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),path='/api/private-messages',stamp=`${info.project.name}.${Date.now()}`,encryption={dataEncryptionKey:loadConfig().dataEncryptionKey};
  const module=createPrivateMessagesModule(pool,encryption),tables=['private_message_preferences','private_message_preference_history','private_conversations','private_messages','private_message_reads','private_contact_blocks','private_message_reports'];
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201),adminId=(await api('GET','/api/identity/me',undefined,admin.token)).account.id;
    const a=await account('actor'),b=await account('peer'),outgoing=await account('outgoing'),incoming=await account('incoming'),declining=await account('declining'),actor={accountId:a.accountId,permissions:['messages.self']};
    const base=await contact(a,b),message=await send(base,b,'PRIVATE AUTHORITY BODY'),acceptedRequest=await invite(incoming,a),declinedRequest=await invite(declining,a),inviteInput={email:outgoing.email,requestKey:key()};
    let invited;
    const operations=[
      ['getPrivateMessagePreferences',[]],['listPrivateConversations',[{}]],['privateConversationSummary',[base,{}]],['listPrivateMessages',[base,{}]],['privateMessageChanges',[]],
      ['sendPrivateMessage',[base,{body:'Held actor grant',requestKey:key()}]],['markPrivateMessagesRead',[base,{through:message.position}]],['reportPrivateMessage',[base,message.id,{reason:'Isolated authority report'}]],
      ['invitePrivateContact',[inviteInput]],['changePrivateConversation',[acceptedRequest,'accept',{revision:1}]],['changePrivateConversation',[declinedRequest,'decline',{revision:1}]]
    ];
    for(const [method,args] of operations){const result=await heldGrant(method,args,actor);if(method==='invitePrivateContact')invited=result.id;}
    await heldGrant('changePrivateConversation',[invited,'close',{revision:1}],actor);
    await heldGrant('setPrivateContactBlock',[base,{revision:0,blocked:true}],actor);
    await heldGrant('setPrivateMessagePreferences',[{revision:1,enabled:false}],actor);
    expect((await module.listPrivateMessages(base,{},actor)).items.some(row=>row.id===message.id)).toBe(true);
    await api('PUT',`${path}/preferences`,{revision:2,enabled:true},a.token);await api('POST',`${thread(base)}/block`,{revision:1,blocked:false},a.token);
    const faultBase=await contact(a,b),faultMessage=await send(faultBase,b,'AUDIT ROLLBACK BODY'),pending=await invite(incoming,a);
    const sendInput={body:'Stable audit-fault retry',requestKey:key()},faultInvite={email:outgoing.email,requestKey:key()};
    const faults=[['setPrivateMessagePreferences',[{revision:3,enabled:false}]],['invitePrivateContact',[faultInvite]],...['accept','decline'].map(operation=>['changePrivateConversation',[pending,operation,{revision:1}]]),['changePrivateConversation',[faultBase,'close',{revision:2}]],['sendPrivateMessage',[faultBase,sendInput]],['markPrivateMessagesRead',[faultBase,{through:faultMessage.position}]],['setPrivateContactBlock',[faultBase,{revision:2,blocked:true}]],['reportPrivateMessage',[faultBase,faultMessage.id,{reason:'Faulted receipt'}]]];
    for(const [method,args] of faults){
      const before=await snapshot();let injected=false;
      const failing={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(sql.includes('insert into audit_events')){injected=true;return db.query('select 1/0');}return db.query(sql,params);}};}};
      await expect(createPrivateMessagesModule(failing,encryption)[method](...args,actor)).rejects.toThrow(/division by zero/);expect(injected,method).toBe(true);expect(await snapshot(),method).toBe(before);
    }
    const retried=await api('POST',`${thread(faultBase)}/messages`,sendInput,a.token);expect(await api('POST',`${thread(faultBase)}/messages`,sendInput,a.token)).toEqual(retried);
    expect((await pool.query('select count(*)::int as count from private_messages where author_id=$1 and request_key=$2',[a.accountId,sendInput.requestKey])).rows[0].count).toBe(1);
    await preferenceOrdering();await api('PUT',`${path}/preferences`,{revision:4,enabled:true},a.token);
    const replayBase=await contact(a,b),replayInput={body:'Accepted replay fixture',requestKey:key()};await api('POST',`${thread(replayBase)}/messages`,replayInput,a.token);const retainedPeer=await send(replayBase,b,'Retained peer authority fixture');
    const firstRole=await assignment(a),beforeRead=await snapshot();
    await withdrawHttp('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[firstRole,adminId,'Isolated HTTP read withdrawal'],'GET',`${thread(faultBase)}/messages`,undefined,a,409);
    expect(await snapshot()).toBe(beforeRead);await api('GET',`${path}/changes`,undefined,a.token,403);
    for(const [method,args] of [...operations,...faults])await expect(module[method](...args,actor)).rejects.toMatchObject({statusCode:403});expect(await snapshot()).toBe(beforeRead);
    await restoreRole(a);
    const secondRole=await assignment(a),beforeReplay=await snapshot();
    await withdrawHttp('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[secondRole,adminId,'Isolated HTTP replay withdrawal'],'POST',`${thread(replayBase)}/messages`,replayInput,a,403);
    expect(await snapshot()).toBe(beforeReplay);await expect(module.sendPrivateMessage(replayBase,replayInput,actor)).rejects.toMatchObject({statusCode:403});await restoreRole(a);
    const beforeInviteReplay=await snapshot();await withdrawHttp('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[await assignment(a),adminId,'Isolated invitation replay withdrawal'],'POST',`${path}/conversations`,inviteInput,a,403);expect(await snapshot()).toBe(beforeInviteReplay);await restoreRole(a);
    // A committed native administrative withdrawal before the transaction's fresh query also wins.
    await beforeFresh('listPrivateMessages',[faultBase,{}],actor);await restoreRole(a);
    await beforeFresh('sendPrivateMessage',[replayBase,replayInput],actor);await restoreRole(a);
    const beforeDisabledActor=await snapshot();await withdrawHttp("update accounts set status='disabled' where id=$1",[a.accountId],'GET',`${thread(faultBase)}/messages`,undefined,a,409);expect(await snapshot()).toBe(beforeDisabledActor);
    await expect(module.listPrivateMessages(faultBase,{},actor)).rejects.toMatchObject({statusCode:403});await pool.query("update accounts set status='active' where id=$1",[a.accountId]);
    const peerRole=`pm_${randomUUID().replaceAll('-','')}`;
    await pool.query("insert into roles(code,name,risk,active) select $1,'Isolated private peer role',risk,true from roles where code='applicant'",[peerRole]);
    await pool.query('insert into role_permissions(role_code,permission_code) values($1,$2)',[peerRole,'messages.self']);
    await api('POST','/api/access/role-assignments',{accountId:b.accountId,roleCode:peerRole,scope:{},reason:'Isolated peer definition fixture'},admin.token,201);
    await api('POST',`/api/access/role-assignments/${await assignment(b)}/end`,{reason:'Only isolated custom peer grant remains'},admin.token);
    await api('POST',`${thread(replayBase)}/messages`,{body:'Active custom peer',requestKey:key()},a.token);
    for(const [sql,params,restore] of [
      ['update roles set active=false where code=$1',[peerRole],()=>pool.query('update roles set active=true where code=$1',[peerRole])],
      ['delete from role_permissions where role_code=$1 and permission_code=$2',[peerRole,'messages.self'],()=>pool.query('insert into role_permissions(role_code,permission_code) values($1,$2)',[peerRole,'messages.self'])],
      ["update accounts set status='disabled' where id=$1",[b.accountId],()=>pool.query("update accounts set status='active' where id=$1",[b.accountId])]
    ]){
      const before=await snapshot();await withdrawHttp(sql,params,'POST',`${thread(replayBase)}/messages`,{body:'Must not survive peer withdrawal',requestKey:key()},a,409);expect(await snapshot()).toBe(before);
      expect((await module.listPrivateMessages(replayBase,{},actor)).items.some(row=>row.id===retainedPeer.id)).toBe(true);await restore();
    }
    async function preferenceOrdering(){
      let resume,entered=false,operationPid;const paused=new Promise(resolve=>{resume=resolve;});let operation,preference;
      const delaying={async connect(){const db=await pool.connect();operationPid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;return {release:()=>db.release(),async query(sql,params){const result=await db.query(sql,params);if(isFresh(sql,params,actor)){entered=true;await paused;}return result;}};}};
      try{
        operation=createPrivateMessagesModule(delaying,encryption).sendPrivateMessage(faultBase,{body:'Actor send before preference',requestKey:key()},actor).then(result=>({result}),error=>({error}));await expect.poll(()=>entered,{timeout:15000}).toBe(true);
        preference=request.put(`${path}/preferences`,{data:{revision:3,enabled:false},timeout:40000,headers:{Authorization:`Bearer ${a.token}`}}).then(response=>({response}),error=>({error}));
        await expect.poll(async()=>(await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and $1::int=any(pg_blocking_pids(pid))",[operationPid])).rowCount,{timeout:15000,message:'Preferences must wait at the actor command lock, not an account upgrade'}).toBeGreaterThan(0);
        const peerMessage=await send(faultBase,b,'Peer remains concurrent while preference waits');resume();const sent=await operation;if(sent.error)throw sent.error;const saved=await preference;if(saved.error)throw saved.error;expect(saved.response.status()).toBe(200);expect((await saved.response.json()).data).toMatchObject({enabled:false,revision:4});
        const history=await module.listPrivateMessages(faultBase,{},actor);expect(history.status).toBe('closed');expect(history.items.some(row=>row.id===sent.result.id)).toBe(true);expect(history.items.some(row=>row.id===peerMessage.id)).toBe(true);
      }finally{resume();if(operation)await operation;if(preference)await preference;}
    }
    async function beforeFresh(method,args,who){
      let resume,entered=false;const paused=new Promise(resolve=>{resume=resolve;});
      const delaying={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(isFresh(sql,params,who)){entered=true;await paused;}return db.query(sql,params);}};}};
      const operation=createPrivateMessagesModule(delaying,encryption)[method](...args,who).then(result=>({result}),error=>({error}));
      try{await expect.poll(()=>entered,{timeout:15000}).toBe(true);await api('POST',`/api/access/role-assignments/${await assignment(a)}/end`,{reason:'Native withdrawal before fresh private query'},admin.token);resume();const completed=await operation;expect(completed.error).toMatchObject({statusCode:403});expect(completed.result).toBeUndefined();}finally{resume();await operation;}
    }
    async function heldGrant(method,args,who){
      let resume,entered=false,operationPid;const paused=new Promise(resolve=>{resume=resolve;});
      const delaying={async connect(){const db=await pool.connect();operationPid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;return {release:()=>db.release(),async query(sql,params){const result=await db.query(sql,params);if(isFresh(sql,params,who)){entered=true;await paused;}return result;}};}};
      const ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let operation,roleEnd;
      try{
        operation=createPrivateMessagesModule(delaying,encryption)[method](...args,who).then(result=>({result}),error=>({error}));await expect.poll(()=>entered,{timeout:15000}).toBe(true);
        await ending.query('begin');await ending.query("set local lock_timeout='20s'");const pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;
        roleEnd=ending.query('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[await assignment(a),adminId,'Controlled private grant-lock verification']).then(result=>({ended:result.rowCount}),error=>({error}));
        await expect.poll(async()=>(await pool.query('select $2::int=any(pg_blocking_pids($1)) as waiting',[pid,operationPid])).rows[0].waiting,{timeout:15000,message:`${method} must retain its current grant`}).toBe(true);
        resume();const completed=await operation;if(completed.error)throw completed.error;expect(await roleEnd).toEqual({ended:1});return completed.result;
      }finally{resume();try{if(operation)await operation;if(roleEnd)await roleEnd;await ending.query('rollback');}finally{await ending.end();}}
    }
    async function withdrawHttp(sql,params,method,url,data,who,status){
      const ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let pending;
      try{
        await ending.query('begin');const pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;await ending.query(sql,params);
        pending=request.fetch(url,{method,data,timeout:40000,headers:{Authorization:`Bearer ${who.token}`}}).then(response=>({response}),error=>({error}));
        await expect.poll(async()=>(await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%where a.id=any($1::text[])%' and $1::int=any(pg_blocking_pids(pid))",[pid])).rowCount,{timeout:15000,message:`${method} private authority must wait on the withdrawing transaction`}).toBeGreaterThan(0);
        await ending.query('commit');const completed=await pending;if(completed.error)throw completed.error;expect(completed.response.status()).toBe(status);expect(completed.response.headers()['cache-control']).toContain('no-store');
        const body=await completed.response.json();expect(body).not.toHaveProperty('data');expect(JSON.stringify(body)).not.toMatch(/PRIVATE AUTHORITY BODY|AUDIT ROLLBACK BODY|envelope|through_position|role_assignments/);
      }finally{try{await ending.query('rollback');if(pending)await pending;}finally{await ending.end();}}
    }
    async function restoreRole(who){await api('POST','/api/access/role-assignments',{accountId:who.accountId,roleCode:'applicant',scope:{},reason:'Restore isolated actor for another authority proof'},admin.token,201);}
  }finally{await pool.end();}
  function isFresh(sql,params,who){return sql.includes('join roles r') && params?.[0]?.length===1 && params[0][0]===who.accountId;}
  function key(){return randomUUID();}
  function thread(id){return `${path}/conversations/${id}`;}
  async function assignment(who){return (await pool.query("select id from role_assignments where account_id=$1 and role_code='applicant' and ended_at is null order by id",[who.accountId])).rows[0].id;}
  async function invite(sender,recipient){return (await api('POST',`${path}/conversations`,{email:recipient.email,requestKey:key()},sender.token)).id;}
  async function contact(sender,recipient){const id=await invite(sender,recipient);await api('POST',`${thread(id)}/accept`,{revision:1},recipient.token);return id;}
  async function send(id,who,body){return api('POST',`${thread(id)}/messages`,{body,requestKey:key()},who.token);}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(url.startsWith(path))expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(name){const email=`authority.${name}.${stamp}@example.edu`,password='Private-Authority-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Authority ${name}`},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const value=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(value.recipientEmail===email && value.variables?.activationToken)activation=value.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Authority ${name}`});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);await api('PUT',`${path}/preferences`,{revision:0,enabled:true},session.token);return {...session,email,accountId:me.account.id};}
  async function snapshot(){const rows={};for(const table of tables)rows[table]=(await pool.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows;rows.audit=(await pool.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as rows from audit_events t where action like 'private_message.%' and action not in ('private_message.history.read','private_message.summary.read')")).rows[0].rows;return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
});
