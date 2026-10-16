import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";

test("graduation audits gate independently conferred awards that complete the programme and finalise the transcript",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "AWD" : "AWM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Amendment sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await api("POST","/api/master-data/programmes",{code:`AW-${stamp}`,name:`SAMPLE awards ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Amendment curriculum",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
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
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const gpa = await gradingPolicy();
  const registrations = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id).roster;
  const rows = registrations.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,mark:row.studentNumber === students[0].studentNumber ? 38 : 75}));
  const batch = await api("POST",`${staffBase}/results/${period.id}/batches`,{sourceRef:`SAMPLE-AW-${stamp}`,rows,checksum:resultsChecksum(rows),expectedRowCount:2,expectedMarkTotal:113,gpaRuleSetId:gpa.id,reason:"Board-approved marks"},registrar.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-BOARD",reason:"Independent review"},officer.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/publish`,{reason:"Publish"},officer.token);
  const approver = await account(`award.approver.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:approver.accountId,roleCode:"academic_approver",scope:{},reason:"Senate delegate"},admin.token);
  const [failingStudent,passingStudent] = students;
  const awardBase = (student) => `/api/registry/programmes/${student.id}/award`;
  expect(await api("GET",awardBase(passingStudent),undefined,registrar.token)).toMatchObject({published:null,audit:null,award:null});
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:"0".repeat(64),conferredOn:day(0),reason:"No rules"},registrar.token,409);

  // Rules are drafted in the UI by the registrar and published by an independent approver.
  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:passingStudent.studentNumber});
  await page.locator(`[data-registry-detail="${passingStudent.id}"]`).click();
  await page.locator("[data-registry-award] details > summary").first().click();
  await submit(page.locator("[data-award-rules-draft]"),{awardTitle:"Certificate in Sample Studies",minCredits:15,minElectiveCredits:0,minCumulativeGpa:2,gpaRuleSetId:gpa.id,reason:"Senate-approved completion rules"});
  await expect(page.getByRole("status")).toHaveText("Completion rules drafted for publication.");
  let context = await api("GET",awardBase(passingStudent),undefined,registrar.token);
  await expect(page.locator(`[data-award-rules-publish="${context.draft.id}"]`)).toHaveCount(0);
  await denied("POST",`${awardBase(passingStudent)}/rules/${context.draft.id}/publish`,{reason:"Own draft"},registrar.token,403);
  await denied("POST",`${awardBase(passingStudent)}/rules`,{rules:{awardTitle:"Second",minCredits:15,minElectiveCredits:0,minCumulativeGpa:2},gpaRuleSetId:gpa.id,reason:"Second draft"},registrar.token,409);
  await denied("POST",`${awardBase(passingStudent)}/rules`,{rules:{awardTitle:"Too high",minCredits:15,minElectiveCredits:30,minCumulativeGpa:2},gpaRuleSetId:gpa.id,reason:"Bad"},registrar.token,400);
  await api("POST",`${awardBase(passingStudent)}/rules/${context.draft.id}/publish`,{reason:"Matches the Senate minute"},approver.token);

  // The audit separates the passing and failing students; only an eligible, unchanged audit can be requested.
  await page.locator("[data-results-refresh]").click(); await expect(page.locator("[data-results-refresh]")).toBeEnabled();
  await expect(page.locator("[data-award-status]")).toHaveText("Eligible");
  await expect(page.locator('[data-award-check="core"]')).toHaveAttribute("data-met","true");
  const failing = await api("GET",awardBase(failingStudent),undefined,registrar.token);
  expect(failing.audit).toMatchObject({eligible:false,creditsEarned:0});
  expect(failing.audit.checks.find((row) => row.code === "core")).toMatchObject({met:false,detail:`Outstanding core courses: ${course.code}.`});
  await denied("POST",`${awardBase(failingStudent)}/requests`,{evidenceHash:failing.audit.evidenceHash,conferredOn:day(0),reason:"Not eligible"},registrar.token,409);
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:"0".repeat(64),conferredOn:day(0),reason:"Unreviewed"},registrar.token,409);
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:failing.audit.evidenceHash,conferredOn:"2026-02-30",reason:"Bad date"},registrar.token,400);
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:failing.audit.evidenceHash,conferredOn:day(0),reason:"No authority"},officer.token,403);
  await submit(page.locator("[data-award-request]"),{conferredOn:day(0),reason:"Completed all requirements"});
  await expect(page.getByRole("status")).toHaveText("Award requested for independent approval.");
  context = await api("GET",awardBase(passingStudent),undefined,registrar.token);
  const awardRequest = context.requests[0];
  expect(awardRequest).toMatchObject({status:"requested",awardTitle:"Certificate in Sample Studies",classification:expect.any(String),conferredOn:day(0)});
  await expect(page.locator(`[data-award-review="${awardRequest.id}"]`)).toHaveCount(0);
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:context.audit.evidenceHash,conferredOn:day(0),reason:"Duplicate"},registrar.token,409);
  await denied("POST",`${awardBase(passingStudent)}/requests/${awardRequest.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  // The approver confers it in the UI: the programme completes with history, the student is told, and the transcript is final.
  const approverContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const desk = await approverContext.newPage(); desk.setDefaultTimeout(15_000);
    await desk.goto("/#registry"); await submit(desk.locator("[data-registry-login]"),{email:approver.email,password:approver.password});
    await submit(desk.locator("[data-registry-filter]"),{q:passingStudent.studentNumber});
    await desk.locator(`[data-registry-detail="${passingStudent.id}"]`).click();
    await submit(desk.locator(`[data-award-review="${awardRequest.id}"]`),{outcome:"approved",reason:"Senate conferral list"});
    await expect(desk.getByRole("status")).toHaveText("Award conferred.");
    await expect(desk.locator("[data-award-conferred]")).toContainText("Certificate in Sample Studies");
  } finally {await approverContext.close();}
  await denied("POST",`${awardBase(passingStudent)}/requests/${awardRequest.id}/review`,{outcome:"rejected",reason:"Again"},approver.token,409);
  await denied("POST",`${awardBase(passingStudent)}/requests`,{evidenceHash:context.audit.evidenceHash,conferredOn:day(0),reason:"After conferral"},registrar.token,409);
  context = await api("GET",awardBase(passingStudent),undefined,registrar.token);
  expect(context).toMatchObject({status:"completed",award:{id:awardRequest.id,status:"approved"}});
  const completedReport = await api('GET',`/api/reports/registry?intakeId=${intake.id}`,undefined,admin.token);
  expect(completedReport.totals.completed).toBe(1);expect(completedReport.totals.unclassifiedProgrammes).toBe(0);expect(completedReport.totals.confirmedRegistrations).toBeGreaterThan(0);expect(completedReport.totals.courseEnrolments).toBeGreaterThan(0);
  expect(context.audit.checks.find((row) => row.code === "status")).toMatchObject({met:false,detail:"Programme status is completed."});
  const lifecycle = await api("GET",`/api/registry/programmes/${passingStudent.id}/lifecycle`,undefined,registrar.token);
  expect(lifecycle.history.at(-1)).toMatchObject({fromStatus:"onboarded",toStatus:"completed",reason:"Award conferred: Certificate in Sample Studies"});
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${passingStudent.accountId}`,undefined,admin.token)).map((row) => row.payload.subject);
  expect(notices).toContain("Your award has been conferred: Certificate in Sample Studies");
  const transcripts = await api("GET",`/api/registry/programmes/${passingStudent.id}/transcripts`,undefined,registrar.token);
  expect(transcripts.current.content).toMatchObject({programme:{status:"completed"},award:{title:"Certificate in Sample Studies",conferredOn:day(0)}});
  const issued = await api("POST",`/api/registry/programmes/${passingStudent.id}/transcripts`,{expectedHash:transcripts.current.contentHash,reason:"Final transcript"},registrar.token);
  expect((await api("GET",`/api/verify/transcripts/${issued.verificationCode}`)).status).toBe("issued");

  // The award certificate is issued from the staff UI and verifies publicly with the award but no marks or GPA.
  await denied("POST",`/api/registry/programmes/${failingStudent.id}/transcripts`,{expectedHash:"0".repeat(64),reason:"No award",kind:"certificate"},registrar.token,409);
  await denied("POST",`/api/registry/programmes/${passingStudent.id}/transcripts`,{expectedHash:"0".repeat(64),reason:"Bad kind",kind:"diploma"},registrar.token,400);
  await page.locator("[data-results-refresh]").click(); await expect(page.locator("[data-results-refresh]")).toBeEnabled();
  await page.locator('[data-transcript-open="certificate-preview"]').click();
  await expect(page.locator('[data-transcript-document="certificate-preview"] [data-transcript-banner]')).toHaveText("PREVIEW - not an issued certificate");
  await submit(page.locator("[data-certificate-issue]"),{reason:"Graduation certificate"});
  await expect(page.getByRole("status")).toContainText("Certificate issued with verification code");
  const documents = (await api("GET",`/api/registry/programmes/${passingStudent.id}/transcripts`,undefined,registrar.token)).transcripts;
  const certificate = documents.find((row) => row.kind === "certificate");
  expect(certificate).toMatchObject({status:"issued",outdated:false,content:{kind:"certificate",award:{title:"Certificate in Sample Studies",conferredOn:day(0)}}});
  expect(documents.find((row) => row.id === issued.id)).toMatchObject({kind:"progressive",status:"issued"});
  await expect(page.locator(`[data-transcript-document="${certificate.id}"] [data-certificate-holder]`)).toBeVisible();
  const verifiedCertificate = await api("GET",`/api/verify/transcripts/${certificate.verificationCode}`);
  expect(verifiedCertificate).toMatchObject({kind:"certificate",status:"issued",award:{title:"Certificate in Sample Studies"},summary:null,terms:[]});
  const events = await api("GET",`/api/audit/events?subjectType=AwardRequest&subjectId=${awardRequest.id}`,undefined,admin.token);
  expect(events.map((row) => row.action).sort()).toEqual(["award.approved","award.requested"]);

  const studentContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const portal = await studentContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#apply"); await submit(portal.locator('[data-form="signin"]'),{email:passingStudent.email,password:passingStudent.password});
    await expect(portal.locator("[data-student-award] [data-award-conferred]")).toContainText("Certificate in Sample Studies");
    await portal.locator(`[data-student-transcript="${issued.id}"]`).click();
    await expect(portal.locator(`[data-transcript-document="${issued.id}"] h2`)).toHaveText("Academic transcript (final)");
    await expect(portal.locator(`[data-transcript-document="${issued.id}"] [data-transcript-award]`)).toContainText("Certificate in Sample Studies");
    await portal.locator(`[data-student-transcript="${certificate.id}"]`).click();
    await expect(portal.locator(`[data-transcript-document="${certificate.id}"] [data-certificate-award]`)).toHaveText("Certificate in Sample Studies");
    expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
    await portal.screenshot({path:info.outputPath("student-award.png"),fullPage:true});
  } finally {await studentContext.close();}
  const own = await api("GET",`/api/registry/me/programmes/${failingStudent.id}/award`,undefined,failingStudent.token);
  expect(own).toMatchObject({award:null,audit:{eligible:false}});
  expect(own.capabilities).toBeUndefined();
  await denied("GET",`/api/registry/me/programmes/${failingStudent.id}/award`,undefined,passingStudent.token,404);
  await page.screenshot({path:info.outputPath("award.png"),fullPage:true});

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
