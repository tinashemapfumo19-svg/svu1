import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("duplicate student records merge or stay distinct only after independent scoped review",async ({page,request},info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "DPD" : "DPM";
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const course = await api("POST","/api/master-data/courses",{code:`${prefix}101`,title:"Duplicate sample course",credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token);
  const programme = await createProgramme(course),first = await createIntake(programme,"First"),second = await createIntake(programme,"Second");
  const name = `Chipo Duplicate ${stamp}`;
  const original = await account(`dup.original.${stamp}@example.com`,name),repeat = await account(`dup.repeat.${stamp}@example.com`,name),other = await account(`dup.other.${stamp}@example.com`,`Farai Other ${stamp}`);
  for (const person of [original,repeat]) await api("PUT","/api/admissions/profile",{dateOfBirth:"2002-02-02",nationalityCode:"ZW"},person.token);
  const kept = await admit(original,first,`+2637712${prefix === "DPD" ? 1 : 2}0001`),dropped = await admit(repeat,second,`+2637712${prefix === "DPD" ? 1 : 2}0002`),separate = await admit(other,second,`+2637712${prefix === "DPD" ? 1 : 2}0003`);
  const retainedSupportCase = await api('POST','/api/support/me/cases',{programmeId:dropped.id,subject:'SAMPLE retained support custody',category:'feedback',body:'Private case follows the independently merged programme record.',requestKey:`support-${stamp.replaceAll('.','_')}`},repeat.token);
  const base = `/api/registry/programmes/${kept.id}/duplicates`;

  let context = await api("GET",base,undefined,registrar.token);
  const candidate = context.candidates.find((row) => row.studentNumber === dropped.studentNumber);
  expect(candidate).toMatchObject({legalName:name,dateOfBirth:"2002-02-02",reasons:["nameAndBirthDate"]});
  expect(context.candidates.some((row) => row.studentNumber === separate.studentNumber)).toBe(false);

  const limited = await account(`dup.limited.${stamp}@example.com`,`Limited Registrar ${stamp}`);
  await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"academic_registrar",scope:{programmeCodes:[programme.code],intakeIds:[first.id]},reason:"Only the first intake"},admin.token);
  await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"auditor",scope:{},reason:"Must not widen registry authority"},admin.token);
  expect((await api("GET",base,undefined,limited.token)).candidates).toEqual([]);
  await denied("POST",base,{candidateStudentId:candidate.id,survivor:"current",proposal:"merge",evidenceHash:candidate.evidenceHash,reason:"Out of scope",evidenceRef:"SAMPLE"},limited.token,404);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  await submit(page.locator("[data-registry-filter]"),{q:kept.studentNumber});
  await page.locator(`[data-registry-detail="${kept.id}"]`).click();
  await expect(page.locator(`[data-duplicate-candidate="${dropped.studentNumber}"]`)).toContainText("Same legal name and birth date");
  const form = page.locator(`[data-duplicate-request="${candidate.id}"]`);
  await form.locator("..").locator("summary").click();
  await submit(form,{proposal:"merge",survivor:"current",evidenceRef:"SAMPLE-NATIONAL-ID-CHECK",reason:"Same person applied twice with two accounts"});
  await expect(page.getByRole("status")).toHaveText("Duplicate review requested.");
  context = await api("GET",base,undefined,registrar.token);
  let pending = context.cases[0];
  expect(pending).toMatchObject({proposal:"merge",status:"requested",survivorNumber:kept.studentNumber,duplicateNumber:dropped.studentNumber});
  await expect(page.locator(`[data-duplicate-review="${pending.id}"]`)).toHaveCount(0);
  await denied("POST",`${base}/${pending.id}/review`,{outcome:"approved",reason:"Self review"},registrar.token,403);
  await denied("POST",`${base}/${pending.id}/review`,{outcome:"approved",reason:"Wrong scope"},limited.token,403);
  await denied("POST",base,{candidateStudentId:candidate.id,survivor:"current",proposal:"distinct",evidenceHash:candidate.evidenceHash,reason:"Second open case",evidenceRef:"SAMPLE"},registrar.token,409);

  const profile = (await api("GET","/api/registry/me",undefined,repeat.token)).profile;
  await api("PUT","/api/registry/me",{...profile,phone:`+2637712${prefix === "DPD" ? 1 : 2}9999`},repeat.token);
  await denied("POST",`${base}/${pending.id}/review`,{outcome:"approved",reason:"Stale evidence"},admin.token,409);
  await api("POST",`${base}/${pending.id}/review`,{outcome:"rejected",reason:"Records changed after the request"},admin.token);

  context = await api("GET",base,undefined,registrar.token);
  const fresh = context.candidates.find((row) => row.id === candidate.id);
  expect(fresh.evidenceHash).not.toBe(candidate.evidenceHash);
  await api("POST",base,{candidateStudentId:candidate.id,survivor:"current",proposal:"merge",evidenceHash:fresh.evidenceHash,reason:"Same person, fresh evidence",evidenceRef:"SAMPLE-NATIONAL-ID-CHECK"},registrar.token);
  pending = (await api("GET",base,undefined,registrar.token)).cases[0];
  const merged = await api("POST",`${base}/${pending.id}/review`,{outcome:"approved",reason:"Identity documents match"},admin.token);
  expect(merged.mergeResult).toMatchObject({programmeIds:[dropped.id],enrolments:0});
  await denied("POST",`${base}/${pending.id}/review`,{outcome:"rejected",reason:"Immutable"},admin.token,409);

  const survivorView = await api("GET","/api/registry/me",undefined,original.token);
  expect(survivorView.programmes.map((row) => row.id).sort()).toEqual([kept.id,dropped.id].sort());
  const mergedReport = await api('GET',`/api/reports/registry?programmeCode=${encodeURIComponent(programme.code)}`,undefined,admin.token);
  expect(mergedReport.totals).toMatchObject({programmeRecords:3,pendingOnboarding:3,onboarded:0,unclassifiedProgrammes:0});
  expect(mergedReport.rows.map((row) => row.counts.programmeRecords).sort()).toEqual([1,2]);
  expect((await api("GET","/api/registry/me",undefined,repeat.token)).programmes).toEqual([]);
  expect((await api('GET',`/api/support/me/cases/${retainedSupportCase.id}`,undefined,original.token)).programmeId).toBe(dropped.id);
  await denied('GET',`/api/support/me/cases/${retainedSupportCase.id}`,undefined,repeat.token,404);
  expect((await api('GET','/api/support/me/cases',undefined,original.token)).items.map((row) => row.id)).toContain(retainedSupportCase.id);
  await denied("POST","/api/registry/me/identity",{revision:0,changes:{preferredName:"Merged"},reason:"Merged record",evidenceRef:"SAMPLE"},repeat.token,409);
  expect((await api("GET",`/api/registry/programmes/${dropped.id}`,undefined,registrar.token)).studentNumber).toBe(kept.studentNumber);
  expect((await api("GET",base,undefined,registrar.token)).candidates.some((row) => row.id === candidate.id)).toBe(false);

  await page.locator("[data-duplicate-refresh]").click();
  await expect(page.locator(`[data-duplicate-case="${pending.id}"]`)).toContainText("1 programme record(s) and 0 course enrolment(s) moved");
  await submit(page.locator("[data-duplicate-lookup]"),{studentNumber:separate.studentNumber});
  await expect(page.locator(`[data-duplicate-candidate="${separate.studentNumber}"]`)).toContainText("Looked up by number");
  const lookedUp = (await api("GET",`${base}?studentNumber=${separate.studentNumber}`,undefined,registrar.token)).candidates.find((row) => row.studentNumber === separate.studentNumber);
  const distinctForm = page.locator(`[data-duplicate-request="${lookedUp.id}"]`);
  await distinctForm.locator("..").locator("summary").click();
  await submit(distinctForm,{proposal:"distinct",survivor:"current",evidenceRef:"SAMPLE-DIFFERENT-IDS",reason:"Different national documents"});
  await expect(page.getByRole("status")).toHaveText("Duplicate review requested.");
  const distinctCase = (await api("GET",base,undefined,registrar.token)).cases[0];
  await api("POST",`${base}/${distinctCase.id}/review`,{outcome:"approved",reason:"Confirmed different people"},admin.token);
  const after = (await api("GET",`${base}?studentNumber=${separate.studentNumber}`,undefined,registrar.token)).candidates.find((row) => row.id === lookedUp.id);
  expect(after.distinct).toBe(true);
  await denied("POST",base,{candidateStudentId:lookedUp.id,survivor:"current",proposal:"distinct",evidenceHash:after.evidenceHash,reason:"Again",evidenceRef:"SAMPLE"},registrar.token,409);
  expect((await api("GET",`/api/registry/programmes/${separate.id}`,undefined,registrar.token)).studentNumber).toBe(separate.studentNumber);

  const events = await api("GET",`/api/audit/events?action=registry.duplicate.approved&subjectId=${pending.id}`,undefined,admin.token);
  expect(JSON.stringify(events)).toContain(dropped.id);
  await page.locator("[data-duplicate-refresh]").click(); await expect(page.locator("[data-duplicate-refresh]")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("duplicates.png"),fullPage:true});
  await page.goto('/#apply');await submit(page.locator('[data-form="signin"]'),{email:original.email,password:original.password});
  await page.locator(`[data-support-open="${retainedSupportCase.id}"]`).click();
  await expect(page.locator('[data-support-detail] h3')).toHaveText('SAMPLE retained support custody');
  await expect(page.locator('[data-support-detail]')).toContainText('Private case follows the independently merged programme record.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-support-detail]').screenshot({path:info.outputPath('merged-support-case.png')});

  async function createProgramme(course) {
    const p = await api("POST","/api/master-data/programmes",{code:`DP-${stamp}`,name:`SAMPLE duplicate ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
    const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Duplicate curriculum",effectiveFrom:"2024-01-01"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
    await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
    return p;
  }
  async function createIntake(p,label) {
    const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE duplicate ${label} ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    return i;
  }
  async function admit(person,intake,phone) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-DUP-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-DP-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone,address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    return {...me.programmes.find((row) => row.intakeId === intake.id),studentNumber:me.studentNumber};
  }
  async function submit(form,values) {for (const [field,value] of Object.entries(values)) {const input = form.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email,legalName) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Duplicate",legalName});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Duplicate",legalName});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
