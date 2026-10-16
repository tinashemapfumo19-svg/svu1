import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

test("lecturers upload a mark file through a validated preview that applies once and never overwrites newer marks",async ({page,request},info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`,prefix = info.project.name === "desktop" ? "AUD" : "AUM";
  const day = (offset) => new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const admin = await api("POST","/api/identity/sessions",{email:"admin@southvalley.test",password:"Phase1-Admin-Password-2026!"});
  const registrar = await api("POST","/api/identity/sessions",{email:"registrar@southvalley.test",password:"Kariba-Senate-Approvals-2026!"});
  const courses = [];
  for (const [index,title] of [[1,"Marks upload course"]]) courses.push(await api("POST","/api/master-data/courses",{code:`${prefix}10${index}`,title,credits:15,level:1,departmentId:"dept_computing",effectiveFrom:"2024-01-01"},admin.token));
  const programme = await api("POST","/api/master-data/programmes",{code:`AU-${stamp}`,name:`SAMPLE marks ${stamp}`,departmentId:"dept_computing",status:"active"},admin.token);
  const version = await api("POST",`/api/master-data/programmes/${programme.id}/versions`,{versionLabel:"Marks curriculum",effectiveFrom:"2024-01-01"},admin.token);
  for (const course of courses) await api("POST",`/api/master-data/programme-versions/${version.id}/curriculum`,{courseId:course.id,yearOfStudy:1,term:"S1",requirementType:"core"},admin.token);
  await api("POST",`/api/master-data/programme-versions/${version.id}/publish`,{reason:"Independently checked synthetic curriculum"},registrar.token);
  const intake = await api("POST","/api/master-data/intakes",{programmeId:programme.id,label:`SAMPLE marks ${stamp}`,capacity:5,startsOn:"2025-01-01",applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token);
  await api("POST",`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:"published",reason:"Synthetic intake"},admin.token);
  const students = [];
  for (const index of [1,2,3]) {const person = await account(`marks.student${index}.${stamp}@example.com`); students.push({...person,...await admit(person)});}
  const staffBase = `/api/registry/programmes/${students[0].id}`,term = await calendar(2025);
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
  const base = `/api/assessment/offerings/${period.id}/${courses[0].id}`;
  const plan = (await api("POST",`${base}/plans`,{components:[{code:"CW",name:"Coursework",weight:40,maxMark:50},{code:"EXAM",name:"Final examination",weight:60,maxMark:100}],reason:"Module descriptor"},lecturer.token)).plans[0];
  await api("POST",`/api/assessment/plans/${plan.id}/approve`,{reason:"Matches the module descriptor"},admin.token);
  const [first,second,third] = students;

  await page.goto("/#registry"); await submit(page.locator("[data-registry-login]"),{email:lecturer.email,password:lecturer.password});
  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  const panel = page.locator("[data-marks-upload]");
  await panel.locator("summary").click();
  const download = page.waitForEvent("download");
  await panel.locator("[data-marks-template]").click();
  const template = await readFile(await (await download).path(),"utf8");
  expect(template.trim().split(/\r\n/)).toEqual(["student_number,component,value,reason",...[first,second,third].sort((a,b) => a.studentNumber.localeCompare(b.studentNumber)).flatMap((row) => [`${row.studentNumber},CW,,`,`${row.studentNumber},EXAM,,`])]);

  // A file with problems is reported row by row and saves nothing.
  await upload("marks-draft.csv",["student_number,component,value,reason",`${first.studentNumber},CW,51,`,"S00000000,CW,10,",`${second.studentNumber},EXAM,ABSENT,`,`${third.studentNumber},LAB,10,`,`${third.studentNumber},CW,30,`,`${third.studentNumber},CW,31,`,`${first.studentNumber},EXAM,70,`]);
  await expect(page.getByRole("status")).toHaveText("6 row(s) rejected. Nothing was saved.");
  await expect(page.locator("[data-import-summary]")).toHaveText("marks-draft.csv: 7 row(s) - 1 new, 0 changed, 0 unchanged, 6 rejected");
  await expect(page.locator("[data-import-rejected]")).toHaveText([/maximum of 50/,/not on the confirmed class list/,/ABSENT needs a reason/,/not in the approved plan/,/more than once/,/more than once/]);
  await expect(page.locator("[data-marks-apply]")).toHaveCount(0);
  expect((await api("GET",base,undefined,lecturer.token)).marks).toEqual([]);

  // A clean preview cannot be applied once someone else has changed a mark.
  const lines = ["student_number,component,value,reason",`${first.studentNumber},CW,40,`,`${first.studentNumber},EXAM,70,`,`${second.studentNumber},CW,25,`,
    `${second.studentNumber},EXAM,DEFERRED,"Medical certificate, dated 3 June"`,`${third.studentNumber},CW,EXEMPT,Recognised prior coursework`,`${third.studentNumber},EXAM,ABSENT,Did not sit`];
  await upload("marks-final.csv",lines);
  await expect(page.getByRole("status")).toHaveText("Upload previewed. Review the changes, then apply.");
  await expect(page.locator("[data-import-summary]")).toHaveText("marks-final.csv: 6 row(s) - 6 new, 0 changed, 0 unchanged, 0 rejected");
  const thirdReg = (await api("GET",base,undefined,admin.token)).students.find((row) => row.studentNumber === third.studentNumber).registrationId;
  await api("PUT",`${base}/marks`,{planId:plan.id,entries:[{registrationId:thirdReg,componentCode:"EXAM",state:"mark",mark:12,revision:0}]},officer.token);
  await page.locator("[data-marks-apply]").click();
  await expect(page.getByRole("status")).toHaveText("Marks changed after this preview. Preview the file again before applying it.");
  expect((await api("GET",base,undefined,lecturer.token)).marks).toHaveLength(1);

  await upload("marks-final.csv",lines);
  await expect(page.locator("[data-import-summary]")).toHaveText("marks-final.csv: 6 row(s) - 5 new, 1 changed, 0 unchanged, 0 rejected");
  await page.locator("[data-marks-apply]").click();
  await expect(page.getByRole("status")).toHaveText("6 mark(s) uploaded from marks-final.csv.");
  await expect(page.locator(`[data-assessment-student="${first.studentNumber}"] [data-final]`)).toHaveText("74");
  await expect(page.locator(`[data-assessment-student="${second.studentNumber}"] [data-final]`)).toHaveText("deferred");
  await expect(page.locator(`[data-assessment-student="${third.studentNumber}"] [data-final]`)).toHaveText("0");
  const context = await api("GET",base,undefined,lecturer.token);
  expect(context.students.find((row) => row.studentNumber === second.studentNumber).entries.EXAM).toMatchObject({state:"deferred",reason:"Medical certificate, dated 3 June",revision:1});
  expect(context.students.find((row) => row.studentNumber === third.studentNumber).entries.EXAM).toMatchObject({state:"absent",revision:2});

  // The reference applies once: replaying returns the original outcome, and reusing it for other content is refused.
  const rows = [[first,"CW","40",""],[first,"EXAM","70",""],[second,"CW","25",""],[second,"EXAM","DEFERRED","Medical certificate, dated 3 June"],[third,"CW","EXEMPT","Recognised prior coursework"],[third,"EXAM","ABSENT","Did not sit"]]
    .map(([student,componentCode,value,reason]) => ({studentNumber:student.studentNumber,componentCode,value,reason}));
  const preview = await api("POST",`${base}/imports`,{mode:"preview",planId:plan.id,sourceRef:"marks-final.csv",rows},lecturer.token);
  expect(preview).toMatchObject({replayed:true,import:{rowCount:6,applied:6,unchanged:0}});
  const replay = await api("POST",`${base}/imports`,{mode:"apply",planId:plan.id,sourceRef:"marks-final.csv",rows,baseline:"stale"},lecturer.token);
  expect(replay).toMatchObject({replayed:true,import:{id:preview.import.id}});
  expect((await api("GET",base,undefined,lecturer.token)).marks).toEqual(context.marks);
  await denied("POST",`${base}/imports`,{mode:"apply",planId:plan.id,sourceRef:"marks-final.csv",rows:rows.slice(1),baseline:"x"},lecturer.token,409);
  await denied("POST",`${base}/imports`,{mode:"preview",planId:plan.id,sourceRef:"other.csv",rows,extra:true},lecturer.token,400);
  await denied("POST",`${base}/imports`,{mode:"preview",planId:plan.id,sourceRef:"other.csv",rows},outsider.token,404);

  // An unchanged re-upload under a new reference records the file without touching any mark.
  const again = await api("POST",`${base}/imports`,{mode:"preview",planId:plan.id,sourceRef:"marks-final-copy.csv",rows},lecturer.token);
  expect(again.summary).toEqual({rows:6,new:0,changed:0,unchanged:6,rejected:0});
  expect((await api("POST",`${base}/imports`,{mode:"apply",planId:plan.id,sourceRef:"marks-final-copy.csv",rows,baseline:again.baseline},lecturer.token)).import).toMatchObject({applied:0,unchanged:6});
  expect((await api("GET",base,undefined,lecturer.token)).marks).toEqual(context.marks);

  await api("POST",`${base}/submit`,{planId:plan.id,reason:"All marks entered"},lecturer.token);
  await denied("POST",`${base}/imports`,{mode:"preview",planId:plan.id,sourceRef:"late.csv",rows},lecturer.token,409);
  await page.locator(`[data-my-teaching] [data-assessment-load="${period.id}:${courses[0].id}"]`).click();
  await expect(page.locator("[data-assessment-missing]")).toContainText("submission submitted");
  await expect(page.locator("[data-marks-upload]")).toHaveCount(0);
  const events = await api("GET",`/api/audit/events?subjectId=${plan.id}`,undefined,admin.token);
  expect(events.filter((row) => row.action === "assessment.marks.imported").map((row) => row.metadata.sourceRef).sort()).toEqual(["marks-final-copy.csv","marks-final.csv"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({path:info.outputPath("mark-upload.png"),fullPage:true});

  async function upload(name,csvLines) {
    const form = page.locator("[data-marks-import]");
    await form.locator('[name="file"]').setInputFiles({name,mimeType:"text/csv",buffer:Buffer.from(csvLines.join("\r\n") + "\r\n")});
    await form.locator('[name="sourceRef"]').fill("");
    await form.locator('[type="submit"]').click();
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
    await api("POST","/api/admissions/migrations",{source:`SAMPLE-AU-${stamp}-${person.id}`,totals:{applications:1,documents:0,documentBytes:0},applications:[{legacyId:`SAMPLE-${person.id}`,accountId:person.id,intakeId:intake.id,state:"Accepted",referenceNumber:`SAMPLE-AU-${stamp}-${person.id}`,studyModeCode:"FULL_TIME",answers:{applicantCategory:"standard"},documents:[],decision:{decision:"offer",conditions:[],offerExpiresAt:new Date(Date.now()+86400000).toISOString()}}]},admin.token);
    const me = await api("GET","/api/registry/me",undefined,person.token);
    await api("PUT","/api/registry/me",{revision:0,phone:"+263771234567",address:{line1:"4 Lake Drive",city:"Mutare",countryCode:"ZW"},nextOfKin:{name:"Pilot Contact",relationship:"parent",phone:"+263771234568"}},person.token);
    const sp = me.programmes.find((row) => row.intakeId === intake.id);
    await api("POST",`/api/registry/programmes/${sp.id}/approve`,{identityConfirmed:true,reason:"Synthetic identity and complete contact profile"},admin.token);
    return {id:sp.id,studentNumber:me.studentNumber};
  }
  async function calendar(y) {
    const periods = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
    let parent = periods.find((row) => row.periodType === "academic_year" && row.startsOn === `${y}-01-01` && row.endsOn === `${y}-12-31`);
    if (!parent) {parent = await api("POST","/api/master-data/academic-periods",{code:`AU-Y-${y}-${stamp}`,name:`SAMPLE marks ${y}`,periodType:"academic_year",startsOn:`${y}-01-01`,endsOn:`${y}-12-31`},admin.token);await api("POST",`/api/master-data/academic-periods/${parent.id}/transitions`,{toStatus:"published",reason:"Synthetic year"},admin.token);}
    let termRow = periods.find((row) => row.periodType === "semester" && row.parentId === parent.id && row.startsOn === `${y}-02-01` && row.endsOn === `${y}-06-30`);
    if (!termRow) {termRow = await api("POST","/api/master-data/academic-periods",{code:`AU-S-${y}-${stamp}`,name:`SAMPLE marks ${y} S1`,periodType:"semester",parentId:parent.id,startsOn:`${y}-02-01`,endsOn:`${y}-06-30`,windows:{registration:[day(-7),day(7)],results_publication:[day(-7),day(7)]}},admin.token);await api("POST",`/api/master-data/academic-periods/${termRow.id}/transitions`,{toStatus:"published",reason:"Synthetic semester"},admin.token);}
    return termRow;
  }
  async function submit(target,values) {for (const [field,value] of Object.entries(values)) {const input = target.locator(`[name="${field}"]`);if (await input.evaluate((el) => el.tagName === "SELECT")) await input.selectOption(String(value));else await input.fill(String(value));}await target.locator('[type="submit"], button:not([type])').last().click();}
  async function api(method,path,data,token) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);return (await response.json()).data;}
  async function denied(method,path,data,token,status) {const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);}
});
