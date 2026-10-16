import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {queueNotification} from '../server/notification-queue.js';
import {loadConfig} from '../server/config.js';

test('personal inbox has owned paging, secret exclusion and transactional exactly-once read acknowledgements',async ({page,request},info) => {
  test.setTimeout(180_000);
  const stamp = `${info.project.name}.${Date.now()}`;
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const own = await account(`inbox.own.${stamp}@example.com`),other = await account(`inbox.other.${stamp}@example.com`);
  const ids = [];
  for (let i=0;i<25;i++) ids.push((await api('POST','/api/notifications/send',{recipientAccountId:own.id,templateCode:'admissions.portal_message',channel:'email',variables:{message:i === 24 ? '<img src=x onerror="window.inboxUnsafe=true"> '+ 'LongMessage'.repeat(25) : `SAMPLE inbox ${i}`}},admin.token)).id);
  const otherNotice = await api('POST','/api/notifications/send',{recipientAccountId:other.id,templateCode:'results.published',channel:'email'},admin.token);
  const db = new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try {
    const hidden = (await api('POST','/api/notifications/send',{recipientAccountId:own.id,templateCode:'identity.password_recovery',channel:'email',variables:{recoveryToken:'NEVER EXPOSE RECOVERY'}},admin.token)).id;
    await queueNotification(db,own.id,'results.published',{}, {sensitive:true,dataEncryptionKey:loadConfig().dataEncryptionKey});
    const sensitive = (await db.query("select id from notifications where recipient_account_id=$1 and payload->'sensitive'='true'::jsonb",[own.id])).rows[0].id;
    // Microsecond-separated records exercise the database-precision keyset, not JavaScript milliseconds.
    await db.query(`with ranked as (select id,row_number() over(order by id) as rank from notifications where id=any($1::text[]))
      update notifications n set created_at='2026-10-06T00:00:00.123400Z'::timestamptz+ranked.rank*interval '1 microsecond' from ranked where n.id=ranked.id`,[ids]);
    const first = await api('GET','/api/notifications/me?limit=10',undefined,own.token);
    expect(first).toMatchObject({total:25,unread:25,view:'all'});expect(first.items).toHaveLength(10);
    const second = await api('GET',`/api/notifications/me?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`,undefined,own.token);
    const third = await api('GET',`/api/notifications/me?limit=10&cursor=${encodeURIComponent(second.nextCursor)}`,undefined,own.token);
    expect(third.items).toHaveLength(5);expect(third.nextCursor).toBeNull();
    expect([...first.items,...second.items,...third.items].map(row=>row.id).sort()).toEqual(ids.slice().sort());
    for(const row of first.items)expect(Object.keys(row).sort()).toEqual(['body','createdAt','id','readAt','subject']);
    expect(JSON.stringify(first)).not.toContain('NEVER EXPOSE');
    for (const id of [otherNotice.id,'not_missing',hidden,sensitive]) await refused('POST',`/api/notifications/me/${id}/read`,{},own.token,404);
    await refused('GET','/api/notifications/me',undefined,null,401);
    await refused('GET',`/api/notifications/me?recipientAccountId=${other.id}`,undefined,own.token,400);
    await refused('GET','/api/notifications/me?limit=1&limit=2',undefined,own.token,400);
    await refused('GET','/api/notifications/me?cursor=not-valid',undefined,own.token,400);
    for (const time of ['2026-02-31T00:00:00.123456Z','2025-02-29T00:00:00.123456Z','2026-10-06T24:00:00.123456Z','0000-01-01T00:00:00.123456Z']) {
      const cursor=Buffer.from(JSON.stringify([time,ids[0]])).toString('base64url');
      await refused('GET',`/api/notifications/me?cursor=${cursor}`,undefined,own.token,400);
    }
    await refused('GET','/api/notifications',undefined,own.token,403);
    await refused('POST',`/api/notifications/me/${ids[0]}/read`,{recipientAccountId:other.id},own.token,400);
    try {
      await db.query(`create function inbox_audit_probe() returns trigger language plpgsql as $$ begin
        if new.action='notification.read' then raise exception 'Controlled inbox audit failure'; end if; return new; end $$;
        create trigger inbox_audit_probe before insert on audit_events for each row execute function inbox_audit_probe()`);
      await refused('POST',`/api/notifications/me/${ids[0]}/read`,{},own.token,500);
      expect((await db.query('select read_at from notifications where id=$1',[ids[0]])).rows[0].read_at).toBeNull();
    } finally {await db.query('drop trigger if exists inbox_audit_probe on audit_events; drop function if exists inbox_audit_probe()');}
    const reads = await Promise.all([1,2].map(()=>api('POST',`/api/notifications/me/${ids[0]}/read`,{},own.token)));
    expect(reads[0]).toEqual(reads[1]);
    const receipt = (await db.query("select n.status,n.read_at,(select count(*)::int from audit_events a where a.subject_id=n.id and a.action='notification.read') as audits from notifications n where n.id=$1",[ids[0]])).rows[0];
    expect(receipt.status).toBe('queued');expect(receipt.audits).toBe(1);expect(receipt.read_at).not.toBeNull();
    expect((await api('GET','/api/notifications/me?view=unread',undefined,own.token))).toMatchObject({unread:24,total:25});
    expect((await api('GET','/api/notifications/me?view=read',undefined,own.token)).items.map(row=>row.id)).toEqual([ids[0]]);
    expect((await api('GET','/api/notifications/me',undefined,other.token)).items.map(row=>row.id)).toEqual([otherNotice.id]);
    await page.addInitScript(session=>sessionStorage.setItem('svu.applicant.session',JSON.stringify(session)),{token:own.token});
    await page.goto('/#messages');
    await expect(page.locator('[data-message]')).toHaveCount(20);
    await page.getByRole('button',{name:'Older messages',exact:true}).click();await expect(page.locator('[data-message]')).toHaveCount(5);
    await page.getByRole('button',{name:'Newer messages',exact:true}).click();await expect(page.locator('[data-message]')).toHaveCount(20);
    expect(await page.evaluate(()=>scrollY)).toBe(0);
    if (!(await page.locator(`[data-message="${ids[24]}"]`).count())) {
      await page.getByRole('button',{name:'Older messages',exact:true}).click();await expect(page.locator('[data-message]')).toHaveCount(5);
    }
    await expect(page.locator(`[data-message="${ids[24]}"] .message-body`)).toContainText('<img src=x onerror="window.inboxUnsafe=true">');
    await page.locator(`[data-message="${ids[24]}"]`).scrollIntoViewIfNeeded();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await page.screenshot({path:info.outputPath('escaped-message.png')});
    await page.locator('[data-message-view]').selectOption('unread');
    await expect(page.locator('.messages-page')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('[data-message-view]')).toHaveValue('unread');
    await expect(page.locator('.message-count')).toHaveText('24 unread / 25 total');
    const readId = await page.locator('[data-message-read]').first().getAttribute('data-message-read');
    await page.locator('[data-message-read]').first().click();
    await expect(page.locator('.message-count')).toHaveText('23 unread / 25 total');
    await expect(page.locator(`[data-message="${readId}"]`)).toHaveCount(0);
    expect(await page.evaluate(()=>window.inboxUnsafe || false)).toBe(false);
    await expect(page.locator('.messages-page img')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    const messagesLink=page.getByRole('link',{name:/^Messages(?:, \d+ unread)?$/});
    await expect(messagesLink).toBeVisible();await expect(messagesLink).toHaveAttribute('href','#messages');
    await page.screenshot({path:info.outputPath('personal-inbox.png')});
  } finally {await db.end();}
  async function api(method,path,data,token) {const r=await request.fetch(path,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBe(true);expect(r.headers()['cache-control']).toBe('no-store');return (await r.json()).data;}
  async function refused(method,path,data,token,status) {const r=await request.fetch(path,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(r.status()).toBe(status);expect(r.headers()['cache-control']).toBe('no-store');}
  async function account(email) {
    const password='Kariba-Dam-Applicant-2026!',legalName='SAMPLE Inbox Person';
    await api('POST','/api/admissions/registrations',{email,preferredName:'Inbox',legalName});
    const messages=await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,f),'utf8'))));
    const token=messages.find(row=>row.recipientEmail===email).variables.activationToken;
    await api('POST','/api/identity/activations',{token,password,preferredName:'Inbox',legalName});
    const session=await api('POST','/api/identity/sessions',{email,password});
    return {...session,id:(await api('GET','/api/identity/me',undefined,session.token)).account.id};
  }
});

