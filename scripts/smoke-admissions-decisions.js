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

  // A two-seat intake so capacity limits are easy to hit.
  const intake = (await send("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is",
    label: `Decision smoke ${runId}`,
    capacity: 2,
    startsOn: "2031-02-01",
    applicationOpensAt: new Date(Date.now() - 86_400_000).toISOString(),
    applicationClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, admin.token)).data;
  await send("POST", `/api/master-data/intakes/${intake.id}/transitions`, { toStatus: "published", reason: "Smoke intake" }, admin.token);

  const scope = { programmeCodes: ["BSC-IS"], intakeIds: [intake.id] };
  const officer = await staff("admissions_officer", scope);
  const manager = await staff("admissions_manager", scope);

  const applicants = {};
  for (const name of ["a", "b", "c", "d"]) {
    applicants[name] = await submittedApplicant(`decide.${name}.${runId}@example.com`, intake.id, admin);
    for (const toState of ["Payment verified", "Completeness review", "Academic review", "Decision"]) {
      await send("POST", `/api/workflows/instances/${applicants[name].workflowInstanceId}/transitions`, { toState, reason: "Smoke progression" }, officer.token);
    }
  }
  const decide = (who, body, token = manager.token) =>
    fetch(`${baseUrl}/api/admissions/review/applications/${applicants[who].applicationId}/decision`, request("POST", body, token));

  results.officerCannotDecide = (await decide("a", { decision: "offer" }, officer.token)).status;
  results.offerA = (await decide("a", { decision: "offer", conditions: ["Submit certified A-level results by 15 January"], note: "Strong candidate" })).status;
  results.offerC = (await decide("c", { decision: "offer" })).status;
  const full = await decide("b", { decision: "offer" });
  results.offerBWhenFull = full.status;
  results.fullMessage = (await full.json()).error?.message;
  results.rejectWithBadReason = (await decide("b", { decision: "reject", reasonCode: "VIBES" })).status;
  results.rejectB = (await decide("b", { decision: "reject", reasonCode: "ENTRY_REQUIREMENTS_NOT_MET" })).status;
  results.decideTwiceRejected = (await decide("b", { decision: "offer" })).status;

  const viewA = (await send("GET", `/api/admissions/applications/${applicants.a.applicationId}`, null, applicants.a.token)).data;
  results.applicantSeesConditions = viewA.decision?.conditions?.[0]?.startsWith("Submit certified");
  const viewB = (await send("GET", `/api/admissions/applications/${applicants.b.applicationId}`, null, applicants.b.token)).data;
  results.applicantSeesReason = viewB.decision?.reason;

  await send("POST", `/api/admissions/applications/${applicants.a.applicationId}/offer-response`, { response: "decline", reason: "Chose another university" }, applicants.a.token);
  results.offerDAfterDecline = (await decide("d", { decision: "offer" })).status;

  const accepted = (await send("POST", `/api/admissions/applications/${applicants.c.applicationId}/offer-response`, { response: "accept" }, applicants.c.token)).data;
  results.acceptedState = accepted.workflowState;
  results.acceptTwiceRejected = await expectStatus(`/api/admissions/applications/${applicants.c.applicationId}/offer-response`,
    request("POST", { response: "accept" }, applicants.c.token), 409);
  results.otherApplicantCannotRespond = await expectStatus(`/api/admissions/applications/${applicants.c.applicationId}/offer-response`,
    request("POST", { response: "decline" }, applicants.d.token), 404);

  // Simulate the deadline passing for D, then run the expiry sweep.
  await db.query(
    "update application_decisions set offer_expires_at = now() - interval '1 minute' where application_id = $1 and response is null",
    [applicants.d.applicationId]
  );
  const sweep = (await send("POST", "/api/admissions/review/offers/expire", {}, manager.token)).data;
  results.sweepExpiredAtLeastOne = sweep.expired >= 1;
  const viewD = (await send("GET", `/api/admissions/applications/${applicants.d.applicationId}`, null, applicants.d.token)).data;
  results.expiredState = viewD.workflowState;
  results.acceptExpiredRejected = await expectStatus(`/api/admissions/applications/${applicants.d.applicationId}/offer-response`,
    request("POST", { response: "accept" }, applicants.d.token), 409);

  const bNotices = (await send("GET", `/api/notifications?recipientAccountId=${applicants.b.accountId}`, null, admin.token)).data;
  results.rejectionLetterHasReason = bNotices.some((notice) => JSON.stringify(notice).includes("Entry requirements not met"));
  const aNotices = (await send("GET", `/api/notifications?recipientAccountId=${applicants.a.accountId}`, null, admin.token)).data;
  results.offerLetterHasConditions = aNotices.some((notice) => JSON.stringify(notice).includes("certified A-level"));

  // Two managers offering the last seat at the same moment: exactly one may win.
  const lastSeat = (await send("POST", "/api/master-data/intakes", {
    programmeId: "prog_bsc_is",
    label: `Last seat ${runId}`,
    capacity: 1,
    startsOn: "2032-02-01",
    applicationOpensAt: new Date(Date.now() - 86_400_000).toISOString(),
    applicationClosesAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, admin.token)).data;
  await send("POST", `/api/master-data/intakes/${lastSeat.id}/transitions`, { toStatus: "published", reason: "Race smoke" }, admin.token);
  const racers = [];
  for (const name of ["race1", "race2"]) {
    const racer = await submittedApplicant(`decide.${name}.${runId}@example.com`, lastSeat.id, admin);
    for (const toState of ["Payment verified", "Completeness review", "Academic review", "Decision"]) {
      await send("POST", `/api/workflows/instances/${racer.workflowInstanceId}/transitions`, { toState, reason: "Race progression" }, admin.token);
    }
    racers.push(racer);
  }
  const raced = await Promise.all(racers.map((racer) =>
    fetch(`${baseUrl}/api/admissions/review/applications/${racer.applicationId}/decision`, request("POST", { decision: "offer" }, admin.token))));
  results.concurrentOfferStatuses = raced.map((response) => response.status).sort();

  const failures = [
    results.concurrentOfferStatuses.join(",") !== "200,409" && "the last seat must go to exactly one concurrent offer",
    results.officerCannotDecide !== 403 && "officers must not record decisions",
    (results.offerA !== 200 || results.offerC !== 200) && "first two offers should succeed",
    results.offerBWhenFull !== 409 && "third offer should hit capacity",
    results.rejectWithBadReason !== 400 && "unknown reason should be refused",
    results.rejectB !== 200 && "rejection should succeed",
    results.decideTwiceRejected !== 409 && "a decided application is no longer at Decision",
    results.applicantSeesReason !== "Entry requirements not met" && "applicant should see the controlled reason",
    results.offerDAfterDecline !== 200 && "a declined offer should free its seat",
    results.acceptedState !== "Accepted" && "acceptance should move the workflow",
    results.expiredState !== "Expired" && "the sweep should expire overdue offers",
    !results.rejectionLetterHasReason && "rejection letter missing reason",
    !results.offerLetterHasConditions && "offer letter missing conditions"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));

  async function staff(roleCode, roleScope) {
    const email = `${roleCode}.decisions.${runId}@southvalley.test`;
    const invitation = (await send("POST", "/api/identity/invitations", { email, roleCode, scope: roleScope }, admin.token)).data;
    const password = "Nyanga-Decision-Panel-2026!";
    await send("POST", "/api/identity/activations", { token: invitation.activationToken, password, preferredName: "Panel", legalName: "Decision Panel" });
    return login({ email, password });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}

