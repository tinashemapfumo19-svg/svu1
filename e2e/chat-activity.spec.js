import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {encryptSecret} from '../server/security.js';
import {loadConfig} from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Activity checks require isolated fixtures.');
for(const mode of ['private','room'])test(`${mode} activity baselines classify live counts without bodies, read acknowledgements or stale access`,async({request},info)=>{
  test.setTimeout(240000);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const path=mode==='private'?'/api/private-messages':'/api/message-rooms',stamp=`${mode}.${info.project.name}.${Date.now()}`,privatePath='/api/private-messages';
  let id,other,membership,joined;
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201),a=await account('owner'),b=await account('peer'),c=await account('outsider');
    for(const who of [a,b,c])await api('PUT',`${privatePath}/preferences`,{revision:0,enabled:true},who.token);
    if(mode==='private'){id=await contact(a,b);other=await contact(a,c);}
    else{
      for(const [who,roleCode] of [[a,'room_steward'],[c,'room_approver']])await api('POST','/api/access/role-assignments',{accountId:who.accountId,roleCode,scope:{},reason:'Isolated activity fixture'},admin.token,201);
      for(const who of [a,b])await api('PUT',`${path}/preferences`,{revision:0,enabled:true,requestKey:randomUUID()},who.token);
      id=await room('Primary');other=await room('Other');
      await send(a,'BEFORE PEER CONSENT');
      const invite=await api('POST',`${path}/${id}/members`,{email:b.email,requestKey:randomUUID()},a.token);
      membership=await api('POST',`${path}/${id}/members/${invite.id}/accept`,{revision:1,requestKey:randomUUID()},b.token);
      const boundary=`rmsg_${randomUUID()}`,key=loadConfig().dataEncryptionKey;
      await db.query("insert into room_messages(id,room_id,author_id,membership_id,kind,envelope,created_at) values($1,$2,$3,$4,'text',$5,(select accepted_at-interval '1 microsecond' from message_room_memberships where id=$6))",[boundary,id,a.accountId,joined[id],encryptSecret(JSON.stringify({id:boundary,roomId:id,authorId:a.accountId,membershipId:joined[id],kind:'text',body:'PRE-CONSENT MICROSECOND'}),key),membership.id]);
      const empty=await activity(b);expect(empty.reset).toBe(true);expect(decode(empty.cursor).p).toBe('0');
    }
    const resource=mode==='private'?`${path}/conversations/${id}`:`${path}/${id}`;
    await send(a,'SENSITIVE ACTIVITY old owner');await send(b,'SENSITIVE ACTIVITY old peer','action');
    const initial=await activity(a),peerInitial=await activity(b);expect(initial).toMatchObject({reset:true,own:'0',others:'0'});expect(peerInitial).toMatchObject({reset:true,own:'0',others:'0'});
    expect(Object.keys(initial).sort()).toEqual(['cursor','others','own','reset']);expect(JSON.stringify(initial)).not.toContain('SENSITIVE ACTIVITY');
    await api('GET',`${resource}/activity`,undefined,null,401);await api('GET',`${resource}/activity`,undefined,admin.token,404);
    await api('GET',`${resource}/activity?cursor=${encodeURIComponent(initial.cursor)}`,undefined,b.token,400);
    await api('GET',`${mode==='private'?`${path}/conversations/${other}`:`${path}/${other}`}/activity?cursor=${encodeURIComponent(initial.cursor)}`,undefined,a.token,400);
    await api('GET',`${resource}/activity?cursor=invalid`,undefined,a.token,400);await api('GET',`${resource}/activity?after=1`,undefined,a.token,400);await api('GET',`${resource}/activity?cursor=&cursor=`,undefined,a.token,400);
    await api('POST',`${resource}/activity`,{},a.token,404);
    await send(a,'SENSITIVE ACTIVITY new text');await send(a,'SENSITIVE ACTIVITY own action','action');await send(b,'SENSITIVE ACTIVITY peer text');await send(b,'SENSITIVE ACTIVITY peer action','action');
    let hidden;
    if(mode==='room'){
      await send(a,'NOTICE DOES NOT ALERT','notice');hidden=await send(b,'HIDDEN DOES NOT ALERT');
      await api('POST',`${resource}/messages/${hidden.id}/moderate`,{revision:0,hidden:true,reason:'Isolated hidden classification',requestKey:randomUUID()},a.token);
    }
    const before=await snapshot();let next=await activity(a,initial.cursor);expect(next).toMatchObject({reset:false,own:'2',others:'2'});
    expect(await activity(b,peerInitial.cursor)).toMatchObject({reset:false,own:'2',others:'2'});
    expect(await activity(a,initial.cursor)).toMatchObject({reset:false,own:'2',others:'2'});
    expect(await activity(a,next.cursor)).toMatchObject({reset:false,own:'0',others:'0'});expect(await snapshot()).toBe(before);
    if(mode==='room'){
      await api('POST',`${resource}/messages/${hidden.id}/moderate`,{revision:1,hidden:false,reason:'Restore old evidence',requestKey:randomUUID()},a.token);
      const restored=await activity(a,next.cursor);expect(restored).toMatchObject({reset:false,own:'0',others:'0'});next=restored;
      const relation=await contact(a,b),block=`${privatePath}/conversations/${relation}/block`;
      for(const blocker of [a,b]){
        await api('POST',block,{revision:0,blocked:true},blocker.token);next=await activity(a,next.cursor);expect(next).toMatchObject({reset:true,own:'0',others:'0'});
        await send(b,'BLOCKED ACTIVITY');const blocked=await activity(a,next.cursor);expect(blocked.others).toBe('0');next=blocked;
        await api('POST',block,{revision:1,blocked:false},blocker.token);next=await activity(a,next.cursor);expect(next).toMatchObject({reset:true,own:'0',others:'0'});expect((await activity(a,next.cursor)).others).toBe('0');
      }
      const peerCursor=(await activity(b)).cursor;
      await api('PUT',`${path}/preferences`,{revision:1,enabled:false,requestKey:randomUUID()},b.token);await api('GET',`${resource}/activity`,undefined,b.token,404);
      await api('PUT',`${path}/preferences`,{revision:2,enabled:true,requestKey:randomUUID()},b.token);await api('GET',`${resource}/activity`,undefined,b.token,404);
      await api('POST',`${resource}/members/${membership.id}/leave`,{revision:2,requestKey:randomUUID()},b.token);
      const reinvite=await api('POST',`${resource}/members`,{email:b.email,requestKey:randomUUID()},a.token);await api('POST',`${resource}/members/${reinvite.id}/accept`,{revision:1,requestKey:randomUUID()},b.token);
      expect(await activity(b,peerCursor)).toMatchObject({reset:true,own:'0',others:'0'});
    }
    await api('POST','/api/access/role-assignments',{accountId:a.accountId,roleCode:'lecturer',scope:{},reason:'Isolated activity grant epoch'},admin.token,201);
    expect(await activity(a,next.cursor)).toMatchObject({reset:true,own:'0',others:'0'});
    const beforeRole=(await activity(b)).cursor;
    const originalRole=(await db.query("select active from roles where code='applicant'")).rows[0].active;
    try{await db.query("update roles set active=false where code='applicant'");if(mode==='room')await send(a,'WHILE PEER ROLE WAS DISABLED');await api('GET',`${resource}/activity`,undefined,b.token,403);}finally{await db.query("update roles set active=$1 where code='applicant'",[originalRole]);}
    expect(await activity(b,beforeRole)).toMatchObject({reset:true,own:'0',others:'0'});
    if(mode==='private'){
      await api('POST',`${resource}/close`,{revision:2},a.token);await api('GET',`${resource}/activity`,undefined,a.token,409);
    }else{
      await api('POST',`${resource}/close`,{revision:2,requestKey:randomUUID()},c.token);await api('GET',`${resource}/activity`,undefined,a.token,409);
    }
    async function room(label){const row=await api('POST',path,{title:`Activity ${label} ${stamp}`,purpose:'Isolated activity verification',policyReference:'TEST-ACTIVITY',retentionRule:'Isolated fixtures only',requestKey:randomUUID()},a.token);await api('POST',`${path}/${row.id}/activate`,{revision:1,requestKey:randomUUID()},c.token);const member=await api('POST',`${path}/${row.id}/join`,{requestKey:randomUUID()},a.token);(joined ||= {})[row.id]=member.id;return row.id;}
    async function send(who,body,kind='text'){return api('POST',`${mode==='private'?`${path}/conversations/${id}`:`${path}/${id}`}/messages`,{body,kind,requestKey:randomUUID()},who.token);}
    async function activity(who,cursor){return api('GET',`${mode==='private'?`${path}/conversations/${id}`:`${path}/${id}`}/activity${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,undefined,who.token);}
  }finally{await db.end();}
  function decode(cursor){return JSON.parse(Buffer.from(cursor.split('.')[0],'base64url').toString('utf8'));}
  async function snapshot(){const table=mode==='private'?'private_messages':'room_messages',column=mode==='private'?'conversation_id':'room_id';const rows=(await db.query(`select to_jsonb(m) as row from ${table} m where ${column}=$1 order by position`,[id])).rows;expect(rows.length).toBeGreaterThanOrEqual(2);const reads=mode==='private'?(await db.query('select to_jsonb(r) as row from private_message_reads r where conversation_id=$1 order by account_id',[id])).rows:[];if(mode==='private')expect(reads).toHaveLength(2);return createHash('sha256').update(JSON.stringify({rows,reads})).digest('hex');}
  async function contact(a,b){const row=await api('POST',`${privatePath}/conversations`,{email:b.email,requestKey:randomUUID()},a.token);await api('POST',`${privatePath}/conversations/${row.id}/accept`,{revision:1},b.token);return row.id;}
  async function api(method,url,data,token,status=200){const r=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.status(),`${method} ${url}`).toBe(status);if(url.startsWith(path))expect(r.headers()['cache-control']).toBe('no-store');return(await r.json()).data;}
  async function account(name){const email=`activity.${name}.${stamp}@example.edu`,password='Chat-Activity-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:name},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:name});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
});
