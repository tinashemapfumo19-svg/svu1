import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { loadConfig } from "../server/config.js";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const outboxDir = process.env.SVU_DEV_OUTBOX || "data/dev-outbox";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const runId = Date.now();
const results = {};
const db = new pg.Client({ connectionString: loadConfig().databaseUrl });

try {
  await db.connect();
  const admin = await login(adminCredentials);
  const applicant = await registerApplicant(`convert.${runId}@example.com`);

  const first = await submitTo(applicant, "intake_2027_feb", admin);
  results.convertBeforeAcceptRejected = await expectStatus(
    `/api/admissions/review/applications/${first.applicationId}/convert`, request("POST", {}, admin.token), 409);
  await toDecisionAndOffer(first, admin);
  const accepted = (await send("POST", `/api/admissions/applications/${first.applicationId}/offer-response`, { response: "accept" }, applicant.token)).data;
  results.studentNumber = accepted.studentNumber;

  const retry = (await send("POST", `/api/admissions/review/applications/${first.applicationId}/convert`, {}, admin.token)).data;
  results.retryReturnsSameRecord = retry.created === false && retry.studentNumber === accepted.studentNumber;
  const concurrent = await Promise.all(Array.from({ length: 5 }, () =>
    send("POST", `/api/admissions/review/applications/${first.applicationId}/convert`, {}, admin.token)));
  results.concurrentRetriesAgree = concurrent.every((response) => response.data.studentNumber === accepted.studentNumber && response.data.created === false);
  results.programmeRecordsForApplication = (await db.query(
    "select count(*)::int as count from student_programmes where application_id = $1", [first.applicationId])).rows[0].count;

  const me = (await send("GET", "/api/identity/me", null, applicant.token)).data;
  results.roles = me.roles.map((role) => role.code).sort();
  results.personas = me.person.personas.sort();
  const notices = (await send("GET", `/api/notifications?recipientAccountId=${me.account.id}`, null, admin.token)).data;
  results.welcomeQueued = notices.some((notice) => JSON.stringify(notice).includes(accepted.studentNumber));
  const tasks = (await send("GET", "/api/tasks", null, admin.token)).data;
  results.onboardingTask = tasks.some((task) => task.queue === "registry.onboarding" && task.title.includes(accepted.studentNumber));

  // The same person comes back for another intake: same student number, new programme record.
  const laterIntake = (await send("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is",
    label: `Conversion return ${runId}`,
    capacity: 5,
    startsOn: "2033-02-01",
    applicationOpensAt: new Date(Date.now() - 86_400_000).toISOString(),
    applicationClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, admin.token)).data;
  await send("POST", `/api/master-data/intakes/${laterIntake.id}/transitions`, { toStatus: "published", reason: "Return smoke" }, admin.token);
  const second = await submitTo(applicant, laterIntake.id, admin);
  await toDecisionAndOffer(second, admin);
  const returning = (await send("POST", `/api/admissions/applications/${second.applicationId}/offer-response`, { response: "accept" }, applicant.token)).data;
  results.returningKeepsNumber = returning.studentNumber === accepted.studentNumber;
  results.programmeRecordsForPerson = (await db.query(
    `select count(*)::int as count from student_programmes sp join students s on s.id = sp.student_id where s.student_number = $1`,
    [accepted.studentNumber])).rows[0].count;

  const manifest = (await send("GET", "/api/admissions/review/intakes/intake_2027_feb/manifest", null, admin.token)).data;
  results.manifestListsStudent = manifest.accepted.some((row) => row.studentNumber === accepted.studentNumber && row.referenceNumber === first.referenceNumber);
  results.manifestNotConverted = manifest.notConverted;
  results.manifestHasCounts = typeof manifest.placesRemaining === "number" && manifest.counts.Accepted >= 1;
  results.applicantManifestDenied = await expectStatus("/api/admissions/review/intakes/intake_2027_feb/manifest", request("GET", null, applicant.token), 403);

  const failures = [
    !/^S27\d{6}$/.test(results.studentNumber || "") && "student number should be S + entry year + six digits",
    !results.retryReturnsSameRecord && "retrying conversion must return the same record",
    !results.concurrentRetriesAgree && "concurrent conversions must agree",
    results.programmeRecordsForApplication !== 1 && "exactly one programme record per application",
    !results.roles.includes("student") && "student role not granted",
    !results.personas.includes("student") && "student persona not added",
    !results.welcomeQueued && "welcome notice missing",
    !results.onboardingTask && "registry onboarding task missing",
    !results.returningKeepsNumber && "a returning student keeps their number",
    results.programmeRecordsForPerson !== 2 && "returning student should have two programme records",
    !results.manifestListsStudent && "manifest should list the converted student",
    results.manifestNotConverted !== 0 && "every accepted applicant should be converted"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

async function toDecisionAndOffer(application, admin) {
  for (const toState of ["Payment verified", "Completeness review", "Academic review", "Decision"]) {
    await send("POST", `/api/workflows/instances/${application.workflowInstanceId}/transitions`, { toState, reason: "Conversion smoke" }, admin.token);
  }
  await send("POST", `/api/admissions/review/applications/${application.applicationId}/decision`, { decision: "offer" }, admin.token);
}

async function registerApplicant(email) {
  const legalName = `Nyasha Conversion ${runId}`;
  await send("POST", "/api/admissions/registrations", { email, preferredName: "Nyasha", legalName });
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const message = messages.filter((entry) => entry.recipientEmail === email).sort((x, y) => x.queuedAt.localeCompare(y.queuedAt)).at(-1);
  const password = "Hwange-Park-Student-2026!";
  await send("POST", "/api/identity/activations", { token: message.variables.activationToken, password, preferredName: "Nyasha", legalName });
  const session = await login({ email, password });
  await send("PUT", "/api/admissions/profile", {
    dateOfBirth: "2002-12-01", nationalityCode: "ZW", phone: `+26371${String(runId).slice(-7)}`,
    priorLevelCode: "CERTIFICATE", studyModeCode: "FULL_TIME", address: { line1: "9 Fife St", city: "Bulawayo", countryCode: "ZW" }
  }, session.token);
  return session;
}

async function submitTo(session, intakeId, admin) {
  const application = (await send("POST", "/api/admissions/applications", { intakeId }, session.token)).data;
  for (const documentType of ["prior_transcript", "national_id"]) {
    const bytes = Buffer.from(`%PDF-1.4\n% ${documentType} ${application.id}\n%%EOF\n`);
    const intent = (await send("POST", `/api/admissions/applications/${application.id}/documents`, {
      documentType, fileName: `${documentType}.pdf`, contentType: "application/pdf", sizeBytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex")
    }, session.token)).data;
    await send("PUT", intent.upload.url, null, null, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
    await send("POST", `/api/documents/${intent.document.id}/scan-results`, { result: "clean" }, admin.token);
  }
  await send("POST", `/api/admissions/applications/${application.id}/fee`, { method: "waiver_code", reference: "SVU-WAIVER-2027" }, session.token);
  const submitted = (await send("POST", `/api/admissions/applications/${application.id}/submit`, {}, session.token)).data;
  return { applicationId: application.id, workflowInstanceId: submitted.workflowInstanceId, referenceNumber: submitted.referenceNumber };
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