async function submittedApplicant(email, intakeId, admin) {
  const legalName = `Applicant ${email}`;
  await send("POST", "/api/admissions/registrations", { email, preferredName: "Applicant", legalName });
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const message = messages.filter((entry) => entry.recipientEmail === email).sort((x, y) => x.queuedAt.localeCompare(y.queuedAt)).at(-1);
  const password = "Kariba-Dam-Applicant-2026!";
  await send("POST", "/api/identity/activations", { token: message.variables.activationToken, password, preferredName: "Applicant", legalName });
  const session = await login({ email, password });
  await send("PUT", "/api/admissions/profile", {
    dateOfBirth: "2003-08-09", nationalityCode: "ZW", phone: `+26377${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    priorLevelCode: "CERTIFICATE", studyModeCode: "FULL_TIME", address: { line1: "2 Park Lane", city: "Mutare", countryCode: "ZW" }
  }, session.token);
  const application = (await send("POST", "/api/admissions/applications", { intakeId }, session.token)).data;
  for (const documentType of ["prior_transcript", "national_id"]) {
    const bytes = Buffer.from(`%PDF-1.4\n% ${documentType} ${email}\n%%EOF\n`);
    const intent = (await send("POST", `/api/admissions/applications/${application.id}/documents`, {
      documentType, fileName: `${documentType}.pdf`, contentType: "application/pdf", sizeBytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex")
    }, session.token)).data;
    await send("PUT", intent.upload.url, null, null, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
    await send("POST", `/api/documents/${intent.document.id}/scan-results`, { result: "clean" }, admin.token);
  }
  await send("POST", `/api/admissions/applications/${application.id}/fee`, { method: "waiver_code", reference: "SVU-WAIVER-2027" }, session.token);
  const submitted = (await send("POST", `/api/admissions/applications/${application.id}/submit`, {}, session.token)).data;
  return { ...session, accountId: session.account.id, applicationId: application.id, workflowInstanceId: submitted.workflowInstanceId };
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
