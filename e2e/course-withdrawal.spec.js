import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outcomeChecksum } from "../server/modules/lms.js";
import pg from 'pg';

import { resultsChecksum } from "../server/modules/results.js";

test("students and registry staff withdraw confirmed courses through independent approval, leaving active rosters but not history",async ({page,request},info) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "WDD" : "WDM";
  const fixtureNow = Number(process.env.SVU_TEST_NOW || Date.now());
  const day = (offset) => new Date(fixtureNow+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const courses = [];
  for (const [index,title] of [[1,"Marks native course"],[2,"Marks LMS course"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const programme = await api("POST","/api/master-data/programmes",{code:`WD-${stamp}`,name:`SAMPLE marks ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
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
  const [first,second] = students;
  const marksRoster = async (courseId) => (await api("GET",`/api/assessment/offerings/${period.id}/${courseId}`,undefined,officer.token)).students.map((row) => row.studentNumber).sort();
  expect(await marksRoster(courses[1].id)).toEqual([first.studentNumber,second.studentNumber].sort());

  // The first student asks to withdraw from the second course in the portal; the request is not yet effective.
  await page.goto("/#apply"); await submit(page.locator('[data-form="signin"]'),{email:first.email,password:first.password});
  const panel = page.locator("[data-course-withdrawals]");
  await panel.locator("details > summary").click();
  await submit(panel.locator("[data-withdrawal-request]"),{target:`${period.id}|${courses[1].id}`,reason:"Course clashes with my work placement"});
  await expect(page.getByText("Withdrawal requested for independent approval.")).toBeVisible();
  let own = await api("GET",`/api/registry/me/programmes/${first.id}/withdrawals`,undefined,first.token);
  const studentRequest = own.requests[0];
  expect(studentRequest).toMatchObject({courseId:courses[1].id,status:"requested"});
  await denied("POST",`/api/registry/me/programmes/${first.id}/registrations/${period.id}/withdrawals`,{courseId:courses[1].id,reason:"Again"},first.token,409);
  await denied("POST",`/api/registry/me/programmes/${first.id}/registrations/${period.id}/withdrawals`,{courseId:courses[0].id,reason:"Not mine"},second.token,404);
  await denied("POST",`/api/registry/programmes/${first.id}/withdrawals/${studentRequest.id}/review`,{outcome:"approved",reason:"Student cannot approve"},first.token,403);
  expect(await marksRoster(courses[1].id)).toHaveLength(2);

  // Registry staff request on behalf of the second student; self-approval is refused; the administrator approves both.
  const staffRequest = await api("POST",`${staffBase.replace(students[0].id,second.id)}/registrations/${period.id}/withdrawals`,{courseId:courses[0].id,reason:"Medical advice",evidenceRef:"SAMPLE-MED"},registrar.token);
  await denied("POST",`/api/registry/programmes/${second.id}/withdrawals/${staffRequest.id}/review`,{outcome:"approved",reason:"Own request"},registrar.token,403);
  await api("POST",`/api/registry/programmes/${first.id}/withdrawals/${studentRequest.id}/review`,{outcome:"approved",reason:"Placement letter seen"},admin.token);
  await api("POST",`/api/registry/programmes/${second.id}/withdrawals/${staffRequest.id}/review`,{outcome:"approved",reason:"Medical certificate seen"},admin.token);
  await denied("POST",`/api/registry/programmes/${first.id}/withdrawals/${studentRequest.id}/review`,{outcome:"rejected",reason:"Again"},admin.token,409);

  // Withdrawn enrolments leave the active rosters; the confirmation receipt is unchanged.
  expect(await marksRoster(courses[1].id)).toEqual([second.studentNumber]);
  expect(await marksRoster(courses[0].id)).toEqual([first.studentNumber]);
  const registration = (await api("GET",`/api/registry/me/programmes/${first.id}/registrations`,undefined,first.token)).find((row) => row.period.id === period.id);
  expect(registration.registration.confirmation.courses.map((row) => row.courseId).sort()).toEqual(courses.map((row) => row.id).sort());
  await denied("POST",`/api/registry/me/programmes/${first.id}/registrations/${period.id}/withdrawals`,{courseId:courses[1].id,reason:"Already withdrawn"},first.token,409);
  await page.reload();
  await expect(page.locator(`[data-withdrawal="${studentRequest.id}"] [data-withdrawal-status]`)).toHaveAttribute("data-withdrawal-status","approved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("withdrawal.png"),fullPage:true});

  // The official results roster no longer expects the withdrawn courses; once results exist, withdrawal is refused.
  await api("POST",`${staffBase}/registration-periods/${period.id}`,{toStatus:"closed",reason:"Semester complete"},admin.token);
  const roster = (await api("GET",`${staffBase}/results`,undefined,registrar.token)).periods.find((row) => row.period.id === period.id).roster;
  expect(roster.map((row) => `${row.studentNumber}|${row.courseId}`).sort()).toEqual([`${first.studentNumber}|${courses[0].id}`,`${second.studentNumber}|${courses[1].id}`].sort());
  const gpa = await gradingPolicy();
  const rows = roster.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,mark:60}));
  await api("POST",`${staffBase}/results/${period.id}/batches`,{sourceRef:`SAMPLE-WD-${stamp}`,rows,checksum:resultsChecksum(rows),expectedRowCount:rows.length,expectedMarkTotal:60 * rows.length,gpaRuleSetId:gpa.id,reason:"Marks for the remaining enrolments"},registrar.token);
  await denied("POST",`/api/registry/me/programmes/${first.id}/registrations/${period.id}/withdrawals`,{courseId:courses[0].id,reason:"Too late"},first.token,409);
  const events = (await api("GET",`/api/audit/events?subjectId=${studentRequest.id}`,undefined,admin.token)).map((row) => row.action);
  expect(events).toEqual(expect.arrayContaining(["registry.withdrawal.requested","registry.withdrawal.approved"]));
  async function staffMember(email,legalName) {
    const created = await api("POST","/api/staff",{email,legalName,preferredName:"Lecturer",category:"LECTURER",grade:"L1",departmentId:"dept_computing",engagedOn:day(-400),roleCode:"lecturer",reason:"Appointment"},admin.token);
    const password = "Kariba-Dam-Staff-2026!";
    await api("POST","/api/identity/activations",{token:await outboxToken(email),password,preferredName:"Lecturer",legalName});
    const session = await api("POST","/api/identity/sessions",{email,password});
    return {email,password,token:session.token,staffId:created.id};
  }
  async function gradingPolicy() {
    const code = `wd_${stamp.replaceAll(".","_")}`;
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
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-WD-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-WD-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`WD-Y-${y}-${stamp}`,name:`SAMPLE marks ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    const startsOn = day(-7) < `${y}-01-01` ? `${y}-01-01` : day(-7),endsOn = day(7) > `${y}-12-31` ? `${y}-12-31` : day(7);
    let termRow = periods.find((row) => row.periodType === "term" && row.parentId === parent.id && row.startsOn === startsOn && row.endsOn === endsOn);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`AM-T-${y}-${stamp}`,name:`SAMPLE marks ${y} term`,periodType:"term",parentId:parent.id,startsOn,endsOn,windows:{registration:[startsOn,endsOn],assessment:[startsOn,endsOn],results_publication:[startsOn,endsOn]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic term"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
