import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('campaign report loaders discard departed, superseded and revoked private caches',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.communicationReportingUI));
  expect(await page.evaluate(async () => {
    const output = [];
    for (const fail of [false,true]) {
      const state = {session:{token:'old'}};let deliver,reject;const pending = new Promise((ok,no) => {deliver = ok;reject = no;});
      const read = communicationReportingUI.load(state,() => pending);state.session.token = 'new';state.communicationReport = {marker:'new'};
      if (fail) reject(new Error('Old private error'));else deliver({marker:'old'});await read;output.push(state.communicationReport);
    }
    const state = {session:{token:'same'}};let deliver;const old = new Promise((ok) => {deliver = ok;});const read = communicationReportingUI.load(state,() => old);
    await communicationReportingUI.load(state,async () => ({marker:'current',filters:{}}));deliver({marker:'old'});await read;output.push(state.communicationReport);
    for (const status of [401,403,404]) {const denied = {session:{token:'same'},communicationReport:{private:1},communicationReportIntakes:[{private:2}],communicationReportFilters:{intakeId:'private'}};await communicationReportingUI.load(denied,async () => {const e = new Error('Denied');e.status = status;throw e;});output.push(Object.keys(denied));}
    const broken = {session:{token:'same'},communicationReport:{private:1}};await communicationReportingUI.load(broken,async (method,path) => {if (path.endsWith('/intakes')) return [];throw new Error('Reconcile');});output.push({report:broken.communicationReport,intakes:broken.communicationReportIntakes,error:broken.communicationReportError});return output;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'current',filters:{}},['session'],['session'],['session'],{report:null,intakes:[],error:'Reconcile'}]);
});

