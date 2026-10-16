import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";

test("independent credit recognition satisfies courses without inventing grades",async ({page,browser,request},info) => {
  test.setTimeout(480_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "CXD" : "CXM";
  const targetYear = info.project.name === "desktop" ? 2047 : 2050;
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const student = await account(`credit.student.${stamp}@example.com`);
  const courses = [];
  for (const [suffix,title,level] of [["100","Source foundations",1],["101","Mapped foundations",1],["102","Recognized core",1],["103","Graded practice",1],["104","Applied foundations",1],["201","Advanced core",2]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}${suffix}`,title,credits:15,level,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  for (const [advanced,prior] of [[4,1],[5,2]]) await api("PUT",`/api/master-data/courses/${courses[advanced].id}/prerequisites`,{prerequisiteCourseIds:[courses[prior].id],reason:"Synthetic recognized prerequisite"},admin.token);
  const source = await programme("Source",[{index:0,year:1,term:"S1",type:"core"}],"2025-01-01");
  const target = await programme("Target",[{index:1,year:1,term:"S1",type:"core"},{index:2,year:1,term:"S1",type:"core"},{index:3,year:1,term:"S1",type:"elective"},{index:4,year:1,term:"S2",type:"core"},{index:5,year:2,term:"S1",type:"core"}],`${targetYear}-01-01`);
  const code = `credit_${stamp.replaceAll(".","_")}`;
  const scheme = await api("POST","/api/master-data/grading-schemes",{code,name:"SAMPLE credit GPA grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic grading"},registrar.token);
  const gpa = await api("POST","/api/master-data/gpa-rule-sets",{code,name:"SAMPLE recognized-credit GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"W",credits:15,mark:75}],expectedGpa:4,expectedClassification:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/gpa-rule-sets/${gpa.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic graded GPA verified"},registrar.token);
  const sourcePeriod = await period(source,2025,"S1",1);
  const sourceReceipt = await register(source,sourcePeriod,[courses[0].id]);
  await publishResults(source,sourcePeriod,gpa.id,sourceReceipt);
  const targetPeriods = [await period(target,targetYear,"S1",1),await period(target,targetYear,"S2",1),await period(target,targetYear+1,"S1",2)];
  const policy = await api("POST",`${target.base}/academic/policies`,{code,name:"SAMPLE credit recognition permitted",gpaRuleSetId:gpa.id,rules:{minGpa:2,minPassedCredits:60,maxFailedCredits:0,maxOutstandingCoreCourses:0,maxAttempts:2,allowPassedRetake:false,recognisedCredits:true},reason:"Synthetic recognition rules; institutional sign-off remains gated"},registrar.token);
  await api("POST",`${target.base}/academic/policies/${policy.id}/publish`,{effectiveFrom:"2024-01-01",evidenceRef:"SAMPLE-POLICY",reason:"Independent synthetic recognition policy"},admin.token);
  for (const p of targetPeriods) await api("POST",`${target.base}/registration-periods/${p.id}`,{academicPolicyId:policy.id,reason:"Attach explicit synthetic recognition policy"},admin.token);
  const options = {viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch};
  const staffContext = await browser.newContext(options),reviewContext = await browser.newContext(options);
  const staff = await staffContext.newPage(),reviewer = await reviewContext.newPage();
  const sourceReg = (await registrations(source)).find((row) => row.period.id === sourcePeriod.id).registration.id;
  const transferSource = {registrationId:sourceReg,courseId:courses[0].id};
  const externalSource = {institution:"SAMPLE prior institution",course:"SAMPLE verified course",reference:`SAMPLE-EXTERNAL-${stamp}`,credits:15,completedOn:"2024-06-01"};
  try {
    await signIn(staff,"registrar@southvalley.test","Kariba-Senate-Approvals-2026!");
    await staff.locator(`[data-registry-detail="${target.sp.id}"]`).click();
    await signIn(reviewer,"admin@southvalley.test","Phase1-Admin-Password-2026!");
    await reviewer.locator(`[data-registry-detail="${target.sp.id}"]`).click();
    const registrarMe = await api("GET","/api/identity/me",undefined,registrar.token);
    await api("POST","/api/access/role-assignments",{accountId:registrarMe.account.id,roleCode:"academic_approver",scope:{},reason:"Self-review must remain forbidden"},admin.token);
    await requestCredit("internal_transfer",courses[1].id);
    let context = await credits(); const first = context.recognitions[0];
    await denied("POST",`${target.base}/credits/${first.id}/review`,{outcome:"approved",reason:"Self review"},registrar.token,403);
    const wrong = await account(`credit.wrong.${stamp}@example.com`),wrongMe = await api("GET","/api/identity/me",undefined,wrong.token);
    for (const role of [{roleCode:"academic_approver",scope:{programmeCodes:[target.programme.code],intakeIds:[target.intake.id]}},{roleCode:"auditor",scope:{}},{roleCode:"student",scope:{}}]) await api("POST","/api/access/role-assignments",{accountId:wrongMe.account.id,...role,reason:"Source-specific permission scope"},admin.token);
    expect((await api("GET",`${target.base}/credits`,undefined,wrong.token)).sources).toHaveLength(0);
    await denied("POST",`${target.base}/credits/${first.id}/review`,{outcome:"approved",reason:"Target scope must not widen source authority"},wrong.token,403);
    await denied("GET",`${target.own}/credits`,undefined,wrong.token,404);
    await denied("POST",`${target.base}/credits`,{courseId:courses[1].id,policyId:policy.id,kind:"internal_transfer",source:transferSource,evidenceRef:"OWNER",expiresOn:day(7),reason:"Student cannot award credit"},student.token,403);
    await reviewCredit(first.id,"approved");
    await reviewCredit(first.id,"revoked");
    await refresh(staff); await requestCredit("internal_transfer",courses[1].id);
    context = await credits(); const transfer = context.recognitions[0]; await reviewCredit(transfer.id,"approved");
    await denied("POST",`${target.base}/credits`,{courseId:courses[3].id,policyId:policy.id,kind:"internal_transfer",source:transferSource,evidenceRef:"REUSE",expiresOn:day(7),reason:"No duplicate source credit"},registrar.token,409);
    await denied("POST",`${target.base}/credits`,{courseId:courses[2].id,policyId:policy.id,kind:"external_transfer",source:{...externalSource,mark:75},evidenceRef:"MARK",expiresOn:day(7),reason:"No imported invented grade"},registrar.token,400);
    await refresh(staff); await requestCredit("external_transfer",courses[2].id);
    context = await credits(); await reviewCredit(context.recognitions[0].id,"rejected");
    await refresh(staff); await requestCredit("exemption",courses[2].id);
    context = await credits(); const exemption = context.recognitions[0]; await reviewCredit(exemption.id,"approved");
    await configure(target,targetPeriods[0]);
    await page.goto("/#apply"); await submit(page.locator('[data-form="signin"]'),{email:student.email,password:student.password});
    for (const index of [1,2]) await expect(page.locator(`[data-form="course-selection"][data-period="${targetPeriods[0].id}"] [value="${courses[index].id}"]`)).toBeDisabled();
    await api("PUT",`${target.own}/registrations/${targetPeriods[0].id}`,{revision:0,courseIds:[courses[3].id,courses[1].id]},student.token);
    expect((await registrations(target))[0].eligibility.blockers.some((row) => row.code === "RECOGNISED_COURSE")).toBe(true);
    await api("PUT",`${target.own}/registrations/${targetPeriods[0].id}`,{revision:1,courseIds:[courses[3].id]},student.token);
    await clearances(target,targetPeriods[0],2);
    const registered = await api("POST",`${target.own}/registrations/${targetPeriods[0].id}/confirm`,{revision:2},student.token);
    expect(registered.academicEvidence.recognitions.map((row) => row.id).sort()).toEqual([transfer.id,exemption.id].sort());
    await denied("POST",`${target.base}/credits/${transfer.id}/review`,{outcome:"revoked",reason:"Used credit needs formal correction"},admin.token,409);
    await denied("POST",`${target.base}/credits`,{courseId:courses[3].id,policyId:policy.id,kind:"exemption",source:{...externalSource,reference:"SAMPLE-ATTEMPTED"},evidenceRef:"ATTEMPTED",expiresOn:day(7),reason:"Cannot mask unrecorded result"},registrar.token,409);
    await publishResults(target,targetPeriods[0],gpa.id,registered);
    await configure(target,targetPeriods[1]);
    const second = await register(target,targetPeriods[1],[courses[4].id]);
    expect(second.academicEvidence.recognitions.some((row) => row.id === transfer.id)).toBe(true);
    await publishResults(target,targetPeriods[1],gpa.id,second);
    const academic = await api("GET",`${target.base}/academic`,undefined,registrar.token),progress = academic.contexts.find((row) => row.period.id === targetPeriods[2].id);
    expect(progress.progression).toMatchObject({ready:true,gpa:4,passedCredits:60,recognisedCredits:30,outstandingCoreCourses:0});
    await configure(target,targetPeriods[2]);
    await api("PUT",`${target.own}/registrations/${targetPeriods[2].id}`,{revision:0,courseIds:[courses[5].id]},student.token);
    await refresh(staff);
    await submit(staff.locator(`[data-academic-request="${targetPeriods[2].id}"]`),{decision:"progression",evidenceRef:"SAMPLE-RECOGNIZED-PROGRESSION",expiresOn:day(7),reason:"Synthetic progression using retained recognized credit and graded GPA"});
    await expect(staff.getByRole("status")).toHaveText("Academic decision requested.");
    const decisions = await api("GET",`${target.base}/academic`,undefined,registrar.token),decision = decisions.contexts.find((row) => row.period.id === targetPeriods[2].id).decisions[0];
    await refresh(reviewer);
    await submit(reviewer.locator(`[data-academic-review="${decision.id}"]`),{outcome:"approved",reason:"Independent synthetic recognized-credit progression review"});
    await expect(reviewer.getByRole("status")).toHaveText("Academic decision reviewed.");
    await clearances(target,targetPeriods[2],1);
    const third = await api("POST",`${target.own}/registrations/${targetPeriods[2].id}/confirm`,{revision:1},student.token);
    expect(third.academicEvidence.progression.id).toBe(decision.id);
    expect(third.academicEvidence.progression.assessment).toMatchObject({gpa:4,passedCredits:60,recognisedCredits:30});
    expect(third.academicEvidence.recognitions.map((row) => row.id).sort()).toEqual([transfer.id,exemption.id].sort());
    const resultView = await api("GET",`${target.own}/results`,undefined,student.token);
    expect(resultView).toHaveLength(2); expect(resultView.every((row) => row.gpa === 4 && row.results.length === 1)).toBe(true);
    expect((await api("GET",`${target.own}/credits`,undefined,student.token)).recognitions[0]).not.toHaveProperty("sourceSnapshot");
    await page.reload();
    await expect(page.locator(".student-credits")).toContainText("GPA excluded");
    await refresh(reviewer); await reviewer.locator("[data-credit-history] summary").click();
    for (const current of [page,reviewer]) {expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await current.evaluate(() => scrollTo(0,0));}
    await page.screenshot({path:info.outputPath("recognized-student.png"),fullPage:true});
    await reviewer.screenshot({path:info.outputPath("recognized-staff.png"),fullPage:true});
  } finally {await staffContext.close();await reviewContext.close();}

  async function requestCredit(kind,courseId) {
    const form = staff.locator("[data-credit-request]"); if (!await form.isVisible()) await form.locator("..").locator("summary").click();
    await form.locator('[name="kind"]').selectOption(kind);
    await submit(form,{courseId,policyId:policy.id,...(kind === "internal_transfer" ? {internalSource:"0"} : {institution:externalSource.institution,course:externalSource.course,reference:externalSource.reference,credits:"15",completedOn:externalSource.completedOn}),evidenceRef:"SAMPLE-RECOGNITION",expiresOn:day(7),reason:"Synthetic independently verified one-to-one recognition"});
    await expect(staff.getByRole("status")).toHaveText("Credit recognition requested.");
  }
  async function reviewCredit(id,outcome) {await refresh(reviewer); const history = reviewer.locator("[data-credit-history]"); if (!await reviewer.locator(`[data-credit-review="${id}"]`).isVisible()) await history.locator("summary").click(); await submit(reviewer.locator(`[data-credit-review="${id}"]`),{outcome,reason:"Independent synthetic equivalence review"}); await expect(reviewer.getByRole("status")).toHaveText("Credit recognition reviewed.");}
  async function refresh(current) {await current.locator("[data-credit-refresh]").click(); await expect(current.locator("[data-credit-refresh]")).toBeEnabled();}
  async function credits() {return api("GET",`${target.base}/credits`,undefined,registrar.token);}
  async function programme(label,entries,startsOn) {
    const p = await api("POST","/api/master-data/programmes",{code:`CR-${label}-${stamp}`,name:`SAMPLE credit ${label} ${stamp}`,departmentId:"dept_computing"},admin.token);
    const version = await api("POST",`/api/master-data/programmes/${p.id}/versions`,{versionLabel:"Synthetic credit pilot",effectiveFrom:"2024-01-01"},admin.token);
    for (const row of entries) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:courses[row.index].id,yearOfStudy:row.year,term:row.term,requirementType:row.type},admin.token);
    await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Synthetic independently checked curriculum"},registrar.token);
    const intake = await api("POST","/api/master-data/intakes",{programmeId:p.id,label:`SAMPLE credit ${label} ${stamp}`,capacity:5,startsOn,applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
    await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
    const me = await api("GET","/api/identity/me",undefined,student.token);
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-CREDIT-${label}-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${label}`,accountId:me.account.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-${label}-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const own = await api("GET","/api/registry/me",undefined,student.token),sp = own.programmes.find((row) => row.intakeId === intake.id);
    if (!own.profile.revision) await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"3 Park Lane",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},student.token);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic complete identity/profile"},admin.token);
    return {programme:p,intake,version,sp,base:`/api/registry/programmes/${sp.id}`,own:`/api/registry/me/programmes/${sp.id}`};
  }
  async function period(programme,year,term,studyYear) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${year}-01-01` && row.endsOn === `${year}-12-31`);
    if (!parent) {
      parent = await api("POST","/api/master-data/academic-periods",{code:`CR-Y-${year}-${programme.programme.id}`,name:`SAMPLE credit ${year}`,periodType:"academic_year",startsOn:`${year}-01-01`,endsOn:`${year}-12-31`},admin.token);
      await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);
    }
    const startsOn = `${year}-${term === "S1" ? "02-01" : "07-01"}`,endsOn = `${year}-${term === "S1" ? "06-30" : "12-31"}`;
    let calendar = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === startsOn && row.endsOn === endsOn);
    if (!calendar) {
      calendar = await api("POST","/api/master-data/academic-periods",{code:`CR-S-${year}-${term}-${programme.programme.id}`,name:`SAMPLE credit ${year} ${term}`,periodType:"semester",parentId:parent.id,startsOn,endsOn,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);
      await api("POST",`/api/master-data/academic-periods/${calendar.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);
    }
    return api("POST",`${programme.base}/registration-periods`,{academicPeriodId:calendar.id,yearOfStudy:studyYear,term,creditLimit:60,reason:"Synthetic credit registration"},admin.token);
  }
  async function configure(programme,p) {const context = (await registrations(programme)).find((row) => row.period.id === p.id); await api("POST",`${programme.base}/registration-periods/${p.id}`,{offerings:context.offerings.map((row) => ({courseId:row.courseId,delivery:"asynchronous",meetings:[]})),reason:"Synthetic asynchronous delivery"},admin.token);await api("POST",`${programme.base}/registration-periods/${p.id}`,{toStatus:"open",reason:"Synthetic open registration"},admin.token);}
  async function register(programme,p,ids) {if ((await registrations(programme)).find((row) => row.period.id === p.id).period.status === "planning") await configure(programme,p); await api("PUT",`${programme.own}/registrations/${p.id}`,{revision:0,courseIds:ids},student.token);await clearances(programme,p,1);return api("POST",`${programme.own}/registrations/${p.id}/confirm`,{revision:1},student.token);}
  async function clearances(programme,p,revision) {for (const checkType of ["academic","financial"]) await api("POST",`${programme.base}/registrations/${p.id}/checks`,{revision,checkType,outcome:"eligible",reason:"Synthetic clearance, not waived by recognition",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);}
  async function registrations(programme) {return api("GET",`${programme.own}/registrations`,undefined,student.token);}
  async function publishResults(programme,p,gpaId,receipt) {await api("POST",`${programme.base}/registration-periods/${p.id}`,{toStatus:"closed",reason:"Close synthetic enrolled period"},admin.token); const reg = (await registrations(programme)).find((row) => row.period.id === p.id).registration.id; const rows = receipt.courses.map((row) => ({registrationId:reg,courseId:row.courseId,mark:75})); const batch = await api("POST",`${programme.base}/results/${p.id}/batches`,{sourceRef:`SAMPLE-${p.id}`,rows,expectedRowCount:rows.length,expectedMarkTotal:75*rows.length,checksum:resultsChecksum(rows),gpaRuleSetId:gpaId,reason:"Synthetic actual enrolled-course marks"},registrar.token);await api("POST",`${programme.base}/results/${p.id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-MODERATION",reason:"Independent synthetic result controls"},admin.token);await api("POST",`${programme.base}/results/${p.id}/batches/${batch.id}/publish`,{reason:"Publish synthetic enrolled-course marks"},admin.token);}
  async function signIn(current,email,password) {await current.goto("/#registry");await submit(current.locator("[data-registry-login]"),{email,password});await expect(current.locator("[data-registry-filter]")).toBeVisible();}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`);if (await field.evaluate((el) => el.tagName === "SELECT")) await field.selectOption(String(value));else await field.fill(String(value));}await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email) {const password = "Kariba-Dam-Applicant-2026!";await api("POST","/api/admissions/registrations",{email,preferredName:"Credit",legalName:`Credit Student ${stamp}`});const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),"utf8")))); const token = messages.find((row) => row.recipientEmail === email).variables.activationToken;await api("POST","/api/identity/activations",{token,password,preferredName:"Credit",legalName:`Credit Student ${stamp}`});const session = await api("POST","/api/identity/sessions",{email,password});return {email,password,token:session.token};}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
