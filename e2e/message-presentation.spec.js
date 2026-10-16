import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Message presentation requires isolated accounts.');

test('whole message workspace persists only an account-bound display flag with configured defaults and storage fallback',async({page,request},info)=>{
  test.setTimeout(180000);const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
  const a=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201),b=await account();
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try{
    await page.goto('/');await page.evaluate(session=>window.svuSession.set(session),a);await page.goto('/#messages');
    const toggle=page.locator('[data-message-minimize]'),content=page.locator('[data-message-content]');
    await ready();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(content).toBeVisible();
    const before=await snapshot();page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/') && req.method()!=='GET')writes.push(req.method());});
    await toggle.focus();await toggle.press('Space');await expect(content).toBeHidden();await expect(toggle).toHaveAccessibleName('Restore message workspace');await expect(toggle).toBeFocused();
    await expect(page.locator('[data-message-mode]')).toHaveCount(3);await expect(page.locator('[data-message-mode]').first()).toBeHidden();
    expect(await preferences()).toEqual([[`svu.messages.presentation.v1:${a.account.id}`,'{"minimized":true}']]);
    await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('message-workspace-minimized.png')});
    await page.reload();await ready();await expect(content).toBeHidden();await expect(toggle).toHaveAttribute('aria-expanded','false');
    await page.goto('/#resources');await page.goto('/#messages');await ready();await expect(content).toBeHidden();
    await page.evaluate(()=>{window.oldWorkspaceToggle=document.querySelector('[data-message-minimize]');});
    await page.evaluate(session=>window.svuSession.set(session),b);await ready();await expect(content).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');
    await page.evaluate(()=>window.oldWorkspaceToggle.dispatchEvent(new Event('click')));await expect(content).toBeVisible();
    expect(await preferences()).toEqual([[`svu.messages.presentation.v1:${a.account.id}`,'{"minimized":true}']]);
    await page.evaluate(session=>window.svuSession.set(session),a);await ready();await expect(content).toBeHidden();
    await toggle.press('Enter');await expect(content).toBeVisible();await page.reload();await ready();await expect(content).toBeVisible();
    // A deployment default applies only when there is no valid account override.
    await page.evaluate(session=>{document.querySelector('meta[name="svu-messages-start-minimized"]').content='true';window.svuSession.set(session);},b);await ready();await expect(content).toBeHidden();
    await toggle.click();await expect(content).toBeVisible();
    await page.evaluate(session=>window.svuSession.set(session),a);await ready();await expect(content).toBeVisible();
    await page.evaluate(session=>window.svuSession.set(session),b);await ready();await expect(content).toBeVisible();
    // Storage denial is nonfatal: this page still restores the workspace.
    await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage)throw new DOMException('Denied','SecurityError');return window.originalStorageSet.call(this,key,value);};});
    await toggle.click();await expect(content).toBeHidden();await expect(page.locator('.messages-page .notice[role="status"]')).toContainText('Display preference could not be saved.');
    await toggle.click();await expect(content).toBeVisible();
    await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet;});
    expect(await preferences()).toEqual([[`svu.messages.presentation.v1:${a.account.id}`,'{"minimized":false}'],[`svu.messages.presentation.v1:${b.account.id}`,'{"minimized":false}']].sort((x,y)=>x[0].localeCompare(y[0])));
    expect(await snapshot()).toBe(before);expect(writes).toEqual([]);
    await page.evaluate(()=>window.svuSession.clear());await expect(toggle).toHaveCount(0);await expect(content).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await db.end();}
  async function ready(){await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-message-minimize]')).toBeEnabled();}
  async function preferences(){return page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('svu.messages.presentation.v1:')).sort((x,y)=>x[0].localeCompare(y[0])));}
  async function snapshot(){const result=await db.query('select id,status,read_at from notifications where recipient_account_id=any($1::text[]) order by id',[[a.account.id,b.account.id]]);return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');}
  async function api(method,path,data,token,status=200){const response=await request.fetch(path,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${path}`).toBe(status);return(await response.json()).data;}
  async function account(){
    const email=`presentation.${info.project.name}.${Date.now()}@example.edu`,password='Message-Presentation-Verification-2026!';
    await api('POST','/api/admissions/registrations',{email,preferredName:'Presentation',legalName:'Presentation Fixture'},null,202);
    let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const value=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(value.recipientEmail===email && value.variables?.activationToken)activation=value.variables.activationToken;}
    expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:'Presentation',legalName:'Presentation Fixture'});
    return api('POST','/api/identity/sessions',{email,password},null,201);
  }
});
