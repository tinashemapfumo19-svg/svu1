import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";
import pg from 'pg';

test("published results change only through evidenced, independently approved amendments with retained history",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "RAD" : "RAM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Amendment sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await api("POST","/api/master-data/programmes",{code:`RA-${stamp}`,name:`SAMPLE amendments ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Amendment curriculum",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE amendments ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`amend.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
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
  const officer = await account(`amend.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const gpa = await gradingPolicy();
  const registrations = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id).roster;
  const rows = registrations.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,mark:row.studentNumber === students[0].studentNumber ? 38 : 75}));
  const batch = await api("POST",`${staffBase}/results/${period.id}/batches`,{sourceRef:`SAMPLE-RA-${stamp}`,rows,checksum:resultsChecksum(rows),expectedRowCount:2,expectedMarkTotal:113,gpaRuleSetId:gpa.id,reason:"Board-approved marks"},registrar.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-BOARD",reason:"Independent review"},officer.token);
  const noticeDb=new pg.Client({connectionString:process.env.DATABASE_URL});await noticeDb.connect();
  const publishPath=`${staffBase}/results/${period.id}/batches/${batch.id}/publish`,draftId=`nt_results_notice_probe_${info.project.name}`;
  try {
    await noticeDb.query("insert into notification_templates(id,code,channel,subject,body,version,status) values($1,'results.published','email','UNAPPROVED','UNAPPROVED {{studentNumber}}',2,'draft')",[draftId]);
    try {
      await noticeDb.query("update notification_templates set status='draft' where id='nt_results_published_email_v1'");
      expect((await request.post(publishPath,{data:{reason:'Inactive template must roll back publication'},headers:{Authorization:`Bearer ${officer.token}`}})).status()).toBe(500);
      await unchanged();
    } finally {await noticeDb.query("update notification_templates set status='active' where id='nt_results_published_email_v1'");}
    try {
      await noticeDb.query(`create function result_notice_probe() returns trigger language plpgsql as $$ begin
        if new.template_id='nt_results_published_email_v1' and exists(select 1 from notifications where template_id=new.template_id and created_at=now()) then raise exception 'Controlled second publication notice failure'; end if;
        return new; end $$;
        create trigger result_notice_probe before insert on notifications for each row execute function result_notice_probe()`);
      expect((await request.post(publishPath,{data:{reason:'Second notice failure must roll back all publication writes'},headers:{Authorization:`Bearer ${officer.token}`}})).status()).toBe(500);
      await unchanged();
    } finally {await noticeDb.query('drop trigger if exists result_notice_probe on notifications; drop function if exists result_notice_probe()');}
    const released=await Promise.all([1,2].map(()=>api('POST',publishPath,{reason:'Concurrent valid publication'},officer.token)));
    expect(released.map(row=>row.id)).toEqual([batch.id,batch.id]);
    const queued=(await noticeDb.query("select n.recipient_account_id,n.status,n.payload,n.template_id from notifications n join notification_templates t on t.id=n.template_id where t.code='results.published' and n.recipient_account_id=any($1::text[])",[students.map(row=>row.accountId)])).rows;
    expect(queued).toHaveLength(2);
    expect(queued.map(row=>row.recipient_account_id).sort()).toEqual(students.map(row=>row.accountId).sort());
    for(const notice of queued)expect(notice).toMatchObject({template_id:'nt_results_published_email_v1',status:'queued',payload:{subject:'Your results are available',body:'New results are available in your student portal. Sign in to view your official results.',sensitive:false}});
    expect((await noticeDb.query("select metadata->>'queuedNotices' as count from audit_events where subject_id=$1 and action='results.batch.published'",[batch.id])).rows.map(row=>row.count)).toEqual(['2']);
  } finally {try{await noticeDb.query('delete from notification_templates where id=$1',[draftId]);}finally{await noticeDb.end();}}
  async function unchanged() {
    expect((await noticeDb.query('select status from result_batches where id=$1',[batch.id])).rows[0].status).toBe('reviewed');
    expect((await noticeDb.query('select count(*)::int as count from academic_results where batch_id=$1',[batch.id])).rows[0].count).toBe(0);
    expect((await noticeDb.query("select count(*)::int as count from notifications n join notification_templates t on t.id=n.template_id where t.code='results.published' and recipient_account_id=any($1::text[])",[students.map(row=>row.accountId)])).rows[0].count).toBe(0);
    expect((await noticeDb.query("select count(*)::int as count from audit_events where subject_id=$1 and action='results.batch.published'",[batch.id])).rows[0].count).toBe(0);
  }
  const failing = rows.find((row) => row.mark === 38),passing = rows.find((row) => row.mark === 75);
  const amendBase = `${staffBase}/results/${period.id}/amendments`;
  expect((await api("GET",`/api/registry/me/programmes/${students[0].id}/results`,undefined,students[0].token))[0].results[0]).toMatchObject({mark:38,grade:"F",passing:false});

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:students[0].studentNumber});
  await page.locator(`[data-registry-detail="${students[0].id}"]`).click();
  await expect(page.locator("[data-results-refresh]")).toBeEnabled();
  const form = page.locator(`[data-result-amend="${period.id}"]`);
  await form.locator("..").locator("summary").click();
  await submit(form,{result:`${failing.registrationId}|${failing.courseId}|0`,mark:"72",category:"marking_error",evidenceRef:"SAMPLE-SCRIPT-RECHECK",reason:"Page four of the script was not marked"});
  await expect(page.getByRole("status")).toHaveText("Result amendment requested.");
  let list = await api("GET",amendBase,undefined,registrar.token);
  const amendment = list.amendments[0];
  expect(amendment).toMatchObject({status:"requested",from:{mark:38,grade:"F"},to:{mark:72,grade:"P",passing:true}});
  await expect(page.locator(`[data-amendment-review="${amendment.id}"]`)).toHaveCount(0);
  await denied("POST",`${amendBase}/${amendment.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
  await denied("POST",amendBase,{registrationId:failing.registrationId,courseId:failing.courseId,revision:0,mark:65,category:"appeal",reason:"Second request",evidenceRef:"SAMPLE"},officer.token,409);
  await denied("POST",amendBase,{registrationId:passing.registrationId,courseId:passing.courseId,revision:0,mark:75,category:"appeal",reason:"No change",evidenceRef:"SAMPLE"},registrar.token,400);
  await denied("POST",amendBase,{registrationId:passing.registrationId,courseId:passing.courseId,revision:0,mark:60,category:"appeal",reason:"No authority",evidenceRef:"SAMPLE"},students[0].token,403);
  const approved = await api("POST",`${amendBase}/${amendment.id}/review`,{outcome:"approved",reason:"Second marker confirmed the missed page"},officer.token);
  expect(approved.followUp).toEqual({creditRecognitions:[],academicDecisions:[]});
  await denied("POST",`${amendBase}/${amendment.id}/review`,{outcome:"rejected",reason:"Immutable"},officer.token,409);
  await denied("POST",amendBase,{registrationId:failing.registrationId,courseId:failing.courseId,revision:0,mark:80,category:"appeal",reason:"Stale revision",evidenceRef:"SAMPLE"},registrar.token,409);

  await api("POST",amendBase,{registrationId:passing.registrationId,courseId:passing.courseId,revision:0,mark:60,category:"moderation",reason:"Moderator recommended a lower mark",evidenceRef:"SAMPLE-MOD"},registrar.token);
  list = await api("GET",amendBase,undefined,registrar.token);
  await api("POST",`${amendBase}/${list.amendments[0].id}/review`,{outcome:"rejected",reason:"Moderation sample did not support the change"},officer.token);
  expect((await api("GET",`/api/registry/me/programmes/${students[1].id}/results`,undefined,students[1].token))[0].results[0]).toMatchObject({mark:75});

  const own = (await api("GET",`/api/registry/me/programmes/${students[0].id}/results`,undefined,students[0].token))[0];
  expect(own.results[0]).toMatchObject({mark:72,grade:"P",passing:true,amended:true,publishedMark:38});
  expect(own.gpa).toBe(3);
  const staffView = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  await api('POST',publishPath,{reason:'Retry after amendment must not repeat release notices'},officer.token);
  const noticeCheck=new pg.Client({connectionString:process.env.DATABASE_URL});await noticeCheck.connect();
  try {expect((await noticeCheck.query("select count(*)::int as count from notifications n join notification_templates t on t.id=n.template_id where t.code='results.published' and recipient_account_id=any($1::text[])",[students.map(row=>row.accountId)])).rows[0].count).toBe(2);}finally{await noticeCheck.end();}
  expect(staffView.completion).toMatchObject({sourceCurrent:true,counts:{publishedRecords:2,awaitingRecording:0,awaitingReview:0,awaitingPublication:0}});
  expect(staffView.batches[0].rows.find((row) => row.registrationId === failing.registrationId).mark).toBe(38);
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${students[0].accountId}`,undefined,admin.token)).map((row) => row.payload.subject);
  expect(notices).toContain(`Your ${course.code} result has been amended`);
  const events = await api("GET",`/api/audit/events?subjectId=${amendment.id}`,undefined,admin.token);
  expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(["results.amendment.requested","results.amendment.approved"]));
  await page.locator("[data-results-refresh]").click(); await expect(page.locator("[data-results-refresh]")).toBeEnabled();
  await expect(page.locator(`[data-result-row="${failing.registrationId}:${failing.courseId}"]`)).toContainText("72 (amended from 38)");
  await expect(page.locator(`[data-result-amendment="${amendment.id}"]`)).toContainText("approved");

  const studentContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const portal = await studentContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#apply"); await submit(portal.locator('[data-form="signin"]'),{email:students[0].email,password:students[0].password});
    await expect(portal.locator(".student-results")).toContainText("(amended; published 38)");
    expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
  } finally {await studentContext.close();}
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("amendments.png"),fullPage:true});

  async function gradingPolicy() {
    const code = `ra_${stamp.replaceAll(".","_")}`;
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
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-RA-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-RA-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`RA-Y-${y}-${stamp}`,name:`SAMPLE amendments ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`RA-S-${y}-${stamp}`,name:`SAMPLE amendments ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
