import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {loadConfig} from '../server/config.js';
import {createRepository} from '../server/repository.js';
import {createPrivateMessagesModule} from '../server/modules/private-messages.js';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Block fixtures require an isolated database.');

test('room invitations serialize bilateral first and retained blocks with stable identity and replay',async({request},info)=>{
  test.setTimeout(420000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),encryption={dataEncryptionKey:loadConfig().dataEncryptionKey};
  const rooms='/api/message-rooms',priv='/api/private-messages',suffix=`${info.project.name}.${Date.now()}`;
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},undefined,201);
    const a=await account('sender'),reviewer=await account('approver');
    for(const [who,roleCode] of [[a,'room_steward'],[reviewer,'room_approver']])await api('POST','/api/access/role-assignments',{accountId:who.accountId,roleCode,reason:'Isolated block ordering fixture'},admin.token,201);
    const actor=await principal(a),definitions=[];
    for(let i=0;i<2;i++){
      const room=await api('POST',rooms,{title:`Block ordering ${i} ${suffix}`,purpose:'Isolated native block ordering',policyReference:'ISOLATED-BLOCK',retentionRule:'Isolated fixtures only',requestKey:key()},a.token);
      await api('POST',`${rooms}/${room.id}/activate`,{revision:1,requestKey:key()},reviewer.token);
      await api('POST',`${rooms}/${room.id}/join`,{requestKey:key()},a.token);definitions.push(room.id);
    }
    // Begin with the recipient's first block; the red run must demonstrate the missing lock.
    const cases=[['recipient','blockFirst'],['sender','inviteFirst'],['sender','blockFirst'],['recipient','inviteFirst']];
    for(const [direction,first] of cases){
      const b=await account(`${direction}.${first}`),blocker=direction==='sender'?a:b;
      const contact=await api('POST',`${priv}/conversations`,{email:b.email,requestKey:key()},a.token);
      await api('POST',`${priv}/conversations/${contact.id}/accept`,{revision:1},b.token);
      const context={b,blocker,blockActor:await principal(blocker),contactId:contact.id};
      await race(context,first,0);await unblock(context,1);
      await race(context,first==='blockFirst'?'inviteFirst':'blockFirst',2);await unblock(context,3);
      if(first==='blockFirst'){
        const h=harness((sql)=>sql==='select id from accounts where lower(btrim(email))=$1 limit 2',true);
        const operation=createMessageRoomsModule(h.pool,encryption).inviteRoomMember(definitions[0],input(b),actor).then(result=>({result}),error=>({error}));
        try{
          await expect.poll(()=>h.entered,{timeout:15000}).toBe(true);
          await api('POST',blockPath(context),{revision:4,blocked:true},blocker.token);
          const before=await snapshot();h.resume();const completed=await operation;
          expect(completed.error).toMatchObject({statusCode:404});expect(completed.result).toBeUndefined();expect(await snapshot()).toBe(before);
        }finally{h.resume();await operation;}
        await unblock(context,5);
      }
    }
    const original=await account('mailbox.original'),replacement=await account('mailbox.replacement');
    const movedEmail=`moved.${suffix}@example.com`,replacementEmail=replacement.email,identityInput=input(original);
    const identity=harness(sql=>sql==='select id from accounts where lower(btrim(email))=$1 limit 2',true);
    const pending=createMessageRoomsModule(identity.pool,encryption).inviteRoomMember(definitions[0],identityInput,actor).then(result=>({result}),error=>({error}));
    try{
      await expect.poll(()=>identity.entered,{timeout:15000}).toBe(true);
      await pool.query('update accounts set email=$2 where id=$1',[original.accountId,movedEmail]);
      await pool.query('update accounts set email=$2 where id=$1',[replacement.accountId,original.email]);
      const before=await snapshot();identity.resume();const completed=await pending;
      expect(completed.error).toMatchObject({statusCode:404});expect(completed.result).toBeUndefined();expect(await snapshot()).toBe(before);
    }finally{
      identity.resume();await pending;
      await pool.query('update accounts set email=$2 where id=$1',[replacement.accountId,replacementEmail]);
      await pool.query('update accounts set email=$2 where id=$1',[original.accountId,original.email]);
    }
    for(const fragment of ['insert into audit_events','insert into room_message_receipts']){
      const data=input(original),before=await snapshot();let injected=false;
      const failing={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(sql.includes(fragment)){injected=true;return db.query('select 1/0');}return db.query(sql,params);}};}};
      await expect(createMessageRoomsModule(failing,encryption).inviteRoomMember(definitions[0],data,actor)).rejects.toMatchObject({code:'22012'});
      expect(injected).toBe(true);expect(await snapshot()).toBe(before);await pairReleased(a,original);
      const result=await api('POST',endpoint(definitions[0]),data,a.token),committed=await snapshot();
      expect(await api('POST',endpoint(definitions[0]),data,a.token)).toEqual(result);expect(await snapshot()).toBe(committed);
      await api('POST',`${endpoint(definitions[0])}/${result.id}/decline`,{revision:1,requestKey:key()},original.token);
    }

    async function race(context,order,revision){
      const {b,blocker,blockActor,contactId}=context,roomId=definitions[revision===0?0:1],data=input(b),beforeRooms=await snapshot(pool,true);
      if(order==='blockFirst'){
        const h=harness(sql=>sql.includes('insert into private_contact_blocks'),true);
        const block=createPrivateMessagesModule(h.pool,encryption).setPrivateContactBlock(contactId,{revision,blocked:true},blockActor).then(result=>({result}),error=>({error}));let invitation;
        try{
          await expect.poll(()=>h.entered,{timeout:15000}).toBe(true);let settled=false;
          invitation=raw('POST',endpoint(roomId),data,a.token).then(response=>{settled=true;return {response};},error=>{settled=true;return {error};});
          let blocked=false;
          await expect.poll(async()=>{blocked=(await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and $1::int=any(pg_blocking_pids(pid))",[h.pid])).rowCount>0;return blocked||settled;},{timeout:15000}).toBe(true);
          if(!blocked && settled){const completed=await invitation;if(completed.error)throw completed.error;expect(completed.response.status(),'A new invitation cannot precede the uncommitted first block').toBe(404);}
          expect(blocked,'Invitation must wait on the uncommitted native contact block, including its first row').toBe(true);
          h.resume();const completed=await block;if(completed.error)throw completed.error;expect(completed.result).toEqual({blocked:true,revision:revision+1});
          const denied=await invitation;if(denied.error)throw denied.error;await noData(denied.response,404);
          expect(await snapshot(pool,true)).toBe(beforeRooms);
        }finally{h.resume();await block;if(invitation)await invitation;}
      }else{
        const h=harness(sql=>sql.includes('where lower(btrim(a.email))=$1'),true);
        const invitation=createMessageRoomsModule(h.pool,encryption).inviteRoomMember(roomId,data,actor).then(result=>({result}),error=>({error}));let block;
        try{
          await expect.poll(()=>h.entered,{timeout:15000}).toBe(true);
          block=raw('POST',blockPath(context),{revision,blocked:true},blocker.token).then(response=>({response}),error=>({error}));
          await expect.poll(async()=>(await pool.query("select pid from pg_stat_activity where datname=current_database() and query like '%pg_advisory_xact_lock%' and $1::int=any(pg_blocking_pids(pid))",[h.pid])).rowCount,{timeout:15000,message:'Native block command must wait on invitation pair lock'}).toBeGreaterThan(0);
          h.resume();const completed=await invitation;if(completed.error)throw completed.error;const blocked=await block;if(blocked.error)throw blocked.error;
          expect(blocked.response.status()).toBe(200);expect((await blocked.response.json()).data).toEqual({blocked:true,revision:revision+1});
          const before=await snapshot();expect(await api('POST',endpoint(roomId),data,a.token)).toEqual(completed.result);
          await api('POST',endpoint(roomId),{...data,email:a.email},a.token,409);
          await api('POST',endpoint(roomId),input(b),a.token,404);expect(await snapshot()).toBe(before);
          expect((await pool.query('select status,accepted_at,consent_revision from message_room_memberships where id=$1',[completed.result.id])).rows[0]).toEqual({status:'pending',accepted_at:null,consent_revision:null});
          await api('POST',`${endpoint(roomId)}/${completed.result.id}/decline`,{revision:1,requestKey:key()},b.token);
        }finally{h.resume();await invitation;if(block)await block;}
      }
      const before=await snapshot();await api('POST',endpoint(roomId),input(b),a.token,404);expect(await snapshot()).toBe(before);await pairReleased(a,b);
    }
    async function pairReleased(left,right){const db=await pool.connect();try{await db.query('begin');expect((await db.query('select pg_try_advisory_xact_lock(hashtextextended($1,0)) as free',[`private-pair:${JSON.stringify([left.accountId,right.accountId].sort())}`])).rows[0].free).toBe(true);}finally{await db.query('rollback');db.release();}}
    async function unblock(context,revision){expect(await api('POST',blockPath(context),{revision,blocked:false},context.blocker.token)).toEqual({blocked:false,revision:revision+1});}
    function blockPath(context){return `${priv}/conversations/${context.contactId}/block`;}
    function endpoint(id){return `${rooms}/${id}/members`;}
    function input(who){return {email:who.email,requestKey:key()};}
    async function principal(who){return createRepository(pool,{mfaPolicy:'enrolled',...encryption}).authenticateSession(who.token);}
    function harness(match,after){
      let resume;const hold=new Promise(resolve=>{resume=resolve;});const h={resume,entered:false,pid:null,pool:{async connect(){const db=await pool.connect();h.pid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;return {release:()=>db.release(),async query(sql,params){if(!h.entered && match(sql,params) && !after){h.entered=true;await hold;}const result=await db.query(sql,params);if(!h.entered && match(sql,params) && after){h.entered=true;await hold;}return result;}};}}};return h;
    }
    async function account(name){
      const email=`block.${name}.${suffix}@example.com`.toLowerCase(),password='Room-Block-Password-2026!';
      const invite=await api('POST','/api/identity/invitations',{email,roleCode:'applicant'},admin.token,201);
      const account=await api('POST','/api/identity/activations',{token:invite.activationToken,password,preferredName:name,legalName:`Block ${name}`});
      const session=await api('POST','/api/identity/sessions',{email,password},undefined,201);
      await api('PUT',`${priv}/preferences`,{revision:0,enabled:true},session.token);
      await api('PUT',`${rooms}/preferences`,{revision:0,enabled:true,requestKey:key()},session.token);return {...session,email,accountId:account.id};
    }
    async function snapshot(db=pool,roomsOnly=false){
      const names=(await db.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r=>r.table_name).filter(n=>(roomsOnly?/^(message_room|room_)/:/^(private_|message_room|room_)/).test(n));const state={};
      for(const name of names){if(!/^[a-z_]+$/.test(name))throw Error('Invalid fixture table');state[name]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${name} t`)).rows[0].rows;}
      state.audit=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) as rows from audit_events t where (action like 'message_room.%' or ($1::boolean=false and action like 'private_message.%')) and action not like '%.read'",[roomsOnly])).rows[0].rows;
      return createHash('sha256').update(JSON.stringify(state)).digest('hex');
    }
  }finally{await pool.end();}
  function key(){return randomUUID();}
  function raw(method,url,data,token){return request.fetch(url,{method,data,timeout:40000,headers:token?{Authorization:`Bearer ${token}`}:{}});}
  async function noData(response,status){expect(response.status()).toBe(status);expect(response.headers()['cache-control']).toBe('no-store');const body=await response.json();expect(body.data).toBeUndefined();expect(JSON.stringify(body)).not.toMatch(/private_contact_blocks|role_assignments|envelope|permission_code/);}
  async function api(method,url,data,token,status=200){const response=await raw(method,url,data,token);if(status>=400){await noData(response,status);return;}expect(response.status(),`${method} ${url}`).toBe(status);expect(response.headers()['cache-control']).toBe('no-store');return (await response.json()).data;}
});
