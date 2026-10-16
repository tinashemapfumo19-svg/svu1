import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("finance adjustments, refunds and hold exemptions need independent scoped review against current ledger evidence",async ({page,request},info) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "FAD" : "FAM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Adjustment sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const finance = await account(`adjust.officer.${stamp}@example.com`,`Adjust Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:finance.id,roleCode:"finance_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Programme finance officer"},admin.token);
  const outsider = await account(`adjust.outsider.${stamp}@example.com`,`Adjust Outsider ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:outsider.id,roleCode:"finance_officer",scope:{programmeCodes:["NOT-THIS"],intakeIds:["NOT-THIS"]},reason:"Other programme"},admin.token);
  const student = await account(`adjust.student.${stamp}@example.com`,`Adjust Student ${stamp}`);
  const record = await admit(student),staffBase = `/api/registry/programmes/${record.id}`,own = `/api/registry/me/programmes/${record.id}`;
  const term = await calendar(2025),period = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await configure(period.id);
  const schedule = await api("POST","/api/finance/fee-schedules",{programmeId:programme.id,yearOfStudy:1,term:"S1",currency:"USD",effectiveFrom:"2025-01-01",dueDays:14,reason:"Synthetic fees",
    lines:[{chargeCode:"TUITION",description:"Tuition",amountMinor:120000},{chargeCode:"REGISTRATION",description:"Registration fee",amountMinor:5000}]},finance.token);
  await api("POST",`/api/finance/fee-schedules/${schedule.id}/publish`,{reason:"Independent check"},admin.token);
  await api("POST","/api/finance/billing-runs",{registrationPeriodId:period.id,reason:"Synthetic billing"},finance.token);
  let ledger = await api("GET",`${staffBase}/account`,undefined,finance.token);
  const tuition = ledger.entries.find((row) => row.chargeCode === "TUITION");
  let adjust = await api("GET",`${staffBase}/adjustments`,undefined,finance.token);
  expect(adjust.capabilities).toEqual({request:true,approve:true});

  const scholarship = (evidenceHash,amountMinor = 30000) => ({kind:"scholarship",amountMinor,targetEntryId:tuition.id,evidenceHash,reason:"Bursary committee award",evidenceRef:"SAMPLE-BURSARY-MINUTE"});
  await denied("POST",`${staffBase}/adjustments`,scholarship(adjust.evidenceHash,120001),finance.token,409);
  await denied("POST",`${staffBase}/adjustments`,scholarship("0".repeat(64)),finance.token,409);
  await api("POST",`${staffBase}/adjustments`,scholarship(adjust.evidenceHash),finance.token);
  await denied("POST",`${staffBase}/adjustments`,{kind:"hold_exemption",expiresOn:day(10),evidenceHash:adjust.evidenceHash,reason:"Second open request",evidenceRef:"SAMPLE"},admin.token,409);
  let pending = (await api("GET",`${staffBase}/adjustments`,undefined,finance.token)).adjustments[0];
  await denied("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Own request"},finance.token,403);
  await denied("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Wrong scope"},outsider.token,403);
  await denied("GET",`${staffBase}/adjustments`,undefined,student.token,403);
  await api("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:1000,method:"bank",externalRef:`ADJ-A-${stamp}`,receivedOn:day(0),reason:"Part payment changes the ledger"},admin.token);
  await denied("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Stale ledger"},admin.token,409);
  await api("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"rejected",reason:"Ledger changed after the request"},admin.token);

  adjust = await api("GET",`${staffBase}/adjustments`,undefined,finance.token);
  await api("POST",`${staffBase}/adjustments`,scholarship(adjust.evidenceHash),finance.token);
  pending = (await api("GET",`${staffBase}/adjustments`,undefined,finance.token)).adjustments[0];

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:record.studentNumber});
  await page.locator(`[data-registry-detail="${record.id}"]`).click();
  await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
  await submit(page.locator(`[data-adjustment-review="${pending.id}"]`),{outcome:"approved",reason:"Award letter verified"});
  await expect(page.getByRole("status")).toHaveText("Adjustment reviewed.");
  await expect(page.locator("[data-finance-ledger], .finance-ledger")).toContainText("Scholarship - Tuition");
  ledger = await api("GET",`${staffBase}/account`,undefined,finance.token);
  expect(ledger.entries.find((row) => row.id === tuition.id).outstanding).toBe(89000);
  expect(ledger.currencies[0]).toMatchObject({charged:125000,paid:1000,credited:30000,balance:94000});
  await denied("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"rejected",reason:"Immutable"},admin.token,409);
  await denied("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"revoked",reason:"Not an exemption"},admin.token,409);

  await page.locator("[data-adjustment-request]").locator("..").locator("summary").click();
  await page.locator('[data-adjustment-request] [name="kind"]').selectOption("hold_exemption");
  await submit(page.locator("[data-adjustment-request]"),{expiresOn:day(10),evidenceRef:"SAMPLE-SPONSOR-LETTER",reason:"Sponsor payment expected next week"});
  await expect(page.getByRole("status")).toHaveText("Adjustment requested.");
  pending = (await api("GET",`${staffBase}/adjustments`,undefined,finance.token)).adjustments[0];
  await expect(page.locator(`[data-adjustment-review="${pending.id}"]`)).toHaveCount(0);
  await api("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Sponsor letter on file"},finance.token);
  ledger = await api("GET",`${own}/account`,undefined,student.token);
  expect(ledger.hold).toMatchObject({held:false,exemption:{expiresOn:day(10)}});
  await api("PUT",`${own}/registrations/${period.id}`,{revision:0,courseIds:[course.id]},student.token);
  expect((await api("GET",`${own}/registrations`,undefined,student.token)).find((row) => row.period.id === period.id).eligibility.blockers.map((row) => row.code)).not.toContain("FINANCIAL_HOLD");
  await page.locator("[data-finance-refresh]").click();
  await expect(page.locator("[data-finance-hold]")).toContainText(`Financial hold exempted until ${day(10)}`);
  await submit(page.locator(`[data-adjustment-revoke="${pending.id}"]`),{reason:"Sponsor withdrew"});
  await expect(page.getByRole("status")).toHaveText("Hold exemption revoked.");
  await expect(page.locator("[data-finance-hold]")).toContainText("Financial hold: Tuition");

  await api("POST",`${staffBase}/payments`,{currency:"USD",amountMinor:96500,method:"bank",externalRef:`ADJ-B-${stamp}`,receivedOn:day(0),reason:"Settlement with overpayment"},finance.token);
  adjust = await api("GET",`${staffBase}/adjustments`,undefined,finance.token);
  await denied("POST",`${staffBase}/adjustments`,{kind:"refund",amountMinor:3000,currency:"USD",evidenceHash:adjust.evidenceHash,reason:"Too much",evidenceRef:"SAMPLE"},finance.token,409);
  await api("POST",`${staffBase}/adjustments`,{kind:"refund",amountMinor:2500,currency:"USD",evidenceHash:adjust.evidenceHash,reason:"Return overpayment",evidenceRef:"SAMPLE-EFT-OUT"},finance.token);
  pending = (await api("GET",`${staffBase}/adjustments`,undefined,finance.token)).adjustments[0];
  await api("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Payout authorised"},admin.token);
  ledger = await api("GET",`${staffBase}/account`,undefined,finance.token);
  expect(ledger.currencies[0]).toMatchObject({balance:0,credit:0,due:0});
  expect(ledger.hold.held).toBe(false);

  adjust = await api("GET",`${staffBase}/adjustments`,undefined,finance.token);
  await api("POST",`${staffBase}/adjustments`,{kind:"debit",amountMinor:1500,currency:"USD",description:"Library replacement",dueOn:day(-1),evidenceHash:adjust.evidenceHash,reason:"Lost book",evidenceRef:"SAMPLE-LIBRARY"},finance.token);
  pending = (await api("GET",`${staffBase}/adjustments`,undefined,finance.token)).adjustments[0];
  await api("POST",`${staffBase}/adjustments/${pending.id}/review`,{outcome:"approved",reason:"Library record checked"},admin.token);
  ledger = await api("GET",`${staffBase}/account`,undefined,finance.token);
  expect(ledger.hold.reasons.map((row) => row.message).join(" ")).toContain("Library replacement");
  adjust = await api("GET",`${staffBase}/adjustments`,undefined,finance.token);
  const debitEntry = ledger.entries.find((row) => row.chargeCode === "ADJUSTMENT");
  await denied("POST",`${staffBase}/adjustments`,{kind:"write_off",amountMinor:1500,targetEntryId:debitEntry.id,evidenceHash:adjust.evidenceHash,reason:"Cannot waive a manual debit",evidenceRef:"SAMPLE"},finance.token,409);

  const ownAdjustments = (await api("GET",`${own}/adjustments`,undefined,student.token)).adjustments;
  expect(ownAdjustments.map((row) => row.status)).toEqual(["approved","approved","revoked","approved","rejected"]);
  expect(ownAdjustments[0].requestedBy).toBeUndefined();
  const decided = (await api("GET",`/api/notifications?recipientAccountId=${student.id}`,undefined,admin.token)).map((row) => row.payload.subject);
  for (const subject of ["Your student account scholarship was approved","Your student account scholarship was rejected","Your student account hold exemption was revoked","Your student account refund was approved","Your student account debit was approved"]) expect(decided).toContain(subject);
  const events = await api("GET","/api/audit/events?action=finance.adjustment.approved",undefined,admin.token);
  expect(JSON.stringify(events)).toContain("scholarship");
  await page.locator("[data-finance-refresh]").click(); await expect(page.locator("[data-finance-refresh]")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("adjustments.png"),fullPage:true});

  async function createProgramme(c) {
    const p = await api("POST","/api/master-data/programmes",{code:`FA-${stamp}`,name:`SAMPLE adjustments ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Adjustment curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:c.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE adjustments ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-ADJ-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-FA-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {...sp,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`FA-Y-${y}-${stamp}`,name:`SAMPLE adjustments ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`FA-S-${y}-${stamp}`,name:`SAMPLE adjustments ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function configure(periodId) {
    const ctx = (await api("GET",`${staffBase}/registrations`,undefined,admin.token)).find((row) => row.period.id === periodId);
    await api("POST",`${staffBase}/registration-periods/${periodId}`,{offerings:ctx.offerings.map((row) => ({courseId:row.courseId,delivery:"asynchronous",meetings:[]})),reason:"Synthetic delivery"},admin.token);
    await api("POST",`${staffBase}/registration-periods/${periodId}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  }
  async function submit(form,values) {for (const [field,value] of Object.entries(values)) {const input = form.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Adjust",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Adjust",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
