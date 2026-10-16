import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outcomeChecksum } from "../server/modules/lms.js";

test("the LMS boundary provisions from authoritative records and returns outcomes exactly once through reviewed results",async ({page,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "LMD" : "LMM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const courses = [];
  for (const [index,title] of [[1,"LMS core one"],[2,"LMS core two"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const programme = await api("POST","/api/master-data/programmes",{code:`LM-${stamp}`,name:`SAMPLE lms ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"LMS curriculum",effectiveFrom:"2024-01-01"},admin.token);
  for (const course of courses) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE lms ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`lms.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
  const staffBase = `/api/registry/programmes/${students[0].id}`,term = await calendar(2025);
  const period = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{offerings:courses.map((course) => ({courseId:course.id,delivery:"asynchronous",meetings:[]})),reason:"Synthetic delivery"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  for (const student of students) {
    await api("PUT",`/api/registry/me/programmes/${student.id}/registrations/${period.id}`,{revision:0,courseIds:courses.map((course) => course.id)},student.token);
    for (const checkType of ["academic","financial"]) await api("POST",`/api/registry/programmes/${student.id}/registrations/${period.id}/checks`,{revision:1,checkType,outcome:"eligible",reason:"Synthetic clearance",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);
    await api("POST",`/api/registry/me/programmes/${student.id}/registrations/${period.id}/confirm`,{revision:1},student.token);
  }
  const staff = await api("POST","/api/staff",{email:`lms.lecturer.${stamp}@example.edu`,legalName:`LMS Lecturer ${stamp}`,preferredName:"Lecturer",category:"LECTURER",grade:"L1",departmentId:"dept_computing",engagedOn:day(-90),roleCode:"lecturer",reason:"Appointment"},admin.token);
  await api("POST","/api/identity/activations",{token:await outboxToken(`lms.lecturer.${stamp}@example.edu`),password:"Kariba-Dam-Staff-2026!",preferredName:"Lecturer",legalName:`LMS Lecturer ${stamp}`});
  await api("POST",`/api/teaching/periods/${period.id}/allocations`,{courseId:courses[0].id,staffId:staff.id,role:"lead",workloadUnits:3,effectiveFrom:"2025-02-01",reason:"Teaching plan"},registrar.token);
  const allocation = (await api("GET",`/api/teaching/periods/${period.id}`,undefined,registrar.token)).offerings.find((row) => row.courseId === courses[0].id).allocations[0];
  await api("POST",`/api/teaching/allocations/${allocation.id}/review`,{outcome:"approved",reason:"Approved"},admin.token);

  const connector = await account(`lms.connector.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:connector.id,roleCode:"lms_connector",scope:{},reason:"LMS integration service"},admin.token);
  const officer = await account(`lms.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const keys = courses.map((course) => `${period.id}:${course.id}`);
  const manifest = await api("GET","/api/lms/v1/manifest",undefined,connector.token);
  const first = manifest.offerings.find((row) => row.offeringKey === keys[0]),second = manifest.offerings.find((row) => row.offeringKey === keys[1]);
  expect(first.teachers).toEqual([{employeeNumber:staff.employeeNumber,email:`lms.lecturer.${stamp}@example.edu`,name:`LMS Lecturer ${stamp}`,role:"lead",lmsRole:"editingteacher"}]);
  expect(first.students.map((row) => row.studentNumber).sort()).toEqual(students.map((row) => row.studentNumber).sort());
  expect(second.teachers).toEqual([]);
  expect(first.version).toMatch(/^[0-9a-f]{64}$/);
  await denied("GET","/api/lms/v1/manifest",undefined,registrar.token,403);

  const marks = (key,values) => {const rows = students.map((student,index) => ({studentNumber:student.studentNumber,mark:values[index]}));return {offeringKey:key,externalRef:`moodle-${key}-${values.join("-")}-${stamp}`,rows,checksum:outcomeChecksum(rows)};};
  const partial = marks(keys[0],[70,55]); partial.rows = partial.rows.slice(0,1); partial.checksum = outcomeChecksum(partial.rows);
  await denied("POST","/api/lms/v1/outcomes",partial,connector.token,409);
  const firstReturn = marks(keys[0],[70,55]);
  const received = await api("POST","/api/lms/v1/outcomes",firstReturn,connector.token);
  expect(await api("POST","/api/lms/v1/outcomes",firstReturn,connector.token)).toMatchObject({id:received.id,replayed:true});
  const tampered = marks(keys[0],[71,55]); tampered.externalRef = firstReturn.externalRef;
  await denied("POST","/api/lms/v1/outcomes",tampered,connector.token,409);
  await denied("POST","/api/lms/v1/outcomes",marks(keys[0],[72,56]),connector.token,409);
  await denied("POST",`/api/lms/outcomes/${received.id}/review`,{outcome:"accepted",reason:"Self"},connector.token,403);
  await api("POST",`/api/lms/outcomes/${received.id}/review`,{outcome:"rejected",reason:"Moderation changed two marks"},officer.token);
  const corrected = await api("POST","/api/lms/v1/outcomes",marks(keys[0],[68,57]),connector.token);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await page.locator("[data-lms-panel] > summary").click();
  await submit(page.locator(`[data-lms-review="${corrected.id}"]`),{outcome:"accepted",reason:"Moderated marks agreed"});
  await expect(page.getByRole("status")).toHaveText("LMS outcomes accepted.");
  await denied("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:"x",reason:"Incomplete"},registrar.token,409);
  const secondReturn = await api("POST","/api/lms/v1/outcomes",marks(keys[1],[81,49]),connector.token);
  await api("POST",`/api/lms/outcomes/${secondReturn.id}/review`,{outcome:"accepted",reason:"Agreed"},officer.token);
  const gpa = await gradingPolicy();
  await denied("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"No import authority"},officer.token,403);
  await denied("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"Registration still open"},registrar.token,409);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"closed",reason:"Semester complete"},admin.token);

  await page.locator("[data-registry-signout]").click();
  await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await page.locator("[data-lms-panel] > summary").click();
  await submit(page.locator(`[data-lms-transfer="${period.id}"]`),{gpaRuleSetId:gpa.id,reason:"Accepted LMS outcomes for the semester"});
  await expect(page.getByRole("status")).toContainText("Transferred 4 marks to result batch");
  const status = (await api("GET","/api/lms/outcomes",undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect(status.transferred).toBe(true);
  const batchId = status.courses[0].live.resultBatchId;
  expect(status.courses.every((row) => row.live.resultBatchId === batchId)).toBe(true);
  await denied("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"Retry"},registrar.token,409);
  await denied("POST",`${staffBase}/results/${period.id}/batches/${batchId}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE",reason:"Own import"},registrar.token,403);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batchId}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-MODERATION",reason:"Independent results review"},officer.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${batchId}/publish`,{reason:"Publish LMS-returned results"},officer.token);
  const published = await api("GET",`/api/registry/me/programmes/${students[0].id}/results`,undefined,students[0].token);
  expect(JSON.stringify(published)).toContain("68");
  expect((await api("GET","/api/lms/v1/manifest",undefined,connector.token)).offerings.some((row) => keys.includes(row.offeringKey))).toBe(false);
  const events = await api("GET",`/api/audit/events?action=lms.outcomes.transferred`,undefined,admin.token);
  expect(JSON.stringify(events)).toContain(batchId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("lms.png"),fullPage:true});

  async function gradingPolicy() {
    const code = `lms_${stamp.replaceAll(".","_")}`;
    const scheme = await api("POST","/api/master-data/grading-schemes",{code,name:"SAMPLE lms grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:100,grade:"P",points:3,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic grades"},registrar.token);
    const rule = await api("POST","/api/master-data/gpa-rule-sets",{code,name:"SAMPLE lms GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"X",credits:15,mark:75}],expectedGpa:3,expectedClassification:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/gpa-rule-sets/${rule.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic GPA"},registrar.token);
    return rule;
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `LMS Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-LMS-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-LM-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`LM-Y-${y}-${stamp}`,name:`SAMPLE lms ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`LM-S-${y}-${stamp}`,name:`SAMPLE lms ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
