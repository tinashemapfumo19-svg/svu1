import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {loadConfig} from '../server/config.js';
import {createRepository} from '../server/repository.js';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Recipient fixtures require an isolated database.');

test('room invitations retain current recipient grants, order withdrawals and preserve bounded replay',async({request},info)=>{
  test.setTimeout(420000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),encryption={dataEncryptionKey:loadConfig().dataEncryptionKey};
  const rooms='/api/message-rooms',suffix=`${info.project.name}.${Date.now()}`;
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},undefined,201);
    const adminId=(await api('GET','/api/identity/me',undefined,admin.token)).account.id;
    const a=await account('sender'),b=await account('recipient'),c=await account('approver');
    await grant(a,'room_steward');await grant(c,'room_approver');
    const nativeApplicant=(await pool.query("select id from role_assignments where account_id=$1 and role_code='applicant' and ended_at is null",[b.accountId])).rows[0].id;
    const role=`rr_${randomUUID().replaceAll('-','')}`;
    await pool.query("insert into roles(code,name,risk,active) select $1,'Isolated room recipient',risk,true from roles where code='applicant'",[role]);
    await pool.query("insert into role_permissions(role_code,permission_code) values($1,'rooms.self')",[role]);
    let assignment=(await grant(b,role,{programmeCodes:['isolated-recipient']})).id;
    await api('POST',`/api/access/role-assignments/${nativeApplicant}/end`,{reason:'Only isolated recipient grant remains'},admin.token);
    const definition=await api('POST',rooms,{title:`Recipient authority ${suffix}`,purpose:'Isolated transaction authority verification',policyReference:'ISOLATED-RECIPIENT',retentionRule:'Isolated fixtures only',requestKey:key()},a.token);
    await api('POST',`${rooms}/${definition.id}/activate`,{revision:1,requestKey:key()},c.token);
    await api('POST',`${rooms}/${definition.id}/join`,{requestKey:key()},a.token);
    const endpoint=`${rooms}/${definition.id}/members`;
    const actor=await createRepository(pool,{mfaPolicy:'enrolled',...encryption}).authenticateSession(a.token);
    const invite=()=>({email:b.email,requestKey:key()});
    const roleOff={sql:'update roles set active=false where code=$1',params:[role],restore:()=>pool.query('update roles set active=true where code=$1',[role])};
    const permissionOff={sql:"delete from role_permissions where role_code=$1 and permission_code='rooms.self'",params:[role],restore:()=>pool.query("insert into role_permissions(role_code,permission_code) values($1,'rooms.self')",[role])};
    const accountOff={sql:"update accounts set status='disabled' where id=$1",params:[b.accountId],restore:()=>pool.query("update accounts set status='active' where id=$1",[b.accountId])};
    const preferenceOff={sql:`with changed as (update room_message_preferences set enabled=false,revision=revision+1,updated_at=clock_timestamp() where account_id=$1 returning account_id,revision,enabled)
      insert into room_message_preference_history(account_id,revision,enabled) select account_id,revision,enabled from changed returning account_id`,params:[b.accountId],restore:()=>choosePreference(true)};
    const ended=()=>({sql:'update role_assignments set ended_at=clock_timestamp(),ended_by=$2,end_reason=$3 where id=$1',params:[assignment,adminId,'Isolated recipient withdrawal'],restore:()=>pool.query('update role_assignments set ended_at=null,ended_by=null,end_reason=null where id=$1',[assignment])});
    for(const change of [roleOff,permissionOff,ended(),
      {sql:'update role_assignments set effective_from=current_date+1 where id=$1',params:[assignment],restore:()=>pool.query('update role_assignments set effective_from=current_date where id=$1',[assignment])},
      {sql:'update role_assignments set effective_from=current_date-2,effective_to=current_date-1 where id=$1',params:[assignment],restore:()=>pool.query('update role_assignments set effective_from=current_date,effective_to=null where id=$1',[assignment])},accountOff]){
      await pool.query(change.sql,change.params);
      try{const before=await snapshot();await api('POST',endpoint,invite(),a.token,404);expect(await snapshot()).toBe(before);}finally{await change.restore();}
    }
    await api('PUT',`${rooms}/preferences`,{revision:1,enabled:false,requestKey:key()},b.token);
    let before=await snapshot();await api('POST',endpoint,invite(),a.token,404);expect(await snapshot()).toBe(before);
    await api('PUT',`${rooms}/preferences`,{revision:2,enabled:true,requestKey:key()},b.token);
    for(const email of [a.email,`unknown.${suffix}@example.com`]){before=await snapshot();await api('POST',endpoint,{email,requestKey:key()},a.token,404);expect(await snapshot()).toBe(before);}
    await pool.query('update role_assignments set effective_from=current_date,effective_to=current_date where id=$1',[assignment]);
    const accepted=await api('POST',endpoint,invite(),a.token);
    const pending=(await pool.query('select status,accepted_at,consent_revision from message_room_memberships where id=$1',[accepted.id])).rows[0];
    expect(pending).toEqual({status:'pending',accepted_at:null,consent_revision:null});
    await api('POST',`${endpoint}/${accepted.id}/accept`,{revision:1,requestKey:key()},b.token);
    await api('POST',`${endpoint}/${accepted.id}/leave`,{revision:2,requestKey:key()},b.token);
    await pool.query('update role_assignments set effective_to=null where id=$1',[assignment]);

    // Every selected qualifying grant is held, not just an arbitrary first match.
    const second=(await grant(b,role)).id;
    for(const change of [roleOff,permissionOff,ended(),{...ended(),params:[second,adminId,'Second qualifying grant']},accountOff,preferenceOff]){
      const result=await heldRecipient(change);await decline(result);
    }
    await api('POST',`/api/access/role-assignments/${second}/end`,{reason:'Single grant for withdrawal-first checks'},admin.token);
    for(const change of [roleOff,permissionOff,ended(),accountOff,preferenceOff])await withdrawalFirst(change);
    await beforeLookup(async()=>api('POST',`/api/access/role-assignments/${assignment}/end`,{reason:'Native withdrawal before recipient lookup'},admin.token));
    assignment=(await grant(b,role)).id;
    await beforeLookup(()=>choosePreference(false));
    await choosePreference(true);

    // A failed audit or receipt aborts the real transaction, preserving every retained row.
    for(const fragment of ['insert into audit_events','insert into room_message_receipts']){
      const input=invite();before=await snapshot();let injected=false;
      const failing={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(sql.includes(fragment)){injected=true;return db.query('select 1/0');}return db.query(sql,params);}};}};
      await expect(createMessageRoomsModule(failing,encryption).inviteRoomMember(definition.id,input,actor)).rejects.toMatchObject({code:'22012'});
      expect(injected).toBe(true);expect(await snapshot()).toBe(before);
      const result=await api('POST',endpoint,input,a.token),committed=await snapshot();
      expect(await api('POST',endpoint,input,a.token)).toEqual(result);expect(await snapshot()).toBe(committed);await decline(result);
    }
    const retainedInput=invite(),retained=await api('POST',endpoint,retainedInput,a.token);
    await api('POST',`/api/access/role-assignments/${assignment}/end`,{reason:'Withdraw recipient after successful invitation'},admin.token);
    before=await snapshot();expect(await api('POST',endpoint,retainedInput,a.token)).toEqual(retained);
    await api('POST',endpoint,{...retainedInput,email:a.email},a.token,409);
    await api('POST',endpoint,invite(),a.token,404);
    await api('POST',`${endpoint}/${retained.id}/accept`,{revision:1,requestKey:key()},b.token,403);
    expect(await snapshot()).toBe(before);
    expect((await pool.query('select status,accepted_at,consent_revision from message_room_memberships where id=$1',[retained.id])).rows[0]).toEqual(pending);

    async function heldRecipient(change){
      const h=harness(true),ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let withdrawal;
      const operation=createMessageRoomsModule(h.pool,encryption).inviteRoomMember(definition.id,invite(),actor).then(result=>({result}),error=>({error}));
      try{
        await expect.poll(()=>h.entered,{timeout:15000}).toBe(true);await ending.query('begin');await ending.query("set local lock_timeout='20s'");
        const pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;
        withdrawal=ending.query(change.sql,change.params).then(result=>({changed:result.rowCount}),error=>({error}));
        await expect.poll(async()=>(await pool.query('select $2::int=any(pg_blocking_pids($1)) as waiting',[pid,h.pid])).rows[0].waiting,{timeout:10000,message:'Recipient withdrawal must wait on invitation grant locks'}).toBe(true);
        h.resume();const completed=await operation;if(completed.error)throw completed.error;expect(await withdrawal).toEqual({changed:1});return completed.result;
      }finally{h.resume();try{await operation;if(withdrawal)await withdrawal;await ending.query('rollback');}finally{await ending.end();}}
    }
    async function withdrawalFirst(change){
      const ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let operation;
      try{
        await ending.query('begin');await ending.query(change.sql,change.params);const expected=await snapshot(ending),pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;
        operation=raw('POST',endpoint,invite(),a.token).then(response=>({response}),error=>({error}));
        await expect.poll(async()=>(await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%where lower(btrim(a.email))=$1%' and $1::int=any(pg_blocking_pids(pid))",[pid])).rowCount,{timeout:10000,message:'Invitation must wait on recipient withdrawal'}).toBeGreaterThan(0);
        await ending.query('commit');const completed=await operation;if(completed.error)throw completed.error;await denied(completed.response,404);expect(await snapshot()).toBe(expected);
      }finally{try{await ending.query('rollback');if(operation)await operation;await change.restore();}finally{await ending.end();}}
    }
    async function beforeLookup(withdraw){
      const h=harness(false),operation=createMessageRoomsModule(h.pool,encryption).inviteRoomMember(definition.id,invite(),actor).then(result=>({result}),error=>({error}));
      try{await expect.poll(()=>h.entered,{timeout:15000}).toBe(true);await withdraw();const expected=await snapshot();h.resume();const completed=await operation;expect(completed.error).toMatchObject({statusCode:404});expect(completed.result).toBeUndefined();expect(await snapshot()).toBe(expected);}finally{h.resume();await operation;}
    }
    function harness(after){
      let resume;const paused=new Promise(resolve=>{resume=resolve;});const h={entered:false,pid:null,resume,pool:{async connect(){const db=await pool.connect();h.pid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;return {release:()=>db.release(),async query(sql,params){const recipient=sql.includes('where lower(btrim(a.email))=$1');if(recipient && !after){h.entered=true;await paused;}const result=await db.query(sql,params);if(recipient && after){h.entered=true;await paused;}return result;}};}}};return h;
    }
    async function decline(result){await api('POST',`${endpoint}/${result.id}/decline`,{revision:1,requestKey:key()},b.token);}
    async function choosePreference(enabled){const revision=(await pool.query('select revision from room_message_preferences where account_id=$1',[b.accountId])).rows[0].revision;return api('PUT',`${rooms}/preferences`,{revision,enabled,requestKey:key()},b.token);}
    async function grant(who,roleCode,scope={}){return api('POST','/api/access/role-assignments',{accountId:who.accountId,roleCode,scope,reason:'Isolated recipient authority fixture'},admin.token,201);}
    async function account(name){
      const email=`recipient.${name}.${suffix}@example.com`,password='Recipient-Authority-Password-2026!';
      const invitation=await api('POST','/api/identity/invitations',{email,roleCode:'applicant'},admin.token,201);
      const activated=await api('POST','/api/identity/activations',{token:invitation.activationToken,password,preferredName:name,legalName:`Recipient ${name}`});
      const session=await api('POST','/api/identity/sessions',{email,password},undefined,201);
      await api('PUT',`${rooms}/preferences`,{revision:0,enabled:true,requestKey:key()},session.token);return {...session,email,accountId:activated.id};
    }
    async function snapshot(db=pool){
      const names=(await db.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r=>r.table_name).filter(n=>/^(private_|message_room|room_)/.test(n));const state={};
      for(const name of names){if(!/^[a-z_]+$/.test(name))throw Error('Invalid fixture table');state[name]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${name} t`)).rows[0].rows;}
      state.audit=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as rows from audit_events t where (action like 'private_message.%' or action like 'message_room.%') and action not like '%.read'")).rows[0].rows;
      return createHash('sha256').update(JSON.stringify(state)).digest('hex');
    }
  }finally{await pool.end();}
  function key(){return randomUUID();}
  function raw(method,url,data,token){return request.fetch(url,{method,data,timeout:40000,headers:token?{Authorization:`Bearer ${token}`}:{}});}
  async function denied(response,status){expect(response.status()).toBe(status);expect(response.headers()['cache-control']).toBe('no-store');const body=await response.json();expect(body.data).toBeUndefined();expect(JSON.stringify(body)).not.toMatch(/role_assignments|envelope|permission_code/);}
  async function api(method,url,data,token,status=200){const response=await raw(method,url,data,token);if(status>=400){await denied(response,status);return;}expect(response.status(),`${method} ${url}`).toBe(status);expect(response.headers()['cache-control']).toBe('no-store');return (await response.json()).data;}
});
