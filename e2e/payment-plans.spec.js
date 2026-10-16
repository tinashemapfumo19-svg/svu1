import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("approved payment plans lift financial holds only while instalments are kept up",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "PPD" : "PPM",year = 2025;
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Finance sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const finance = await account(`plans.officer.${stamp}@example.com`,`Finance Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:finance.id,roleCode:"finance_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Programme finance officer"},admin.token);
  const outsider = await account(`plans.outsider.${stamp}@example.com`,`Finance Outsider ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"finance_officer",scope:{programmeCodes:["NOT-THIS"],intakeIds:["NOT-THIS"]},reason:"Other programme"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"auditor",scope:{},reason:"Must not widen finance scope"},admin.token);
  const student = await account(`plans.student.${stamp}@example.com`,`Finance Student ${stamp}`);
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

  // The billed USD 1,250.00 is overdue, so the student is held. A plan covers it in three instalments.
  const plans = `/api/finance/programmes/${record.id}/plans`;
  const holdOf = async () => (await api("GET",`${staffBase}/account`,undefined,finance.token)).hold;
  expect((await holdOf()).held).toBe(true);
  const schedule = (first) => [{dueOn:day(0),amountMinor:first},{dueOn:day(30),amountMinor:(125000 - first) / 2},{dueOn:day(60),amountMinor:(125000 - first) / 2}];
  await denied("POST",plans,{currency:"USD",instalments:[{dueOn:day(0),amountMinor:1000},{dueOn:day(30),amountMinor:1000}],reason:"Wrong total"},finance.token,400);
  await denied("POST",plans,{currency:"EUR",instalments:schedule(50000),reason:"No EUR balance"},finance.token,409);
  await denied("POST",plans,{currency:"USD",instalments:schedule(50000),reason:"Out of scope"},outsider.token,403);
  const stale = await api("POST",plans,{currency:"USD",instalments:schedule(50000),reason:"Family hardship"},finance.token);
  await denied("POST",plans,{currency:"USD",instalments:schedule(50000),reason:"Duplicate"},finance.token,409);
  await denied("POST",`${plans}/${stale.id}/review`,{outcome:"approved",reason:"Own request"},finance.token,403);
  // A payment between request and approval changes the covered balance, so the stale plan cannot be approved.
  await api("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:5000,method:"bank",externalRef:`PLAN-${stamp}`,receivedOn:day(0),reason:"Part payment"},finance.token);
  await denied("POST",`${plans}/${stale.id}/review`,{outcome:"approved",reason:"Too late"},admin.token,409);
  await api("POST",`${plans}/${stale.id}/cancel`,{reason:"Balance changed before approval"},finance.token);

  // The administrator proposes the corrected plan in the UI; the finance officer approves it.
  await page.locator("[data-results-refresh], [data-finance-refresh]").first().click();
  await expect(page.locator("[data-payment-plans]")).toContainText("cancelled");
  await page.locator("[data-payment-plans] details:has([data-plan-request]) > summary").click();
  await submit(page.locator("[data-plan-request]"),{currency:"USD",instalments:`${day(0)}, 400.00\n${day(30)}, 400.00\n${day(60)}, 400.00`,reason:"Agreed with the student"});
  await expect(page.getByRole("status")).toHaveText("Payment plan requested for independent approval.");
  const plan = (await api("GET",plans,undefined,finance.token)).plans.find((row) => row.status === "requested");
  expect(plan).toMatchObject({currency:"USD",coveredAmount:120000,instalments:[{amountMinor:40000},{amountMinor:40000},{amountMinor:40000}]});
  await expect(page.locator(`[data-plan-review="${plan.id}"]`)).toHaveCount(0);
  await api("POST",`${plans}/${plan.id}/review`,{outcome:"approved",reason:"Affordable schedule"},finance.token);

  // The first instalment is due today and unpaid: the plan is in arrears and the hold stays.
  let listed = (await api("GET",plans,undefined,finance.token)).plans.find((row) => row.id === plan.id);
  expect(listed.standing).toMatchObject({status:"in_arrears",paid:0,requiredToDate:40000,arrears:40000});
  expect((await holdOf()).held).toBe(true);
  // Paying the first instalment brings the plan current and lifts the hold, so financial clearance can follow the ledger.
  await api("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:40000,method:"mobile_money",externalRef:`INST1-${stamp}`,receivedOn:day(0),reason:"First instalment"},finance.token);
  listed = (await api("GET",plans,undefined,finance.token)).plans.find((row) => row.id === plan.id);
  expect(listed.standing).toMatchObject({status:"current",paid:40000,requiredToDate:40000,nextInstalment:{dueOn:day(30),amountMinor:40000}});
  const ledger = await api("GET",`${staffBase}/account`,undefined,finance.token);
  expect([ledger.hold.held,ledger.plans[0].standing.status]).toEqual([false,"current"]);
  expect(ledger.currencies.find((row) => row.currency === "USD").balance).toBe(80000);
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${student.id}`,undefined,admin.token)).map((row) => row.payload.subject);
  expect(notices).toContain("Your payment plan has been approved");
  await page.locator("[data-finance-refresh]").click(); await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
  await expect(page.locator(`[data-payment-plan="${plan.id}"] [data-plan-standing]`)).toHaveAttribute("data-plan-standing","current");
  await expect(page.locator("[data-finance-hold]")).toHaveText("No financial hold.");

  // Cancelling ends the protection at once; the ledger is untouched and the hold returns.
  await api("POST",`${plans}/${plan.id}/cancel`,{reason:"Student withdrew from the arrangement"},finance.token);
  expect((await holdOf()).held).toBe(true);
  await denied("POST",`${plans}/${plan.id}/cancel`,{reason:"Again"},finance.token,409);
  const events = (await api("GET",`/api/audit/events?subjectId=${plan.id}`,undefined,admin.token)).map((row) => row.action);
  expect(events).toEqual(expect.arrayContaining(["finance.plan.requested","finance.plan.approved","finance.plan.cancelled"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("payment-plans.png"),fullPage:true});
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
