import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test('optional applicant group updates bind consent, scoped preview, publish retries and private inboxes',async ({page,browser,request},info) => {
  test.setTimeout(480000);
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Dam-Applicant-2026!',errors = [];
  page.on('pageerror',(error) => errors.push(error.message));
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'}),intake = await createIntake('Primary'),otherIntake = await createIntake('Hidden');
  const learner = await account('learner'),other = await account('other'),officer = await account('officer');
  await api('POST','/api/access/role-assignments',{accountId:officer.id,roleCode:'admissions_officer',scope:{programmeCodes:['BSC-IS'],intakeIds:[intake.id]},reason:'Synthetic communication scope'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:officer.id,roleCode:'auditor',scope:{},reason:'Unrelated global authority'},admin.token);
  const own = '/api/admissions/me/communications',base = '/api/admissions/communications';
  expect(await api('GET',`${own}/preferences`,undefined,learner.token)).toMatchObject({inApp:false,email:false,revision:0});
  await denied('POST',`${base}/preview`,{},learner.token,403);
  await api('POST','/api/admissions/applications',{intakeId:intake.id},learner.token);
  await api('POST','/api/admissions/applications',{intakeId:intake.id},other.token);
  const otherApplication = await api('POST','/api/admissions/applications',{intakeId:otherIntake.id},other.token);

  await page.goto('/#apply');await submit(page.locator('[data-form="signin"]'),{email:learner.email,password});
  await page.locator('[data-communication-preferences]').locator('..').locator('summary').click();
  const choices = page.locator('[data-communication-preferences]');await choices.locator('[name="inApp"]').check();await choices.locator('[name="email"]').check();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith(`${own}/preferences`));await choices.getByRole('button',{name:'Save preferences'}).click();expect((await saved).status()).toBe(200);
  await expect(page.locator('[data-communication-own]')).toContainText('No admissions updates.');
  await denied('PUT',`${own}/preferences`,{revision:0,inApp:false,email:false},learner.token,409);

  const context = await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name === 'mobile'}),staff = await context.newPage();staff.on('pageerror',(error) => errors.push(error.message));
  try {
    await staff.goto('/#admissions');await submit(staff.locator('[data-form="staff-signin"]'),{email:officer.email,password});
    await staff.locator('[data-admissions-tab=communication]').click();
    await staff.locator('[data-communication-staff] > summary').click();
    expect(await staff.locator('[data-communication-preview] [name="intakeId"] option').allTextContents()).toEqual([`BSC-IS - Primary ${stamp}`]);
    const subject = 'Optional update <img src=x onerror=alert(1)>',body = 'Private group update for consented applicants.',reason = 'INTERNAL CAMPAIGN REASON';
    let preview = await previewUI();expect(preview.counts).toMatchObject({applications:2,accounts:2,inApp:1,email:1,excludedInApp:1,excludedEmail:1});
    expect(JSON.stringify(preview.recipients)).not.toContain('@example.com');await expect(staff.locator('[data-communication-preview-result] img')).toHaveCount(0);
    await denied('POST',`${base}/preview`,{filters:{intakeId:otherIntake.id,status:'draft'},subject,body,reason,channels:['in_app'],requestKey:'hidden-audience'},officer.token,404);
    await api('PUT',`${own}/preferences`,{revision:0,inApp:true,email:false},other.token);
    const sourcePreview = await api('POST',`${base}/preview`,{filters:{intakeId:otherIntake.id,status:'draft'},subject,body,reason,channels:['in_app'],requestKey:`source_${stamp.replaceAll('.','_')}`},admin.token);
    expect(sourcePreview.counts.inApp).toBe(1);
    await denied('GET',`${base}/campaigns/${sourcePreview.id}`,undefined,officer.token,404);
    await api('POST',`/api/admissions/applications/${otherApplication.id}/withdraw`,{reason:'Synthetic source-status change'},other.token);
    expect(await denied('POST',`${base}/campaigns/${sourcePreview.id}/publish`,{},admin.token,409)).toMatchObject({message:'Audience or consent changed. Create a new preview.'});
    const stale = staff.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/campaigns/${preview.id}/publish`));await staff.locator('[data-communication-publish]').click();expect((await stale).status()).toBe(409);
    await expect(staff.locator('[data-communication-preview-result]')).toHaveCount(0);
    preview = await previewUI();expect(preview.counts).toMatchObject({inApp:2,email:1});
    const publishPath = `${base}/campaigns/${preview.id}/publish`,response = staff.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(publishPath));
    const clicking = staff.locator('[data-communication-publish]').click();
    const attempts = await Promise.all([api('POST',publishPath,{},officer.token),api('POST',publishPath,{},officer.token)]);await clicking;
    expect((await response).status()).toBe(200);expect(attempts.every((r) => r.id === preview.id)).toBe(true);await expect(staff.locator('[data-communication-preview-result]')).toContainText('Published');
    await page.locator('[data-communication-own-refresh]').click();await expect(page.locator('[data-communication-message]')).toHaveCount(1);
    await page.locator('[data-communication-message] > summary').click();await expect(page.locator('[data-communication-message]')).toContainText(body);await expect(page.locator('[data-communication-own]')).not.toContainText(reason);await expect(page.locator('[data-communication-own] img')).toHaveCount(0);
    const messages = await api('GET',`${own}/messages`,undefined,learner.token);expect(messages.items).toHaveLength(1);expect(JSON.stringify(messages)).not.toMatch(/emailConsent|recipient|requestHash|INTERNAL/);
    const foreignId = (await api('GET',`${own}/messages`,undefined,other.token)).items[0].id;await denied('POST',`${own}/messages/${foreignId}/read`,{},learner.token,404);
    await page.locator('[data-communication-read]').click();await expect(page.locator('[data-communication-read]')).toHaveCount(0);
    await api('PUT',`${own}/preferences`,{revision:1,inApp:true,email:false},learner.token);
    for (const p of [page,staff]) expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(p.viewportSize().width);
    await page.locator('[data-communication-own]').screenshot({path:info.outputPath('applicant-inbox.png')});await staff.locator('[data-communication-staff]').screenshot({path:info.outputPath('applicant-campaign.png')});
    await page.locator('[data-communication-own-refresh]').evaluate((b) => b.scrollIntoView({block:'center',behavior:'instant'}));await page.screenshot({path:info.outputPath('applicant-inbox-viewport.png')});
    await databaseChecks(preview.id,subject,body,reason);
    const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('svu.applicant.session')));await api('DELETE',`/api/identity/sessions/${session.sessionId}`,undefined,session.token);
    await page.locator('[data-communication-own-refresh]').click();await expect(page.locator('[data-form="signin"]')).toBeVisible();await expect(page.locator('[data-communication-own]')).toHaveCount(0);
    await staff.locator('[data-staff-signout]').click();await expect(staff.locator('[data-communication-staff]')).toHaveCount(0);
    expect(errors).toEqual([]);

    async function previewUI() {
      const form = staff.locator('[data-communication-preview]');await form.locator('[name="intakeId"]').selectOption(intake.id);await form.locator('[name="status"]').selectOption('draft');
      await form.locator('[name="inApp"]').check();await form.locator('[name="email"]').check();
      await form.locator('[name="subject"]').fill(subject);await form.locator('[name="body"]').fill(body);await form.locator('[name="reason"]').fill(reason);
      const pending = staff.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`${base}/preview`));await form.getByRole('button',{name:'Preview audience'}).click();const r = await pending;expect(r.status(),await r.text()).toBe(200);const result = (await r.json()).data;
      await expect(staff.locator('[data-communication-preview-result] h4')).toHaveText(subject);return result;
    }
  } finally {await context.close();}
  async function databaseChecks(id,subject,body,reason) {
    expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);
    const c = new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
    try {
      const campaign = (await c.query('select subject_encrypted,body_encrypted,reason_encrypted,audience_encrypted from applicant_communication_campaigns where id = $1',[id])).rows[0];expect(JSON.stringify(campaign)).not.toContain(subject);expect(JSON.stringify(campaign)).not.toContain(body);expect(JSON.stringify(campaign)).not.toContain(reason);expect(JSON.stringify(campaign)).not.toContain(learner.email);
      const recipients = (await c.query('select channel,status from applicant_communication_recipients where campaign_id = $1 order by channel,status',[id])).rows;expect(recipients).toEqual([{channel:'email',status:'cancelled'},{channel:'in_app',status:'available'},{channel:'in_app',status:'available'}]);
      const events = (await c.query("select reason,metadata from audit_events where subject_id = $1 and action like 'communications.%'",[id])).rows;expect(JSON.stringify(events)).not.toContain(subject);expect(JSON.stringify(events)).not.toContain(body);expect(JSON.stringify(events)).not.toContain(reason);expect(events.filter((e) => e.metadata.recipientChannels === 3)).toHaveLength(2);
      await c.query('begin');try {await expect(c.query('delete from applicant_communication_campaigns where id = $1',[id])).rejects.toThrow(/deleted/);} finally {await c.query('rollback');}
    } finally {await c.end();}
  }
  async function createIntake(label) {const i = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2035-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${i.id}/transitions`,{toStatus:'published',reason:'Synthetic communications intake'},admin.token);return i;}
  async function account(label) {const email = `communication.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Communications ${label}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));const token = messages.find((r) => r.recipientEmail === email).variables.activationToken;await api('POST','/api/identity/activations',{token,password,preferredName:label,legalName:`Communications ${label}`});const s = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,s.token);return {email,token:s.token,id:me.account.id};}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) await form.locator(`[name="${name}"]`).fill(value);await form.locator('button[type="submit"],button:not([type])').last().click();}
  async function api(method,path,data,token) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBe(true);return (await r.json()).data;}
  async function denied(method,path,data,token,status) {const r = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(r.status(),`${method} ${path}: ${await r.text()}`).toBe(status);return (await r.json()).error;}
});

test('communication loaders discard departed sessions and own cache generations',async ({page}) => {
  await page.goto('/#apply');await page.waitForFunction(() => Boolean(window.applicantCommunicationsUI));
  expect(await page.evaluate(async () => {
    let finish,token = 'old',ownCalls = 0,staffCalls = 0;const state = {session:{token},communicationOwnPreferences:{private:'old'}};
    const pending = new Promise((resolve) => {finish = resolve;});
    const own = applicantCommunicationsUI.loadOwn(state,() => {ownCalls++;return pending;},() => token);token = 'new';applicantCommunicationsUI.clearOwn(state);state.communicationOwnInbox = {private:'new'};finish({items:[]});await own;
    let release;const old = new Promise((resolve) => {release = resolve;});state.session.token = 'old';const staff = applicantCommunicationsUI.loadStaff(state,() => {staffCalls++;return old;});state.session.token = 'new';state.communicationStaffList = {private:'new'};release({items:[]});await staff;
    return {own:state.communicationOwnInbox,staff:state.communicationStaffList,preferences:state.communicationOwnPreferences,ownCalls,staffCalls};
  })).toEqual({own:{private:'new'},staff:{private:'new'},preferences:undefined,ownCalls:1,staffCalls:1});
  expect(await page.evaluate(async () => {
    const state = {session:{token:'active'},communicationStaffAuthorized:true,communicationStaffMetadata:{intakes:[{intakeId:'I',programmeCode:'P',label:'PRIVATE INTAKE'}],states:[]},communicationStaffList:{items:[{id:'C',subject:'PRIVATE HISTORY',intakeLabel:'PRIVATE INTAKE',status:'published',counts:{recipientChannels:1}}],offset:0},communicationStaffDraft:{subject:'PRIVATE DRAFT',body:'Private body',reason:'Private reason',inApp:true}};
    const root = document.createElement('div');root.innerHTML = applicantCommunicationsUI.staffView(state);let pending;
    applicantCommunicationsUI.staffBind(root,state,{api:async () => {const e = new Error('Authority changed');e.status = 403;throw e;},act:(work) => {pending = work().catch(() => {});}});
    root.querySelector('[data-communication-preview]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pending;
    const html = applicantCommunicationsUI.staffView(state);
    return {containsPrivate:html.includes('PRIVATE'),hasRefresh:html.includes('data-communication-staff-refresh'),metadata:state.communicationStaffMetadata,list:state.communicationStaffList,draft:state.communicationStaffDraft};
  })).toEqual({containsPrivate:false,hasRefresh:true,metadata:null,list:null,draft:null});
});
