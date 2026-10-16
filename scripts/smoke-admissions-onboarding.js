import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const outboxDir = process.env.SVU_DEV_OUTBOX || "data/dev-outbox";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const runId = Date.now();
const applicantEmail = `applicant.${runId}@example.com`;
const applicantPassword = "Victoria-Falls-Applicant-2026!";
const results = {};

try {
  const admin = await login(adminCredentials);

  const catalogue = (await send("GET", "/api/admissions/catalogue")).data;
  results.catalogueHasPilotIntake = catalogue.some((entry) => entry.intakeId === "intake_2027_feb" && entry.applicationsOpen);

  const bare = (await send("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is", label: `Smoke bare ${runId}`, capacity: 10, status: "published"
  }, admin.token)).data;
  results.clientCannotCreatePublishedIntake = bare.status === "draft";
  results.incompleteIntakePublishRejected = await expectStatus(`/api/master-data/intakes/${bare.id}/transitions`,
    request("POST", { toStatus: "published", reason: "Missing window" }, admin.token), 409);

  const now = Date.now();
  const intake = (await send("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is",
    label: `Smoke intake ${runId}`,
    capacity: 25,
    startsOn: "2030-02-01",
    applicationOpensAt: new Date(now - 86_400_000).toISOString(),
    applicationClosesAt: new Date(now + 30 * 86_400_000).toISOString()
  }, admin.token)).data;
  await send("POST", `/api/master-data/intakes/${intake.id}/transitions`, { toStatus: "published", reason: "Admissions approved" }, admin.token);
  results.publishedIntakeListed = (await send("GET", "/api/admissions/catalogue")).data.some((entry) => entry.intakeId === intake.id);
  await send("POST", `/api/master-data/intakes/${intake.id}/transitions`, { toStatus: "closed", reason: "Smoke cleanup" }, admin.token);
  results.closedIntakeHidden = !(await send("GET", "/api/admissions/catalogue")).data.some((entry) => entry.intakeId === intake.id);

  const first = (await send("POST", "/api/admissions/registrations", {
    email: applicantEmail, preferredName: "Chipo", legalName: "Chipo Ndlovu"
  })).data;
  const message = await latestOutbox((entry) => entry.recipientEmail === applicantEmail && entry.templateCode === "admissions.registration_activation");
  results.activationDelivered = Boolean(message.variables.activationToken);

  results.weakPasswordRejected = await expectStatus("/api/identity/activations", request("POST", {
    token: message.variables.activationToken, password: "short", preferredName: "Chipo", legalName: "Chipo Ndlovu"
  }), 400);
  await send("POST", "/api/identity/activations", {
    token: message.variables.activationToken, password: applicantPassword, preferredName: "Chipo", legalName: "Chipo Ndlovu"
  });
  const applicant = await login({ email: applicantEmail, password: applicantPassword });
  const me = (await send("GET", "/api/identity/me", null, applicant.token)).data;
  results.applicantRole = me.roles.map((role) => role.code);
  results.applicantPersona = me.person.personas;

  const second = (await send("POST", "/api/admissions/registrations", {
    email: applicantEmail.toUpperCase(), preferredName: "Chipo", legalName: "Chipo Ndlovu"
  })).data;
  results.duplicateRegistrationLooksIdentical = first.message === second.message;
  const notices = (await send("GET", `/api/notifications?recipientAccountId=${me.account.id}`, null, admin.token)).data;
  results.existingAccountNoticeQueued = notices.some((notice) => notice.subject?.includes("already have") || notice.payload?.subject?.includes("already have"));

  const empty = (await send("GET", "/api/admissions/profile", null, applicant.token)).data;
  results.emptyProfileMissing = empty.missing;
  results.unknownCountryRejected = await expectStatus("/api/admissions/profile", request("PUT", { nationalityCode: "XX" }, applicant.token), 400);
  results.badPhoneRejected = await expectStatus("/api/admissions/profile", request("PUT", { phone: "0771234567" }, applicant.token), 400);
  results.tooYoungRejected = await expectStatus("/api/admissions/profile", request("PUT", { dateOfBirth: "2020-01-01" }, applicant.token), 400);
  await send("PUT", "/api/admissions/profile", { dateOfBirth: "2006-05-14", nationalityCode: "ZW", phone: "+263771234567" }, applicant.token);
  const complete = (await send("PUT", "/api/admissions/profile", {
    priorLevelCode: "CERTIFICATE",
    studyModeCode: "FULL_TIME",
    address: { line1: "12 Samora Machel Ave", city: "Harare", countryCode: "ZW" }
  }, applicant.token)).data;
  results.profileComplete = complete.complete;
  results.partialUpdatesKeptEarlierFields = complete.profile.nationalityCode === "ZW";

  results.applicantAuditDenied = await expectStatus("/api/audit/events", request("GET", null, applicant.token), 403);
  results.applicantStaffUploadDenied = await expectStatus("/api/documents/upload-requests", request("POST", {}, applicant.token), 403);
  results.staffCannotUseApplicantProfile = await expectStatus("/api/admissions/profile", request("GET", null, admin.token), 403);

  const failures = [
    !results.catalogueHasPilotIntake && "seeded pilot intake missing from catalogue",
    !results.clientCannotCreatePublishedIntake && "intake creation must ignore client-supplied status",
    !results.publishedIntakeListed && "published intake not listed",
    !results.closedIntakeHidden && "closed intake still listed",
    results.applicantRole.join(",") !== "applicant" && "activation should grant the applicant role",
    results.applicantPersona.join(",") !== "applicant" && "applicant persona expected",
    !results.duplicateRegistrationLooksIdentical && "duplicate registration response differs",
    !results.existingAccountNoticeQueued && "existing-account notice not queued",
    !results.profileComplete && "profile should be complete"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function latestOutbox(predicate) {
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const matching = messages.filter(predicate).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  if (matching.length === 0) {
    throw new Error(`No matching message in ${outboxDir}.`);
  }
  return matching.at(-1);
}

async function login(credentials) {
  const response = await send("POST", "/api/identity/sessions", credentials);
  return response.data;
}

async function send(method, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, request(method, body, token));
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
