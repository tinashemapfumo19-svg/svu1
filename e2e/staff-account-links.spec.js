import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("people who already have an account become staff only by accepting the appointment themselves",async ({page,request},info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`.replaceAll(".","-");
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const base = {category:"LECTURER",grade:"L1",departmentId:"dept_computing",roleCode:"lecturer",engagedOn:day(-1),reason:"Approved appointment"};
  const tutor = await applicantAccount(`tutor.${stamp}@example.com`),other = await applicantAccount(`other.${stamp}@example.com`),decliner = await applicantAccount(`decliner.${stamp}@example.com`);

  // An existing account is never duplicated: HR must ask to link, and linking needs an existing, active account.
  await denied("POST","/api/staff",{...base,email:tutor.email,legalName:`Tutor ${stamp}`,preferredName:"Tutor"},admin.token,409);
  await denied("POST","/api/staff",{...base,email:`nobody.${stamp}@example.edu`,legalName:"Nobody",preferredName:"Nobody",linkExistingAccount:true},admin.token,400);
  await denied("POST","/api/staff",{...base,email:tutor.email,legalName:`Tutor ${stamp}`,preferredName:"Tutor",linkExistingAccount:"yes"},admin.token,400);

  // HR offers the appointment in the UI; the account gains nothing until the holder accepts.
  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await page.goto("/#registry/admin");
  await page.locator("[data-staff-panel] > summary").click();
  const create = page.locator("[data-staff-create]");
  await create.locator("..").locator("summary").click();
  await submit(create,{email:tutor.email,legalName:`Tutor Person ${stamp}`,preferredName:"Tutor",engagedOn:day(-1),roleCode:"lecturer",linkExistingAccount:"true",departmentId:"dept_computing",category:"LECTURER",grade:"L1",reason:"Graduate teaching assistant"});
  await expect(page.getByRole("status")).toContainText("the account holder must accept the appointment");
  const row = (await api("GET",`/api/staff?q=tutor.${stamp}`,undefined,admin.token)).items[0];
  await expect(page.locator(`[data-staff-record="${row.id}"] [data-staff-invitation]`)).toHaveText("Offered to an existing account - waiting for acceptance");
  let detail = await api("GET",`/api/staff/${row.id}`,undefined,admin.token);
  expect(detail).toMatchObject({status:"invited",accountId:null,roles:[],invitation:{status:"pending_acceptance",existingAccount:true}});
  expect(await roleCodes(tutor)).not.toContain("lecturer");
  const notices = (await api("GET",`/api/notifications?recipientAccountId=${tutor.id}`,undefined,admin.token)).map((row) => row.payload.subject);
  expect(notices).toContain(`Staff appointment waiting for you: ${row.employeeNumber}`);

  // Only the account holder sees and answers the offer.
  expect(await api("GET","/api/identity/staff-appointments",undefined,other.token)).toEqual([]);
  const offers = await api("GET","/api/identity/staff-appointments",undefined,tutor.token);
  expect(offers).toEqual([expect.objectContaining({employeeNumber:row.employeeNumber,roleCode:"lecturer",category:"LECTURER",engagedOn:day(-1)})]);
  await denied("POST",`/api/identity/staff-appointments/${offers[0].invitationId}`,{accept:true},other.token,404);
  await denied("POST",`/api/identity/staff-appointments/${offers[0].invitationId}`,{accept:"yes"},tutor.token,400);

  // The tutor accepts in the student portal; the same account now carries the staff record and role.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/#apply"); await submit(page.locator('[data-form="signin"]'),{email:tutor.email,password:tutor.password});
  await expect(page.locator(`[data-staff-appointment="${offers[0].invitationId}"]`)).toContainText(row.employeeNumber);
  await page.locator(`[data-appointment-respond="${offers[0].invitationId}"][data-accept="true"]`).click();
  await expect(page.getByText("Staff appointment accepted.")).toBeVisible();
  await expect(page.locator("[data-staff-appointments]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  detail = await api("GET",`/api/staff/${row.id}`,undefined,admin.token);
  expect(detail).toMatchObject({status:"active",accountId:tutor.id,invitation:{status:"activated"}});
  expect(detail.roles.map((role) => role.roleCode)).toContain("lecturer");
  expect(detail.statusHistory[0]).toMatchObject({fromStatus:"invited",toStatus:"active"});
  expect(await roleCodes(tutor)).toContain("lecturer");
  expect((await me(tutor)).person.personas).toEqual(expect.arrayContaining(["staff"]));
  await denied("POST",`/api/identity/staff-appointments/${offers[0].invitationId}`,{accept:true},tutor.token,409);
  const events = (await api("GET",`/api/audit/events?subjectId=${row.id}`,undefined,admin.token)).map((event) => event.action);
  expect(events).toEqual(expect.arrayContaining(["staff.created","staff.appointment.accepted"]));

  // A declined offer leaves the account untouched, shows HR the outcome, and the record can then be closed.
  const declined = await api("POST","/api/staff",{...base,email:decliner.email,legalName:`Decliner ${stamp}`,preferredName:"Decliner",linkExistingAccount:true},admin.token);
  const offer = (await api("GET","/api/identity/staff-appointments",undefined,decliner.token))[0];
  expect(await api("POST",`/api/identity/staff-appointments/${offer.invitationId}`,{accept:false,reason:"Taking another post"},decliner.token)).toEqual({invitationId:offer.invitationId,status:"declined"});
  detail = await api("GET",`/api/staff/${declined.id}`,undefined,admin.token);
  expect(detail).toMatchObject({status:"invited",accountId:null,invitation:{status:"declined"}});
  expect(await roleCodes(decliner)).not.toContain("lecturer");
  expect(await api("GET","/api/identity/staff-appointments",undefined,decliner.token)).toEqual([]);
  await api("POST",`/api/staff/${declined.id}/status`,{revision:detail.revision,toStatus:"exited",effectiveOn:day(0),reason:"Appointment declined"},admin.token);
  await page.screenshot({path:info.outputPath("appointment-accepted.png"),fullPage:true});

  async function me(person) {
    const session = await api("POST","/api/identity/sessions",{email:person.email,password:person.password});
    return api("GET","/api/identity/me",undefined,session.token);
  }
  async function roleCodes(person) {
    return (await me(person)).roles.map((role) => role.code);
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function applicantAccount(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Linked Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
