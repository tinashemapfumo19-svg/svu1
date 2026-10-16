import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("teaching allocations are approved independently, detect clashes and coverage, and gate class lists",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "TAD" : "TAM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const first = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Teaching sample core",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const second = await api("POST","/api/master-data/courses",{code:`${prefix}102`,title:"Teaching sample elective",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await api("POST","/api/master-data/programmes",{code:`TA-${stamp}`,name:`SAMPLE teaching ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Teaching curriculum",effectiveFrom:"2024-01-01"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:first.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:second.id,yearOfStudy:1,term:"S1",requirementType:"elective"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE teaching ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const student = await account(`teach.student.${stamp}@example.com`),record = await admit(student),staffBase = `/api/registry/programmes/${record.id}`;
  const term = await calendar(2025),period = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{offerings:[{courseId:first.id,delivery:"scheduled",meetings:[{day:1,start:540,end:600}]},{courseId:second.id,delivery:"scheduled",meetings:[{day:1,start:570,end:630}]}],reason:"Synthetic timetable"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  await api("PUT",`/api/registry/me/programmes/${record.id}/registrations/${period.id}`,{revision:0,courseIds:[first.id]},student.token);
  for (const checkType of ["academic","financial"]) await api("POST",`${staffBase}/registrations/${period.id}/checks`,{revision:1,checkType,outcome:"eligible",reason:"Synthetic clearance",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);
  await api("POST",`/api/registry/me/programmes/${record.id}/registrations/${period.id}/confirm`,{revision:1},student.token);

  const lecturerOne = await lecturer(`teach.one.${stamp}@example.edu`,`Lecturer One ${stamp}`),lecturerTwo = await lecturer(`teach.two.${stamp}@example.edu`,`Lecturer Two ${stamp}`);
  const teachingBase = `/api/teaching/periods/${period.id}`;

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await page.locator("[data-teaching-panel] > summary").click();
  await page.locator(`[data-teaching-load="${period.id}"]`).click();
  const propose = page.locator(`[data-allocation-propose="${first.id}"]`);
  await propose.locator("..").locator("summary").click();
  await submit(propose,{staffId:lecturerOne.staffId,role:"lead",workloadUnits:"3",effectiveFrom:"2025-02-01",reason:"Approved teaching plan"});
  await expect(page.getByRole("status")).toHaveText("Allocation proposed for approval.");
  let context = await api("GET",teachingBase,undefined,registrar.token);
  const lead = context.offerings.find((row) => row.courseId === first.id).allocations[0];
  expect(context.offerings.find((row) => row.courseId === first.id)).toMatchObject({covered:false,reason:"Lead lecturer awaiting approval.",enrolled:1});
  await denied("POST",`/api/teaching/allocations/${lead.id}/review`,{outcome:"approved",reason:"Own proposal"},registrar.token,403);
  await api("POST",`/api/teaching/allocations/${lead.id}/review`,{outcome:"approved",reason:"Department head approval"},admin.token);
  await denied("POST",`/api/teaching/allocations/${lead.id}/review`,{outcome:"rejected",reason:"Immutable"},admin.token,409);
  await denied("POST",`${teachingBase}/allocations`,{courseId:first.id,staffId:lecturerTwo.staffId,role:"lead",workloadUnits:3,effectiveFrom:"2025-03-01",reason:"Second lead"},registrar.token,409);
  await denied("POST",`${teachingBase}/allocations`,{courseId:second.id,staffId:lecturerOne.staffId,role:"lead",workloadUnits:3,effectiveFrom:"2025-03-01",reason:"Clash"},registrar.token,409);
  await denied("POST",`${teachingBase}/allocations`,{courseId:first.id,staffId:lecturerOne.staffId,role:"examiner",workloadUnits:1,effectiveFrom:"2025-03-01",reason:"Not independent"},registrar.token,409);
  await api("POST",`${teachingBase}/allocations`,{courseId:second.id,staffId:lecturerTwo.staffId,role:"tutor",workloadUnits:1.5,effectiveFrom:"2025-02-01",reason:"Tutorial support"},registrar.token);
  const tutor = (await api("GET",teachingBase,undefined,registrar.token)).offerings.find((row) => row.courseId === second.id).allocations[0];
  await api("POST",`/api/teaching/allocations/${tutor.id}/review`,{outcome:"approved",reason:"Approved"},admin.token);

  const overview = await api("GET","/api/teaching/overview",undefined,registrar.token);
  expect(overview.uncovered.filter((row) => row.periodId === period.id).map((row) => [row.code,row.reason])).toEqual([[second.code,"No lead lecturer allocated."]]);
  expect(overview.workload.find((row) => row.staffId === lecturerOne.staffId)).toMatchObject({units:3,allocations:1});

  const lecturerContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const portal = await lecturerContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#registry"); await submit(portal.locator("[data-registry-login]"),{email:lecturerOne.email,password:lecturerOne.password});
    await expect(portal.locator("[data-my-teaching]")).toContainText(`${first.code} - Teaching sample core`);
    await portal.locator(`[data-my-teaching] [data-class-list-load="${lead.id}"]`).click();
    await expect(portal.locator(`[data-class-list="${lead.id}"]`)).toContainText(record.studentNumber);
    expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
    await portal.screenshot({path:info.outputPath("lecturer.png"),fullPage:true});
  } finally {await lecturerContext.close();}
  await denied("GET",`/api/teaching/allocations/${lead.id}/class-list`,undefined,lecturerTwo.token,404);
  await denied("GET",`/api/teaching/allocations/${lead.id}/class-list`,undefined,student.token,403);
  await denied("GET",teachingBase,undefined,lecturerOne.token,403);
  expect((await api("GET",`/api/teaching/allocations/${lead.id}/class-list`,undefined,registrar.token)).students.map((row) => row.studentNumber)).toEqual([record.studentNumber]);

  await denied("POST",`${teachingBase}/allocations`,{courseId:first.id,staffId:lecturerTwo.staffId,role:"lead",workloadUnits:3,effectiveFrom:"2025-04-01",reason:"Clashes with tutoring",replacesAllocationId:lead.id},registrar.token,409);
  await page.locator(`[data-teaching-load="${period.id}"]`).click();
  await submit(page.locator(`[data-allocation-end="${tutor.id}"]`),{effectiveTo:"2025-03-31",reason:"Tutorials merged"});
  await expect(page.getByRole("status")).toHaveText("Allocation ended.");
  await api("POST",`${teachingBase}/allocations`,{courseId:first.id,staffId:lecturerTwo.staffId,role:"lead",workloadUnits:3,effectiveFrom:"2025-04-01",reason:"Lecturer one on leave",replacesAllocationId:lead.id},registrar.token);
  const substitute = (await api("GET",teachingBase,undefined,registrar.token)).offerings.find((row) => row.courseId === first.id).allocations.find((row) => row.replacesAllocationId === lead.id);
  await api("POST",`/api/teaching/allocations/${substitute.id}/review`,{outcome:"approved",reason:"Approved substitution"},admin.token);
  context = await api("GET",teachingBase,undefined,registrar.token);
  const allocations = context.offerings.find((row) => row.courseId === first.id).allocations;
  expect(allocations.find((row) => row.id === lead.id)).toMatchObject({status:"ended",effectiveTo:"2025-03-31",endReason:`Substituted by allocation ${substitute.id}`});
  expect(context.offerings.find((row) => row.courseId === first.id).covered).toBe(true);
  await denied("GET",`/api/teaching/allocations/${lead.id}/class-list`,undefined,lecturerOne.token,404);
  expect((await api("GET",`/api/teaching/allocations/${substitute.id}/class-list`,undefined,lecturerTwo.token)).students).toHaveLength(1);
  await denied("POST",`${teachingBase}/allocations`,{courseId:second.id,staffId:lecturerTwo.staffId,role:"co_lecturer",workloadUnits:1,effectiveFrom:day(0),reason:"After the period"},registrar.token,400);

  const staffRecord = await api("GET",`/api/staff/${lecturerTwo.staffId}`,undefined,admin.token);
  await api("POST",`/api/staff/${lecturerTwo.staffId}/status`,{revision:staffRecord.revision,toStatus:"exited",effectiveOn:day(0),reason:"Resigned"},admin.token);
  context = await api("GET",teachingBase,undefined,registrar.token);
  expect(context.offerings.find((row) => row.courseId === first.id)).toMatchObject({covered:false,reason:"No lead lecturer allocated."});
  expect(context.offerings.find((row) => row.courseId === first.id).allocations.find((row) => row.id === substitute.id)).toMatchObject({status:"ended",endReason:"Staff member exited"});
  const events = await api("GET",`/api/audit/events?subjectId=${substitute.id}`,undefined,admin.token);
  expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(["teaching.allocation.proposed","teaching.allocation.approved"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("allocation.png"),fullPage:true});

  async function lecturer(email,legalName) {
    const created = await api("POST","/api/staff",{email,legalName,preferredName:"Lecturer",category:"LECTURER",grade:"L1",departmentId:"dept_computing",engagedOn:day(-60),roleCode:"lecturer",reason:"Appointment"},admin.token);
    const password = "Kariba-Dam-Staff-2026!";
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Lecturer",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password});
    return {email,password,token:session.token,staffId:created.id};
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Teaching Student ${stamp}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Student",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Student",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-TA-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-TA-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {...sp,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`TA-Y-${y}-${stamp}`,name:`SAMPLE teaching ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`TA-S-${y}-${stamp}`,name:`SAMPLE teaching ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
