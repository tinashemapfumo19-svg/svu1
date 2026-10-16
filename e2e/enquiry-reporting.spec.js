import {test,expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

test('enquiry reporting reconciles scoped cohorts, distinct accounts, public replies and fresh private-safe exports',async ({page,request},info) => {
  test.setTimeout(360000);
  const stamp = `${info.project.name}.${Date.now()}`,password = 'Kariba-Report-2026!',errors = [],reportPath = '/api/reports/enquiries',own = '/api/enquiries/me/cases',staffPath = '/api/enquiries/cases';
  page.on('pageerror',(e) => errors.push(e.message));
  const admin = await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  const first = await intake('=Enquiry first'),second = await intake('Enquiry second'),hidden = await intake('HIDDEN INTAKE');
  const learner = await account('first'),other = await account('second'),office = await account('office');
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'admissions_manager',scope:{programmeCodes:['BSC-IS'],intakeIds:[first.id,second.id]},reason:'Synthetic report scope'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:'auditor',scope:{},reason:'Unrelated global role'},admin.token);
  const firstApplication = await api('POST','/api/admissions/applications',{intakeId:first.id},learner.token);
  const a = await create(learner,first,'open'),b = await create(learner,first,'resolved'),c = await create(learner,second,'withdrawn'),d = await create(other,second,'internal');
  await create(other,hidden,'hidden');
  let resolved = await assign(b);resolved = await message(resolved,'public');resolved = await update(resolved,'resolved');
  let withdrawn = await assign(c);withdrawn = await message(withdrawn,'public');await api('POST',`${own}/${withdrawn.id}/withdraw`,{revision:withdrawn.revision,reason:'Private withdrawal reason'},learner.token);
  await message(await assign(d),'internal');
  await api('POST','/api/admissions/applications',{intakeId:second.id},other.token);
  const initial = await api('GET',reportPath,undefined,office.token);
  expect(initial.rows.map((r) => r.intakeId).sort()).toEqual([first.id,second.id].sort());
  expect(initial.totals).toMatchObject({enquiriesTotal:4,verifiedAccounts:2,open:1,inProgress:1,waitingApplicant:0,resolved:1,withdrawn:1,activeConsent:2,endedConsent:2,unassignedActive:1,escalatedActive:0,awaitingFirstReply:2,activePubliclyAnswered:0,publiclyAnswered:2,firstReplySamples:2,resolvedSamples:1,enquiriesWithApplication:3,enquiriesWithLaterApplication:1});
  expect(initial.rows.reduce((sum,r) => sum+r.counts.verifiedAccounts,0)).toBe(3);
  expect(Object.values(initial.controls).every(Boolean)).toBe(true);expect(initial.totals.meanFirstReplyMinutes).toBeGreaterThanOrEqual(0);expect(initial.totals.meanResolutionMinutes).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(initial)).not.toMatch(/REPORT_PRIVATE|HIDDEN INTAKE|ownerId|assigneeId|authorId|bodyEncrypted|reasonEncrypted/);
  await denied('GET',`${reportPath}?intakeId=${hidden.id}`,undefined,office.token,404);await denied('GET',reportPath,undefined,learner.token,403);await denied('GET',reportPath,undefined,null,401);
  await denied('GET',`${reportPath}?from=2026-02-30&to=2026-03-01`,undefined,office.token,400);await denied('GET',`${reportPath}?asOf=2026-01-01`,undefined,office.token,400);
  const today = new Date().toISOString().slice(0,10),cohort = await api('GET',`${reportPath}?from=${today}&to=${today}`,undefined,office.token);expect(cohort.totals.enquiriesTotal).toBe(4);
  const empty = await api('GET',`${reportPath}?from=2020-01-01&to=2020-01-01`,undefined,office.token);expect(empty.totals.enquiriesTotal).toBe(0);expect(empty.totals.meanFirstReplyMinutes).toBeNull();expect(Object.values(empty.controls).every(Boolean)).toBe(true);
  await page.goto('/#admissions');const login = page.locator('[data-form="staff-signin"]');await login.locator('[name="email"]').fill(office.email);await login.locator('[name="password"]').fill(password);await login.locator('button[type="submit"]').click();
  await expect(page.locator('[data-enquiry-report]')).toBeVisible();await page.locator('[data-enquiry-report] > summary').click();await expect(page.locator('[data-enquiry-metric="enquiriesTotal"] td').last()).toHaveText('4');
  await page.locator('[data-enquiry-report-filter] [name="intakeId"]').selectOption(first.id);await page.getByRole('button',{name:'Refresh enquiry report',exact:true}).click();await expect(page.locator('[data-enquiry-metric="enquiriesTotal"] td').last()).toHaveText('2');
  expect(await page.locator('[data-enquiry-report-filter] [name="intakeId"] option').count()).toBe(3);
  await api('POST',`${own}/${resolved.id}/reopen`,{revision:resolved.revision,reason:'Private renewal reason',consent:true},learner.token);
  const downloading = page.waitForEvent('download');await page.locator('[data-enquiry-report-export]').click();const download = await downloading;expect(download.suggestedFilename()).toBe('prospective-enquiry-operations.csv');
  const csv = await readFile(await download.path(),'utf8');expect(csv).toContain('"resolved","enquiries","0"');expect(csv).toContain('"\'=Enquiry first');expect(csv).not.toMatch(/REPORT_PRIVATE|HIDDEN INTAKE/);expect(csv).toContain('owner approval pending');
  await page.getByRole('button',{name:'Refresh enquiry report',exact:true}).click();await expect(page.locator('[data-enquiry-metric="resolved"] td').last()).toHaveText('0');
  await page.locator('[data-enquiry-report]').evaluate((e) => e.scrollIntoView({block:'start',behavior:'instant'}));expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath('enquiry-report-viewport.png')});await page.locator('[data-enquiry-report]').screenshot({path:info.outputPath('enquiry-report.png')});
  await sourceChecks();
  await page.getByRole('button',{name:'Refresh enquiry report',exact:true}).click();await expect(page.locator('[data-enquiry-report]')).toContainText('requires reconciliation');await expect(page.locator('[data-enquiry-metric]')).toHaveCount(0);await expect(page.locator('[data-enquiry-report-export]')).toBeDisabled();
  await denied('GET',`${reportPath}?intakeId=${first.id}&format=csv`,undefined,office.token,409);
  await database(async (db) => {
    await db.query(`insert into prospective_enquiry_history (enquiry_id,revision,action,from_status,to_status,consent_active,consent_policy,assignee_id,escalated,escalation_level,actor_id)
      select id,revision,'triaged',status,status,consent_active,consent_policy,assignee_id,escalated,escalation_level,$2 from prospective_enquiries where id = $1`,[a.id,office.id]);
    await db.query('update resource_scopes set intake_id = $2 where resource_type = \'Application\' and resource_id = $1',[firstApplication.id,second.id]);
  });
  await denied('GET',`${reportPath}?intakeId=${first.id}`,undefined,office.token,409);
  await database(async (db) => {
    await db.query('update resource_scopes set intake_id = $2 where resource_type = \'Application\' and resource_id = $1',[firstApplication.id,first.id]);
    await db.query('update role_assignments set scope = $2::jsonb where account_id = $1 and role_code = \'admissions_manager\'',[office.id,JSON.stringify({programmeCodes:['BSC-IS'],intakeIds:[hidden.id]})]);
  });
  await denied('GET',`${reportPath}?intakeId=${first.id}&format=csv`,undefined,office.token,404);
  await page.getByRole('button',{name:'Refresh enquiry report',exact:true}).click();await expect(page.locator('[data-enquiry-report]')).toHaveCount(0);
  const restrictedRole = `report_only_${stamp.replaceAll('.','_')}`;
  await database(async (db) => {await db.query('insert into roles (code,name,risk) values ($1,\'Synthetic enquiry reporting only\',\'low\')',[restrictedRole]);await db.query('insert into role_permissions (role_code,permission_code) values ($1,\'enquiries.manage\')',[restrictedRole]);});
  await api('POST','/api/access/role-assignments',{accountId:office.id,roleCode:restrictedRole,scope:{programmeCodes:['BSC-IS'],intakeIds:[first.id]},reason:'Synthetic separated domain authority'},admin.token);
  const restricted = await api('GET',`${reportPath}?intakeId=${first.id}`,undefined,office.token);expect(restricted.totals.enquiriesTotal).toBe(2);expect(restricted.totals.verifiedAccounts).toBe(1);expect(restricted.applicationAuthority).toBe(false);expect(restricted.totals.enquiriesWithApplication).toBeNull();expect(restricted.totals.enquiriesWithLaterApplication).toBeNull();expect(restricted.controls.applicationsReconcile).toBeNull();
  await page.locator('[data-staff-signout]').click();await expect(page.locator('[data-form="staff-signin"]')).toBeVisible();expect(errors).toEqual([]);

  async function sourceChecks() {
    await database(async (db) => {
      const times = (await db.query(`select avg(extract(epoch from reply_at-created_at)/60)::double precision as mean from (
        select e.created_at,(select min(created_at) from prospective_enquiry_messages where enquiry_id = e.id and author_kind = 'staff' and visibility = 'public') as reply_at
        from prospective_enquiries e where e.intake_id = any($1::text[])) q`,[[first.id,second.id]])).rows[0];expect(initial.totals.meanFirstReplyMinutes).toBeCloseTo(times.mean,8);
      const audits = (await db.query("select metadata,reason from audit_events where action like 'reports.enquiries.%' and actor_id = $1",[office.id])).rows;expect(audits.length).toBeGreaterThan(0);expect(JSON.stringify(audits)).not.toContain('REPORT_PRIVATE');
      await db.query('update prospective_enquiries set revision = revision+1 where id = $1',[a.id]);
    });
  }
  async function database(work) {expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);const db = new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try {await work(db);} finally {await db.end();}}
  async function intake(label) {const r = await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`${label} ${stamp}`,capacity:10,startsOn:'2035-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+30*86400000).toISOString()},admin.token);await api('POST',`/api/master-data/intakes/${r.id}/transitions`,{toStatus:'published',reason:'Synthetic reporting intake'},admin.token);return r;}
  async function account(label) {const email = `enquiry.report.${label}.${stamp}@example.com`;await api('POST','/api/admissions/registrations',{email,preferredName:label,legalName:label});const outbox = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (f) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,f),'utf8'))));await api('POST','/api/identity/activations',{token:outbox.find((r) => r.recipientEmail === email).variables.activationToken,password,preferredName:label,legalName:label});const session = await api('POST','/api/identity/sessions',{email,password}),me = await api('GET','/api/identity/me',undefined,session.token);return {email,id:me.account.id,token:session.token};}
  async function create(owner,intake,label) {return api('POST',own,{intakeId:intake.id,subject:`REPORT_PRIVATE SUBJECT ${label}`,body:'REPORT_PRIVATE INITIAL BODY',consent:true,requestKey:`report_${label}_${stamp.replaceAll('.','_')}`},owner.token);}
  async function assign(row) {return api('POST',`${staffPath}/${row.id}/update`,{revision:row.revision,status:'in_progress',assigneeId:office.id,resolveEscalation:false,reason:'REPORT_PRIVATE ASSIGNMENT'},office.token);}
  async function update(row,status) {return api('POST',`${staffPath}/${row.id}/update`,{revision:row.revision,status,assigneeId:office.id,resolveEscalation:false,reason:'REPORT_PRIVATE RESOLUTION'},office.token);}
  async function message(row,visibility) {return api('POST',`${staffPath}/${row.id}/comment`,{revision:row.revision,body:'REPORT_PRIVATE MESSAGE',visibility,requestKey:`reply_${row.id.replaceAll('-','_')}`},office.token);}
  async function api(method,path,data,token) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBe(true);return (await r.json()).data;}
  async function denied(method,path,data,token,status) {const r = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(r.status(),await r.text()).toBe(status);}
});

test('enquiry report loaders discard departed and superseded reads and erase revoked scope',async ({page}) => {
  await page.goto('/#admissions');
  const result = await page.evaluate(async () => {
    const ui = window.enquiryReportingUI,state = {session:{token:'first'}};let release;
    const pending = ui.load(state,async () => new Promise((resolve) => {release = resolve;}));
    await ui.load(state,async () => ({filters:{},availableIntakes:[],totals:{enquiriesTotal:2}}));release({filters:{},availableIntakes:[],totals:{enquiriesTotal:1}});await pending;
    const latest = state.enquiryReport.totals.enquiriesTotal;
    let calls = 0;await ui.load(state,async () => {calls++;state.session = null;throw new Error('Departed');});
    const departedFollowUp = calls;state.session = {token:'current'};state.enquiryReportFilters = {intakeId:'private'};
    await ui.load(state,async () => {throw Object.assign(new Error('Revoked'),{status:403});});
    return {latest,departedFollowUp,erased:!Object.keys(state).some((k) => k.startsWith('enquiryReport'))};
  });
  expect(result).toEqual({latest:2,departedFollowUp:1,erased:true});
});
