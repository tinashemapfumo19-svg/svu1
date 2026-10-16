import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

test('academic report loaders discard departed, superseded and revoked private caches',async ({page}) => {
  await page.goto('/#registry');await page.waitForFunction(() => Boolean(window.academicOutcomeReportingUI));
  expect(await page.evaluate(async () => {
    const output = [];
    for (const fail of [false,true]) {
      const state = {session:{token:'old'}};let deliver,reject;const pending = new Promise((ok,no) => {deliver = ok;reject = no;});
      const read = academicOutcomeReportingUI.load(state,() => pending);state.session.token = 'new';state.academicOutcomeReport = {marker:'new'};
      if (fail) reject(new Error('Old private error'));else deliver({marker:'old'});await read;output.push(state.academicOutcomeReport);
    }
    const state = {session:{token:'same'}};let deliver;const old = new Promise((ok) => {deliver = ok;});const read = academicOutcomeReportingUI.load(state,() => old);
    await academicOutcomeReportingUI.load(state,async () => ({marker:'current',filters:{}}));deliver({marker:'old'});await read;output.push(state.academicOutcomeReport);
    for (const status of [401,403,404]) {const denied = {session:{token:'same'},academicOutcomeReport:{private:1},academicOutcomeReportIntakes:[{private:2}],academicOutcomeReportFilters:{intakeId:'private'}};await academicOutcomeReportingUI.load(denied,async () => {const e = new Error('Denied');e.status = status;throw e;});output.push(Object.keys(denied));}
    const broken = {session:{token:'same'},academicOutcomeReport:{private:1}};await academicOutcomeReportingUI.load(broken,async (method,path) => {if (path.endsWith('/intakes')) return [];throw new Error('Reconcile');});output.push({report:broken.academicOutcomeReport,intakes:broken.academicOutcomeReportIntakes,error:broken.academicOutcomeReportError});return output;
  })).toEqual([{marker:'new'},{marker:'new'},{marker:'current',filters:{}},['session'],['session'],['session'],{report:null,intakes:[],error:'Reconcile'}]);
});
import { resultsChecksum } from "../server/modules/results.js";

