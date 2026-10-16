import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("fee schedules, billing, payments and holds drive financial registration eligibility",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "FND" : "FNM",year = 2025;
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Finance sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const finance = await account(`finance.officer.${stamp}@example.com`,`Finance Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:finance.id,roleCode:"finance_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Programme finance officer"},admin.token);
  const outsider = await account(`finance.outsider.${stamp}@example.com`,`Finance Outsider ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"finance_officer",scope:{programmeCodes:["NOT-THIS"],intakeIds:["NOT-THIS"]},reason:"Other programme"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"auditor",scope:{},reason:"Must not widen finance scope"},admin.token);
  const student = await account(`finance.student.${stamp}@example.com`,`Finance Student ${stamp}`);
  const record = await admit(student),own = `/api/registry/me/programmes/${record.id}`,staffBase = `/api/registry/programmes/${record.id}`;
  const term = await calendar(year),registration = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await configure(registration.id);

  const draft = await api("POST","/api/finance/fee-schedules",{programmeId:programme.id,yearOfStudy:1,term:"S1",currency:"USD",effectiveFrom:`${year}-01-01`,dueDays:14,reason:"Synthetic approved fees",
    lines:[{chargeCode:"TUITION",description:"Tuition",amountMinor:120000},{chargeCode:"REGISTRATION",description:"Registration fee",amountMinor:5000}]},finance.token);
  await denied("POST",`/api/finance/fee-schedules/${draft.id}/publish`,{reason:"Own draft"},finance.token,403);
  await denied("POST","/api/finance/fee-schedules",{programmeId:programme.id,yearOfStudy:1,term:"S1",currency:"USD",effectiveFrom:`${year}-01-01`,dueDays:14,reason:"Bad code",lines:[{chargeCode:"PARKING",description:"Parking",amountMinor:100}]},finance.token,400);
  await denied("GET",`/api/finance/fee-schedules?programmeId=${programme.id}`,undefined,outsider.token,403);
  await denied("POST","/api/finance/billing-runs",{registrationPeriodId:registration.id,reason:"Nothing published"},finance.token,409);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:record.studentNumber});
  await page.locator(`[data-registry-detail="${record.id}"]`).click();
  await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
  await expect(page.locator("[data-finance-hold]")).toHaveText("No financial hold.");
  await submit(page.locator(`[data-fee-publish="${draft.id}"]`),{reason:"Independently checked against the approved fee book"});
  await expect(page.getByRole("status")).toHaveText("Fee schedule published.");
  await expect(page.locator(`[data-fee-schedule="${draft.id}"]`)).toContainText("published");
  await submit(page.locator(`[data-billing-run="${registration.id}"]`),{reason:"Synthetic semester billing"});
  await expect(page.getByRole("status")).toHaveText("Billing complete: 2 charge(s) for 1 student(s).");
  await expect(page.locator("[data-finance-hold]")).toContainText("Tuition");
  expect(await api("POST","/api/finance/billing-runs",{registrationPeriodId:registration.id,reason:"Repeat run is idempotent"},finance.token)).toMatchObject({chargesCreated:0,students:1});

  await api("PUT",`${own}/registrations/${registration.id}`,{revision:0,courseIds:[course.id]},student.token);
  await api("POST",`${staffBase}/registrations/${registration.id}/checks`,{revision:1,checkType:"academic",outcome:"eligible",reason:"Academic clearance",evidenceRef:"SAMPLE-ACADEMIC",expiresOn:day(7)},admin.token);
  await denied("POST",`${staffBase}/registrations/${registration.id}/checks`,{revision:1,checkType:"financial",outcome:"eligible",reason:"Must follow the ledger",evidenceRef:"SAMPLE-FIN",expiresOn:day(7)},admin.token,409);
  let context = (await api("GET",`${own}/registrations`,undefined,student.token)).find((row) => row.period.id === registration.id);
  expect(context.eligibility.blockers.map((row) => row.code)).toContain("FINANCIAL_HOLD");

  await page.locator("[data-finance-payment]").locator("..").locator("summary").click();
  await submit(page.locator("[data-finance-payment]"),{currency:"USD",amount:"100.00",method:"bank",externalRef:`BANK-${stamp}`,receivedOn:day(0),reason:"Bank statement line"});
  await expect(page.getByRole("status")).toContainText("Payment recorded. Receipt RCT-");
  await expect(page.locator("[data-finance-hold]")).toContainText("Tuition");
  await denied("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:100,method:"bank",externalRef:`BANK-${stamp}`,receivedOn:day(0),reason:"Replayed statement line"},finance.token,409);
  await denied("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:100,method:"bank",externalRef:`OUT-${stamp}`,receivedOn:day(0),reason:"Out of scope"},outsider.token,403);
  await denied("GET",`${staffBase}/account`,undefined,outsider.token,403);
  await denied("GET",`${staffBase}/account`,undefined,student.token,403);
  await denied("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:100,method:"bank",externalRef:`FUT-${stamp}`,receivedOn:day(2),reason:"Future"},finance.token,400);
  const concurrent = await Promise.all([1,2].map(() => request.post(`${staffBase}/payments`,{data:{currency:"USD",amountMinor:120000,method:"mobile_money",externalRef:`MM-${stamp}`,receivedOn:day(0),reason:"Mobile money settlement"},headers:{Authorization:`Bearer ${finance.token}`}})));
  expect(concurrent.map((response) => response.status()).sort()).toEqual([201,409]);

  const settled = await api("GET",`${staffBase}/account`,undefined,finance.token);
  expect(settled.currencies).toEqual([{currency:"USD",charged:125000,paid:130000,credited:0,balance:-5000,due:0,credit:5000}]);
  expect(settled.hold.held).toBe(false);
  expect(settled.entries.filter((row) => row.entryType === "charge").every((row) => row.outstanding === 0)).toBe(true);
  await api("POST",`${staffBase}/registrations/${registration.id}/checks`,{revision:1,checkType:"financial",outcome:"eligible",reason:"Ledger settled",evidenceRef:"SAMPLE-LEDGER",expiresOn:day(7)},admin.token);
  const receipt = await api("POST",`${own}/registrations/${registration.id}/confirm`,{revision:1},student.token);
  expect(receipt.referenceNumber).toBeTruthy();

  const studentView = await api("GET",`${own}/account`,undefined,student.token);
  expect(studentView).toMatchObject({hold:{held:false},currencies:[{currency:"USD",credit:5000}]});
  expect(studentView.capabilities).toBeUndefined();
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${student.id}`,undefined,admin.token)).map((row) => row.payload);
  expect(notices.filter((row) => row.subject.startsWith("Payment received - receipt RCT-"))).toHaveLength(2);
  expect(notices.find((row) => row.subject.startsWith("New charges")).body).toContain("USD 1250.00 has been billed");
  expect(notices.find((row) => row.body.includes(`MM-${stamp}`)).body).toContain("Your USD balance is now USD -50.00");
  const events = await api("GET",`/api/audit/events?action=finance.payment.recorded`,undefined,admin.token);
  expect(JSON.stringify(events)).toContain(`MM-${stamp}`);

  const studentContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
  try {
    const portal = await studentContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#apply"); await submit(portal.locator('[data-form="signin"]'),{email:student.email,password:student.password});
    await expect(portal.locator(".student-finance")).toContainText("USD -50.00");
    await expect(portal.locator(".student-finance [data-finance-hold]")).toHaveText("No financial hold.");
    for (const current of [page,portal]) expect(await current.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(current.viewportSize().width);
    await portal.screenshot({path:info.outputPath("student-finance.png"),fullPage:true});
    await page.locator("[data-finance-refresh]").click(); await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
    await page.screenshot({path:info.outputPath("staff-finance.png"),fullPage:true});
  } finally {await studentContext.close();}

  async function createProgramme(c) {
    const p = await api("POST","/api/master-data/programmes",{code:`FN-${stamp}`,name:`SAMPLE finance ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Finance curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:c.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE finance ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-FIN-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-FN-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {...sp,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`FN-Y-${y}-${stamp}`,name:`SAMPLE finance ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`FN-S-${y}-${stamp}`,name:`SAMPLE finance ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function configure(periodId) {
    const ctx = (await api("GET",`${staffBase}/registrations`,undefined,admin.token)).find((row) => row.period.id === periodId);
    await api("POST",`${staffBase}/registration-periods/${periodId}`,{offerings:ctx.offerings.map((row) => ({courseId:row.courseId,delivery:"asynchronous",meetings:[]})),reason:"Synthetic delivery"},admin.token);
    await api("POST",`${staffBase}/registration-periods/${periodId}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  }
  async function submit(form,values) {for (const [field,value] of Object.entries(values)) {const input = form.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Finance",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Finance",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
