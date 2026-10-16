import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from 'node:crypto';
import pg from 'pg';

// Times are entered and checked in the institution's timezone, whatever the machine running the tests uses.
test.use({timezoneId:"Africa/Harare"});

test("examinations staff schedule sittings without clashes, publish independently, and students get their own timetable",async ({page,browser,request},info) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "EXD" : "EXM";
  const fixtureNow = Number(process.env.SVU_TEST_NOW || Date.now());
  const day = (offset) => new Date(fixtureNow+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const courses = [];
  for (const [index,title] of [[1,"Marks native course"],[2,"Marks LMS course"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const programme = await api("POST","/api/master-data/programmes",{code:`EX-${stamp}`,name:`SAMPLE marks ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Marks curriculum",effectiveFrom:"2024-01-01"},admin.token);
  for (const course of courses) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE marks ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2]) {const person = await account(`marks.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
  const staffBase = `/api/registry/programmes/${students[0].id}`,term = await calendar();
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
  await api("POST",`/api/teaching/periods/${period.id}/allocations`,{courseId:courses[0].id,staffId:lecturer.staffId,role:"lead",workloadUnits:3,effectiveFrom:"2025-02-01",reason:"Teaching plan"},registrar.token);
  const allocation = (await api("GET",`/api/teaching/periods/${period.id}`,undefined,registrar.token)).offerings.find((row) => row.courseId === courses[0].id).allocations[0];
  await api("POST",`/api/teaching/allocations/${allocation.id}/review`,{outcome:"approved",reason:"Approved"},admin.token);
  const officer = await account(`marks.exams.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:officer.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const at = (offset,time) => `${day(offset)}T${time}+02:00`;
  const publisher = await account(`exams.publisher.${stamp}@example.com`);
  await api("POST","/api/access/role-assignments",{accountId:publisher.id,roleCode:"examinations_officer",scope:{},reason:"Examinations office"},admin.token);
  const sittingsBase = `/api/exams/periods/${period.id}`;
  let historicalPublication;
  const assessmentBase = `/api/assessment/offerings/${period.id}/${courses[0].id}`;
  const orderInput = {paper:'Paper 1',durationMinutes:180,paperReference:'SAMPLE-VAULT-1',materialsAllowed:'Non-programmable calculator',requirements:'Two spare copies',reason:'Module final examination'};
  await denied('POST',`${assessmentBase}/orders`,orderInput,outsider.token,404);
  await page.goto('/#registry');
  await submit(page.locator('[data-registry-login]'),{email:lecturer.email,password:lecturer.password});
  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  await page.locator('[data-exam-orders] > summary').click();
  await submit(page.locator('[data-exam-order-submit]'),{...orderInput,paperReference:'SAMPLE-VAULT-DRAFT'});
  await expect(page.getByRole('status')).toHaveText('Exam order submitted for review.');
  let orderView = await api('GET',assessmentBase,undefined,lecturer.token);
  const returnedOrder = orderView.examOrders[0];
  await denied('POST',`${assessmentBase}/orders`,orderInput,lecturer.token,409);
  await api('POST','/api/access/role-assignments',{accountId:(await api('GET','/api/identity/me',undefined,lecturer.token)).account.id,roleCode:'examinations_officer',scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:'Test separation with review authority'},admin.token);
  await denied('POST',`/api/exams/orders/${returnedOrder.id}/review`,{outcome:'approved',reason:'Own order'},lecturer.token,403);
  await api('POST',`/api/exams/orders/${returnedOrder.id}/review`,{outcome:'returned',reason:'Confirm final paper custody reference'},officer.token);
  await denied('POST',`/api/exams/orders/${returnedOrder.id}/review`,{outcome:'approved',reason:'Already reviewed'},officer.token,409);
  orderView = await api('POST',`${assessmentBase}/orders`,orderInput,lecturer.token);
  const order = orderView.examOrders.find((row) => row.status === 'submitted');
  await denied('POST',`${sittingsBase}/sittings`,{courseId:courses[0].id,...orderInput,startsAt:at(3,'09:00'),venue:'Hall'},officer.token,400);
  const orderedSitting = {courseId:courses[0].id,paper:'Paper 1',durationMinutes:180,startsAt:at(3,'09:00'),venue:'Hall',reason:'Ordered sitting'};
  await denied('POST',`${sittingsBase}/sittings`,{...orderedSitting,orderId:order.id},officer.token,409);
  await denied('POST',`${sittingsBase}/sittings`,orderedSitting,officer.token,409);
  await page.locator('[data-registry-signout]').click();

  // Validation and authority, before anything is scheduled.
  await denied("POST",`${sittingsBase}/sittings`,{courseId:courses[0].id,paper:"Paper 1",startsAt:`${day(3)}T09:00`,durationMinutes:180,venue:"Hall",reason:"No offset"},officer.token,400);
  await denied("POST",`${sittingsBase}/sittings`,{courseId:courses[0].id,paper:"Paper 1",startsAt:at(90,"09:00"),durationMinutes:180,venue:"Hall",reason:"Outside window"},officer.token,409);
  await denied("POST",`${sittingsBase}/sittings`,{courseId:"course_missing",paper:"Paper 1",startsAt:at(3,"09:00"),durationMinutes:180,venue:"Hall",reason:"Not offered"},officer.token,404);
  await denied("POST",`${sittingsBase}/sittings`,{courseId:courses[0].id,paper:"Paper 1",startsAt:at(3,"09:00"),durationMinutes:180,venue:"Hall",reason:"Student"},students[0].token,403);
  await denied("POST",`${sittingsBase}/publish`,{revision:1,reason:"Nothing yet"},publisher.token,409);

  // The officer schedules two sittings in the UI that clash for both students, one in an undersized venue.
  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:officer.email,password:officer.password});
  await page.locator("[data-exams-panel] > summary").click();
  await page.locator(`[data-exam-period="${period.id}"]`).click();
  await page.locator('[data-exam-order-panel] > summary').click();
  await submit(page.locator(`[data-exam-order-review="${order.id}"]`),{outcome:'approved',reason:'Final paper held in the vault; materials checked'});
  await expect(page.getByRole('status')).toHaveText('Exam order reviewed.');
  await denied('POST',`${sittingsBase}/sittings`,{...orderedSitting,orderId:order.id,durationMinutes:120},officer.token,409);
  await denied('POST',`${sittingsBase}/sittings`,{...orderedSitting,orderId:order.id,courseId:courses[1].id},officer.token,409);
  await page.locator("[data-exam-schedule-panel] > summary").click();
  await page.locator('[data-exam-schedule] [name="orderId"]').selectOption(order.id);
  await expect(page.locator('[data-exam-schedule] [name="durationMinutes"]')).toHaveValue('180');
  await submit(page.locator("[data-exam-schedule]"),{startsAt:`${day(3)}T09:00`,venue:"Great Hall",capacity:1,reason:"Main sitting"});
  await expect(page.getByRole("status")).toHaveText("Sitting scheduled.");
  await page.locator("[data-exam-schedule-panel] > summary").click();
  await submit(page.locator("[data-exam-schedule]"),{courseId:courses[1].id,paper:"Paper 1",startsAt:`${day(3)}T10:00`,durationMinutes:120,venue:"Lab 2",reason:"Main sitting"});
  await expect(page.getByRole("status")).toHaveText("Sitting scheduled.");
  await expect(page.locator("[data-exam-clash]")).toHaveCount(1);
  await expect(page.locator("[data-exam-clash]")).toContainText("for 2 student(s)");
  await expect(page.locator("[data-exam-capacity]")).toContainText("Great Hall: 2 candidates for capacity 1");
  await expect(page.locator("[data-exam-publish-blocked]")).toBeVisible();
  let view = await api("GET",sittingsBase,undefined,officer.token);
  expect(view.timetable).toMatchObject({status:"draft",revision:2});
  const reportPath = `/api/reports/examinations?periodId=${encodeURIComponent(period.id)}`;
  const initialReport = await api('GET',reportPath,undefined,lecturer.token);
  expect(initialReport.totals).toEqual({ordersSubmitted:0,ordersReturned:1,draftTimetables:1,scheduledSittings:2,publicationEditions:0});
  expect(initialReport.rows.map((row) => row.periodId)).toEqual([period.id]);
  expect(initialReport.availablePeriods.every((row) => row.programmeCode === programme.code && row.intakeId === intake.id)).toBe(true);
  expect(JSON.stringify(initialReport)).not.toMatch(/studentNumber|candidateAccounts|accountId|requestNote|paperReference/);
  const dictionary = await api('GET','/api/reports/examinations/dictionary',undefined,officer.token);
  expect(dictionary.definitionVersion).toBe(initialReport.definitionVersion);expect(dictionary.metrics).toHaveLength(5);
  for (const path of [reportPath,`${reportPath}&format=csv`,'/api/reports/examinations/dictionary']) await denied('GET',path,undefined,students[0].token,403);
  await denied('GET',`${reportPath}&asOf=2026-01-01`,undefined,officer.token,400);
  await page.locator('[data-examination-report] > summary').click();
  await page.locator('[data-examination-report-filter] [name="periodId"]').selectOption(period.id);
  await page.getByRole('button',{name:'Refresh report',exact:true}).click();
  await expect(page.locator('[data-report-period]')).toHaveCount(1);
  await expect(page.locator('[data-report-metric="scheduledSittings"] td').nth(1)).toHaveText('2');
  const workloadDownloadEvent = page.waitForEvent('download');await page.locator('[data-examination-report-export]').click();
  const workloadDownload = await workloadDownloadEvent,workloadCsv = await readFile(await workloadDownload.path(),'utf8');
  expect(workloadDownload.suggestedFilename()).toContain('examination-operations-');expect(workloadCsv).toContain(initialReport.definitionVersion);expect(workloadCsv).toContain('owner approval pending');
  expect(workloadCsv).not.toMatch(/S250|paperReference|PRIVATE-/);
  expect(view.offerings.map((row) => [row.candidates,row.sittings])).toEqual([[2,1],[2,1]]);
  const [first,second] = [courses[0].id,courses[1].id].map((courseId) => view.sittings.find((row) => row.courseId === courseId));
  const secondOrderContext = await api('POST',`/api/assessment/offerings/${period.id}/${courses[1].id}/orders`,{...orderInput,paper:'Paper 2'},admin.token);
  const secondOrder = secondOrderContext.examOrders[0];
  await denied('POST',`/api/exams/sittings/${second.id}`,{revision:1,paper:'Paper 2',reason:'Try renaming a direct sitting to an ordered paper'},officer.token,409);
  await api('POST',`/api/exams/orders/${secondOrder.id}/review`,{outcome:'returned',reason:'Not required this semester'},officer.token);
  expect(first).toMatchObject({paper:"Paper 1",durationMinutes:180,venue:"Great Hall",capacity:1,localDate:day(3),orderId:order.id});
  expect(view.orders.find((row) => row.id === order.id).sittingId).toBe(first.id);
  await denied('POST',`/api/exams/sittings/${first.id}`,{revision:1,durationMinutes:120,reason:'Unapproved duration change'},officer.token,409);
  await denied('POST',`${sittingsBase}/sittings`,{...orderedSitting,orderId:order.id},officer.token,409);
  await denied("POST",`${sittingsBase}/sittings`,{courseId:courses[0].id,paper:"paper 1",startsAt:at(4,"09:00"),durationMinutes:60,venue:"Hall",reason:"Duplicate paper"},officer.token,409);
  await denied("POST",`${sittingsBase}/publish`,{revision:2,reason:"Own changes"},officer.token,403);
  await denied("POST",`${sittingsBase}/publish`,{revision:2,reason:"Clashes remain"},publisher.token,409);
  await denied("POST",`/api/exams/sittings/${second.id}`,{revision:5,venue:"Hall",reason:"Stale"},officer.token,409);

  // Moving the second sitting and enlarging the venue clears every issue.
  await page.locator(`[data-exam-edit-panel="${second.id}"] > summary`).click();
  await submit(page.locator(`[data-exam-change="${second.id}"]`),{startsAt:`${day(4)}T09:00`,reason:"Avoid the clash"});
  await expect(page.getByRole("status")).toHaveText("Sitting changed.");
  await page.locator(`[data-exam-edit-panel="${first.id}"] > summary`).click();
  await submit(page.locator(`[data-exam-change="${first.id}"]`),{capacity:50,reason:"Larger hall booked"});
  await expect(page.getByRole("status")).toHaveText("Sitting changed.");
  await expect(page.locator("[data-exam-issues]")).toHaveCount(0);
  view = await api("GET",sittingsBase,undefined,officer.token);
  expect(view.timetable.revision).toBe(4);
  const exported = page.waitForEvent("download");
  await page.locator("[data-exam-export]").click();
  const csv = await readFile(await (await exported).path(),"utf8");
  expect(csv.trim().split(/\r\n/)).toHaveLength(3);
  expect(csv).toContain(`${courses[0].code},Marks native course,Paper 1,`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  // A different examinations officer publishes in the UI; candidates are notified.
  const publisherContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,timezoneId:"Africa/Harare"});
  try {
    const desk = await publisherContext.newPage(); desk.setDefaultTimeout(15_000);
    await desk.goto("/#registry"); await submit(desk.locator("[data-registry-login]"),{email:publisher.email,password:publisher.password});
    await desk.locator("[data-exams-panel] > summary").click();
    await desk.locator(`[data-exam-period="${period.id}"]`).click();
    await submit(desk.locator("[data-exam-publish]"),{reason:"Checked against venue bookings"});
    await expect(desk.getByRole("status")).toHaveText("Timetable published and candidates notified.");
    await expect(desk.locator("[data-exam-status]")).toHaveText("Published revision 4");
  } finally {await publisherContext.close();}
  await denied("POST",`${sittingsBase}/publish`,{revision:4,reason:"Again"},publisher.token,409);
  for (const student of students) {
    const own = await api("GET",`/api/registry/me/programmes/${student.id}/exams`,undefined,student.token);
    expect(own[0].sittings.map((row) => [row.code,row.paper,row.venue])).toEqual([[courses[0].code,"Paper 1","Great Hall"],[courses[1].code,"Paper 1","Lab 2"]]);
    const accountId = (await api("GET","/api/identity/me",undefined,student.token)).account.id;
    const notices = (await api("GET",`/api/notifications?recipientAccountId=${accountId}`,undefined,admin.token)).map((row) => row.payload.subject);
    expect(notices.some((subject) => /examination timetable is published$/.test(subject))).toBe(true);
  }
  await denied("GET",`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[1].token,404);

  // Later changes stay in draft: students keep the published version until it is republished.
  await api("POST",`/api/exams/sittings/${second.id}`,{revision:2,cancel:true,reason:"Assessed by coursework only"},officer.token);
  expect((await api("GET",sittingsBase,undefined,officer.token)).timetable).toMatchObject({status:"draft",revision:5,publishedRevision:4});
  expect((await api("GET",`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings).toHaveLength(2);
  await denied("POST",`/api/exams/sittings/${second.id}`,{revision:3,venue:"Hall",reason:"Cancelled"},officer.token,409);
  await api("POST",`${sittingsBase}/publish`,{revision:5,reason:"Coursework-only change"},publisher.token);
  expect((await api("GET",`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings.map((row) => row.code)).toEqual([courses[0].code]);
  const events = await api("GET",`/api/audit/events?subjectId=${period.id}`,undefined,admin.token);
  expect(events.filter((row) => row.action === "exams.timetable.published").map((row) => row.metadata.revision).sort()).toEqual([4,5]);

  const studentContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,timezoneId:"Africa/Harare"});
  try {
    const portal = await studentContext.newPage(); portal.setDefaultTimeout(15_000);
    await portal.goto("/#apply"); await submit(portal.locator('[data-form="signin"]'),{email:students[0].email,password:students[0].password});
    await expect(portal.locator("[data-student-exam]")).toHaveCount(1);
    await expect(portal.locator("[data-student-exams]")).toContainText("Great Hall");
    const calendarFile = portal.waitForEvent("download");
    await portal.locator(`[data-student-exam-ics="${period.id}"]`).click();
    const ics = await readFile(await (await calendarFile).path(),"utf8");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain(`DTSTART:${day(3).replaceAll("-","")}T070000Z`);
    expect(ics).toContain("LOCATION:Great Hall");
    expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
    await portal.screenshot({path:info.outputPath("student-exams.png"),fullPage:true});
  } finally {await studentContext.close();}
  await page.screenshot({path:info.outputPath("exam-timetable.png"),fullPage:true});
  // Cancellation frees the same approved order for a replacement sitting, retaining the cancelled sitting's history.
  await api('POST',`/api/exams/sittings/${first.id}`,{revision:2,cancel:true,reason:'Rebook approved paper'},officer.token);
  const replacement = await api('POST',`${sittingsBase}/sittings`,{...orderedSitting,orderId:order.id,startsAt:at(5,'09:00')},officer.token);
  expect(replacement.orders.find((row) => row.id === order.id).sittingId).not.toBe(first.id);
  const orderEvents = await api('GET',`/api/audit/events?subjectId=${order.id}`,undefined,admin.token);
  expect(orderEvents.map((row) => row.action)).toEqual(expect.arrayContaining(['exams.order.submitted','exams.order.approved']));
  expect((await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings[0]).not.toHaveProperty('paperReference');

  const venueInput = {code:info.project.name === 'desktop' ? 'EXRM-D' : 'EXRM-M',name:'SAMPLE Examination Hall',campus:'Main campus',location:'Science wing, ground floor',capacity:50,reason:'Verified room register'};
  await denied('POST','/api/exams/venues',venueInput,students[0].token,403);
  await denied('POST','/api/exams/venues',venueInput,lecturer.token,403);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
  await page.locator('[data-exam-venues-panel] > summary').click();
  await page.locator('[data-exam-venue-create-panel] > summary').click();
  await submit(page.locator('[data-exam-venue=""]'),venueInput);
  await expect(page.getByRole('status')).toHaveText('Venue registered.');
  let venue = (await api('GET','/api/exams/venues',undefined,officer.token)).items.find((row) => row.code === venueInput.code);
  await denied('POST','/api/exams/venues',venueInput,officer.token,409);
  await denied('POST',`${sittingsBase}/sittings`,{courseId:courses[1].id,paper:'Override capacity',startsAt:at(6,'09:00'),durationMinutes:60,venueId:venue.id,capacity:999,reason:'Cannot override catalogue'},officer.token,400);
  const sittingId = replacement.sittings.find((row) => row.status === 'scheduled').id;
  if (!await page.locator('[data-exams-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exams-panel] > summary').click();
  await page.locator(`[data-exam-period="${period.id}"]`).click();
  await page.locator(`[data-exam-edit-panel="${sittingId}"] > summary`).click();
  await submit(page.locator(`[data-exam-change="${sittingId}"]`),{venueId:venue.id,reason:'Book managed room'});
  await expect(page.getByRole('status')).toHaveText('Sitting changed.');
  let resourceView = await api('GET',sittingsBase,undefined,officer.token),sitting = resourceView.sittings.find((row) => row.id === sittingId);
  expect(sitting).toMatchObject({venueId:venue.id,venueRevision:1,capacity:50});
  await page.locator(`[data-exam-invigilators-panel="${sittingId}"] > summary`).click();
  const dutyForm = page.locator(`[data-exam-invigilators="${sittingId}"]`);
  await dutyForm.locator(`[name="staffIds"][value="${lecturer.staffId}"]`).check();
  await submit(dutyForm,{[`role:${lecturer.staffId}`]:'lead',reason:'Lead invigilator appointment'});
  await expect(page.getByRole('status')).toHaveText('Invigilators saved.');
  expect(await api('GET','/api/exams/duties/me',undefined,lecturer.token)).toEqual([]);
  resourceView = await api('GET',sittingsBase,undefined,officer.token); sitting = resourceView.sittings.find((row) => row.id === sittingId);
  const dutyPayload = {revision:sitting.revision,entries:[{staffId:lecturer.staffId,role:'lead'}],reason:'Duty roster'};
  await denied('POST',`/api/exams/sittings/${sittingId}/invigilators`,{...dutyPayload,revision:1},officer.token,409);
  await denied('POST',`/api/exams/sittings/${sittingId}/invigilators`,{...dutyPayload,entries:[dutyPayload.entries[0],dutyPayload.entries[0]]},officer.token,400);
  await denied('POST',`/api/exams/sittings/${sittingId}/invigilators`,{...dutyPayload,entries:[{staffId:lecturer.staffId,role:'lead'},{staffId:outsider.staffId,role:'lead'}]},officer.token,400);

  const otherIntake = await api('POST','/api/master-data/intakes',{programmeId:programme.id,label:`SAMPLE competing ${stamp}`,capacity:5,startsOn:'2025-01-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+30*86400000).toISOString()},admin.token);
  await api('POST',`/api/master-data/intakes/${otherIntake.id}/transitions`,{toStatus:'published',reason:'Competing timetable fixture'},admin.token);
  const otherPerson = await account(`exams.competing.${stamp}@example.com`),otherProgramme = await admit(otherPerson,otherIntake);
  const otherBase = `/api/registry/programmes/${otherProgramme.id}`;
  const otherPeriod = await api('POST',`${otherBase}/registration-periods`,{academicPeriodId:term.id,yearOfStudy:1,term:'S1',creditLimit:30,reason:'Second exam timetable'},admin.token);
  await api('POST',`${otherBase}/registration-periods/${otherPeriod.id}`,{offerings:courses.map((row) => ({courseId:row.id,delivery:'asynchronous',meetings:[]})),reason:'Other offerings'},admin.token);
  await api('POST',`${otherBase}/registration-periods/${otherPeriod.id}`,{toStatus:'open',reason:'Open second period'},admin.token);
  let otherView = await api('POST',`/api/exams/periods/${otherPeriod.id}/sittings`,{courseId:courses[1].id,paper:'Other period paper',startsAt:at(5,'09:00'),durationMinutes:60,venueId:venue.id,reason:'Shared room conflict'},officer.token);
  let otherSitting = otherView.sittings[0];
  expect(otherView.resourceIssues.some((row) => row.kind === 'room')).toBe(true);
  expect(otherView.resourceIssues.every((row) => !row.otherPeriodId)).toBe(true);
  await denied('POST',`/api/exams/sittings/${otherSitting.id}/invigilators`,{revision:otherSitting.revision,entries:[{staffId:lecturer.staffId,role:'lead'}],reason:'Wrong scope'},lecturer.token,404);
  await denied('POST',`/api/exams/sittings/${otherSitting.id}/invigilators`,{revision:otherSitting.revision,entries:[{staffId:lecturer.staffId,role:'lead'}],reason:'Double duty'},officer.token,409);
  const races = await Promise.all([
    request.post(`/api/exams/sittings/${sittingId}/invigilators`,{data:{revision:sitting.revision,entries:[...dutyPayload.entries,{staffId:outsider.staffId,role:'invigilator'}],reason:'Concurrent second invigilator'},headers:{Authorization:`Bearer ${officer.token}`}}),
    request.post(`/api/exams/sittings/${otherSitting.id}/invigilators`,{data:{revision:otherSitting.revision,entries:[{staffId:outsider.staffId,role:'lead'}],reason:'Concurrent second invigilator'},headers:{Authorization:`Bearer ${officer.token}`}})
  ]);
  expect(races.map((row) => row.status()).sort()).toEqual([200,409]);
  resourceView = await api('GET',sittingsBase,undefined,officer.token);
  await denied('POST',`${sittingsBase}/publish`,{revision:resourceView.timetable.revision,reason:'Room still double booked'},publisher.token,409);
  otherView = await api('GET',`/api/exams/periods/${otherPeriod.id}`,undefined,officer.token);otherSitting = otherView.sittings[0];
  await api('POST',`/api/exams/sittings/${otherSitting.id}`,{revision:otherSitting.revision,cancel:true,reason:'Release shared room and staff'},officer.token);
  resourceView = await api('GET',sittingsBase,undefined,officer.token);sitting = resourceView.sittings.find((row) => row.id === sittingId);
  resourceView = await api('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:sitting.revision,entries:[...dutyPayload.entries,{staffId:outsider.staffId,role:'invigilator'}],reason:'Both staff now available'},officer.token);
  let inactive = await api('GET',`/api/staff/${outsider.staffId}`,undefined,admin.token);
  await api('POST',`/api/staff/${outsider.staffId}/status`,{revision:inactive.revision,toStatus:'suspended',effectiveOn:day(0),reason:'Unavailable for examination duty'},admin.token);
  resourceView = await api('GET',sittingsBase,undefined,officer.token);sitting = resourceView.sittings.find((row) => row.id === sittingId);
  expect(resourceView.resourceIssues.some((row) => row.kind === 'staff')).toBe(true);
  await denied('POST',`${sittingsBase}/publish`,{revision:resourceView.timetable.revision,reason:'Inactive invigilator'},publisher.token,409);
  await denied('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:sitting.revision,entries:[{staffId:outsider.staffId,role:'lead'}],reason:'Inactive selection'},officer.token,409);
  resourceView = await api('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:sitting.revision,entries:dutyPayload.entries,reason:'Remove unavailable staff'},officer.token);

  const {code,...venueUpdate} = venueInput;
  venue = await api('POST',`/api/exams/venues/${venue.id}`,{...venueUpdate,revision:1,status:'active',capacity:1,reason:'Capacity remeasured'},officer.token);
  await denied('POST',`/api/exams/venues/${venue.id}`,{...venueUpdate,revision:1,status:'inactive'},officer.token,409);
  await denied('POST',`${sittingsBase}/publish`,{revision:resourceView.timetable.revision,reason:'Stale venue'},publisher.token,409);
  sitting = resourceView.sittings.find((row) => row.id === sittingId);
  resourceView = await api('POST',`/api/exams/sittings/${sittingId}`,{revision:sitting.revision,venueId:venue.id,reason:'Re-pin measured capacity'},officer.token);
  expect(resourceView.capacity).toHaveLength(1);
  venue = await api('POST',`/api/exams/venues/${venue.id}`,{...venueUpdate,revision:2,status:'active',capacity:50,reason:'Use approved seated capacity'},officer.token);
  sitting = resourceView.sittings.find((row) => row.id === sittingId);
  resourceView = await api('POST',`/api/exams/sittings/${sittingId}`,{revision:sitting.revision,venueId:venue.id,reason:'Re-pin approved capacity'},officer.token);
  expect(resourceView.resourceIssues).toEqual([]);
  await api('POST',`${sittingsBase}/publish`,{revision:resourceView.timetable.revision,reason:'Checked room and invigilator roster'},publisher.token);
  const ownDuties = await api('GET','/api/exams/duties/me',undefined,lecturer.token);
  expect(ownDuties[0].sittings[0]).toMatchObject({id:sittingId,role:'lead',venueLocation:'Main campus - Science wing, ground floor'});
  expect(ownDuties[0].sittings[0]).not.toHaveProperty('invigilators');
  const studentSnapshot = (await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings[0];
  expect(studentSnapshot.venueLocation).toBe('Main campus - Science wing, ground floor');
  expect(studentSnapshot).not.toHaveProperty('invigilators');
  const history = await api('GET',`/api/exams/venues/${venue.id}/history`,undefined,officer.token);
  expect(history.map((row) => row.revision)).toEqual([3,2,1]);
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:lecturer.email,password:lecturer.password});
  await expect(page.locator(`[data-exam-duty="${sittingId}"]`)).toContainText('Lead');
  const dutyDownload = page.waitForEvent('download');
  await page.locator(`[data-exam-duties] [data-student-exam-ics="${period.id}"]`).click();
  expect(await readFile(await (await dutyDownload).path(),'utf8')).toContain(`UID:${sittingId}@southvalley.exams`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath('invigilation-duties.png'),fullPage:true});
  await page.locator('[data-registry-signout]').click();
  await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
  if (!await page.locator('[data-exam-venues-panel]').evaluate((element) => element.open)) await page.locator('[data-exam-venues-panel] > summary').click();
  if (!await page.locator(`[data-exam-venue-panel="${venue.id}"]`).evaluate((element) => element.open)) await page.locator(`[data-exam-venue-panel="${venue.id}"] > summary`).click();
  await page.locator('[data-exam-venues-panel]').screenshot({path:info.outputPath('exam-venues.png')});
  const finalPaperRelease = await paperCustody();
  const arrangementActors = await candidateArrangements();
  resourceView = await api('GET',sittingsBase,undefined,officer.token);sitting = resourceView.sittings.find((row) => row.id === sittingId);
  let removed = await api('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:sitting.revision,entries:[],reason:'Staff replacement pending'},officer.token);
  await denied('POST',`/api/exams/paper-releases/${finalPaperRelease.id}/download`,{reason:'Draft roster immediately blocks delivery'},lecturer.token,409);
  await denied('GET',`/api/exams/sittings/${sittingId}/manifest`,undefined,officer.token,409);
  await denied('GET',`/api/exams/me/sittings/${sittingId}/manifest`,undefined,lecturer.token,409);
  expect((await api('GET','/api/exams/duties/me',undefined,lecturer.token))[0].sittings).toHaveLength(1);
  sitting = removed.sittings.find((row) => row.id === sittingId);
  removed = await api('POST',`/api/exams/sittings/${sittingId}`,{revision:sitting.revision,venueId:null,venue:'Manual alternative hall',reason:'Room move pending publication'},officer.token);
  otherView = await api('POST',`/api/exams/periods/${otherPeriod.id}/sittings`,{courseId:courses[1].id,paper:'Replacement other paper',startsAt:at(5,'09:00'),durationMinutes:60,venueId:venue.id,reason:'Published room remains reserved'},officer.token);
  otherSitting = otherView.sittings.find((row) => row.status === 'scheduled');
  expect(otherView.resourceIssues.some((row) => row.kind === 'room')).toBe(true);
  await denied('POST',`/api/exams/sittings/${otherSitting.id}/invigilators`,{revision:otherSitting.revision,entries:[{staffId:lecturer.staffId,role:'lead'}],reason:'Published duty remains reserved'},officer.token,409);
  await api('POST',`${sittingsBase}/publish`,{revision:removed.timetable.revision,reason:'Publish cleared optional roster'},publisher.token);
  expect(await api('GET','/api/exams/duties/me',undefined,lecturer.token)).toEqual([]);
  await denied('GET',`/api/exams/me/sittings/${sittingId}/manifest`,undefined,lecturer.token,404);
  otherView = await api('GET',`/api/exams/periods/${otherPeriod.id}`,undefined,officer.token);
  expect(otherView.resourceIssues).toEqual([]);
  otherView = await api('POST',`/api/exams/sittings/${otherSitting.id}/invigilators`,{revision:otherSitting.revision,entries:[{staffId:lecturer.staffId,role:'lead'}],reason:'Published duty released'},officer.token);
  await api('POST',`/api/exams/periods/${otherPeriod.id}/publish`,{revision:otherView.timetable.revision,reason:'Publish replacement duty'},publisher.token);
  otherSitting = otherView.sittings.find((row) => row.status === 'scheduled');
  otherView = await api('POST',`/api/exams/sittings/${otherSitting.id}`,{revision:otherSitting.revision,cancel:true,reason:'Cancel all published papers'},officer.token);
  expect((await api('GET','/api/exams/duties/me',undefined,lecturer.token))[0].sittings).toHaveLength(1);
  await api('POST',`/api/exams/periods/${otherPeriod.id}/publish`,{revision:otherView.timetable.revision,reason:'Publish complete cancellation'},publisher.token);
  expect(await api('GET','/api/exams/duties/me',undefined,lecturer.token)).toEqual([]);
  resourceView = await api('GET',sittingsBase,undefined,officer.token);sitting = resourceView.sittings.find((row) => row.status === 'scheduled');
  resourceView = await api('POST',`/api/exams/sittings/${sitting.id}`,{revision:sitting.revision,cancel:true,reason:'Withdraw final published sitting'},officer.token);
  await api('POST',`${sittingsBase}/publish`,{revision:resourceView.timetable.revision,reason:'Notify complete timetable cancellation'},publisher.token);
  const cancelledEdition = await api('GET',`${sittingsBase}/publications/${resourceView.timetable.revision}`,undefined,officer.token);
  expect(cancelledEdition.sittings).toEqual([]);
  const cancelledReport = await api('GET',reportPath,undefined,lecturer.token);
  expect(cancelledReport.totals.scheduledSittings).toBe(0);expect(cancelledReport.totals.draftTimetables).toBe(0);
  expect(cancelledReport.totals.publicationEditions).toBeGreaterThan(1);
  expect(cancelledReport.controlsVersion).toBe('exam-source-controls-v1');
  expect(Object.values(cancelledReport.controls).every(Boolean)).toBe(true);
  expect(cancelledReport.rows.every((row) => Object.values(row.controls).every(Boolean))).toBe(true);
  await denied('GET',`/api/reports/examinations?periodId=${otherPeriod.id}`,undefined,lecturer.token,404);
  await denied('GET',`${reportPath}&format=csv`,undefined,otherPerson.token,404);
  if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')) throw new Error('Report source reconciliation requires the isolated database.');
  const reportDb = new pg.Client({connectionString:process.env.DATABASE_URL});await reportDb.connect();
  try {
    const controls = (await reportDb.query(`select
      (select count(*)::integer from exam_orders where period_id = $1 and status = 'submitted') as "ordersSubmitted",
      (select count(*)::integer from exam_orders where period_id = $1 and status = 'returned') as "ordersReturned",
      (select count(*)::integer from exam_timetables where period_id = $1 and status = 'draft') as "draftTimetables",
      (select count(*)::integer from exam_sittings where period_id = $1 and status = 'scheduled') as "scheduledSittings",
      (select count(*)::integer from exam_publications where period_id = $1) as "publicationEditions"`,[period.id])).rows[0];
    expect(cancelledReport.totals).toEqual(controls);
    const original=(await reportDb.query('select published_revision from exam_timetables where period_id = $1',[period.id])).rows[0].published_revision;
    try {
      await reportDb.query('update exam_timetables set published_revision = revision + 100 where period_id = $1',[period.id]);
      await denied('GET',reportPath,undefined,lecturer.token,409);
      await denied('GET',`${reportPath}&format=csv`,undefined,lecturer.token,409);
    } finally {await reportDb.query('update exam_timetables set published_revision = $2 where period_id = $1',[period.id,original]);}
    expect((await api('GET',reportPath,undefined,lecturer.token)).totals).toEqual(cancelledReport.totals);
  } finally {await reportDb.end();}
  const reportEvents = await api('GET',`/api/audit/events?subjectId=${initialReport.definitionVersion}`,undefined,admin.token);
  expect(reportEvents.map((row) => row.action)).toEqual(expect.arrayContaining(['reports.examinations.accessed','reports.examinations.exported']));
  expect(JSON.stringify(reportEvents)).not.toMatch(/S250|candidateAccounts|PRIVATE-/);
  expect((await api('GET',`${sittingsBase}/publications/${historicalPublication.revision}/sittings/${sittingId}/manifest`,undefined,officer.token)).rooms.flatMap((room) => room.candidates)).toHaveLength(2);
  expect(await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token)).toEqual([]);
  await denied('GET',`/api/exams/sittings/${sittingId}/manifest`,undefined,officer.token,409);
  const studentAccountId = (await api('GET','/api/identity/me',undefined,students[0].token)).account.id;
  expect((await api('GET',`/api/notifications?recipientAccountId=${studentAccountId}`,undefined,admin.token)).some((row) => row.payload.subject.endsWith('examination timetable is updated') && row.payload.body.includes('0 sitting(s)'))).toBe(true);
  const lecturerId = (await api('GET','/api/identity/me',undefined,lecturer.token)).account.id;
  expect((await api('GET',`/api/notifications?recipientAccountId=${lecturerId}`,undefined,admin.token)).some((row) => row.payload.subject.endsWith('invigilation duties are updated') && row.payload.body.includes('0 sitting(s)'))).toBe(true);
  await arrangementArchive(arrangementActors);

  async function arrangementArchive({coordinator,reviewer}) {
    const historyBase = '/api/exams/arrangements/history',ownHistory = (person) => `/api/registry/me/programmes/${person.id}/exam-arrangements`;
    await denied('GET',historyBase,undefined,officer.token,403);
    await denied('GET',ownHistory(students[0]),undefined,students[1].token,404);
    await denied('GET',`${historyBase}?limit=101`,undefined,coordinator.token,400);
    await denied('GET',`${historyBase}?offset=-1`,undefined,coordinator.token,400);
    await denied('GET',`${historyBase}?status=deleted`,undefined,coordinator.token,400);
    expect((await api('GET',historyBase,undefined,otherPerson.token)).total).toBe(0);
    const probe = await api('POST',`${sittingsBase}/sittings`,{courseId:courses[1].id,paper:'Archive pending only',startsAt:at(6,'09:00'),durationMinutes:60,venue:'Historical case probe room',reason:'Cancelled-case discovery fixture'},officer.token);
    const probeRow = probe.sittings.find((row) => row.paper === 'Archive pending only'),caseBase = `/api/exams/sittings/${probeRow.id}/arrangements`;
    const candidates = (await api('GET',caseBase,undefined,coordinator.token)).candidates;
    const cases = [];
    for (const [index,person] of students.entries()) {
      const data = await api('POST',caseBase,{registrationId:candidates.find((row) => row.studentNumber === person.studentNumber).registrationId,extraMinutes:0,separateRoom:false,requestNote:`PRIVATE-ARCHIVE-${index}`,evidenceRef:`PRIVATE-ARCHIVE-REF-${index}`},coordinator.token);
      cases.push(data.cases.find((row) => row.studentNumber === person.studentNumber));
    }
    const cancelled = await api('POST',`/api/exams/sittings/${probeRow.id}`,{revision:probeRow.revision,cancel:true,reason:'Cancel a sitting with pending private requests'},officer.token);
    await api('POST',`${sittingsBase}/publish`,{revision:cancelled.timetable.revision,reason:'Published timetable remains empty'},publisher.token);
    await denied('POST',`/api/exams/arrangements/${cases[1].id}/review`,{revision:1,outcome:'approved',reviewNote:'Cannot approve cancelled sitting',instruction:'Not an active examination'},reviewer.token,409);
    await denied('POST',`/api/exams/me/sittings/${probeRow.id}/arrangements`,{extraMinutes:0,separateRoom:false,requestNote:'Cancelled sitting',evidenceRef:'NO'},students[0].token,409);
    const firstPage = await api('GET',`${historyBase}?q=Archive%20pending%20only&limit=1`,undefined,reviewer.token);
    const nextPage = await api('GET',`${historyBase}?q=Archive%20pending%20only&limit=1&offset=1`,undefined,reviewer.token);
    expect(firstPage.total).toBe(2);expect(firstPage.items).toHaveLength(1);expect(nextPage.items).toHaveLength(1);expect(firstPage.items[0].id).not.toBe(nextPage.items[0].id);
    expect(JSON.stringify([firstPage,nextPage])).not.toContain('PRIVATE-');
    for (const item of [...firstPage.items,...nextPage.items]) {expect(item.sittingStatus).toBe('cancelled');expect(item).not.toHaveProperty('accountId');expect(item).not.toHaveProperty('requestNote');}
    const self = await api('GET',`${ownHistory(students[0])}?q=Archive%20pending%20only`,undefined,students[0].token);
    expect(self.total).toBe(1);expect(self.items[0].id).toBe(cases[0].id);expect(self.items[0]).not.toHaveProperty('studentNumber');
    expect((await api('GET',`${ownHistory(students[0])}?q=${students[1].studentNumber}`,undefined,students[0].token)).total).toBe(0);
    const peerView = await api('GET',`/api/exams/me/sittings/${probeRow.id}/arrangements`,undefined,students[1].token);
    expect(peerView.cases.map((row) => row.id)).toEqual([cases[1].id]);expect(peerView.capabilities.request).toBe(false);
    await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:reviewer.email,password:reviewer.password});
    await page.locator('[data-arrangement-history-workspace] > summary').click();
    await submit(page.locator('[data-arrangement-history-filter]'),{q:'Archive pending only',status:'requested'});
    await expect(page.locator('[data-arrangement-history-open]')).toHaveCount(2);
    await page.locator(`[data-arrangement-history-open="${cases[1].id}"]`).click();
    await expect(page.locator('[data-arrangement-request]')).toHaveCount(0);
    await expect(page.locator(`[data-arrangement-review="${cases[1].id}"] option[value="approved"]`)).toHaveCount(0);
    await submit(page.locator(`[data-arrangement-review="${cases[1].id}"]`),{outcome:'returned',reviewNote:'PRIVATE-ARCHIVE-RETURN'});
    await expect(page.getByRole('status')).toHaveText('Arrangement reviewed.');
    await expect(page.locator('[data-arrangement-history-open]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await page.locator('[data-arrangement-history-open]').evaluate((button) => {
      const parent = button.getBoundingClientRect();return [...button.querySelectorAll('span')].every((span) => {const rect = span.getBoundingClientRect();return rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom;});
    })).toBe(true);
    await page.evaluate(() => window.scrollTo(0,0));await page.screenshot({path:info.outputPath('staff-arrangement-archive.png'),fullPage:true});
    const context = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,timezoneId:'Africa/Harare'});
    try {
      const portal = await context.newPage();portal.setDefaultTimeout(15_000);
      await portal.goto('/#apply');await submit(portal.locator('[data-form="signin"]'),{email:students[0].email,password:students[0].password});
      await expect(portal.locator('[data-student-exams]')).toHaveCount(0);
      await portal.locator('[data-arrangement-history-workspace] > summary').click();
      await submit(portal.locator('[data-arrangement-history-filter]'),{q:'Archive pending only',status:'requested'});
      await expect(portal.locator('[data-arrangement-history-open]')).toHaveCount(1);
      await portal.locator(`[data-arrangement-history-open="${cases[0].id}"]`).click();
      await expect(portal.locator('[data-arrangement-panel]')).toContainText('PRIVATE-ARCHIVE-0');
      await expect(portal.locator('[data-arrangement-panel]')).not.toContainText('PRIVATE-ARCHIVE-1');
      await expect(portal.locator('[data-arrangement-request]')).toHaveCount(0);
      await submit(portal.locator(`[data-arrangement-close="${cases[0].id}"]`),{closeNote:'PRIVATE-ARCHIVE-WITHDRAWAL'});
      await expect(portal.getByRole('status')).toContainText('Arrangement request withdrawn.');
      await expect(portal.locator('[data-arrangement-history-open]')).toHaveCount(0);
      await submit(portal.locator('[data-arrangement-history-filter]'),{q:'Archive pending only',status:'withdrawn'});
      await expect(portal.locator(`[data-arrangement-history-open="${cases[0].id}"]`)).toBeVisible();
      expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
      await portal.evaluate(() => window.scrollTo(0,0));await portal.screenshot({path:info.outputPath('student-arrangement-archive.png'),fullPage:true});
      const ownHistoryRoute = '**/api/registry/me/programmes/*/exam-arrangements?**';
      await portal.route(ownHistoryRoute,(route) => route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{message:'Session expired.'}})}));
      await submit(portal.locator('[data-arrangement-history-filter]'),{q:'Archive pending only',status:'all'});
      await expect(portal.locator('[data-form="signin"]')).toBeVisible();
      await expect(portal.locator('[data-arrangement-panel],[data-arrangement-history-workspace]')).toHaveCount(0);
      await portal.unroute(ownHistoryRoute);
      await submit(portal.locator('[data-form="signin"]'),{email:students[1].email,password:students[1].password});
      await portal.locator('[data-arrangement-history-workspace] > summary').click();
      await expect(portal.locator(`[data-arrangement-history-open="${cases[0].id}"]`)).toHaveCount(0);
      await expect(portal.locator(`[data-arrangement-history-open="${cases[1].id}"]`)).toBeVisible();
    } finally {await context.close();}
    const ownClosed = await api('GET',`/api/exams/me/sittings/${probeRow.id}/arrangements`,undefined,students[0].token);
    expect(ownClosed.cases[0]).toMatchObject({status:'withdrawn',closeNote:'PRIVATE-ARCHIVE-WITHDRAWAL'});
    const notices = await api('GET',`/api/notifications?recipientAccountId=${(await api('GET','/api/identity/me',undefined,students[0].token)).account.id}`,undefined,admin.token);
    expect(JSON.stringify(notices)).not.toContain('PRIVATE-');
    const historyRoute = '**/api/exams/arrangements/history?**';
    await page.route(historyRoute,(route) => route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{message:'Session expired.'}})}));
    await submit(page.locator('[data-arrangement-history-filter]'),{q:'Archive pending only',status:'all'});
    await expect(page.locator('[data-registry-login]')).toBeVisible();
    await expect(page.locator('[data-arrangement-panel],[data-arrangement-history-workspace]')).toHaveCount(0);
    await page.unroute(historyRoute);
    await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
    await expect(page.locator('[data-arrangement-panel],[data-arrangement-history-workspace]')).toHaveCount(0);
    expect(await page.locator('.registry-workspace').textContent()).not.toContain('PRIVATE-');
    await page.locator('[data-registry-signout]').click();
  }

  async function candidateArrangements() {
    const base = `/api/exams/sittings/${sittingId}/arrangements`,ownBase = `/api/exams/me/sittings/${sittingId}/arrangements`;
    const coordinator = await account(`arrangements.coordinator.${stamp}@example.com`),reviewer = await account(`arrangements.reviewer.${stamp}@example.com`);
    for (const person of [coordinator,reviewer]) await api('POST','/api/access/role-assignments',{accountId:person.id,roleCode:'exam_arrangements_officer',scope:{programmeCodes:[programme.code],intakeIds:[intake.id]},reason:'Restricted candidate arrangements office'},admin.token);
    await api('POST','/api/access/role-assignments',{accountId:otherPerson.id,roleCode:'exam_arrangements_officer',scope:{programmeCodes:[programme.code],intakeIds:[otherIntake.id]},reason:'Other intake arrangements office'},admin.token);
    await denied('GET',base,undefined,officer.token,403);
    await denied('GET',base,undefined,lecturer.token,403);
    await denied('GET',base,undefined,otherPerson.token,404);
    await denied('GET',base,undefined,students[0].token,403);
    const quietStaff = await staffMember(`arrangements.invigilator.${stamp}@example.edu`,`Quiet-room Invigilator ${stamp}`);
    const quietVenue = await api('POST','/api/exams/venues',{code:`${prefix}QUIET`,name:'Quiet room',campus:'Main campus',location:'Restricted assessment wing',capacity:1,reason:'Approved alternative examination room'},officer.token);
    const input = {extraMinutes:30,separateRoom:true,requestNote:'PRIVATE-CANDIDATE-REQUEST',evidenceRef:'PRIVATE-EVIDENCE-REF'};
    let current = (await api('GET',sittingsBase,undefined,officer.token)).sittings.find((row) => row.id === sittingId);
    let changed = await api('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:current.revision,entries:[...dutyPayload.entries,{staffId:quietStaff.staffId,role:'invigilator'}],reason:'Prepare separate-room roster'},officer.token);
    await api('POST',`${sittingsBase}/publish`,{revision:changed.timetable.revision,reason:'Publish current candidate request source'},publisher.token);
    const candidates = (await api('GET',base,undefined,coordinator.token)).candidates;
    let privateView = await api('POST',base,{...input,registrationId:candidates.find((row) => row.studentNumber === students[0].studentNumber).registrationId},coordinator.token);
    let caseRow = privateView.cases[0];
    const reviewInput = {revision:1,outcome:'approved',reviewNote:'PRIVATE-REVIEW',instruction:'Use assigned quiet room; allow 30 extra minutes',venueId:quietVenue.id,invigilatorStaffId:quietStaff.staffId};
    await denied('POST',`/api/exams/arrangements/${caseRow.id}/review`,reviewInput,coordinator.token,403);
    current = (await api('GET',sittingsBase,undefined,officer.token)).sittings.find((row) => row.id === sittingId);
    changed = await api('POST',`/api/exams/sittings/${sittingId}`,{revision:current.revision,startsAt:at(5,'09:15'),reason:'Changed source invalidates pending arrangement'},officer.token);
    await denied('POST',`/api/exams/arrangements/${caseRow.id}/review`,reviewInput,reviewer.token,409);
    const races = await Promise.all([reviewer,admin].map((person) => request.post(`/api/exams/arrangements/${caseRow.id}/review`,{data:{revision:1,outcome:'returned',reviewNote:'Return changed-source request'},headers:{Authorization:`Bearer ${person.token}`}})));
    expect(races.map((response) => response.status()).sort()).toEqual([200,409]);
    current = changed.sittings.find((row) => row.id === sittingId);
    changed = await api('POST',`/api/exams/sittings/${sittingId}`,{revision:current.revision,startsAt:at(5,'09:00'),reason:'Restore main examination source'},officer.token);
    await api('POST',`${sittingsBase}/publish`,{revision:changed.timetable.revision,reason:'Publish restored source'},publisher.token);
    const portalContext = await browser.newContext({viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch,timezoneId:'Africa/Harare'});
    try {
      const portal = await portalContext.newPage();portal.setDefaultTimeout(15_000);
      await portal.goto('/#apply');await submit(portal.locator('[data-form="signin"]'),{email:students[0].email,password:students[0].password});
      await portal.locator(`[data-arrangements-open="${sittingId}"]`).click();
      await portal.locator('[data-arrangement-request] [name="separateRoom"]').check();
      const {separateRoom,...fields} = input;
      await submit(portal.locator('[data-arrangement-request]'),fields);
      await expect(portal.getByRole('status')).toContainText('Arrangement requested.');
      privateView = await api('GET',ownBase,undefined,students[0].token);caseRow = privateView.cases.find((row) => row.status === 'requested');
      expect(caseRow.requestNote).toBe(input.requestNote);expect(caseRow.evidenceRef).toBe(input.evidenceRef);
      expect(privateView.cases.every((row) => row.studentNumber === students[0].studentNumber)).toBe(true);
      expect(privateView.history).toEqual([]);expect(privateView.candidates).toEqual([]);
      await denied('POST',ownBase,input,students[0].token,409);
      await denied('POST',ownBase,{...input,registrationId:candidates[1].registrationId},students[0].token,400);
      current = (await api('GET',sittingsBase,undefined,officer.token)).sittings.find((row) => row.id === sittingId);
      changed = await api('POST',`/api/exams/sittings/${sittingId}/invigilators`,{revision:current.revision,entries:[...dutyPayload.entries,{staffId:quietStaff.staffId,role:'invigilator'}],reason:'Roster revision must not invalidate base arrangement source'},officer.token);
      expect(changed.arrangementIssues.some((row) => row.problem.includes('awaits independent review'))).toBe(true);
      await denied('POST',`${sittingsBase}/publish`,{revision:changed.timetable.revision,reason:'Pending arrangement must be decided'},publisher.token,409);
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:reviewer.email,password:reviewer.password});
      await page.locator('[data-arrangements-workspace] > summary').click();
      expect(await page.locator(`[data-arrangements-workspace] [data-arrangements-open="${sittingId}"]`).evaluate((button) => {
        const parent = button.getBoundingClientRect();return [...button.querySelectorAll('span')].every((span) => {const rect = span.getBoundingClientRect();return rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom;});
      })).toBe(true);
      await page.locator(`[data-arrangements-open="${sittingId}"]`).click();
      await submit(page.locator(`[data-arrangement-review="${caseRow.id}"]`),{outcome:'approved',reviewNote:reviewInput.reviewNote,instruction:reviewInput.instruction,venueId:quietVenue.id,invigilatorStaffId:quietStaff.staffId});
      await expect(page.getByRole('status')).toHaveText('Arrangement reviewed.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot({path:info.outputPath('candidate-arrangement-review.png'),fullPage:true});
      await denied('POST',`/api/exams/me/arrangements/${caseRow.id}/close`,{revision:2,closeNote:'Cannot self-revoke approval'},students[0].token,403);
      await denied('POST',`/api/exams/arrangements/${caseRow.id}/close`,{revision:2,closeNote:'Wrong operational role'},officer.token,403);
      await denied('POST',`/api/exams/paper-releases/${finalPaperRelease.id}/download`,{reason:'Arrangements changed source revision'},lecturer.token,409);
      const secondView = await api('POST',base,{extraMinutes:15,separateRoom:false,requestNote:'PRIVATE-SECOND-REQUEST',evidenceRef:'PRIVATE-SECOND-EVIDENCE',registrationId:candidates.find((row) => row.studentNumber === students[1].studentNumber).registrationId},coordinator.token);
      const secondCase = secondView.cases.find((row) => row.status === 'requested');
      await api('POST',`/api/exams/arrangements/${secondCase.id}/review`,{revision:1,outcome:'approved',reviewNote:'PRIVATE-SECOND-REVIEW',instruction:'Allow 15 extra minutes in main room'},reviewer.token);
      changed = await api('GET',sittingsBase,undefined,officer.token);
      expect(changed.arrangementIssues).toEqual([]);expect(changed.resourceIssues).toEqual([]);
      expect(JSON.stringify(changed)).not.toContain('PRIVATE-');
      const overlap = await api('POST',`${sittingsBase}/sittings`,{courseId:courses[1].id,paper:'Arrangement clash probe',startsAt:at(5,'12:15'),durationMinutes:60,venue:'Independent room',reason:'Probe personal extra-time clash'},officer.token);
      const overlapRow = overlap.sittings.find((row) => row.paper === 'Arrangement clash probe');
      expect(overlap.clashes).toEqual([{sittingIds:[sittingId,overlapRow.id],students:[students[0].studentNumber]}]);
      changed = await api('POST',`/api/exams/sittings/${overlapRow.id}`,{revision:overlapRow.revision,cancel:true,reason:'Remove clash probe'},officer.token);
      await api('POST',`${sittingsBase}/publish`,{revision:changed.timetable.revision,reason:'Publish independently reviewed candidate arrangements'},publisher.token);
      const snapshots = await Promise.all(students.map(async (person) => (await api('GET',`/api/registry/me/programmes/${person.id}/exams`,undefined,person.token))[0].sittings[0]));
      expect(snapshots[0]).toMatchObject({durationMinutes:210,venue:`${quietVenue.code} - Quiet room`,arrangement:{extraMinutes:30}});
      expect(snapshots[1]).toMatchObject({durationMinutes:195,venue:venueLabelForTest(),arrangement:{extraMinutes:15}});
      for (const row of snapshots) {expect(row).not.toHaveProperty('arrangements');expect(row).not.toHaveProperty('resourceSegments');expect(JSON.stringify(row)).not.toContain('PRIVATE-');}
      const quietDuty = (await api('GET','/api/exams/duties/me',undefined,quietStaff.token))[0].sittings[0];
      expect(quietDuty.durationMinutes).toBe(210);expect(quietDuty.arrangements.map((row) => row.studentNumber)).toEqual([students[0].studentNumber]);
      const mainDuty = (await api('GET','/api/exams/duties/me',undefined,lecturer.token))[0].sittings[0];
      expect(mainDuty.durationMinutes).toBe(195);expect(mainDuty.arrangements.map((row) => row.studentNumber)).toEqual([students[1].studentNumber]);
      expect(JSON.stringify([quietDuty,mainDuty])).not.toContain('PRIVATE-');
      const manifestBase = `/api/exams/sittings/${sittingId}/manifest`,ownManifestBase = `/api/exams/me/sittings/${sittingId}/manifest`;
      let manifest = await api('GET',manifestBase,undefined,officer.token);
      expect(manifest.rooms).toHaveLength(2);
      expect(manifest.rooms.flatMap((room) => room.candidates.map((candidate) => candidate.studentNumber)).sort()).toEqual(students.map((person) => person.studentNumber).sort());
      expect(manifest.rooms.find((room) => room.key === quietVenue.id).candidates[0]).toMatchObject({studentNumber:students[0].studentNumber,extraMinutes:30,endsAt:new Date(Date.parse(at(5,'09:00'))+210*60000).toISOString()});
      const quietManifest = await api('GET',ownManifestBase,undefined,quietStaff.token),mainManifest = await api('GET',ownManifestBase,undefined,lecturer.token);
      expect(quietManifest.rooms.map((room) => room.key)).toEqual([quietVenue.id]);
      expect(mainManifest.rooms.flatMap((room) => room.candidates.map((candidate) => candidate.studentNumber))).toEqual([students[1].studentNumber]);
      expect(JSON.stringify([manifest,quietManifest,mainManifest])).not.toMatch(/PRIVATE-|accountId|registrationId|staffIds|requestNote|evidenceRef/);
      expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
      await denied('GET',manifestBase,undefined,students[0].token,403);
      await denied('GET',manifestBase,undefined,coordinator.token,403);
      await denied('GET',ownManifestBase,undefined,outsider.token,401);
      const unassigned = await staffMember(`manifest.unassigned.${stamp}@example.edu`,`Unassigned manifest invigilator ${stamp}`);
      await denied('GET',ownManifestBase,undefined,unassigned.token,404);
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:quietStaff.email,password:quietStaff.password});
      await page.locator(`[data-exam-manifest="${sittingId}"][data-own]`).click();
      await expect(page.locator('[data-exam-manifest-panel]')).toContainText(students[0].studentNumber);
      await expect(page.locator('[data-exam-manifest-panel]')).not.toContainText(students[1].studentNumber);
      const ownManifestFile = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();
      const ownCsv = await readFile(await (await ownManifestFile).path(),'utf8');
      expect(ownCsv).toContain(students[0].studentNumber);expect(ownCsv).not.toContain(students[1].studentNumber);expect(ownCsv).not.toContain('PRIVATE-');expect(ownCsv).toContain(quietManifest.digest);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
      await workspaceReady(page);
      await page.locator('[data-exam-manifest-panel]').screenshot({path:info.outputPath('assigned-room-manifest.png')});
      if (info.project.name === 'mobile') {
        await page.locator('[data-manifest-candidate]').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
        await expect.poll(() => page.locator('[data-manifest-candidate]').last().evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
        await page.screenshot({path:info.outputPath('assigned-room-manifest-visible-viewport.png')});
      }
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
      await expect(page.locator('[data-exam-manifest-panel]')).toHaveCount(0);
      if (!await page.locator('[data-exams-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exams-panel] > summary').click();
      await page.locator(`[data-exam-period="${period.id}"]`).click();await page.locator(`[data-exam-manifest="${sittingId}"]:not([data-own])`).click();
      await expect(page.locator('[data-manifest-candidate]')).toHaveCount(2);
      const officeManifestFile = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();
      const officeCsv = await readFile(await (await officeManifestFile).path(),'utf8');
      for (const person of students) expect(officeCsv).toContain(person.studentNumber);
      await workspaceReady(page);
      await page.locator('[data-exam-manifest-panel]').screenshot({path:info.outputPath('office-candidate-manifest.png')});
      const manifestEvents = await api('GET',`/api/audit/events?subjectId=${sittingId}`,undefined,admin.token);
      expect(manifestEvents.some((event) => event.action === 'exams.manifest.accessed')).toBe(true);
      expect(JSON.stringify(manifestEvents.filter((event) => event.action === 'exams.manifest.accessed'))).not.toMatch(/PRIVATE-|S250/);
      const seatingBase = `/api/exams/sittings/${sittingId}/seating`,seatingSource = {publishedRevision:manifest.publishedRevision,manifestDigest:manifest.digest};
      const seatEntries = manifest.rooms.flatMap((room) => room.candidates.map((person) => ({roomKey:room.key,studentNumber:person.studentNumber,seat:room.key === quietVenue.id ? 'QUIET-1' : 'MAIN-1'})));
      await denied('GET',seatingBase,undefined,students[0].token,403);
      await denied('GET',seatingBase,undefined,coordinator.token,403);
      await denied('POST',seatingBase,{revision:0,...seatingSource,entries:[{...seatEntries[0],roomKey:'not-the-published-room'}],reason:'Wrong candidate room'},officer.token,400);
      let seating = await api('POST',seatingBase,{revision:0,...seatingSource,entries:seatEntries.slice(0,1),reason:'Partial preparation'},officer.token);
      await denied('POST',`${seatingBase}/publish`,{revision:seating.plan.revision,...seatingSource,reason:'Cannot publish partial seats'},publisher.token,409);
      await page.locator(`[data-exam-seating="${sittingId}"]`).click();
      for (const entry of seatEntries) await page.locator(`[data-seat-candidate="${entry.studentNumber}"]`).fill(entry.seat);
      await submit(page.locator('[data-exam-seating-save]'),{reason:'Assign the frozen candidate rooms'});
      await expect(page.getByRole('status')).toContainText('Seating draft saved.');
      await expect(page.locator('[data-seating-publish-blocked]')).toBeVisible();
      await page.locator('[data-exam-seating-panel]').screenshot({path:info.outputPath('exam-seating-draft.png')});
      seating = await api('GET',seatingBase,undefined,officer.token);
      await denied('POST',seatingBase,{revision:seating.plan.revision,...seatingSource,entries:seatEntries,reason:'Unchanged seating draft'},officer.token,409);
      await denied('POST',`${seatingBase}/publish`,{revision:seating.plan.revision,...seatingSource,reason:'Maker cannot publish'},officer.token,403);
      await denied('POST',seatingBase,{revision:0,...seatingSource,entries:seatEntries,reason:'Stale seating revision'},officer.token,409);
      expect((await api('GET',ownManifestBase,undefined,quietStaff.token)).rooms[0].candidates[0].seat).toBeUndefined();
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:publisher.email,password:publisher.password});
      await expect(page.locator('[data-exam-seating-panel]')).toHaveCount(0);
      if (!await page.locator('[data-exams-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exams-panel] > summary').click();
      await page.locator(`[data-exam-period="${period.id}"]`).click();await page.locator(`[data-exam-seating="${sittingId}"]`).click();
      await submit(page.locator('[data-exam-seating-publish]'),{reason:'Independent seating review'});
      await expect(page.getByRole('status')).toContainText('Seating published.');
      await page.locator('[data-exam-seating-history]').click();await expect(page.locator('[data-seating-history]')).toContainText('Independent seating review');
      const ownSeatedManifest = await api('GET',ownManifestBase,undefined,quietStaff.token);
      expect(ownSeatedManifest.rooms[0].candidates[0].seat).toBe('QUIET-1');expect(JSON.stringify(ownSeatedManifest)).not.toContain('MAIN-1');
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:quietStaff.email,password:quietStaff.password});
      await expect(page.locator('[data-exam-seating-panel]')).toHaveCount(0);
      await page.locator(`[data-exam-manifest="${sittingId}"][data-own]`).click();
      await expect(page.locator('[data-exam-manifest-panel]')).toContainText('QUIET-1');
      const seatManifestFile = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();
      const seatCsv = await readFile(await (await seatManifestFile).path(),'utf8');
      expect(seatCsv).toContain('QUIET-1');expect(seatCsv).toContain(ownSeatedManifest.seating.digest);expect(seatCsv).not.toContain('MAIN-1');expect(seatCsv).not.toContain(students[1].studentNumber);
      await workspaceReady(page);
      await page.locator('[data-exam-manifest-panel]').screenshot({path:info.outputPath('assigned-room-seating-manifest.png')});
      const ownSeatedExams = await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token);
      expect(ownSeatedExams[0].sittings.find((row) => row.id === sittingId).seat).toBe('QUIET-1');expect(JSON.stringify(ownSeatedExams)).not.toContain('MAIN-1');
      await portal.reload();await expect(portal.locator('[data-student-seat]')).toContainText('QUIET-1');
      const seatCalendar = portal.waitForEvent('download');await portal.locator(`[data-student-exam-ics="${period.id}"]`).click();
      expect(await readFile(await (await seatCalendar).path(),'utf8')).toContain('DESCRIPTION:Seat QUIET-1');
      const seatedDraft = await api('POST',seatingBase,{revision:seating.plan.revision,...seatingSource,entries:seatEntries.map((entry) => ({...entry,seat:`${entry.seat}-NEW`})),reason:'Draft seat amendment'},officer.token);
      expect((await api('GET',ownManifestBase,undefined,quietStaff.token)).rooms[0].candidates[0].seat).toBe('QUIET-1');
      const clearedDraft = await api('POST',seatingBase,{revision:seatedDraft.plan.revision,...seatingSource,entries:[],reason:'Withdraw optional seating'},officer.token);
      await api('POST',`${seatingBase}/publish`,{revision:clearedDraft.plan.revision,...seatingSource,reason:'Independent seat withdrawal'},publisher.token);
      expect((await api('GET',ownManifestBase,undefined,quietStaff.token)).rooms[0].candidates[0].seat).toBeUndefined();
      const restoreDraft = await api('POST',seatingBase,{revision:clearedDraft.plan.revision,...seatingSource,entries:seatEntries,reason:'Restore checked seats'},officer.token);
      await api('POST',`${seatingBase}/publish`,{revision:restoreDraft.plan.revision,...seatingSource,reason:'Independent seat restoration'},publisher.token);
      manifest = await api('GET',manifestBase,undefined,officer.token);
      const editionPath = `${sittingsBase}/publications/${manifest.publishedRevision}`,editionManifest = `${editionPath}/sittings/${sittingId}/manifest`;
      historicalPublication = await api('GET',editionPath,undefined,officer.token);
      expect(historicalPublication.origin).toBe('published');expect(historicalPublication.sittings.find((row) => row.id === sittingId).candidateCount).toBe(2);
      expect(JSON.stringify(historicalPublication)).not.toMatch(/PRIVATE-|candidateAccounts|accountId|staffId|S250/);
      await denied('GET',editionPath,undefined,students[0].token,403);await denied('GET',editionPath,undefined,quietStaff.token,403);
      await denied('GET',editionPath,undefined,otherPerson.token,404);
      expect((await api('GET',`/api/exams/publications?q=${encodeURIComponent(programme.code)}`,undefined,otherPerson.token)).total).toBe(0);
      expect(manifest.seating.revision).toBe(restoreDraft.plan.revision);
      const seatEvents = (await api('GET',`/api/audit/events?subjectId=${sittingId}`,undefined,admin.token)).filter((event) => event.action.startsWith('exams.seating.'));
      expect(seatEvents.some((event) => event.action === 'exams.seating.published')).toBe(true);expect(JSON.stringify(seatEvents)).not.toMatch(/QUIET-1|MAIN-1|S250/);
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:reviewer.email,password:reviewer.password});
      const latePerson = await account(`manifest.late.student.${stamp}@example.com`),lateStudent = {...latePerson,...await admit(latePerson)};
      const beforeRefresh = await api('GET',sittingsBase,undefined,officer.token),refreshPath = `${sittingsBase}/refresh-candidates`;
      await denied('POST',refreshPath,{revision:beforeRefresh.timetable.revision,reason:'No-op candidate refresh'},officer.token,409);
      await api('PUT',`/api/registry/me/programmes/${lateStudent.id}/registrations/${period.id}`,{revision:0,courseIds:courses.map((course) => course.id)},lateStudent.token);
      for (const checkType of ['academic','financial']) await api('POST',`/api/registry/programmes/${lateStudent.id}/registrations/${period.id}/checks`,{revision:1,checkType,outcome:'eligible',reason:'Synthetic late clearance',evidenceRef:`SAMPLE-LATE-${checkType}`,expiresOn:day(7)},admin.token);
      await api('POST',`/api/registry/me/programmes/${lateStudent.id}/registrations/${period.id}/confirm`,{revision:1},lateStudent.token);
      expect(await api('GET',`/api/registry/me/programmes/${lateStudent.id}/exams`,undefined,lateStudent.token)).toEqual([]);
      expect(await api('GET',manifestBase,undefined,officer.token)).toEqual(manifest);
      expect((await api('GET',`/api/exams/me/sittings/${sittingId}/arrangements`,undefined,lateStudent.token)).capabilities.request).toBe(false);
      await denied('POST',`/api/exams/me/sittings/${sittingId}/arrangements`,{extraMinutes:0,separateRoom:false,requestNote:'Late candidate awaiting publication',evidenceRef:'SAMPLE-LATE'},lateStudent.token,409);
      const changedCandidates = await api('GET',sittingsBase,undefined,officer.token);
      expect(changedCandidates.candidateChanges.find((row) => row.sittingId === sittingId)).toMatchObject({added:1,removed:0,current:3});
      await denied('POST',refreshPath,{revision:changedCandidates.timetable.revision-1,reason:'Stale candidate revision'},officer.token,409);
      await denied('POST',refreshPath,{revision:changedCandidates.timetable.revision,reason:'Student cannot prepare roster'},lateStudent.token,403);
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
      if (!await page.locator('[data-exams-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exams-panel] > summary').click();
      await page.locator(`[data-exam-period="${period.id}"]`).click();
      await expect(page.locator('[data-exam-candidate-changes]')).toContainText('1 added, 0 removed');
      await submit(page.locator('[data-exam-candidate-refresh]'),{reason:'Prepare late confirmed candidate cohort'});
      await expect(page.getByRole('status')).toContainText('Candidate revision prepared');
      const refreshed = await api('GET',sittingsBase,undefined,officer.token);
      expect(refreshed.timetable.status).toBe('draft');expect(refreshed.timetable.revision).toBe(changedCandidates.timetable.revision+1);
      expect(refreshed.sittings).toEqual(changedCandidates.sittings);
      await denied('GET',manifestBase,undefined,officer.token,409);
      await denied('GET',seatingBase,undefined,officer.token,409);
      expect(await api('GET',editionPath,undefined,officer.token)).toEqual(historicalPublication);
      expect((await api('GET',editionManifest,undefined,officer.token)).rooms.flatMap((room) => room.candidates)).toHaveLength(2);
      expect((await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings.find((row) => row.id === sittingId).seat).toBeUndefined();
      expect(await api('GET',`/api/registry/me/programmes/${lateStudent.id}/exams`,undefined,lateStudent.token)).toEqual([]);
      await denied('POST',refreshPath,{revision:refreshed.timetable.revision,reason:'Duplicate candidate refresh'},officer.token,409);
      await denied('POST',`${sittingsBase}/publish`,{revision:refreshed.timetable.revision,reason:'Maker cannot publish'},officer.token,403);
      await api('POST',`${sittingsBase}/publish`,{revision:refreshed.timetable.revision,reason:'Independent candidate cohort review'},publisher.token);
      expect((await api('GET',manifestBase,undefined,officer.token)).rooms.flatMap((room) => room.candidates.map((row) => row.studentNumber))).toContain(lateStudent.studentNumber);
      expect((await api('GET',sittingsBase,undefined,officer.token)).candidateChanges).toEqual([]);
      const staleSeating = await api('GET',seatingBase,undefined,officer.token);
      expect(staleSeating.plan.stale).toBe(true);expect(staleSeating.plan.entries).toEqual([]);expect(staleSeating.plan.publishedSnapshot).toBeNull();
      expect((await api('GET',manifestBase,undefined,officer.token)).seating).toBeUndefined();
      await denied('POST',`${seatingBase}/publish`,{revision:staleSeating.plan.revision,...seatingSource,reason:'Stale seating publication'},publisher.token,409);
      if (!await page.locator('[data-exam-publications-panel]').evaluate((panel) => panel.open)) await page.locator('[data-exam-publications-panel] > summary').click();
      await submit(page.locator('[data-exam-publications-search]'),{q:programme.code});
      await page.locator(`[data-exam-publication="${period.id}"][data-revision="${historicalPublication.revision}"]`).click();
      await expect(page.locator('[data-exam-publication-panel]')).toContainText(`Historical publication ${historicalPublication.revision}`);
      await page.locator(`[data-publication-manifest="${sittingId}"]`).click();
      await expect(page.locator('[data-exam-manifest-panel]')).toContainText('QUIET-1');await expect(page.locator('[data-exam-manifest-panel]')).not.toContainText(lateStudent.studentNumber);
      await page.locator('[data-publication-seating]').selectOption('0');await expect(page.locator('[data-exam-manifest-panel]')).not.toContainText('QUIET-1');
      await page.locator('[data-publication-seating]').selectOption(String(restoreDraft.plan.revision));
      await expect(page.locator('[data-exam-manifest-panel]')).toContainText('QUIET-1');
      const historicalFile = page.waitForEvent('download');await page.locator('[data-exam-manifest-export]').click();
      const historicalDownload = await historicalFile,historicalCsv = await readFile(await historicalDownload.path(),'utf8');
      expect(historicalDownload.suggestedFilename()).toContain('-historical-seats-');expect(historicalCsv).toContain(historicalPublication.digest);expect(historicalCsv).toContain('QUIET-1');expect(historicalCsv).not.toContain(lateStudent.studentNumber);
      await page.locator('[data-manifest-candidate]').last().evaluate((row) => row.scrollIntoView({block:'center',behavior:'instant'}));
      if (info.project.name === 'mobile') await expect.poll(() => page.locator('[data-manifest-candidate]').last().evaluate((row) => row.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav').getBoundingClientRect().top)).toBe(true);
      await page.screenshot({path:info.outputPath('historical-publication-manifest-viewport.png')});
      await page.locator('[data-exam-publication-close]').click();await expect(page.locator('[data-exam-manifest-panel]')).toHaveCount(0);
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:reviewer.email,password:reviewer.password});
      if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')) throw new Error('Arrangement evidence probes require an isolated database.');
      const client = new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
      try {
        const stored = (await client.query('select private_notes_encrypted,request_note,evidence_ref,review_note from exam_arrangements where id = $1',[caseRow.id])).rows[0];
        expect(stored.private_notes_encrypted).toBe(true);
        for (const field of ['request_note','evidence_ref','review_note']) {expect(stored[field]).toMatch(/^v1\./);expect(stored[field]).not.toContain('PRIVATE-');}
        expect(JSON.stringify((await client.query('select snapshot from exam_arrangement_history where arrangement_id = $1',[caseRow.id])).rows)).not.toContain('PRIVATE-');
        for (const [sql,message] of [["update exam_arrangements set request_note = 'ALTERED' where id = $1",/request evidence is immutable/],
          ["update exam_arrangements set instruction = 'ALTERED' where id = $1",/review evidence is immutable/],
          ["update exam_arrangement_history set snapshot = '{}' where arrangement_id = $1",/append.only/i]]) {
          await client.query('begin');try {await expect(client.query(sql,[caseRow.id])).rejects.toThrow(message);} finally {await client.query('rollback');}
        }
        await client.query('begin');try {await expect(client.query("update exam_seating_history set snapshot = '{}' where sitting_id = $1",[sittingId])).rejects.toThrow(/append.only/i);} finally {await client.query('rollback');}
        await client.query('begin');try {await expect(client.query("update exam_publications set snapshot = '{}' where period_id = $1",[period.id])).rejects.toThrow(/append.only/i);} finally {await client.query('rollback');}
        await client.query('begin');
        try {
          await client.query('create schema exam_publication_backfill_probe');
          await client.query('set local search_path = exam_publication_backfill_probe,public');
          await client.query(`create table exam_timetables (period_id text primary key,revision integer,published_revision integer,published_snapshot jsonb,published_staff_snapshot jsonb,prepared_by text,published_by text,published_at timestamptz,publication_reason text)`);
          await client.query(`create table registration_periods (id text primary key,academic_period_id text,intake_id text);
            create table academic_periods (id text primary key,name text);create table programmes (id text primary key,code text);create table intakes (id text primary key,programme_id text,label text);
            insert into academic_periods values ('term','Retained term');insert into programmes values ('programme','LEGACY');insert into intakes values ('intake','programme','Retained intake');
            insert into registration_periods values ('retained-published','term','intake'),('retained-draft','term','intake')`);
          const actorId = (await client.query('select id from public.accounts order by id limit 1')).rows[0].id;
          await client.query(`insert into exam_timetables values ('retained-published',7,7,$1,null,$2,$2,now(),'Retained published source'),('retained-draft',8,7,$1,null,'later-editor',$2,now(),'Retained source during draft')`,[{revision:7,sittings:[{id:'legacy',code:'LEGACY'}]},actorId]);
          await client.query(await readFile('migrations/060_exam_publications.sql','utf8'));
          const retained = (await client.query('select period_id,revision,prepared_by,origin,snapshot,staff_snapshot,period_name,intake_label from exam_publications order by period_id')).rows;
          expect(retained).toHaveLength(2);expect(retained.every((row) => row.revision === 7 && row.origin === 'retained' && row.staff_snapshot === null)).toBe(true);
          expect(retained.find((row) => row.period_id === 'retained-draft').prepared_by).toBeNull();
          expect(retained.find((row) => row.period_id === 'retained-published').prepared_by).toBe(actorId);
          expect(retained[0].snapshot.sittings[0]).toEqual({id:'legacy',code:'LEGACY'});
          expect(retained[0].period_name).toBe('Retained term');expect(retained[0].intake_label).toBe('Retained intake');
          await client.query('savepoint immutable_probe');
          await expect(client.query('delete from exam_publications')).rejects.toThrow(/append.only/i);
          await client.query('rollback to savepoint immutable_probe');
        } finally {await client.query('rollback');}
      } finally {await client.end();}
      await portal.reload();await portal.locator(`[data-arrangements-open="${sittingId}"]`).click();
      await expect(portal.locator(`[data-arrangement-panel="${sittingId}"]`)).toBeVisible();
      await expect(portal.locator('[data-student-exams]')).toContainText(reviewInput.instruction);
      const personalCalendar = portal.waitForEvent('download');await portal.locator(`[data-student-exam-ics="${period.id}"]`).click();
      const calendarText = await readFile(await (await personalCalendar).path(),'utf8');
      expect(calendarText).toContain(`DTEND:${day(5).replaceAll('-','')}T103000Z`);expect(calendarText).toContain(`LOCATION:${quietVenue.code} - Quiet room`);
      expect(await portal.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
      await portal.locator('[data-student-exams]').screenshot({path:info.outputPath('student-personal-exam-arrangement.png')});
      const notices = await api('GET',`/api/notifications?recipientAccountId=${(await api('GET','/api/identity/me',undefined,students[0].token)).account.id}`,undefined,admin.token);
      expect(JSON.stringify(notices)).not.toContain('PRIVATE-');
      expect(JSON.stringify(notices)).not.toMatch(/QUIET-1|MAIN-1/);expect(notices.some((notice) => JSON.stringify(notice).includes('Examination seating'))).toBe(true);
      const events = await api('GET',`/api/audit/events?subjectId=${caseRow.id}`,undefined,admin.token);
      expect(events.map((row) => row.action)).toEqual(expect.arrayContaining(['exams.arrangement.requested','exams.arrangement.approved']));expect(JSON.stringify(events)).not.toContain('PRIVATE-');
      const probe = await api('POST',`/api/exams/periods/${otherPeriod.id}/sittings`,{courseId:courses[1].id,paper:'Extended room hold probe',startsAt:at(5,'12:15'),durationMinutes:60,venueId:quietVenue.id,reason:'Probe extended alternative room booking'},officer.token);
      const probeRow = probe.sittings.find((row) => row.paper === 'Extended room hold probe');
      expect(probe.resourceIssues.some((row) => row.kind === 'room')).toBe(true);
      await denied('POST',`/api/exams/sittings/${probeRow.id}/invigilators`,{revision:probeRow.revision,entries:[{staffId:quietStaff.staffId,role:'lead'}],reason:'Extended duty conflicts'},officer.token,409);
      const paperView = await api('GET',`/api/exams/orders/${order.id}/papers`,undefined,officer.token),approvedPaper = paperView.papers.find((row) => row.status === 'approved');
      current = changed.sittings.find((row) => row.id === sittingId);
      const releaseInput = {revision:current.revision,staffId:quietStaff.staffId,availableAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.parse(current.startsAt)+210*60000).toISOString(),copies:1,packageRef:'QUIET-ROOM-PACKAGE',reason:'Alternative room controlled dispatch'};
      await denied('POST',`/api/exams/papers/${approvedPaper.id}/release`,{...releaseInput,staffId:lecturer.staffId},officer.token,400);
      const released = await api('POST',`/api/exams/papers/${approvedPaper.id}/release`,releaseInput,officer.token);
      const packageRow = released.releases.find((row) => row.staffId === quietStaff.staffId && row.status === 'active');
      expect((await request.post(`/api/exams/paper-releases/${packageRow.id}/download`,{data:{reason:'Receive assigned-room package'},headers:{Authorization:`Bearer ${quietStaff.token}`}})).ok()).toBe(true);
      await api('POST',`/api/exams/paper-releases/${packageRow.id}/revoke`,{revision:1,reason:'End arrangement dispatch fixture'},officer.token);
      for (const row of [caseRow,secondCase]) await api('POST',`/api/exams/arrangements/${row.id}/close`,{revision:2,closeNote:'PRIVATE-REVOCATION'},coordinator.token);
      expect((await api('GET',`/api/exams/periods/${otherPeriod.id}`,undefined,officer.token)).resourceIssues.some((row) => row.kind === 'room')).toBe(true);
      changed = await api('GET',sittingsBase,undefined,officer.token);
      const cohortLock = new pg.Client({connectionString:process.env.DATABASE_URL});await cohortLock.connect();
      let publication,publicationFinished = false;
      try {
        await cohortLock.query('begin');
        await cohortLock.query('select id from registration_periods where id = $1 for update',[period.id]);
        const blocker = (await cohortLock.query('select pg_backend_pid() as pid')).rows[0].pid;
        publication = fetch(new URL(`${sittingsBase}/publish`,process.env.SVU_BASE_URL),{method:'POST',body:JSON.stringify({revision:changed.timetable.revision,reason:'Publish arrangement revocations'}),headers:{Authorization:`Bearer ${publisher.token}`,'Content-Type':'application/json'}}).then((response) => {publicationFinished = true;return response;});
        await expect.poll(async () => {
          await cohortLock.query('select pg_stat_clear_snapshot()');
          const waiting = (await cohortLock.query('select query from pg_stat_activity where datname = current_database() and $1 = any(pg_blocking_pids(pid))',[blocker])).rows;
          return !publicationFinished && waiting.some((row) => row.query.includes('registration_periods'));
        }).toBe(true);
      } finally {await cohortLock.query('rollback');await cohortLock.end();}
      const published = await publication;expect(published.ok,await published.text()).toBe(true);
      const updatedManifest = await api('GET',manifestBase,undefined,officer.token);
      expect(updatedManifest.digest).not.toBe(manifest.digest);
      expect(updatedManifest.rooms.flatMap((room) => room.candidates.map((candidate) => candidate.studentNumber))).toContain(lateStudent.studentNumber);
      expect((await api('GET',`/api/registry/me/programmes/${lateStudent.id}/exams`,undefined,lateStudent.token))[0].sittings[0].durationMinutes).toBe(180);
      expect((await api('GET',`/api/exams/me/sittings/${sittingId}/arrangements`,undefined,lateStudent.token)).capabilities.request).toBe(true);
      expect((await api('GET',`/api/exams/periods/${otherPeriod.id}`,undefined,officer.token)).resourceIssues).toEqual([]);
      await api('POST',`/api/exams/sittings/${probeRow.id}`,{revision:probeRow.revision,cancel:true,reason:'Remove extended-room fixture'},officer.token);
      expect((await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings[0].durationMinutes).toBe(180);
      await portal.reload();await portal.locator(`[data-arrangements-open="${sittingId}"]`).click();
      await submit(portal.locator('[data-arrangement-request]'),{extraMinutes:0,requestNote:'PRIVATE-ASSISTIVE-REQUEST',evidenceRef:'PRIVATE-ASSISTIVE-REF'});
      await expect(portal.getByRole('status')).toContainText('Arrangement requested.');
      const pending = (await api('GET',ownBase,undefined,students[0].token)).cases.find((row) => row.status === 'requested');
      await submit(portal.locator(`[data-arrangement-close="${pending.id}"]`),{closeNote:'PRIVATE-OWN-WITHDRAWAL'});
      await expect(portal.getByRole('status')).toContainText('Arrangement request withdrawn.');
      expect((await api('GET',ownBase,undefined,students[0].token)).cases.find((row) => row.id === pending.id).status).toBe('withdrawn');
    } finally {await portalContext.close();}
    await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:officer.email,password:officer.password});
    return {coordinator,reviewer};
    function venueLabelForTest() {return `${venue.code} - ${venue.name}`;}
  }

  async function paperCustody() {
    const papersBase = `/api/exams/orders/${order.id}/papers`,pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    await denied('GET',papersBase,undefined,students[0].token,403);
    await api('POST','/api/access/role-assignments',{accountId:otherPerson.id,roleCode:'examinations_officer',scope:{programmeCodes:[programme.code],intakeIds:[otherIntake.id]},reason:'Other intake paper authority'},admin.token);
    await denied('GET',papersBase,undefined,otherPerson.token,404);
    await denied('POST',papersBase,{fileName:'bad.exe',sizeBytes:pdf.length,checksum:digest(pdf),reason:'Not PDF'},officer.token,400);
    const bad = Buffer.from('Not actually a PDF');
    let intent = await api('POST',papersBase,{fileName:'disguised.pdf',sizeBytes:bad.length,checksum:digest(bad),reason:'Signature quarantine fixture'},officer.token);
    await denied('POST',`/api/exams/papers/${intent.paper.id}/submit`,{revision:1,reason:'Not uploaded'},officer.token,409);
    let uploaded = await request.put(intent.upload.url,{data:bad,headers:{Authorization:`Bearer ${officer.token}`,'Content-Type':'application/pdf'}});
    expect(uploaded.ok()).toBe(true);expect((await uploaded.json()).data.papers[0].status).toBe('quarantined');
    await denied('POST',`/api/exams/papers/${intent.paper.id}/download`,{reason:'Quarantine cannot be read'},officer.token,409);
    await api('POST',`/api/exams/papers/${intent.paper.id}/withdraw`,{revision:2,reason:'Withdraw quarantined signature fixture'},officer.token);
    intent = await uploadVersion('Infected fixture');
    await api('POST',`/api/exams/papers/${intent.paper.id}/scan`,{revision:2,checksum:digest(pdf),result:'infected',scannerRef:'SAMPLE-SCAN-INFECTED',reason:'Scanner fixture'},admin.token);
    await denied('POST',`/api/exams/papers/${intent.paper.id}/submit`,{revision:3,reason:'Infected paper'},officer.token,409);
    intent = await uploadVersion('Returned paper fixture');
    await cleanAndSubmit(intent.paper.id);
    await api('POST',`/api/exams/papers/${intent.paper.id}/review`,{revision:4,outcome:'returned',reason:'Revise the specification'},publisher.token);

    await openPaperDesk(officer);
    await page.locator('[data-paper-upload] [name="file"]').setInputFiles({name:'approved-exam.pdf',mimeType:'application/pdf',buffer:pdf});
    await submit(page.locator('[data-paper-upload]'),{reason:'Corrected confidential paper'});
    await expect(page.getByRole('status')).toHaveText('Paper uploaded; scan pending.');
    let paperView = await api('GET',papersBase,undefined,officer.token),paper = paperView.papers[0];
    expect(paper).toMatchObject({version:4,status:'uploaded',checksum:digest(pdf)});
    expect(paper).not.toHaveProperty('storageKey');
    await immutableDatabaseFact('update exam_papers set checksum = $2,revision = revision + 1 where id = $1',[paper.id,'0'.repeat(64)],/version facts are immutable/);
    await denied('GET',`/api/documents/${paper.id}`,undefined,admin.token,404);
    await denied('POST',`/api/exams/papers/${paper.id}/download`,{reason:'Pending scan'},officer.token,409);
    await denied('POST',`/api/exams/papers/${paper.id}/scan`,{revision:2,checksum:'0'.repeat(64),result:'clean',scannerRef:'WRONG',reason:'Wrong file'},admin.token,409);
    await api('POST',`/api/exams/papers/${paper.id}/scan`,{revision:2,checksum:digest(pdf),result:'clean',scannerRef:'SAMPLE-CLEAN-4',reason:'Scanner fixture'},admin.token);
    await openPaperDesk(officer);await expandVersion(paper.id);
    await submit(page.locator(`[data-paper-action="submit"][data-paper-id="${paper.id}"]`),{reason:'Submit clean corrected paper'});
    await expect(page.getByRole('status')).toHaveText('Paper custody updated.');
    await denied('POST',`/api/exams/papers/${paper.id}/review`,{revision:4,outcome:'approved',reason:'Self review'},officer.token,403);
    await denied('POST',`/api/exams/papers/${paper.id}/review`,{revision:3,outcome:'approved',reason:'Stale review'},publisher.token,409);
    await openPaperDesk(publisher);await expandVersion(paper.id);
    await submit(page.locator(`[data-paper-action="review"][data-paper-id="${paper.id}"]`),{outcome:'approved',reason:'Independent confidential paper approval'});
    await expect(page.getByRole('status')).toHaveText('Paper custody updated.');
    const custodyRead = await request.post(`/api/exams/papers/${paper.id}/download`,{data:{reason:'Confidential printing master'},headers:{Authorization:`Bearer ${officer.token}`}});
    expect(custodyRead.ok()).toBe(true);expect(custodyRead.headers()['cache-control']).toBe('no-store');expect(await custodyRead.body()).toEqual(pdf);
    await denied('GET',`/api/exams/papers/${paper.id}/content`,undefined,lecturer.token,404);
    let current = (await api('GET',sittingsBase,undefined,officer.token)).sittings.find((row) => row.id === sittingId);
    const releaseBody = {revision:current.revision,staffId:lecturer.staffId,availableAt:new Date(Date.now()+3600000).toISOString(),expiresAt:new Date(Date.parse(current.startsAt)+current.durationMinutes*60000).toISOString(),copies:2,packageRef:'SEALED-FUTURE',reason:'Future controlled dispatch'};
    await denied('POST',`/api/exams/papers/${paper.id}/release`,{...releaseBody,revision:1},officer.token,409);
    await denied('POST',`/api/exams/papers/${paper.id}/release`,{...releaseBody,expiresAt:new Date(Date.parse(releaseBody.expiresAt)+60000).toISOString()},officer.token,400);
    paperView = await api('POST',`/api/exams/papers/${paper.id}/release`,releaseBody,officer.token);let release = paperView.releases[0];
    await denied('POST',`/api/exams/paper-releases/${release.id}/download`,{reason:'Too early'},lecturer.token,409);
    await denied('POST',`/api/exams/paper-releases/${release.id}/download`,{reason:'Wrong recipient'},officer.token,404);
    await api('POST',`/api/exams/paper-releases/${release.id}/revoke`,{revision:1,reason:'Replace scheduled dispatch'},officer.token);
    await openPaperDesk(officer);await expandVersion(paper.id);
    await submit(page.locator(`[data-paper-release="${paper.id}"]`),{staffId:lecturer.staffId,copies:2,packageRef:'SEALED-CURRENT',reason:'Print and dispatch reviewed paper'});
    await expect(page.getByRole('status')).toHaveText('Paper package released.');
    paperView = await api('GET',papersBase,undefined,officer.token);release = paperView.releases.find((row) => row.status === 'active');
    await denied('POST',`/api/exams/paper-releases/${release.id}/acknowledge`,{receiptRef:'TOO-EARLY',reason:'No download yet'},lecturer.token,409);
    const ownRelease = (await api('GET','/api/exams/paper-releases/me',undefined,lecturer.token)).find((row) => row.id === release.id);
    expect(ownRelease).not.toHaveProperty('recipientAccountId');expect(ownRelease).not.toHaveProperty('createdBy');expect(ownRelease).not.toHaveProperty('staffId');
    expect(await api('GET','/api/exams/paper-releases/me',undefined,otherPerson.token)).toEqual([]);
    expect((await api('GET',`/api/registry/me/programmes/${students[0].id}/exams`,undefined,students[0].token))[0].sittings[0]).not.toHaveProperty('paperId');
    await page.locator('[data-paper-event-history] > summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await page.locator('[data-paper-custody]').screenshot({path:info.outputPath('exam-paper-custody.png')});
    await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:lecturer.email,password:lecturer.password});
    const ownPanel = page.locator(`[data-own-paper-release="${release.id}"]`);await ownPanel.locator('summary').click();
    const paperFile = page.waitForEvent('download');await submit(page.locator(`[data-paper-recipient-download="${release.id}"]`),{reason:'Receive controlled printing package'});
    expect(await readFile(await (await paperFile).path())).toEqual(pdf);
    await expect(page.locator(`[data-paper-acknowledge="${release.id}"]`)).toBeVisible();
    await submit(page.locator(`[data-paper-acknowledge="${release.id}"]`),{receiptRef:'CUSTODY-RECEIPT-001',reason:'Two sealed copies received'});
    await expect(page.getByRole('status')).toHaveText('Custody receipt acknowledged.');
    await denied('POST',`/api/exams/paper-releases/${release.id}/acknowledge`,{receiptRef:'DUPLICATE',reason:'Repeated receipt'},lecturer.token,409);
    await immutableDatabaseFact('update exam_paper_releases set receipt_ref = $2,revision = revision + 1 where id = $1',[release.id,'ALTERED-RECEIPT'],/custody receipts are immutable/);
    await immutableDatabaseFact('update exam_paper_releases set copies = copies + 1,revision = revision + 1 where id = $1',[release.id],/package facts are immutable/);
    await immutableDatabaseFact("update exam_paper_events set reason = 'Changed history' where release_id = $1",[release.id],/append.only/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    await page.locator('[data-own-paper-releases]').screenshot({path:info.outputPath('exam-paper-receipt.png')});
    await openPaperDesk(officer);
    await submit(page.locator(`[data-paper-revoke="${release.id}"]`),{reason:'Recall acknowledged package'});await expect(page.getByRole('status')).toHaveText('Paper package revoked.');
    await denied('POST',`/api/exams/paper-releases/${release.id}/download`,{reason:'Revoked package'},lecturer.token,409);
    paperView = await api('POST',`/api/exams/papers/${paper.id}/release`,{...releaseBody,availableAt:new Date(Date.now()-60000).toISOString(),packageRef:'SUPERSEDED-PACKAGE'},officer.token);release = paperView.releases.find((row) => row.status === 'active');
    const replacementPaper = await uploadVersion('Approved replacement master');await cleanAndSubmit(replacementPaper.paper.id);
    await api('POST',`/api/exams/papers/${replacementPaper.paper.id}/review`,{revision:4,outcome:'approved',reason:'Independent replacement approval'},publisher.token);
    await denied('POST',`/api/exams/paper-releases/${release.id}/download`,{reason:'Superseded source master'},lecturer.token,409);
    await api('POST',`/api/exams/paper-releases/${release.id}/revoke`,{revision:1,reason:'Replace superseded source release'},officer.token);
    paperView = await api('POST',`/api/exams/papers/${replacementPaper.paper.id}/release`,{...releaseBody,availableAt:new Date(Date.now()-60000).toISOString(),packageRef:'LATEST-PAPER-PACKAGE'},officer.token);release = paperView.releases.find((row) => row.status === 'active');
    expect(paperView.events.map((row) => row.action)).toEqual(expect.arrayContaining(['uploaded','scan_infected','scan_clean','submitted','returned','approved','superseded','released','recipient_downloaded','receipt_acknowledged','release_revoked']));
    const releaseEvents = await api('GET',`/api/audit/events?subjectId=${release.id}`,undefined,admin.token);expect(releaseEvents.some((row) => row.action === 'exams.paper.released')).toBe(true);
    await page.locator('[data-paper-custody-close]').click();
    return release;

    async function uploadVersion(note) {
      const requested = await api('POST',papersBase,{fileName:'exam-paper.pdf',sizeBytes:pdf.length,checksum:digest(pdf),reason:note},officer.token);
      await denied('PUT',requested.upload.url,pdf.toString(),lecturer.token,403);
      const response = await request.put(requested.upload.url,{data:pdf,headers:{Authorization:`Bearer ${officer.token}`,'Content-Type':'application/pdf'}});expect(response.ok(),await response.text()).toBe(true);return requested;
    }
    async function immutableDatabaseFact(sql,values,message) {
      if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')) throw new Error('Custody mutation probes require the isolated integration database.');
      const client = new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
      try {await client.query('begin');await expect(client.query(sql,values)).rejects.toThrow(message);} finally {await client.query('rollback');await client.end();}
    }
    async function cleanAndSubmit(id) {
      await api('POST',`/api/exams/papers/${id}/scan`,{revision:2,checksum:digest(pdf),result:'clean',scannerRef:`SAMPLE-${id}`,reason:'Scanner fixture'},admin.token);
      await api('POST',`/api/exams/papers/${id}/submit`,{revision:3,reason:'Reviewed author submission'},officer.token);
    }
    async function expandVersion(id) {const panel = page.locator(`[data-paper-version="${id}"]`);if (!await panel.evaluate((element) => element.open)) await panel.locator('summary').click();}
    async function openPaperDesk(person) {
      await page.locator('[data-registry-signout]').click();await submit(page.locator('[data-registry-login]'),{email:person.email,password:person.password});
      await page.locator('[data-exams-panel] > summary').click();await page.locator(`[data-exam-period="${period.id}"]`).click();
      await expect(page.locator('[data-exam-order-panel] > summary')).toHaveAttribute('aria-disabled','false');await page.locator('[data-exam-order-panel] > summary').click();
      await page.locator(`[data-exam-papers-open="${order.id}"]`).click();await expect(page.locator('[data-paper-custody]')).toBeVisible();
    }
  }

  async function staffMember(email,legalName) {
    const created = await api("POST","/api/staff",{email,legalName,preferredName:"Lecturer",category:"LECTURER",grade:"L1",departmentId:"dept_computing",engagedOn:day(-400),roleCode:"lecturer",reason:"Appointment"},admin.token);
    const password = "Kariba-Dam-Staff-2026!";
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Lecturer",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password});
    return {email,password,token:session.token,staffId:created.id};
  }
  async function gradingPolicy() {
    const code = `ex_${stamp.replaceAll(".","_")}`;
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
  async function admit(person,targetIntake = intake) {
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-EX-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:targetIntake.id,state:"Accepted",referenceNumber:`SAMPLE-EX-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === targetIntake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar() {
    const y = new Date(fixtureNow).getUTCFullYear(),clamp = (value,low,high) => value < low ? low : value > high ? high : value;
    const startsOn = clamp(day(-30),`${y}-01-01`,`${y}-12-31`),endsOn = clamp(day(60),`${y}-01-01`,`${y}-12-31`);
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`EX-Y-${y}-${stamp}`,name:`SAMPLE exams ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    // Semesters in one year cannot overlap, and other journeys create their own; start after any that would collide.
    const busyUntil = periods.filter((row) => row.periodType === "semester" && row.parentId === parent.id && !String(row.code).startsWith("EX-S-") && row.startsOn <= endsOn && row.endsOn >= startsOn)
      .map((row) => row.endsOn).sort().at(-1);
    const termStart = busyUntil && busyUntil >= startsOn ? new Date(Date.parse(`${busyUntil}T00:00:00Z`) + 86400000).toISOString().slice(0,10) : startsOn;
    const opens = termStart > day(-7) ? termStart : day(-7);
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === termStart && row.endsOn === endsOn);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`EX-S-${termStart}-${stamp}`,name:`SAMPLE exams term ${termStart}`,periodType:"semester",parentId:parent.id,startsOn:termStart,endsOn,windows:{registration:[opens,day(7)],assessment:[opens,day(40)],results_publication:[day(41),day(55)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function workspaceReady(desk) {
    const controls = desk.locator('.registry-workspace > fieldset.review-controls');
    if (await controls.count()) await expect(controls).toBeEnabled({timeout:30_000});
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();await workspaceReady(target.page());}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
