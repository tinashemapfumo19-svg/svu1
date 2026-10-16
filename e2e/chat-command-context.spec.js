import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {digestToken} from '../server/security.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Command context checks require isolated fixtures.');
test('command context is read-only, session-bound and detects retained-ID authority lifetimes without granting actions',async({request},info)=>{
  test.setTimeout(300000);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const stamp=`${info.project.name}.${Date.now()}`,path='/api/chat-command-context';let conversation,room;
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201),a=await account('owner'),b=await account('peer'),reviewer=await account('reviewer');
    await api('POST','/api/access/role-assignments',{accountId:a.accountId,roleCode:'room_steward',scope:{},reason:'Isolated command-context fixture'},admin.token,201);
    await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode:'room_approver',scope:{},reason:'Isolated command-context fixture'},admin.token,201);
    for(const who of [a,b])await api('PUT','/api/private-messages/preferences',{revision:0,enabled:true},who.token);
    conversation=(await api('POST','/api/private-messages/conversations',{email:b.email,requestKey:randomUUID()},a.token)).id;
    await api('POST',`/api/private-messages/conversations/${conversation}/accept`,{revision:1},b.token);
    await api('POST',`/api/private-messages/conversations/${conversation}/messages`,{body:'ISOLATED PRIVATE BODY MUST NOT ENTER CONTEXT',kind:'action',requestKey:randomUUID()},a.token);
    await api('PUT','/api/message-rooms/preferences',{revision:0,enabled:true,requestKey:randomUUID()},a.token);
    const definition={title:`Context ${stamp}`,purpose:'Isolated authority metadata proof',policyReference:'TEST-CONTEXT',retentionRule:'Isolated fixtures only'};
    room=(await api('POST','/api/message-rooms',{...definition,requestKey:randomUUID()},a.token)).id;
    await api('POST',`/api/message-rooms/${room}/activate`,{revision:1,requestKey:randomUUID()},reviewer.token);
    await api('POST',`/api/message-rooms/${room}/join`,{requestKey:randomUUID()},a.token);
    await api('POST',`/api/message-rooms/${room}/messages`,{body:'ISOLATED ROOM BODY MUST NOT ENTER CONTEXT',kind:'notice',requestKey:randomUUID()},a.token);
    const second=await api('POST','/api/identity/sessions',{email:a.email,password:a.password},null,201),before=await snapshot();
    let current=await context(a);expect(await context(a)).toEqual(current);expect((await context(b)).epoch).not.toBe(current.epoch);expect((await context({...a,token:second.token})).epoch).not.toBe(current.epoch);
    await api('GET',path,undefined,null,401);for(const query of [`accountId=${b.accountId}`,'epoch=old','epoch=a&epoch=b','permissions=rooms.manage'])await api('GET',`${path}?${query}`,undefined,a.token,400);
    await api('POST',path,{epoch:current.epoch,operation:'ban'},a.token,405);expect(await snapshot()).toBe(before);

    const assignment=(await db.query("select id from role_assignments where account_id=$1 and role_code='room_steward' and ended_at is null",[a.accountId])).rows[0].id;
    await cycle(()=>db.query("update role_assignments set ended_at=clock_timestamp(),ended_by=$2,end_reason='Isolated authority lifetime fixture' where id=$1",[assignment,reviewer.accountId]),()=>db.query('update role_assignments set ended_at=null,ended_by=null,end_reason=null where id=$1',[assignment]));
    await cycle(()=>db.query('update role_assignments set effective_from=current_date+1 where id=$1',[assignment]),()=>db.query('update role_assignments set effective_from=current_date where id=$1',[assignment]));
    await cycle(()=>db.query('update role_assignments set effective_to=current_date-1 where id=$1',[assignment]),()=>db.query('update role_assignments set effective_to=null where id=$1',[assignment]));
    await cycle(async()=>{
      await db.query('update role_assignments set scope=$2::jsonb where id=$1',[assignment,JSON.stringify({programmeCodes:['TEST-SCOPE']})]);
      const scoped=await context(a);expect(scoped.epoch).not.toBe(current.epoch);
      await api('POST','/api/message-rooms',{...definition,title:'DENIED SCOPED OPERATOR',requestKey:randomUUID()},a.token,403);
    },()=>db.query("update role_assignments set scope='{}'::jsonb where id=$1",[assignment]));
    const active=(await db.query("select active from roles where code='room_steward'")).rows[0].active;
    await cycle(()=>db.query("update roles set active=false where code='room_steward'"),()=>db.query("update roles set active=$1 where code='room_steward'",[active]));
    const permission=(await db.query("select created_at from role_permissions where role_code='room_steward' and permission_code='rooms.manage'")).rows[0];expect(permission).toBeTruthy();
    await cycle(()=>db.query("delete from role_permissions where role_code='room_steward' and permission_code='rooms.manage'"),()=>db.query("insert into role_permissions(role_code,permission_code,created_at) values('room_steward','rooms.manage',$1)",[permission.created_at]));
    await cycle(async()=>{await db.query("update accounts set status='disabled' where id=$1",[a.accountId]);await api('GET',path,undefined,a.token,401);},()=>db.query("update accounts set status='active' where id=$1",[a.accountId]));
    const session=(await db.query('select id,expires_at from sessions where account_id=$1 and token_digest=$2',[a.accountId,digestToken(a.token)])).rows[0];expect(session).toBeTruthy();
    await cycle(async()=>{await db.query("update sessions set status='revoked' where id=$1",[session.id]);await api('GET',path,undefined,a.token,401);},()=>db.query("update sessions set status='active' where id=$1",[session.id]));
    await cycle(async()=>{await db.query("update sessions set expires_at=now()-interval '1 second' where id=$1",[session.id]);await api('GET',path,undefined,a.token,401);},()=>db.query('update sessions set expires_at=$2 where id=$1',[session.id,session.expires_at]));
    await cycle(()=>db.query("update sessions set assurance='mfa' where id=$1",[session.id]),()=>db.query("update sessions set assurance='password' where id=$1",[session.id]));
    const grants=(await db.query('select id from role_assignments where account_id=$1 and ended_at is null',[a.accountId])).rows.map(row=>row.id);
    await cycle(async()=>{
      await db.query("update role_assignments set ended_at=clock_timestamp(),ended_by=$2,end_reason='Isolated authority lifetime fixture' where id=any($1::text[])",[grants,reviewer.accountId]);
      const empty=await context(a);expect(empty.epoch).not.toBe(current.epoch);
      await api('GET','/api/private-messages/conversations',undefined,a.token,403);await api('GET','/api/message-rooms',undefined,a.token,403);
    },()=>db.query('update role_assignments set ended_at=null,ended_by=null,end_reason=null where id=any($1::text[])',[grants]));
    expect(await snapshot()).toBe(before);
    async function cycle(change,restore){const previous=current;try{await change();}finally{await restore();}current=await context(a);expect(current.epoch).not.toBe(previous.epoch);expect(await context(a)).toEqual(current);expect(await snapshot()).toBe(before);}
  }finally{await db.end();}
  async function context(who){const value=await api('GET',path,undefined,who.token);expect(Object.keys(value).sort()).toEqual(['accountId','epoch']);expect(value.accountId).toBe(who.accountId);expect(value.epoch).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(JSON.stringify(value)).not.toContain('ISOLATED');return value;}
  async function snapshot(){const privateRows=(await db.query('select to_jsonb(m) as row from private_messages m where conversation_id=$1 order by position',[conversation])).rows,reads=(await db.query('select to_jsonb(r) as row from private_message_reads r where conversation_id=$1 order by account_id',[conversation])).rows,roomRows=(await db.query('select to_jsonb(m) as row from room_messages m where room_id=$1 order by position',[room])).rows;expect(privateRows).toHaveLength(1);expect(reads).toHaveLength(2);expect(roomRows).toHaveLength(1);const counts={};for(const table of ['private_conversations','private_contact_blocks','private_message_preferences','private_message_preference_history','private_message_reports','message_rooms','message_room_memberships','message_room_membership_history','room_message_preferences','room_message_preference_history','room_message_receipts','room_message_moderation','room_abuse_reports','room_abuse_events','audit_events','notifications'])counts[table]=(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;return createHash('sha256').update(JSON.stringify({privateRows,reads,roomRows,counts})).digest('hex');}
  async function api(method,url,data,token,status=200){const r=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.status(),`${method} ${url}`).toBe(status);if(url.startsWith(path))expect(r.headers()['cache-control']).toBe('no-store');return(await r.json()).data;}
  async function account(name){const email=`command.context.${name}.${stamp}@example.edu`,password='Command-Context-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:name},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:name});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,password,accountId:me.account.id};}
});
