import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("sponsors cover approved shares of student charges, owe them separately, and never cover a charge twice",async ({page,browser,request},info) => {
  test.setTimeout(360_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "SPD" : "SPM",year = 2025;
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Finance sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const finance = await account(`sponsor.officer.${stamp}@example.com`,`Finance Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:finance.id,roleCode:"finance_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Programme finance officer"},admin.token);
  const outsider = await account(`sponsor.outsider.${stamp}@example.com`,`Finance Outsider ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"finance_officer",scope:{programmeCodes:["NOT-THIS"],intakeIds:["NOT-THIS"]},reason:"Other programme"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"auditor",scope:{},reason:"Must not widen finance scope"},admin.token);
  const student = await account(`sponsor.student.${stamp}@example.com`,`Finance Student ${stamp}`);
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

  // USD 1,250.00 is billed (tuition 1,200.00, registration 50.00) and overdue, so the student is held.
  const sponsorships = `/api/finance/programmes/${record.id}/sponsorships`;
  const ledger = async () => api("GET",`${staffBase}/account`,undefined,finance.token);
  expect((await ledger()).hold.held).toBe(true);

  // Sponsors are institution-wide: a programme-scoped finance officer cannot create them; the administrator adds one in the UI.
  await denied("POST","/api/finance/sponsors",{code:`fund_${info.project.name}_${Date.now() % 100000}`,name:"Scoped attempt",reason:"No global scope"},finance.token,403);
  await page.locator("[data-sponsors-panel] > summary").click();
  await page.locator("[data-sponsors-panel] details:has([data-sponsor-create]) > summary").click();
  const fundCode = `bursary_${info.project.name}_${Date.now() % 100000}`;
  await submit(page.locator("[data-sponsor-create]"),{code:fundCode,name:`Kariba Bursary Fund ${stamp}`,contactEmail:"bursary@example.org",reason:"Signed bursary agreement"});
  await expect(page.getByRole("status")).toHaveText("Sponsor added.");
  const fund = (await api("GET","/api/finance/sponsors",undefined,admin.token)).sponsors.find((row) => row.code === fundCode);
  await denied("POST","/api/finance/sponsors",{code:fundCode,name:"Duplicate",reason:"Dup"},admin.token,409);

  // The finance officer proposes 80% of tuition; self-approval is refused; the administrator approves in the UI.
  const bursary = await api("POST",sponsorships,{sponsorId:fund.id,currency:"USD",coveragePercent:80,chargeCodes:["TUITION"],validFrom:`${year}-01-01`,validTo:`${year + 1}-12-31`,reason:"Bursary award letter"},finance.token);
  await denied("POST",sponsorships,{sponsorId:fund.id,currency:"USD",coveragePercent:50,validFrom:`${year}-01-01`,validTo:`${year}-12-31`,reason:"Duplicate"},finance.token,409);
  await denied("POST",sponsorships,{sponsorId:fund.id,currency:"USD",coveragePercent:120,validFrom:`${year}-01-01`,validTo:`${year}-12-31`,reason:"Over 100"},finance.token,400);
  await denied("POST",`${sponsorships}/${bursary.id}/review`,{outcome:"approved",reason:"Own request"},finance.token,403);
  await page.locator("[data-finance-refresh]").click(); await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
  await submit(page.locator(`[data-sponsorship-review="${bursary.id}"]`),{outcome:"approved",reason:"Matches the award letter"});
  await expect(page.getByRole("status")).toHaveText("Sponsorship approved; 1 charge(s) moved to the sponsor.");
  let statement = await ledger();
  expect(statement.currencies.find((row) => row.currency === "USD").balance).toBe(29000);
  expect(statement.entries.filter((row) => row.entryType === "credit").map((row) => [row.amountMinor,row.description])).toEqual([[96000,`Sponsored by Kariba Bursary Fund ${stamp} (TUITION)`]]);
  expect(statement.hold.held).toBe(true);
  expect((await api("GET","/api/finance/sponsors",undefined,admin.token)).sponsors.find((row) => row.id === fund.id).statement).toEqual([{currency:"USD",charged:96000,paid:0,balance:96000}]);
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${student.id}`,undefined,admin.token)).map((row) => row.payload.subject);
  expect(notices).toContain("A sponsor is now covering your fees");

  // Re-running billing creates no new charges and no second transfer for the same charge.
  expect(await api("POST","/api/finance/billing-runs",{registrationPeriodId:registration.id,reason:"Repeat run"},finance.token)).toMatchObject({chargesCreated:0});
  expect((await ledger()).entries.filter((row) => row.entryType === "credit")).toHaveLength(1);

  // The sponsor pays part of what it owes; that settles the sponsor's balance, not the student's.
  await page.locator(`[data-sponsor="${fundCode}"] details > summary`).click();
  await submit(page.locator(`[data-sponsor-payment="${fund.id}"]`),{currency:"USD",amount:"500.00",externalRef:`SPN-${stamp}`,receivedOn:day(0),reason:"Bursary remittance"});
  await expect(page.getByRole("status")).toHaveText("Sponsor payment recorded.");
  await expect(page.locator(`[data-sponsor="${fundCode}"] [data-sponsor-statement]`)).toContainText("balance USD 460.00");
  await denied("POST",`/api/finance/sponsors/${fund.id}/payments`,{currency:"USD",amountMinor:100,externalRef:`SPN-${stamp}`,receivedOn:day(0),reason:"Replay"},admin.token,409);
  await denied("POST",`/api/finance/sponsors/${fund.id}/payments`,{currency:"USD",amountMinor:100,externalRef:`SPN2-${stamp}`,receivedOn:day(0),reason:"Scoped"},finance.token,403);
  expect((await ledger()).currencies.find((row) => row.currency === "USD").balance).toBe(29000);

  // A second sponsor covers the registration fee in full; tuition, already sponsored, is not covered twice.
  const employer = await api("POST","/api/finance/sponsors",{code:`employer_${info.project.name}_${Date.now() % 100000}`,name:`Employer ${stamp}`,reason:"Employer agreement"},admin.token);
  const second = await api("POST",sponsorships,{sponsorId:employer.id,currency:"USD",coveragePercent:100,validFrom:`${year}-01-01`,validTo:`${year}-12-31`,reason:"Employer pays fees"},finance.token);
  const approved = await api("POST",`${sponsorships}/${second.id}/review`,{outcome:"approved",reason:"Agreement on file"},admin.token);
  expect(approved.transfers.map((row) => [row.chargeCode,row.amountMinor])).toEqual([["REGISTRATION",5000]]);
  expect((await ledger()).currencies.find((row) => row.currency === "USD").balance).toBe(24000);

  // The student pays the remaining tuition share and the hold clears; ending a sponsorship keeps transfers already made.
  await api("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:24000,method:"bank",externalRef:`REST-${stamp}`,receivedOn:day(0),reason:"Student share"},finance.token);
  expect((await ledger()).hold.held).toBe(false);
  await api("POST",`${sponsorships}/${bursary.id}/end`,{reason:"Bursary ends after this year"},finance.token);
  const listed = (await api("GET",sponsorships,undefined,finance.token)).sponsorships.find((row) => row.id === bursary.id);
  expect(listed).toMatchObject({status:"ended",transferredMinor:96000});
  await denied("POST",`${sponsorships}/${bursary.id}/end`,{reason:"Again"},finance.token,409);
  const events = (await api("GET",`/api/audit/events?subjectId=${bursary.id}`,undefined,admin.token)).map((row) => row.action);
  expect(events).toEqual(expect.arrayContaining(["finance.sponsorship.requested","finance.sponsorship.approved","finance.sponsorship.ended"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("sponsors.png"),fullPage:true});
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