test("academic outcome reporting follows native results, retained progression, amendments and conferrals",async ({page,browser,request},info) => {
  test.setTimeout(480_000);
  page.setDefaultTimeout(25_000);const errors = [];page.on("pageerror",(e) => errors.push(e.message));
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "AOR" : "AOM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Amendment sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await api("POST","/api/master-data/programmes",{code:`AW-${stamp}`,name:`SAMPLE awards ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Amendment curriculum",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  const nextCourse = await api("POST","/api/master-data/courses",{code:`${prefix}201`,title:"Synthetic next-year elective",credits:15,level:2,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:nextCourse.id,yearOfStudy:2,term:"S1",requirementType:"elective"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE awards ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`award.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
  const staffBase = `/api/registry/programmes/${students[0].id}`,term = await calendar(2025);
  const period = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{offerings:[{courseId:course.id,delivery:"asynchronous",meetings:[]}],reason:"Synthetic delivery"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  for (const student of students) {
    await api("PUT",`/api/registry/me/programmes/${student.id}/registrations/${period.id}`,{revision:0,courseIds:[course.id]},student.token);
    for (const checkType of ["academic","financial"]) await api("POST",`/api/registry/programmes/${student.id}/registrations/${period.id}/checks`,{revision:1,checkType,outcome:"eligible",reason:"Synthetic clearance",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);
    await api("POST",`/api/registry/me/programmes/${student.id}/registrations/${period.id}/confirm`,{revision:1},student.token);
  }
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"closed",reason:"Semester complete"},admin.token);
  const officer = await account(`award.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Examinations office"},admin.token);
  const gpa = await gradingPolicy();
  const registrations = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id).roster;
  const rows = registrations.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,mark:row.studentNumber === students[0].studentNumber ? 38 : 75}));
  const batch = await api("POST",`${staffBase}/results/${period.id}/batches`,{sourceRef:`SAMPLE-AW-${stamp}`,rows,checksum:resultsChecksum(rows),expectedRowCount:2,expectedMarkTotal:113,gpaRuleSetId:gpa.id,reason:"Board-approved marks"},registrar.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-BOARD",reason:"Independent review"},officer.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/publish`,{reason:"Publish"},officer.token);
  const approver = await account(`award.approver.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:approver.accountId,roleCode:"academic_approver",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Senate delegate"},admin.token);
  const [failingStudent,passingStudent] = students;

  const passBase = `/api/registry/programmes/${passingStudent.id}`,failBase = `/api/registry/programmes/${failingStudent.id}`;
  const target = await api('POST',`${passBase}/registration-periods`,{academicPeriodId:(await calendar(2026)).id,yearOfStudy:2,term:'S1',creditLimit:30,reason:'Synthetic next-year target'},admin.token);
  const policy = await api('POST',`${passBase}/academic/policies`,{code:`out_${stamp.replaceAll('.','_')}`,name:'Synthetic reporting progression',gpaRuleSetId:gpa.id,rules:{minGpa:2,minPassedCredits:15,maxFailedCredits:0,maxOutstandingCoreCourses:0,maxAttempts:3,allowPassedRetake:false},reason:'Synthetic policy'},registrar.token);
  await api('POST',`${passBase}/academic/policies/${policy.id}/publish`,{effectiveFrom:'2024-01-01',evidenceRef:'SAMPLE-REPORT-POLICY',reason:'Independent publication'},approver.token);
  await api('POST',`${passBase}/registration-periods/${target.id}`,{academicPolicyId:policy.id,reason:'Attach policy'},admin.token);
  for (const [student,outcome] of [[passingStudent,'approved'],[failingStudent,'rejected']]) {
    const base = `/api/registry/programmes/${student.id}`,context = await api('GET',`${base}/academic`,undefined,registrar.token),academic = context.contexts.find((c) => c.period.id === target.id);
    const decision = await api('POST',`${base}/academic/${target.id}/decisions`,{kind:'progression',evidenceHash:academic.evidenceHash,expiresOn:day(7),evidenceRef:'SAMPLE-REPORT-DECISION',reason:'Synthetic progression'},registrar.token);
    await api('POST',`${base}/academic/${target.id}/decisions/${decision.id}/review`,{outcome,reason:'Independent record review'},approver.token);
  }
  const rule = await api('POST',`${passBase}/award/rules`,{rules:{awardTitle:'Synthetic reporting award',minCredits:15,minElectiveCredits:0,minCumulativeGpa:2},gpaRuleSetId:gpa.id,reason:'Synthetic completion rules'},registrar.token);
  await api('POST',`${passBase}/award/rules/${rule.draft.id}/publish`,{reason:'Independent rules'},approver.token);
  const audit = await api('GET',`${passBase}/award`,undefined,registrar.token);
  const requested = await api('POST',`${passBase}/award/requests`,{evidenceHash:audit.audit.evidenceHash,conferredOn:day(0),reason:'Synthetic conferral'},registrar.token);
  await api('POST',`${passBase}/award/requests/${requested.requests[0].id}/review`,{outcome:'approved',reason:'Independent conferral'},approver.token);
  const office = await account(`outcome.office.${stamp}@example.com`);
  await api('POST','/api/access/role-assignments',{accountId:office.accountId,roleCode:'academic_registrar',scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:'Scoped outcome report'},admin.token);
  await api('POST','/api/access/role-assignments',{accountId:office.accountId,roleCode:'auditor',scope:{},reason:'Unrelated global role'},admin.token);
  const hidden = await api('POST','/api/master-data/intakes',{programmeId:programme.id,label:`PRIVATE OUTCOME ${stamp}`,capacity:5,startsOn:'2025-01-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api('POST',`/api/master-data/intakes/${hidden.id}/transitions`,{toStatus:'published',reason:'Synthetic other scope'},admin.token);
  const report = await api('GET','/api/reports/academic',undefined,office.token);
  expect(report.totals).toMatchObject({resultBatches:1,publishedBatches:1,confirmedEnrolments:2,officialResults:2,withoutOfficialResult:0,passingResults:1,failingResults:1,amendedResults:0,markSamples:2,meanOfficialMark:56.5,decisionRecords:2,approvedDecisions:1,rejectedDecisions:1,progressionDecisions:2,awardRequests:1,approvedAwards:1,completedProgrammeRecords:1});
  expect(Object.values(report.controls).every(Boolean)).toBe(true);expect(report.rows).toHaveLength(1);
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE OUTCOME|@example.com|studentNumber|requestedBy|sourceSnapshot/);
  await denied('GET',`/api/reports/academic?intakeId=${hidden.id}`,undefined,office.token,404);
  await denied('GET','/api/reports/academic',undefined,passingStudent.token,403);
  const approverReport = await api('GET','/api/reports/academic',undefined,approver.token);expect(approverReport.totals.officialResults).toBe(2);expect(approverReport.controls.resultsReconcile).toBe(true);expect(approverReport.totals.approvedAwards).toBe(1);
  await page.goto('/#registry');await submit(page.locator('[data-registry-login]'),{email:office.email,password:office.password});
  await expect(page.locator('[data-academic-outcome-report]')).toBeVisible({timeout:45000});await expect(page.locator('[data-academic-outcome-report-filter]')).toBeEnabled();await page.locator('[data-academic-outcome-report] > summary').click();
  await expect(page.locator('[data-academic-outcome-metric="meanOfficialMark"] td').last()).toHaveText('56.5');
  await submit(page.locator('[data-academic-outcome-report-filter]'),{domain:'awards'});await expect(page.locator('[data-academic-outcome-metric="officialResults"] td').last()).toHaveText('-');await expect(page.locator('[data-academic-outcome-metric="approvedAwards"] td').last()).toHaveText('1');
  await submit(page.locator('[data-academic-outcome-report-filter]'),{domain:''});await expect(page.locator('[data-academic-outcome-metric="failingResults"] td').last()).toHaveText('1');
  const failed = batch.rows.find((r) => r.mark === 38);
  const amendment = await api('POST',`${failBase}/results/${period.id}/amendments`,{registrationId:failed.registrationId,courseId:failed.courseId,revision:0,mark:55,category:'transcription_error',evidenceRef:'SAMPLE-REPORT-AMENDMENT',reason:'SECRET AMENDMENT REASON'},registrar.token);
  await api('POST',`${failBase}/results/${period.id}/amendments/${amendment.id}/review`,{outcome:'approved',reason:'Independent amendment'},officer.token);
  const downloadEvent = page.waitForEvent('download');await page.locator('[data-academic-outcome-report-export]').click();const download = await downloadEvent,csv = await readFile(await download.path(),'utf8');
  expect(csv).toMatch(/"total"[^\r\n]*"meanOfficialMark","mark points","65"/);expect(csv).toMatch(/"total"[^\r\n]*"failingResults","results","0"/);expect(csv).not.toMatch(/SECRET|PRIVATE OUTCOME|@example.com/);
  await expect(page.locator('[data-academic-outcome-metric="failingResults"] td').last()).toHaveText('1');
  await refresh();await expect(page.locator('[data-academic-outcome-metric="meanOfficialMark"] td').last()).toHaveText('65');
  expect((await api('GET','/api/reports/academic',undefined,office.token)).totals.approvedDecisions).toBe(1);
  const client = new pg.Client({connectionString:process.env.DATABASE_URL});expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);await client.connect();
  try {
    const direct = (await client.query(`select avg((ar.result_snapshot->>'mark')::numeric)::double precision as mean from academic_results ar join student_registrations sr on sr.id = ar.registration_id join registration_periods rp on rp.id = sr.period_id where rp.intake_id = $1`,[intake.id])).rows[0].mean;expect(direct).toBe(65);
    const limited = await account(`outcome.split.${stamp}@example.com`),roles = [`out_registry_${stamp.replaceAll('.','_')}`,`out_results_${stamp.replaceAll('.','_')}`];
    for (const [code,permission,intakeId] of [[roles[0],'registry.view',intake.id],[roles[1],'results.view',hidden.id]]) {
      await client.query("insert into roles (code,name,risk) values ($1,'Synthetic separated outcome authority','low')",[code]);await client.query('insert into role_permissions (role_code,permission_code) values ($1,$2)',[code,permission]);
      await api('POST','/api/access/role-assignments',{accountId:limited.accountId,roleCode:code,scope:{programmeCodes:[programme.code],intakeIds:[intakeId]},reason:'Separate domain scopes'},admin.token);
    }
    const separated = await api('GET','/api/reports/academic',undefined,limited.token);expect(separated.rows).toHaveLength(2);expect(separated.totals.approvedAwards).toBeNull();expect(separated.totals.officialResults).toBeNull();expect(separated.rows.find((r) => r.intakeId === intake.id).counts.approvedAwards).toBe(1);
    const oneDomain = await api('GET','/api/reports/academic?domain=awards',undefined,limited.token);expect(oneDomain.rows).toHaveLength(1);expect(oneDomain.totals.approvedAwards).toBe(1);expect(oneDomain.totals.officialResults).toBeNull();
    const stored = (await client.query('select result_snapshot from academic_results where registration_id = $1 and course_id = $2',[failed.registrationId,failed.courseId])).rows[0].result_snapshot;
    await client.query(`update academic_results set result_snapshot = jsonb_set(result_snapshot,'{mark}','"BROKEN"'::jsonb) where registration_id = $1 and course_id = $2`,[failed.registrationId,failed.courseId]);
    await denied('GET','/api/reports/academic',undefined,office.token,409);await denied('GET','/api/reports/academic?format=csv',undefined,office.token,409);
    expect((await api('GET','/api/reports/academic?domain=awards',undefined,limited.token)).totals.approvedAwards).toBe(1);
    await refresh();await expect(page.locator('[data-academic-outcome-report] [role="alert"]')).toContainText('reconciliation');await expect(page.locator('[data-academic-outcome-metric]')).toHaveCount(0);await expect(page.locator('[data-academic-outcome-report-export]')).toBeDisabled();
    await client.query('update academic_results set result_snapshot = $3::jsonb where registration_id = $1 and course_id = $2',[failed.registrationId,failed.courseId,JSON.stringify(stored)]);
    await refresh();await expect(page.locator('[data-academic-outcome-metric="meanOfficialMark"] td').last()).toHaveText('65');
    await client.query('update intakes set label = $2 where id = $1',[intake.id,'=OUTCOME_FORMULA']);expect((await api('GET','/api/reports/academic?format=csv',undefined,office.token)).csv).toContain('"\'=OUTCOME_FORMULA"');
    await refresh();await page.locator('[data-academic-outcome-report-filter] button[type="submit"]').waitFor({state:'visible'});await expect(page.locator('[data-academic-outcome-report-filter] button[type="submit"]')).toBeEnabled();
    await page.locator('[data-academic-outcome-report]').evaluate((el) => {el.scrollIntoView({block:'start',behavior:'instant'});window.scrollBy(0,-100);});await page.screenshot({path:info.outputPath('academic-outcome-viewport.png')});await page.screenshot({path:info.outputPath('academic-outcome.png'),fullPage:true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    const audits = (await client.query("select reason,metadata from audit_events where actor_id = $1 and action = 'reports.academic.exported'",[office.accountId])).rows;expect(audits.length).toBeGreaterThanOrEqual(2);expect(JSON.stringify(audits)).not.toMatch(/SECRET|OUTCOME_FORMULA|@example.com/);
    await client.query("update role_assignments set effective_to = current_date-1 where account_id = $1 and role_code = 'academic_registrar'",[office.accountId]);
    await refresh();await expect(page.locator('[data-academic-outcome-report]')).toHaveCount(0);
    await page.locator('[data-registry-signout]').click();await expect(page.locator('[data-registry-login]')).toBeVisible();expect(errors).toEqual([]);
  } finally {await client.end();}
  async function refresh() {await page.locator('[data-academic-outcome-report-filter] button[type="submit"]').click();}

  async function gradingPolicy() {
    const code = `aw_${stamp.replaceAll(".","_")}`;
    const scheme = await api("POST","/api/master-data/grading-schemes",{code,name:"SAMPLE amendment grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:100,grade:"P",points:3,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic grades"},registrar.token);
    const rule = await api("POST","/api/master-data/gpa-rule-sets",{code,name:"SAMPLE amendment GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"X",credits:15,mark:75}],expectedGpa:3,expectedClassification:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/gpa-rule-sets/${rule.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic GPA"},registrar.token);
    return rule;
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Amend Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id,accountId:me.account.id};
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-AW-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-AW-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`AW-Y-${y}-${stamp}`,name:`SAMPLE amendments ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`AW-S-${y}-${stamp}`,name:`SAMPLE amendments ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
