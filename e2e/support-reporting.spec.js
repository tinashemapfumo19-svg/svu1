import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test('support reporting reconciles native scoped cases, distinct owners, fresh CSV and private source failures',async ({page,request},info) => {
  test.setTimeout(300_000);page.setDefaultTimeout(25_000);
  const errors = [];page.on('pageerror',(e) => errors.push(e.message));
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Dam-Applicant-2026!';let sequence = 0;
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const first = await intake('First'),second = await intake('Second'),hidden = await intake('PRIVATE');
  const learner = await account('learner'),other = await account('other'),office = await account('office');
  const p1 = await admit(learner,first),p2 = await admit(learner,second),p3 = await admit(other,hidden);
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'support_officer',scope:{programmeCodes:['BSC-IS'],intakeIds:[first.id,second.id]},reason:'Synthetic scoped reporting'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'auditor',scope:{},reason:'Unrelated global role'},admin.token);
  const a = await create(p1,'registration','SECRET FIRST CASE'),b = await create(p1,'finance','SECRET SECOND CASE'),c = await create(p2,'feedback','SECRET THIRD CASE');
  await api('POST','/api/support/me/cases',{programmeId:p3.id,subject:'PRIVATE HIDDEN CASE',category:'academic',body:'PRIVATE HIDDEN BODY',requestKey:'hidden-case'},other.token);
  let current = await action(a,'comment',{body:'SECRET INTERNAL NOTE',visibility:'internal',requestKey:'note-key'});
  current = await action(current,'update',{category:'registration',priority:'urgent',status:'waiting_student',assigneeId:office.id,reason:'SECRET TRIAGE'});
  current = await action(current,'comment',{body:'SECRET PUBLIC REPLY',visibility:'public',requestKey:'reply-key'});
  let resolved = await action(b,'comment',{body:'SECOND PUBLIC REPLY',visibility:'public',requestKey:'reply-key-2'});
  resolved = await action(resolved,'update',{category:'finance',priority:'high',status:'resolved',assigneeId:office.id,reason:'Resolved synthetic case'});
  const closed = await api('POST',`/api/support/me/cases/${resolved.id}/close`,{revision:resolved.revision,reason:'Confirmed'},learner.token);
  const report = await api('GET','/api/reports/support',undefined,office.token);
  expect(report.totals).toMatchObject({casesTotal:3,ownerAccounts:1,programmeRecords:2,open:1,waitingStudent:1,closed:1,activeCases:2,urgentActive:1,unassignedActive:1,publiclyAnswered:2,awaitingFirstReply:1,activePubliclyAnswered:1,firstReplySamples:2,resolvedSamples:1});
  expect(report.rows.reduce((sum,r) => sum+r.counts.ownerAccounts,0)).toBe(2);expect(Object.values(report.controls).every(Boolean)).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/SECRET|PRIVATE|subjectEncrypted|bodyEncrypted|assigneeId|studentNumber/);
  await denied(`/api/reports/support?intakeId=${hidden.id}`,office.token,404);await denied('/api/reports/support',learner.token,403);
  expect((await api('GET','/api/reports/support?category=finance&priority=high',undefined,office.token)).totals).toMatchObject({casesTotal:1,closed:1,ownerAccounts:1});
  const utcDay = report.generatedAt.slice(0,10);
  expect((await api('GET',`/api/reports/support?from=${utcDay}&to=${utcDay}`,undefined,office.token)).totals.casesTotal).toBe(3);
  expect((await api('GET','/api/reports/support?from=2020-01-01&to=2020-01-01',undefined,office.token)).totals.meanFirstReplyMinutes).toBeNull();
  await page.goto('/#registry');await submit(page.locator('[data-registry-login]'),{email:office.email,password});
  await expect(page.locator('[data-support-report]')).toBeVisible({timeout:45000});await expect(page.locator('[data-support-report-filter]')).toBeEnabled();
  await page.locator('[data-support-report] > summary').click();
  await expect(page.locator('[data-support-metric="casesTotal"] td').last()).toHaveText('3');
  await expect(page.locator('[data-support-report]')).not.toContainText('PRIVATE');
  await submit(page.locator('[data-support-report-filter]'),{intakeId:first.id,category:'',priority:'',from:'',to:''});await expect(page.locator('[data-support-metric="casesTotal"] td').last()).toHaveText('2');
  await submit(page.locator('[data-support-report-filter]'),{intakeId:'',category:'',priority:'',from:'',to:''});await expect(page.locator('[data-support-metric="casesTotal"] td').last()).toHaveText('3');
  await api('POST',`/api/support/me/cases/${closed.id}/reopen`,{revision:closed.revision,reason:'Follow-up'},learner.token);
  const download = page.waitForEvent('download');await page.locator('[data-support-report-export]').click();const exported = await download;
  const csv = await readFile(await exported.path(),'utf8');expect(csv).toContain('student-support-operations-v1');expect(csv).toMatch(/"total"[^\r\n]*"resolvedSamples","cases","0"/);
  // Export reads current sources without replacing the older on-screen snapshot.
  await expect(page.locator('[data-support-metric="closed"] td').last()).toHaveText('1');
  await page.locator('[data-support-report-filter] button[type="submit"]').click();await expect(page.locator('[data-support-metric="closed"] td').last()).toHaveText('0');
  const client = new pg.Client({connectionString:process.env.DATABASE_URL});expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);await client.connect();
  try {
    const direct = (await client.query(`select avg(extract(epoch from first_reply-created_at)/60)::double precision as mean from (select c.created_at,(select min(m.created_at) from support_case_comments m where m.case_id = c.id and m.author_kind = 'staff' and m.visibility = 'public') as first_reply from support_cases c where c.intake_id = any($1::text[])) cases`,[[first.id,second.id]])).rows[0];
    const fresh = await api('GET','/api/reports/support',undefined,office.token);expect(fresh.totals.meanFirstReplyMinutes).toBeCloseTo(direct.mean,8);expect(fresh.totals.meanResolutionMinutes).toBeNull();
    const dictionary = await api('GET','/api/reports/support/dictionary',undefined,office.token);expect(dictionary.metrics).toHaveLength(29);
    await client.query('update intakes set label = $2 where id = $1',[second.id,'=REPORT_FORMULA']);
    expect((await api('GET','/api/reports/support?format=csv',undefined,office.token)).csv).toContain('"\'=REPORT_FORMULA"');
    await client.query('update support_cases set revision = revision + 1 where id = $1',[c.id]);
    await denied('/api/reports/support',office.token,409);await denied('/api/reports/support?format=csv',office.token,409);
    await page.locator('[data-support-report-filter] button[type="submit"]').click();await expect(page.locator('[data-support-report] [role="alert"]')).toContainText('reconciliation');await expect(page.locator('[data-support-metric]')).toHaveCount(0);await expect(page.locator('[data-support-report-export]')).toBeDisabled();
    await client.query(`insert into support_case_history (case_id,revision,action,from_status,to_status,category,priority,assignee_id,escalated,escalation_level,actor_id,visibility,reason_encrypted) select id,revision,'reconciled',status,status,category,priority,assignee_id,escalated,escalation_level,$2,'internal',null from support_cases where id = $1`,[c.id,admin.accountId || office.id]);
    await page.locator('[data-support-report-filter] button[type="submit"]').click();await expect(page.locator('[data-support-metric="casesTotal"] td').last()).toHaveText('3');
    const audit = (await client.query("select reason,metadata from audit_events where actor_id = $1 and action = 'reports.support.exported'",[office.id])).rows;expect(audit.length).toBeGreaterThanOrEqual(2);expect(JSON.stringify(audit)).not.toMatch(/SECRET|PRIVATE|REPORT_FORMULA|subject|body/);
    await page.locator('[data-support-report]').evaluate((el) => {el.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-100);});
    await page.screenshot({path:info.outputPath('support-report-viewport.png')});
    await page.screenshot({path:info.outputPath('support-report.png'),fullPage:true});expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await client.query("update role_assignments set scope = $2::jsonb where account_id = $1 and role_code = 'support_officer'",[office.id,JSON.stringify({programmeCodes:['BSC-IS'],intakeIds:[second.id]})]);
    await submit(page.locator('[data-support-report-filter]'),{intakeId:first.id});await expect(page.locator('[data-support-report]')).toHaveCount(0);
    await page.locator('[data-registry-signout]').click();await expect(page.locator('[data-registry-login]')).toBeVisible();await expect(page.locator('[data-support-report]')).toHaveCount(0);
  } finally {await client.end();}
  expect(errors).toEqual([]);
  async function create(p,category,subject) {return api('POST','/api/support/me/cases',{programmeId:p.id,subject,category,body:'SECRET INITIAL BODY',requestKey:`create-key-${++sequence}`},learner.token);}
  async function action(row,kind,data) {return api('POST',`/api/support/cases/${row.id}/${kind}`,{revision:row.revision,...data},office.token);}
  async function intake(label) {const i = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2033-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${i.id}/transitions`,{toStatus:'published',reason:'Synthetic support report'},admin.token);return i;}
  async function admit(person,i) {const ref = `SAMPLE-SUPPORT-REPORT-${stamp}-${++sequence}`;await api('POST','/api/admissions/migrations',{source:ref,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:ref,accountId:person.id,intakeId:i.id,state:'Accepted',referenceNumber:ref,studyModeCode:'FULL_TIME',answers:{applicantCategory:'standard'},documents:[],decision:{decision:'offer',conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);return (await api('GET','/api/registry/me',undefined,person.token)).programmes.find((r) => r.intakeId === i.id);}
  async function account(label) {const email = `support-report.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:`Report ${label} ${stamp}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),'utf8'))));const token = messages.find((r) => r.recipientEmail === email).variables.activationToken;await api('POST','/api/identity/activations',{token,password,preferredName:label,legalName:`Report ${label} ${stamp}`});const session = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,session.token);return {email,token:session.token,id:me.account.id};}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);else await field.fill(value);}await form.locator('button[type="submit"],button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(path,token,status) {const response = await request.get(path,{headers:{Authorization:`Bearer ${token}`}});expect(response.status(),await response.text()).toBe(status);}
});

test('support report loaders discard departed, superseded and revoked private caches',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.supportReportingUI));
  expect(await page.evaluate(async () => {
    const output = [];
    for (const fail of [false,true]) {
      const state = {session:{token:'old'}};let deliver,reject;const pending = new Promise((ok,no) => {deliver = ok;reject = no;});
      const read = supportReportingUI.load(state,() => pending);state.session.token = 'new';state.supportReport = {marker:'new'};
      if (fail) reject(new Error('Old private error'));else deliver({marker:'old'});await read;output.push(state.supportReport);
    }
    const state = {session:{token:'same'}};let deliver;const old = new Promise((ok) => {deliver = ok;});const read = supportReportingUI.load(state,() => old);
    await supportReportingUI.load(state,async () => ({marker:'current',filters:{}}));deliver({marker:'old'});await read;output.push(state.supportReport);
    for (const status of [401,403,404]) {const denied = {session:{token:'same'},supportReport:{private:1},supportReportIntakes:[{private:2}],supportReportFilters:{intakeId:'private'}};await supportReportingUI.load(denied,async () => {const e = new Error('Denied');e.status = status;throw e;});output.push(Object.keys(denied));}
    const broken = {session:{token:'same'},supportReport:{private:1}};await supportReportingUI.load(broken,async (method,path) => {if (path.endsWith('/intakes')) return [];throw new Error('Reconcile');});output.push({report:broken.supportReport,intakes:broken.supportReportIntakes,error:broken.supportReportError});return output;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'current',filters:{}},['session'],['session'],['session'],{report:null,intakes:[],error:'Reconcile'}]);
});