const message = (id,body=id) => ({id,subject:`SAMPLE ${id}`,body,createdAt:'2026-10-06T00:00:00Z',readAt:null});
const inbox = items => ({items,nextCursor:null,unread:items.length,total:items.length,view:'all'});
async function mount(page,handler) {
  await page.addInitScript(()=>sessionStorage.setItem('svu.applicant.session',JSON.stringify({token:'first'})));
  await page.route('**/api/**',async route => {
    if(new URL(route.request().url()).pathname.startsWith('/api/notifications/me'))await handler(route);
    else if(new URL(route.request().url()).pathname==='/api/identity/me')await route.fulfill({json:{data:{account:{id:route.request().headers().authorization==='Bearer first'?'acct_first':'acct_second'},permissions:[],roles:[]}}});
    else await route.fulfill({json:{data:null}});
  });
  await page.goto('/#messages');
}
test('inbox serializes actions and discards departed and changed-account responses',async ({page}) => {
  let release,entered,hold=false;const gate=new Promise(ok=>release=ok),started=new Promise(ok=>entered=ok);const calls=[];
  let departing=false,departRelease,departEntered;const departGate=new Promise(ok=>departRelease=ok),departStarted=new Promise(ok=>departEntered=ok);
  await mount(page,async route => {
    const first=route.request().headers().authorization==='Bearer first';calls.push(first?'first':'second');
    if(first&&hold){entered();await gate;}
    const departed=departing;if(departed){departEntered();await departGate;}
    await route.fulfill({json:{data:inbox([message(first?'first':'second',departed?'DEPARTED PRIVATE BODY':first?'FIRST PRIVATE BODY':'SECOND PRIVATE BODY')])}});
  });
  await expect(page.locator('[data-message="first"]')).toBeVisible();
  hold=true;await page.getByRole('button',{name:'Refresh messages'}).click();await started;
  try {
    await expect(page.locator('[data-message-view]')).toBeDisabled();
    await page.evaluate(()=>{sessionStorage.setItem('svu.applicant.session',JSON.stringify({token:'second'}));window.renderMessages();});
    await expect(page.locator('[data-message]')).toHaveCount(0);
  } finally {release();}
  await expect(page.locator('[data-message="second"]')).toBeVisible();await expect(page.locator('.messages-page')).not.toContainText('FIRST PRIVATE');
  expect(calls.filter(row=>row==='second')).toHaveLength(1);
  await page.evaluate(()=>{sessionStorage.setItem('svu.registry.session',JSON.stringify({token:'first'}));window.renderMessages();});
  await page.locator('[data-message-account]').selectOption('svu.registry.session');
  await expect(page.locator('[data-message="first"]')).toBeVisible();
  departing=true;await page.getByRole('button',{name:'Refresh messages'}).click();await departStarted;
  try {await page.goto('/#resources');await page.goto('/#messages');await expect(page.locator('[data-message]')).toHaveCount(0);} finally {departing=false;departRelease();}
  await expect(page.locator('[data-message="first"]')).toBeVisible();
  await expect(page.locator('.messages-page')).not.toContainText('DEPARTED PRIVATE');
  await page.evaluate(()=>{sessionStorage.clear();window.renderMessages();});
  await expect(page.locator('[data-message]')).toHaveCount(0);await expect(page.getByRole('link',{name:'Student sign in'})).toBeVisible();
});
test('inbox authority refusals clear private messages and counts and permit authorized recovery',async ({page}) => {
  let status=200;
  await mount(page,route=>route.fulfill(status===200 ? {json:{data:inbox([message('private','PRIVATE NOTICE')])}} : {status,json:{error:{message:'Message authority refused'}}}));
  await expect(page.locator('[data-message]')).toHaveCount(1);
  status=403;await page.getByRole('button',{name:'Refresh messages'}).click();
  await expect(page.getByRole('status')).toHaveText('Message authority refused');
  await expect(page.locator('[data-message],.message-count')).toHaveCount(0);
  status=200;await page.getByRole('button',{name:'Refresh messages'}).click();await expect(page.locator('[data-message]')).toHaveCount(1);
  status=401;await page.getByRole('button',{name:'Refresh messages'}).click();await expect(page.getByRole('link',{name:'Student sign in'})).toBeVisible();
  await expect(page.locator('[data-message],.message-count')).toHaveCount(0);
  expect(await page.evaluate(()=>sessionStorage.getItem('svu.applicant.session'))).toBeNull();
});
