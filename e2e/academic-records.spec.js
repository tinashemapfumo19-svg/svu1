import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resultsChecksum } from "../server/modules/results.js";

test("published results govern prerequisites, progression and revision-bound repeats",async ({page,browser,request},testInfo) => {
  test.setTimeout(600_000);
  const stamp = `${testInfo.project.name}.${Date.now()}`,prefix = testInfo.project.name === "desktop" ? "ADP" : "AMP",year = testInfo.project.name === "desktop" ? 2040 : 2043;
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const programme = await api("POST","/api/master-data/programmes",{code:`ACA-${prefix}-${Date.now()}`,name:`Academic pilot ${stamp}`,departmentId:"dept_computing"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Synthetic progression pilot",effectiveFrom:"2026-01-01"},admin.token);
  const courses = [];
  for (const [suffix,title,level] of [["101","Foundations",1],["102","Core methods",1],["201","Advanced foundations",2],["202","Advanced methods",2]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}${suffix}`,title,credits:15,level,departmentId:"dept_computing",effectiveFrom:"2026-01-01"},admin.token));
  for (const [advanced,prior] of [[2,0],[3,1]]) await api("PUT",`/api/master-data/courses/${courses[advanced].id}/prerequisites`,{prerequisiteCourseIds:[courses[prior].id],reason:"Synthetic ordered prerequisite"},admin.token);
  for (let index = 0; index < courses.length; index++) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:courses[index].id,yearOfStudy:index < 2 ? 1 : 2,term:"S1",requirementType:index === 3 ? "elective" : "core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Synthetic ordered curriculum independently checked"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`Academic pilot ${stamp}`,capacity:5,startsOn:`${year}-02-01`,applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic cohort"},admin.token);
  const student = await account(`academic.student.${stamp}@example.com`);
  const studentMe = await api("GET","/api/identity/me",undefined,student.token);
  await api("POST","/api/admissions/migrations",{source:`SAMPLE-ACADEMIC-${stamp}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:"SAMPLE-STUDENT",accountId:studentMe.account.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-${stamp}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
  const ownStudent = await api("GET","/api/registry/me",undefined,student.token),sp = ownStudent.programmes[0],base = `/api/registry/programmes/${sp.id}`,own = `/api/registry/me/programmes/${sp.id}`;
  await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"2 Park Lane",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},student.token);
  await api("POST",`${base}/approve`,{identityConfirmed:true,reason:"Synthetic accepted identity confirmed"},admin.token);
  const periods = [];
  for (let offset = 0; offset < 3; offset++) {
    const y = year + offset;
    const calendarYear = await api("POST","/api/master-data/academic-periods",{code:`ACA-Y-${stamp}-${offset}`,name:`Academic pilot ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);
    await api("POST",`/api/master-data/academic-periods/${calendarYear.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);
    const semester = await api("POST","/api/master-data/academic-periods",{code:`ACA-S-${stamp}-${offset}`,name:`Academic semester ${y}`,periodType:"semester",parentId:calendarYear.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);
    await api("POST",`/api/master-data/academic-periods/${semester.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);
    const registration = await api("POST",`${base}/registration-periods`,{academicPeriodId:semester.id,yearOfStudy:offset ? 2 : 1,term:"S1",creditLimit:offset ? 25 : 45,reason:"Synthetic registration"},admin.token);
    periods.push({...registration,calendarId:semester.id});
  }
  await configure(periods[0].id);
  await api("PUT",`${own}/registrations/${periods[0].id}`,{revision:0,courseIds:courses.slice(0,2).map((row) => row.id)},student.token);
  await clearance(periods[0].id,1);
  const first = await api("POST",`${own}/registrations/${periods[0].id}/confirm`,{revision:1},student.token);
  await api("POST",`${base}/registration-periods/${periods[0].id}`,{toStatus:"closed",reason:"Finish synthetic source registration"},admin.token);
  await denied("PATCH",`/api/master-data/academic-periods/${periods[0].calendarId}`,{startsOn:`${year}-01-31`,reason:"Do not rewrite enrolled academic history"},admin.token,409);
  const gradingCode = `ac_${stamp.replaceAll(".","_")}`;
  const scheme = await api("POST","/api/master-data/grading-schemes",{code:gradingCode,name:"Synthetic progression grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2026-01-01",reason:"Synthetic grading"},registrar.token);
  const gpa = await api("POST","/api/master-data/gpa-rule-sets",{code:gradingCode,name:"Synthetic progression GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",excludeGrades:[],includeFailed:true,rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"A",credits:15,mark:75},{courseCode:"B",credits:15,mark:25}],expectedGpa:2,expectedClassification:"Pass"}]},admin.token);
  await api("POST",`/api/master-data/gpa-rule-sets/${gpa.id}/publish`,{effectiveFrom:"2026-01-01",reason:"Synthetic weighted sample verified"},registrar.token);
  const contextOptions = {viewport:testInfo.project.use.viewport,isMobile:testInfo.project.use.isMobile,hasTouch:testInfo.project.use.hasTouch};
  const registrarContext = await browser.newContext(contextOptions);
  const staff = await registrarContext.newPage();
  const adminContext = await browser.newContext(contextOptions);
  const approver = await adminContext.newPage();
  try {
    await signInRegistry(staff,"registrar@southvalley.test","Kariba-Senate-Approvals-2026!");
    await staff.locator(`[data-registry-detail="${sp.id}"]`).click();
    await staff.locator("details").filter({has:staff.locator("[data-academic-policy]")}).locator("summary").click();
    await submit(staff.locator("[data-academic-policy]"),{code:gradingCode,name:"SAMPLE conditional progression",gpaRuleSetId:gpa.id,minGpa:"2",minPassedCredits:"15",maxFailedCredits:"15",maxOutstandingCoreCourses:"1",maxAttempts:"2",reason:"Synthetic thresholds only; institutional approval remains gated"});
    await expect(staff.getByRole("status")).toHaveText("Academic policy drafted.");
    let academic = await api("GET",`${base}/academic`,undefined,registrar.token),policy = academic.policies.find((row) => row.code === gradingCode);
    const registrarMe = await api("GET","/api/identity/me",undefined,registrar.token);
    await api("POST","/api/access/role-assignments",{accountId:registrarMe.account.id,roleCode:"academic_approver",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Self-approval must still be denied"},admin.token);
    await denied("POST",`${base}/academic/policies/${policy.id}/publish`,{effectiveFrom:"2026-01-01",evidenceRef:"SELF",reason:"Self approval"},registrar.token,403);
    await signInRegistry(approver,"admin@southvalley.test","Phase1-Admin-Password-2026!");
    await approver.locator(`[data-registry-detail="${sp.id}"]`).click();
    await submit(approver.locator(`[data-academic-publish="${policy.id}"]`),{effectiveFrom:"2026-01-01",evidenceRef:`SAMPLE-POLICY-${stamp}`,reason:"Synthetic maker-checker publication"});
    await expect(approver.getByRole("status")).toHaveText("Academic policy published.");
    await refresh(staff);
    const setup = staff.locator(`[data-academic-setup="${periods[1].id}"]`);
    await staff.locator("details").filter({has:setup}).locator("summary").click();
    await setup.locator(`[name="repeatCourseIds"][value="${courses[1].id}"]`).check();
    await submit(setup,{academicPolicyId:policy.id,reason:"Offer the failed source course as an optional repeat"});
    await expect(staff.getByRole("status")).toHaveText("Academic setup saved.");
    await configure(periods[1].id);
    const selected = [courses[2].id,courses[1].id];
    await api("PUT",`${own}/registrations/${periods[1].id}`,{revision:0,courseIds:selected},student.token);
    await clearance(periods[1].id,1);
    let target = await registration(periods[1].id);
    expect(target.offerings.find((row) => row.courseId === courses[1].id).requirementType).toBe("repeat");
    expect(target.eligibility.blockers.map((row) => row.code)).toEqual(expect.arrayContaining(["PREREQUISITE_EVIDENCE","PROGRESSION_APPROVAL","REPEAT_EVIDENCE"]));
    await denied("POST",`${own}/registrations/${periods[1].id}/confirm`,{revision:1},student.token,409);
    const sourceRegistrationId = (await registration(periods[0].id)).registration.id;
    const rows = first.courses.map((row) => ({registrationId:sourceRegistrationId,courseId:row.courseId,mark:row.courseId === courses[0].id ? 75 : 25}));
    const batch = await api("POST",`${base}/results/${periods[0].id}/batches`,{sourceRef:`SAMPLE-PROGRESSION-${stamp}`,rows,expectedRowCount:2,expectedMarkTotal:100,checksum:resultsChecksum(rows),gpaRuleSetId:gpa.id,reason:"Synthetic pass and fail result evidence"},registrar.token);
    await api("POST",`${base}/results/${periods[0].id}/batches/${batch.id}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-MODERATION",reason:"Independent synthetic evidence reconciliation"},admin.token);
    await api("POST",`${base}/results/${periods[0].id}/batches/${batch.id}/publish`,{reason:"Release verified synthetic evidence"},admin.token);
    target = await registration(periods[1].id);
    expect(target.eligibility.blockers.some((row) => row.code === "PREREQUISITE_EVIDENCE")).toBe(false);
    await api("PUT",`${own}/registrations/${periods[1].id}`,{revision:1,courseIds:[...selected,courses[3].id]},student.token);
    expect((await registration(periods[1].id)).eligibility.blockers.some((row) => row.code === "PREREQUISITE_EVIDENCE")).toBe(true);
    // A prerequisite waiver for that one course, independently approved, clears only its prerequisite blocker.
    const waiverContext = await registration(periods[1].id),waiverPath = `${base}/registrations/${periods[1].id}/exceptions`;
    const waiverBody = {kind:"prerequisite_waiver",parameters:{courseId:courses[3].id},revision:2,evidenceHash:waiverContext.exceptionEvidenceHash,evidenceRef:`SAMPLE-WAIVER-${stamp}`,expiresOn:day(7),reason:"Equivalent prior learning confirmed by the department"};
    await denied("POST",waiverPath,{...waiverBody,parameters:{courseId:courses[2].id}},registrar.token,409);
    const waiver = await api("POST",waiverPath,waiverBody,registrar.token);
    await denied("POST",`${waiverPath}/${waiver.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
    await api("POST",`${waiverPath}/${waiver.id}/review`,{outcome:"approved",reason:"Department evidence checked"},admin.token);
    expect((await registration(periods[1].id)).eligibility.blockers.some((row) => row.code === "PREREQUISITE_EVIDENCE")).toBe(false);
    // Late registration: a dated window extension within 30 days of the close, independently approved, then revoked.
    const windowEnd = waiverContext.period.windows.registration[1],plusDays = (date,n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0,10);
    const extensionPath = `${base}/registrations/${periods[1].id}/extensions`;
    await denied("POST",extensionPath,{until:windowEnd,reason:"Not after the window",evidenceRef:"SAMPLE"},registrar.token,400);
    await denied("POST",extensionPath,{until:plusDays(windowEnd,31),reason:"Too long",evidenceRef:"SAMPLE"},registrar.token,400);
    const extension = await api("POST",extensionPath,{until:plusDays(windowEnd,5),reason:"Hospitalised during registration",evidenceRef:`SAMPLE-MEDICAL-${stamp}`},registrar.token);
    await denied("POST",extensionPath,{until:plusDays(windowEnd,6),reason:"Duplicate",evidenceRef:"SAMPLE"},registrar.token,409);
    await denied("POST",`${extensionPath}/${extension.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
    await api("POST",`${extensionPath}/${extension.id}/review`,{outcome:"approved",reason:"Medical certificate verified"},admin.token);
    expect((await registration(periods[1].id)).extensions[0]).toMatchObject({status:"approved",until:plusDays(windowEnd,5)});
    await api("POST",`${extensionPath}/${extension.id}/review`,{outcome:"revoked",reason:"Student registered on time after all"},admin.token);
    expect((await registration(periods[1].id)).windowExtension).toBeNull();
    await api("PUT",`${own}/registrations/${periods[1].id}`,{revision:2,courseIds:selected},student.token);
    await refresh(staff);
    await requestDecision("progression");
    academic = await api("GET",`${base}/academic`,undefined,registrar.token);
    const progression = academic.contexts.find((row) => row.period.id === periods[1].id).decisions[0];
    expect(progression.assessment.gpa).toBe(2);
    const wrong = await account(`academic.wrong.${stamp}@example.com`),wrongMe = await api("GET","/api/identity/me",undefined,wrong.token);
    for (const role of [{roleCode:"academic_approver",scope:{programmeCodes:["OTHER"],intakeIds:["other"]}},{roleCode:"auditor",scope:{}},{roleCode:"student",scope:{}}]) await api("POST","/api/access/role-assignments",{accountId:wrongMe.account.id,...role,reason:"Permission-specific scope and owner privacy test"},admin.token);
    await denied("GET",`${base}/academic`,undefined,wrong.token,403);
    await denied("GET",`${own}/academic`,undefined,wrong.token,404);
    await denied("POST",`${base}/academic/${periods[1].id}/decisions/${progression.id}/review`,{outcome:"approved",reason:"Wrong scoped approver"},wrong.token,403);
    await denied("POST",`${base}/academic/${periods[1].id}/decisions/${progression.id}/review`,{outcome:"approved",reason:"Self review"},registrar.token,403);
    await reviewDecision(progression.id,"approved");
    let studyYear = (await api("GET","/api/registry/me",undefined,student.token)).programmes.find((row) => row.id === sp.id).studyYear;
    expect(studyYear).toMatchObject({state:"scheduled",yearOfStudy:null});
    expect(studyYear.history.every((row) => row.yearOfStudy === 1)).toBe(true);
    await requestDecision(`repeat:${courses[1].id}`);
    academic = await api("GET",`${base}/academic`,undefined,registrar.token);
    const stale = academic.contexts.find((row) => row.period.id === periods[1].id).decisions[0];
    await requestException("credit_limit");
    const staleException = (await registration(periods[1].id)).exceptions[0];
    await api("PUT",`${own}/registrations/${periods[1].id}`,{revision:3,courseIds:selected},student.token);
    await denied("POST",`${base}/registrations/${periods[1].id}/exceptions/${staleException.id}/review`,{outcome:"approved",reason:"Stale exception evidence"},admin.token,409);
    await reviewException(staleException.id,"rejected");
    await denied("POST",`${base}/academic/${periods[1].id}/decisions/${stale.id}/review`,{outcome:"approved",reason:"Stale selection"},admin.token,409);
    await reviewDecision(stale.id,"rejected");
    await refresh(staff); await requestDecision(`repeat:${courses[1].id}`);
    academic = await api("GET",`${base}/academic`,undefined,registrar.token);
    const repeat = academic.contexts.find((row) => row.period.id === periods[1].id).decisions[0];
    await reviewDecision(repeat.id,"approved");
    await denied("POST",`${base}/academic/${periods[1].id}/decisions/${repeat.id}/review`,{outcome:"rejected",reason:"Cannot rewrite approval"},admin.token,409);
    await refresh(staff); await requestException("credit_limit");
    const credit = (await registration(periods[1].id)).exceptions[0];
    const exceptionPath = `${base}/registrations/${periods[1].id}/exceptions`;
    await denied("POST",`${exceptionPath}/${credit.id}/review`,{outcome:"approved",reason:"Self approval denied"},registrar.token,403);
    await denied("POST",`${exceptionPath}/${credit.id}/review`,{outcome:"approved",reason:"Unrelated global role cannot widen scope"},wrong.token,403);
    await denied("POST",exceptionPath,{kind:"credit_limit",parameters:{maxCredits:30},revision:4,evidenceHash:credit.evidenceHash,evidenceRef:"OWNER",expiresOn:day(7),reason:"Student cannot authorize an exception"},student.token,403);
    await reviewException(credit.id,"approved");
    target = await registration(periods[1].id);
    expect(target.eligibility.blockers.map((row) => row.code)).toEqual(expect.arrayContaining(["CLASH","FINANCIAL_CLEARANCE"]));
    expect(target.eligibility.blockers.some((row) => row.code === "CREDIT_LIMIT")).toBe(false);
    await reviewException(credit.id,"revoked");
    expect((await registration(periods[1].id)).eligibility.blockers.some((row) => row.code === "CREDIT_LIMIT")).toBe(true);
    await denied("POST",`${exceptionPath}/${credit.id}/review`,{outcome:"approved",reason:"Cannot rewrite revoked history"},admin.token,409);
    await refresh(staff); await requestException("credit_limit");
    const replacementCredit = (await registration(periods[1].id)).exceptions[0];
    await reviewException(replacementCredit.id,"approved");
    await refresh(staff); await requestException("timetable_clash");
    const clash = (await registration(periods[1].id)).exceptions[0];
    await reviewException(clash.id,"approved");
    expect((await registration(periods[1].id)).eligibility.blockers.map((row) => row.code)).toEqual(["ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
    await clearance(periods[1].id,4);
    expect((await registration(periods[1].id)).eligibility.ready).toBe(true);
    await page.goto("/#signin?next=office/registration");
    await page.locator('[data-shell-signin] [name="email"]').fill(student.email);
    await page.locator('[data-shell-signin] [name="password"]').fill(student.password);
    await page.locator('[data-shell-signin]').getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page.locator(`[data-confirm-registration][data-period="${periods[1].id}"]`)).toBeEnabled();
    await page.locator(`[data-confirm-registration][data-period="${periods[1].id}"]`).click();
    await expect(page.getByRole("status")).toContainText("Registration confirmed.");
    const confirmed = (await registration(periods[1].id)).registration.confirmation;
    expect(confirmed.academicEvidence.policy.id).toBe(policy.id);
    expect(confirmed.academicEvidence.progression.id).toBe(progression.id);
    expect(confirmed.academicEvidence.repeats[0].id).toBe(repeat.id);
    expect(confirmed.academicEvidence.prerequisites[0].batchId).toBe(batch.id);
    expect(confirmed.yearOfStudy).toBe(2);
    const continuation = await api('GET',`/api/reports/continuation?${new URLSearchParams({baselinePeriodId:periods[0].id,followupPeriodId:periods[1].id})}`,undefined,registrar.token);
    expect(continuation.totals).toMatchObject({baselineProgrammeRecords:1,continuedProgrammeRecords:1,withoutFollowupConfirmation:0,followupOnlyProgrammeRecords:0,baselineCourseEnrolments:2,continuingCourseEnrolments:2,followupCourseEnrolments:2,continuationSharePercent:null});
    expect(continuation.periodsStarted).toBe(false);
    expect(Object.values(continuation.controls).every(Boolean)).toBe(true);
    studyYear = (await api("GET","/api/registry/me",undefined,student.token)).programmes.find((row) => row.id === sp.id).studyYear;
    expect(studyYear).toMatchObject({state:"scheduled",yearOfStudy:null,active:true});
    expect(studyYear.upcoming.find((row) => row.yearOfStudy === 2)).toMatchObject({progressionDecisionId:progression.id,startsOn:confirmed.startsOn});
    expect(studyYear.history).toHaveLength(2);
    expect(studyYear.history[1]).not.toHaveProperty("assessment");
    expect(await api("GET",base,undefined,registrar.token)).toMatchObject({studyYear});
    await expect(page.locator("[data-study-year-level]")).toHaveText("Scheduled");
    await expect(page.locator("[data-study-year]")).toContainText(`Progression #${progression.id}`);
    expect(confirmed.exceptions.map((row) => row.id).sort()).toEqual([replacementCredit.id,clash.id].sort());
    expect(confirmed.exceptionEvidenceHash).toBe(clash.evidenceHash);
    await denied("POST",`${exceptionPath}/${clash.id}/review`,{outcome:"revoked",reason:"Confirmed evidence is immutable"},admin.token,409);
    expect((await api("GET","/api/registry/me",undefined,student.token)).programmes[0].status).toBe("onboarded");
    const retainedRegistryCounts = (await api('GET',`/api/reports/registry?intakeId=${sp.intakeId}`,undefined,admin.token)).totals;
    await configure(periods[2].id);
    await api("PUT",`${own}/registrations/${periods[2].id}`,{revision:0,courseIds:[courses[2].id]},student.token);
    await clearance(periods[2].id,1);
    await refresh(staff); await requestLifecycle("interrupted");
    let lifecycle = await api("GET",`${base}/lifecycle`,undefined,registrar.token);
    const staleLifecycle = lifecycle.requests[0];
    await api("PUT",`${own}/registrations/${periods[2].id}`,{revision:1,courseIds:[courses[2].id]},student.token);
    await denied("POST",`${base}/lifecycle/${staleLifecycle.id}/review`,{outcome:"approved",reason:"Cannot approve stale registration evidence"},admin.token,409);
    await reviewLifecycle(staleLifecycle.id,"rejected");
    await refresh(staff); await requestLifecycle("suspended");
    lifecycle = await api("GET",`${base}/lifecycle`,undefined,registrar.token);
    const suspension = lifecycle.requests[0];
    await denied("POST",`${base}/lifecycle/${suspension.id}/review`,{outcome:"approved",reason:"Self review"},registrar.token,403);
    await denied("POST",`${base}/lifecycle/${suspension.id}/review`,{outcome:"approved",reason:"Wrong scoped authority"},wrong.token,403);
    await denied("GET",`${base}/lifecycle`,undefined,wrong.token,403);
    await denied("GET",`${own}/lifecycle`,undefined,wrong.token,404);
    await denied("POST",`${base}/lifecycle`,{toStatus:"withdrawn",reason:"Student cannot directly change programme status"},student.token,403);
    await reviewLifecycle(suspension.id,"approved");
    await denied("POST",`${base}/lifecycle/${suspension.id}/review`,{outcome:"approved",reason:"Duplicate approval"},admin.token,409);
    expect((await registration(periods[2].id)).registration.revision).toBe(3);
    expect((await api("GET",`${own}/lifecycle`,undefined,student.token)).status).toBe("suspended");
    expect((await api('GET',`/api/reports/registry?intakeId=${sp.intakeId}`,undefined,admin.token)).totals).toMatchObject({programmeRecords:1,suspended:1,onboarded:0,confirmedRegistrations:retainedRegistryCounts.confirmedRegistrations,courseEnrolments:retainedRegistryCounts.courseEnrolments});
    await denied("PUT",`${own}/registrations/${periods[2].id}`,{revision:3,courseIds:[courses[2].id]},student.token,409);
    await denied("POST",`${own}/registrations/${periods[2].id}/confirm`,{revision:3},student.token,409);
    expect(await api("POST",`${own}/registrations/${periods[1].id}/confirm`,{revision:4},student.token)).toEqual(confirmed);
    await page.goto('/#office/details'); await expect(page.locator('.student-controls')).toContainText("suspended");
    await expect(page.locator("[data-study-year-level]")).toHaveText("Scheduled - suspended");
    expect((await api("GET","/api/registry/me",undefined,student.token)).programmes.find((row) => row.id === sp.id).studyYear).toMatchObject({active:false,currentPeriods:[]});
    await refresh(staff); await requestLifecycle("onboarded");
    lifecycle = await api("GET",`${base}/lifecycle`,undefined,registrar.token);
    await reviewLifecycle(lifecycle.requests[0].id,"approved");
    target = await registration(periods[2].id);
    expect(target.registration.revision).toBe(4);
    expect(target.eligibility.blockers.map((row) => row.code)).toEqual(expect.arrayContaining(["ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]));
    academic = await api("GET",`${base}/academic`,undefined,registrar.token);
    expect(academic.contexts.find((row) => row.period.id === periods[1].id).evidenceHash).not.toBe(progression.evidenceHash);
    for (const toStatus of ["interrupted","onboarded","withdrawn","onboarded"]) {
      const before = await api("GET",`${base}/lifecycle`,undefined,registrar.token);
      const change = await api("POST",`${base}/lifecycle`,{toStatus,revision:before.revision,evidenceHash:before.evidenceHash,expiresOn:day(7),...(["interrupted","suspended"].includes(toStatus) ? {reviewOn:day(14)} : {}),evidenceRef:`SAMPLE-LIFECYCLE-${stamp}`,reason:"Synthetic programme lifecycle decision"},registrar.token);
      await api("POST",`${base}/lifecycle/${change.id}/review`,{outcome:"approved",reason:"Independent synthetic lifecycle approval"},admin.token);
      expect((await api('GET',`/api/reports/registry?intakeId=${sp.intakeId}`,undefined,admin.token)).totals).toMatchObject({programmeRecords:1,[toStatus]:1,confirmedRegistrations:retainedRegistryCounts.confirmedRegistrations,courseEnrolments:retainedRegistryCounts.courseEnrolments});
    }
    lifecycle = await api("GET",`${base}/lifecycle`,undefined,registrar.token);
    expect(lifecycle.history.filter((row) => row.requestId === suspension.id)).toHaveLength(1);
    expect(lifecycle.status).toBe("onboarded");
    expect((await registration(periods[1].id)).registration.confirmation).toEqual(confirmed);
    await page.goto('/#study/results'); await expect(page.locator(".student-academic")).toContainText("approved");
    await refresh(approver);
    for (const current of [page,approver]) {expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await current.evaluate(() => scrollTo(0,0));}
    await page.screenshot({path:testInfo.outputPath("academic-confirmed-student.png"),fullPage:true});
    await approver.screenshot({path:testInfo.outputPath("academic-approved-staff.png"),fullPage:true});
    await approver.locator("[data-lifecycle-history] summary").click();
    await expect(approver.locator("[data-lifecycle-history]")).toContainText("rejected");
    await approver.locator(".registry-lifecycle").screenshot({path:testInfo.outputPath("programme-lifecycle-staff.png")});
  } finally {await registrarContext.close(); await adminContext.close();}

  async function requestDecision(decision) {
    const form = staff.locator(`[data-academic-request="${periods[1].id}"]`);
    await submit(form,{decision,evidenceRef:`SAMPLE-ACADEMIC-${stamp}`,expiresOn:day(7),reason:"Synthetic evidence-backed academic request"});
    await expect(staff.getByRole("status")).toHaveText("Academic decision requested.");
  }
  async function requestLifecycle(toStatus) {
    const form = staff.locator("[data-lifecycle-request]");
    if (!await form.isVisible()) await form.locator("..").locator("summary").click();
    await form.locator('[name="toStatus"]').selectOption(toStatus);
    await submit(form,{expiresOn:day(7),...(["suspended","interrupted"].includes(toStatus) ? {reviewOn:day(14)} : {}),evidenceRef:`SAMPLE-LIFECYCLE-${stamp}`,reason:"Synthetic reasoned programme status request"});
    await expect(staff.getByRole("status")).toHaveText("Programme change requested.");
  }
  async function reviewLifecycle(id,outcome) {
    await refresh(approver);
    await submit(approver.locator(`[data-lifecycle-review="${id}"]`),{outcome,reason:"Independent synthetic lifecycle review"});
    await expect(approver.getByRole("status")).toHaveText("Programme change reviewed.");
  }
  async function requestException(kind) {
    const form = staff.locator(`[data-exception-request="${periods[1].id}"]`);
    if (!await form.isVisible()) await form.locator("..").locator("summary").click();
    await form.locator('[name="kind"]').selectOption(kind);
    await submit(form,{...(kind === "credit_limit" ? {maxCredits:"30"} : {firstCourse:courses[1].id,secondCourse:courses[2].id}),evidenceRef:`SAMPLE-EXCEPTION-${stamp}`,expiresOn:day(7),reason:"Synthetic scoped exception with retained evidence"});
    await expect(staff.getByRole("status")).toHaveText("Registration exception requested.");
  }
  async function reviewException(id,outcome) {
    await refresh(approver);
    await submit(approver.locator(`[data-exception-review="${id}"]`),{outcome,reason:"Independent synthetic exception review"});
    await expect(approver.getByRole("status")).toHaveText("Registration exception reviewed.");
  }
  async function reviewDecision(id,outcome) {
    await refresh(approver);
    await submit(approver.locator(`[data-academic-review="${id}"]`),{outcome,reason:"Independent synthetic academic review"});
    await expect(approver.getByRole("status")).toHaveText("Academic decision reviewed.");
  }
  async function refresh(current) {await current.locator("[data-academic-refresh]").click(); await expect(current.locator("[data-academic-refresh]")).toBeEnabled();}
  async function configure(id) {
    const context = await registration(id);
    await api("POST",`${base}/registration-periods/${id}`,{offerings:context.offerings.map((row) => ({courseId:row.courseId,delivery:id === periods[1].id && [courses[1].id,courses[2].id].includes(row.courseId) ? "scheduled" : "asynchronous",meetings:id === periods[1].id && [courses[1].id,courses[2].id].includes(row.courseId) ? [{day:1,start:540,end:600}] : []})),reason:"Synthetic explicit delivery with a target clash"},admin.token);
    await api("POST",`${base}/registration-periods/${id}`,{toStatus:"open",reason:"Open synthetic registration"},admin.token);
  }
  async function clearance(periodId,revision) {for (const checkType of ["academic","financial"]) await api("POST",`${base}/registrations/${periodId}/checks`,{revision,checkType,outcome:"eligible",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7),reason:"Synthetic separate evidence-backed clearance"},admin.token);}
  async function registration(id) {return (await api("GET",`${own}/registrations`,undefined,student.token)).find((row) => row.period.id === id);}
  async function signInRegistry(current,email,password) {await current.goto("/#registry"); await submit(current.locator("[data-registry-login]"),{email,password}); await expect(current.locator("[data-registry-filter]")).toBeVisible();}
  async function submit(form,values) {for (const [name,value] of Object.entries(values)) {const field = form.locator(`[name="${name}"]`); if (await field.evaluate((element) => element.tagName === "SELECT")) await field.selectOption(String(value)); else await field.fill(String(value));} await form.locator('[type="submit"], button:not([type])').last().click();}
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!";
    await api("POST","/api/admissions/registrations",{email,preferredName:"Pilot",legalName:`Academic Student ${stamp}`});
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (name) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,name),"utf8"))));
    const activation = messages.find((row) => row.recipientEmail === email);
    await api("POST","/api/identity/activations",{token:activation.variables.activationToken,password,preferredName:"Pilot",legalName:`Academic Student ${stamp}`});
    const session = await api("POST","/api/identity/sessions",{email,password}); return {email,password,token:session.token};
  }
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}}); expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true); return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}}); expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
