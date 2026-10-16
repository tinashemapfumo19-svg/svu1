import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const outboxDir = process.env.SVU_DEV_OUTBOX || "data/dev-outbox";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const runId = Date.now();
const results = {};

try {
  const admin = await login(adminCredentials);
  const applicant = await registerApplicant(`journey.${runId}@example.com`, "Tendai", "Tendai Mlambo");
  const intruder = await registerApplicant(`intruder.${runId}@example.com`, "Other", "Other Applicant");

  const started = (await send("POST", "/api/admissions/applications", { intakeId: "intake_2027_feb" }, applicant.token)).data;
  const appPath = `/api/admissions/applications/${started.id}`;
  results.startedStatus = started.status;
  results.duplicateApplicationRejected = await expectStatus("/api/admissions/applications",
    request("POST", { intakeId: "intake_2027_feb" }, applicant.token), 409);
  results.unknownIntakeRejected = await expectStatus("/api/admissions/applications",
    request("POST", { intakeId: "intake_does_not_exist" }, applicant.token), 409);
  results.otherApplicantSees404 = await expectStatus(appPath, request("GET", null, intruder.token), 404);

  const fresh = (await send("GET", appPath, null, applicant.token)).data;
  results.initialBlockers = fresh.readiness.blockers.length;
  results.earlySubmitRejected = await expectStatus(`${appPath}/submit`, request("POST", {}, applicant.token), 409);

  await send("PUT", "/api/admissions/profile", {
    dateOfBirth: "2005-11-02",
    nationalityCode: "ZW",
    phone: "+263772000111",
    priorLevelCode: "CERTIFICATE",
    studyModeCode: "FULL_TIME",
    address: { line1: "5 Jason Moyo St", city: "Bulawayo", countryCode: "ZW" }
  }, applicant.token);
  const edited = (await send("PATCH", appPath, { studyModeCode: "PART_TIME", answers: { personalStatement: "I want to build systems for local clinics." } }, applicant.token)).data;
  results.answersSaved = edited.answers.personalStatement?.startsWith("I want");
  results.badStudyModeRejected = await expectStatus(appPath, request("PATCH", { studyModeCode: "SOMETIMES" }, applicant.token), 400);

  results.unexpectedDocumentTypeRejected = await expectStatus(`${appPath}/documents`,
    request("POST", documentBody("payslip", pdf("x")), applicant.token), 400);
  results.intruderUploadRejected = await expectStatus(`${appPath}/documents`,
    request("POST", documentBody("national_id", pdf("x")), intruder.token), 404);

  for (const documentType of ["prior_transcript", "national_id"]) {
    const bytes = pdf(`${documentType} ${runId}`);
    const intent = (await send("POST", `${appPath}/documents`, documentBody(documentType, bytes), applicant.token)).data;
    await send("PUT", intent.upload.url, null, null, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
    const pending = (await send("GET", appPath, null, applicant.token)).data;
    results[`${documentType}BeforeScan`] = pending.checklist.find((item) => item.documentType === documentType).status;
    await send("POST", `/api/documents/${intent.document.id}/scan-results`, { result: "clean" }, admin.token);
  }

  const ready = (await send("GET", appPath, null, applicant.token)).data;
  results.readyBeforeFee = ready.readiness.ready;
  results.feeBlocker = ready.readiness.blockers.includes("verify your application fee or waiver code");
  results.submitBeforeFeeRejected = await expectStatus(`${appPath}/submit`, request("POST", {}, applicant.token), 409);
  results.badWaiverRejected = await expectStatus(`${appPath}/fee`, request("POST", { method: "waiver_code", reference: "NOT-VALID" }, applicant.token), 400);
  const feeReady = (await send("POST", `${appPath}/fee`, { method: "waiver_code", reference: "SVU-WAIVER-2027" }, applicant.token)).data;
  results.feeStatus = feeReady.fee.status;
  results.readyToSubmit = feeReady.readiness.ready;
  const submitted = (await send("POST", `${appPath}/submit`, {}, applicant.token)).data;
  results.referenceNumber = submitted.referenceNumber;
  results.workflowState = submitted.workflowState;
  results.doubleSubmitRejected = await expectStatus(`${appPath}/submit`, request("POST", {}, applicant.token), 409);
  results.editAfterSubmitRejected = await expectStatus(appPath, request("PATCH", { answers: { late: true } }, applicant.token), 409);
  results.uploadAfterSubmitRejected = await expectStatus(`${appPath}/documents`,
    request("POST", documentBody("national_id", pdf("late")), applicant.token), 409);

  const me = (await send("GET", "/api/identity/me", null, applicant.token)).data;
  const notices = (await send("GET", `/api/notifications?recipientAccountId=${me.account.id}`, null, admin.token)).data;
  results.receiptQueued = notices.some((notice) => JSON.stringify(notice).includes(submitted.referenceNumber));

  const staffView = (await send("GET", `/api/workflows/instances/${submitted.workflowInstanceId}`, null, admin.token)).data;
  results.staffSeesHistory = staffView.history.map((entry) => entry.toState).filter(Boolean);
  results.staffNextSteps = staffView.allowedTransitions.sort();
  const reviewView = (await send("GET", `/api/admissions/review/applications/${started.id}`, null, admin.token)).data;
  results.staffSeesFee = reviewView.fee.status;

  const withdrawn = (await send("POST", `${appPath}/withdraw`, { reason: "Accepted a place elsewhere" }, applicant.token)).data;
  results.withdrawnStatus = withdrawn.status;
  const afterWithdraw = (await send("GET", `/api/workflows/instances/${submitted.workflowInstanceId}`, null, admin.token)).data;
  results.workflowAfterWithdraw = afterWithdraw.state;
  const again = (await send("POST", "/api/admissions/applications", { intakeId: "intake_2027_feb" }, applicant.token)).data;
  results.reapplyAfterWithdrawal = again.status;

  const failures = [
    results.startedStatus !== "draft" && "applications start as drafts",
    results.initialBlockers < 3 && "a fresh application should list several blockers",
    results.prior_transcriptBeforeScan !== "uploaded" && "uploaded documents await scanning",
    results.readyBeforeFee && "application should still wait for the fee",
    !results.feeBlocker && "fee blocker should be visible",
    results.feeStatus !== "waived" && "valid waiver should waive the fee",
    !results.readyToSubmit && "application should be ready after profile, fee, and clean documents",
    !/^SVU-2027-\d{6}$/.test(results.referenceNumber || "") && "reference number format",
    results.workflowState !== "Submitted" && "workflow should be at Submitted",
    !results.receiptQueued && "receipt notification missing",
    results.staffSeesHistory.join(",") !== "Draft,Submitted" && "workflow history should show Draft then Submitted",
    results.staffSeesFee !== "waived" && "staff review should show fee status",
    results.workflowAfterWithdraw !== "Withdrawn" && "withdrawal should move the workflow",
    results.reapplyAfterWithdrawal !== "draft" && "a withdrawn application should not block a new one"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function pdf(label) {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);
}

function documentBody(documentType, bytes) {
  return {
    documentType,
    fileName: `${documentType}.pdf`,
    contentType: "application/pdf",
    sizeBytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex")
  };
}

async function registerApplicant(email, preferredName, legalName) {
  await send("POST", "/api/admissions/registrations", { email, preferredName, legalName });
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const message = messages
    .filter((entry) => entry.recipientEmail === email && entry.templateCode === "admissions.registration_activation")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    .at(-1);
  const password = "Great-Zimbabwe-Journey-2026!";
  await send("POST", "/api/identity/activations", { token: message.variables.activationToken, password, preferredName, legalName });
  return login({ email, password });
}

async function login(credentials) {
  const response = await send("POST", "/api/identity/sessions", credentials);
  return response.data;
}

async function send(method, path, body, token, options) {
  const response = await fetch(`${baseUrl}${path}`, options || request(method, body, token));
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function request(method, body, token) {
  const options = {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json"
    }
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  return options;
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Expected ${expectedStatus} for ${options.method} ${path}, received ${response.status}: ${body}`);
  }
  return response.status;
}
