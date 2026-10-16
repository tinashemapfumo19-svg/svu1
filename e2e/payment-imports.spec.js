import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { statementChecksum } from "../server/modules/payment-imports.js";

test("reconciled statement imports match, flag duplicates and queue the rest for independent resolution",async ({page,request},info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "PID" : "PIM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Import sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const officer = await account(`import.officer.${stamp}@example.com`,`Import Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"finance_officer",scope:{},reason:"Institution-wide finance"},admin.token);
  const scoped = await account(`import.scoped.${stamp}@example.com`,`Import Scoped ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:scoped.id,roleCode:"finance_officer",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Programme finance only"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:scoped.id,roleCode:"auditor",scope:{},reason:"Must not widen import scope"},admin.token);
  const first = await account(`import.first.${stamp}@example.com`,`Import First ${stamp}`),second = await account(`import.second.${stamp}@example.com`,`Import Second ${stamp}`);
  const a = await admit(first),b = await admit(second);
  await api("POST",`/api/registry/programmes/${a.id}/payments`,{currency:"USD",amountMinor:700,method:"bank",externalRef:`PRE-${stamp}`,receivedOn:day(0),reason:"Recorded at the cashier first"},admin.token);
  await denied("GET","/api/finance/payment-imports",undefined,scoped.token,403);

  const lines = [
    {externalRef:`FT-A-${stamp}`,amountMinor:10000,receivedOn:day(-1),payerReference:`Fees ${a.studentNumber.toLowerCase()}`},
    {externalRef:`FT-B-${stamp}`,amountMinor:5000,receivedOn:day(-1),payerReference:`${b.studentNumber} and ${a.studentNumber}`},
    {externalRef:`FT-C-${stamp}`,amountMinor:2000,receivedOn:day(-1),payerReference:"no reference"},
    {externalRef:`FT-A-${stamp}`,amountMinor:10000,receivedOn:day(-1),payerReference:`Fees ${a.studentNumber}`},
    {externalRef:`FT-X-${stamp}`,amountMinor:3000,receivedOn:day(0),payerReference:"S99999999"},
    {externalRef:`PRE-${stamp}`,amountMinor:700,receivedOn:day(0),payerReference:a.studentNumber}
  ];
  const total = lines.reduce((sum,line) => sum + line.amountMinor,0);
  await denied("POST","/api/finance/payment-imports",{source:"bank",sourceRef:`STMT-${stamp}`,currency:"USD",reason:"Wrong total",expectedLineCount:6,expectedTotalMinor:total + 1,checksum:statementChecksum(lines),lines},officer.token,409);
  await denied("POST","/api/finance/payment-imports",{source:"bank",sourceRef:`STMT-${stamp}`,currency:"USD",reason:"Scoped",expectedLineCount:6,expectedTotalMinor:total,checksum:statementChecksum(lines),lines},scoped.token,403);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:officer.email,password:officer.password});
  const form = page.locator("[data-statement-import]");
  await form.locator("..").locator("summary").click();
  await submit(form,{sourceRef:`STMT-${stamp}`,currency:"USD",expectedLineCount:"6",expectedTotal:(total / 100).toFixed(2),
    lines:lines.map((line) => `${line.externalRef},${(line.amountMinor / 100).toFixed(2)},${line.receivedOn},${line.payerReference}`).join("\n"),reason:"Daily bank statement"});
  await expect(page.getByRole("status")).toHaveText("Statement imported: 1 matched, 3 unmatched, 2 duplicate.");
  const listed = await api("GET","/api/finance/payment-imports",undefined,officer.token);
  const queue = listed.queue.filter((row) => row.sourceRef === `STMT-${stamp}`);
  expect(queue.map((row) => row.lineNo)).toEqual([2,3,5]);
  expect(queue.map((row) => row.matchNote)).toEqual(["Several student numbers in the payer reference.","No student number in the payer reference.","Student number S99999999 was not found."]);
  await expect(page.locator(`[data-statement-line="${queue[0].id}"]`)).toContainText("Another finance officer must resolve");
  await denied("POST",`/api/finance/payment-imports/lines/${queue[0].id}/resolve`,{action:"return",reason:"Own import"},officer.token,403);
  await denied("POST","/api/finance/payment-imports",{source:"bank",sourceRef:`STMT-${stamp}`,currency:"USD",reason:"Replay",expectedLineCount:6,expectedTotalMinor:total,checksum:statementChecksum(lines),lines},admin.token,409);

  let accountA = await api("GET",`/api/registry/programmes/${a.id}/account`,undefined,admin.token);
  expect(accountA.currencies[0]).toMatchObject({paid:10700});
  expect(accountA.entries.filter((row) => row.entryType === "payment").map((row) => row.externalRef).sort()).toEqual([`FT-A-${stamp}`,`PRE-${stamp}`].sort());

  await api("POST",`/api/finance/payment-imports/lines/${queue[0].id}/resolve`,{action:"assign",studentNumber:b.studentNumber,reason:"Payer confirmed by phone it was for the second student"},admin.token);
  await denied("POST",`/api/finance/payment-imports/lines/${queue[0].id}/resolve`,{action:"return",reason:"Already resolved"},admin.token,409);
  await denied("POST",`/api/finance/payment-imports/lines/${queue[2].id}/resolve`,{action:"assign",studentNumber:"S99999999",reason:"Unknown"},admin.token,404);
  await api("POST",`/api/finance/payment-imports/lines/${queue[2].id}/resolve`,{action:"return",reason:"Returned to sender bank"},admin.token);
  expect((await api("GET",`/api/registry/programmes/${b.id}/account`,undefined,admin.token)).currencies[0]).toMatchObject({paid:5000});

  const reviewer = await account(`import.reviewer.${stamp}@example.com`,`Import Reviewer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:reviewer.id,roleCode:"finance_officer",scope:{},reason:"Second finance officer"},admin.token);
  await page.locator("[data-registry-signout]").click();
  await submit(page.locator("[data-registry-login]"),{email:reviewer.email,password:reviewer.password});
  await submit(page.locator(`[data-statement-resolve="${queue[1].id}"]`),{action:"assign",studentNumber:a.studentNumber,reason:"Matched by amount and payer name"});
  await expect(page.getByRole("status")).toHaveText("Statement line resolved.");
  await expect(page.locator(`[data-statement-line="${queue[1].id}"]`)).toHaveCount(0);
  accountA = await api("GET",`/api/registry/programmes/${a.id}/account`,undefined,admin.token);
  expect(accountA.currencies[0]).toMatchObject({paid:12700});
  const statementRow = (await api("GET","/api/finance/payment-imports",undefined,admin.token)).imports.find((row) => row.sourceRef === `STMT-${stamp}`);
  expect(statementRow.counts).toEqual({matched:1,duplicate:2,assigned:2,returned:1});
  const events = await api("GET","/api/audit/events?action=finance.statement.imported",undefined,admin.token);
  expect(JSON.stringify(events)).toContain(`STMT-${stamp}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("imports.png"),fullPage:true});

  async function createProgramme(c) {
    const p = await api("POST","/api/master-data/programmes",{code:`PI-${stamp}`,name:`SAMPLE imports ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Import curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:c.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE imports ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-PI-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-PI-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    return {...me.programmes.find((row) => row.intakeId === intake.id),studentNumber:me.studentNumber};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Import",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Import",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
