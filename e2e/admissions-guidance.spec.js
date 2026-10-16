import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test('governed guidance binds scope, independent approval, immutable versions and public expiry',async ({page,browser,request},info) => {
  test.setTimeout(360000);
  const stamp = `${info.project.name}.${Date.now()}`,word = `guidance${Date.now()}`,password = 'Kariba-Guidance-2026!',errors = [],base = '/api/guidance/manage/articles';
  page.on('pageerror',(e) => errors.push(e.message));
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const intake = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`Guidance ${stamp}`,capacity:10,startsOn:'2035-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api('POST',`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:'published',reason:'Synthetic guidance source'},admin.token);
  const officer = await account('officer','admissions_officer'),reviewer = await account('reviewer','admissions_manager');
  await api('POST','/api/access/role-assignments',{accountId:officer.id,roleCode:'auditor',scope:{},reason:'Unrelated global role'},admin.token);
  const today = new Date().toISOString().slice(0,10),yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10),future = new Date(Date.now()+86400000*2).toISOString().slice(0,10);
  const title = `${word} <img src=x onerror=alert(1)>`,body = 'SYNTHETIC public admissions guidance. No admission decision.',sourceRef = 'Synthetic test public reference',reason = 'PRIVATE GUIDANCE REVIEW REASON';
  const draft = {programmeId:'prog_bsc_is',intakeId:intake.id,title,body,sourceRef,effectiveFrom:today,validUntil:null,reason,requestKey:`guidance_${stamp.replaceAll('.','_')}`};
  await denied('POST',base,{...draft,programmeId:null,intakeId:null},officer.token,404);
  await denied('POST',base,{...draft,intakeId:null},officer.token,404);
  await page.goto('/#admissions');await signIn(page,officer);
  await page.locator('[data-guidance-staff] > summary').click();
  const editor = page.locator('[data-guidance-editor]');expect(await editor.locator('[name="scope"] option').allTextContents()).toEqual(['Choose scope',`BSC-IS - Guidance ${stamp}`]);
  await editor.locator('[name="scope"]').selectOption(`intake:${intake.id}`);
  await fill(editor,{title,body,sourceRef,effectiveFrom:today,reason});
  const saving = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(base));await editor.getByRole('button',{name:'Save draft'}).click();const saved = await saving;expect(saved.status(),await saved.text()).toBe(200);let article = (await saved.json()).data;
  await expect(page.locator('[data-guidance-detail]')).toContainText(title);await expect(page.locator('[data-guidance-detail] img')).toHaveCount(0);await expect(page.locator('[data-guidance-publish]')).toHaveCount(0);
  expect((await api('GET',`/api/guidance/articles?q=${word}`)).items).toHaveLength(0);
  await denied('POST',`${base}/${article.id}/versions/${article.versions[0].id}/publish`,{revision:article.revision,reason:'Officer cannot publish'},officer.token,403);
  const replayInput = {...draft,requestKey:`api_${stamp.replaceAll('.','_')}`},apiDraft = await api('POST',base,replayInput,reviewer.token);
  expect((await api('POST',base,replayInput,reviewer.token)).id).toBe(apiDraft.id);
  await denied('POST',base,{...replayInput,body:'Changed'},reviewer.token,409);
  await denied('POST',`${base}/${apiDraft.id}/versions/${apiDraft.versions[0].id}/publish`,{revision:1,reason:'Self approval denied'},reviewer.token,403);
  await denied('GET',`${base}/${article.id}`,undefined,(await account('other','admissions_manager',[])).token,404);

  const context = await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name === 'mobile'}),review = await context.newPage();review.on('pageerror',(e) => errors.push(e.message));
  try {
    await review.goto('/#admissions');await signIn(review,reviewer);await review.locator('[data-guidance-staff] > summary').click();
    await review.locator(`[data-guidance-open="${article.id}"]`).click();await expect(review.locator('[data-guidance-publish]')).toBeVisible();
    const approving = review.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/publish'));
    await review.locator('[data-guidance-publish] [name="reason"]').fill('Reviewed synthetic public reference');await review.locator('[data-guidance-publish]').getByRole('button',{name:'Publish version'}).click();const approval = await approving;expect(approval.status(),await approval.text()).toBe(200);article = (await approval.json()).data;
    await expect(review.locator('[data-guidance-detail]')).toContainText('Version 1 - published');
    expect((await api('POST',`${base}/${article.id}/versions/${article.versions[0].id}/publish`,{revision:1,reason:'Safe repeated approval'},reviewer.token)).revision).toBe(2);
    await page.goto('/#apply');await expect(page.locator('[data-guidance-public]')).toBeVisible();
    await search();await page.locator(`[data-guidance-article="${article.id}"] > summary`).click();await expect(page.locator('[data-guidance-public]')).toContainText(body);await expect(page.locator('[data-guidance-public]')).not.toContainText(reason);await expect(page.locator('[data-guidance-public] img')).toHaveCount(0);
    const publicRows = await api('GET',`/api/guidance/articles?q=${word}`);expect(publicRows.items).toHaveLength(1);expect(JSON.stringify(publicRows)).not.toMatch(/createdBy|publishedBy|reasonEncrypted|PRIVATE GUIDANCE/);
    for (const p of [page,review]) expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(p.viewportSize().width);
    await page.locator('[data-guidance-public]').screenshot({path:info.outputPath('guidance-public.png')});await review.locator('[data-guidance-detail]').screenshot({path:info.outputPath('guidance-review.png')});
    await page.locator('[data-guidance-public]').evaluate((e) => e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:info.outputPath('guidance-public-viewport.png')});
    await review.locator('[data-guidance-detail]').evaluate((e) => e.scrollIntoView({block:'start',behavior:'instant'}));await review.screenshot({path:info.outputPath('guidance-review-viewport.png')});

    const {programmeId,intakeId,requestKey,...content} = draft;
    const versionInput = {...content,effectiveFrom:future,revision:2,requestKey:`version_${stamp.replaceAll('.','_')}`};
    article = await api('POST',`${base}/${article.id}/versions`,versionInput,officer.token);
    expect((await api('POST',`${base}/${article.id}/versions`,versionInput,officer.token)).revision).toBe(3);
    await denied('POST',`${base}/${article.id}/versions`,{...versionInput,requestKey:`stale_${stamp.replaceAll('.','_')}`},officer.token,409);
    article = await api('POST',`${base}/${article.id}/versions/${article.versions[0].id}/publish`,{revision:3,reason:'Future publication'},reviewer.token);
    expect((await api('GET',`/api/guidance/articles?q=${word}`)).items[0].version).toBe(1);
    article = await api('POST',`${base}/${article.id}/versions`,{...content,effectiveFrom:yesterday,validUntil:yesterday,revision:4,requestKey:`expired_${stamp.replaceAll('.','_')}`},officer.token);
    article = await api('POST',`${base}/${article.id}/versions/${article.versions[0].id}/publish`,{revision:5,reason:'Synthetic expired replacement'},reviewer.token);
    expect((await api('GET',`/api/guidance/articles?q=${word}`)).items).toHaveLength(0);
    await databaseChecks(article.id);
    await review.locator('[data-guidance-refresh]').click();await expect(review.locator('[data-guidance-detail]')).toContainText('Version 3 - published');
    await review.locator('[data-guidance-withdraw] [name="reason"]').fill('Withdraw synthetic guidance');const withdrawing = review.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/withdraw'));await review.locator('[data-guidance-withdraw]').getByRole('button',{name:'Withdraw article'}).click();expect((await withdrawing).status()).toBe(200);
    await expect(review.locator('[data-guidance-detail]')).toContainText('withdrawn');await expect(review.locator('[data-guidance-editor]')).toHaveCount(0);
    await denied('POST',`${base}/${article.id}/versions`,{...content,revision:7,requestKey:`closed_${stamp.replaceAll('.','_')}`},officer.token,409);
    await review.locator('[data-staff-signout]').click();await expect(review.locator('[data-guidance-staff]')).toHaveCount(0);expect(errors).toEqual([]);
  } finally {await context.close();}
  async function search() {const f = page.locator('[data-guidance-search]');await f.locator('[name="q"]').fill(word);await f.getByRole('button',{name:'Search',exact:true}).click();await expect(page.locator('[data-guidance-article]')).toHaveCount(1);}
  async function signIn(p,a) {const f = p.locator('[data-form="staff-signin"]');await fill(f,{email:a.email,password});await f.locator('button[type="submit"],button:not([type])').last().click();await p.locator('[data-admissions-tab=guidance]').click();await expect(p.locator('[data-guidance-staff]')).toBeVisible();}
  async function fill(f,values) {for (const [name,value] of Object.entries(values)) await f.locator(`[name="${name}"]`).fill(value);}
  async function account(label,role,intakeIds = [intake.id]) {
    const email = `guidance.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Guidance ${label}`});
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));
    await api('POST','/api/identity/activations',{token:messages.find((r) => r.recipientEmail === email).variables.activationToken,password,preferredName:label,legalName:`Guidance ${label}`});
    const session = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,session.token);
    await api('POST','/api/access/role-assignments',{accountId:me.account.id,roleCode:role,scope:{programmeCodes:intakeIds.length ? ['BSC-IS'] : ['BBA'],intakeIds},reason:'Synthetic scoped guidance'},admin.token);
    return {id:me.account.id,email,token:session.token};
  }
  async function databaseChecks(id) {
    expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);const c = new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
    try {
      const versions = (await c.query('select title_encrypted,body_encrypted,reason_encrypted,search_document from guidance_versions where article_id = $1',[id])).rows;
      for (const v of versions) {expect(v.title_encrypted).not.toContain(word);expect(v.body_encrypted).not.toContain(body);expect(v.reason_encrypted).not.toContain(reason);expect(String(v.search_document)).not.toContain('PRIVATE');}
      const events = (await c.query("select reason,metadata from audit_events where subject_id = $1 and action like 'guidance.%'",[id])).rows;expect(JSON.stringify(events)).not.toContain(reason);expect(JSON.stringify(events)).not.toContain(body);
      for (const sql of ['delete from guidance_articles where id = $1','update guidance_versions set body_encrypted = body_encrypted where article_id = $1','delete from guidance_history where article_id = $1']) {await c.query('begin');try {await expect(c.query(sql,[id])).rejects.toThrow();} finally {await c.query('rollback');}}
    } finally {await c.end();}
  }
  async function api(method,path,data,token) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBe(true);return (await r.json()).data;}
  async function denied(method,path,data,token,status) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.status(),`${method} ${path}: ${await r.text()}`).toBe(status);}
});

