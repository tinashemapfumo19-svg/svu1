import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Alert checks require isolated fixtures.');
for(const mode of ['private','room'])test(`${mode} alerts count hidden-context activity without bodies or reads and bind sound preferences to the account`,async({page,request},info)=>{
  test.setTimeout(300000);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const path=mode==='private'?'/api/private-messages':'/api/message-rooms',stamp=`${mode}.${info.project.name}.${Date.now()}`,errors=[];let id,other,closed=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.audioProbe={created:0,started:0,closed:0};
    const NativeAudioContext=window.AudioContext;
    window.AudioContext=class extends NativeAudioContext{constructor(){super();audioProbe.created++;}async close(){audioProbe.closed++;await super.close();}createOscillator(){const node=super.createOscillator(),start=node.start.bind(node);node.start=(...args)=>{audioProbe.started++;start(...args);};return node;}};
  });
  try{
    const owner=await account('owner'),peer=await account('peer'),extra=await account('extra');
    if(mode==='private'){
      for(const who of [owner,peer,extra])await api('PUT',`${path}/preferences`,{revision:0,enabled:true},who.token);
      id=await contact(peer);other=await contact(extra);
    }else{
      const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
      for(const [who,roleCode] of [[owner,'room_steward'],[peer,'room_approver']])await api('POST','/api/access/role-assignments',{accountId:who.accountId,roleCode,scope:{},reason:'Isolated native alert fixture'},admin.token,201);
      for(const who of [owner,peer,extra])await api('PUT',`${path}/preferences`,{revision:0,enabled:true,requestKey:randomUUID()},who.token);
      id=await room('First',peer);other=await room('Other',extra);
    }
    const resource=target=>mode==='private'?`${path}/conversations/${target}`:`${path}/${target}`,prefix=mode==='private'?'private':'room',badge=page.locator(`[data-${prefix}-tab-select="${other}"] [data-chat-alert-badge]`),sound=page.locator('[data-chat-alert-setting="sound"]');
    const activities=[];page.on('response',async response=>{if(response.url().includes('/activity') && response.ok())activities.push(new URL(response.url()).pathname);});
    await page.goto('/');await page.evaluate(session=>svuSession.set(session),owner);await page.goto('/#messages');await page.locator(`[data-message-mode="${mode==='private'?'private':'rooms'}"]`).click();await ready();await page.locator(`[data-${prefix}-${mode==='private'?'contact':'select'}="${id}"]`).click();await ready();
    await page.locator(`[data-${prefix}-background="${other}"]`).click();await ready();
    await expect.poll(()=>activities.includes(`${resource(other)}/activity`)).toBe(true);await expect(sound).not.toBeChecked();await expect(page.locator('[data-chat-alert-setting="own"]')).toBeChecked();
    expect(await page.evaluate(()=>audioProbe.created)).toBe(0);
    const bodies=[],writes=[];page.on('request',req=>{const url=new URL(req.url());if(url.pathname.startsWith(path) && /\/messages$/.test(url.pathname) && req.method()==='GET')bodies.push(url.pathname);if(url.pathname.startsWith(path) && req.method()!=='GET')writes.push(req.method());});
    await hidden(true);
    await send(owner,other,'OWN ACTION ALERT','action');await send(extra,other,'PRIVATE WORDS MUST NOT ENTER TITLE');
    const before=await snapshot();await expect(badge).toHaveText('2',{timeout:20000});await expect(page).toHaveTitle('(2) South Valley University');expect(await page.evaluate(()=>audioProbe.started)).toBe(0);expect(bodies).toEqual([]);expect(writes).toEqual([]);
    await page.emulateMedia({reducedMotion:'reduce'});expect(await badge.evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
    await sound.check();await expect(page.locator('[data-chat-alert-audio]')).toHaveText('Ready');await send(extra,other,'NEW SOUND ACTIVITY');
    await expect(badge).toHaveText('3',{timeout:20000});await expect.poll(()=>page.evaluate(()=>audioProbe.started)).toBeGreaterThan(0);await expect(page).toHaveTitle('(3) South Valley University');expect(bodies).toEqual([]);
    const after=await snapshot();expect(after).not.toBe(before);const stable=await snapshot();await page.locator('[data-chat-alert-test]').click();expect(await snapshot()).toBe(stable);expect(writes).toEqual([]);
    await page.locator('.chat-alert-settings').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`${mode}-alerts.png`)});
    if(mode==='private')await api('POST',`${resource(other)}/block`,{revision:0,blocked:true},extra.token);
    else await api('POST',`${resource(other)}/close`,{revision:2,requestKey:randomUUID()},peer.token);
    closed=true;await expect(page).not.toHaveTitle(/^\(/,{timeout:20000});await expect(badge).toHaveAttribute('data-empty','true');expect(bodies).toEqual([]);
    await hidden(false);await ready();await expect(page).not.toHaveTitle(/^\(/);expect(bodies.every(url=>url===`${resource(id)}/messages`)).toBe(true);expect(await snapshot()).toBe(stable);
    await page.goto('/#home');await expect(page).not.toHaveTitle(/^\(/);expect(await page.evaluate(()=>audioProbe.closed)).toBeGreaterThan(0);
    await page.goto('/#messages');await ready();await expect(sound).toBeChecked();await expect(page).not.toHaveTitle(/^\(/);
    const prefs=await page.evaluate(id=>JSON.parse(localStorage.getItem(`svu.messages.alerts.v1:${id}`)),owner.accountId);expect(Object.keys(prefs).sort()).toEqual(['own','sound','window']);expect(prefs).toEqual({window:true,sound:true,own:true});
    await page.evaluate(session=>svuSession.set(session),peer);await ready();await expect(sound).not.toBeChecked();await expect(page).not.toHaveTitle(/^\(/);
    await page.evaluate(()=>{window.oldAlert=document.querySelector('[data-chat-alert-test]');svuSession.clear();});await expect(sound).toHaveCount(0);await page.evaluate(()=>oldAlert.dispatchEvent(new Event('click')));await expect(page).not.toHaveTitle(/^\(/);expect(errors).toEqual([]);
    async function room(label,recipient){const row=await api('POST',path,{title:`Alerts ${label} ${stamp}`,purpose:'Isolated alert verification',policyReference:'TEST-ALERTS',retentionRule:'Isolated fixtures only',requestKey:randomUUID()},owner.token);await api('POST',`${path}/${row.id}/activate`,{revision:1,requestKey:randomUUID()},peer.token);await api('POST',`${path}/${row.id}/join`,{requestKey:randomUUID()},owner.token);const invitation=await api('POST',`${path}/${row.id}/members`,{email:recipient.email,requestKey:randomUUID()},owner.token);await api('POST',`${path}/${row.id}/members/${invitation.id}/accept`,{revision:1,requestKey:randomUUID()},recipient.token);return row.id;}
    async function contact(recipient){const row=await api('POST',`${path}/conversations`,{email:recipient.email,requestKey:randomUUID()},owner.token);await api('POST',`${path}/conversations/${row.id}/accept`,{revision:1},recipient.token);return row.id;}
    async function send(who,target,body,kind='text'){return api('POST',`${resource(target)}/messages`,{body,kind,requestKey:randomUUID()},who.token);}
    async function hidden(value){await page.evaluate(value=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});window.dispatchEvent(new Event(value?'blur':'focus'));document.dispatchEvent(new Event('visibilitychange'));},value);}
  }finally{await db.end();}
  async function ready(){await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');}
  async function snapshot(){const table=mode==='private'?'private_messages':'room_messages',column=mode==='private'?'conversation_id':'room_id';const rows=(await db.query(`select to_jsonb(m) as row from ${table} m where ${column}=$1 order by position`,[other])).rows;expect(rows.length).toBeGreaterThanOrEqual(2);const reads=mode==='private'?(await db.query('select to_jsonb(r) as row from private_message_reads r where conversation_id=$1 order by account_id',[other])).rows:[];if(mode==='private')expect(reads).toHaveLength(2);return createHash('sha256').update(JSON.stringify({rows,reads})).digest('hex');}
  async function api(method,url,data,token,status=200){const r=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.status(),`${method} ${url}`).toBe(status);return(await r.json()).data;}
  async function account(name){const email=`alerts.${name}.${stamp}@example.edu`,password='Chat-Alerts-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:name},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:name});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
});
