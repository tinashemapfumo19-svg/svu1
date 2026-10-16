import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";

test("registrars issue verifiable transcripts that stay fixed, are superseded after amendments, and can be revoked",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "TRD" : "TRM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Amendment sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await api("POST","/api/master-data/programmes",{code:`TR-${stamp}`,name:`SAMPLE transcripts ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Amendment curriculum",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE transcripts ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`transcript.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
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
  const officer = await account(`transcript.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const gpa = await gradingPolicy();
  const registrations = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id).roster;
  const rows = registrations.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,mark:row.studentNumber === students[0].studentNumber ? 38 : 75}));
  const batch = await api("POST",`${staffBase}/results/${period.id}/batches`,{sourceRef:`SAMPLE-TR-${stamp}`,rows,checksum:resultsChecksum(rows),expectedRowCount:2,expectedMarkTotal:113,gpaRuleSetId:gpa.id,reason:"Board-approved marks"},registrar.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-BOARD",reason:"Independent review"},officer.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batch.id}/publish`,{reason:"Publish"},officer.token);
  // Official wording comes from an approved template: the registrar drafts it in the Resources page and a records manager approves it.
  const records = await account(`transcript.records.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:records.accountId,roleCode:"records_manager",scope:{},reason:"Records office"},admin.token);
  const signatory = `Dr Rudo Ncube ${info.project.name}`;
  await page.goto("/#resources");
  await page.evaluate((token) => {sessionStorage.clear(); sessionStorage.setItem("svu.registry.session",JSON.stringify({token}));},registrar.token);
  await page.reload();
  await page.locator("[data-document-templates] > summary").click();
  const draftPanel = page.locator('[data-template-kind="progressive"] details');
  await draftPanel.locator("summary").click();
  await submit(draftPanel.locator("[data-template-draft-form]"),{signatoryName:signatory,footerText:"Issued under the 2026 records policy.",reason:"Registrar signature for 2026"});
  await expect(page.getByRole("status")).toHaveText("Template submitted for approval.");
  const drafts = (await api("GET","/api/document-templates",undefined,records.token)).templates.filter((row) => row.kind === "progressive" && row.status === "draft");
  expect(drafts).toHaveLength(1);
  await denied("POST",`/api/document-templates/${drafts[0].id}/review`,{outcome:"published",reason:"Own draft"},registrar.token,403);
  await denied("POST","/api/document-templates",{kind:"progressive",content:{title:"x"},reason:"Missing fields"},registrar.token,400);
  await denied("POST","/api/document-templates",{kind:"certificate",content:{institutionName:"SVU",title:"Certificate",signatoryTitle:"Registrar",footerText:"x",preamble:"This is",conferralText:"no placeholder"},reason:"Bad"},registrar.token,400);
  const approved = await api("POST",`/api/document-templates/${drafts[0].id}/review`,{outcome:"published",reason:"Matches the records policy"},records.token);
  expect(approved).toMatchObject({status:"published",content:{signatoryName:signatory,title:"Academic transcript"}});
  await denied("POST",`/api/document-templates/${drafts[0].id}/review`,{outcome:"rejected",reason:"Again"},records.token,409);
  // Leave the page entirely so in-memory sessions are dropped before the registry sign-in below.
  await page.evaluate(() => sessionStorage.clear()); await page.goto("about:blank");

  const base = `${staffBase}/transcripts`;
  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:students[0].studentNumber});
  await page.locator(`[data-registry-detail="${students[0].id}"]`).click();
  const panel = page.locator("[data-registry-transcripts]");
  await expect(panel).toContainText("Current record: 1 term(s), cumulative GPA 0.00");
  await panel.locator('[data-transcript-open="preview"]').click();
  await expect(page.locator('[data-transcript-document="preview"] [data-transcript-banner]')).toHaveText("PREVIEW - not an issued transcript");
  await submit(page.locator("[data-transcript-issue]"),{reason:"Student requested a progressive transcript"});
  await expect(page.getByRole("status")).toContainText("Transcript issued with verification code");
  let list = await api("GET",base,undefined,registrar.token);
  const first = list.transcripts[0];
  expect(first).toMatchObject({status:"issued",outdated:false,contentHash:list.current.contentHash});
  expect(first.content.terms[0].results[0]).toMatchObject({code:course.code,mark:38,grade:"F",amended:false});
  await expect(page.locator(`[data-transcript-document="${first.id}"] [data-transcript-code]`)).toHaveText(first.verificationCode);
  expect(first.referenceNumber).toMatch(/^SVU-TR-\d{4}-\d{6}$/);
  expect(first.template).toMatchObject({id:approved.id,version:approved.version});
  await expect(page.locator(`[data-transcript-document="${first.id}"] [data-transcript-reference]`)).toHaveText(first.referenceNumber);
  await expect(page.locator(`[data-transcript-document="${first.id}"] [data-template-signatory]`)).toContainText(signatory);

  await denied("POST",base,{expectedHash:list.current.contentHash,reason:"No authority"},officer.token,403);
  await denied("GET",base,undefined,students[0].token,403);
  await denied("GET",`/api/registry/me/programmes/${students[0].id}/transcripts`,undefined,students[1].token,404);
  await denied("POST",base,{expectedHash:"0".repeat(64),reason:"Unreviewed"},registrar.token,409);
  await denied("POST",base,{expectedHash:list.current.contentHash,reason:"Extra",extra:true},registrar.token,400);

  // Public verification needs no account, accepts the code as typed, and exposes no course-level detail.
  let verified = await api("GET",`/api/verify/transcripts/${first.verificationCode.toLowerCase().replaceAll("-","")}`);
  expect(verified).toMatchObject({referenceNumber:first.referenceNumber,templateVersion:approved.version,status:"issued",student:{studentNumber:students[0].studentNumber},contentHash:first.contentHash,summary:{cumulativeGpa:0}});
  expect(JSON.stringify(verified)).not.toContain(course.code);
  await denied("GET","/api/verify/transcripts/AAAA-AAAA-AAAA-AAAA",undefined,undefined,404);
  await denied("GET","/api/verify/transcripts/not-a-code",undefined,undefined,404);

  // An approved amendment leaves the issued transcript unchanged but outdated; the stale record hash cannot be reissued.
  const failing = rows.find((row) => row.mark === 38),amendBase = `${staffBase}/results/${period.id}/amendments`;
  await api("POST",amendBase,{registrationId:failing.registrationId,courseId:failing.courseId,revision:0,mark:72,category:"marking_error",reason:"Page four was not marked",evidenceRef:"SAMPLE-RECHECK"},registrar.token);
  const amendment = (await api("GET",amendBase,undefined,registrar.token)).amendments[0];
  await api("POST",`${amendBase}/${amendment.id}/review`,{outcome:"approved",reason:"Second marker confirmed"},officer.token);
  list = await api("GET",base,undefined,registrar.token);
  expect(list.transcripts[0]).toMatchObject({id:first.id,outdated:true,content:first.content});
  expect(list.current.content.terms[0].results[0]).toMatchObject({mark:72,amended:true});
  await denied("POST",base,{expectedHash:first.contentHash,reason:"Old record"},registrar.token,409);
  await page.locator("[data-results-refresh]").click(); await expect(page.locator("[data-results-refresh]")).toBeEnabled();
  await expect(page.locator("[data-transcript-outdated]")).toBeVisible();
  await submit(page.locator("[data-transcript-issue]"),{reason:"Reissued after result amendment"});
  await expect(page.getByRole("status")).toContainText("Transcript issued with verification code");
  list = await api("GET",base,undefined,registrar.token);
  const second = list.transcripts.find((row) => row.id !== first.id);
  expect(list.transcripts.find((row) => row.id === first.id)).toMatchObject({status:"superseded",supersededBy:second.id});
  expect(second).toMatchObject({status:"issued",outdated:false,content:{summary:{cumulativeGpa:3}}});
  expect(second.verificationCode).not.toBe(first.verificationCode);
  expect((await api("GET",`/api/verify/transcripts/${first.verificationCode}`)).status).toBe("superseded");

  await page.locator(`[data-transcript="${second.id}"] summary`).click();
  await submit(page.locator(`[data-transcript-revoke="${second.id}"]`),{reason:"Issued to the wrong recipient"});
  await expect(page.getByRole("status")).toHaveText("Document revoked.");
  await denied("POST",`${base}/${second.id}/revoke`,{reason:"Again"},registrar.token,409);
  await denied("POST",`${base}/${first.id}/revoke`,{reason:"Superseded"},registrar.token,409);
  verified = await api("GET",`/api/verify/transcripts/${second.verificationCode}`);
  expect(verified).toMatchObject({status:"revoked",summary:{cumulativeGpa:3}});
  const events = await api("GET",`/api/audit/events?subjectId=${second.id}`,undefined,admin.token);
  expect(events.map((row) => row.action).sort()).toEqual(["registry.transcript.issued","registry.transcript.revoked"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  // The issuance register lists both documents with their outcomes, for scoped readers only, and exports to CSV.
  const register = await api("GET",`/api/reports/document-issuance?q=${students[0].studentNumber}`,undefined,registrar.token);
  expect(register.rows.map((row) => [row.referenceNumber,row.status])).toEqual([[second.referenceNumber,"revoked"],[first.referenceNumber,"superseded"]]);
  expect(register.rows[0]).toMatchObject({kind:"progressive",studentNumber:students[0].studentNumber,revokeReason:"Issued to the wrong recipient"});
  expect((await api("GET",`/api/reports/document-issuance?q=${students[0].studentNumber}&status=revoked`,undefined,officer.token)).rows).toHaveLength(1);
  await denied("GET","/api/reports/document-issuance",undefined,students[0].token,403);
  await denied("GET","/api/reports/document-issuance?from=2026-02-30",undefined,registrar.token,400);
  await page.locator("[data-issuance-panel] > summary").click();
  await submit(page.locator("[data-issuance-filter]"),{q:students[0].studentNumber});
  await expect(page.locator("[data-issuance-totals]")).toHaveText("0 current, 1 superseded, 1 revoked - 2 transcript(s), 0 certificate(s)");
  await expect(page.locator(`[data-issuance-row="${second.referenceNumber}"]`)).toContainText("revoked");
  const exported = page.waitForEvent("download");
  await page.locator("[data-issuance-csv]").click();
  const csv = await readFile(await (await exported).path(),"utf8");
  expect(csv.trim().split("\r\n")).toHaveLength(3);
  expect(csv).toContain(`${second.referenceNumber},progressive,revoked,${students[0].studentNumber}`);

  // The public page and the student's own view, each in a fresh browser context.
  const visitor = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const check = await visitor.newPage(); check.setDefaultTimeout(15_000);
    await check.goto(`/#verify/${first.verificationCode}`);
    await expect(check.locator('[data-verify-result="superseded"]')).toContainText(students[0].studentNumber);
    await submit(check.locator("[data-verify-form]"),{code:second.verificationCode.toLowerCase()});
    await expect(check.locator('[data-verify-result="revoked"]')).toContainText("Revoked - this document is not valid");
    await submit(check.locator("[data-verify-form]"),{code:"AAAA-AAAA-AAAA-AAAA"});
    await expect(check.getByRole("status")).toHaveText("No document matches this verification code.");
    expect(await check.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(check.viewportSize().width);
    await check.screenshot({path:info.outputPath("verify.png"),fullPage:true});
  } finally {await visitor.close();}
  const studentContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const portal = await studentContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#apply"); await submit(portal.locator('[data-form="signin"]'),{email:students[0].email,password:students[0].password});
    const own = portal.locator("[data-student-transcripts]");
    await expect(own.locator("[data-transcript]")).toHaveText([new RegExp(`${second.verificationCode}.*revoked`),new RegExp(`${first.verificationCode}.*superseded`)]);
    await own.locator(`[data-student-transcript="${second.id}"]`).click();
    await expect(portal.locator(`[data-transcript-document="${second.id}"] [data-transcript-banner]`)).toHaveText("REVOKED - not valid as a current record");
    await expect(portal.locator(`[data-transcript-document="${second.id}"] [data-transcript-summary]`)).toContainText("Cumulative GPA 3.00");
    await expect(portal.locator(`[data-transcript-document="${second.id}"]`)).toContainText("72 *");
    expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
    await portal.screenshot({path:info.outputPath("student-transcript.png"),fullPage:true});
  } finally {await studentContext.close();}
  await page.screenshot({path:info.outputPath("transcripts.png"),fullPage:true});

  async function gradingPolicy() {
    const code = `tr_${stamp.replaceAll(".","_")}`;
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
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-TR-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-TR-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`TR-Y-${y}-${stamp}`,name:`SAMPLE amendments ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`TR-S-${y}-${stamp}`,name:`SAMPLE amendments ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
