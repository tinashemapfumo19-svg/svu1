import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { openingBalanceChecksum } from "../server/modules/finance-migration.js";

test("opening balances import all-or-nothing and control totals reconcile within finance scope",async ({page,request},info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "OBD" : "OBM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Opening balance course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),intake = await createIntake(programme);
  const officer = await account(`opening.officer.${stamp}@example.com`,`Opening Officer ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"finance_officer",scope:{},reason:"Institution-wide finance"},admin.token);
  const scoped = await account(`opening.scoped.${stamp}@example.com`,`Opening Scoped ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:scoped.id,roleCode:"finance_officer",scope:{programmeCodes:["NOT-THIS"],intakeIds:["NOT-THIS"]},reason:"Other programme"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:scoped.id,roleCode:"auditor",scope:{},reason:"Unrelated global audit must not lend finance scope"},admin.token);
  const firstPerson = await account(`opening.first.${stamp}@example.com`,`Opening First ${stamp}`);
  const first = await admit(firstPerson),second = await admit(await account(`opening.second.${stamp}@example.com`,`Opening Second ${stamp}`));

  const file = (balances,ref = `CLOSE-${stamp}`) => ({source:"legacy-ledger",sourceRef:ref,currency:"USD",asOf:"2025-12-31",reason:"Finance-approved closing balances (sample)",
    expectedLineCount:balances.length,expectedDebitMinor:balances.filter((row) => row.amountMinor > 0).reduce((sum,row) => sum + row.amountMinor,0),
    expectedCreditMinor:-balances.filter((row) => row.amountMinor < 0).reduce((sum,row) => sum + row.amountMinor,0),checksum:openingBalanceChecksum(balances),balances});
  const bad = [{legacyRef:`A-${stamp}`,studentNumber:first.studentNumber,amountMinor:12000},{legacyRef:`B-${stamp}`,studentNumber:second.studentNumber,amountMinor:-3000},{legacyRef:`C-${stamp}`,studentNumber:"S99999999",amountMinor:500}];
  const dry = await api("POST","/api/finance/opening-balances",{...file(bad),dryRun:true},admin.token);
  expect(dry).toMatchObject({ready:false,applied:false,lineCount:3,debitMinor:12500,creditMinor:3000,problems:[{lineNo:3,message:"Student number S99999999 was not found."}]});
  await denied("POST","/api/finance/opening-balances",file(bad),admin.token,409);
  await denied("POST","/api/finance/opening-balances",{...file(bad),expectedDebitMinor:1},admin.token,409);
  await denied("POST","/api/finance/opening-balances",{...file(bad.slice(0,2)),dryRun:true},officer.token,403);
  expect((await api("GET",`/api/registry/programmes/${first.id}/account`,undefined,admin.token)).entries).toEqual([]);

  const good = bad.slice(0,2);
  expect(await api("POST","/api/finance/opening-balances",{...file(good),dryRun:true},admin.token)).toMatchObject({ready:true,problems:[]});
  const applied = await api("POST","/api/finance/opening-balances",file(good),admin.token);
  expect(applied).toMatchObject({applied:true,lineCount:2,netMinor:9000});
  await denied("POST","/api/finance/opening-balances",file(good),admin.token,409);
  expect((await api("POST","/api/finance/opening-balances",{...file([{legacyRef:`A2-${stamp}`,studentNumber:first.studentNumber,amountMinor:100}],`AGAIN-${stamp}`),dryRun:true},admin.token)).problems[0].message).toBe(`${first.studentNumber} already has a USD opening balance.`);

  const accountFirst = await api("GET",`/api/registry/programmes/${first.id}/account`,undefined,admin.token);
  expect(accountFirst.entries[0]).toMatchObject({chargeCode:"OPENING_BALANCE",dueOn:"2025-12-31",outstanding:12000});
  expect(accountFirst.hold.reasons[0].message).toContain(`Opening balance A-${stamp} as of 2025-12-31`);
  expect((await api("GET",`/api/registry/programmes/${second.id}/account`,undefined,admin.token)).currencies[0]).toMatchObject({credited:3000,credit:3000,balance:-3000});

  const report = await api("GET","/api/finance/reports/control-totals?currency=USD",undefined,admin.token);
  const row = report.rows.find((entry) => entry.programmeCode === programme.code);
  expect(row).toMatchObject({accounts:2,opening:9000,charged:12000,paid:0,credited:3000,balance:9000,outstanding:12000,due:12000,unallocated:3000,reconciles:true});
  expect(report.totals.every((total) => total.reconciles)).toBe(true);
  expect((await api("GET",`/api/finance/reports/control-totals?asOf=${day(-1)}`,undefined,admin.token)).rows.some((entry) => entry.programmeCode === programme.code)).toBe(false);
  expect((await api("GET","/api/finance/reports/control-totals",undefined,scoped.token)).rows.some((entry) => entry.programmeCode === programme.code)).toBe(false);
  expect((await api("GET","/api/finance/reports/control-totals",undefined,scoped.token)).unmatchedQueue).toBeNull();
  await denied('GET',`/api/finance/reports/control-totals?intakeId=${intake.id}&format=csv`,undefined,scoped.token,404);
  for (const path of ['/api/finance/reports/control-totals?format=csv','/api/finance/reports/control-totals/dictionary']) await denied('GET',path,undefined,firstPerson.token,403);
  for (const query of ['asOf=2026-02-30','currency=usd','format=pdf','workflow=Accepted']) await denied('GET',`/api/finance/reports/control-totals?${query}`,undefined,admin.token,400);
  expect(report).toMatchObject({definitionVersion:'finance-control-totals-v1',cutoffTimezone:'UTC'});
  expect(report.metrics.every((entry) => entry.approval.includes('pending'))).toBe(true);
  const events = await api("GET","/api/audit/events?action=finance.opening_balances.imported",undefined,admin.token);
  expect(JSON.stringify(events)).toContain(`CLOSE-${stamp}`);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  await expect(page.locator("[data-control-totals]")).toBeVisible();
  await page.locator("[data-control-totals] details").first().locator('summary').first().click();
  await expect(page.locator("[data-control-totals] .control-rows")).toContainText(`${programme.code} - SAMPLE opening ${stamp} (USD)`);
  await page.locator('[data-control-asof] [name="intakeId"]').selectOption(intake.id);
  await page.locator('[data-control-asof] [type="submit"]').click();
  await expect(page.locator('[data-control-currency="USD"]')).toContainText('90.00');
  await api('POST',`/api/registry/programmes/${first.id}/payments`,{currency:'USD',amountMinor:1200,method:'bank',externalRef:`FRESH-${stamp}`,receivedOn:day(-1),reason:'Payment recorded after report display'},admin.token);
  const [download] = await Promise.all([page.waitForEvent("download"),page.locator("[data-control-csv]").click()]);
  const content = await readFile(await download.path(),"utf8");
  expect(content.split("\n")[0]).toContain('"definition_version","definition_approval","generated_at","as_of_utc"');
  expect(content).toContain('finance-control-totals-v1');expect(content).toContain('owner approval pending');
  expect(content).toContain(`"${programme.code}","${intake.id}","SAMPLE opening ${stamp}","USD","2","90.00","120.00","12.00","30.00","78.00","108.00","108.00","30.00","true"`);
  expect(content).not.toContain(first.studentNumber);expect(content).not.toContain(second.studentNumber);
  expect((await api('GET',`/api/finance/reports/control-totals?asOf=${day(-1)}&intakeId=${intake.id}`,undefined,admin.token)).rows).toEqual([]);
  const exports = await api('GET','/api/audit/events?action=reports.finance.exported',undefined,admin.token);
  expect(JSON.stringify(exports)).toContain(intake.id);expect(JSON.stringify(exports)).not.toContain(first.studentNumber);
  await page.locator('[data-finance-definitions] > summary').click();await page.locator('[data-finance-definitions] .report-definition').first().locator('summary').click();
  await expect(page.locator('[data-finance-definitions]')).toContainText('Not unique students');
  await submit(page.locator("[data-control-asof]"),{asOf:day(-1)});
  await expect(page.locator("[data-control-totals] .section-header")).toContainText(`As of ${day(-1)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("control-totals.png"),fullPage:true});
  await submit(page.locator('[data-control-asof]'),{asOf:day(0)});
  await expect(page.locator('[data-control-csv]')).toBeEnabled();
  const uiSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem('svu.registry.session')));
  await api('DELETE',`/api/identity/sessions/${uiSession.sessionId}`,undefined,admin.token);
  let deniedDownloads = 0;page.on('download',() => deniedDownloads++);
  await page.locator('[data-control-csv]').click();await expect(page.locator('[data-registry-login]')).toBeVisible();
  await expect(page.locator('[data-control-totals]')).toHaveCount(0);expect(deniedDownloads).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('svu.registry.session'))).toBeNull();

  async function createProgramme(c) {
    const p = await api("POST","/api/master-data/programmes",{code:`OB-${stamp}`,name:`SAMPLE opening ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Opening curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:c.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE opening ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-OB-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-OB-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    return {...me.programmes.find((row) => row.intakeId === intake.id),studentNumber:me.studentNumber};
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Opening",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Opening",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
