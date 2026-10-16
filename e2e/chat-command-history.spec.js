import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Command recall checks require isolated fixtures.');
test.use({actionTimeout:15000});
test('room definition recall preserves drafts, frozen retries and fresh intent, and drops revoked or departed authority',async({page,request},info)=>{
  test.setTimeout(300000);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const stamp=`${info.project.name}.${Date.now()}`,errors=[],keys=[];let unblockAuthority;page.on('pageerror',error=>errors.push(error.message));
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const email=`command.history.${stamp}@example.edu`,password='Command-History-Verification-2026!';
    await api('POST','/api/admissions/registrations',{email,preferredName:'Recall owner',legalName:'Recall owner'},null,202);
    let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const mail=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(mail.recipientEmail===email && mail.variables?.activationToken)activation=mail.variables.activationToken;}
    expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:'Recall owner',legalName:'Recall owner'});
    const owner=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,owner.token),accountId=me.account.id;
    await api('POST','/api/access/role-assignments',{accountId,roleCode:'room_steward',scope:{},reason:'Isolated command recall fixture'},admin.token,201);
    await page.goto('/#messages');await page.evaluate(session=>svuSession.set(session),owner);await page.goto('/#messages');await page.locator('[data-message-mode="rooms"]').click();
    const form=page.locator('[data-room-form="create"]'),previous=form.locator('[data-command-history="previous"]'),next=form.locator('[data-command-history="next"]'),counter=form.locator('[data-command-history-position]');
    await expect(page.locator('.room-definition > summary')).toBeVisible({timeout:30000});await page.locator('.room-definition > summary').click();await expect(counter).toHaveText('0/0');
    const first={title:`Recall room ${stamp}`,purpose:'  Exact purpose\nsecond line  ',policyReference:'TEST-RECALL',retentionRule:'Isolated verification only'};
    await fill(first);
    let dropped=false,committedStatus;
    await page.route('**/api/message-rooms',async route=>{if(route.request().method()==='POST'){keys.push(route.request().postDataJSON().requestKey);if(!dropped){dropped=true;committedStatus=(await route.fetch()).status();await route.abort('failed');return;}}await route.continue();});
    await form.getByRole('button',{name:'Create draft',exact:true}).click();await expect(page.locator('[data-room-retry]')).toBeEnabled();expect(committedStatus).toBe(200);await expect(previous).toBeDisabled();expect(await count()).toBe(1);
    await page.locator('[data-room-retry]').click();await expect(page.locator('[data-room-retry]')).toHaveCount(0);await expect(counter).toHaveText('0/1');expect(await count()).toBe(1);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
    const unfinished={title:'UNFINISHED TITLE',purpose:'Unfinished purpose',policyReference:'UNFINISHED POLICY',retentionRule:'Unfinished retention'};await fill(unfinished);
    await form.locator('[name="purpose"]').evaluate(node=>{node.focus();node.setSelectionRange(2,8);});const before=await snapshot();
    await previous.click();await check(first);await expect(counter).toHaveText('1/1');expect(await snapshot()).toBe(before);expect(keys).toHaveLength(2);
    await next.click();await check(unfinished);await expect(form.locator('[name="purpose"]')).toBeFocused();expect(await form.locator('[name="purpose"]').evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([2,8]);expect(await snapshot()).toBe(before);
    let entered;const checking=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{unblockAuthority=resolve;});
    await page.route('**/api/chat-command-context',async route=>{entered();await gate;await route.continue();});
    await previous.click();await checking;await expect(form.getByRole('button',{name:'Create draft',exact:true})).toBeDisabled();await form.locator('[name="title"]').fill('EDITED WHILE CHECKING');
    await form.evaluate(node=>node.requestSubmit());expect(keys).toHaveLength(2);unblockAuthority();await expect(previous).toBeEnabled();await expect(counter).toHaveText('0/1');await expect(form.locator('[name="title"]')).toHaveValue('EDITED WHILE CHECKING');expect(await snapshot()).toBe(before);await page.unroute('**/api/chat-command-context');
    await fill(unfinished);await previous.click();await expect(counter).toHaveText('1/1');await check(first);const deliberate=`Deliberate recall ${stamp}`;await form.locator('[name="title"]').fill(deliberate);await form.getByRole('button',{name:'Create draft',exact:true}).click();await expect(counter).toHaveText('0/2');expect(await count()).toBe(2);expect(keys).toHaveLength(3);expect(keys[2]).not.toBe(keys[0]);expect((await db.query('select count(*)::int as n from message_rooms where created_by=$1 and title=$2',[accountId,deliberate])).rows[0].n).toBe(1);
    await fill(unfinished);const assignment=(await db.query("select id from role_assignments where account_id=$1 and role_code='room_steward' and ended_at is null",[accountId])).rows[0].id;
    const changesResponse=await request.get('/api/message-rooms/changes',{headers:{Authorization:`Bearer ${owner.token}`}});expect(changesResponse.status()).toBe(200);await page.route('**/api/message-rooms/changes',route=>route.fulfill({response:changesResponse}));const boundForm=await form.elementHandle();
    try{await db.query("update role_assignments set ended_at=clock_timestamp(),ended_by=$2,end_reason='Isolated retained-ID revocation' where id=$1",[assignment,accountId]);}
    finally{await db.query('update role_assignments set ended_at=null,ended_by=null,end_reason=null where id=$1',[assignment]);}
    const afterCycle=await snapshot();await previous.click();await expect(counter).toHaveText('0/0');expect(await boundForm.evaluate(node=>node.isConnected)).toBe(true);await check(unfinished);expect(await snapshot()).toBe(afterCycle);expect(keys).toHaveLength(3);
    await form.getByRole('button',{name:'Create draft',exact:true}).click();await expect(counter).toHaveText('0/1');expect(await count()).toBe(3);
    await page.unroute('**/api/message-rooms/changes');
    await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));await page.screenshot({path:info.outputPath('command-history.png')});
    await previous.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await page.screenshot({path:info.outputPath('command-history-controls.png')});
    await page.evaluate(()=>{location.hash='#home';});await expect(form).toHaveCount(0);await page.goto('/#messages');await page.locator('[data-message-mode="rooms"]').click();await expect(form).toHaveCount(1);await page.locator('.room-definition > summary').click();await expect(counter).toHaveText('0/0');await expect(form.locator('[name="title"]')).toHaveValue('');
    expect(await count()).toBe(3);expect(errors).toEqual([]);expect(dropped).toBe(true);
    async function fill(values){for(const [name,value] of Object.entries(values))await form.locator(`[name="${name}"]`).fill(value);}
    async function check(values){for(const [name,value] of Object.entries(values))await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);}
    async function count(){return(await db.query('select count(*)::int as n from message_rooms where created_by=$1',[accountId])).rows[0].n;}
    async function snapshot(){const counts={};for(const table of ['message_rooms','room_messages','room_message_receipts','message_room_memberships','audit_events','notifications'])counts[table]=(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;return JSON.stringify(counts);}
  }finally{unblockAuthority?.();await db.end();}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);return(await response.json()).data;}
});
