import { expect } from "@playwright/test";
import pg from "pg";

export async function exerciseCourseRegistration({ page,staff,request,admin,applicantToken,programme,stranger,stamp,testInfo }) {
  const base = `/api/registry/programmes/${programme.id}`;
  const reportPath = `/api/reports/registry?intakeId=${programme.intakeId}`;
  const own = `/api/registry/me/programmes/${programme.id}/registrations`;
  const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
  const calendars = await api("GET","/api/master-data/academic-periods",undefined,admin.token);
  let year = calendars.find((period) => period.periodType === "academic_year" && period.startsOn === "2033-01-01");
  if (!year) {
    year = await api("POST","/api/master-data/academic-periods",{ code: `REG-YEAR-${stamp}`,name: "Registration pilot 2033",periodType: "academic_year",startsOn: "2033-01-01",endsOn: "2033-12-31" },admin.token);
    await api("POST",`/api/master-data/academic-periods/${year.id}/transitions`,{ toStatus: "published",reason: "Registry pilot year" },admin.token);
  }
  const desktop = testInfo.project.name === "desktop";
  const semester = await api("POST","/api/master-data/academic-periods",{ code: `REG-TERM-${stamp}`,name: `Registration ${stamp}`,periodType: "semester",parentId: year.id,
    startsOn: desktop ? "2033-02-01" : "2033-06-01",endsOn: desktop ? "2033-05-31" : "2033-09-30",windows: { registration: [date(-7),date(7)],results_publication:[date(-7),date(7)] } },admin.token);
  await api("POST",`/api/master-data/academic-periods/${semester.id}/transitions`,{ toStatus: "published",reason: "Registry pilot semester" },admin.token);
  await staff.locator("[data-registry-filter]").getByRole("button",{ name: "Search",exact: true }).click();
  await expect(staff.locator("[data-registry-filter]").getByRole("button",{ name: "Search",exact: true })).toBeEnabled();
  const createDetails = staff.locator("details").filter({ has: staff.locator("[data-registration-create]") });
  await createDetails.locator("summary").click();
  await submit(staff.locator("[data-registration-create]"),{ academicPeriodId: semester.id,yearOfStudy: "1",term: "S1",creditLimit: "30",reason: "Pilot cohort registration" });
  await expect(staff.getByRole("status")).toHaveText("Registration period created.");
  const initial = (await api("GET",`${base}/registrations`,undefined,admin.token))[0];
  const periodId = initial.period.id;
  const periodPath = `${base}/registration-periods/${periodId}`;
  const checkPath = `${base}/registrations/${periodId}/checks`;
  const selectionPath = `${own}/${periodId}`;
  const confirmPath = `${selectionPath}/confirm`;
  await refused("POST",periodPath,{toStatus: "open",reason: "Incomplete timetable"},admin.token,409);
  await refused("POST",`${base}/registration-periods`,{academicPeriodId:semester.id,yearOfStudy:1,term:"S1",creditLimit:30,reason:"Duplicate"},admin.token,409);
  await refused("POST",periodPath,{toStatus:"open",reason:"Student cannot configure"},applicantToken,403);
  const ids = initial.offerings.map((course) => course.courseId);
  const deliveryDetails = staff.locator(`[data-registration-period="${periodId}"] details`).filter({hasText:"Course delivery"});
  await deliveryDetails.locator("summary").click();
  for (let index = 0; index < ids.length; index++) {
    const form = staff.locator(`[data-registration-offering="${periodId}"][data-course="${ids[index]}"]`);
    if (!await form.isVisible()) await staff.locator(`[data-registration-period="${periodId}"] summary`).filter({hasText:"Course delivery"}).click();
    await submit(form,{delivery:"scheduled",day:"1",start:index ? "09:30" : "09:00",end:index ? "10:30" : "10:00",reason:"Pilot teaching schedule"});
    await expect(staff.getByRole("status")).toHaveText("Registration period updated.");
  }
  await submit(staff.locator(`[data-registration-status="${periodId}"]`),{toStatus:"open",reason:"Open pilot registration"});
  await expect(staff.getByRole("status")).toHaveText("Registration period updated.");
  await page.reload();
  let selection = page.locator(`[data-form="course-selection"][data-period="${periodId}"]`);
  for (const id of ids) await selection.locator(`[value="${id}"]`).check();
  await selection.getByRole("button",{name:"Save course selection",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Course selection saved.");
  let context = (await api("GET",own,undefined,applicantToken))[0];
  expect((await api('GET',reportPath,undefined,admin.token)).totals).toMatchObject({registrationRecords:1,draftRegistrations:1,confirmedRegistrations:0,courseEnrolments:0});
  expect(context.eligibility.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(["CLASH","ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]));
  await refused("POST",confirmPath,{revision:context.registration.revision},applicantToken,409);
  await refused("PUT",selectionPath,{revision:0,courseIds:ids},applicantToken,409);
  await api("PUT",selectionPath,{revision:context.registration.revision,courseIds:[ids[0]]},applicantToken);
  context = (await api("GET",own,undefined,applicantToken))[0];
  expect(context.eligibility.blockers.some((item) => item.code === "CORE_COURSE")).toBe(true);
  await refused("POST",confirmPath,{revision:context.registration.revision},applicantToken,409);
  await api("PUT",selectionPath,{revision:context.registration.revision,courseIds:ids},applicantToken);
  await submit(staff.locator(`[data-registration-status="${periodId}"]`),{toStatus:"planning",reason:"Resolve meeting overlap"});
  await expect(staff.getByRole("status")).toHaveText("Registration period updated.");
  await staff.locator(`[data-registration-period="${periodId}"] summary`).filter({hasText:"Course delivery"}).click();
  await submit(staff.locator(`[data-registration-offering="${periodId}"][data-course="${ids[1]}"]`),{delivery:"scheduled",day:"2",start:"09:30",end:"10:30",reason:"Move to Tuesday"});
  await expect(staff.getByRole("status")).toHaveText("Registration period updated.");
  await submit(staff.locator(`[data-registration-status="${periodId}"]`),{toStatus:"open",reason:"Timetable corrected"});
  await expect(staff.getByRole("status")).toHaveText("Registration period updated.");
  const registrySession = await staff.evaluate(() => JSON.parse(sessionStorage.getItem("svu.registry.session")));
  context = (await api("GET",own,undefined,applicantToken))[0];
  let clearance = {revision:context.registration.revision,checkType:"academic",outcome:"eligible",reason:"First-year academic eligibility verified",evidenceRef:`ACADEMIC-${stamp}`,expiresOn:date(7)};
  await refused("POST",checkPath,{...clearance,checkType:"financial"},registrySession.token,403);
  await refused("POST",checkPath,clearance,applicantToken,403);
  await refused("POST",checkPath,clearance,stranger.token,403);
  const clearanceForm = staff.locator(`[data-registration-check="${periodId}"]`);
  expect(await clearanceForm.locator('[name="checkType"] option').allTextContents()).toEqual(["academic"]);
  const {revision: reviewedRevision, ...clearanceValues} = clearance;
  await submit(clearanceForm,clearanceValues);
  await expect(staff.getByRole("status")).toHaveText("Clearance recorded.");
  const strangerMe = await api("GET","/api/identity/me",undefined,stranger.token);
  await api("POST","/api/access/role-assignments",{accountId:strangerMe.account.id,roleCode:"finance_officer",scope:{programmeCodes:["BSC-IS"],intakeIds:[programme.intakeId]},reason:"Scoped pilot finance verifier"},admin.token);
  await api("POST",checkPath,{...clearance,checkType:"financial",outcome:"blocked",reason:"Financial evidence outstanding"},stranger.token);
  context = (await api("GET",own,undefined,applicantToken))[0];
  expect(context.eligibility.blockers.map((item) => item.code)).toEqual(["FINANCIAL_CLEARANCE"]);
  await refused("POST",confirmPath,{revision:context.registration.revision},applicantToken,409);
  await refused("POST",checkPath,{...clearance,checkType:"financial",expiresOn:date(-1)},stranger.token,400);
  await api("POST",checkPath,{...clearance,checkType:"financial",reason:"Pilot financial evidence verified",evidenceRef:`FINANCE-${stamp}`},stranger.token);
  await api("PUT",selectionPath,{revision:context.registration.revision,courseIds:ids},applicantToken);
  context = (await api("GET",own,undefined,applicantToken))[0];
  expect(context.eligibility.blockers.map((item) => item.code)).toEqual(["ACADEMIC_CLEARANCE","FINANCIAL_CLEARANCE"]);
  await refused("POST",checkPath,clearance,registrySession.token,409);
  await refused("POST",confirmPath,{revision:context.registration.revision},applicantToken,409);
  clearance = {...clearance,revision:context.registration.revision};
  await api("POST",checkPath,clearance,registrySession.token);
  await api("POST",checkPath,{...clearance,checkType:"financial",reason:"Rechecked current course selection",evidenceRef:`FINANCE-RECHECK-${stamp}`},stranger.token);
  await page.reload();
  await expect(page.locator("[data-confirm-registration]")).toBeEnabled();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/registrations/${periodId}/confirm`));
  await page.locator("[data-confirm-registration]").click();
  const retries = await Promise.all([api("POST",confirmPath,{revision:context.registration.revision},applicantToken),api("POST",confirmPath,{revision:context.registration.revision},applicantToken)]);
  const confirmation = (await (await responsePromise).json()).data;
  await expect(page.getByRole("status")).toContainText(`Registration confirmed. ${confirmation.referenceNumber}`);
  expect(retries.every((entry) => entry.referenceNumber === confirmation.referenceNumber)).toBe(true);
  expect(confirmation.credits).toBe(30);
  expect(confirmation.courses).toHaveLength(2);
  await refused("PUT",selectionPath,{revision:context.registration.revision,courseIds:[]},applicantToken,409);
  await refused("POST",checkPath,clearance,registrySession.token,409);
  await refused("POST",periodPath,{toStatus:"planning",reason:"Cannot edit confirmed period"},admin.token,409);
  await api("POST",periodPath,{toStatus:"closed",reason:"Close completed registration window"},admin.token);
  const replay = await api("POST",confirmPath,{revision:context.registration.revision},applicantToken);
  expect(replay.referenceNumber).toBe(confirmation.referenceNumber);
  const report = await api('GET',reportPath,undefined,admin.token);
  expect(report.totals).toMatchObject({programmeRecords:1,onboarded:1,registrationPeriods:1,closedPeriods:1,registrationRecords:1,draftRegistrations:0,confirmedRegistrations:1,courseEnrolments:2});
  expect(Object.values(report.controls).every(Boolean)).toBe(true);expect(JSON.stringify(report)).not.toContain(confirmation.referenceNumber);
  await staff.locator('[data-registry-report] > summary').click();
  await staff.locator('[data-registry-report-filter] [name="intakeId"]').selectOption(programme.intakeId);await staff.getByRole('button',{name:'Refresh registry report',exact:true}).click();
  await expect(staff.locator('[data-registry-metric="confirmedRegistrations"]')).toContainText('1');
  const downloadEvent = staff.waitForEvent('download');await staff.locator('[data-registry-report-export]').click();const file = await downloadEvent;
  const {readFile} = await import('node:fs/promises');const csv = await readFile(await file.path(),'utf8');
  expect(csv).toContain('registry-enrolment-v1');expect(csv).toContain('owner approval pending');expect(csv).toContain('programme-period records');expect(csv).not.toContain(confirmation.referenceNumber);
  await staff.locator('[data-registry-report]').screenshot({path:testInfo.outputPath('registry-enrolment-report.png')});
  const db = new pg.Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  try {
    const counts = await db.query("select count(*)::int as count from course_enrolments where registration_id = $1",[context.registration.id]);
    expect(counts.rows[0].count).toBe(2);
    const audit = await db.query("select count(*)::int as count from audit_events where subject_id = $1 and action = 'registry.registration.confirmed'",[context.registration.id]);
    expect(audit.rows[0].count).toBe(1);
    if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')) throw new Error('The reporting source probe requires an isolated integration database.');
    const alternate = (await db.query('select id from intakes where id <> $1 order by id limit 1',[programme.intakeId])).rows[0];expect(alternate).toBeTruthy();
    try {
      await db.query('update student_programmes set intake_id = $2 where id = $1',[programme.id,alternate.id]);
      await refused('GET',reportPath,undefined,admin.token,409);
      expect((await api('GET','/api/reports/registry/intakes',undefined,admin.token)).some((row) => row.intakeId === programme.intakeId)).toBe(true);
      await staff.getByRole('button',{name:'Refresh registry report',exact:true}).click();
      await expect(staff.locator('[data-registry-report-error]')).toContainText('require reconciliation');await expect(staff.locator('[data-registry-metric]')).toHaveCount(0);await expect(staff.locator('[data-registry-report-export]')).toBeDisabled();
    } finally {await db.query('update student_programmes set intake_id = $2 where id = $1',[programme.id,programme.intakeId]);}
    await staff.getByRole('button',{name:'Refresh registry report',exact:true}).click();await expect(staff.locator('[data-registry-metric="confirmedRegistrations"]')).toContainText('1');
    const reportEvents = await api('GET','/api/audit/events?action=reports.registry.exported',undefined,admin.token);expect(JSON.stringify(reportEvents)).toContain(programme.intakeId);expect(JSON.stringify(reportEvents)).not.toContain(confirmation.referenceNumber);
  } finally { await db.end(); }
  await staff.locator("[data-registration-refresh]").click();
  await expect(staff.locator(`[data-registration-period="${periodId}"]`)).toContainText(confirmation.referenceNumber);
  await page.reload();
  await expect(page.locator(".course-registration")).toContainText(confirmation.referenceNumber);
  await page.evaluate(() => scrollTo(0,0));
  await staff.evaluate(() => scrollTo(0,0));
  for (const current of [page,staff]) expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("registration-confirmed-student.png"),fullPage:true});
  await staff.screenshot({path:testInfo.outputPath("registration-confirmed-registrar.png"),fullPage:true});

  async function api(method,path,data,token) {
    const response = await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(response.ok(),`${method} ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  }
  async function refused(method,path,data,token,status) {
    const response = await request.fetch(path,{method,data,headers:{Authorization:`Bearer ${token}`}});
    expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);
  }
  async function submit(form,values) {
    for (const [name,value] of Object.entries(values)) {
      const field = form.locator(`[name="${name}"]`);
      if (await field.evaluate((element) => element.tagName === "SELECT")) await field.selectOption(String(value));
      else await field.fill(String(value));
    }
    await form.locator('[type="submit"]').click();
  }
}
