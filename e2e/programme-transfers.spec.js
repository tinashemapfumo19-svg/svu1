import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";

test("governed programme, intake and curriculum transfers preserve original records",async ({page,browser,request},info) => {
  test.setTimeout(480_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "TXD" : "TXM",futureYear = info.project.name === "desktop" ? 2054 : 2056;
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const student = await account(`transfer.student.${stamp}@example.com`);
  const courses = [];
  for (const [index,title] of [[1,"Original foundations"],[2,"Destination foundations"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const original = await programme("Original",courses[0]),destination = await programme("Destination",courses[1]);
  const firstIntake = await intake(original,"Original",5),secondIntake = await intake(destination,"Destination",1),thirdIntake = await intake(destination,"Later cohort",1);
  const source = await admit(student,original,firstIntake);
  const sourceBase = `/api/registry/programmes/${source.id}`,sourceOwn = `/api/registry/me/programmes/${source.id}`;
  const oldCalendar = await calendar(2025),futureCalendar = await calendar(futureYear);
  const oldPeriod = await period(source.id,oldCalendar.id),draftPeriod = await period(source.id,futureCalendar.id);
  await configure(source.id,oldPeriod.id); await configure(source.id,draftPeriod.id);
  await api("PUT",`${sourceOwn}/registrations/${oldPeriod.id}`,{revision:0,courseIds:[courses[0].id]},student.token);
  await checks(source.id,oldPeriod.id);
  const receipt = await api("POST",`${sourceOwn}/registrations/${oldPeriod.id}/confirm`,{revision:1},student.token);
  expect((await api("GET",sourceBase,undefined,registrar.token)).studyYear).toMatchObject({state:"recorded",yearOfStudy:1,active:true});
  await publish(source.id,oldPeriod.id,receipt);
  const publishedBefore = await api("GET",`${sourceOwn}/results`,undefined,student.token);
  await api("PUT",`${sourceOwn}/registrations/${draftPeriod.id}`,{revision:0,courseIds:[courses[0].id]},student.token);
  await checks(source.id,draftPeriod.id);
  const options = {viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch};
  const staffContext = await browser.newContext(options),reviewContext = await browser.newContext(options);
  const staff = await staffContext.newPage(),reviewer = await reviewContext.newPage();
  for (const current of [page,staff,reviewer]) current.setDefaultTimeout(15_000);
  try {
    await signIn(staff,"registrar@southvalley.test","Kariba-Senate-Approvals-2026!"); await select(staff,source.id);
    await signIn(reviewer,"admin@southvalley.test","Phase1-Admin-Password-2026!"); await select(reviewer,source.id);
    await requestTransfer(source.id,secondIntake.id,destination.version.id);
    let pending = (await context(source.id)).requests[0];
    const registrarMe = await api("GET","/api/identity/me",undefined,registrar.token);
    await api("POST","/api/access/role-assignments",{accountId:registrarMe.account.id,roleCode:"academic_approver",scope:{},reason:"Self-review must remain denied"},admin.token);
    await denied("POST",`${sourceBase}/transfers/${pending.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
    const limited = await account(`transfer.limited.${stamp}@example.com`);
    await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"academic_approver",scope:{programmeCodes:[original.code],intakeIds:[firstIntake.id]},reason:"Source only"},admin.token);
    await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"auditor",scope:{},reason:"Must not widen destination authority"},admin.token);
    await api("POST","/api/access/role-assignments",{accountId:limited.id,roleCode:"student",scope:{},reason:"Exercise owner isolation independently of permission"},admin.token);
    expect((await api("GET",`${sourceBase}/transfers`,undefined,limited.token)).destinations.some((row) => row.intakeId === secondIntake.id)).toBe(false);
    await denied("POST",`${sourceBase}/transfers/${pending.id}/review`,{outcome:"approved",reason:"Wrong destination scope"},limited.token,403);
    await denied("GET",`${sourceOwn}/transfers`,undefined,limited.token,404);
    const ownProfile = (await api("GET","/api/registry/me",undefined,student.token)).profile;
    await api("PUT","/api/registry/me",{...ownProfile,phone:"+263771234569"},student.token);
    await denied("POST",`${sourceBase}/transfers/${pending.id}/review`,{outcome:"approved",reason:"Stale profile"},admin.token,409);
    await reviewTransfer(source.id,pending.id,"rejected");
    await requestTransfer(source.id,secondIntake.id,destination.version.id); pending = (await context(source.id)).requests[0];
    const concurrent = await Promise.all([1,2].map(() => request.post(`${sourceBase}/transfers/${pending.id}/review`,{data:{outcome:"approved",reason:"Independent synthetic transfer authority"},headers:{Authorization:`Bearer ${admin.token}`}})));
    expect(concurrent.map((response) => response.status()).sort()).toEqual([200,409]);
    const arrival = (await context(source.id)).requests[0].targetProgrammeId;
    const current = await api("GET","/api/registry/me",undefined,student.token);
    expect(current.programmes.filter((row) => row.originProgrammeId === source.id)).toHaveLength(1);
    expect(current.programmes.find((row) => row.id === source.id)).toMatchObject({status:"transferred",statusRevision:pending.revision+1,programmeVersionId:original.version.id,intakeId:firstIntake.id});
    expect(current.programmes.find((row) => row.id === arrival)).toMatchObject({status:"onboarded",applicationId:source.applicationId,studentNumber:source.studentNumber,originProgrammeId:source.id});
    const retry = await api("POST",`/api/admissions/review/applications/${source.applicationId}/convert`,{},admin.token);
    expect(retry.studentProgrammeId).toBe(source.id); expect(retry.created).toBe(false);
    expect(await api("POST",`${sourceOwn}/registrations/${oldPeriod.id}/confirm`,{revision:1},student.token)).toEqual(receipt);
    expect(await api("GET",`${sourceOwn}/results`,undefined,student.token)).toEqual(publishedBefore);
    const sourceRegs = await api("GET",`${sourceOwn}/registrations`,undefined,student.token);
    expect(sourceRegs.find((row) => row.period.id === draftPeriod.id).registration.revision).toBe(2);
    await denied("POST",`${sourceOwn}/registrations/${draftPeriod.id}/confirm`,{revision:2},student.token,409);
    expect((await api("GET",`${sourceBase}/lifecycle`,undefined,admin.token)).targets).toEqual([]);
    expect((await api("GET",`/api/registry/me/programmes/${arrival}/credits`,undefined,student.token)).recognitions).toEqual([]);
    expect(await api("GET",`/api/registry/me/programmes/${arrival}/results`,undefined,student.token)).toEqual([]);
    const manifest = await api("GET",`/api/admissions/review/intakes/${firstIntake.id}/manifest`,undefined,admin.token);
    expect(manifest.accepted).toHaveLength(1); expect(manifest.notConverted).toBe(0);
    expect((await api("GET",`/api/admissions/review/intakes/${secondIntake.id}/manifest`,undefined,admin.token))).toMatchObject({placesTaken:1,transferPlaces:1,placesRemaining:0});
    const transferReport = await api('GET',`/api/reports/admissions?intakeId=${secondIntake.id}`,undefined,admin.token);
    expect(transferReport.totals).toMatchObject({applicationsTotal:0,acceptedApplications:0,transferPlaces:1,placesTaken:1,capacity:1,placesRemaining:0,overCapacity:0});
    expect(transferReport.controls).toEqual({applicationsReconcile:true,capacityReconciles:true});
    const sourceReport = await api('GET',`/api/reports/registry?intakeId=${firstIntake.id}`,undefined,admin.token);
    expect(sourceReport.totals).toMatchObject({programmeRecords:1,transferred:1,onboarded:0,registrationRecords:2,draftRegistrations:1,confirmedRegistrations:1,courseEnrolments:1});
    expect(Object.values(sourceReport.controls).every(Boolean)).toBe(true);
    expect((await api('GET',`/api/reports/registry?intakeId=${secondIntake.id}`,undefined,admin.token)).totals).toMatchObject({programmeRecords:1,onboarded:1,registrationRecords:0,courseEnrolments:0});
    const catalogue = await api("GET","/api/admissions/catalogue"); expect(catalogue.find((row) => row.intakeId === secondIntake.id).placesRemaining).toBe(0);
    const other = await account(`transfer.other.${stamp}@example.com`),otherSource = await admit(other,original,firstIntake);
    const otherContext = await context(otherSource.id);
    await denied("POST",`/api/registry/programmes/${otherSource.id}/transfers`,{intakeId:secondIntake.id,programmeVersionId:destination.version.id,revision:otherContext.revision,evidenceHash:otherContext.evidenceHash,reason:"Full destination",evidenceRef:"SAMPLE",expiresOn:day(7)},registrar.token,409);
    await denied("POST","/api/admissions/migrations",{source:`SAMPLE-FULL-TRANSFER-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:"SAMPLE-FULL",accountId:other.id,intakeId:secondIntake.id,state:"Accepted",referenceNumber:`SAMPLE-FULL-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token,409);
    expect((await api("GET",`/api/admissions/review/intakes/${secondIntake.id}/manifest`,undefined,admin.token))).toMatchObject({transferPlaces:1,placesTaken:1,accepted:[],placesRemaining:0});
    await denied("POST",`${sourceBase}/transfers`,{},student.token,403);
    await select(staff,arrival); await select(reviewer,arrival);
    await requestTransfer(arrival,thirdIntake.id,destination.version.id); pending = (await context(arrival)).requests[0]; await reviewTransfer(arrival,pending.id,"approved");
    const next = (await context(arrival)).requests[0].targetProgrammeId;
    const priorVersionPeriod = await period(next,futureCalendar.id);
    const replacementVersion = await version(destination,"Replacement curriculum",courses[1],"2026-01-01");
    await select(staff,next); await select(reviewer,next);
    await requestTransfer(next,thirdIntake.id,replacementVersion.id); pending = (await context(next)).requests[0]; await reviewTransfer(next,pending.id,"approved");
    const finalId = (await context(next)).requests[0].targetProgrammeId;
    expect((await api('GET',`/api/reports/registry?intakeId=${thirdIntake.id}`,undefined,admin.token)).totals).toMatchObject({programmeRecords:2,transferred:1,onboarded:1,unclassifiedProgrammes:0});
    expect((await api("GET",`/api/admissions/review/intakes/${thirdIntake.id}/manifest`,undefined,admin.token))).toMatchObject({transferPlaces:1,placesTaken:1});
    expect((await api('GET',`/api/reports/admissions?intakeId=${thirdIntake.id}`,undefined,admin.token)).totals).toMatchObject({applicationsTotal:0,transferPlaces:1,placesTaken:1,placesRemaining:0});
    await denied("POST",`/api/registry/programmes/${finalId}/registration-periods`,{academicPeriodId:oldCalendar.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"No backdating"},admin.token,409);
    const finalPeriod = await period(finalId,futureCalendar.id); expect(finalPeriod.id).not.toBe(priorVersionPeriod.id);
    const finalOwn = `/api/registry/me/programmes/${finalId}`;
    expect((await api("GET",`${finalOwn}/registrations`,undefined,student.token)).map((row) => row.period.id)).toEqual([finalPeriod.id]);
    expect((await api("GET",`/api/registry/programmes/${finalId}/results`,undefined,admin.token)).periods.map((row) => row.period.id)).toEqual([finalPeriod.id]);
    expect((await api("GET",`/api/registry/programmes/${finalId}/academic`,undefined,admin.token)).contexts.map((row) => row.period.id)).toEqual([finalPeriod.id]);
    const wrongCurriculumRows = [{registrationId:"SAMPLE-WRONG-CURRICULUM",courseId:courses[1].id,mark:75}];
    await denied("POST",`/api/registry/programmes/${finalId}/results/${priorVersionPeriod.id}/batches`,{sourceRef:`SAMPLE-WRONG-CURRICULUM-${stamp}`,rows:wrongCurriculumRows,checksum:resultsChecksum(wrongCurriculumRows),expectedRowCount:1,expectedMarkTotal:75,gpaRuleSetId:"SAMPLE-POLICY",reason:"Wrong curriculum must be rejected before roster import"},admin.token,404);
    await denied("PUT",`${finalOwn}/registrations/${priorVersionPeriod.id}`,{revision:0,courseIds:[courses[1].id]},student.token,404);
    await configure(finalId,finalPeriod.id); await api("PUT",`${finalOwn}/registrations/${finalPeriod.id}`,{revision:0,courseIds:[courses[1].id]},student.token);
    await denied("POST",`${finalOwn}/registrations/${finalPeriod.id}/confirm`,{revision:1},student.token,409);
    await checks(finalId,finalPeriod.id); await api("POST",`${finalOwn}/registrations/${finalPeriod.id}/confirm`,{revision:1},student.token);
    await page.goto("/#apply"); await submit(page.locator('[data-form="signin"]'),{email:student.email,password:student.password});
    await expect(page.locator("[data-student-programme]")).toHaveValue(finalId);
    await expect(page.locator("[data-study-year-level]")).toHaveText("Scheduled");
    const ownProgrammes = (await api("GET","/api/registry/me",undefined,student.token)).programmes;
    expect(ownProgrammes.find((row) => row.id === source.id).studyYear).toMatchObject({yearOfStudy:1,active:false,currentPeriods:[]});
    expect(ownProgrammes.find((row) => row.id === finalId).studyYear).toMatchObject({yearOfStudy:null,state:"scheduled"});
    expect(ownProgrammes.find((row) => row.id === finalId).studyYear.history).toHaveLength(1);
    await expect(page.locator(".student-transfers")).toContainText("approved");
    await page.locator("[data-student-programme]").selectOption(source.id); await expect(page.locator(".student-results")).toContainText("75");
    await expect(page.locator("[data-study-year-level]")).toHaveText("Year 1 - transferred");
    await page.locator("[data-student-programme]").selectOption(finalId); await expect(page.locator("[data-student-programme]")).toHaveValue(finalId);
    await expect(page.locator(".student-results")).toContainText("No published results");
    await select(reviewer,finalId); await reviewer.locator("[data-transfer-history] summary").click();
    await reviewer.getByRole("button",{name:"Open source record",exact:true}).click(); await expect(reviewer.locator("[data-transfer-refresh]")).toBeEnabled();
    await reviewer.locator("[data-transfer-history] summary").click();
    await reviewer.locator(`[data-transfer-target="${finalId}"]`).click(); await expect(reviewer.locator("[data-transfer-refresh]")).toBeEnabled();
    await reviewer.locator("[data-transfer-history] summary").click();
    for (const current of [page,reviewer]) {
      expect(await current.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(current.viewportSize().width);
      await current.evaluate(() => {document.documentElement.style.scrollBehavior = "auto";window.scrollTo({top:0,left:0,behavior:"instant"});});
      await expect.poll(() => current.evaluate(() => scrollY)).toBe(0);
      const heading = await current.locator("#app h1").boundingBox(),navigation = await current.locator(".top-nav").boundingBox();
      expect(heading.y).toBeGreaterThanOrEqual(navigation.y+navigation.height);
    }
    await page.screenshot({path:info.outputPath("transferred-student.png"),fullPage:true}); await reviewer.screenshot({path:info.outputPath("transferred-staff.png"),fullPage:true});
  } finally {await staffContext.close();await reviewContext.close();}

  async function context(id) {return api("GET",`/api/registry/programmes/${id}/transfers`,undefined,registrar.token);}
  async function requestTransfer(id,intakeId,programmeVersionId) {
    await staff.locator("[data-transfer-refresh]").click(); await expect(staff.locator("[data-transfer-refresh]")).toBeEnabled();
    const options = (await context(id)).destinations,index = options.findIndex((row) => row.intakeId === intakeId && row.programmeVersionId === programmeVersionId);expect(index).toBeGreaterThanOrEqual(0);
    const form = staff.locator("[data-transfer-request]");if (!await form.isVisible()) await form.locator("..").locator("summary").click();
    await submit(form,{destination:String(index),reason:"Synthetic reviewed programme/intake/curriculum change",evidenceRef:"SAMPLE-TRANSFER",expiresOn:day(7)});await expect(staff.getByRole("status")).toHaveText("Transfer requested.");
  }
  async function reviewTransfer(id,requestId,outcome) {await reviewer.locator("[data-transfer-refresh]").click();await expect(reviewer.locator("[data-transfer-refresh]")).toBeEnabled();await submit(reviewer.locator(`[data-transfer-review="${requestId}"]`),{outcome,reason:"Independent synthetic transfer authority"});await expect(reviewer.getByRole("status")).toHaveText("Transfer reviewed.");}
  async function signIn(current,email,password) {await current.goto("/#registry");await submit(current.locator("[data-registry-login]"),{email,password});await expect(current.locator("[data-registry-filter]")).toBeVisible();}
  async function select(current,id) {await current.locator('[data-registry-filter] button').click();await current.locator(`[data-registry-detail="${id}"]`).click();await expect(current.locator("[data-transfer-refresh]")).toBeEnabled();}
  async function programme(label,course) {const p = await api("POST","/api/master-data/programmes",{code:`TR-${label}-${stamp}`,name:`SAMPLE transfer ${label} ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);p.version = await version(p,"Original curriculum",course,"2024-01-01");return p;}
  async function version(p,label,course,effectiveFrom) {const v = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:label,effectiveFrom},admin.token);await api("POST",`/api/master-data/programme-versions/${v.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);await api("POST",`/api/master-data/programme-versions/${v.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);return v;}
  async function intake(p,label,capacity) {const i = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE transfer ${label} ${stamp}`,capacity,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);await api("POST",`/api/master-data/intakes/${i.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);return i;}
  async function admit(student,p,i) {await api("POST","/api/admissions/migrations",{source:`SAMPLE-TRANSFER-${stamp}-${student.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${student.id}`,accountId:student.id,intakeId:i.id,state:"Accepted",referenceNumber:`SAMPLE-${stamp}-${student.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);const me = await api("GET","/api/registry/me",undefined,student.token);if (!me.profile.revision) await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},student.token);const sp = me.programmes.find((row) => row.intakeId === i.id);await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);return sp;}
  async function calendar(year) {const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${year}-01-01` && row.endsOn === `${year}-12-31`);if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`TR-Y-${year}-${stamp}`,name:`SAMPLE transfer ${year}`,periodType:"academic_year",startsOn:`${year}-01-01`,endsOn:`${year}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}let term = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${year}-02-01` && row.endsOn === `${year}-06-30`);if (!term) {term = await api("POST","/api/master-data/academic-periods",{code:`TR-S-${year}-${stamp}`,name:`SAMPLE transfer ${year} S1`,periodType:"semester",parentId:parent.id,startsOn:`${year}-02-01`,endsOn:`${year}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${term.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}return term;}
  async function period(id,academicPeriodId) {return api("POST",`/api/registry/programmes/${id}/registration-periods`,{academicPeriodId,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);}
  async function configure(id,periodId) {const base = `/api/registry/programmes/${id}`,ctx = (await api("GET",`${base}/registrations`,undefined,admin.token)).find((row) => row.period.id === periodId);await api("POST",`${base}/registration-periods/${periodId}`,{offerings:ctx.offerings.map((row) => ({courseId:row.courseId,delivery:"asynchronous",meetings:[]})),reason:"Synthetic delivery"},admin.token);await api("POST",`${base}/registration-periods/${periodId}`,{toStatus:"open",reason:"Synthetic window"},admin.token);}
  async function checks(id,periodId) {for (const checkType of ["academic","financial"]) await api("POST",`/api/registry/programmes/${id}/registrations/${periodId}/checks`,{revision:1,checkType,outcome:"eligible",reason:"Fresh clearance, not inherited through transfer",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);}
  async function publish(id,periodId,receipt) {const code = `transfer_${stamp.replaceAll(".","_")}`,scheme = await api("POST","/api/master-data/grading-schemes",{code,name:"SAMPLE transfer grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:100,grade:"A",points:4,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic grades"},registrar.token);const gpa = await api("POST","/api/master-data/gpa-rule-sets",{code,name:"SAMPLE transfer GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"X",credits:15,mark:75}],expectedGpa:4,expectedClassification:"Pass"}]},admin.token);await api("POST",`/api/master-data/gpa-rule-sets/${gpa.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic GPA"},registrar.token);const base = `/api/registry/programmes/${id}`;await api("POST",`${base}/registration-periods/${periodId}`,{toStatus:"closed",reason:"Synthetic completed semester"},admin.token);const sr = (await api("GET",`${base}/registrations`,undefined,admin.token)).find((row) => row.period.id === periodId).registration,rows = receipt.courses.map((row) => ({registrationId:sr.id,courseId:row.courseId,mark:75}));const batch = await api("POST",`${base}/results/${periodId}/batches`,{sourceRef:`SAMPLE-${periodId}`,rows,checksum:resultsChecksum(rows),expectedRowCount:rows.length,expectedMarkTotal:75*rows.length,gpaRuleSetId:gpa.id,reason:"Synthetic original results"},registrar.token);await api("POST",`${base}/results/${periodId}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-MODERATION",reason:"Independent result review"},admin.token);await api("POST",`${base}/results/${periodId}/batches/${batch.id}/publish`,{reason:"Publish actual original marks"},admin.token);}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === "SELECT")) await field.selectOption(String(value));else await field.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Transfer",legalName:`Transfer Student ${stamp}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),"utf8"))));const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Transfer",legalName:`Transfer Student ${stamp}`});const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);return {email,password,token:session.token,id:me.account.id};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
