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
  const officer = await staff("admissions_officer", { programmeCodes: ["BSC-IS"], intakeIds: ["intake_2027_feb"] });
  const outsider = await staff("admissions_officer", { programmeCodes: ["OTHER-PROG"], intakeIds: ["other_intake"] });

  // Two applicants with the same legal name and date of birth: a likely duplicate.
  const first = await submittedApplicant(`review.a.${runId}@example.com`, "+263771000001", admin);
  const second = await submittedApplicant(`review.b.${runId}@example.com`, "+263771000002", admin);

  const queue = (await send("GET", "/api/admissions/review/applications?intakeId=intake_2027_feb&limit=200", null, officer.token)).data;
  const firstRow = queue.find((row) => row.id === first.applicationId);
  results.queueShowsBoth = Boolean(firstRow) && queue.some((row) => row.id === second.applicationId);
  results.duplicateFlagged = firstRow?.possibleDuplicates >= 1;
  results.outsiderQueueExcludes = !(await send("GET", "/api/admissions/review/applications?limit=200", null, outsider.token)).data
    .some((row) => row.id === first.applicationId);
  results.outsiderDetailDenied = await expectStatus(`/api/admissions/review/applications/${first.applicationId}`, request("GET", null, outsider.token), 403);
  results.applicantCannotReview = await expectStatus("/api/admissions/review/applications", request("GET", null, first.token), 403);

  const reviewPath = `/api/admissions/review/applications/${first.applicationId}`;
  results.assignOutOfScopeRejected = await expectStatus(`${reviewPath}/assign`,
    request("POST", { assigneeAccountId: outsider.accountId }, officer.token), 409);
  await send("POST", `${reviewPath}/assign`, {}, officer.token);
  const mine = (await send("GET", "/api/admissions/review/applications?assigned=me", null, officer.token)).data;
  results.assignedToMe = mine.map((row) => row.id).includes(first.applicationId);

  await send("POST", `${reviewPath}/notes`, { category: "academic", body: "Strong maths; confirm A-level certificate." }, officer.token);
  results.badNoteCategoryRejected = await expectStatus(`${reviewPath}/notes`, request("POST", { category: "gossip", body: "x" }, officer.token), 400);

  const transitions = `/api/workflows/instances/${first.workflowInstanceId}/transitions`;
  results.requestInfoTooEarly = await expectStatus(`${reviewPath}/request-information`,
    request("POST", { message: "Need certificate" }, officer.token), 409);
  await send("POST", transitions, { toState: "Payment verified", reason: "Fee confirmed" }, officer.token);
  await send("POST", transitions, { toState: "Completeness review", reason: "Checking documents" }, officer.token);
  await send("POST", `${reviewPath}/request-information`, { message: "Please upload your A-level certificate." }, officer.token);

  const notices = (await send("GET", `/api/notifications?recipientAccountId=${first.accountId}`, null, admin.token)).data;
  results.applicantNotified = notices.some((notice) => JSON.stringify(notice).includes("A-level certificate"));

  const appPath = `/api/admissions/applications/${first.applicationId}`;
  const extra = pdf("a-level certificate");
  const intent = (await send("POST", `${appPath}/documents`, documentBody("other", extra), first.token)).data;
  await send("PUT", intent.upload.url, null, null, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: extra });
  results.applicantUploadedWhileInfoRequested = true;
  await send("POST", `${appPath}/respond`, { message: "Certificate uploaded." }, first.token);
  results.respondAgainRejected = await expectStatus(`${appPath}/respond`, request("POST", { message: "again" }, first.token), 409);

  const detail = (await send("GET", reviewPath, null, officer.token)).data;
  results.stateAfterResponse = detail.workflowState;
  results.officerNextSteps = detail.allowedTransitions.sort();
  results.notes = detail.notes.map((note) => note.category);
  results.detailDuplicates = detail.possibleDuplicates.map((candidate) => candidate.reasons).flat();
  results.detailHasProfile = detail.applicant.profile?.nationalityCode === "ZW";

  const failures = [
    !results.queueShowsBoth && "scoped officer should see both applications",
    !results.duplicateFlagged && "same name and date of birth should be flagged",
    !results.outsiderQueueExcludes && "out-of-scope officer must not see the application",
    !results.assignedToMe && "assignment filter failed",
    !results.applicantNotified && "applicant was not told what is needed",
    results.stateAfterResponse !== "Completeness review" && "applicant response should return the application to completeness review",
    results.officerNextSteps.join(",") !== "Academic review,Information requested,Withdrawn" && "unexpected officer next steps",
    !results.detailDuplicates.includes("same legal name and date of birth") && "duplicate reason missing from detail"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));

  async function staff(roleCode, scope) {
    const email = `${roleCode}.${scope.programmeCodes[0].toLowerCase()}.${runId}@southvalley.test`;
    const invitation = (await send("POST", "/api/identity/invitations", { email, roleCode, scope }, admin.token)).data;
    const password = "Chimanimani-Review-Desk-2026!";
    await send("POST", "/api/identity/activations", { token: invitation.activationToken, password, preferredName: "Reviewer", legalName: "Smoke Reviewer" });
    const session = await login({ email, password });
    return { ...session, accountId: session.account.id };
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function submittedApplicant(email, phone, admin) {
  await send("POST", "/api/admissions/registrations", { email, preferredName: "Rufaro", legalName: `Rufaro Sibanda ${runId}` });
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const message = messages.filter((entry) => entry.recipientEmail === email).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)).at(-1);
  const password = "Matobo-Hills-Applicant-2026!";
  await send("POST", "/api/identity/activations", {
    token: message.variables.activationToken, password, preferredName: "Rufaro", legalName: `Rufaro Sibanda ${runId}`
  });
  const session = await login({ email, password });
  await send("PUT", "/api/admissions/profile", {
    dateOfBirth: "2004-03-21", nationalityCode: "ZW", phone, priorLevelCode: "CERTIFICATE", studyModeCode: "FULL_TIME",
    address: { line1: "1 Main St", city: "Gweru", countryCode: "ZW" }
  }, session.token);
  const application = (await send("POST", "/api/admissions/applications", { intakeId: "intake_2027_feb" }, session.token)).data;
  for (const documentType of ["prior_transcript", "national_id"]) {
    const bytes = pdf(`${documentType} ${email}`);
    const intent = (await send("POST", `/api/admissions/applications/${application.id}/documents`, documentBody(documentType, bytes), session.token)).data;
    await send("PUT", intent.upload.url, null, null, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
    await send("POST", `/api/documents/${intent.document.id}/scan-results`, { result: "clean" }, admin.token);
  }
  await send("POST", `/api/admissions/applications/${application.id}/fee`, { method: "waiver_code", reference: "SVU-WAIVER-2027" }, session.token);
  const submitted = (await send("POST", `/api/admissions/applications/${application.id}/submit`, {}, session.token)).data;
  return { ...session, accountId: session.account.id, applicationId: application.id, workflowInstanceId: submitted.workflowInstanceId };
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