test('guidance UI discards departed reads and freezes draft retry payloads across refresh',async ({page}) => {
  await page.goto('/#apply');await expect(page.locator('[data-guidance-public]')).toBeVisible();
  const result = await page.evaluate(async () => {
    const ui = window.admissionsGuidanceUI,departed = {session:{token:'old'}};let calls = 0;
    await ui.loadStaff(departed,async () => {calls++;departed.session = null;return {};});
    const metadata = {institutional:false,programmes:[{id:'P',programmeCode:'CODE',canDraft:false}],intakes:[{intakeId:'I',programmeId:'P',programmeCode:'CODE',label:'Intake',canDraft:true}]};
    const article = {id:'A',revision:1,status:'active',programmeCode:'CODE',intakeLabel:'Intake',canDraft:true,canWithdraw:false,versions:[],history:[]};
    const state = {session:{token:'owner'},guidanceAuthorized:true,guidanceMetadata:metadata,guidanceList:{items:[],offset:0},guidanceDetail:article,guidanceSelectedId:'A',guidanceOpen:true};
    const root = document.createElement('div');document.body.append(root);const posts = [];let pending,lastError;
    const api = async (method,path,data) => {
      if (method === 'POST') {posts.push(structuredClone(data));if (posts.length === 1) throw new Error('Interrupted response');return {...article,revision:2};}
      if (path.endsWith('/metadata')) return metadata;
      if (path.includes('offset=')) return {items:[],offset:0};
      return {...article,revision:2};
    };
    const bind = () => {root.innerHTML = ui.staffView(state);ui.staffBind(root,state,{api,act:(work) => {pending = work().catch((e) => {lastError = e.message;});}});};
    bind();let form = root.querySelector('[data-guidance-editor]');
    for (const [name,value] of Object.entries({title:'Retry title',body:'Retained private draft',sourceRef:'Public reference',effectiveFrom:'2026-10-05',reason:'Private reason'})) {form.elements[name].value = value;form.elements[name].dispatchEvent(new Event('input',{bubbles:true}));}
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pending;
    const retained = state.guidanceDraft.body;await ui.loadStaff(state,api);bind();form = root.querySelector('[data-guidance-editor]');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pending;
    const retrySame = JSON.stringify(posts[0]) === JSON.stringify(posts[1]),intentCleared = !state.guidanceSubmission && !state.guidanceDraft;
    Object.assign(state,{guidanceDraft:{body:'private'},guidanceSubmission:{data:{body:'private'}},guidanceKey:'key',guidanceReviewReason:'private',guidanceWithdrawalReason:'private'});
    await ui.loadStaff(state,async () => {throw Object.assign(new Error('Revoked'),{status:403});});
    const erased = ['guidanceMetadata','guidanceList','guidanceDetail','guidanceDraft','guidanceSubmission','guidanceKey','guidanceReviewReason','guidanceWithdrawalReason'].every((key) => state[key] === undefined);
    root.remove();return {calls,retained,lastError,retrySame,intentCleared,erased,revision:posts[1].revision};
  });
  expect(result).toEqual({calls:1,retained:'Retained private draft',lastError:'Interrupted response',retrySame:true,intentCleared:true,erased:true,revision:1});
});
