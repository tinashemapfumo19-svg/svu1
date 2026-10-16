import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outcomeChecksum } from "../server/modules/lms.js";
import pg from 'pg';

test("lecturers enter marks under an approved plan, submissions are reviewed, and mixed sources transfer to results once",async ({page,request},info) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "AMD" : "AMM";
  const fixtureNow = Number(process.env.SVU_TEST_NOW || Date.now());
  const day = (offset) => new Date(fixtureNow+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const courses = [];
  for (const [index,title] of [[1,"Marks native course"],[2,"Marks LMS course"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const programme = await api("POST","/api/master-data/programmes",{code:`AM-${stamp}`,name:`SAMPLE marks ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Marks curriculum",effectiveFrom:"2024-01-01"},admin.token);
  for (const course of courses) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE marks ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`marks.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
  const staffBase = `/api/registry/programmes/${students[0].id}`,term = await calendar(new Date(fixtureNow).getUTCFullYear());
  const period = await api("POST",`${staffBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Synthetic registration"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{offerings:courses.map((course) => ({courseId:course.id,delivery:"asynchronous",meetings:[]})),reason:"Synthetic delivery"},admin.token);
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"open",reason:"Synthetic window"},admin.token);
  for (const student of students) {
    await api("PUT",`/api/registry/me/programmes/${student.id}/registrations/${period.id}`,{revision:0,courseIds:courses.map((course) => course.id)},student.token);
    for (const checkType of ["academic","financial"]) await api("POST",`/api/registry/programmes/${student.id}/registrations/${period.id}/checks`,{revision:1,checkType,outcome:"eligible",reason:"Synthetic clearance",evidenceRef:`SAMPLE-${checkType}`,expiresOn:day(7)},admin.token);
    await api("POST",`/api/registry/me/programmes/${student.id}/registrations/${period.id}/confirm`,{revision:1},student.token);
  }
  const lecturer = await staffMember(`marks.lecturer.${stamp}@example.edu`,`Marks Lecturer ${stamp}`);
  const outsider = await staffMember(`marks.other.${stamp}@example.edu`,`Other Lecturer ${stamp}`);
  await api("POST",`/api/teaching/periods/${period.id}/allocations`,{courseId:courses[0].id,staffId:lecturer.staffId,role:"lead",workloadUnits:3,effectiveFrom:day(-3),reason:"Teaching plan"},registrar.token);
  const allocation = (await api("GET",`/api/teaching/periods/${period.id}`,undefined,registrar.token)).offerings.find((row) => row.courseId === courses[0].id).allocations[0];
  await api("POST",`/api/teaching/allocations/${allocation.id}/review`,{outcome:"approved",reason:"Approved"},admin.token);
  const officer = await account(`marks.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const base = `/api/assessment/offerings/${period.id}/${courses[0].id}`;
  const reportingPath=`/api/reports/assessment?intakeId=${intake.id}&periodId=${period.id}`;
  const report=async () => (await api('GET',reportingPath,undefined,officer.token));
  expect((await report()).totals).toMatchObject({offerings:2,configuredOfferings:0,rosterEnrolments:4,unconfiguredEnrolments:4,expectedCells:0,submissions:0});
  await denied('GET',reportingPath,undefined,outsider.token,403);

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:lecturer.email,password:lecturer.password});
  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  const draft = page.locator("[data-plan-draft]");
  await draft.locator("..").locator("summary").click();
  await submit(draft,{components:"CW, Coursework, 40, 50\nEXAM, Final examination, 60, 100",moderation:"internal_external",reason:"Module descriptor weighting"});
  await expect(page.getByRole("status")).toHaveText("Assessment plan drafted for approval.");
  let context = await api("GET",base,undefined,lecturer.token);
  const plan = context.plans[0];
  expect(plan.moderation).toBe('internal_external');
  const external = await account(`marks.external.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:external.id,roleCode:"external_examiner",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"External examiner appointment"},admin.token);
  const outsideModerator = await account(`marks.moderator.other.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:outsideModerator.id,roleCode:"academic_approver",scope:{programmeCodes:["BSC-CS"],intakeIds:[intake.id]},reason:"Different programme"},admin.token);
  await expect(page.locator(`[data-plan-approve="${plan.id}"]`)).toHaveCount(0);
  // A fresh registrar-role account: other journeys grant the shared seeded registrar extra approver roles.
  const planner = await account(`marks.registrar.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:planner.id,roleCode:"academic_registrar",scope:{},reason:"Registry office"},admin.token);
  await denied("POST",`/api/assessment/plans/${plan.id}/approve`,{reason:"No authority"},planner.token,403);
  await denied("GET",base,undefined,outsider.token,404);
  await api("POST",`/api/assessment/plans/${plan.id}/approve`,{reason:"Matches the approved module descriptor"},admin.token);
  expect((await report()).totals).toMatchObject({configuredOfferings:1,expectedCells:4,missingCells:4,incompleteEnrolments:2});
  await denied('GET',reportingPath,undefined,outsideModerator.token,404);

  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  const [first,second] = students;
  const cell = (student,code,field) => page.locator(`[data-assessment-marks] [name="${field}:${context.students.find((row) => row.studentNumber === student.studentNumber).registrationId}|${code}"]`);
  context = await api("GET",base,undefined,lecturer.token);
  await cell(first,"CW","state").selectOption("mark"); await cell(first,"CW","mark").fill("40");
  await cell(first,"EXAM","state").selectOption("mark"); await cell(first,"EXAM","mark").fill("70");
  await cell(second,"CW","state").selectOption("mark"); await cell(second,"CW","mark").fill("25");
  await cell(second,"EXAM","state").selectOption("deferred"); await cell(second,"EXAM","reason").fill("Medical certificate submitted");
  await page.locator("[data-assessment-marks] button[type=submit]").click();
  await expect(page.getByRole("status")).toHaveText("4 mark(s) saved.");
  await expect(page.locator(`[data-assessment-student="${first.studentNumber}"] [data-final]`)).toHaveText("74");
  await expect(page.locator(`[data-assessment-student="${second.studentNumber}"] [data-final]`)).toHaveText("deferred");
  context = await api("GET",base,undefined,lecturer.token);
  const secondReg = context.students.find((row) => row.studentNumber === second.studentNumber).registrationId;
  const markedReport=await report();expect(markedReport.totals).toMatchObject({expectedCells:4,populatedCells:4,missingCells:0,markCells:3,deferredCells:1,finalEnrolments:1,deferredEnrolments:1});
  expect(JSON.stringify(markedReport)).not.toMatch(/Medical certificate|studentNumber|registrationId|marksHash|submittedBy/);
  await api('POST','/api/access/role-assignments',{accountId:external.id,roleCode:'auditor',scope:{},reason:'Unrelated global audit duties'},admin.token);
  const retained=await api('POST','/api/reports/editions',{reportKind:'assessment',filters:{intakeId:intake.id,periodId:period.id},title:'Synthetic pending component sheets',reason:'SECRET ASSESSMENT CUSTODY',retainUntil:day(2),requestKey:`assessment_${info.project.name}_${Date.now()}`},external.token);
  const original=await api('GET',`/api/reports/editions/${retained.id}`,undefined,external.token),originalCsv=await api('GET',`/api/reports/editions/${retained.id}/download`,undefined,external.token);
  expect(original.report.availableCourses).toBeUndefined();expect(original.report.totals.submissions).toBe(0);expect(original.report.selection.map((r) => r.intakeId)).toEqual([intake.id]);
  await denied("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:secondReg,componentCode:"CW",state:"mark",mark:30,revision:0}]},lecturer.token,409);
  await denied("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:secondReg,componentCode:"CW",state:"mark",mark:51,revision:1}]},lecturer.token,400);
  await denied("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:secondReg,componentCode:"CW",state:"absent",revision:1}]},lecturer.token,400);
  await denied("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:secondReg,componentCode:"CW",state:"mark",mark:30,revision:1}]},outsider.token,404);

  await submit(page.locator("[data-assessment-submit]"),{reason:"All marks entered"});
  await expect(page.getByRole("status")).toHaveText("Marks submitted for review.");
  expect((await report()).totals).toMatchObject({submittedSubmissions:1,awaitingInternal:1,awaitingExternal:0,readyForReview:0});
  await denied("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:secondReg,componentCode:"CW",state:"mark",mark:30,revision:1}]},lecturer.token,409);
  context = await api("GET",base,undefined,officer.token);
  await denied("POST",`/api/assessment/submissions/${context.live.id}/review`,{outcome:"approved",reason:"Own"},lecturer.token,403);
  let moderationPath = `/api/assessment/submissions/${context.live.id}/moderation`;
  const sign = {stage:'internal',outcome:'signed',evidenceRef:'SAMPLE-MODERATION',reason:'Checked component marks and exceptions'};
  await denied("POST",moderationPath,sign,outsideModerator.token,404);
  await denied("POST",moderationPath,sign,officer.token,403);
  await denied("POST",moderationPath,{...sign,stage:'external'},external.token,409);
  await denied("POST",`/api/assessment/submissions/${context.live.id}/review`,{outcome:'approved',reason:'Before moderation'},officer.token,409);
  // Even a privileged submitter/mark editor cannot moderate their own work.
  await api("POST","/api/access/role-assignments",{accountId:(await api("GET","/api/identity/me",undefined,lecturer.token)).account.id,roleCode:"academic_approver",scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:"Additional academic duties"},admin.token);
  await denied("POST",moderationPath,sign,lecturer.token,403);
  const rejectedModeration = await api("POST",moderationPath,{...sign,outcome:'changes_requested',reason:'Deferral needs correction'},admin.token);
  expect(rejectedModeration.live.moderationComplete).toBe(false);
  await denied("POST",moderationPath,sign,admin.token,409);
  await denied("POST",moderationPath,{...sign,stage:'external'},external.token,409);
  await api("POST",`/api/assessment/submissions/${context.live.id}/review`,{outcome:"returned",reason:"Board confirms the medical deferral; resubmit for sign-off"},officer.token);
  const concurrent = await Promise.all([
    request.post(`${base}/submit`,{data:{planId:plan.id,reason:"Medical deferral confirmed"},headers:{Authorization:`Bearer ${lecturer.token}`}}),
    request.put(`${base}/marks`,{data:{planId:plan.id,entries:[{registrationId:secondReg,componentCode:'CW',state:'mark',mark:25,revision:1}]},headers:{Authorization:`Bearer ${lecturer.token}`}})
  ]);
  expect(concurrent[0].status(),await concurrent[0].text()).toBe(201);
  expect([200,409]).toContain(concurrent[1].status());
  context = await api("GET",base,undefined,officer.token);
  expect(context.live.finals.map((row) => [row.studentNumber,row.state,row.mark]).sort()).toEqual([[first.studentNumber,"final",74],[second.studentNumber,"deferred",null]].sort());
  expect(context.live.moderations).toEqual([]);
  moderationPath = `/api/assessment/submissions/${context.live.id}/moderation`;
  await denied("POST",`/api/assessment/submissions/${context.live.id}/review`,{outcome:'approved',reason:'Old sign-off is not reusable'},officer.token,409);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'});
  await openAssessment();
  await submit(page.locator(`[data-moderation="${context.live.id}"][data-stage="internal"]`),{outcome:'signed',evidenceRef:sign.evidenceRef,reason:sign.reason});
  await expect(page.getByRole('status')).toHaveText('Moderation decision recorded.');
  expect((await report()).totals).toMatchObject({submittedSubmissions:1,returnedSubmissions:1,awaitingInternal:0,awaitingExternal:1,readyForReview:0});
  await expect(page.locator(`[data-submission-review="${context.live.id}"] option[value="approved"]`)).toHaveCount(0);
  await denied("POST",moderationPath,{...sign,stage:'external'},admin.token,403);
  await denied("POST",moderationPath,{...sign,stage:'external',evidenceRef:''},external.token,400);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:external.email,password:external.password});
  await openAssessment();
  await submit(page.locator(`[data-moderation="${context.live.id}"][data-stage="external"]`),{outcome:'signed',evidenceRef:'SAMPLE-EXTERNAL',reason:'External examiner checked the moderated sheet'});
  await expect(page.getByRole('status')).toHaveText('Moderation decision recorded.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath('moderation.png'),fullPage:true});
  context = await api("GET",base,undefined,officer.token);
  expect(context.live.moderationComplete).toBe(true);
  expect((await report()).totals).toMatchObject({awaitingInternal:0,awaitingExternal:0,readyForReview:1});
  expect(context.live.moderations.map((row) => row.stage)).toEqual(['internal','external']);
  await denied("POST",moderationPath,{...sign,stage:'external'},external.token,409);
  const moderationEvents = await api("GET",`/api/audit/events?subjectType=AssessmentSubmission&subjectId=${context.live.id}`,undefined,admin.token);
  expect(moderationEvents.filter((row) => row.action === 'assessment.moderation.signed')).toHaveLength(2);
  await api("POST",`/api/assessment/submissions/${context.live.id}/review`,{outcome:"approved",reason:"Department review complete"},officer.token);
  expect((await report()).totals).toMatchObject({approvedSubmissions:1,approvedAllFinal:0,approvedWithheld:1});
  await denied("POST",moderationPath,sign,admin.token,409);

  const connector = await account(`marks.connector.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:connector.id,roleCode:"lms_connector",scope:{},reason:"LMS integration service"},admin.token);
  const lmsRows = students.map((student,index) => ({studentNumber:student.studentNumber,mark:[81,66][index]}));
  const returned = await api("POST","/api/lms/v1/outcomes",{offeringKey:`${period.id}:${courses[1].id}`,externalRef:`moodle-marks-${stamp}`,rows:lmsRows,checksum:outcomeChecksum(lmsRows)},connector.token);
  await api("POST",`/api/lms/outcomes/${returned.id}/review`,{outcome:"accepted",reason:"Agreed"},officer.token);
  const fallback = await api('POST','/api/lms/v1/outcomes',{offeringKey:`${period.id}:${courses[0].id}`,externalRef:`moodle-native-${stamp}`,rows:lmsRows,checksum:outcomeChecksum(lmsRows)},connector.token);
  await api('POST',`/api/lms/outcomes/${fallback.id}/review`,{outcome:'accepted',reason:'Imported before native marks resolve'},officer.token);
  let deferredStatus = (await api('GET','/api/lms/outcomes',undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect(deferredStatus.courses.find((row) => row.courseId === courses[0].id)).toMatchObject({source:'assessment',deferred:1,ready:false});
  const oldSubmission = context.live.id;
  const oldFinals = structuredClone(context.live.finals),oldHash = context.live.marksHash;
  const completionPayload = {entries:[{registrationId:secondReg,state:'absent',reason:'Did not attend deferred sitting',revision:1}],evidenceRef:'SAMPLE-DEFERRED-ATTENDANCE',reason:'Invigilator attendance register'};
  const start = new Date(Date.now()-120*60000).toISOString().replace(/\.\d{3}Z$/,'Z');
  const scheduling = {courseId:courses[0].id,paper:'Deferred EXAM',startsAt:start,durationMinutes:60,venue:'Deferred room',capacity:1,reason:'Approved medical deferral',deferred:{planId:plan.id,componentCode:'EXAM',registrationIds:[secondReg]}};
  const firstReg = context.students.find((row) => row.studentNumber === first.studentNumber).registrationId;
  await denied('POST',`/api/exams/periods/${period.id}/sittings`,{...scheduling,deferred:{...scheduling.deferred,registrationIds:[firstReg]}},officer.token,409);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
  await page.locator('[data-exams-panel] > summary').click();
  await page.locator(`[data-exam-period="${period.id}"]`).click();
  await page.locator(`[data-deferred-schedule-panel="${plan.id}:EXAM"] > summary`).click();
  const localStart = await page.evaluate((iso) => {const d = new Date(iso),pad = (n) => String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;},start);
  await submit(page.locator('[data-deferred-schedule]'),{paper:scheduling.paper,startsAt:localStart,durationMinutes:60,venue:scheduling.venue,capacity:1,reason:scheduling.reason});
  await expect(page.getByRole('status')).toHaveText('Deferred sitting scheduled.');
  const timetable = await api('GET',`/api/exams/periods/${period.id}`,undefined,officer.token);
  const deferredSitting = timetable.sittings.find((row) => row.planId === plan.id);
  expect(timetable.capacity).toEqual([]);
  expect(deferredSitting.candidates.map((row) => row.studentNumber)).toEqual([second.studentNumber]);
  const completionPath = `/api/assessment/deferred-sittings/${deferredSitting.id}/completions`;
  await denied('POST',completionPath,completionPayload,lecturer.token,409);
  await denied('POST',`/api/exams/periods/${period.id}/sittings`,scheduling,officer.token,409);
  await api('POST',`/api/exams/periods/${period.id}/publish`,{revision:timetable.timetable.revision,reason:'Independent deferred timetable publication'},admin.token);
  expect(await api('GET',`/api/registry/me/programmes/${first.id}/exams`,undefined,first.token)).toEqual([]);
  const ownExams = await api('GET',`/api/registry/me/programmes/${second.id}/exams`,undefined,second.token);
  expect(ownExams[0].sittings).toHaveLength(1);
  expect(ownExams[0].sittings[0]).not.toHaveProperty('candidates');
  const notices = async (student) => api('GET',`/api/notifications?recipientAccountId=${(await api('GET','/api/identity/me',undefined,student.token)).account.id}`,undefined,admin.token);
  expect((await notices(first)).some((row) => /examination timetable is published$/.test(row.payload.subject))).toBe(false);
  expect((await notices(second)).some((row) => /examination timetable is published$/.test(row.payload.subject))).toBe(true);
  await denied('POST',completionPath,completionPayload,outsider.token,404);
  await denied('POST',completionPath,{...completionPayload,entries:[{registrationId:secondReg,state:'mark',mark:101,revision:1}]},lecturer.token,400);
  await denied('POST',completionPath,{...completionPayload,entries:[{...completionPayload.entries[0],revision:0}]},lecturer.token,409);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:lecturer.email,password:lecturer.password});
  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  await page.locator(`[data-deferred-sitting="${deferredSitting.id}"] > summary`).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-deferred-record]').screenshot({path:info.outputPath('deferred-entry.png')});
  await submit(page.locator('[data-deferred-record]'),{[`state:${secondReg}`]:'absent',[`reason:${secondReg}`]:completionPayload.entries[0].reason,evidenceRef:completionPayload.evidenceRef,reason:completionPayload.reason});
  await expect(page.getByRole('status')).toHaveText('Deferred completion submitted for review.');
  context = await api('GET',base,undefined,officer.token);
  let completion = context.deferredSittings[0].completions[0];
  const reviewPayload = {outcome:'approved',reason:'Independent attendance evidence checked'};
  await denied('POST',`/api/assessment/deferred-completions/${completion.id}/review`,reviewPayload,lecturer.token,403);
  await denied('POST',`/api/exams/sittings/${deferredSitting.id}`,{revision:1,cancel:true,reason:'Attempt to bypass review'},officer.token,409);
  const returnReviews = await Promise.all([1,2].map(() => request.post(`/api/assessment/deferred-completions/${completion.id}/review`,{data:{outcome:'returned',reason:'Clarify the evidence reference'},headers:{Authorization:`Bearer ${officer.token}`}})));
  expect(returnReviews.map((row) => row.status()).sort()).toEqual([200,409]);
  context = await api('POST',completionPath,{...completionPayload,evidenceRef:'SAMPLE-DEFERRED-ATTENDANCE-REVISED'},lecturer.token);
  completion = context.deferredSittings[0].completions[0];
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
  await openAssessment();
  await page.locator(`[data-deferred-sitting="${deferredSitting.id}"] > summary`).click();
  await page.locator(`[data-deferred-review="${completion.id}"]`).screenshot({path:info.outputPath('deferred-review.png')});
  await submit(page.locator(`[data-deferred-review="${completion.id}"]`),reviewPayload);
  await expect(page.getByRole('status')).toHaveText('Deferred completion approved.');
  await denied('POST',`/api/assessment/deferred-completions/${completion.id}/review`,reviewPayload,officer.token,409);
  context = await api('GET',base,undefined,officer.token);
  expect(context.live).toBeNull();
  expect((await report()).totals).toMatchObject({approvedSubmissions:0,supersededSubmissions:1,absentCells:1,deferredCells:0,finalEnrolments:2});
  expect(context.submissions.find((row) => row.id === oldSubmission)).toMatchObject({status:'superseded',finals:oldFinals,marksHash:oldHash});
  expect(context.submissions.find((row) => row.id === oldSubmission).moderations).toHaveLength(2);
  deferredStatus = (await api('GET','/api/lms/outcomes',undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect(deferredStatus.courses.find((row) => row.courseId === courses[0].id)).toMatchObject({source:'assessment',ready:false});
  const fresh = await api('POST',`${base}/submit`,{planId:plan.id,reason:'Deferred attendance resolved; fresh sheet review'},lecturer.token);
  expect(fresh.live.moderations).toEqual([]);
  expect(fresh.live.finals.find((row) => row.studentNumber === second.studentNumber)).toMatchObject({state:'final',mark:20});
  await denied('POST',`/api/assessment/submissions/${fresh.live.id}/review`,reviewPayload,officer.token,409);
  await api('POST',`/api/assessment/submissions/${fresh.live.id}/moderation`,sign,admin.token);
  await api('POST',`/api/assessment/submissions/${fresh.live.id}/moderation`,{...sign,stage:'external',evidenceRef:'SAMPLE-DEFERRED-EXTERNAL'},external.token);
  context = await api('POST',`/api/assessment/submissions/${fresh.live.id}/review`,reviewPayload,officer.token);
  expect((await report()).totals).toMatchObject({approvedSubmissions:1,approvedAllFinal:1,approvedWithheld:0});
  const completionEvents = await api('GET',`/api/audit/events?subjectType=DeferredCompletion&subjectId=${completion.id}`,undefined,admin.token);
  expect(completionEvents.map((row) => row.action)).toEqual(expect.arrayContaining(['assessment.deferred.submitted','assessment.deferred.approved']));
  await page.locator(`[data-deferred-sitting="${deferredSitting.id}"] > summary`).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator(`[data-deferred-sitting="${deferredSitting.id}"]`).screenshot({path:info.outputPath('deferred-completion.png')});
  let status = (await api("GET","/api/lms/outcomes",undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect(status.courses.map((row) => [row.code,row.source,row.ready])).toEqual([[courses[0].code,"assessment",true],[courses[1].code,"lms",true]]);

  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"closed",reason:"Semester complete"},admin.token);
  const gpa = await gradingPolicy();
  const transfer = await api("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"Approved marks and LMS outcomes"},registrar.token);
  expect(transfer).toMatchObject({rowCount:4,assessmentSubmissionIds:[context.live.id],lmsBatchIds:[returned.id]});
  expect((await report()).totals).toMatchObject({transferredSubmissions:1,approvedSubmissions:0});
  status = (await api("GET","/api/lms/outcomes",undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect(status.transferred).toBe(true);
  expect((await api("GET",base,undefined,officer.token)).live).toMatchObject({status:"transferred",resultBatchId:transfer.resultBatchId});
  await denied("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"Retry"},registrar.token,409);
  // Rejecting the assembled batch releases both sources; the retry is a new batch under a fresh source reference.
  await api("POST",`${staffBase}/results/${period.id}/batches/${transfer.resultBatchId}/review`,{outcome:"rejected",evidenceRef:"SAMPLE-BOARD-1",reason:"Board asked for a recount"},officer.token);
  expect((await api("GET",base,undefined,officer.token)).live).toMatchObject({status:"approved",resultBatchId:null});
  expect((await report()).totals).toMatchObject({transferredSubmissions:0,approvedSubmissions:1,approvedAllFinal:1});
  status = (await api("GET","/api/lms/outcomes",undefined,registrar.token)).periods.find((row) => row.period.id === period.id);
  expect([status.readyToTransfer,status.transferred]).toEqual([true,false]);
  const retry = await api("POST",`/api/lms/periods/${period.id}/transfer`,{gpaRuleSetId:gpa.id,reason:"Recount confirmed"},registrar.token);
  expect(retry).toMatchObject({rowCount:4,assessmentSubmissionIds:[context.live.id],lmsBatchIds:[returned.id]});
  expect([retry.resultBatchId === transfer.resultBatchId,retry.sourceRef === transfer.sourceRef]).toEqual([false,false]);
  await api("POST",`${staffBase}/results/${period.id}/batches/${retry.resultBatchId}/review`,{outcome:"reviewed",evidenceRef:"SAMPLE-BOARD",reason:"Board review"},officer.token);
  await api("POST",`${staffBase}/results/${period.id}/batches/${retry.resultBatchId}/publish`,{reason:"Publish"},officer.token);
  const published = (await api("GET",`/api/registry/me/programmes/${second.id}/results`,undefined,second.token))[0].results;
  expect(published.map((row) => [row.code,row.mark,row.passing]).sort()).toEqual([[courses[0].code,20,false],[courses[1].code,66,true]].sort());
  const events = await api("GET",`/api/audit/events?subjectId=${plan.id}`,undefined,admin.token);
  expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(["assessment.plan.drafted","assessment.plan.approved","assessment.marks.saved"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("marks.png"),fullPage:true});

  expect((await api('GET',`/api/reports/editions/${retained.id}`,undefined,external.token)).report).toEqual(original.report);
  expect((await api('GET',`/api/reports/editions/${retained.id}/download`,undefined,external.token)).csv).toBe(originalCsv.csv);
  await expect(page.locator('[data-assessment-report]')).toBeVisible();await page.locator('[data-assessment-report] > summary').click();
  await submit(page.locator('[data-assessment-report-filter]'),{intakeId:intake.id,periodId:period.id,courseId:''});await expect(page.locator('[data-assessment-report-metric="transferredSubmissions"] td').last()).toHaveText('1');
  const csvDownload=page.waitForEvent('download');await page.locator('[data-assessment-report-export]').click();const csv=await readFile(await (await csvDownload).path(),'utf8');expect(csv).toContain('assessment-recording-operations-v1');for(const person of students)expect(csv).not.toContain(person.studentNumber);expect(csv).not.toMatch(/Medical certificate|SECRET ASSESSMENT/);
  await expect(page.locator('[data-registry-signout]')).toBeEnabled();expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.locator('[data-assessment-report]').screenshot({path:info.outputPath('assessment-report.png')});await page.locator('[data-assessment-report]').evaluate((el) => el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('assessment-report-viewport.png')});
  await api('POST','/api/access/role-assignments',{accountId:external.id,roleCode:'report_scheduler',scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:'Scoped automated assessment capture'},admin.token);
  const scheduled=await api('POST','/api/reports/schedules',{reportKind:'assessment',filters:{intakeId:intake.id,periodId:period.id},title:'Synthetic automatic assessment',reason:'SECRET ASSESSMENT SCHEDULE',cadence:'daily',firstRunAt:new Date(Math.floor(Date.now()/60000)*60000).toISOString(),retainDays:2,requestKey:`assessment_schedule_${info.project.name}_${Date.now()}`},external.token);
  let history;await expect.poll(async () => {history=await api('GET',`/api/reports/schedules/${scheduled.id}`,undefined,external.token);return history.runs[0]?.status;},{timeout:90000,intervals:[1000,2000,5000]}).toBe('succeeded');
  expect((await api('GET',`/api/reports/editions/${history.runs[0].editionId}`,undefined,external.token)).report.totals).toMatchObject({transferredSubmissions:1,finalEnrolments:2});await api('POST',`/api/reports/schedules/${scheduled.id}/transitions`,{status:'cancelled',revision:0,reason:'Completed synthetic automated capture'},external.token);
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});expect(new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')).toBe(true);await client.connect();
  try {
    const marker=(await client.query(`select data->>'withdrawn_at' is null as active from (values ('{}'::jsonb),('{"withdrawn_at":null}'::jsonb),('{"withdrawn_at":"2026-10-05T12:00:00Z"}'::jsonb)) probe(data)`)).rows;expect(marker.map((r) => r.active)).toEqual([true,true,false]);
    try {
      await client.query('update assessment_marks set component_code = $1 where plan_id = $2 and registration_id = $3 and component_code = $4',['BAD_COMPONENT',plan.id,firstReg,'CW']);await denied('GET',reportingPath,undefined,officer.token,409);
      await page.locator('[data-assessment-report-filter] button[type="submit"]').click();await expect(page.locator('[data-assessment-report] [role="alert"]')).toContainText('reconciliation');await expect(page.locator('[data-assessment-report-metric]')).toHaveCount(0);await expect(page.locator('[data-assessment-report-export]')).toBeDisabled();
    } finally {await client.query('update assessment_marks set component_code = $1 where plan_id = $2 and registration_id = $3 and component_code = $4',['CW',plan.id,firstReg,'BAD_COMPONENT']);}
    await page.locator('[data-assessment-report-filter] button[type="submit"]').click();await expect(page.locator('[data-assessment-report-metric="transferredSubmissions"] td').last()).toHaveText('1');
    await client.query("update role_assignments set effective_from = current_date-2,effective_to = current_date-1 where account_id = $1 and role_code = 'external_examiner'",[external.id]);
    await denied('GET',reportingPath,undefined,external.token,403);await denied('GET',`/api/reports/editions/${retained.id}/download`,undefined,external.token,404);expect((await api('GET','/api/reports/editions?reportKind=assessment',undefined,external.token)).total).toBe(0);await denied('GET',`/api/reports/schedules/${scheduled.id}`,undefined,external.token,404);
    const reportAudits=(await api('GET','/api/audit/events?subjectType=AssessmentOperationsReport',undefined,admin.token));expect(reportAudits.some((r) => r.action === 'reports.assessment.exported')).toBe(true);expect(JSON.stringify(reportAudits)).not.toMatch(/Medical certificate|SECRET ASSESSMENT|studentNumber|marksHash/);
    await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:external.email,password:external.password});await expect(page.locator('[data-registry-signout]')).toBeEnabled();await expect(page.locator('[data-assessment-report]')).toHaveCount(0);await expect(page.locator('[data-assessment-report-metric]')).toHaveCount(0);
  } finally {await client.end();}

  async function openAssessment() {
    await expect(page.locator('[data-registry-signout]')).toBeEnabled();
    if (!await page.locator('[data-teaching-panel]').count()) {
      if (!await page.locator('[data-exams-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exams-panel] > summary').click();
      await page.locator(`[data-exam-period="${period.id}"]`).click();
      await page.locator(`[data-exam-offering="${courses[0].id}"] [data-assessment-load]`).click();
      return;
    }
    if (!await page.locator('[data-teaching-panel]').evaluate((panel) => panel.open)) await page.locator('[data-teaching-panel] > summary').click();
    await page.locator(`[data-teaching-load="${period.id}"]`).click();
    await page.locator(`[data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  }
  async function staffMember(email,legalName) {
    const created = await api("POST","/api/staff",{email,legalName,preferredName:"Lecturer",category:"LECTURER",grade:"L1",departmentId:"dept_computing",engagedOn:day(-400),roleCode:"lecturer",reason:"Appointment"},admin.token);
    const password = "Kariba-Dam-Staff-2026!";
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Lecturer",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password});
    return {email,password,token:session.token,staffId:created.id};
  }
  async function gradingPolicy() {
    const code = `am_${stamp.replaceAll(".","_")}`;
    const scheme = await api("POST","/api/master-data/grading-schemes",{code,name:"SAMPLE marks grades",bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:100,grade:"P",points:3,passing:true}],classifications:[{minGpa:2,label:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/grading-schemes/${scheme.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic grades"},registrar.token);
    const rule = await api("POST","/api/master-data/gpa-rule-sets",{code,name:"SAMPLE marks GPA",gradingSchemeId:scheme.id,rules:{creditWeighted:true,retakePolicy:"latest",includeFailed:true,excludeGrades:[],rounding:{decimals:2,mode:"half_up"}},samples:[{results:[{courseCode:"X",credits:15,mark:75}],expectedGpa:3,expectedClassification:"Pass"}]},admin.token);
    await api("POST",`/api/master-data/gpa-rule-sets/${rule.id}/publish`,{effectiveFrom:"2024-01-01",reason:"Synthetic GPA"},registrar.token);
    return rule;
  }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),"utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!",legalName = `Marks Person ${email.split("@")[0]}`;
    await api("POST","/api/admissions/registrations",{email,preferredName:"Person",legalName});
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Person",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password}),me = await api("GET","/api/identity/me",undefined,session.token);
    return {email,password,token:session.token,id:me.account.id};
  }
  async function admit(person) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-AM-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-AM-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`AM-Y-${y}-${stamp}`,name:`SAMPLE marks ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    const startsOn = day(-7) < `${y}-01-01` ? `${y}-01-01` : day(-7),endsOn = day(7) > `${y}-12-31` ? `${y}-12-31` : day(7);
    let termRow = periods.find((row) => row.periodType === "term" && row.parentId === parent.id && row.startsOn === startsOn && row.endsOn === endsOn);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`AM-T-${y}-${stamp}`,name:`SAMPLE marks ${y} term`,periodType:"term",parentId:parent.id,startsOn,endsOn,windows:{registration:[startsOn,endsOn],assessment:[startsOn,endsOn],results_publication:[startsOn,endsOn]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic term"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
