import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { exerciseCourseRegistration } from "./support/course-registration.js";
import { exerciseResults } from "./support/results.js";

test("applicant submits, staff reviews and offers, acceptance creates a student", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(480_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = await api("POST", "/api/identity/sessions", {
    email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!"
  });
  const stamp = `${testInfo.project.name}.${Date.now()}`;
  const intake = await api("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is", label: `Browser ${stamp}`, capacity: 3,
    startsOn: "2033-02-01",
    applicationOpensAt: new Date(Date.now() - 86_400_000).toISOString(),
    applicationClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, admin.token);
  await api("POST", `/api/master-data/intakes/${intake.id}/transitions`, { toStatus: "published", reason: "Browser pilot" }, admin.token);

  const email = `browser.${stamp}@example.com`;
  const password = "Kariba-Dam-Applicant-2026!";
  await page.goto("/#apply");
  await page.getByRole("tab", { name: "Create account", exact: true }).click();
  await fillForm(page, "register", { email, preferredName: "Pilot", legalName: `Browser Applicant ${stamp}` });
  await page.locator('[data-form="activate"]').waitFor();
  const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) =>
    JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX, file), "utf8"))));
  const activation = messages.find((message) => message.recipientEmail === email);
  expect(activation).toBeTruthy();
  await fillForm(page, "activate", {
    token: activation.variables.activationToken, preferredName: "Pilot", legalName: `Browser Applicant ${stamp}`, password
  });
  await fillForm(page, "signin", { email, password });
  await expect(page.locator("[data-signout]")).toBeVisible();
  await fillForm(page, "profile", {
    dateOfBirth: "2003-08-09", phone: "+263771234567", nationalityCode: "ZW",
    priorLevelCode: "CERTIFICATE", studyModeCode: "FULL_TIME", line1: "2 Park Lane", city: "Mutare", countryCode: "ZW"
  });
  await expect(page.getByRole("status")).toHaveText("Details saved.");
  await page.locator(`[data-start="${intake.id}"]`).click();
  await expect(page.getByRole("status")).toContainText("Application started");
  await fillForm(page, "application", { studyModeCode: "FULL_TIME", personalStatement: "I want to study information systems." });
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await fillForm(page, "fee", { method: "waiver_code", reference: "SVU-WAIVER-2027" });
  await expect(page.getByRole("status")).toContainText("fee status saved");

  const applicantSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem("svu.applicant.session")));
  const applications = await api("GET", "/api/admissions/applications", undefined, applicantSession.token);
  const application = applications.find((entry) => entry.intakeId === intake.id);
  expect(application).toBeTruthy();
  const reportPath = `/api/reports/admissions?intakeId=${intake.id}`;
  const draftReport = await api('GET',reportPath,undefined,admin.token);
  expect(draftReport.totals).toMatchObject({applicationsTotal:1,draftApplications:1,underReview:0,capacity:3,placesTaken:0,placesRemaining:3});
  expect(draftReport.controls).toEqual({applicationsReconcile:true,capacityReconciles:true});
  for (const path of [reportPath,`${reportPath}&format=csv`,'/api/reports/admissions/dictionary','/api/reports/admissions/intakes']) expect((await request.get(path,{headers:{Authorization:`Bearer ${applicantSession.token}`}})).status()).toBe(403);
  expect((await request.get(`${reportPath}&asOf=2026-01-01`,{headers:{Authorization:`Bearer ${admin.token}`}})).status()).toBe(400);
  for (const documentType of ["prior_transcript", "national_id"]) {
    await page.locator(`[data-upload="${documentType}"]`).setInputFiles({
      name: `${documentType}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${documentType}\n%%EOF\n`)
    });
    await expect(page.getByRole("status")).toContainText(`${documentType}.pdf uploaded`);
  }
  const uploaded = await api("GET", `/api/admissions/applications/${application.id}`, undefined, applicantSession.token);
  // The real scanner is pending; drive its existing callback after actual browser byte uploads.
  for (const item of uploaded.checklist) {
    for (const document of item.documents) {
      await api("POST", `/api/documents/${document.id}/scan-results`, { result: "clean" }, admin.token);
    }
  }
  await page.reload();
  await page.locator("[data-submit]").click();
  await expect(page.getByRole("status")).toContainText("Submitted. Your reference number is");
  await expect(page.locator(".stepper .is-current")).toHaveText("Submitted");
  await checkLayout(page);

  const staffContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL || process.env.SVU_BASE_URL,
    viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
  try {
    const staff = await staffContext.newPage();
    staff.on("pageerror", (error) => errors.push(error.message));
    await staff.goto("/#admissions");
    await expect(staff.locator(".catalogue-card").filter({ hasText: intake.label })).toBeVisible();
    await fillForm(staff, "staff-signin", { email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!" });
    await staff.locator(`[data-review-detail="${application.id}"]`).click();
    await expect(staff.getByRole("status")).toHaveText("Application loaded.");
    for (const toState of ["Payment verified", "Completeness review"]) await advance(toState);
    await staff.locator("[data-review-info]").click();
    await expect(staff.getByRole("status")).toHaveText("Information request sent.");
    await expect(staff.locator(".review-detail")).toContainText("Information requested");
    const transcript = uploaded.checklist.find((item) => item.documentType === "prior_transcript").documents[0];
    const documentForm = staff.locator(`[data-document-review="${transcript.id}"]`);
    await documentForm.locator('[name="decision"]').selectOption("rejected");
    await expect(documentForm.locator('[name="decision"]')).toHaveValue("rejected");
    await documentForm.locator('[name="reason"]').fill("Transcript is incomplete; upload the full copy.");
    await expect(documentForm.locator('[name="reason"]')).toHaveValue("Transcript is incomplete; upload the full copy.");
    await documentForm.locator('[type="submit"]').click();
    await expect(staff.getByRole("status")).toHaveText("Document review recorded.");
    await page.reload();
    const transcriptRow = page.locator(".file-row").filter({ hasText: "Prior transcript" });
    await expect(transcriptRow).toContainText("Rejected by admissions; upload a new copy");
    await transcriptRow.locator('[data-upload="prior_transcript"]').setInputFiles({
      name: "replacement-transcript.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% replacement transcript\n%%EOF\n")
    });
    await expect(page.getByRole("status")).toContainText("replacement-transcript.pdf uploaded");
    const replaced = await api("GET", `/api/admissions/applications/${application.id}`, undefined, applicantSession.token);
    const replacement = replaced.checklist.find((item) => item.documentType === "prior_transcript").documents.find((document) => document.id !== transcript.id);
    expect(replacement).toBeTruthy();
    await api("POST", `/api/documents/${replacement.id}/scan-results`, { result: "clean" }, admin.token);
    await page.reload();
    await expect(transcriptRow).toContainText("Received and checked");
    await fillForm(page, "respond", { message: "My transcript and identity evidence are attached." });
    await expect(page.getByRole("status")).toContainText("Reply sent");
    await refreshReviewQueue(staff);
    await expect(staff.locator('[data-form="review-transition"] [name="toState"]')).toHaveValue("Academic review");
    for (const toState of ["Academic review", "Decision"]) await advance(toState);
    await fillForm(staff, "review-decision", { decision: "offer", conditions: "", note: "Meets entry requirements." });
    await expect(staff.getByRole("status")).toContainText("Offer recorded");
    expect((await api('GET',reportPath,undefined,admin.token)).totals).toMatchObject({applicationsTotal:1,underReview:0,openOffers:1,acceptedApplications:0,placesTaken:1,placesRemaining:2});
    await checkLayout(staff);
    await page.reload();
    await expect(page.getByRole("heading", { name: "You have an offer" })).toBeVisible();
    await page.locator('[data-offer="accept"]').click();
    await expect(page.getByRole("status")).toContainText("Offer accepted. Your student number is S");
    const studentNumber = (await page.getByRole("status").innerText()).match(/S\d+/)[0];
    await expect(page.locator(".stepper .is-current")).toHaveText("Accepted");
    await refreshReviewQueue(staff);
    await expect(staff.locator("[data-review-convert]")).toBeEnabled();
    await staff.locator("[data-review-convert]").click();
    await expect(staff.getByRole("status")).toHaveText(`${studentNumber} already existed.`);
    await staff.locator('[data-admissions-tab=setup]').click();
    await staff.locator("[data-load-manifest]").click();
    await expect(staff.locator(".admissions-summary > div").filter({ hasText: "Accepted" }).locator("dd")).toHaveText("1");
    const manifest = await api("GET", `/api/admissions/review/intakes/${intake.id}/manifest`, undefined, admin.token);
    expect(manifest.accepted).toHaveLength(1);
    expect(manifest.accepted[0].studentNumber).toBe(studentNumber);
    expect(manifest.notConverted).toBe(0);
    const acceptedReport = await api('GET',reportPath,undefined,admin.token);
    expect(acceptedReport.totals).toMatchObject({applicationsTotal:1,acceptedApplications:1,acceptedNotConverted:0,openOffers:0,placesTaken:manifest.placesTaken,placesRemaining:manifest.placesRemaining});
    expect(JSON.stringify(acceptedReport)).not.toMatch(/studentNumber|applicantName|accountId|answers|referenceNumber|dateOfBirth/);
    await staff.locator('[data-admissions-tab=reports]').click();
    await staff.locator('[data-admissions-report] > summary').click();
    await staff.locator('[data-admissions-report-filter] [name="intakeId"]').selectOption(intake.id);
    await staff.getByRole('button',{name:'Refresh admissions report',exact:true}).click();
    await expect(staff.locator('[data-admissions-report-intake]')).toHaveCount(1);
    await expect(staff.locator('[data-admissions-metric="acceptedApplications"] td').nth(1)).toHaveText('1');
    const reportDownloadEvent = staff.waitForEvent('download');await staff.locator('[data-admissions-report-export]').click();
    const reportDownload = await reportDownloadEvent,reportCsv = await readFile(await reportDownload.path(),'utf8');
    expect(reportDownload.suggestedFilename()).toContain('admissions-operations-');expect(reportCsv).toContain(acceptedReport.definitionVersion);expect(reportCsv).toContain('owner approval pending');expect(reportCsv).not.toContain(studentNumber);
    await staff.locator('[data-admissions-report]').screenshot({path:testInfo.outputPath('admissions-workload.png')});
    if (!new URL(process.env.DATABASE_URL).pathname.startsWith('/svu_rebuild_it_')) throw new Error('Admissions report scope probe requires the isolated database.');
    const reportDb = new pg.Client({connectionString:process.env.DATABASE_URL});await reportDb.connect();
    try {
      const controls = (await reportDb.query(`select a.status,w.state,count(*)::integer as count from applications a left join workflow_instances w on w.id = a.workflow_instance_id where a.intake_id = $1 group by a.status,w.state`,[intake.id])).rows;
      expect(controls).toEqual([{status:'submitted',state:'Accepted',count:1}]);
      await reportDb.query("update resource_scopes set intake_id = null where resource_type = 'Application' and resource_id = $1",[application.id]);
      expect((await request.get(reportPath,{headers:{Authorization:`Bearer ${admin.token}`}})).status()).toBe(409);
      expect((await api('GET','/api/reports/admissions/intakes',undefined,admin.token)).some((row) => row.intakeId === intake.id)).toBe(true);
      await staff.getByRole('button',{name:'Refresh admissions report',exact:true}).click();
      await expect(staff.locator('[data-admissions-report-error]')).toContainText('source scopes require reconciliation');
      await expect(staff.locator('[data-admissions-report-export]')).toBeDisabled();await expect(staff.locator('[data-admissions-metric]')).toHaveCount(0);
    } finally {
      await reportDb.query("update resource_scopes set intake_id = $2 where resource_type = 'Application' and resource_id = $1",[application.id,intake.id]);await reportDb.end();
    }
    await staff.getByRole('button',{name:'Refresh admissions report',exact:true}).click();
    await expect(staff.locator('[data-admissions-metric="acceptedApplications"] td').nth(1)).toHaveText('1');
    const reportAudit = await api('GET',`/api/audit/events?subjectId=${acceptedReport.definitionVersion}`,undefined,admin.token);
    expect(reportAudit.map((row) => row.action)).toEqual(expect.arrayContaining(['reports.admissions.accessed','reports.admissions.exported']));expect(JSON.stringify(reportAudit)).not.toContain(studentNumber);
    const student = await api("GET", "/api/registry/me", undefined, applicantSession.token);
    const studentProgramme = student.programmes.find((entry) => entry.applicationId === application.id);
    const registryReportPath = `/api/reports/registry?intakeId=${intake.id}`;
    expect((await api('GET',registryReportPath,undefined,admin.token)).totals).toMatchObject({programmeRecords:1,pendingOnboarding:1,onboarded:0,registrationRecords:0,courseEnrolments:0});
    expect((await api('GET','/api/reports/registry/dictionary',undefined,admin.token)).metrics).toHaveLength(17);
    for (const path of [registryReportPath,`${registryReportPath}&format=csv`,'/api/reports/registry/dictionary','/api/reports/registry/intakes']) expect((await request.get(path,{headers:{Authorization:`Bearer ${applicantSession.token}`}})).status()).toBe(403);
    expect(student.readiness.missing).toContain("nextOfKin");
    expect((await request.post(`/api/registry/programmes/${studentProgramme.id}/approve`, { data: { identityConfirmed: true, reason: "Incomplete profile" }, headers: { Authorization: `Bearer ${admin.token}` } })).status()).toBe(409);
    expect((await request.get("/api/registry/students")).status()).toBe(401);
    expect((await request.get("/api/registry/students", { headers: { Authorization: `Bearer ${applicantSession.token}` } })).status()).toBe(403);
    const stranger = await createDraftApplication(request, admin.token, intake, `registry.stranger.${stamp}@example.com`, stamp);
    expect((await request.get("/api/registry/me", { headers: { Authorization: `Bearer ${stranger.token}` } })).status()).toBe(403);
    const strangerMe = await api("GET", "/api/identity/me", undefined, stranger.token);
    for (const role of [{ roleCode: "academic_registrar", scope: { programmeCodes: ["OTHER"], intakeIds: ["other"] } }, { roleCode: "auditor", scope: {} }]) {
      await api("POST", "/api/access/role-assignments", { accountId: strangerMe.account.id, ...role, reason: "Registry scope test" }, admin.token);
    }
    await api('POST','/api/access/role-assignments',{accountId:strangerMe.account.id,roleCode:'admissions_officer',scope:{programmeCodes:['OTHER'],intakeIds:['other']},reason:'Scoped admissions report refusal'},admin.token);
    expect((await api('GET','/api/reports/admissions',undefined,stranger.token)).rows).toEqual([]);
    expect((await request.get(`${reportPath}&format=csv`,{headers:{Authorization:`Bearer ${stranger.token}`}})).status()).toBe(404);
    expect((await api('GET','/api/reports/registry',undefined,stranger.token)).rows).toEqual([]);
    expect((await request.get(`${registryReportPath}&format=csv`,{headers:{Authorization:`Bearer ${stranger.token}`}})).status()).toBe(404);
    const scopedRows = await api("GET", "/api/registry/students", undefined, stranger.token);
    expect(scopedRows.items).toEqual([]);
    expect((await request.get(`/api/registry/programmes/${studentProgramme.id}`, { headers: { Authorization: `Bearer ${stranger.token}` } })).status()).toBe(403);
    expect((await request.post(`/api/registry/programmes/${studentProgramme.id}/approve`, { data: { identityConfirmed: true, reason: "Wrong scope" }, headers: { Authorization: `Bearer ${stranger.token}` } })).status()).toBe(403);
    await fillForm(page, "student-profile", { phone: "+263771234567", line1: "2 Park Lane", city: "Mutare", countryCode: "ZW", kinName: "Tariro Pilot", relationship: "parent", kinPhone: "+263771234568" });
    await expect(page.getByRole("status")).toHaveText("Student profile saved.");
    const savedStudent = await api("GET", "/api/registry/me", undefined, applicantSession.token);
    expect(savedStudent.readiness.complete).toBe(true);
    expect((await request.put("/api/registry/me", { data: { ...savedStudent.profile, revision: student.profile.revision }, headers: { Authorization: `Bearer ${applicantSession.token}` } })).status()).toBe(409);
    const privateDetail = await api("GET", `/api/registry/programmes/${studentProgramme.id}`, undefined, admin.token);
    expect(privateDetail).not.toHaveProperty("profile");
    expect(JSON.stringify(privateDetail)).not.toContain("Tariro Pilot");
    await staff.goto("/#registry");
    const loginForm = staff.locator("[data-registry-login]");
    await loginForm.locator('[name="email"]').fill("registrar@southvalley.test");
    await loginForm.locator('[name="password"]').fill("Kariba-Senate-Approvals-2026!");
    await loginForm.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(staff.locator("[data-registry-filter]")).toBeVisible();
    await staff.locator('[data-registry-filter] [name="q"]').fill(studentNumber);
    await staff.locator("[data-registry-filter]").getByRole("button", { name: "Search", exact: true }).click();
    await staff.locator(`[data-registry-detail="${studentProgramme.id}"]`).click();
    await expect(staff.locator("[data-registry-approve]")).toBeVisible();
    await staff.locator('[data-registry-approve] [name="identityConfirmed"]').check();
    await staff.locator('[data-registry-approve] [name="reason"]').fill("Accepted-offer identity verified for pilot onboarding.");
    const onboardingResponse = staff.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/registry/programmes/${studentProgramme.id}/approve`));
    await staff.getByRole("button", { name: "Approve onboarding", exact: true }).click();
    expect((await onboardingResponse).status()).toBe(200);
    await expect(staff.getByRole("status")).toHaveText("Onboarding approved.",{timeout:30_000});
    const onboarded = await api("GET", `/api/registry/programmes/${studentProgramme.id}`, undefined, admin.token);
    expect(onboarded.status).toBe("onboarded");
    expect((await api('GET',registryReportPath,undefined,admin.token)).totals).toMatchObject({programmeRecords:1,pendingOnboarding:0,onboarded:1});
    expect(onboarded.history.map((entry) => entry.toStatus)).toEqual(["pending_onboarding", "onboarded"]);
    expect((await request.post(`/api/registry/programmes/${studentProgramme.id}/approve`, { data: { identityConfirmed: true, reason: "Repeated approval" }, headers: { Authorization: `Bearer ${admin.token}` } })).status()).toBe(409);
    const independentReads = /\/api\/registry\/me\/programmes\/[^/]+\/(registrations|results|academic)$/;
    const heldReads = [];let releaseReads;
    const readBarrier = new Promise((resolve) => {releaseReads = resolve;});
    await page.route(independentReads,async (route) => {
      heldReads.push(route.request().url());if (heldReads.length === 3) releaseReads();
      await readBarrier;await route.continue();
    });
    await page.reload();
    await expect(page.locator(".student-onboarding")).toContainText("onboarded");
    expect(heldReads).toHaveLength(3);
    await page.unroute(independentReads);
    await checkLayout(staff);
    await staff.evaluate(() => window.scrollTo(0, 0));
    await staff.screenshot({ path: testInfo.outputPath("registry-onboarded.png"), fullPage: true });
    await exerciseCourseRegistration({page,staff,request,admin,applicantToken:applicantSession.token,programme:studentProgramme,stranger,stamp,testInfo});
    await exerciseResults({page,staff,browser,request,admin,applicantToken:applicantSession.token,programme:studentProgramme,stranger,stamp,testInfo});
    await checkLayout(page);
    await page.screenshot({ path: testInfo.outputPath("applicant-accepted.png"), fullPage: true });
    await staff.screenshot({ path: testInfo.outputPath("staff-manifest.png"), fullPage: true });
    expect(errors).toEqual([]);

    async function advance(toState) {
      await fillForm(staff, "review-transition", { toState, reason: "Evidence checked by pilot reviewer" });
      await expect(staff.getByRole("status")).toHaveText(`Review advanced to ${toState}.`);
    }
  } finally {
    await staffContext.close();
  }

  async function api(method, path, data, token) {
    const response = await request.fetch(path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
    return (await response.json()).data;
  }
});

test("admissions browser covers withdrawal, rejection, decline, expiry, and upload failure", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = await apiRequest(request, "POST", "/api/identity/sessions", {
    email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!"
  });
  const stamp = `${testInfo.project.name}.${Date.now()}`;
  const intake = await createPublishedIntake(request, admin.token, `Browser edge ${stamp}`, 8);

  const uploadCase = await createDraftApplication(request, admin.token, intake, `upload.${stamp}@example.com`, stamp);
  await signInApplicant(page, uploadCase.email, uploadCase.password);
  await page.locator(`[data-upload="prior_transcript"]`).setInputFiles({
    name: "malware.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ\x90\x00")
  });
  await expect(page.getByRole("status")).toHaveText("Upload a PDF, JPEG, or PNG file.");

  const withdrawalCase = await createSubmittedApplication(request, admin.token, intake, `withdraw.${stamp}@example.com`, stamp);
  await signInApplicant(page, withdrawalCase.email, withdrawalCase.password);
  await page.locator("[data-withdraw]").click();
  await page.locator(".ui-dialog").getByRole("button", { name: "Withdraw application" }).click();
  await expect(page.getByRole("status")).toHaveText("Application withdrawn.");

  const rejectionCase = await createSubmittedApplication(request, admin.token, intake, `reject.${stamp}@example.com`, stamp);
  await moveToDecision(request, rejectionCase.application, admin.token);
  const staffContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL || process.env.SVU_BASE_URL,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch
  });
  try {
    const staff = await staffContext.newPage();
    staff.on("pageerror", (error) => errors.push(error.message));
    await staff.goto("/#admissions");
    await fillForm(staff, "staff-signin", { email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!" });
    await staff.locator(`[data-review-detail="${rejectionCase.application.id}"]`).click();
    await fillForm(staff, "review-decision", {
      decision: "reject", reasonCode: "ENTRY_REQUIREMENTS_NOT_MET", note: "Entry requirements not met."
    });
    await expect(staff.getByRole("status")).toHaveText("Reject recorded. State is Rejected.");

    const declineCase = await createSubmittedApplication(request, admin.token, intake, `decline.${stamp}@example.com`, stamp);
    await moveToDecision(request, declineCase.application, admin.token);
    await apiRequest(request, "POST", `/api/admissions/review/applications/${declineCase.application.id}/decision`, {
      decision: "offer", conditions: [], note: "Offer for decline journey."
    }, admin.token);
    await signInApplicant(page, declineCase.email, declineCase.password);
    await expect(page.getByRole("heading", { name: "You have an offer" })).toBeVisible();
    await page.locator('[data-offer="decline"]').click();
    await page.locator(".ui-dialog").getByRole("button", { name: "Decline offer" }).click();
    await expect(page.getByRole("status")).toHaveText("Offer declined.");
    await expect(page.locator(".section-header").filter({ hasText: "Progress" })).toContainText("Declined");

    const expiryCase = await createSubmittedApplication(request, admin.token, intake, `expire.${stamp}@example.com`, stamp);
    await moveToDecision(request, expiryCase.application, admin.token);
    await apiRequest(request, "POST", `/api/admissions/review/applications/${expiryCase.application.id}/decision`, {
      decision: "offer", conditions: [], note: "Offer for expiry journey."
    }, admin.token);
    await expireOfferInDatabase(expiryCase.application.id);
    const overdueReport = await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${intake.id}`,undefined,admin.token);
    expect(overdueReport.totals).toMatchObject({withdrawnApplications:1,rejectedApplications:1,declinedApplications:1,openOffers:1,overdueOffers:1,expiredApplications:0,placesTaken:1});
    await signInApplicant(page, expiryCase.email, expiryCase.password);
    await expect(page.getByRole("heading", { name: "You have an offer" })).toBeVisible();
    await page.locator('[data-offer="accept"]').click();
    await expect(page.getByRole("status")).toHaveText("This offer has expired.");
    await staff.locator('[data-admissions-tab=setup]').click();
    await staff.locator("[data-expire-offers]").click();
    await expect(staff.getByRole("status")).toContainText("stale offer(s) expired.");
    const expiredReport = await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${intake.id}`,undefined,admin.token);
    expect(expiredReport.totals).toMatchObject({openOffers:0,overdueOffers:0,expiredApplications:1,placesTaken:0});
    expect(expiredReport.controls).toEqual({applicationsReconcile:true,capacityReconciles:true});
  } finally {
    await staffContext.close();
  }

  await signInApplicant(page, rejectionCase.email, rejectionCase.password);
  await expect(page.locator(".section-header").filter({ hasText: "Progress" })).toContainText("Rejected");
  await expect(page.locator(".apply-signed-in")).toContainText("Reason:");
  await checkLayout(page);
  expect(errors).toEqual([]);
});

test("Stage 2 routes, deferral, reopening, messages, and sample migration reconcile", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const admin = await apiRequest(request, "POST", "/api/identity/sessions", {
    email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!"
  });
  const stamp = `${testInfo.project.name}.${Date.now()}`;
  const intake = await createPublishedIntake(request, admin.token, `Stage 2 ${stamp}`, 6);
  const target = await apiRequest(request, "POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is", label: `Deferred ${stamp}`, capacity: 6, startsOn: "2034-09-01",
    applicationOpensAt: new Date(Date.now() - 86400000).toISOString(), applicationClosesAt: new Date(Date.now() + 30 * 86400000).toISOString()
  }, admin.token);
  await apiRequest(request, "POST", `/api/master-data/intakes/${target.id}/transitions`, { toStatus: "published", reason: "Deferral test" }, admin.token);
  const configured = await apiRequest(request, "PUT", "/api/admissions/routes/postgraduate", {
    academicStages: ["Academic review", "Faculty review", "Senate review"], programmeIds: ["prog_bsc_is"], reason: "Temporary browser route test"
  }, admin.token);
  expect(configured.academicStages).toHaveLength(3);
  const staffContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL || process.env.SVU_BASE_URL,
    viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
  try {
    const applicant = await createSubmittedApplication(request, admin.token, intake, `completion.${stamp}@example.com`, stamp);
    await signInApplicant(page, applicant.email, applicant.password);
    const staff = await staffContext.newPage();
    staff.on("pageerror", (error) => errors.push(error.message));
    await staff.goto("/#admissions");
    await fillForm(staff, "staff-signin", { email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!" });
    await fillForm(staff, "review-filters", { reviewRoute: "postgraduate", intakeId: intake.id, assigned: "unassigned" });
    await expect(staff.locator(`[data-review-detail="${applicant.application.id}"]`)).toBeVisible();
    await staff.locator(`[data-review-detail="${applicant.application.id}"]`).click();
    await staff.locator("[data-review-assign]").click();
    await expect(staff.getByRole("status")).toHaveText("Application assigned.");
    await fillForm(staff, "review-message", { message: "Your faculty review is scheduled.", recipients: "selected" });
    await expect(staff.getByRole("status")).toHaveText("Message sent.");
    await staff.locator('[data-admissions-tab=applications]').click();
    await page.reload();
    await expect(page.locator(".apply-signed-in")).toContainText("Your faculty review is scheduled.");
    const detail = await apiRequest(request, "GET", `/api/admissions/review/applications/${applicant.application.id}`, undefined, admin.token);
    const document = detail.checklist[0].documents[0];
    const docForm = staff.locator(`[data-document-review="${document.id}"]`);
    await docForm.locator('[name="reason"]').fill("Evidence complete and legible.");
    await docForm.locator('[type="submit"]').click();
    await expect(staff.getByRole("status")).toHaveText("Document review recorded.");
    for (const toState of ["Payment verified", "Completeness review", "Academic review", "Faculty review", "Senate review", "Decision"]) {
      await fillForm(staff, "review-transition", { toState, reason: "Assessment completed" });
      await expect(staff.getByRole("status")).toHaveText(`Review advanced to ${toState}.`);
    }
    await page.reload();
    await fillForm(page, "deferral", { targetIntakeId: target.id, reason: "I need to start the following year." });
    await expect(page.getByRole("status")).toHaveText("Deferral request sent.");
    const bypass = await request.post(`/api/workflows/instances/${applicant.application.workflowInstanceId}/transitions`, { data: { toState: "Deferred", reason: "Attempt to bypass admissions evidence" }, headers: { Authorization: `Bearer ${admin.token}` } });
    expect(bypass.status()).toBe(409);
    await refreshReviewQueue(staff);
    await fillForm(staff, "review-deferral", { decision: "approve", reason: "Approved for the later intake." });
    await expect(staff.getByRole("status")).toHaveText("Application updated.");
    await page.reload();
    await expect(page.locator(".apply-signed-in")).toContainText("Your application has been deferred.");
    const completed = await apiRequest(request, "GET", `/api/admissions/review/applications?includeClosed=true&intakeId=${intake.id}`, undefined, admin.token);
    expect(completed.find((item) => item.id === applicant.application.id).state).toBe("Deferred");
    expect((await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${intake.id}`,undefined,admin.token)).totals).toMatchObject({applicationsTotal:1,deferredApplications:1,underReview:0,placesTaken:0});
    expect((await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${target.id}`,undefined,admin.token)).totals.applicationsTotal).toBe(0);
    await fillForm(staff, "review-reopen", { reason: "Applicant is now able to attend the original intake." });
    await expect(staff.getByRole("status")).toHaveText("Application updated.");
    const reopened = await apiRequest(request, "GET", `/api/admissions/applications/${applicant.application.id}`, undefined, applicant.token);
    expect(reopened.workflowState).toBe("Completeness review");
    expect(reopened.history.some((entry) => entry.state === "Deferred")).toBeTruthy();
    expect(reopened.history.filter((entry) => entry.state === "Submitted")).toHaveLength(2);
    expect((await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${intake.id}`,undefined,admin.token)).totals).toMatchObject({applicationsTotal:1,deferredApplications:0,underReview:1});
    await fillForm(staff, "review-withdraw", { reason: "Applicant confirmed withdrawal with admissions." });
    await expect(staff.getByRole("status")).toHaveText("Application updated.");
    const withdrawn = await apiRequest(request, "GET", `/api/admissions/applications/${applicant.application.id}`, undefined, applicant.token);
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.workflowState).toBe("Withdrawn");
    expect((await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${intake.id}`,undefined,admin.token)).totals).toMatchObject({applicationsTotal:1,withdrawnApplications:1,underReview:0,deferredApplications:0});

    const me = await apiRequest(request, "GET", "/api/identity/me", undefined, applicant.token);
    const openMigrationIntake = await createPublishedIntake(request, admin.token, `Migration open ${stamp}`, 4);
    const acceptedMigrationIntake = await createPublishedIntake(request, admin.token, `Migration accepted ${stamp}`, 4);
    const bytes = Buffer.from("%PDF-1.4\n% legacy sample\n%%EOF\n");
    const sample = { source: `sample-${stamp}`, totals: { applications: 3, documents: 1, documentBytes: bytes.length }, applications: [{
      legacyId: "LEGACY-A1", accountId: me.account.id, intakeId: target.id, state: "Rejected", referenceNumber: `LEGACY-${stamp}`,
      decision: { decision: "reject", reasonCode: "ENTRY_REQUIREMENTS_NOT_MET" }, messages: ["Historical review completed."],
      documents: [{ legacyId: "LEGACY-D1", documentType: "prior_transcript", fileName: "legacy-transcript.pdf", contentType: "application/pdf", contentBase64: bytes.toString("base64"), checksum: await sha256(bytes) }]
    }, {
      legacyId: "LEGACY-A2", accountId: me.account.id, intakeId: openMigrationIntake.id, state: "Submitted", referenceNumber: `LEGACY-OPEN-${stamp}`
    }, {
      legacyId: "LEGACY-A3", accountId: me.account.id, intakeId: acceptedMigrationIntake.id, state: "Accepted", referenceNumber: `LEGACY-ACCEPTED-${stamp}`,
      decision: { decision: "offer", offerExpiresAt: "2034-01-01T00:00:00Z", conditions: [] }
    }] };
    const denied = await request.post("/api/admissions/migrations", { data: sample, headers: { Authorization: `Bearer ${applicant.token}` } });
    expect(denied.status()).toBe(403);
    const badTotals = await request.post("/api/admissions/migrations", { data: { ...sample, totals: { ...sample.totals, documents: 2 } }, headers: { Authorization: `Bearer ${admin.token}` } });
    expect(badTotals.status()).toBe(409);
    const imported = await apiRequest(request, "POST", "/api/admissions/migrations", sample, admin.token);
    const replayed = await apiRequest(request, "POST", "/api/admissions/migrations", sample, admin.token);
    expect(replayed.id).toBe(imported.id);
    expect(replayed.replayed).toBeTruthy();
    const report = await apiRequest(request, "GET", `/api/admissions/migrations/${imported.id}`, undefined, admin.token);
    expect(report.reconciled).toBeTruthy();
    expect(report.targetTotals).toEqual(sample.totals);
    const importedApplication = await apiRequest(request, "GET", `/api/admissions/applications/${imported.mappings[0].applicationId}`, undefined, applicant.token);
    expect(importedApplication.workflowState).toBe("Rejected");
    expect(importedApplication.checklist[0].documents[0].lifecycle).toBe("uploaded");
    expect(importedApplication.messages[0].body).toBe("Historical review completed.");
    const conflicting = await request.post("/api/admissions/migrations", { data: { ...sample, applications: sample.applications.map((entry) => ({ ...entry, messages: ["Changed source content"] })) }, headers: { Authorization: `Bearer ${admin.token}` } });
    expect(conflicting.status()).toBe(409);
    const database = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.SVU_DATABASE_URL });
    await database.connect();
    const importedDocument = importedApplication.checklist[0].documents[0];
    try {
      await database.query("update documents set checksum = $1 where id = $2", ["0".repeat(64), importedDocument.id]);
      const mismatch = await apiRequest(request, "GET", `/api/admissions/migrations/${imported.id}`, undefined, admin.token);
      expect(mismatch.reconciled).toBe(false);
      expect(mismatch.failures).toContain("LEGACY-D1");
    } finally {
      await database.query("update documents set checksum = $1 where id = $2", [await sha256(bytes), importedDocument.id]);
      await database.end();
    }
    const migrationManifest = await apiRequest(request, "GET", `/api/admissions/review/intakes/${acceptedMigrationIntake.id}/manifest`, undefined, admin.token);
    expect(migrationManifest.accepted).toHaveLength(1);
    expect(migrationManifest.notConverted).toBe(0);
    const migrationReport = await apiRequest(request,'GET',`/api/reports/admissions?intakeId=${acceptedMigrationIntake.id}`,undefined,admin.token);
    expect(migrationReport.totals).toMatchObject({applicationsTotal:1,acceptedApplications:1,acceptedNotConverted:0,placesTaken:1});expect(migrationReport.controls.applicationsReconcile).toBe(true);
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => apiRequest(request, "POST", `/api/admissions/review/applications/${imported.mappings[2].applicationId}/convert`, {}, admin.token)));
    expect(new Set(concurrent.map((entry) => entry.studentNumber)).size).toBe(1);
    await page.reload();
    await page.locator(`[data-select="${applicant.application.id}"]`).click();
    await expect(page.locator(".section-header").filter({ hasText: "Progress" })).toContainText("Withdrawn");
    await checkLayout(page);
    await checkLayout(staff);
    await page.evaluate(() => window.scrollTo(0, 0));
    await staff.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("stage2-applicant.png"), fullPage: true });
    await staff.screenshot({ path: testInfo.outputPath("stage2-staff.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await apiRequest(request, "PUT", "/api/admissions/routes/undergraduate", { academicStages: ["Academic review"], programmeIds: ["prog_bsc_is"], reason: "Restore baseline after browser route test" }, admin.token);
    await staffContext.close();
  }
});

async function fillForm(page, name, values) {
  if (name === 'review-message') await page.locator('[data-admissions-tab=communication]').click();
  if (name === 'review-filters') {
    await page.locator('[data-admissions-tab=applications]').click();
    if (await page.locator('[data-review-back]').isVisible()) await page.locator('[data-review-back]').click();
    await page.locator('.admissions-queue-filters').evaluate(node => { node.open = true; });
  }
  const form = page.locator(`[data-form="${name}"]`);
  await expect(form).toBeVisible();
  for (const [field, value] of Object.entries(values)) {
    const input = form.locator(`[name="${field}"]`);
    if (await input.evaluate((element) => element.tagName === "SELECT")) {
      await input.selectOption({ value });
      await expect(input).toHaveValue(value);
    } else {
      await input.fill(value);
    }
  }
  await form.locator('[type="submit"]').click();
}

async function refreshReviewQueue(page) {
  await page.locator('[data-admissions-tab=applications]').click();
  const mobile = await page.locator('[data-review-back]').isVisible();
  const selected = await page.locator('[data-application-id]').getAttribute('data-application-id');
  if (mobile) await page.locator('[data-review-back]').click();
  await page.locator('[data-load-review]').click();
  await expect(page.locator('.review-controls')).not.toHaveAttribute('aria-busy', 'true');
  if (mobile) await page.locator(`[data-review-detail="${selected}"]`).click();
}

async function checkLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.locator("main")).toBeVisible();
  if (page.viewportSize().width > 860) {
    for (const panel of await page.locator(".apply-signed-in .dashboard-grid > article").all()) {
      expect((await panel.boundingBox()).width).toBeGreaterThan(300);
    }
  }
}

async function apiRequest(request, method, path, data, token) {
  const response = await request.fetch(path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}

async function createPublishedIntake(request, adminToken, label, capacity) {
  const intake = await apiRequest(request, "POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is",
    label,
    capacity,
    startsOn: "2033-09-01",
    applicationOpensAt: new Date(Date.now() - 86_400_000).toISOString(),
    applicationClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, adminToken);
  await apiRequest(request, "POST", `/api/master-data/intakes/${intake.id}/transitions`, {
    toStatus: "published", reason: "Browser edge coverage"
  }, adminToken);
  return intake;
}

async function createApplicant(request, adminToken, email, stamp) {
  const password = "Kariba-Dam-Applicant-2026!";
  await apiRequest(request, "POST", "/api/admissions/registrations", {
    email, preferredName: "Pilot", legalName: `Browser Edge ${stamp} ${email}`
  });
  const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) =>
    JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX, file), "utf8"))));
  const activation = messages.find((message) => message.recipientEmail === email);
  expect(activation).toBeTruthy();
  await apiRequest(request, "POST", "/api/identity/activations", {
    token: activation.variables.activationToken,
    preferredName: "Pilot",
    legalName: `Browser Edge ${stamp} ${email}`,
    password
  });
  const session = await apiRequest(request, "POST", "/api/identity/sessions", { email, password });
  await apiRequest(request, "PUT", "/api/admissions/profile", {
    dateOfBirth: "2004-04-12",
    phone: "+263771234567",
    nationalityCode: "ZW",
    priorLevelCode: "CERTIFICATE",
    studyModeCode: "FULL_TIME",
    address: { line1: "2 Park Lane", city: "Mutare", countryCode: "ZW" }
  }, session.token);
  return { email, password, token: session.token };
}

async function createDraftApplication(request, adminToken, intake, email, stamp) {
  const applicant = await createApplicant(request, adminToken, email, stamp);
  const application = await apiRequest(request, "POST", "/api/admissions/applications", { intakeId: intake.id }, applicant.token);
  await apiRequest(request, "PATCH", `/api/admissions/applications/${application.id}`, {
    studyModeCode: "FULL_TIME",
    answers: { personalStatement: "I want to study information systems." }
  }, applicant.token);
  return { ...applicant, application };
}

async function createSubmittedApplication(request, adminToken, intake, email, stamp) {
  const draft = await createDraftApplication(request, adminToken, intake, email, stamp);
  await apiRequest(request, "POST", `/api/admissions/applications/${draft.application.id}/fee`, {
    method: "waiver_code", reference: "SVU-WAIVER-2027"
  }, draft.token);
  for (const documentType of ["prior_transcript", "national_id"]) {
    const bytes = Buffer.from(`%PDF-1.4\n% ${documentType}\n%%EOF\n`);
    const intent = await apiRequest(request, "POST", `/api/admissions/applications/${draft.application.id}/documents`, {
      documentType,
      fileName: `${documentType}.pdf`,
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      checksum: await sha256(bytes)
    }, draft.token);
    const upload = await request.fetch(intent.upload.url, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      data: bytes
    });
    expect(upload.ok(), `PUT ${intent.upload.url}: ${await upload.text()}`).toBeTruthy();
  }
  const detail = await apiRequest(request, "GET", `/api/admissions/applications/${draft.application.id}`, undefined, draft.token);
  for (const item of detail.checklist) {
    for (const document of item.documents) {
      await apiRequest(request, "POST", `/api/documents/${document.id}/scan-results`, { result: "clean" }, adminToken);
    }
  }
  const submitted = await apiRequest(request, "POST", `/api/admissions/applications/${draft.application.id}/submit`, {}, draft.token);
  return { ...draft, application: { ...draft.application, ...submitted, workflowInstanceId: submitted.workflowInstanceId || detail.workflowInstanceId } };
}

async function moveToDecision(request, application, adminToken) {
  for (const toState of ["Payment verified", "Completeness review", "Academic review", "Decision"]) {
    await apiRequest(request, "POST", `/api/workflows/instances/${application.workflowInstanceId}/transitions`, {
      toState,
      reason: "Browser edge setup"
    }, adminToken);
  }
}

async function signInApplicant(page, email, password) {
  await page.goto("/#apply");
  await page.evaluate(() => {
    sessionStorage.removeItem("svu.applicant.session");
    sessionStorage.removeItem("svu.staff.session");
  });
  await page.reload();
  await fillForm(page, "signin", { email, password });
  await expect(page.locator("[data-signout]")).toBeVisible();
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function expireOfferInDatabase(applicationId) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.SVU_DATABASE_URL });
  await client.connect();
  try {
    await client.query("update application_decisions set offer_expires_at = now() - interval '1 day' where application_id = $1", [applicationId]);
  } finally {
    await client.end();
  }
}
