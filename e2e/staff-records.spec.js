import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("staff records link invitations to accounts and keep employment and status history",async ({page,request},info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`.replaceAll(".","-");
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const hr = await applicantAccount(`hr.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:hr.id,roleCode:"hr_officer",scope:{},reason:"HR administration"},admin.token);
  const base = {category:"LECTURER",grade:"L1",departmentId:"dept_computing",roleCode:"lecturer",reason:"Approved appointment"};
  const supervisor = await api("POST","/api/staff",{...base,email:`head.${stamp}@example.edu`,legalName:`Head Of Department ${stamp}`,preferredName:"Head",category:"MANAGEMENT",grade:"M1",engagedOn:day(-60)},hr.token);
  expect(supervisor).toMatchObject({status:"invited",accountId:null,employeeNumber:expect.stringMatching(/^E\d{6}$/)});
  await denied("POST","/api/staff",{...base,email:`head.${stamp}@example.edu`,legalName:"Duplicate",preferredName:"Dup",engagedOn:day(-1)},hr.token,409);
  await denied("POST","/api/staff",{...base,email:`root.${stamp}@example.edu`,legalName:"Root",preferredName:"Root",engagedOn:day(-1),roleCode:"system_administrator"},hr.token,400);
  await denied("POST","/api/staff",{...base,email:`reg.${stamp}@example.edu`,legalName:"Registrar made",preferredName:"Reg",engagedOn:day(-1)},registrar.token,403);
  expect((await api("GET",`/api/staff?q=${supervisor.employeeNumber}`,undefined,registrar.token)).items.map((row) => row.id)).toEqual([supervisor.id]);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await page.goto("/#registry/admin");
  await page.locator("[data-staff-panel] > summary").click();
  const create = page.locator("[data-staff-create]");
  await create.locator("..").locator("summary").click();
  await submit(create,{email:`lecturer.${stamp}@example.edu`,legalName:`Lecturer Person ${stamp}`,preferredName:"Lecturer",employeeNumber:`EMP-${stamp.slice(-8)}`.toUpperCase(),engagedOn:day(-30),roleCode:"lecturer",departmentId:"dept_computing",category:"LECTURER",grade:"L1",reason:"Approved lecturer appointment"});
  await expect(page.getByRole("status")).toContainText("created and invitation sent");
  const lecturerRow = (await api("GET",`/api/staff?q=lecturer.${stamp}`,undefined,admin.token)).items[0];
  await expect(page.locator(`[data-staff-record="${lecturerRow.id}"]`)).toContainText("Granted when the invitation is accepted");

  const lecturer = await activate(`lecturer.${stamp}@example.edu`,`Lecturer Person ${stamp}`);
  let record = await api("GET",`/api/staff/${lecturerRow.id}`,undefined,admin.token);
  expect(record).toMatchObject({status:"active",accountId:lecturer.id,revision:1});
  expect(record.roles.map((row) => row.roleCode)).toEqual(["lecturer"]);
  expect(record.statusHistory.map((row) => row.toStatus)).toEqual(["active","invited"]);

  await denied("POST",`/api/staff/${lecturerRow.id}/employment`,{revision:1,departmentId:"dept_computing",category:"LECTURER",grade:"L2",effectiveFrom:day(-30),reason:"Same day"},admin.token,409);
  await page.locator(`[data-staff-detail="${lecturerRow.id}"]`).click();
  const employment = page.locator("[data-staff-employment]");
  await expect(employment.locator('[name="revision"]')).toHaveValue('1');
  await expect(employment.locator("..").locator("summary")).toHaveAttribute('aria-disabled','false');
  await employment.locator("..").locator("summary").click();
  await submit(employment,{departmentId:"dept_computing",category:"LECTURER",grade:"L2",supervisorStaffId:supervisor.id,effectiveFrom:day(-10),reason:"Promotion and reporting line"});
  await expect(page.getByRole("status")).toHaveText("Employment change recorded.");
  record = await api("GET",`/api/staff/${lecturerRow.id}`,undefined,admin.token);
  expect(record).toMatchObject({grade:"L2",supervisorStaffId:supervisor.id,revision:2});
  expect(record.employment.map((row) => [row.grade,row.effectiveFrom,row.effectiveTo])).toEqual([["L2",day(-10),null],["L1",day(-30),day(-11)]]);
  await denied("POST",`/api/staff/${supervisor.id}/employment`,{revision:0,departmentId:"dept_computing",category:"MANAGEMENT",grade:"M1",supervisorStaffId:lecturerRow.id,effectiveFrom:day(-5),reason:"Would loop"},admin.token,409);
  await denied("POST",`/api/staff/${lecturerRow.id}/status`,{revision:2,toStatus:"active",effectiveOn:day(0),reason:"Already active"},admin.token,409);

  const statusForm = () => page.locator("[data-staff-status]");
  await statusForm().locator("..").locator("summary").click();
  await submit(statusForm(),{toStatus:"suspended",effectiveOn:day(0),reason:"Pending investigation"});
  await expect(page.getByRole("status")).toHaveText("Staff status changed.");
  await denied("GET","/api/identity/me",undefined,lecturer.token,401);
  expect((await request.post("/api/identity/sessions",{data:{email:lecturer.email,password:lecturer.password}})).ok()).toBe(false);
  record = await api("GET",`/api/staff/${lecturerRow.id}`,undefined,admin.token);
  await api("POST",`/api/staff/${lecturerRow.id}/status`,{revision:record.revision,toStatus:"active",effectiveOn:day(0),reason:"Cleared"},hr.token);
  const again = await api("POST","/api/identity/sessions",{email:lecturer.email,password:lecturer.password});
  expect((await api("GET","/api/identity/me",undefined,again.token)).account.id).toBe(lecturer.id);

  await api("POST",`/api/staff/${supervisor.id}/status`,{revision:0,toStatus:"exited",effectiveOn:day(0),reason:"Offer withdrawn before start"},hr.token);
  const token = await activationToken(`head.${stamp}@example.edu`);
  await denied("POST","/api/identity/activations",{token,password:"Kariba-Dam-Staff-2026!",preferredName:"Head",legalName:"Head"},undefined,400);
  record = await api("GET",`/api/staff/${lecturerRow.id}`,undefined,admin.token);
  expect(record.supervisorStatus).toBe("exited");
  await api("POST",`/api/staff/${lecturerRow.id}/status`,{revision:record.revision,toStatus:"exited",effectiveOn:day(0),reason:"Resigned"},hr.token);
  record = await api("GET",`/api/staff/${lecturerRow.id}`,undefined,admin.token);
  expect(record).toMatchObject({status:"exited",exitedOn:day(0)});
  expect(record.roles.every((row) => row.effectiveTo === day(0))).toBe(true);
  expect(record.employment[0].effectiveTo).toBe(day(0));
  await denied("POST",`/api/staff/${lecturerRow.id}/employment`,{revision:record.revision,departmentId:"dept_computing",category:"LECTURER",grade:"L3",effectiveFrom:day(0),reason:"Closed"},hr.token,409);
  await denied("GET","/api/identity/me",undefined,again.token,401);
  const events = await api("GET",`/api/audit/events?subjectId=${lecturerRow.id}`,undefined,admin.token);
  expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(["staff.created","staff.employment_changed","staff.suspended","staff.active","staff.exited"]));

  await submit(page.locator("[data-staff-filter]"),{q:lecturerRow.employeeNumber});
  await page.locator(`[data-staff-detail="${lecturerRow.id}"]`).click();
  await expect(page.locator(`[data-staff-record="${lecturerRow.id}"]`)).toContainText(`exited ${day(0)}`);
  await expect(page.locator("[data-staff-employment]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("staff.png"),fullPage:true});

  async function activationToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function activate(email,legalName) {
    const password = "Kariba-Dam-Staff-2026!";
    await api("POST","/api/identity/activations",{token:await activationToken(email),password,preferredName:"Staff",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function applicantAccount(email) {
    await api("POST","/api/admissions/registrations",{email,preferredName:"HR",legalName:`HR Officer ${stamp}`});
    const password = "Kariba-Dam-Applicant-2026!";
    await api("POST","/api/identity/activations",{token:await activationToken(email),password,preferredName:"HR",legalName:`HR Officer ${stamp}`});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {token:session.token,id:me.account.id};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,tokenValue) {const response = await request.fetch(path,{method,data,headers:tokenValue ? {Authorization:`Bearer ${tokenValue}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,tokenValue,status) {const response = await request.fetch(path,{method,data,headers:tokenValue ? {Authorization:`Bearer ${tokenValue}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