test('campaign reporting preserves private previews, captured audiences, native reads and fresh cancellation exports',async ({page,request},info) => {
  test.setTimeout(300_000);page.setDefaultTimeout(25000);
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Dam-Applicant-2026!',errors = [];let sequence = 0;
  page.on('pageerror',(e) => errors.push(e.message));
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const first = await intake('First'),second = await intake('Second'),hidden = await intake('PRIVATE');
  const learner = await account('learner'),other = await account('other'),office = await account('office');
  for (const [person,i] of [[learner,first],[other,first],[learner,second],[other,hidden]]) await api('POST','/api/admissions/applications',{intakeId:i.id},person.token);
  for (const person of [learner,other]) await api('PUT','/api/admissions/me/communications/preferences',{revision:0,inApp:true,email:true},person.token);
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'admissions_officer',scope:{programmeCodes:['BSC-IS'],intakeIds:[first.id,second.id]},reason:'Synthetic campaign report scope'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'auditor',scope:{},reason:'Unrelated global role'},admin.token);
  const one = await preview(first,office,['in_app','email']);await publish(one,office);
  const two = await preview(second,admin,['in_app']);await publish(two,admin);
  const ownLive = await preview(first,office,['in_app']);await preview(first,admin,['in_app']);
  const hiddenCampaign = await preview(hidden,admin,['in_app']);await publish(hiddenCampaign,admin);
  const inbox = await api('GET','/api/admissions/me/communications/messages',undefined,learner.token);
  await api('POST',`/api/admissions/me/communications/messages/${inbox.items[0].id}/read`,{},learner.token);
  const client = new pg.Client({connectionString:process.env.DATABASE_URL});expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);await client.connect();
  try {
    await clone('expired-own',ownLive.id,{expired:true});
    const report = await api('GET','/api/reports/communications',undefined,office.token);
    expect(report.totals).toMatchObject({campaignsTotal:4,publishedCampaigns:2,ownPreviews:2,liveOwnPreviews:1,expiredOwnPreviews:1,publishedApplications:3,publishedAccountOpportunities:3,publishedRecipientChannels:5,recipientChannels:5,recipientAccounts:2,inAppAvailable:3,inAppRead:1,inAppUnread:2,emailQueued:2,emailCancelled:0,publishSamples:2,readSamples:1});
    expect(report.rows.reduce((n,r) => n+r.counts.recipientAccounts,0)).toBe(3);expect(Object.values(report.controls).every(Boolean)).toBe(true);expect(report.providerDeliveryEvidenceAvailable).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/SECRET|PRIVATE|@example.com|subjectEncrypted|recipientEncrypted|createdBy/);
    expect((await api('GET','/api/reports/communications?status=preview',undefined,office.token)).totals).toMatchObject({campaignsTotal:2,publishedCampaigns:0,recipientChannels:0,meanReadMinutes:null});
    await denied(`/api/reports/communications?intakeId=${hidden.id}`,office.token,404);await denied('/api/reports/communications',learner.token,403);
    const day = report.generatedAt.slice(0,10);expect((await api('GET',`/api/reports/communications?from=${day}&to=${day}&status=published`,undefined,office.token)).totals.publishedCampaigns).toBe(2);
    const mean = (await client.query(`select avg(extract(epoch from r.read_at-r.created_at)/60)::double precision as mean from applicant_communication_recipients r join applicant_communication_campaigns c on c.id = r.campaign_id where c.intake_id = any($1::text[])`,[[first.id,second.id]])).rows[0].mean;expect(report.totals.meanReadMinutes).toBeCloseTo(mean,8);
    expect((await api('GET','/api/reports/communications/dictionary',undefined,office.token)).metrics).toHaveLength(29);
    await page.goto('/#admissions');await submit(page.locator('[data-form="staff-signin"]'),{email:office.email,password});
    await expect(page.locator('[data-communication-report]')).toBeVisible({timeout:45000});await expect(page.locator('[data-communication-report-filter]')).toBeEnabled();await page.locator('[data-communication-report] > summary').click();
    await expect(page.locator('[data-communication-metric="campaignsTotal"] td').last()).toHaveText('4');await expect(page.locator('[data-communication-report]')).not.toContainText('PRIVATE');
    await submit(page.locator('[data-communication-report-filter]'),{intakeId:'',status:'preview',from:'',to:''});await expect(page.locator('[data-communication-metric="campaignsTotal"] td').last()).toHaveText('2');
    await submit(page.locator('[data-communication-report-filter]'),{status:''});await expect(page.locator('[data-communication-metric="emailQueued"] td').last()).toHaveText('2');
    await api('PUT','/api/admissions/me/communications/preferences',{revision:1,inApp:true,email:false},learner.token);
    const pending = page.waitForEvent('download');await page.locator('[data-communication-report-export]').click();const download = await pending,csv = await readFile(await download.path(),'utf8');
    expect(csv).toMatch(/"total"[^\r\n]*"emailQueued","messages","1"/);expect(csv).toMatch(/"total"[^\r\n]*"emailCancelled","messages","1"/);expect(csv).not.toMatch(/SECRET|PRIVATE|@example.com/);
    await expect(page.locator('[data-communication-metric="emailQueued"] td').last()).toHaveText('2');await refresh();await expect(page.locator('[data-communication-metric="emailQueued"] td').last()).toHaveText('1');
    await client.query('update intakes set label = $2 where id = $1',[second.id,'=REPORT_FORMULA']);expect((await api('GET','/api/reports/communications?format=csv',undefined,office.token)).csv).toContain('"\'=REPORT_FORMULA"');
    await refresh();await page.locator('[data-communication-report]').evaluate((el) => {el.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-100);});
    await page.screenshot({path:info.outputPath('campaign-report-viewport.png')});await page.screenshot({path:info.outputPath('campaign-report.png'),fullPage:true});expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    // Two publication faults have equal total expected/actual recipients; per-campaign guards must still fail.
    const missing = await clone('missing-recipients',ownLive.id,{published:true}),surplus = await clone('surplus-recipients',ownLive.id,{published:true});
    for (const person of [learner,other]) await client.query(`insert into applicant_communication_recipients (id,campaign_id,account_id,channel,status,preference_revision) values ($1,$2,$3,'in_app','available',$4)`,[`acr_${randomUUID()}`,surplus,person.id,person.id === learner.id ? 2 : 1]);
    const balanced = (await client.query(`select sum((counts->>'recipientChannels')::integer) as expected,(select count(*) from applicant_communication_recipients where campaign_id = any($1::text[])) as actual from applicant_communication_campaigns where id = any($1::text[])`,[[missing,surplus]])).rows[0];expect(balanced.expected).toBe(balanced.actual);
    await denied('/api/reports/communications',office.token,409);await denied('/api/reports/communications?format=csv',office.token,409);await refresh();await expect(page.locator('[data-communication-report] [role="alert"]')).toContainText('reconciliation');await expect(page.locator('[data-communication-metric]')).toHaveCount(0);await expect(page.locator('[data-communication-report-export]')).toBeDisabled();
    await submit(page.locator('[data-communication-report-filter]'),{intakeId:second.id});await expect(page.locator('[data-communication-metric="publishedCampaigns"] td').last()).toHaveText('1');
    const audit = (await client.query("select reason,metadata from audit_events where actor_id = $1 and action = 'reports.communications.exported'",[office.id])).rows;expect(audit.length).toBeGreaterThanOrEqual(2);expect(JSON.stringify(audit)).not.toMatch(/SECRET|PRIVATE|REPORT_FORMULA|@example.com/);
    await client.query("update role_assignments set scope = $2::jsonb where account_id = $1 and role_code = 'admissions_officer'",[office.id,JSON.stringify({programmeCodes:['BSC-IS'],intakeIds:[first.id]})]);await refresh();await expect(page.locator('[data-communication-report]')).toHaveCount(0);
    await page.locator('[data-staff-signout]').click();await expect(page.locator('[data-form="staff-signin"]')).toBeVisible();
    const only = await account('communication-only'),role = `campaign_only_${stamp.replaceAll('.','_')}`;
    await client.query("insert into roles (code,name,risk) values ($1,'Synthetic campaign-only authority','low')",[role]);
    await client.query("insert into role_permissions (role_code,permission_code) values ($1,'admissions.communicate')",[role]);
    await api('POST','/api/access/role-assignments',{accountId:only.id,roleCode:role,scope:{programmeCodes:['BSC-IS'],intakeIds:[second.id]},reason:'Synthetic independent communications authority'},admin.token);
    await denied('/api/admissions/review/applications',only.token,403);
    await submit(page.locator('[data-form="staff-signin"]'),{email:only.email,password});await expect(page.locator('[data-communication-report]')).toBeVisible();await expect(page.locator('.staff-workspace')).toHaveCount(0);
    await page.locator('[data-communication-report] > summary').click();await expect(page.locator('[data-communication-metric="publishedCampaigns"] td').last()).toHaveText('1');await expect(page.locator('[data-communication-metric="ownPreviews"] td').last()).toHaveText('0');
    await page.locator('[data-staff-signout]').click();await expect(page.locator('[data-communication-report]')).toHaveCount(0);expect(errors).toEqual([]);
    async function clone(key,id,{expired = false,published = false} = {}) {
      const next = `acm_${randomUUID()}`;
      await client.query(`insert into applicant_communication_campaigns (id,intake_id,created_by,request_key,request_hash,subject_encrypted,body_encrypted,reason_encrypted,filters,channels,audience_encrypted,audience_hash,counts,status,created_at,expires_at,published_at)
        select $1,intake_id,created_by,$2,request_hash,subject_encrypted,body_encrypted,reason_encrypted,filters,channels,audience_encrypted,audience_hash,
          case when $4 then jsonb_build_object('applications',2,'accounts',2,'recipientChannels',1,'inApp',1,'email',0,'excludedInApp',1,'excludedEmail',0) else counts end,
          case when $4 then 'published' else 'preview' end,case when $3 then now()-interval '1 hour' else created_at end,
          case when $3 then now()-interval '45 minutes' else expires_at end,case when $4 then now() else null end
        from applicant_communication_campaigns where id = $5`,[next,`${key}-${stamp}`,expired,published,id]);return next;
    }
  } finally {await client.end();}
  async function refresh() {await page.locator('[data-communication-report-filter] button[type="submit"]').click();}
  async function preview(i,person,channels) {return api('POST','/api/admissions/communications/preview',{filters:{intakeId:i.id,status:'draft'},subject:'SECRET SUBJECT',body:'SECRET BODY',reason:'SECRET INTERNAL REASON',channels,requestKey:`preview-key-${stamp.replaceAll('.','_')}-${++sequence}`},person.token);}
  async function publish(row,person) {return api('POST',`/api/admissions/communications/campaigns/${row.id}/publish`,{},person.token);}
  async function intake(label) {const i = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2033-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${i.id}/transitions`,{toStatus:'published',reason:'Synthetic campaign report'},admin.token);return i;}
  async function account(label) {const email = `campaign-report.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Report ${label} ${stamp}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));const token = messages.find((r) => r.recipientEmail === email).variables.activationToken;await api('POST','/api/identity/activations',{token,password,preferredName:label,legalName:`Report ${label} ${stamp}`});const session = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,session.token);return {email,token:session.token,id:me.account.id};}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);else await field.fill(value);}await form.locator('button[type="submit"],button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(path,token,status) {const response = await request.get(path,{headers:{Authorization:`Bearer ${token}`}});expect(response.status(),await response.text()).toBe(status);}
});
