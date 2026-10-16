import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
const smileyAssets=JSON.parse(await readFile(new URL('../src/assets/chat-smileys/catalogue.json',import.meta.url),'utf8')).icons;
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Formatting requires isolated fixtures.');
test.use({actionTimeout:15000});

for(const mode of ['private','room'])test(`${mode} optional formatting preserves raw history, drafts, retry requests and evidence`,async({page,request},info)=>{
  test.setTimeout(180000);
  const stamp=`${mode}.${info.project.name}.${Date.now()}`,errors=[],packets=[],db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  page.on('pageerror',error=>errors.push(error.message));
  const path=mode==='private'?'/api/private-messages':'/api/message-rooms',prefix=mode==='private'?'private':'room';let id;
  try{
    const owner=await account('owner'),peer=await account('peer');
    if(mode==='private'){
      for(const actor of [owner,peer])await api('PUT',`${path}/preferences`,{revision:0,enabled:true},actor.token);
      const contact=await api('POST',`${path}/conversations`,{email:peer.email,requestKey:randomUUID()},owner.token);id=contact.id;
      await api('POST',`${path}/conversations/${id}/accept`,{revision:1},peer.token);
    }else{
      const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
      for(const [actor,roleCode] of [[owner,'room_steward'],[peer,'room_approver']])await api('POST','/api/access/role-assignments',{accountId:actor.accountId,roleCode,scope:{},reason:'Isolated formatting fixture'},admin.token,201);
      for(const actor of [owner,peer]){const pref=(await api('GET',path,undefined,actor.token)).preferences;await api('PUT',`${path}/preferences`,{revision:pref.revision,enabled:true,requestKey:randomUUID()},actor.token);}
      id=(await api('POST',path,{title:`Formatting ${stamp}`,purpose:'Isolated formatting evidence',policyReference:'TEST-FORMATTING',retentionRule:'Isolated verification only',requestKey:randomUUID()},owner.token)).id;
      await api('POST',`${path}/${id}/activate`,{revision:1,requestKey:randomUUID()},peer.token);await api('POST',`${path}/${id}/join`,{requestKey:randomUUID()},owner.token);
      const invite=await api('POST',`${path}/${id}/members`,{email:peer.email,requestKey:randomUUID()},owner.token);await api('POST',`${path}/${id}/members/${invite.id}/accept`,{revision:1,requestKey:randomUUID()},peer.token);
    }
    const resource=mode==='private'?`${path}/conversations/${id}`:`${path}/${id}`,raw='[b]Review words[/b]\n[color=red]Red words[/color] [url=https://example.edu/review?x=1&y=2]Reference[/url]\nSmile :) Cloud :""": Arrow <--',unsafe='[url=javascript:alert(1)]unsafe[/url] <img src=x onerror="alert(1)">';
    const original=await api('POST',`${resource}/messages`,{body:raw,requestKey:randomUUID()},peer.token);await api('POST',`${resource}/messages`,{body:unsafe,requestKey:randomUUID()},peer.token);
    await page.goto('/');await page.evaluate(session=>svuSession.set(session),owner);await page.goto('/#messages');await page.locator(`[data-message-mode="${mode==='room'?'rooms':'private'}"]`).click();await ready();
    await page.locator(`[data-${prefix}-${mode==='private'?'contact':'select'}="${id}"]`).click();await ready();
    const form=page.locator(mode==='private'?'[data-private-compose]':'[data-room-form="send"]'),field=form.locator('textarea[name="body"]'),toggle=page.locator(`[data-${prefix}-formatted]`),originalBody=page.locator(`[data-chat-body="${original.id}"]`);
    const smileyToggle=page.locator(`[data-${prefix}-smileys]`);
    await expect(toggle).not.toBeChecked();await expect(smileyToggle).not.toBeChecked();await expect(originalBody).toHaveText(raw);await expect(originalBody.locator('strong,a,img')).toHaveCount(0);
    const writes=[],watch=req=>{if(req.url().includes(path) && req.method()!=='GET')writes.push(req.method());};page.on('request',watch);const before=await snapshot();
    await smileyToggle.check();await expect(toggle).not.toBeChecked();await expect(originalBody.locator('strong,a')).toHaveCount(0);await expect(originalBody.locator('[data-chat-smiley]')).toHaveCount(3);await expect(originalBody.locator('[data-chat-smiley="weather_clouds"]')).toHaveAttribute('alt',':""":');await smileyToggle.uncheck();await expect(originalBody).toHaveText(raw);
    await form.locator('.chat-smileys summary').click();await expect(form.locator('[data-chat-insert-smiley]')).toHaveCount(19);await expect(form.locator('.chat-smiley-credit')).toContainText('Mark James');await expect(form.locator('.chat-smiley-credit')).toContainText('Robin Monks');await expect(form.locator('.chat-smiley-credit')).toContainText('CC BY 2.5');
    for(const asset of smileyAssets){const response=await request.get(`/src/assets/chat-smileys/${asset.file}`);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toBe('image/png');expect(response.headers()['cache-control']).toBe('no-store');expect(response.headers()['x-content-type-options']).toBe('nosniff');expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(asset.sha256);}
    const decoded=await page.evaluate(async assets=>{const result=[];for(const asset of assets){const image=new Image();image.src=`/src/assets/chat-smileys/${asset.file}`;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,16,16).data;result.push({file:asset.file,width:image.naturalWidth,height:image.naturalHeight,visible:Array.from(pixels).filter((_,i)=>i%4===3).some(alpha=>alpha>0)});}return result;},smileyAssets);expect(decoded).toHaveLength(19);for(const item of decoded)expect(item).toMatchObject({width:16,height:16,visible:true});
    const credits=await request.get('/src/assets/chat-smileys/ATTRIBUTION.txt');expect(credits.status()).toBe(200);expect(credits.headers()['content-type']).toContain('text/plain');expect(await credits.text()).toContain('No image was modified.');
    for(const blocked of ['/src/assets/chat-smileys/secret.png','/src/assets/chat-smileys/theme.txt','/src/assets/chat-smileys/catalogue.json','/_legacy_php_system/chat/themes/default/smileys/emoticon_smile.png','/server/config.js'])expect((await request.get(blocked)).status()).toBe(404);
    await field.fill('Before target after');await field.evaluate(node=>node.setSelectionRange(7,13));await form.locator('[data-chat-insert-smiley="emoticon_smile"]').click();await expect(field).toHaveValue('Before :) after');await expect(field).toBeFocused();expect(await field.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([9,9]);await page.evaluate(()=>window.renderMessages());await expect(form.locator('[data-chat-insert-smiley="emoticon_smile"]')).toBeVisible();await expect(field).toHaveValue('Before :) after');
    await field.fill('x'.repeat(4000));await field.evaluate(node=>node.setSelectionRange(4000,4000));await form.locator('[data-chat-insert-smiley="emoticon_smile"]').click();await expect(field).toHaveValue('x'.repeat(4000));await expect(form.locator('[role="status"]')).toHaveText('Message exceeds 4000 characters.');await smileyToggle.check();
    await expect(form.getByRole('button',{name:'Blue text',exact:true})).toHaveCSS('color','rgb(36, 93, 168)');await expect(form.getByRole('button',{name:'Red text',exact:true})).toHaveCSS('color','rgb(180, 35, 59)');
    await field.fill('Alpha beta');await field.evaluate(node=>node.setSelectionRange(0,5));await form.getByRole('button',{name:'Bold',exact:true}).click();await expect(field).toHaveValue('[b]Alpha[/b] beta');await expect(field).toBeFocused();expect(await field.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([3,8]);
    await form.getByRole('button',{name:'Blue text',exact:true}).click();await expect(field).toHaveValue('[b][color=#245da8]Alpha[/color][/b] beta');
    await toggle.check();await expect(originalBody.locator('strong')).toHaveText('Review words');await expect(originalBody.locator('.chat-color-red')).toHaveText('Red words');await expect(originalBody.locator('a')).toHaveAttribute('href','https://example.edu/review?x=1&y=2');await expect(originalBody.locator('a')).toHaveAttribute('rel','noopener noreferrer');
    const unsafeBody=page.locator('[data-chat-body]').filter({hasText:unsafe});await expect(unsafeBody).toHaveText(unsafe);await expect(unsafeBody.locator('a,img,script')).toHaveCount(0);
    const draft=await field.inputValue();await page.locator(`[data-${prefix}-refresh]`).click();await ready();await expect(toggle).toBeChecked();await expect(smileyToggle).toBeChecked();await expect(originalBody.locator('[data-chat-smiley]')).toHaveCount(3);await expect(originalBody.locator('strong')).toHaveText('Review words');await expect(field).toHaveValue(draft);expect(await snapshot()).toBe(before);expect(writes).toEqual([]);
    await field.evaluate(node=>node.setSelectionRange(node.value.length,node.value.length));await form.locator('.chat-link summary').click();await form.locator('[data-chat-url]').fill('javascript:alert(1)');await form.getByRole('button',{name:'Apply link',exact:true}).click();await expect(field).toHaveValue(draft);await expect(form.locator('[role="status"]')).toHaveText('Enter a valid HTTP(S) URL.');
    await form.locator('[data-chat-url]').fill('https://example.edu/compose');await form.locator('[data-chat-url]').evaluate(node=>node.setSelectionRange(8,15));await page.evaluate(()=>window.renderMessages());await expect(form.locator('[data-chat-url]')).toBeVisible();await expect(form.locator('[data-chat-url]')).toBeFocused();await expect(form.locator('[data-chat-url]')).toHaveValue('https://example.edu/compose');expect(await form.locator('[data-chat-url]').evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([8,15]);await form.locator('[data-chat-url]').press('Enter');let compiled=await field.inputValue();expect(compiled).toBe(draft+'[url=https://example.edu/compose]https://example.edu/compose[/url]');await expect(field).toBeFocused();
    await field.evaluate(node=>node.setSelectionRange(node.value.length,node.value.length));await form.locator('[data-chat-insert-smiley="emoticon_smile"]').click();compiled+=':)';await expect(field).toHaveValue(compiled);
    await field.fill('x'.repeat(4000));await form.getByRole('button',{name:'Italic',exact:true}).click();await expect(field).toHaveValue('x'.repeat(4000));await expect(form.locator('[role="status"]')).toHaveText('Message exceeds 4000 characters.');await field.fill(compiled);
    await toggle.uncheck();await smileyToggle.uncheck();await expect(originalBody).toHaveText(raw);await expect(field).toHaveValue(compiled);expect(await snapshot()).toBe(before);expect(writes).toEqual([]);page.off('request',watch);
    await field.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`${mode}-formatting-composer.png`)});
    await form.locator('.chat-smileys').evaluate(node=>node.scrollIntoView({block:'center'}));const pickerBounds=await form.locator('.chat-smileys').boundingBox(),viewport=page.viewportSize();expect(pickerBounds.x).toBeGreaterThanOrEqual(0);expect(pickerBounds.x+pickerBounds.width).toBeLessThanOrEqual(viewport.width);expect(pickerBounds.y).toBeGreaterThanOrEqual(64);expect(pickerBounds.y+pickerBounds.height).toBeLessThanOrEqual(viewport.height-(info.project.name==='mobile'?72:0));await page.screenshot({path:info.outputPath(`${mode}-smiley-picker.png`)});
    let lost=false;
    await page.route(`**${resource}/messages`,async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      packets.push(route.request().postDataJSON());
      if(!lost){lost=true;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.continue();
    });
    await form.getByRole('button',{name:`Send ${mode==='private'?'private':'room'} message`,exact:true}).click();await ready();await expect(field).toHaveValue(compiled);
    if(mode==='room'){
      await expect(toggle).toBeDisabled();await expect(smileyToggle).toBeDisabled();await expect(form.getByRole('button',{name:'Bold',exact:true})).toBeDisabled();await expect(form.locator('[data-chat-insert-smiley="emoticon_smile"]')).toBeDisabled();await form.locator('[data-chat-insert-smiley="emoticon_smile"]').evaluate(node=>node.dispatchEvent(new Event('click')));await expect(field).toHaveValue(compiled);await page.locator('[data-room-retry]').click();
    }else{
      await toggle.check();await smileyToggle.check();await expect(field).toHaveValue(compiled);await form.getByRole('button',{name:'Send private message',exact:true}).click();
    }
    await ready();await expect(field).toHaveValue('');expect(packets).toHaveLength(2);expect(packets[1]).toEqual(packets[0]);expect(packets[0].body).toBe(compiled);
    const history=await api('GET',`${resource}/messages`,undefined,owner.token);expect(history.items.filter(item=>item.body===compiled)).toHaveLength(1);expect(history.items.find(item=>item.id===original.id).body).toBe(raw);
    if(mode==='room'){
      const report=await api('POST',`${resource}/messages/${original.id}/report`,{category:'other',reason:'Original evidence [b]reason[/b]',disclose:true,requestKey:randomUUID()},owner.token);
      const detail=await api('GET',`${path}/reports/${report.id}?view=own&offset=0`,undefined,owner.token);expect(detail.body).toBe(raw);
      await page.locator('[data-room-refresh]').click();await ready();await toggle.check();await smileyToggle.check();await page.locator(`[data-room-report-select="${report.id}"]`).click();await ready();const evidence=page.locator('[data-room-report-detail] .message-body').first();await expect(evidence).toHaveText(raw);await expect(evidence.locator('strong,a,img')).toHaveCount(0);
    }
    await page.evaluate(()=>{window.oldFormat=document.querySelector('[data-chat-wrap="b"]');window.oldFormatToggle=document.querySelector('[data-private-formatted],[data-room-formatted]');});
    await page.reload();await page.locator(`[data-message-mode="${mode==='room'?'rooms':'private'}"]`).click();await ready();await page.locator(`[data-${prefix}-${mode==='private'?'contact':'select'}="${id}"]`).click();await ready();await expect(toggle).not.toBeChecked();await expect(smileyToggle).not.toBeChecked();await expect(field).toHaveValue('');
    await page.evaluate(()=>{window.oldFormat=document.querySelector('[data-chat-wrap="b"]');window.oldFormatToggle=document.querySelector('[data-private-formatted],[data-room-formatted]');window.oldSmiley=document.querySelector('[data-chat-insert-smiley]');window.oldSmileyToggle=document.querySelector('[data-private-smileys],[data-room-smileys]');});
    await page.evaluate(()=>svuSession.clear());await expect(form).toHaveCount(0);await page.evaluate(()=>{oldFormat.dispatchEvent(new Event('click'));oldFormatToggle.dispatchEvent(new Event('change'));oldSmiley.dispatchEvent(new Event('click'));oldSmileyToggle.dispatchEvent(new Event('change'));});expect(errors).toEqual([]);
  }finally{await db.end();}
  async function ready(){await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');}
  async function snapshot(){const table=mode==='private'?'private_messages':'room_messages',column=mode==='private'?'conversation_id':'room_id';const result=await db.query(`select to_jsonb(m) as row from ${table} m where ${column}=$1 order by position`,[id]);return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok() && url.startsWith(path))expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(name){const email=`format.${name}.${stamp}@example.edu`,password='Chat-Formatting-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:name},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:name});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
});
