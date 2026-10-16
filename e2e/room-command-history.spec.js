import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Target recall requires isolated fixtures.');
test.use({actionTimeout:15000});
test('assigned moderator recalls member and message intent with fresh revisions and independent frozen retries',async({page,request},info)=>{
  test.setTimeout(300000);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const stamp=`${info.project.name}.${Date.now()}`,path='/api/message-rooms',errors=[];let releaseContext;page.on('pageerror',error=>errors.push(error.message));
  try{
    const owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const moderator=await account('Moderator'),peer=await account('Peer'),approver=await account('Approver');
    await api('POST','/api/access/role-assignments',{accountId:approver.accountId,roleCode:'room_approver',scope:{},reason:'Isolated recall fixture'},owner.token,201);
    const workspace=await api('GET',path,undefined,owner.token);
    await api('PUT',`${path}/preferences`,{revision:workspace.preferences.revision,enabled:true,requestKey:randomUUID()},owner.token);
    for(const actor of [moderator,peer])await api('PUT',`${path}/preferences`,{revision:0,enabled:true,requestKey:randomUUID()},actor.token);
    const room=await api('POST',path,{title:`Target recall ${stamp}`,purpose:'Isolated recall verification',policyReference:'TEST-RECALL',retentionRule:'Isolated records only',requestKey:randomUUID()},owner.token),base=`${path}/${room.id}`;
    await api('POST',`${base}/activate`,{revision:1,requestKey:randomUUID()},approver.token);
    await api('POST',`${base}/join`,{requestKey:randomUUID()},owner.token);
    const memberships={};
    for(const actor of [moderator,peer]){
      const invited=await api('POST',`${base}/members`,{email:actor.email,requestKey:randomUUID()},owner.token);
      memberships[actor.accountId]=await api('POST',`${base}/members/${invited.id}/accept`,{revision:1,requestKey:randomUUID()},actor.token);
    }
    await api('POST',`${base}/members/${memberships[moderator.accountId].id}/promote`,{revision:2,reason:'Assigned moderator fixture',requestKey:randomUUID()},owner.token);
    const message=await api('POST',`${base}/messages`,{body:'Target recall message',requestKey:randomUUID()},peer.token);
    expect((await api('GET',path,undefined,moderator.token)).capabilities.manage).toBe(false);
    await page.goto('/#messages');await page.evaluate(session=>svuSession.set(session),moderator);await page.goto('/#messages');await page.locator('[data-message-mode="rooms"]').click();
    await page.locator(`[data-room-select="${room.id}"]`).click();await expect(page.locator('.room-members > summary')).toBeVisible();await page.locator('.room-members > summary').click();
    const member=page.locator(`[data-room-form="member"][data-member="${memberships[peer.accountId].id}"]`),reason=member.locator('textarea'),previous=member.locator('[data-command-history="previous"]'),next=member.locator('[data-command-history="next"]');
    const memberKeys=[];await page.route(`**${base}/members/${memberships[peer.accountId].id}/ban`,async route=>{memberKeys.push(route.request().postDataJSON().requestKey);await route.abort('failed');});
    await member.locator('select').selectOption('ban');await reason.fill('  Exact member reason\n  ');await member.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('[data-room-discard]')).toBeEnabled();await page.locator('[data-room-discard]').click();await expect(page.locator('[data-room-discard]')).toHaveCount(0);
    await reason.fill('Unfinished member reason');await member.locator('select').selectOption('remove');await reason.evaluate(node=>{node.focus();node.setSelectionRange(2,6);});
    const before=await snapshot();await previous.click();await expect(reason).toHaveValue('  Exact member reason\n  ');await expect(member.locator('select')).toHaveValue('ban');expect(await snapshot()).toBe(before);expect(memberKeys).toHaveLength(1);
    await next.click();await expect(reason).toHaveValue('Unfinished member reason');await expect(member.locator('select')).toHaveValue('remove');expect(await reason.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([2,6]);
    await previous.click();await capture(member,'member-target-recall.png');await member.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.locator('[data-room-discard]')).toBeEnabled();expect(memberKeys).toHaveLength(2);expect(memberKeys[1]).not.toBe(memberKeys[0]);await page.locator('[data-room-discard]').click();await expect(page.locator('[data-room-discard]')).toHaveCount(0);
    await page.unroute(`**${base}/members/${memberships[peer.accountId].id}/ban`);
    const moderation=page.locator(`[data-room-form="moderate"][data-message="${message.id}"]`),moderationReason=moderation.locator('textarea'),modPrevious=moderation.locator('[data-command-history="previous"]');
    await moderation.locator('..').locator('summary').click();const keys=[];let phase='abort',committedStatus;
    await page.route(`**${base}/messages/${message.id}/moderate`,async route=>{keys.push(route.request().postDataJSON());if(phase==='abort')await route.abort('failed');else if(phase==='drop'){phase='retry';committedStatus=(await route.fetch()).status();await route.abort('failed');}else await route.continue();});
    await moderationReason.fill('  Exact hide reason\n  ');await moderation.getByRole('button',{name:'Hide message',exact:true}).click();await expect(page.locator('[data-room-discard]')).toBeEnabled();await page.locator('[data-room-discard]').click();await expect(page.locator('[data-room-discard]')).toHaveCount(0);
    await api('POST',`${base}/messages/${message.id}/moderate`,{revision:0,hidden:true,reason:'Intervening hide',requestKey:randomUUID()},owner.token);
    await api('POST',`${base}/messages/${message.id}/moderate`,{revision:1,hidden:false,reason:'Intervening restore',requestKey:randomUUID()},owner.token);
    await page.getByRole('button',{name:'Refresh rooms',exact:true}).click();await expect(moderation).toHaveAttribute('data-revision','2');
    if(!await moderationReason.isVisible())await moderation.locator('..').locator('summary').click();await moderationReason.fill('Unfinished moderation');const beforeRecall=await snapshot();
    await modPrevious.click();await expect(moderationReason).toHaveValue('  Exact hide reason\n  ');expect(await snapshot()).toBe(beforeRecall);expect(keys).toHaveLength(1);await capture(moderation,'moderation-target-recall.png');
    phase='drop';await moderation.getByRole('button',{name:'Hide message',exact:true}).click();await expect(page.locator('[data-room-retry]')).toBeEnabled();expect(committedStatus).toBe(200);expect(keys[1].revision).toBe(2);expect(keys[1].requestKey).not.toBe(keys[0].requestKey);
    await page.locator('[data-room-retry]').click();await expect(page.locator('[data-room-retry]')).toHaveCount(0);expect(keys).toHaveLength(3);expect(keys[2]).toEqual(keys[1]);
    expect((await db.query('select count(*)::int as n from room_message_moderation where message_id=$1',[message.id])).rows[0].n).toBe(3);
    phase='abort';if(!await moderationReason.isVisible())await moderation.locator('..').locator('summary').click();
    await moderationReason.fill('Prior authority restore reason');await moderation.getByRole('button',{name:'Restore message',exact:true}).click();await expect(page.locator('[data-room-discard]')).toBeEnabled();await page.locator('[data-room-discard]').click();await expect(page.locator('[data-room-discard]')).toHaveCount(0);
    await expect(modPrevious).toBeEnabled();await expect(previous).toBeEnabled();
    const changesResponse=await request.get(`${path}/changes`,{headers:{Authorization:`Bearer ${moderator.token}`}});expect(changesResponse.status()).toBe(200);
    await page.route(`**${path}/changes`,route=>route.fulfill({response:changesResponse}));
    const boundMember=await member.elementHandle(),boundModeration=await moderation.elementHandle();
    const composer=page.locator('[data-room-form="send"] textarea'),invitation=page.locator('[data-room-form="invite"] input');await composer.fill('KEEP COMPOSER');await invitation.fill('keep.invitation@example.edu');
    await reason.fill('Old member draft');await moderationReason.fill('Old moderation draft');
    let entered,settled,oldMetadata;const checking=new Promise(resolve=>{entered=resolve;}),finished=new Promise(resolve=>{settled=resolve;}),gate=new Promise(resolve=>{releaseContext=resolve;});let held=false;
    const contextPattern=`**${base}/command-context?*`;
    await page.route(contextPattern,async route=>{
      const url=new URL(route.request().url());if(!held && url.searchParams.get('targetType')==='member' && url.searchParams.get('targetId')===memberships[peer.accountId].id){
        held=true;const response=await route.fetch();expect(response.status()).toBe(200);oldMetadata=(await response.json()).data;entered();await gate;await route.fulfill({response});settled();
      }else await route.continue();
    });
    await previous.click();await checking;
    await api('POST','/api/access/role-assignments',{accountId:moderator.accountId,roleCode:'room_steward',scope:{},reason:'Isolated target authority change'},owner.token,201);
    const afterGrant=await snapshot(),freshMetadata=await api('GET',`${base}/command-context?targetType=message&targetId=${message.id}`,undefined,moderator.token);expect(freshMetadata.authorityEpoch).not.toBe(oldMetadata.authorityEpoch);
    await modPrevious.click();await expect(moderation.locator('[data-command-history-position]')).toHaveText('0/0');await expect(reason).toHaveValue('');await expect(member.locator('select')).toHaveValue('');await expect(moderationReason).toHaveValue('');
    expect(await boundMember.evaluate(node=>node.isConnected)).toBe(true);expect(await boundModeration.evaluate(node=>node.isConnected)).toBe(true);
    await expect(composer).toHaveValue('KEEP COMPOSER');await expect(invitation).toHaveValue('keep.invitation@example.edu');
    await moderationReason.fill('NEW AUTHORITY DRAFT');await expect(moderation.getByRole('button',{name:'Restore message',exact:true})).toBeEnabled();releaseContext();await finished;await expect(member.locator('[data-command-history-position]')).toHaveText('0/0');await expect(previous).toBeDisabled();await expect(moderationReason).toHaveValue('NEW AUTHORITY DRAFT');
    const reconciled=page.waitForResponse(response=>response.url().includes(`${base}/command-context?`) && new URL(response.url()).searchParams.get('targetType')==='member');await reason.focus();await reconciled;await expect(member.getByRole('button',{name:'Apply',exact:true})).toBeEnabled();await expect(moderationReason).toHaveValue('NEW AUTHORITY DRAFT');expect(await snapshot()).toBe(afterGrant);
    await page.unroute(contextPattern);const attempts=keys.length;await moderation.getByRole('button',{name:'Restore message',exact:true}).click();await expect(page.locator('[data-room-discard]')).toBeEnabled();expect(keys).toHaveLength(attempts+1);expect(keys.at(-1)).toMatchObject({revision:3,hidden:false,reason:'NEW AUTHORITY DRAFT'});expect(await snapshot()).toBe(afterGrant);
    await page.locator('[data-room-discard]').click();await expect(page.locator('[data-room-discard]')).toHaveCount(0);
    await page.unroute(`**${path}/changes`);
    await page.evaluate(()=>{location.hash='#home';});await expect(moderation).toHaveCount(0);await page.goto('/#messages');await page.locator('[data-message-mode="rooms"]').click();await page.locator(`[data-room-select="${room.id}"]`).click();await page.locator('.room-members > summary').click();await expect(member.locator('[data-command-history-position]')).toHaveText('0/0');expect(errors).toEqual([]);
    async function snapshot(){const counts={};for(const table of ['room_message_moderation','message_room_membership_history','room_message_receipts','audit_events','notifications'])counts[table]=(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;return JSON.stringify(counts);}
    async function capture(form,name){
      const controls=form.locator('.chat-history-controls');await controls.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
      const box=await controls.boundingBox(),viewport=page.viewportSize();expect(box).toBeTruthy();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y).toBeGreaterThan(70);expect(box.y+box.height).toBeLessThan(viewport.height-70);
      for(const button of await controls.locator('button').all()){const bounds=await button.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(box.x);expect(bounds.x+bounds.width).toBeLessThanOrEqual(box.x+box.width+1);}
      await expect(controls.locator('[data-command-history-position]')).toHaveText('1/1');await page.screenshot({path:info.outputPath(name)});
    }
    async function account(label){
      const email=`target.${label.toLowerCase()}.${stamp}@example.edu`,password='Target-Recall-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:label},null,202);
      let token;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const mail=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(mail.recipientEmail===email && mail.variables?.activationToken)token=mail.variables.activationToken;}
      expect(token).toBeTruthy();await api('POST','/api/identity/activations',{token,password,preferredName:label,legalName:label});const session=await api('POST','/api/identity/sessions',{email,password},null,201);return {...session,email,accountId:(await api('GET','/api/identity/me',undefined,session.token)).account.id};
    }
  }finally{releaseContext?.();await db.end();}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);return(await response.json()).data;}
});
