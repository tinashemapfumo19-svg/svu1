import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Tabs require an isolated database.');
test.use({actionTimeout:15000});
test('room tabs preserve isolated drafts and cursors while background access is freshly checked',async({page,request},info)=>{
  test.setTimeout(420000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),path='/api/message-rooms',stamp=`${info.project.name}.${Date.now()}`,errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201),owner=await account('steward'),member=await account('member'),reviewer=await account('reviewer'),outsider=await account('outsider');
    await api('POST','/api/access/role-assignments',{accountId:owner.accountId,roleCode:'room_steward',scope:{},reason:'Isolated room tab steward'},admin.token,201);
    for(const session of [member,reviewer])await api('POST','/api/access/role-assignments',{accountId:session.accountId,roleCode:'room_approver',scope:{},reason:'Isolated tab metadata verification'},admin.token,201);
    for(const session of [owner,member]){const pref=(await api('GET',path,undefined,session.token)).preferences;await api('PUT',`${path}/preferences`,{revision:pref.revision,enabled:true,requestKey:key()},session.token);}
    const a=await room('A'),b=await room('B');
    await api('GET',`${path}/${a.id}`,undefined,outsider.token,404);await api('GET',`${path}/${a.id}?offset=0`,undefined,member.token,400);await api('GET',`${path}/${a.id}?x=1&x=2`,undefined,member.token,400);
    expect((await api('GET',`${path}/${a.id}`,undefined,reviewer.token)).room.id).toBe(a.id);await api('GET',`${path}/${a.id}/messages`,undefined,reviewer.token,404);
    for(let i=0;i<29;i++)await api('POST',`${path}/${a.id}/messages`,{body:`Room A history ${i}`,requestKey:key()},owner.token);
    for(let i=0;i<2;i++)await api('POST',`${path}/${a.id}/messages`,{body:`Member history ${i}`,requestKey:key()},member.token);
    await api('POST',`${path}/${b.id}/messages`,{body:'ROOM B ORIGINAL',requestKey:key()},owner.token);
    const beforeMembers=(await pool.query('select count(*)::int as total from message_room_memberships')).rows[0].total;
    await page.goto('/');await page.evaluate(value=>window.svuSession.set(value),member);await page.goto('/#messages');await page.locator('[data-message-mode="rooms"]').click();await ready();
    await page.locator(`[data-room-select="${a.id}"]`).click();await ready();const compose=page.locator('[data-room-form="send"] textarea');await compose.fill('DRAFT A');
    await page.locator('[data-room-older]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(1);await expect(compose).toHaveValue('DRAFT A');
    const writes=[],watchWrite=req=>{if(req.url().includes(path) && req.method()!=='GET')writes.push(req.method());};page.on('request',watchWrite);
    const timestampSnapshot=await snapshot(a.id),times=page.locator('[data-room-message] time');
    await page.locator(`[data-room-background="${b.id}"]`).click();await ready();
    await expect(page.locator('[data-room-formatted]')).not.toBeChecked();await page.locator('[data-room-formatted]').check();await expect(page.locator('[data-room-smileys]')).not.toBeChecked();await page.locator('[data-room-smileys]').check();
    await page.locator('[data-message-minimize]').click();await expect(page.locator('[data-message-content]')).toBeHidden();await expect(compose).toBeHidden();
    const observed=[],summaries=[],watchCollapsed=async response=>{
      if(response.request().method()!=='GET' || response.status()!==200)return;
      if(response.url().endsWith(`${path}/changes`)){try{observed.push((await response.json()).data.stamp);}catch{}}
      if(response.url().endsWith(`${path}/${b.id}`))summaries.push(true);
    };page.on('response',watchCollapsed);
    try{
      await api('POST',`${path}/${b.id}/messages`,{body:'Collapsed workspace update',requestKey:key()},member.token);
      const changed=await api('GET',`${path}/changes`,undefined,member.token);
      await expect.poll(()=>observed.includes(changed.stamp) && summaries.length>0,{timeout:20000}).toBe(true);await ready();
      await expect(page.locator('[data-message-content]')).toBeHidden();await expect(page.locator('[data-message-minimize]')).toBeFocused();
    }finally{page.off('response',watchCollapsed);}
    await page.evaluate(()=>window.renderMessages());await expect(page.locator('[data-message-content]')).toBeHidden();await expect(page.locator('[data-message-minimize]')).toBeFocused();
    await page.locator('[data-message-minimize]').click();await expect(compose).toBeVisible();await expect(compose).toHaveValue('DRAFT A');await expect(page.locator('[data-room-message]')).toHaveCount(1);expect(await snapshot(a.id)).toBe(timestampSnapshot);expect(writes).toEqual([]);
    await expect(page.locator('[data-room-timestamps]')).toBeChecked();await expect(times.first()).toBeVisible();
    await page.locator('[data-room-timestamps]').uncheck();await expect(times.first()).toBeHidden();await expect(compose).toHaveValue('DRAFT A');
    await page.locator('[data-room-refresh]').click();await ready();await expect(page.locator('[data-room-timestamps]')).not.toBeChecked();await expect(times.first()).toBeHidden();
    await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();
    await expect(page.locator('[data-room-formatted]')).not.toBeChecked();await expect(page.locator('[data-room-smileys]')).not.toBeChecked();
    await expect(page.locator('[data-room-timestamps]')).toBeChecked();await expect(times.first()).toBeVisible();
    await page.locator(`[data-room-tab-select="${a.id}"]`).click();await ready();await expect(page.locator('[data-room-formatted]')).toBeChecked();await expect(page.locator('[data-room-smileys]')).toBeChecked();await expect(page.locator('[data-room-timestamps]')).not.toBeChecked();await expect(times.first()).toBeHidden();
    await page.locator('[data-room-timestamps]').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('room-timestamps-hidden.png')});
    await page.locator('[data-room-timestamps]').check();await expect(times.first()).toBeVisible();expect(await snapshot(a.id)).toBe(timestampSnapshot);expect(writes).toEqual([]);
    const minimize=page.locator('[data-room-minimize]'),content=page.locator('[data-room-content]');
    await expect(minimize).toHaveAttribute('aria-expanded','true');await minimize.focus();await minimize.press('Space');
    await expect(minimize).toHaveAttribute('aria-expanded','false');await expect(minimize).toHaveAccessibleName('Restore room');await expect(minimize).toBeFocused();await expect(content).toBeHidden();await expect(compose).toBeHidden();await expect(page.locator('[data-room-action="leave"]')).toBeHidden();
    await page.locator('[data-room-refresh]').click();await ready();await expect(content).toBeHidden();await expect(compose).toHaveValue('DRAFT A');await expect(page.locator('[data-room-message]')).toHaveCount(1);
    await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();await expect(content).toBeVisible();await expect(minimize).toHaveAttribute('aria-expanded','true');
    await page.locator(`[data-room-tab-select="${a.id}"]`).click();await ready();await expect(content).toBeHidden();await expect(minimize).toHaveAttribute('aria-expanded','false');
    await minimize.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('room-minimized.png')});
    await minimize.press('Enter');await expect(content).toBeVisible();await expect(minimize).toHaveAccessibleName('Minimize room');await expect(compose).toHaveValue('DRAFT A');await expect(page.locator('[data-room-message]')).toHaveCount(1);expect(await snapshot(a.id)).toBe(timestampSnapshot);expect(writes).toEqual([]);
    const untouched=await snapshot(a.id);await page.locator('[data-room-clear]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(0);await expect(compose).toHaveValue('DRAFT A');await page.locator('[data-room-refresh]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(0);await page.locator('[data-room-restore]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(1);expect(await snapshot(a.id)).toBe(untouched);expect(writes).toEqual([]);page.off('request',watchWrite);
    await expect(page.locator(`[data-room-tab-select="${a.id}"]`)).toHaveAttribute('aria-selected','true');await expect(compose).toHaveValue('DRAFT A');
    expect((await pool.query('select count(*)::int as total from message_room_memberships')).rows[0].total).toBe(beforeMembers);
    for(let i=0;i<26;i++)await api('POST',path,{title:`Metadata draft ${stamp}.${i}`,purpose:'Isolated paging evidence',policyReference:'TEST-TABS',retentionRule:'Isolated records only',requestKey:key()},owner.token);
    await page.locator('[data-room-refresh]').click();await ready();await expect(page.locator(`[data-room-select="${a.id}"]`)).toHaveCount(0);await expect(compose).toHaveValue('DRAFT A');
    await api('POST',`${path}/${b.id}/messages`,{body:'BACKGROUND UPDATE',requestKey:key()},member.token);
    await page.locator('[data-room-refresh]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(1);
    await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();await expect(compose).toHaveValue('');await expect(page.locator('[data-room-message]').filter({hasText:'BACKGROUND UPDATE'})).toHaveCount(1);await compose.fill('DRAFT B');
    await page.locator(`[data-room-tab-select="${a.id}"]`).click();await ready();await expect(compose).toHaveValue('DRAFT A');await expect(page.locator('[data-room-message]')).toHaveCount(1);await expect(page.locator('[data-room-message]')).toContainText('Room A history 0');
    await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();const secondUntouched=await snapshot(b.id);await page.locator('[data-room-clear]').click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(0);expect(await snapshot(b.id)).toBe(secondUntouched);await expect(compose).toHaveValue('DRAFT B');
    await api('POST',`${path}/${b.id}/messages`,{body:'Visible after local clear',requestKey:key()},member.token);await expect(page.locator('[data-room-message]')).toHaveCount(1,{timeout:20000});await expect(page.locator('.private-history')).toContainText('Visible after local clear');await expect(page.locator('.private-history')).not.toContainText('ROOM B ORIGINAL');
    await page.locator(`[data-room-tab-select="${a.id}"]`).click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(1);await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();await expect(page.locator('[data-room-message]')).toHaveCount(1);await page.locator('[data-room-restore]').click();await ready();await expect(page.locator('.private-history')).toContainText('ROOM B ORIGINAL');await page.locator('.private-thread').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('room-clear-display.png')});await page.locator(`[data-room-tab-select="${a.id}"]`).click();await ready();
    const summary=await api('GET',`${path}/${a.id}`,undefined,member.token);expect(summary.room.membershipId).toBe(a.membership.id);expect(JSON.stringify(summary)).not.toContain('Room A history');expect(summary).not.toHaveProperty('messages');
    await api('POST',`${path}/${b.id}/members/${b.membership.id}/ban`,{revision:2,reason:'Isolated background access ending',requestKey:key()},owner.token);
    await expect(page.locator(`[data-room-tab-select="${b.id}"]`)).toHaveCount(0,{timeout:20000});await expect(compose).toHaveValue('DRAFT A');
    await api('POST',`${path}/${b.id}/members/${b.membership.id}/unban`,{revision:3,reason:'New explicit acceptance',requestKey:key()},owner.token);
    const invited=await api('POST',`${path}/${b.id}/members`,{email:member.email,requestKey:key()},owner.token);await api('POST',`${path}/${b.id}/members/${invited.id}/accept`,{revision:1,requestKey:key()},member.token);
    await page.locator('[data-room-refresh]').click();await ready();await expect(page.locator(`[data-room-tab-select="${b.id}"]`)).toHaveCount(0);
    await page.locator('[data-room-page="25"]').click();await ready();await expect(compose).toHaveValue('DRAFT A');await page.locator(`[data-room-background="${b.id}"]`).click();await ready();await page.locator(`[data-room-tab-select="${b.id}"]`).click();await ready();await expect(compose).toHaveValue('');await expect(page.locator('[data-room-message]')).toHaveCount(0);
    await compose.fill('CLOSE DISCARD');page.once('dialog',dialog=>dialog.dismiss());await page.locator(`[data-room-tab-close="${b.id}"]`).click();await ready();await expect(compose).toHaveValue('CLOSE DISCARD');
    page.once('dialog',dialog=>dialog.accept());await page.locator(`[data-room-tab-close="${b.id}"]`).click();await ready();await expect(page.locator(`[data-room-tab-select="${b.id}"]`)).toHaveCount(0);await expect(compose).toHaveValue('DRAFT A');
    expect((await api('GET',`${path}/${b.id}`,undefined,member.token)).room).toMatchObject({membershipId:invited.id,membershipStatus:'accepted'});
    const extras=[];for(let i=0;i<7;i++)extras.push(await room(`Extra ${i} ${'W'.repeat(65)}`));
    await page.locator('[data-room-page="0"]').click();await ready();
    for(const extra of extras){await page.locator(`[data-room-background="${extra.id}"]`).click();await ready();}
    await expect(page.locator('.room-tabs [role="tab"]')).toHaveCount(8);await expect(compose).toHaveValue('DRAFT A');
    await page.locator('[data-room-page="25"]').click();await ready();await expect(page.locator(`[data-room-background="${b.id}"]`)).toBeDisabled();
    await page.locator(`[data-room-tab-close="${extras[0].id}"]`).click();await ready();await expect(page.locator(`[data-room-background="${b.id}"]`)).toBeEnabled();await page.locator(`[data-room-background="${b.id}"]`).click();await ready();await expect(page.locator('.room-tabs [role="tab"]')).toHaveCount(8);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.locator('.room-tabs').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('room-tabs.png')});
    await page.evaluate(()=>{window.oldRoomTab=document.querySelector('.room-tabs [role="tab"]');window.oldRoomMinimize=document.querySelector('[data-room-minimize]');});
    await page.evaluate(value=>window.svuSession.set(value),reviewer);await page.locator('[data-message-mode="rooms"]').click();await ready();await expect(page.locator('.room-tabs')).toHaveCount(0);await expect(page.locator('[data-room-form="send"]')).toHaveCount(0);await expect(page.locator('#app')).not.toContainText('DRAFT A');
    await page.evaluate(()=>{window.oldRoomTab.dispatchEvent(new Event('click',{bubbles:true}));window.oldRoomMinimize.dispatchEvent(new Event('click'));});await expect(page.locator('.room-tabs')).toHaveCount(0);expect(errors).toEqual([]);
    async function room(label){const row=await api('POST',path,{title:`Tabs ${label} ${stamp}`,purpose:'Isolated multi-room participation',policyReference:'TEST-TABS',retentionRule:'Isolated verification only',requestKey:key()},owner.token);await api('POST',`${path}/${row.id}/activate`,{revision:1,requestKey:key()},reviewer.token);await api('POST',`${path}/${row.id}/join`,{requestKey:key()},owner.token);const invite=await api('POST',`${path}/${row.id}/members`,{email:member.email,requestKey:key()},owner.token);const membership=await api('POST',`${path}/${row.id}/members/${invite.id}/accept`,{revision:1,requestKey:key()},member.token);return {...row,membership};}
  }finally{await pool.end();}
  async function snapshot(id){const result=await pool.query(`select jsonb_build_object('room',(select to_jsonb(r) from message_rooms r where r.id=$1),'messages',(select jsonb_agg(to_jsonb(m) order by m.position) from room_messages m where m.room_id=$1),'memberships',(select jsonb_agg(to_jsonb(m) order by m.id) from message_room_memberships m where m.room_id=$1)) as snapshot`,[id]);return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');}
  function key(){return randomUUID();}
  async function ready(){await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');}
  async function api(method,url,data,token,status=200){const r=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.status(),`${method} ${url}`).toBe(status);if(r.ok() && url.startsWith(path))expect(r.headers()['cache-control']).toContain('no-store');return (await r.json()).data;}
  async function account(name){const email=`tabs.${name}.${stamp}@example.edu`,password='Room-Tabs-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Tabs ${name}`},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Tabs ${name}`});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
});
