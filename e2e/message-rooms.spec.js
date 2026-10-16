import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';
import {loadConfig} from '../server/config.js';
import {encryptSecret} from '../server/security.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Room checks require an isolated database.');
test.use({actionTimeout:15000});
test('authenticated rooms require independent activation, explicit consent and bounded encrypted participant history',async({page,browser,request},info)=>{
  test.setTimeout(240000);
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL}),path='/api/message-rooms',stamp=`${info.project.name}.${Date.now()}`,errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let context;
  try {
    const owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const member=await account('Member'),reviewer=await account('Reviewer');
    await api('POST','/api/access/role-assignments',{accountId:reviewer.accountId,roleCode:'room_approver',scope:{},reason:'Isolated room reviewer appointment'},owner.token,201);
    const workspace=await api('GET',path,undefined,owner.token);
    await api('PUT',`${path}/preferences`,{revision:workspace.preferences.revision,enabled:true,requestKey:randomUUID()},owner.token);
    await api('PUT',`${path}/preferences`,{revision:0,enabled:true,requestKey:randomUUID()},member.token);
    await api('GET',`${path}?offset=0&offset=1`,undefined,owner.token,400);
    await api('GET',`${path}/changes?accountId=other`,undefined,owner.token,400);
    await api('POST',path,{title:'Unauthorized',purpose:'x',policyReference:'x',retentionRule:'x',requestKey:randomUUID()},member.token,403);
    const definition={title:`Institutional room ${stamp}`,purpose:'Isolated moderated discussion',policyReference:'ISOLATED-ROOM-POLICY',retentionRule:'Isolated verification records only',requestKey:randomUUID()};
    const room=await api('POST',path,definition,owner.token),base=`${path}/${room.id}`;
    await api('POST',`${base}/join`,{requestKey:randomUUID()},owner.token,409);
    await api('POST',`${base}/activate`,{revision:1,requestKey:randomUUID()},owner.token,403);
    const activation={revision:1,requestKey:randomUUID()};await api('POST',`${base}/activate`,activation,reviewer.token);await api('POST',`${base}/activate`,activation,reviewer.token);
    await api('GET',`${base}/messages`,undefined,reviewer.token,404);
    const joined=await api('POST',`${base}/join`,{requestKey:randomUUID()},owner.token);
    await api('POST',`${base}/members/${joined.id}/promote`,{revision:1,reason:'Self appointment',requestKey:randomUUID()},owner.token,403);
    const pre=await api('POST',`${base}/messages`,{body:'BEFORE MEMBERSHIP',requestKey:randomUUID()},owner.token);
    const invite={email:member.email,requestKey:randomUUID()},invites=await Promise.all([api('POST',`${base}/members`,invite,owner.token),api('POST',`${base}/members`,invite,owner.token)]);
    expect(invites[0]).toEqual(invites[1]);let membership=invites[0];
    await api('GET',`${base}/messages`,undefined,member.token,404);
    await api('POST',`${base}/members/${membership.id}/accept`,{revision:1,requestKey:randomUUID()},owner.token,404);
    membership=await api('POST',`${base}/members/${membership.id}/accept`,{revision:1,requestKey:randomUUID()},member.token);
    expect((await api('GET',`${base}/messages`,undefined,member.token)).items).toHaveLength(0);
    // Direct encrypted fixture tests PostgreSQL's microsecond boundary, not public backdating.
    const boundaryId=`rmsg_${randomUUID()}`;
    const boundaryEnvelope=encryptSecret(JSON.stringify({id:boundaryId,roomId:room.id,authorId:workspace.accountId,membershipId:joined.id,kind:'text',body:'ONE MICROSECOND BEFORE MEMBERSHIP'}),loadConfig().dataEncryptionKey);
    await db.query("insert into room_messages(id,room_id,author_id,membership_id,envelope,created_at) values($1,$2,$3,$4,$5,(select accepted_at-interval '1 microsecond' from message_room_memberships where id=$6))",[boundaryId,room.id,workspace.accountId,joined.id,boundaryEnvelope,membership.id]);
    expect((await api('GET',`${base}/messages`,undefined,member.token)).items).toHaveLength(0);
    expect((await api('GET',`${base}/messages`,undefined,owner.token)).items.map(row=>row.id)).toContain(pre.id);
    await api('POST',`${base}/messages`,{body:'NO MODERATOR',kind:'notice',requestKey:randomUUID()},member.token,403);
    const body=' \tENCRYPTED ROOM <img src=x onerror=alert(1)>\r\nSecond line  \n',input={body,kind:'action',requestKey:randomUUID()};
    const reviewerStamp=await api('GET',`${path}/changes`,undefined,reviewer.token);
    const sent=await Promise.all([api('POST',`${base}/messages`,input,member.token),api('POST',`${base}/messages`,input,member.token)]);expect(sent[0]).toEqual(sent[1]);
    expect(await api('GET',`${path}/changes`,undefined,reviewer.token)).toEqual(reviewerStamp);
    await api('POST',`${base}/messages`,{...input,body:'Altered'},member.token,409);
    await api('POST',`${base}/messages`,{...input,body:body.trim()},member.token,409);
    expect((await api('GET',`${base}/messages`,undefined,owner.token)).items.find(row=>row.id===sent[0].id).body).toBe(body);
    const envelope=(await db.query('select envelope from room_messages where id=$1',[sent[0].id])).rows[0].envelope;expect(envelope).not.toContain(body);
    membership=await api('POST',`${base}/members/${membership.id}/promote`,{revision:2,reason:'APPOINTMENT SECRET',requestKey:randomUUID()},owner.token);
    await api('POST',`${base}/messages`,{body:'Moderator notice',kind:'notice',requestKey:randomUUID()},member.token);
    await api('POST',`${base}/messages/${sent[0].id}/moderate`,{revision:0,hidden:true,reason:'MODERATION SECRET',requestKey:randomUUID()},member.token);
    expect((await api('GET',`${base}/messages`,undefined,owner.token)).items.find(row=>row.id===sent[0].id)).toMatchObject({hidden:true,body:null});
    await api('POST',`${base}/messages/${sent[0].id}/moderate`,{revision:1,hidden:false,reason:'Resolved',requestKey:randomUUID()},member.token);
    const privateOwner=await api('GET','/api/private-messages/preferences',undefined,owner.token);
    await api('PUT','/api/private-messages/preferences',{revision:privateOwner.revision,enabled:true},owner.token);
    await api('PUT','/api/private-messages/preferences',{revision:0,enabled:true},member.token);
    const contact=await api('POST','/api/private-messages/conversations',{email:member.email,requestKey:randomUUID()},owner.token);
    await api('POST',`/api/private-messages/conversations/${contact.id}/block`,{revision:0,blocked:true},member.token);
    expect((await api('GET',`${base}/messages`,undefined,owner.token)).items.map(row=>row.id)).not.toContain(sent[0].id);
    expect((await api('GET',`${base}/messages`,undefined,member.token)).items.map(row=>row.id)).not.toContain(pre.id);
    await api('POST',`${base}/messages/${sent[0].id}/moderate`,{revision:2,hidden:true,reason:'No block bypass',requestKey:randomUUID()},owner.token,404);
    await api('POST',`/api/private-messages/conversations/${contact.id}/block`,{revision:1,blocked:false},member.token);
    const evidence=JSON.stringify((await db.query("select reason,metadata from audit_events where subject_id=$1 and action like 'message_room.%'",[room.id])).rows);
    expect(evidence).not.toMatch(/ENCRYPTED ROOM|APPOINTMENT SECRET|MODERATION SECRET|@example.edu/);
    const reasons=JSON.stringify((await db.query('select reason_encrypted from message_room_membership_history where membership_id=$1',[membership.id])).rows);expect(reasons).not.toContain('APPOINTMENT SECRET');
    await page.goto('/#messages');await page.evaluate(session=>svuSession.set(session),owner);await page.goto('/#messages');
    await page.locator('[data-message-mode="rooms"]').click();await expect(page.locator(`[data-room-select="${room.id}"]`)).toBeVisible({timeout:15000});await page.locator(`[data-room-select="${room.id}"]`).click();
    await expect(page.locator('[data-room-message]').filter({hasText:body})).toHaveCount(1);await expect(page.locator('[data-room-message] img')).toHaveCount(0);
    // Drop the first committed HTTP reply; the in-memory retry keeps the original command.
    let dropped=false;
    await page.route(`**/api/message-rooms/${room.id}/messages`,async route=>{if(route.request().method()==='POST' && !dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    await page.locator('[data-room-form="send"] textarea').fill('COMMITTED REPLY RETRY');await page.getByRole('button',{name:'Send room message',exact:true}).click();
    await expect(page.locator('[data-room-retry]')).toBeVisible();await page.locator('[data-room-retry]').click();await expect(page.locator('[data-room-message]').filter({hasText:'COMMITTED REPLY RETRY'})).toHaveCount(1);
    await expect(page.locator('[data-room-retry]')).toHaveCount(0);
    expect((await db.query("select count(*)::int as total from room_messages where room_id=$1 and author_id=$2",[room.id,workspace.accountId])).rows[0].total).toBe(3);
    await page.unroute(`**/api/message-rooms/${room.id}/messages`);expect(dropped).toBe(true);
    context=await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name==='mobile'});
    const recipient=await context.newPage();recipient.on('pageerror',error=>errors.push(error.message));
    await recipient.goto('/#messages');await recipient.evaluate(session=>svuSession.set(session),member);await recipient.goto('/#messages');await recipient.locator('[data-message-mode="rooms"]').click();await expect(recipient.locator(`[data-room-select="${room.id}"]`)).toBeVisible({timeout:15000});await recipient.locator(`[data-room-select="${room.id}"]`).click();
    await recipient.locator('[data-room-form="send"] textarea').fill('REVOKED ROOM DRAFT');
    await page.bringToFront();
    await page.locator('[data-room-form="preferences"] [name="enabled"]').uncheck();
    await page.locator('.room-members > summary').click();
    const compose=page.locator('[data-room-form="send"] textarea');await compose.fill('UNSENT LIVE ROOM DRAFT');await compose.evaluate(node=>{node.focus();node.setSelectionRange(4,4);});
    await api('POST',`${base}/messages`,{body:'LIVE ROOM UPDATE',requestKey:randomUUID()},member.token);
    await expect(page.locator('[data-room-message]').filter({hasText:'LIVE ROOM UPDATE'})).toHaveCount(1,{timeout:15000});
    await expect(compose).toHaveValue('UNSENT LIVE ROOM DRAFT');await expect(compose).toBeFocused();expect(await compose.evaluate(node=>node.selectionStart)).toBe(4);
    await expect(page.locator('[data-room-form="preferences"] [name="enabled"]')).not.toBeChecked();await expect(page.locator('.room-members')).toHaveAttribute('open','');
    const live=(await api('GET',`${base}/messages`,undefined,owner.token)).items.find(row=>row.body==='LIVE ROOM UPDATE');
    await api('POST',`${base}/messages/${live.id}/moderate`,{revision:0,hidden:true,reason:'Live moderation',requestKey:randomUUID()},member.token);
    await expect(page.locator(`[data-room-message="${live.id}"]`)).toContainText('Hidden by moderation',{timeout:15000});await expect(compose).toHaveValue('UNSENT LIVE ROOM DRAFT');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('.private-thread').evaluate(node=>{document.activeElement?.blur();scrollTo({top:Math.max(0,scrollY+node.getBoundingClientRect().top-80),behavior:'instant'});});
    await page.screenshot({path:info.outputPath('message-rooms.png')});
    // Hold real moderator metadata across demotion; the stale roster request must fail without losing the room selection.
    await recipient.bringToFront();await expect(recipient.locator('.messages-page')).toHaveAttribute('aria-busy','false');
    let releaseMetadata,metadataHeld=false,rosterDenied=false;const metadataGate=new Promise(resolve=>{releaseMetadata=resolve;});
    const deniedResponse=response=>{if(response.url().endsWith(`${base}/members?offset=0`) && response.status()===403)rosterDenied=true;};recipient.on('response',deniedResponse);
    await recipient.route(`**${base}`,async route=>{const response=await route.fetch();expect((await response.json()).data.room.role).toBe('moderator');metadataHeld=true;await metadataGate;await route.fulfill({response});});
    try{
      await recipient.locator('[data-room-refresh]').click();await expect.poll(()=>metadataHeld).toBe(true);
      membership=await api('POST',`${base}/members/${membership.id}/demote`,{revision:membership.revision,reason:'End appointment',requestKey:randomUUID()},owner.token);
      releaseMetadata();await expect.poll(()=>rosterDenied).toBe(true);await recipient.unroute(`**${base}`);
      await expect(recipient.locator('[data-room-form="send"] textarea')).toHaveValue('',{timeout:15000});
    }finally{releaseMetadata();await recipient.unroute(`**${base}`);recipient.off('response',deniedResponse);}
    await api('POST',`${base}/messages/${sent[0].id}/moderate`,{revision:2,hidden:true,reason:'No authority',requestKey:randomUUID()},member.token,403);
    membership=await api('POST',`${base}/members/${membership.id}/ban`,{revision:membership.revision,reason:'BAN SECRET',requestKey:randomUUID()},owner.token);
    await recipient.bringToFront();await expect(recipient.locator('[data-room-message]')).toHaveCount(0,{timeout:15000});await expect(recipient.locator('[data-room-form="send"]')).toHaveCount(0);await expect(recipient.locator('#app')).not.toContainText('REVOKED ROOM DRAFT');
    await api('GET',`${base}/messages`,undefined,member.token,404);await api('POST',`${base}/members`,{email:member.email,requestKey:randomUUID()},owner.token,409);
    await api('POST',`${base}/members/${membership.id}/unban`,{revision:membership.revision,reason:'Reinvite explicitly',requestKey:randomUUID()},owner.token);
    const reinvited=await api('POST',`${base}/members`,{email:member.email,requestKey:randomUUID()},owner.token);
    await api('POST',`${base}/members/${reinvited.id}/accept`,{revision:1,requestKey:randomUUID()},member.token);
    await expect(recipient.locator('[data-room-form="send"] textarea')).toHaveValue('',{timeout:15000});
    expect((await api('GET',`${base}/messages`,undefined,member.token)).items).toHaveLength(0);
    await api('PUT',`${path}/preferences`,{revision:1,enabled:false,requestKey:randomUUID()},member.token);
    await api('GET',`${base}/messages`,undefined,member.token,404);
    await api('PUT',`${path}/preferences`,{revision:2,enabled:true,requestKey:randomUUID()},member.token);
    await api('POST',`${base}/messages`,{body:'Cannot revive',requestKey:randomUUID()},member.token,404);
    // Audit and receipt faults exercise the same production module against real transactions.
    const actor={accountId:workspace.accountId,roles:[{scope:{},permissions:['rooms.self','rooms.manage','rooms.approve']}]},options={dataEncryptionKey:loadConfig().dataEncryptionKey};
    for(const target of ['audit_events','room_message_receipts']) {
      let injected=false;const key=randomUUID(),before=await counts();
      const failingPool={async connect(){const client=await db.connect();return {release:()=>client.release(),async query(sql,values){if(sql.toLowerCase().includes(`insert into ${target}`)){injected=true;return client.query('select 1/0');}return client.query(sql,values);}};}};
      await expect(createMessageRoomsModule(failingPool,options).sendRoomMessage(room.id,{body:'ROLLBACK SECRET',requestKey:key},actor)).rejects.toThrow(/division by zero/);expect(injected).toBe(true);expect(await counts()).toEqual(before);
    }
    await api('POST',`${base}/close`,{revision:2,requestKey:randomUUID()},reviewer.token);
    await api('POST',`${base}/messages`,{body:'Closed',requestKey:randomUUID()},owner.token,409);
    expect((await api('GET',`${base}/messages`,undefined,owner.token)).items.length).toBeGreaterThan(0);
    await page.bringToFront();await expect(page.locator('[data-room-form="send"]')).toHaveCount(0,{timeout:15000});
    await page.evaluate(session=>svuSession.set(session),reviewer);await expect(page.locator('[data-room-message]')).toHaveCount(0);await expect(page.locator('#app')).not.toContainText('ENCRYPTED ROOM');
    expect(errors).toEqual([]);
  }finally{if(context)await context.close();await db.end();}
  async function counts(){return (await db.query("select (select count(*)::int from room_messages) as messages,(select count(*)::int from room_message_receipts) as receipts,(select count(*)::int from audit_events where action='message_room.sent') as audits")).rows[0];}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok())expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(name) {
    const email=`room.${name.toLowerCase()}.${stamp}@example.edu`,password='Room-Verification-2026!';
    await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Room ${name}`},null,202);
    let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const value=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(value.recipientEmail===email && value.variables?.activationToken)activation=value.variables.activationToken;}
    expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Room ${name}`});
    const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};
  }
});
