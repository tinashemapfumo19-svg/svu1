import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test('prospective enquiries bind consent, guidance, private hand-off, escalation and withdrawal',async ({page,browser,request},info) => {
  test.setTimeout(480000);
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Prospective-2026!',errors = [],own = '/api/enquiries/me/cases',base = '/api/enquiries/cases';
  page.on('pageerror',(e) => errors.push(e.message));
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'}),intake = await createIntake('Prospective'),hidden = await createIntake('Hidden');
  const applicant = await account('applicant'),other = await account('other'),officer = await account('officer','admissions_officer',intake.id),manager = await account('manager','admissions_manager',intake.id),outsider = await account('outsider','admissions_officer',hidden.id);
  await api('POST','/api/access/role-assignments',{accountId:officer.id,roleCode:'auditor',scope:{},reason:'Unrelated global scope'},admin.token);
  const guide = await api('POST','/api/guidance/manage/articles',{programmeId:'prog_bsc_is',intakeId:intake.id,title:`Prospective guidance ${stamp}`,body:'SYNTHETIC programme guidance, not an admission decision.',sourceRef:'Synthetic approved source',effectiveFrom:new Date().toISOString().slice(0,10),validUntil:null,reason:'Synthetic guidance author',requestKey:`guide_${stamp.replaceAll('.','_')}`},officer.token);
  const initial = {intakeId:intake.id,guidanceVersionId:guide.versions[0].id,subject:'Prospective question',body:'Private question',consent:true,requestKey:`create_${stamp.replaceAll('.','_')}`};
  await denied('POST',own,{...initial,consent:false},applicant.token,400);
  await denied('POST',own,initial,applicant.token,409);
  await denied('POST',own,{...initial,ownerId:other.id},applicant.token,400);
  await api('POST',`/api/guidance/manage/articles/${guide.id}/versions/${guide.versions[0].id}/publish`,{revision:1,reason:'Synthetic independent approval'},manager.token);
  const subject = 'Prospective <img src=x onerror=alert(1)>',body = 'PRIVATE APPLICANT QUESTION <script>alert(1)</script>',reply = 'Admissions in-app reply <img src=x onerror=alert(1)>',note = 'PRIVATE STAFF NOTE',triageReason = 'PRIVATE HANDOFF REASON';
  expect(await api('GET','/api/admissions/me/communications/preferences',undefined,applicant.token)).toMatchObject({inApp:false,email:false});
  await page.goto('/#apply');await signIn(page,applicant,false);
  await page.locator(`[data-guidance-article="${guide.id}"] > summary`).click();await page.locator(`[data-enquiry-guidance="${guide.versions[0].id}"]`).click();
  const form = page.locator('[data-enquiry-create]');await expect(form).toBeVisible();await expect(form.locator('[name="intakeId"]')).toHaveValue(intake.id);await expect(form.locator('[name="consent"]')).not.toBeChecked();
  await fill(form,{subject,body});await form.locator('[name="consent"]').check();
  const creating = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(own));await form.getByRole('button',{name:'Send enquiry'}).click();const created = await creating;expect(created.status(),await created.text()).toBe(201);let enquiry = (await created.json()).data;const payload = created.request().postDataJSON();
  await expect(page.locator('[data-enquiry-own-detail]')).toContainText(subject);await expect(page.locator('[data-enquiry-own-detail] img')).toHaveCount(0);
  const retries = await Promise.all([api('POST',own,payload,applicant.token),api('POST',own,payload,applicant.token)]);expect(retries.map((r) => r.id)).toEqual([enquiry.id,enquiry.id]);
  await denied('POST',own,{...payload,body:'Changed content'},applicant.token,409);
  await denied('GET',`${own}/${enquiry.id}`,undefined,other.token,404);await denied('GET',`${base}/${enquiry.id}`,undefined,outsider.token,404);await denied('GET',base,undefined,applicant.token,403);
  const hiddenEnquiry = await api('POST',own,{...initial,intakeId:hidden.id,guidanceVersionId:null,requestKey:`hidden_${stamp.replaceAll('.','_')}`},other.token);await denied('GET',`${base}/${hiddenEnquiry.id}`,undefined,officer.token,404);
  await denied('POST',`${base}/${enquiry.id}/comment`,{revision:1,body:'Unassigned cannot reply',requestKey:'unassigned-reply'},officer.token,403);

  const context = await browser.newContext({baseURL:process.env.SVU_BASE_URL,viewport:page.viewportSize(),isMobile:info.project.name === 'mobile'}),staff = await context.newPage();staff.on('pageerror',(e) => errors.push(e.message));
  try {
    await staff.goto('/#admissions');await signIn(staff,officer,true);await staff.locator('[data-enquiry-staff] > summary').click();
    expect(await staff.locator('[data-enquiry-staff-filter] [name="intakeId"] option').allTextContents()).toEqual(['All',`BSC-IS - Prospective ${stamp}`]);
    await staff.locator(`[data-enquiry-staff-open="${enquiry.id}"]`).click();await expect(staff.locator('[data-enquiry-staff-detail]')).toContainText(body);await expect(staff.locator('[data-enquiry-staff-action="comment"]')).toHaveCount(0);
    enquiry = await triage(officer.id,'in_progress',triageReason);
    await denied('POST',`${base}/${enquiry.id}/update`,{revision:1,status:'in_progress',assigneeId:officer.id,resolveEscalation:false,reason:'stale'},officer.token,409);
    await denied('POST',`${base}/${enquiry.id}/update`,{revision:enquiry.revision,status:'in_progress',assigneeId:outsider.id,resolveEscalation:false,reason:'wrong intake'},officer.token,400);
    let messageForm = staff.locator('[data-enquiry-staff-action="comment"]');await messageForm.locator('[name="body"]').fill(reply);
    const posting = staff.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/${enquiry.id}/comment`)),posted = staff.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/${enquiry.id}/comment`));
    const click = messageForm.getByRole('button',{name:'Send reply'}).click(),post = await posting;
    const repeats = await Promise.all([api('POST',`${base}/${enquiry.id}/comment`,post.postDataJSON(),officer.token),api('POST',`${base}/${enquiry.id}/comment`,post.postDataJSON(),officer.token)]);await click;const response = await posted;expect(response.status(),await response.text()).toBe(200);enquiry = (await response.json()).data;expect(repeats.every((r) => r.id === enquiry.id)).toBe(true);
    await expect(staff.locator('[data-enquiry-staff-detail]')).toContainText(reply);
    messageForm = staff.locator('[data-enquiry-staff-action="comment"]');await messageForm.locator('[name="visibility"]').selectOption('internal');await messageForm.locator('[name="body"]').fill(note);enquiry = await submitAction(staff,'comment','Add note');
    await page.locator('[data-enquiry-own-refresh]').click();await expect(page.locator('[data-enquiry-own-detail]')).toContainText(reply);await expect(page.locator('[data-enquiry-own-detail]')).not.toContainText(note);await expect(page.locator('[data-enquiry-own-detail]')).not.toContainText(triageReason);
    const privateView = await api('GET',`${own}/${enquiry.id}`,undefined,applicant.token);expect(privateView.messages).toHaveLength(2);expect(JSON.stringify(privateView)).not.toMatch(/PRIVATE STAFF|PRIVATE HANDOFF|authorId|ownerId|assigneeId|actorId|reasonEncrypted/);
    const started = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/admissions/applications'));await page.locator('[data-enquiry-own-detail] [data-start]').click();expect((await started).ok()).toBe(true);await expect(page.locator('[data-enquiry-application]')).toBeVisible();
    await page.locator('[data-enquiry-application]').click();await expect(page.locator('[data-enquiry-own-detail]')).toContainText(subject);
    await page.locator('[data-enquiry-own-action="comment"] [name="body"]').fill('Applicant follow-up');enquiry = await submitAction(page,'comment','Send reply',true);expect(enquiry.status).toBe('in_progress');
    await staff.locator('[data-enquiry-staff-refresh]').click();await expect(staff.locator('[data-enquiry-staff-detail]')).toContainText('Applicant follow-up');
    const escalation = staff.locator('[data-enquiry-staff-action="escalate"]');await escalation.locator('..').locator('summary').click();await escalation.locator('[name="assigneeId"]').selectOption(manager.id);await escalation.locator('[name="reason"]').fill('PRIVATE ESCALATION REASON');enquiry = await submitAction(staff,'escalate','Escalate enquiry');expect(enquiry.escalated).toBe(true);
    await expect(staff.locator('[data-enquiry-staff-action="comment"]')).toHaveCount(0);
    await denied('POST',`${base}/${enquiry.id}/comment`,{revision:enquiry.revision,body:'Officer cannot bypass escalation',requestKey:'escalated-reply'},officer.token,403);
    await staff.locator('[data-staff-signout]').click();await expect(staff.locator('[data-enquiry-staff]')).toHaveCount(0);await signIn(staff,manager,true);await staff.locator('[data-enquiry-staff] > summary').click();await staff.locator(`[data-enquiry-staff-open="${enquiry.id}"]`).click();
    enquiry = await triage(manager.id,'resolved','PRIVATE MANAGER RESOLUTION',true);expect(enquiry.consentActive).toBe(false);
    await page.locator('[data-enquiry-own-refresh]').click();await expect(page.locator('[data-enquiry-own-detail]')).toContainText('Reply consent: Ended');await expect(page.locator('[data-enquiry-own-action="comment"]')).toHaveCount(0);
    await expect(page.locator('[data-enquiry-own-action="reopen"] [name="consent"]')).not.toBeChecked();
    await denied('POST',`${own}/${enquiry.id}/reopen`,{revision:enquiry.revision,reason:'missing explicit renewal'},applicant.token,400);
    await page.locator('[data-enquiry-own-action="reopen"] [name="reason"]').fill('A further in-app enquiry');await page.locator('[data-enquiry-own-action="reopen"] [name="consent"]').check();enquiry = await submitAction(page,'reopen','Reopen enquiry',true);expect(enquiry).toMatchObject({status:'open',consentActive:true});
    await staff.locator('[data-enquiry-staff-refresh]').click();await expect(staff.locator('[data-enquiry-staff-detail]')).toContainText('Reply consent: Active');enquiry = await triage(manager.id,'in_progress','Renewed enquiry assigned');
    await denied('POST',`${own}/${enquiry.id}/withdraw`,{revision:enquiry.revision-1,reason:'Stale withdrawal snapshot'},applicant.token,409);
    await page.locator('[data-enquiry-own-refresh]').click();await expect(page.locator('[data-enquiry-own-detail]')).toHaveAttribute('data-enquiry-revision',String(enquiry.revision));
    for (const p of [page,staff]) expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(p.viewportSize().width);
    await page.locator('[data-enquiry-own-detail]').screenshot({path:info.outputPath('prospective-own.png')});await staff.locator('[data-enquiry-staff-detail]').screenshot({path:info.outputPath('prospective-staff.png')});
    await page.locator('[data-enquiry-own-detail]').evaluate((e) => e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:info.outputPath('prospective-own-viewport.png')});await staff.locator('[data-enquiry-staff-detail]').evaluate((e) => e.scrollIntoView({block:'start',behavior:'instant'}));await staff.screenshot({path:info.outputPath('prospective-staff-viewport.png')});
    const withdrawal = page.locator('[data-enquiry-own-action="withdraw"]');await withdrawal.locator('..').locator('summary').click();await withdrawal.locator('[name="reason"]').fill('Stop further replies');enquiry = await submitAction(page,'withdraw','Withdraw consent',true);expect(enquiry).toMatchObject({status:'withdrawn',consentActive:false});
    await expect(page.locator('[data-enquiry-own-action="comment"]')).toHaveCount(0);await expect(page.locator('[data-enquiry-own-action="reopen"]')).toHaveCount(0);
    await denied('POST',`${base}/${enquiry.id}/comment`,{revision:enquiry.revision,body:'Consent ended',requestKey:'withdrawn-reply'},manager.token,409);
    await denied('POST',`${own}/${enquiry.id}/reopen`,{revision:enquiry.revision,consent:true,reason:'Cannot undo optout'},applicant.token,409);
    expect((await api('POST',`${own}/${enquiry.id}/withdraw`,{revision:1,reason:'Repeated withdrawal'},applicant.token)).revision).toBe(enquiry.revision);
    await databaseChecks(enquiry.id);
    const session = await page.evaluate(() => JSON.parse(sessionStorage.getItem('svu.applicant.session')));await api('DELETE',`/api/identity/sessions/${session.sessionId}`,undefined,session.token);await page.locator('[data-enquiry-own-refresh]').click();await expect(page.locator('[data-form="signin"]')).toBeVisible();await expect(page.locator('[data-enquiry-own]')).toHaveCount(0);
    await staff.locator('[data-staff-signout]').click();await expect(staff.locator('[data-enquiry-staff]')).toHaveCount(0);expect(errors).toEqual([]);
  } finally {await context.close();}

  async function triage(assigneeId,status,reason,resolveEscalation = false) {
    const f = staff.locator('[data-enquiry-staff-action="update"]');await f.locator('..').locator('summary').click();await f.locator('[name="assigneeId"]').selectOption(assigneeId);await f.locator('[name="status"]').selectOption(status);await f.locator('[name="reason"]').fill(reason);if (resolveEscalation) await f.locator('[name="resolveEscalation"]').check();return submitAction(staff,'update','Update enquiry');
  }
  async function submitAction(p,action,button,self = false) {const f = p.locator(`[data-enquiry-${self ? 'own' : 'staff'}-action="${action}"]`),pending = p.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/${enquiry.id}/${action}`));await f.getByRole('button',{name:button,exact:true}).click();const r = await pending;expect(r.status(),await r.text()).toBe(200);const data = (await r.json()).data;await expect(p.locator(`[data-enquiry-${self ? 'own' : 'staff'}-detail]`)).toHaveAttribute('data-enquiry-revision',String(data.revision));await expect(p.locator(`[data-enquiry-${self ? 'own' : 'staff'}-detail]`)).toContainText(label(data.status));return data;}
  function label(v) {return v.replaceAll('_',' ');}
  async function signIn(p,a,selfStaff) {const f = p.locator(`[data-form="${selfStaff ? 'staff-signin' : 'signin'}"]`);await fill(f,{email:a.email,password});await f.locator('button[type="submit"],button:not([type])').last().click();if(selfStaff)await p.locator('[data-admissions-tab=enquiries]').click();await expect(p.locator(`[data-enquiry-${selfStaff ? 'staff' : 'own'}]`)).toBeVisible();}
  async function fill(f,values) {for (const [name,value] of Object.entries(values)) await f.locator(`[name="${name}"]`).fill(value);}
  async function createIntake(label) {const i = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2035-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${i.id}/transitions`,{toStatus:'published',reason:'Synthetic prospective intake'},admin.token);return i;}
  async function account(label,role,intakeId) {const email = `prospective.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Prospective ${label}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));await api('POST','/api/identity/activations',{token:messages.find((r) => r.recipientEmail === email).variables.activationToken,password,preferredName:label,legalName:`Prospective ${label}`});const s = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,s.token);if (role) await api('POST','/api/access/role-assignments',{accountId:me.account.id,roleCode:role,scope:{programmeCodes:['BSC-IS'],intakeIds:[intakeId]},reason:'Synthetic enquiry scope'},admin.token);return {id:me.account.id,email,token:s.token};}
  async function databaseChecks(id) {
    expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);const c = new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();
    try {
      const row = (await c.query('select subject_encrypted,consent_active,consent_policy,status,owner_id,intake_id,guidance_version_id from prospective_enquiries where id = $1',[id])).rows[0];expect(row).toMatchObject({consent_active:false,status:'withdrawn',consent_policy:'portal-enquiry-v1',owner_id:applicant.id,intake_id:intake.id,guidance_version_id:guide.versions[0].id});expect(row.subject_encrypted).not.toContain(subject);
      const messages = (await c.query('select body_encrypted,visibility from prospective_enquiry_messages where enquiry_id = $1 order by revision',[id])).rows;expect(messages).toHaveLength(4);expect(messages.filter((m) => m.visibility === 'internal')).toHaveLength(1);for (const m of messages) {expect(m.body_encrypted).not.toContain(body);expect(m.body_encrypted).not.toContain(note);expect(m.body_encrypted).not.toContain(reply);}
      const history = (await c.query('select revision,reason_encrypted from prospective_enquiry_history where enquiry_id = $1 order by revision',[id])).rows;expect(new Set(history.map((r) => r.revision)).size).toBe(history.length);expect(JSON.stringify(history)).not.toContain(triageReason);
      const audit = (await c.query("select reason,metadata from audit_events where subject_id = $1 and action like 'enquiry.%'",[id])).rows;for (const secret of [subject,body,reply,note,triageReason]) expect(JSON.stringify(audit)).not.toContain(secret);
      for (const sql of ['delete from prospective_enquiries where id = $1','update prospective_enquiries set subject_encrypted = subject_encrypted,revision = revision + 1 where id = $1','delete from prospective_enquiry_messages where enquiry_id = $1','delete from prospective_enquiry_history where enquiry_id = $1']) {await c.query('begin');try {await expect(c.query(sql,[id])).rejects.toThrow();} finally {await c.query('rollback');}}
    } finally {await c.end();}
  }
  async function api(method,path,data,token) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBe(true);return (await r.json()).data;}
  async function denied(method,path,data,token,status) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.status(),`${method} ${path}: ${await r.text()}`).toBe(status);}
});

test('enquiry loaders stop departed reads and discard superseded selections and revoked drafts',async ({page}) => {
  await page.goto('/#apply');
  const result = await page.evaluate(async () => {
    const ui = window.prospectiveEnquiriesUI,state = {session:{token:'old'},enquiryStaffSelectedId:'E'};let calls = 0;
    await ui.loadStaff(state,async () => {calls++;state.session = null;return {};});
    let token = 'owner',ownCalls = 0;const own = {enquiryOwnSelectedId:'E'};
    await ui.loadOwn(own,async () => {ownCalls++;token = 'departed';return {items:[]};},() => token);
    const changed = {enquiryOwnSelectedId:'E'};let selectionCalls = 0;
    await ui.loadOwn(changed,async () => {selectionCalls++;changed.enquiryOwnSelectedId = 'OTHER';return {items:[]};},() => 'owner');
    Object.assign(state,{session:{token:'current'},enquiryStaffAuthorized:true,enquiryStaffList:{items:[{subject:'private'}]},enquiryStaffDetail:{subject:'private'},enquiryStaffCommentDraft:{body:'private'},enquiryStaffCommentSubmission:{data:{body:'private'}},enquiryStaffCommentKey:'private',enquiryStaffUpdateDraft:{reason:'private'}});
    await ui.loadStaff(state,async () => {throw Object.assign(new Error('Revoked'),{status:403});});
    const erased = ['enquiryStaffList','enquiryStaffDetail','enquiryStaffCommentDraft','enquiryStaffCommentSubmission','enquiryStaffCommentKey','enquiryStaffUpdateDraft'].every((key) => state[key] === undefined);
    return {calls,ownCalls,selectionCalls,erased,departedLoaded:Boolean(own.enquiryOwnList),changedLoaded:Boolean(changed.enquiryOwnList),error:state.enquiryStaffError};
  });
  expect(result).toEqual({calls:1,ownCalls:1,selectionCalls:1,erased:true,departedLoaded:false,changedLoaded:false,error:'Revoked'});
});

test('enquiry forms preserve frozen create and reply intents across interrupted responses and refresh',async ({page}) => {
  await page.goto('/#apply');
  const result = await page.evaluate(async () => {
    const ui = window.prospectiveEnquiriesUI,root = document.createElement('div');document.body.append(root);
    const row = {id:'E',subject:'Private enquiry',programmeCode:'P',intakeId:'I',intakeLabel:'Synthetic intake',status:'in_progress',revision:2,consentActive:true,consentPolicy:'portal-enquiry-v1',assignees:[],messages:[],history:[],canComment:true,canWithdraw:true};
    const state = {enquiryOwnList:{items:[],offset:0},enquiryOwnCreateOpen:true,catalogue:[{intakeId:'I',programmeCode:'P',label:'Synthetic intake'}]},creates = [],replies = [],refreshDisabled = [];let pending,lastError,revision = 2,forbidden = false;
    const api = async (method,path,data) => {
      if (method === 'POST') {
        if (forbidden) throw Object.assign(new Error('Revoked'),{status:403});
        const target = path.endsWith('/comment') ? replies : creates;target.push(structuredClone(data));if (target.length === 1) throw new Error('Interrupted response');return row;
      }
      return path.includes('?') ? {items:[row],offset:0} : {...row,revision};
    };
    const bind = () => {root.innerHTML = ui.ownView(state);ui.ownBind(root,state,{api,getToken:() => 'owner',act:(work) => {pending = work().catch((e) => {lastError = e.message;});}});};
    const enter = (form,name,value) => {const field = form.elements[name];if (field.type === 'checkbox') field.checked = value;else field.value = value;field.dispatchEvent(new Event('input',{bubbles:true}));};
    const submit = async (form) => {form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));refreshDisabled.push(root.querySelector('[data-enquiry-own-refresh]').disabled);await pending;};
    bind();let form = root.querySelector('[data-enquiry-create]');const defaultOff = !form.elements.consent.checked;
    for (const [name,value] of Object.entries({intakeId:'I',subject:'Private enquiry',body:'Private question',consent:true})) enter(form,name,value);
    await submit(form);const createRetained = state.enquiryOwnCreateDraft.body;await ui.loadOwn(state,api,() => 'owner');bind();await submit(root.querySelector('[data-enquiry-create]'));
    const createSame = JSON.stringify(creates[0]) === JSON.stringify(creates[1]);bind();form = root.querySelector('[data-enquiry-own-action="comment"]');enter(form,'body','Private reply');await submit(form);
    const replyRetained = state.enquiryOwnCommentDraft.body;revision = 3;await ui.loadOwn(state,api,() => 'owner');bind();await submit(root.querySelector('[data-enquiry-own-action="comment"]'));
    const replySame = JSON.stringify(replies[0]) === JSON.stringify(replies[1]),replyRevision = replies[1].revision;
    bind();form = root.querySelector('[data-enquiry-own-action="comment"]');enter(form,'body','Forbidden private reply');forbidden = true;await submit(form);
    const erased = !state.enquiryOwnList && !state.enquiryOwnDetail && !state.enquiryOwnCommentDraft && !state.enquiryOwnCommentSubmission;
    root.remove();return {defaultOff,createRetained,replyRetained,createSame,replySame,replyRevision,erased,lastError,refreshDisabled:refreshDisabled.every(Boolean)};
  });
  expect(result).toEqual({defaultOff:true,createRetained:'Private question',replyRetained:'Private reply',createSame:true,replySame:true,replyRevision:2,erased:true,lastError:'Revoked',refreshDisabled:true});
});
