import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("student identity corrections need evidence and independent scoped review",async ({page,browser,request},info) => {
  test.setTimeout(300_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "IDD" : "IDM";
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Identity sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const twin = await account(`identity.twin.${stamp}@example.com`,`Rudo Twin ${stamp}`);
  await api("PUT","/api/admissions/profile",{dateOfBirth:"2003-03-03",nationalityCode:"ZW"},twin.token);
  await admit(twin);
  const student = await account(`identity.student.${stamp}@example.com`,`Tendai Mispelt ${stamp}`);
  const record = await admit(student),base = `/api/registry/programmes/${record.id}/identity`;
  const options = {viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch};
  const staffContext = await browser.newContext(options),staff = await staffContext.newPage();
  for (const current of [page,staff]) current.setDefaultTimeout(15_000);
  try {
    await page.goto("/#apply"); await submit(page.locator('[data-form="signin"]'),{email:student.email,password:student.password});
    await expect(page.locator(".student-identity")).toContainText(`Tendai Mispelt ${stamp}`);
    const correction = page.locator('[data-form="student-identity"]');
    await correction.locator("..").locator("summary").click();
    await submit(correction,{legalName:`Tendai Corrected ${stamp}`,dateOfBirth:"2004-05-06",nationalityCode:"ZW",evidenceRef:"SAMPLE-BIRTH-CERTIFICATE",reason:"Birth certificate spelling and date"});
    await expect(page.getByRole("status")).toContainText("Identity correction sent");
    await expect(page.locator(".student-identity .identity-decision")).toContainText("requested");
    await expect(page.locator('[data-form="student-identity"]')).toHaveCount(0);

    const own = await api("GET","/api/registry/me/identity",undefined,student.token);
    expect(own.requests[0]).toMatchObject({channel:"self",status:"requested",changes:{legalName:`Tendai Corrected ${stamp}`,dateOfBirth:"2004-05-06",nationalityCode:"ZW"}});
    await denied("POST","/api/registry/me/identity",{revision:0,changes:{preferredName:"Second"},reason:"Second open request",evidenceRef:"SAMPLE"},student.token,409);
    await denied("PUT","/api/admissions/profile",{dateOfBirth:"2001-01-01"},student.token,409);
    await denied("POST",`${base}/${own.requests[0].id}/review`,{outcome:"approved",reason:"Own approval"},student.token,403);
    await denied("GET",base,undefined,student.token,403);

    const limited = await account(`identity.limited.${stamp}@example.com`,`Limited Registrar ${stamp}`);
    await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"academic_registrar",scope:{programmeCodes:["NOT-THIS-PROGRAMME"]},reason:"Wrong programme scope"},admin.token);
    await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"auditor",scope:{},reason:"Must not widen registry authority"},admin.token);
    await denied("GET",base,undefined,limited.token,403);
    await denied("POST",`${base}/${own.requests[0].id}/review`,{outcome:"approved",reason:"Wrong scope"},limited.token,403);

    await staff.goto("/#registry"); await submit(staff.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
    await submit(staff.locator("[data-registry-filter]"),{q:record.studentNumber});
    await staff.locator(`[data-registry-detail="${record.id}"]`).click();
    await expect(staff.locator("[data-identity-refresh]")).toBeEnabled();
    await submit(staff.locator(`[data-identity-review="${own.requests[0].id}"]`),{outcome:"approved",reason:"Original birth certificate inspected"});
    await expect(staff.getByRole("status")).toHaveText("Identity correction reviewed.");
    await expect(staff.locator(".registry-identity .identity-summary")).toContainText(`Tendai Corrected ${stamp}`);
    await expect(staff.locator(`[data-registry-detail="${record.id}"]`)).toContainText(`Tendai Corrected ${stamp}`);
    expect((await api("GET","/api/identity/me",undefined,student.token)).person.legalName).toBe(`Tendai Corrected ${stamp}`);
    expect((await api("GET","/api/admissions/profile",undefined,student.token)).profile).toMatchObject({dateOfBirth:"2004-05-06",nationalityCode:"ZW"});
    await denied("POST",`${base}/${own.requests[0].id}/review`,{outcome:"rejected",reason:"Reviewed requests are immutable"},admin.token,409);
    await denied("POST","/api/registry/me/identity",{revision:0,changes:{preferredName:"Stale"},reason:"Old revision",evidenceRef:"SAMPLE"},student.token,409);

    const request = staff.locator("[data-identity-request]");
    await request.locator("..").locator("summary").click();
    await submit(request,{preferredName:"Tee",evidenceRef:"SAMPLE-STUDENT-EMAIL",reason:"Student asked to be called Tee"});
    await expect(staff.getByRole("status")).toHaveText("Identity correction requested.");
    let current = await api("GET",base,undefined,registrar.token);
    expect(current.requests[0]).toMatchObject({channel:"staff",status:"requested",revision:1,changes:{preferredName:"Tee"}});
    await expect(staff.locator(`[data-identity-review="${current.requests[0].id}"]`)).toHaveCount(0);
    await denied("POST",`${base}/${current.requests[0].id}/review`,{outcome:"approved",reason:"Self review"},registrar.token,403);
    await api("POST",`${base}/${current.requests[0].id}/review`,{outcome:"rejected",reason:"Preferred name request must come from the student"},admin.token);

    await denied("POST",base,{revision:1,changes:{legalName:`Rudo Twin ${stamp}`,dateOfBirth:"2003-03-03"},reason:"Would collide with another student",evidenceRef:"SAMPLE"},registrar.token,409);
    current = await api("GET",base,undefined,registrar.token);
    expect(current).toMatchObject({revision:1,identity:{legalName:`Tendai Corrected ${stamp}`,preferredName:"Identity",dateOfBirth:"2004-05-06"}});
    expect(current.requests.map((row) => row.status)).toEqual(["rejected","approved"]);
    const events = await api("GET",`/api/audit/events?action=registry.identity.approved&subjectId=${own.requests[0].id}`,undefined,admin.token);
    expect(JSON.stringify(events)).not.toContain("Tendai Corrected");
    expect(JSON.stringify(events)).toContain("legalName");

    await page.reload(); await expect(page.locator(".student-identity")).toContainText(`Tendai Corrected ${stamp}`);
    await expect(page.locator(".student-identity")).toContainText("rejected");
    for (const current of [page,staff]) expect(await current.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(current.viewportSize().width);
    await page.screenshot({path:info.outputPath("student-identity.png"),fullPage:true}); await staff.screenshot({path:info.outputPath("staff-identity.png"),fullPage:true});
  } finally {await staffContext.close();}

  async function createProgramme(course) {
    const p = await api("POST","/api/master-data/programmes",{code:`ID-${stamp}`,name:`SAMPLE identity ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Identity curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE identity ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-IDENTITY-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-ID-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    return (await api("GET","/api/registry/me",undefined,person.token)).programmes.find((row) => row.intakeId === intake.id);
  }
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === "SELECT")) await field.selectOption(String(value));else await field.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Identity",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Identity",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
