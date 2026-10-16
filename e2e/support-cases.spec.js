import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

test('student support cases retain scoped assignment, private notes, escalation and resolution history',async ({page,browser,request},info) => {
  test.setTimeout(480_000);page.setDefaultTimeout(20_000);
  const errors = [];page.on('pageerror',(error) => errors.push(error.message));
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Dam-Applicant-2026!';
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const first = await intake('Support first'),second = await intake('Support second');
  const learner = await account('student'),other = await account('other'),officer = await account('officer'),manager = await account('manager'),outside = await account('outside');
  await denied('GET','/api/support/me/cases',undefined,learner.token,403);
  const programme = await admit(learner,first),otherProgramme = await admit(other,second);
  for (const [person,role,intakeId] of [[officer,'support_officer',first.id],[manager,'support_manager',first.id],[outside,'support_manager',second.id]]) await api('POST','/api/access/role-assignments',{accountId:person.id,roleCode:role,scope:{programmeCodes:['BSC-IS'],intakeIds:[intakeId]},reason:'Synthetic support scope'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:officer.id,roleCode:'auditor',scope:{},reason:'Unrelated global authority must not widen support'},admin.token);
  await denied('GET','/api/registry/students',undefined,officer.token,403);
  await denied('POST','/api/support/me/cases',{programmeId:otherProgramme.id,subject:'Wrong owner',category:'other',body:'Private',requestKey:'wrong-owner'},learner.token,404);
  const hidden = await api('POST','/api/support/me/cases',{programmeId:otherProgramme.id,subject:'HIDDEN OTHER CASE',category:'academic',body:'HIDDEN OTHER MESSAGE',requestKey:'hidden-case'},other.token);
  await denied('GET',`/api/support/cases/${hidden.id}`,undefined,officer.token,404);
  await denied('GET',`/api/support/cases?intakeId=${second.id}`,undefined,officer.token,404);
  await denied('POST',`/api/support/cases/${hidden.id}/comment`,{revision:1,body:'Forbidden',visibility:'public',requestKey:'wrong-scope'},officer.token,404);

  await page.goto('/#apply');await submit(page.locator('[data-form="signin"]'),{email:learner.email,password});
  await expect(page.locator('[data-support-student]')).toBeVisible({timeout:30000});
  await page.locator('[data-support-create-panel] > summary').click();
  const subject = 'Registration feedback <img src=x onerror=alert(1)>',body = 'Private student message about my registration.';
  await submit(page.locator('[data-support-create]'),{subject,category:'registration',body});
  await expect(page.locator('[data-support-detail] h3')).toHaveText(subject);
  await expect(page.locator('[data-support-detail] img')).toHaveCount(0);
  let own = await api('GET',`/api/support/me/cases?programmeId=${programme.id}`,undefined,learner.token),caseId = own.items[0].id;
  expect(own.total).toBe(1);expect(own.items[0]).toMatchObject({status:'open',priority:'normal',category:'registration',revision:1});
  await denied('GET',`/api/support/me/cases/${caseId}`,undefined,other.token,404);
  await denied('POST',`/api/support/me/cases/${caseId}/update`,{revision:1,reason:'Student staff bypass'},learner.token,403);
  await denied('POST',`/api/support/me/cases/${caseId}/comment`,{revision:1,body:'Hidden',visibility:'internal',requestKey:'student-private'},learner.token,400);
  const retry = {programmeId:programme.id,subject:'Retry-safe second case',category:'feedback',body:'Same request delivered twice.',requestKey:'concurrent-case'};
  const attempts = await Promise.all([api('POST','/api/support/me/cases',retry,learner.token),api('POST','/api/support/me/cases',retry,learner.token)]);expect(attempts[0].id).toBe(attempts[1].id);
  await denied('POST','/api/support/me/cases',{...retry,body:'Different payload'},learner.token,409);
  const casePath = `/api/support/cases/${caseId}`,ownPath = `/api/support/me/cases/${caseId}`;

  const staffContext = await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name === 'mobile'}),staff = await staffContext.newPage();
  staff.on('pageerror',(error) => errors.push(error.message));
  try {
    await signInStaff(officer);await staff.locator('[data-support-workspace] > summary').click();
    await expect(staff.locator('[data-support-workspace]')).not.toContainText('HIDDEN OTHER CASE');
    await staff.locator(`[data-support-open="${caseId}"]`).click();await expect(staff.locator('[data-support-detail] h3')).toHaveText(subject);
    await staff.locator('[data-support-action="update"]').locator('..').locator('summary').click();
    await submit(staff.locator('[data-support-action="update"]'),{category:'registration',priority:'high',status:'waiting_student',assigneeId:officer.id,reason:'INTERNAL TRIAGE REASON'});
    await expect(staff.locator('[data-support-detail] .pill').first()).toHaveText('waiting student');
    let current = await api('GET',casePath,undefined,officer.token);expect(current.assignees.some((entry) => entry.id === outside.id)).toBe(false);
    const noteResponse = staff.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`${casePath}/comment`));
    await submit(staff.locator('[data-support-action="comment"]'),{body:'STAFF ONLY CONFIDENTIAL NOTE',visibility:'internal'});
    expect((await noteResponse).status()).toBe(200);await expect(staff.locator('[data-support-comment]').last()).toContainText('STAFF ONLY CONFIDENTIAL NOTE');
    current = await api('GET',casePath,undefined,officer.token);expect(current.comments.at(-1)).toMatchObject({visibility:'internal',body:'STAFF ONLY CONFIDENTIAL NOTE'});
    const publicReply = {revision:current.revision,body:'Please confirm the course code.',visibility:'public',requestKey:'public-reply'};
    const sent = await api('POST',`${casePath}/comment`,publicReply,officer.token),replayed = await api('POST',`${casePath}/comment`,publicReply,officer.token);expect(sent.revision).toBe(replayed.revision);
    await page.locator('[data-support-detail-refresh]').click();await expect(page.locator('[data-support-comment]').last()).toContainText('Please confirm the course code.');
    await expect(page.locator('[data-support-student]')).not.toContainText('STAFF ONLY CONFIDENTIAL NOTE');
    const privateSafe = await api('GET',ownPath,undefined,learner.token);expect(JSON.stringify(privateSafe)).not.toMatch(/STAFF ONLY|INTERNAL TRIAGE|Encrypted|assigneeId/);expect(privateSafe.history.some((entry) => entry.action === 'status_changed')).toBe(true);
    await submit(page.locator('[data-support-action="comment"]'),{body:'The course code is IS101.'});
    await expect(page.locator('[data-support-detail] .pill').first()).toHaveText('in progress');
    current = await api('GET',casePath,undefined,officer.token);
    const races = await Promise.all(['one','two'].map((suffix) => request.post(`${casePath}/comment`,{data:{revision:current.revision,body:`Concurrent ${suffix}`,visibility:'internal',requestKey:`race-${suffix}`},headers:{Authorization:`Bearer ${officer.token}`}})));
    expect(races.map((response) => response.status()).sort()).toEqual([200,409]);
    await staff.locator('[data-support-detail-refresh]').click();await expect(staff.locator('[data-support-detail-refresh]')).toBeEnabled();
    await staff.locator('[data-support-action="escalate"]').locator('..').locator('summary').click();
    await submit(staff.locator('[data-support-action="escalate"]'),{assigneeId:manager.id,reason:'PRIVATE ESCALATION ROUTING'});
    await expect(staff.locator('[data-support-detail]')).toContainText('Escalated');
    current = await api('GET',casePath,undefined,officer.token);expect(current).toMatchObject({escalated:true,escalationLevel:1,assigneeId:manager.id});
    await denied('POST',`${casePath}/update`,{revision:current.revision,category:'registration',priority:'high',status:'resolved',assigneeId:manager.id,reason:'Officer cannot resolve escalation'},officer.token,403);
    expect(JSON.stringify(await api('GET',ownPath,undefined,learner.token))).not.toContain('PRIVATE ESCALATION ROUTING');
    await expect(staff.locator('[data-support-action="update"]')).toHaveCount(0);
    await staff.screenshot({path:info.outputPath('support-officer-escalated.png'),fullPage:true});
    await staff.locator('[data-registry-signout]').click();await expect(staff.locator('[data-registry-login]')).toBeVisible();await expect(staff.locator('[data-support-detail]')).toHaveCount(0);
    await signInStaff(manager);await staff.locator('[data-support-workspace] > summary').click();await staff.locator(`[data-support-open="${caseId}"]`).click();
    await staff.locator('[data-support-action="update"]').locator('..').locator('summary').click();
    await submit(staff.locator('[data-support-action="update"]'),{category:'registration',priority:'high',status:'resolved',assigneeId:manager.id,reason:'The course selection issue is resolved.'});
    await expect(staff.locator('[data-support-detail] .pill').first()).toHaveText('resolved');
    await page.locator('[data-support-detail-refresh]').click();await expect(page.locator('[data-support-action="close"]')).toBeVisible();
    await submit(page.locator('[data-support-action="close"]'),{reason:'Confirmed resolved, thank you.'});await expect(page.locator('[data-support-detail] .pill').first()).toHaveText('closed');
    await submit(page.locator('[data-support-action="reopen"]'),{reason:'I have a follow-up question.'});await expect(page.locator('[data-support-detail] .pill').first()).toHaveText('open');
    const final = await api('GET',ownPath,undefined,learner.token);expect(final).toMatchObject({status:'open',escalated:false,escalationLevel:1,resolvedAt:null,closedAt:null});expect(final.history.map((row) => row.action)).toContain('close');
    for (const currentPage of [page,staff]) expect(await currentPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(currentPage.viewportSize().width);
    await page.locator('[data-support-detail]').screenshot({path:info.outputPath('support-student-case.png')});
    await staff.locator('[data-support-workspace]').screenshot({path:info.outputPath('support-manager-workspace.png')});
    await page.locator('[data-support-action="comment"] button').evaluate((button) => button.scrollIntoView({block:'center',behavior:'instant'}));
    if (info.project.name === 'mobile') expect(await page.locator('[data-support-action="comment"] button').evaluate((button) => button.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
    await page.screenshot({path:info.outputPath('support-student-viewport.png')});
    await databaseChecks(caseId,subject,body,attempts[0].id);
    const malformed = await request.get(`/api/support/me/cases/${attempts[0].id}`,{headers:{Authorization:`Bearer ${learner.token}`}});
    expect(malformed.status()).toBe(409);expect((await malformed.json()).error.message).toBe('Support case text requires reconciliation.');
    const ownSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem('svu.applicant.session')));
    await api('DELETE',`/api/identity/sessions/${ownSession.sessionId}`,undefined,ownSession.token);
    await page.locator('[data-support-detail-refresh]').click();await expect(page.locator('[data-form="signin"]')).toBeVisible();await expect(page.locator('[data-support-student]')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('svu.applicant.session'))).toBeNull();
    const staffSession = await staff.evaluate(() => JSON.parse(sessionStorage.getItem('svu.registry.session')));
    await api('DELETE',`/api/identity/sessions/${staffSession.sessionId}`,undefined,staffSession.token);await staff.locator('[data-support-detail-refresh]').click();await expect(staff.locator('[data-registry-login]')).toBeVisible();await expect(staff.locator('[data-support-workspace]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {await staffContext.close();}

  async function databaseChecks(id,subject,body,faultCaseId) {
    const databaseUrl = process.env.DATABASE_URL;expect(new URL(databaseUrl).pathname.startsWith('/svu_rebuild_it_')).toBe(true);
    const c = new pg.Client({connectionString:databaseUrl});await c.connect();
    try {
      const stored = (await c.query('select subject_encrypted from support_cases where id = $1',[id])).rows[0];expect(stored.subject_encrypted).not.toContain(subject);
      const messages = (await c.query('select body_encrypted from support_case_comments where case_id = $1',[id])).rows;expect(JSON.stringify(messages)).not.toContain(body);expect(JSON.stringify(messages)).not.toContain('STAFF ONLY');
      const audit = (await c.query("select reason,metadata from audit_events where subject_id = $1 and action like 'support.%'",[id])).rows;expect(JSON.stringify(audit)).not.toMatch(/STAFF ONLY|PRIVATE ESCALATION|Private student message|INTERNAL TRIAGE/);
      for (const table of ['support_case_comments','support_case_history']) {
        await c.query('begin');try {await expect(c.query(`delete from ${table} where case_id = $1`,[id])).rejects.toThrow(/append|immutable|deleted/i);} finally {await c.query('rollback');}
      }
      await c.query('begin');try {await expect(c.query('update support_cases set revision = revision + 1, subject_encrypted = $2 where id = $1',[id,'changed'])).rejects.toThrow(/immutable/);} finally {await c.query('rollback');}
      await c.query(`insert into support_case_comments (id,case_id,revision,author_id,author_kind,visibility,body_encrypted,request_key,request_hash) values ($1,$2,1,$3,'student','public',$4,'source-fault',$5)`,[`scc_fault_${randomUUID()}`,faultCaseId,learner.id,'PRIVATE MALFORMED TEXT MUST NOT LEAK','0'.repeat(64)]);
    } finally {await c.end();}
  }
  async function signInStaff(person) {await staff.goto('/#registry');await submit(staff.locator('[data-registry-login]'),{email:person.email,password});await expect(staff.locator('[data-support-workspace]')).toBeVisible();}
  async function intake(label) {const i = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2033-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${i.id}/transitions`,{toStatus:'published',reason:'Synthetic support intake'},admin.token);return i;}
  async function admit(person,i) {await api('POST','/api/admissions/migrations',{source:`SAMPLE-SUPPORT-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:i.id,state:'Accepted',referenceNumber:`SAMPLE-${stamp}-${person.id}`,studyModeCode:'FULL_TIME',answers:{applicantCategory:'standard'},documents:[],decision:{decision:'offer',conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);return (await api('GET','/api/registry/me',undefined,person.token)).programmes.find((row) => row.intakeId === i.id);}
  async function account(label) {const email = `support.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Support ${label} ${stamp}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api('POST','/api/identity/activations',{token,password,preferredName:label,legalName:`Support ${label} ${stamp}`});const session = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,session.token);return {email,token:session.token,id:me.account.id};}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);else await field.fill(value);}await form.locator('button[type="submit"],button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});

test('support loaders reject departed sessions and programme switches without restoring private state',async ({page}) => {
  await page.goto('/#apply');await page.waitForFunction(() => Boolean(window.supportCasesUI));
  expect(await page.evaluate(async () => {
    const results = [];
    for (const self of [false,true]) for (const fail of [false,true]) {
      let token = 'old',deliver,reject;const state = {session:{token},supportStaffDetail:null};
      const pending = new Promise((resolve,fail) => {deliver = resolve;reject = fail;});
      const read = self ? supportCasesUI.loadStudent(state,() => pending,'old-programme',() => token) : supportCasesUI.loadStaff(state,() => pending);
      token = 'new';state.session.token = token;if (self) supportCasesUI.clearStudent(state);state[self ? 'supportStudentList' : 'supportStaffList'] = {marker:'new'};
      if (fail) reject(new Error('Old private error'));else deliver({marker:'old'});await read;results.push(state[self ? 'supportStudentList' : 'supportStaffList']);
    }
    const state = {},pending = {};let release;const old = new Promise((resolve) => {release = resolve;});
    const read = supportCasesUI.loadStudent(state,() => old,'old-programme',() => 'same-session');supportCasesUI.clearStudent(state);state.supportStudentList = {marker:'new-programme'};release(pending);await read;results.push(state.supportStudentList);
    const switched = {selectedApplicationId:'new-app',selectedProgrammeId:'new-programme',supportStudentList:{marker:'current-context'}};let calls = 0;
    await supportCasesUI.loadStudent(switched,() => {calls++;return Promise.resolve({marker:'old'});},'old-programme',() => 'same-session',{applicationId:'old-app',programmeId:'old-programme'});
    results.push({list:switched.supportStudentList,calls});return results;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'new'},{marker:'new'},{marker:'new-programme'},{list:{marker:'current-context'},calls:0}]);
  expect(await page.evaluate(async () => {
    const state = {supportStudentDetail:{id:'retained',programmeId:'different-owned-programme'}},calls = [];
    await supportCasesUI.loadStudent(state,async (method,path) => {calls.push(path);return path.includes('?') ? {items:[]} : {id:'retained',programmeId:'different-owned-programme'};},'current-programme',() => 'active');
    return {calls,detail:state.supportStudentDetail};
  })).toEqual({calls:['/api/support/me/cases?offset=0','/api/support/me/cases/retained'],detail:{id:'retained',programmeId:'different-owned-programme'}});
});

test('support forms retain drafts and retry keys, fit compact viewports and recover without stale private data',async ({page},info) => {
  await page.goto('/#apply');await page.waitForFunction(() => Boolean(window.supportCasesUI) && admissionsData.catalogue !== null);
  await expect(page.locator('[data-form="signin"]')).toBeVisible();
  await page.evaluate(() => {
    const empty = {items:[],total:0,limit:25,offset:0,availableIntakes:[]},state = {supportStudentList:empty,supportStudentProgrammeId:'programme',supportStudentCreateOpen:true},root = document.querySelector('#app');
    let row = null,createCount = 0,commentCount = 0;window.supportDraftState = state;window.supportPosts = [];
    const api = async (method,path,input) => {
      if (method === 'GET') {if (path.includes('?')) return {...empty,total:row ? 1 : 0,items:row ? [row] : []};if (window.failSupportDetail) throw new Error('Case read unavailable');return row;}
      window.supportPosts.push({path,input:{...input}});
      if (!path.endsWith('/comment')) {
        if (++createCount === 1) return new Promise((resolve,reject) => {window.rejectSupportCreate = () => reject(new Error('Interrupted create response'));});
        row = {id:'case',programmeId:'programme',intakeLabel:'Extended student programme intake with a long descriptive name',studentNumber:'S123',subject:input.subject,status:'open',category:input.category,priority:'normal',escalated:false,escalationLevel:0,revision:1,assignees:[],comments:[{id:'first',body:input.body,authorKind:'student',visibility:'public',createdAt:'2026-10-05T11:00:00Z'}],history:[],createdAt:'2026-10-05T11:00:00Z',updatedAt:'2026-10-05T11:00:00Z'};
      } else {
        if (++commentCount === 1) return new Promise((resolve,reject) => {window.rejectSupportComment = () => reject(new Error('Interrupted comment response'));});
        row = {...row,revision:row.revision+1,comments:[...row.comments,{id:'reply',body:input.body,authorKind:'student',visibility:'public',createdAt:'2026-10-05T11:00:00Z'}]};
      }
      return row;
    };
    const render = () => {root.innerHTML = `<section class="apply-signed-in">${supportCasesUI.studentView(state)}</section>`;supportCasesUI.studentBind(root,state,{api,getToken:() => 'active',act:async (work) => {try {await work();} catch(error) {window.supportDraftError = error.message;}render();}});};render();
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  const create = page.locator('[data-support-create]');await create.locator('[name="subject"]').fill('Retained feedback <b>not markup</b>');await create.locator('[name="category"]').selectOption('academic');await create.locator('[name="body"]').fill('A retained private draft message.');
  await create.locator('button').evaluate((button) => button.scrollIntoView({block:'start'}));
  expect(await create.locator('button').evaluate((button) => button.getBoundingClientRect().top >= document.querySelector('.top-nav').getBoundingClientRect().bottom)).toBe(true);
  await create.locator('button').click();await expect(create.locator('button')).toBeDisabled();await page.evaluate(() => window.rejectSupportCreate());
  await expect(create.locator('button')).toBeEnabled();await expect(create.locator('[name="subject"]')).toHaveValue('Retained feedback <b>not markup</b>');await expect(create.locator('[name="body"]')).toHaveValue('A retained private draft message.');await expect(create.locator('[name="category"]')).toHaveValue('academic');
  await create.locator('button').click();await expect(page.locator('[data-support-detail] h3')).toHaveText('Retained feedback <b>not markup</b>');
  expect(await page.evaluate(() => supportPosts[0].input.requestKey === supportPosts[1].input.requestKey)).toBe(true);
  const reply = page.locator('[data-support-action="comment"]');await reply.locator('[name="body"]').fill('A retained reply after an interruption.');await reply.locator('button').click();await expect(reply.locator('button')).toBeDisabled();await page.evaluate(() => window.rejectSupportComment());
  await expect(reply.locator('[name="body"]')).toHaveValue('A retained reply after an interruption.');await reply.locator('button').click();await expect(page.locator('[data-support-comment]').last()).toContainText('A retained reply after an interruption.');
  expect(await page.evaluate(() => supportPosts[2].input.requestKey === supportPosts[3].input.requestKey)).toBe(true);expect(await page.evaluate(() => supportDraftState.supportStudentDraft)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await reply.locator('button').evaluate((button) => button.scrollIntoView({block:'center',behavior:'instant'}));
  if (info.project.name === 'mobile') expect(await reply.locator('button').evaluate((button) => button.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
  await page.screenshot({path:info.outputPath('support-draft-recovery-viewport.png')});
  await page.evaluate(() => {window.failSupportDetail = true;});await page.locator('[data-support-open="case"]').click();await expect(page.locator('[data-support-detail]')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const list = {items:[{subject:'OLD PRIVATE TITLE'}]},state = {session:{token:'office'},supportStaffList:list,supportStaffDetail:{body:'OLD PRIVATE MESSAGE'}};
    await supportCasesUI.loadStaff(state,async () => {throw new Error('Source unavailable');});const failed = supportCasesUI.staffView(state);
    await supportCasesUI.loadStaff(state,async () => ({items:[],total:0,limit:25,offset:0,availableIntakes:[]}));
    return {oldData:failed.includes('OLD PRIVATE'),recovery:failed.includes('data-support-refresh'),recovered:state.supportStaffList.total === 0 && !state.supportStaffUnavailable};
  })).toEqual({oldData:false,recovery:true,recovered:true});
});
