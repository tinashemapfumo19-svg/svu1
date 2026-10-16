import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Scroll fixtures require an isolated database.');
test.use({actionTimeout:15000});

for(const mode of ['private','room'])test(`${mode} history restores page pixels and advances visible/deferred batches without acknowledging reads`,async({page,request},info)=>{
  test.setTimeout(420000);
  const stamp=`${mode}.${info.project.name}.${Date.now()}`,path=mode==='private'?'/api/private-messages':'/api/message-rooms',prefix=mode==='private'?'private':'room',db=new pg.Client({connectionString:process.env.DATABASE_URL}),errors=[],originalIds=[];
  const resource=value=>mode==='private'?`${path}/conversations/${value}`:`${path}/${value}`;
  await db.connect();page.on('pageerror',error=>errors.push(error.message));
  let owner,peer,extra,id,other;
  try{
    owner=await account('Owner');peer=await account('Peer');extra=await account('Extra');
    if(mode==='private'){
      for(const actor of [owner,peer,extra])await api('PUT',`${path}/preferences`,{revision:0,enabled:true},actor.token);
      id=await contact(peer);other=await contact(extra);
    }else{
      const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
      for(const [actor,roleCode] of [[owner,'room_steward'],[peer,'room_approver']])await api('POST','/api/access/role-assignments',{accountId:actor.accountId,roleCode,scope:{},reason:'Isolated history-scroll verification'},admin.token,201);
      for(const actor of [owner,peer,extra]){const pref=(await api('GET',path,undefined,actor.token)).preferences;await api('PUT',`${path}/preferences`,{revision:pref.revision,enabled:true,requestKey:randomUUID()},actor.token);}
      id=await room('First',peer);other=await room('Other',extra);
    }
    for(let i=0;i<36;i++)originalIds.push((await send(id,i%2?owner:peer,`History ${i}`)).id);
    for(let i=0;i<8;i++)originalIds.push((await send(other,extra,`Other history ${i}`)).id);
    const original=await snapshot(),reads=await readSnapshot();
    await page.goto('/');await page.evaluate(session=>svuSession.set(session),owner);await page.goto('/#messages');await page.locator(`[data-message-mode="${mode==='private'?'private':'rooms'}"]`).click();await ready();
    // Isolated test instrumentation observes metadata only; production does not expose participant contexts.
    await page.evaluate(()=>{const bind=chatScroll.bind;chatScroll.bind=(...args)=>{window.scrollContext=args[1];return bind(...args);};});
    await select(id);
    const history=page.locator('[data-chat-scroll]'),form=page.locator(mode==='private'?'[data-private-compose]':'[data-room-form="send"]'),field=form.locator('textarea[name="body"]');
    await expect(history).toHaveAttribute('tabindex','0');await expect(history).toHaveAttribute('aria-label',mode==='private'?'Conversation messages':'Room messages');await expect(page.locator(`[data-${prefix}-message]`)).toHaveCount(30);
    let metrics=await measure();expect(metrics.top).toBe(metrics.end);expect(metrics.end).toBeGreaterThan(1000);expect(metrics.height).toBe(Math.floor(Math.min(440,info.project.use.viewport.height/2)));
    for(const [content,height] of [['240',240],['',300],['440px',440],['440',440]]){
      await page.evaluate(value=>{document.querySelector('meta[name="svu-chat-history-height"]').content=value;window.renderMessages();},content);
      expect((await measure()).height).toBe(Math.floor(Math.min(height,info.project.use.viewport.height/2)));
    }
    const writes=[],watch=req=>{if(req.url().includes(path) && req.method()!=='GET')writes.push(req.method());};page.on('request',watch);
    await field.fill('Unfinished scroll draft');await field.evaluate(node=>node.setSelectionRange(2,5));await at(100);await page.evaluate(()=>window.renderMessages());await near(100);await expect(field).toHaveValue('Unfinished scroll draft');expect(await field.evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([2,5]);
    await refresh();await near(100);await page.locator(`[data-${prefix}-formatted]`).check();await page.locator(`[data-${prefix}-timestamps]`).uncheck();await refresh();await near(100);
    await page.locator(`[data-${prefix}-older]`).click();await ready();await expect(page.locator(`[data-${prefix}-message]`)).toHaveCount(6);metrics=await measure();expect(metrics.top).toBe(metrics.end);await at(80);
    await page.locator(`[data-${prefix}-newest]`).click();await ready();await near(100);await page.locator(`[data-${prefix}-older]`).click();await ready();await near(80);await page.locator(`[data-${prefix}-newest]`).click();await ready();await near(100);
    await page.locator(`[data-${prefix}-background="${other}"]`).click();await ready();await near(100);await select(other);metrics=await measure();expect(metrics.top).toBe(metrics.end);await at(160);await select(id);await near(100);
    const background=await send(other,extra,'Deferred background batch');await refresh();await near(100);await select(other);await advanced(160,background.id);const backgroundTop=(await measure()).top;await refresh();await near(backgroundTop);await select(id);await near(100);
    const live=await send(id,peer,'Visible batch',mode==='room'?'action':'text');await refresh();await advanced(100,live.id);const liveTop=(await measure()).top;await refresh();await near(liveTop);
    await at(80);await page.locator(`[data-${prefix}-minimize]`).click();await expect(history).toBeHidden();
    const minimized=await send(id,mode==='room'?owner:peer,'Minimized batch',mode==='room'?'notice':'text');await refresh();await expect(history).toBeHidden();expect(await cachedTop()).toBe(80);await page.locator(`[data-${prefix}-minimize]`).click();await advanced(80,minimized.id);const restoredTop=(await measure()).top;await refresh();await near(restoredTop);
    await at(160);await page.locator('[data-message-minimize]').click();await expect(history).toBeHidden();const collapsed=await send(id,peer,'Collapsed workspace batch');
    await expect(page.locator(`[data-chat-body="${collapsed.id}"]`)).toHaveCount(1,{timeout:20000});await expect(history).toBeHidden();expect(await cachedTop()).toBe(160);await page.locator('[data-message-minimize]').click();await advanced(160,collapsed.id);await expect(field).toHaveValue('Unfinished scroll draft');
    expect(writes).toEqual([]);expect(await snapshot()).toBe(original);expect(await readSnapshot()).toBe(reads);
    await at(0);await history.focus();await expect(history).toBeFocused();await page.keyboard.press('PageDown');await expect.poll(async()=>(await measure()).top).toBeGreaterThan(0);
    const keyboardPixels=await history.evaluate(node=>{const before=node.scrollTop;window.renderMessages();return {before,after:document.querySelector('[data-chat-scroll]').scrollTop};});expect(Math.abs(keyboardPixels.after-keyboardPixels.before)).toBeLessThan(2);await expect(history).toBeFocused();await near(keyboardPixels.before);
    await history.evaluate(node=>{scrollTo({top:Math.max(0,scrollY+node.getBoundingClientRect().top-150),behavior:'instant'});});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`${mode}-history-scroll.png`)});
    await at(70);await field.fill('Own deliberately submitted message');await form.getByRole('button',{name:`Send ${mode==='private'?'private':'room'} message`,exact:true}).click();
    const ownRow=page.locator('[data-chat-scroll] li').filter({has:page.locator('[data-chat-body]').filter({hasText:/^Own deliberately submitted message$/})});await expect(ownRow).toHaveCount(1);await ready();const own=await ownRow.getAttribute(`data-${prefix}-message`);await advanced(70,own);expect(writes).toEqual(['POST']);page.off('request',watch);
    await field.fill('Draft after own submission');await page.locator(`[data-${prefix}-clear]`).click();await ready();await near(0);await page.locator(`[data-${prefix}-restore]`).click();await ready();await near(0);await expect(field).toHaveValue('Draft after own submission');expect(await snapshot()).toBe(original);expect(await readSnapshot()).toBe(reads);
    await at(90);await page.evaluate(()=>{window.oldScrollNode=document.querySelector('[data-chat-scroll]');window.oldScrollContext=scrollContext;window.oldScrollSnapshot=JSON.stringify(scrollContext.historyScroll);});
    if(mode==='private'){
      const summary=await api('GET',resource(id),undefined,peer.token);await api('POST',`${resource(id)}/block`,{revision:summary.conversation.blockRevision,blocked:true},peer.token);await refresh();await expect(history).toHaveCount(0);await api('POST',`${resource(id)}/block`,{revision:summary.conversation.blockRevision+1,blocked:false},peer.token);id=await contact(peer);await refresh();await select(id);expect((await measure()).top).toBe(0);
    }else{
      const definition=await api('GET',resource(id),undefined,owner.token);await api('POST',`${resource(id)}/members/${definition.room.membershipId}/leave`,{revision:definition.room.membershipRevision,requestKey:randomUUID()},owner.token);await refresh();await expect(history).toHaveCount(0);await api('POST',`${resource(id)}/join`,{requestKey:randomUUID()},owner.token);await refresh();metrics=await measure();expect(metrics.top).toBe(metrics.end);
    }
    await expect(field).toHaveValue('');await page.evaluate(()=>{oldScrollNode.scrollTop=25;oldScrollNode.dispatchEvent(new Event('scroll'));});expect(await page.evaluate(()=>JSON.stringify(oldScrollContext.historyScroll))).toBe(await page.evaluate(()=>oldScrollSnapshot));
    await page.reload();await page.locator(`[data-message-mode="${mode==='private'?'private':'rooms'}"]`).click();await ready();await select(id);metrics=await measure();expect(metrics.top).toBe(metrics.end);
    await page.evaluate(()=>{window.oldScrollNode=document.querySelector('[data-chat-scroll]');});await page.evaluate(()=>svuSession.clear());await expect(history).toHaveCount(0);await page.evaluate(()=>oldScrollNode.dispatchEvent(new Event('scroll')));expect(errors).toEqual([]);
  }finally{await db.end();}
  async function measure(){return page.locator('[data-chat-scroll]').evaluate(node=>({top:node.scrollTop,end:node.scrollHeight-node.clientHeight,height:node.clientHeight}));}
  async function cachedTop(){return page.evaluate(()=>scrollContext.historyScroll.pages.find(item=>item.key==='latest').top);}
  async function at(top){await page.locator('[data-chat-scroll]').evaluate((node,value)=>{node.scrollTop=value;node.dispatchEvent(new Event('scroll'));},top);}
  async function near(top){await expect.poll(async()=>Math.abs((await measure()).top-top)).toBeLessThan(2);}
  async function advanced(top,message){const next=await page.locator(`[data-${prefix}-message="${message}"]`).evaluate(node=>node.getBoundingClientRect().height);const end=(await measure()).end;await near(Math.min(end,top+next));}
  async function ready(){await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');}
  async function refresh(){await page.locator(`[data-${prefix}-refresh]`).click();await ready();}
  async function select(value){await page.locator(`[data-${prefix}-${mode==='private'?'contact':'select'}="${value}"]`).click();await ready();}
  async function send(value,actor,label,kind='text'){return api('POST',`${mode==='private'?`${path}/conversations/${value}`:`${path}/${value}`}/messages`,{body:`${label}\nLine two\nLine three\nLine four\nLine five\nLine six`,...(mode==='room'?{kind}:{}),requestKey:randomUUID()},actor.token);}
  async function snapshot(){const table=mode==='private'?'private_messages':'room_messages',rows=(await db.query(`select to_jsonb(m) as row from ${table} m where id=any($1::text[]) order by position`,[originalIds])).rows;expect(rows).toHaveLength(originalIds.length);return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
  async function readSnapshot(){if(mode!=='private')return 'No room read acknowledgement command';const rows=(await db.query('select conversation_id,account_id,through_position::text from private_message_reads where conversation_id=any($1::text[]) order by conversation_id,account_id',[[id,other]])).rows;expect(rows).toHaveLength(4);return JSON.stringify(rows);}
  async function contact(recipient){const row=await api('POST',`${path}/conversations`,{email:recipient.email,requestKey:randomUUID()},owner.token);await api('POST',`${path}/conversations/${row.id}/accept`,{revision:1},recipient.token);return row.id;}
  async function room(label,recipient){const row=await api('POST',path,{title:`Scroll ${label} ${stamp}`,purpose:'Isolated per-page scroll verification',policyReference:'TEST-SCROLL',retentionRule:'Isolated verification only',requestKey:randomUUID()},owner.token);await api('POST',`${path}/${row.id}/activate`,{revision:1,requestKey:randomUUID()},peer.token);await api('POST',`${path}/${row.id}/join`,{requestKey:randomUUID()},owner.token);const invite=await api('POST',`${path}/${row.id}/members`,{email:recipient.email,requestKey:randomUUID()},owner.token);await api('POST',`${path}/${row.id}/members/${invite.id}/accept`,{revision:1,requestKey:randomUUID()},recipient.token);return row.id;}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok() && url.startsWith(path))expect(response.headers()['cache-control']).toContain('no-store');return(await response.json()).data;}
  async function account(name){const email=`scroll.${name.toLowerCase()}.${stamp}@example.edu`,password='History-Scroll-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:name},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:name});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
});
