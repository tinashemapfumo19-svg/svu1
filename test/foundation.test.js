import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { loadConfig } from "../server/config.js";
import {
  base32Encode,
  createSecret,
  decryptSecret,
  digestToken,
  encryptSecret,
  hashSecret,
  matchTotp,
  passwordProblems,
  totp,
  verifySecret
} from "../server/security.js";
import { mfaRequirement } from "../server/modules/identity-mfa.js";
import { assertCourseInput, curriculumProblems, findPrerequisiteCycle } from "../server/modules/curriculum.js";
import { assertGradingScheme, calculateGpa, roundGpa, runValidationSamples } from "../server/modules/grading.js";
import { signDocumentUrl, verifyDocumentUrl } from "../server/modules/documents.js";
import { assertProfileInput, profileCompleteness, readinessFor } from "../server/modules/admissions.js";
import { duplicateReasons } from "../server/modules/admissions-review.js";
import { formatStudentNumber } from "../server/modules/student-conversion.js";
import { matchesFileSignature } from "../server/storage.js";
import { isPublicPath } from "../server/router.js";
import { createSeedData } from "../scripts/seed-data.js";
import { assertUploadIsAllowed, isEffectiveOn, parseEffectiveDate } from "../server/repository.js";
import { canTransitionPeriod, openWindowsOn, validateWindows } from "../server/modules/academic-calendar.js";
import { assertActorCanAccessScope } from "../server/support.js";
import { assertReferenceValueIsValid, isValueActiveOn } from "../server/modules/reference-data.js";
import { allowedTransitionsFrom, assertTransitionAllowed } from "../server/modules/workflow.js";
import { workflowDefinitions } from "../scripts/workflow-definitions.js";

test("loadConfig applies safe defaults", () => {
  const config = loadConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4173);
  assert.equal(config.dataFile, "data/dev-store.json");
});

test("seed data contains the Phase 1 foundation lanes", () => {
  const seed = createSeedData();
  const laneNames = seed.foundationLanes.map((lane) => lane.name);

  assert.deepEqual(laneNames, [
    "Identity",
    "Roles",
    "Audit",
    "Workflow",
    "Documents",
    "Notifications",
    "Master Data",
    "Operations"
  ]);
});

test("seed data proves the first admissions runway", () => {
  const seed = createSeedData();

  assert.equal(seed.masterData.programmes[0].code, "BSC-IS");
  assert.equal(seed.workflowInstances[0].state, "Submitted");
  assert.equal(seed.tasks[0].workflowInstanceId, seed.workflowInstances[0].id);
  assert.equal(seed.documents[0].ownerId, seed.workflowInstances[0].subjectId);
});

test("postgres migration defines required Phase 1 tables", async () => {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const migrationFiles = (await readdir(migrationsUrl)).filter((file) => file.endsWith(".sql"));
  const sqlParts = await Promise.all(
    migrationFiles.map((file) => readFile(new URL(file, migrationsUrl), "utf8"))
  );
  const sql = sqlParts.join("\n");
  const requiredTables = [
    "people",
    "accounts",
    "roles",
    "permissions",
    "role_permissions",
    "role_assignments",
    "audit_events",
    "workflow_definitions",
    "workflow_instances",
    "resource_scopes",
    "tasks",
    "documents",
    "notification_templates",
    "programmes",
    "intakes",
    "academic_periods",
    "account_activation_tokens",
    "sessions"
  ];

  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
});

test("seed data maps roles to permissions", () => {
  const seed = createSeedData();

  assert.ok(seed.rolePermissions.system_administrator.includes("identity.invite"));
  assert.ok(seed.rolePermissions.system_administrator.includes("identity.manage"));
  assert.ok(seed.rolePermissions.system_administrator.includes("audit.view"));
  assert.ok(seed.rolePermissions.admissions_officer.includes("workflow.transition"));
  assert.equal(seed.rolePermissions.student.includes("audit.view"), false);
});

test("security helpers hash and verify secrets without storing plaintext", async () => {
  const secret = createSecret();
  const hashed = await hashSecret(secret);

  assert.notEqual(hashed.hash, secret);
  assert.equal(await verifySecret(secret, hashed.hash, hashed.salt), true);
  assert.equal(await verifySecret("wrong-password", hashed.hash, hashed.salt), false);
});

test("router exposes protected task workflow endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");

  assert.match(router, /url\.pathname === "\/api\/tasks"[\s\S]*task\.assign/);
  assert.match(router, /assign\$/);
  assert.match(router, /handoff\$/);
  assert.match(router, /complete\$/);
  assert.match(router, /task\.assign/);
});

test("router protects workflow instance list reads", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");

  assert.match(router, /url\.pathname === "\/api\/workflows\/instances"[\s\S]*workflow\.transition/);
});

test("router exposes protected identity administration endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");

  assert.match(router, /identity\\\/accounts/);
  assert.match(router, /sessions\$/);
  assert.match(router, /suspend\$/);
  assert.match(router, /reactivate\$/);
  assert.match(router, /identity\.manage/);
});

test("router exposes protected master data mutation endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");

  assert.match(router, /\/api\/master-data\/programmes/);
  assert.match(router, /\/api\/master-data\/intakes/);
  assert.match(router, /master_data\.publish/);
});

test("repository supports audit filters", async () => {
  const repository = await readFile(new URL("../server/repository.js", import.meta.url), "utf8");

  assert.match(repository, /filters\.actorId/);
  assert.match(repository, /filters\.action/);
  assert.match(repository, /filters\.subjectType/);
  assert.match(repository, /filters\.occurredFrom/);
  assert.match(repository, /filters\.occurredTo/);
});

test("router exposes document and notification read endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");

  assert.match(router, /\/api\/documents/);
  assert.match(router, /\/api\/notifications\/templates/);
  assert.match(router, /\/api\/notifications/);
  assert.match(router, /listDocuments/);
  assert.match(router, /listNotificationTemplates/);
  assert.match(router, /listNotifications/);
});

test("front end loads live admissions and evidence data", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const shell = await readFile(new URL("../src/shell.js", import.meta.url), "utf8");

  assert.match(index, /src\/apply\.js/);
  assert.match(index, /src\/shell\.js/);
  assert.match(shell, /route: "apply"/);
  assert.match(shell, /#\$\{item\.route\}/);
  assert.doesNotMatch(app, /fetchJson\("\/api\/tasks"\)/);
  assert.doesNotMatch(app, /fetchJson\("\/api\/workflows\/instances"\)/);
  assert.match(app, /\/api\/admissions\/catalogue/);
  assert.match(app, /\/api\/master-data\/reference-lists\/decision_reason/);
  assert.match(app, /\/api\/admissions\/review\/applications/);
  assert.match(app, /request-information/);
  assert.match(app, /\/decision/);
  assert.match(app, /\/convert/);
  assert.match(app, /\/api\/identity\/mfa\/totp/);
  assert.match(app, /\/api\/identity\/sessions\/current\/mfa/);
  assert.match(app, /\/api\/admissions\/review\/offers\/expire/);
  assert.match(app, /review-note/);
  assert.match(app, /loadReviewDetail/);
  assert.match(app, /window\.renderApply/);
  const apply = await readFile(new URL("../src/apply.js", import.meta.url), "utf8");
  assert.match(apply, /mfa_pending/);
  assert.match(apply, /mfa_enrolment_required/);
  assert.match(apply, /\/api\/identity\/sessions\/current\/mfa/);
  assert.match(apply, /\/fee/);
  assert.match(apply, /Application fee/);
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");
  assert.match(router, /POST fee/);
  const operations = await readFile(new URL("../src/system-operations.js", import.meta.url), "utf8");
  assert.match(index, /src\/system-operations\.js/);
  assert.match(operations, /EXIT_GATE_EVIDENCE\.generated\.json/);
  assert.match(operations, /BACKUP_RESTORE_EVIDENCE\.generated\.json/);
});

test("Stage 2 UI exposes applicant and staff pilot workflows", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const apply = await readFile(new URL("../src/apply.js", import.meta.url), "utf8");
  const visibleUi = [app, apply].join("\n");

  for (const artifact of [app, apply]) {
    assert.doesNotMatch(artifact, /Â|â€¦|â€|�/);
  }

  for (const required of [
    /data-form="signin"/,
    /data-form="register"/,
    /data-form="activate"/,
    /data-start=/,
    /data-form="profile"/,
    /data-form="application"/,
    /data-form="fee"/,
    /data-upload=/,
    /data-submit/,
    /data-withdraw/,
    /data-form="respond"/,
    /data-offer="accept"/,
    /data-offer="decline"/,
    /\/offer-response/,
    /\/respond/,
    /\/withdraw/,
    /mfa_pending/,
    /mfa_enrolment_required/,
    /data-cancel-mfa/,
    /Recovery codes/
  ]) {
    assert.match(apply, required);
  }

  for (const required of [
    /data-form='staff-signin'/,
    /data-form='staff-mfa'/,
    /data-staff-cancel-mfa/,
    /data-staff-signout/,
    /data-load-review/,
    /data-load-manifest/,
    /data-expire-offers/,
    /data-review-detail/,
    /data-review-assign/,
    /data-review-info/,
    /data-form='review-note'/,
    /data-form='review-decision'/,
    /data-review-convert/,
    /\/api\/admissions\/review\/intakes\/.+\/manifest/,
    /\/api\/admissions\/review\/offers\/expire/,
    /\/api\/admissions\/review\/applications\/.+\/decision/,
    /\/api\/admissions\/review\/applications\/.+\/convert/
  ]) {
    assert.match(app, required);
  }

  assert.match(visibleUi, /Open intakes/);
  assert.match(visibleUi, /Application review/);
  assert.match(visibleUi, /Application fee/);
});

test("upload requests enforce type, size, classification, and file name rules", () => {
  const valid = {
    fileName: "transcript.pdf",
    contentType: "application/pdf",
    sizeBytes: 250_000,
    classification: "confidential"
  };
  assert.doesNotThrow(() => assertUploadIsAllowed(valid));
  assert.doesNotThrow(() => assertUploadIsAllowed({ ...valid, checksum: "a".repeat(64) }));

  for (const invalid of [
    { contentType: "application/x-php" },
    { sizeBytes: 0 },
    { sizeBytes: 11 * 1024 * 1024 },
    { classification: "secret-ish" },
    { fileName: "../../etc/passwd" },
    { checksum: "not-a-digest" }
  ]) {
    assert.throws(() => assertUploadIsAllowed({ ...valid, ...invalid }), (error) => error.statusCode === 400);
  }
});

test("router exposes document upload request and scan result endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");
  const migrations = await readdir(new URL("../migrations/", import.meta.url));

  assert.match(router, /\/api\/documents\/upload-requests/);
  assert.match(router, /scan-results/);
  assert.match(router, /document\.scan\.record/);
  assert.ok(migrations.includes("007_document_upload_requests.sql"));
});

test("effective dates are validated and resolve the version in force", () => {
  assert.equal(parseEffectiveDate("2027-01-01"), "2027-01-01");
  assert.match(parseEffectiveDate(undefined), /^\d{4}-\d{2}-\d{2}$/);
  for (const invalid of ["2027-02-30", "01/01/2027", "2027-1-1", "tomorrow"]) {
    assert.throws(() => parseEffectiveDate(invalid), (error) => error.statusCode === 400);
  }

  const version2026 = { status: "published", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" };
  const version2027 = { status: "published", effectiveFrom: "2027-01-01", effectiveTo: null };
  const draft = { status: "draft", effectiveFrom: "2026-06-01", effectiveTo: null };
  assert.ok(isEffectiveOn(version2026, "2026-07-01"));
  assert.ok(!isEffectiveOn(version2026, "2027-01-01"));
  assert.ok(isEffectiveOn(version2027, "2027-01-01"));
  assert.ok(!isEffectiveOn(draft, "2026-07-01"));
});

test("router exposes effective-dated master data endpoints", async () => {
  const router = await readFile(new URL("../server/router.js", import.meta.url), "utf8");
  const migrations = await readdir(new URL("../migrations/", import.meta.url));

  assert.ok(router.includes("/api/master-data/organization-units"));
  assert.ok(router.includes("history|deactivate|reactivate"));
  assert.match(router, /programme-versions/);
  assert.ok(router.includes("(publish|retire)"));
  assert.ok(migrations.includes("008_master_data_effective_dating.sql"));
});

test("academic calendar validates windows and lifecycle transitions", () => {
  const windows = validateWindows(
    { registration: ["2027-01-15", "2027-02-15"], teaching: ["2027-02-01", "2027-05-31"] },
    "2027-02-01",
    "2027-06-30"
  );
  assert.deepEqual(openWindowsOn({ windows }, "2027-02-10").sort(), ["registration", "teaching"]);
  assert.deepEqual(openWindowsOn({ windows }, "2027-06-15"), []);

  for (const invalid of [
    { enrolment: ["2027-01-01", "2027-01-31"] },
    { registration: ["2027-02-15", "2027-01-15"] },
    { teaching: ["2027-01-01", "2027-05-31"] },
    { assessment: ["2027-06-01"] }
  ]) {
    assert.throws(() => validateWindows(invalid, "2027-02-01", "2027-06-30"), (error) => error.statusCode === 400);
  }

  assert.ok(canTransitionPeriod("planning", "published"));
  assert.ok(canTransitionPeriod("published", "active"));
  assert.ok(canTransitionPeriod("closed", "archived"));
  assert.ok(!canTransitionPeriod("planning", "active"));
  assert.ok(!canTransitionPeriod("archived", "active"));
});

test("reference values enforce list formats and effective dates", () => {
  const country = { code: "country", valuePattern: "^[A-Z]{2}$" };
  const currency = { code: "currency", valuePattern: "^[A-Z]{3}$" };
  assert.doesNotThrow(() => assertReferenceValueIsValid(country, { valueCode: "KE" }));
  assert.doesNotThrow(() => assertReferenceValueIsValid(currency, { valueCode: "BWP", metadata: { minorUnits: 2 } }));

  for (const [list, input] of [
    [country, { valueCode: "KEN" }],
    [country, { valueCode: "ke" }],
    [currency, { valueCode: "BWP" }],
    [currency, { valueCode: "BWP", metadata: { minorUnits: 9 } }],
    [{ code: "study_mode" }, { valueCode: "full time" }]
  ]) {
    assert.throws(() => assertReferenceValueIsValid(list, input), (error) => error.statusCode === 400);
  }

  assert.ok(isValueActiveOn({ status: "active", effectiveFrom: "2026-01-01", effectiveTo: null }, "2026-10-01"));
  assert.ok(!isValueActiveOn({ status: "retired", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }, "2026-10-01"));
  assert.ok(!isValueActiveOn({ status: "active", effectiveFrom: "2027-01-01", effectiveTo: null }, "2026-10-01"));
});

test("admissions workflow follows the roadmap path and guards decisions", () => {
  const admissions = workflowDefinitions.find((definition) => definition.code === "admissions_application");
  const statesNamed = new Set(admissions.states);
  for (const transition of admissions.transitions) {
    assert.ok(statesNamed.has(transition.from) && statesNamed.has(transition.to), `${transition.from} -> ${transition.to}`);
  }

  const happyPath = ["Draft", "Submitted", "Payment verified", "Completeness review", "Academic review", "Decision", "Offer issued", "Accepted"];
  const decider = ["admissions.decide"];
  for (let index = 1; index < happyPath.length; index += 1) {
    assert.doesNotThrow(() => assertTransitionAllowed(admissions, happyPath[index - 1], happyPath[index], decider));
  }

  const status = (fn) => {
    try {
      fn();
      return 200;
    } catch (error) {
      return error.statusCode;
    }
  };
  assert.equal(status(() => assertTransitionAllowed(admissions, "Submitted", "Decision", decider)), 409);
  assert.equal(status(() => assertTransitionAllowed(admissions, "Decision", "Offer issued", [])), 403);
  assert.equal(status(() => assertTransitionAllowed(admissions, "Accepted", "Withdrawn", decider)), 409);
  assert.equal(status(() => assertTransitionAllowed(admissions, "Draft", "Enrolled", decider)), 400);

  assert.deepEqual(allowedTransitionsFrom(admissions, "Decision", []), ["Withdrawn"]);
  assert.deepEqual(allowedTransitionsFrom(admissions, "Decision", decider).sort(), ["Offer issued", "Rejected", "Withdrawn"]);
  assert.deepEqual(allowedTransitionsFrom(admissions, "Accepted", decider), []);
});

test("session tokens are stored as digests, never as the token itself", async () => {
  const token = createSecret();
  assert.equal(digestToken(token), digestToken(token));
  assert.notEqual(digestToken(token), token);
  assert.notEqual(digestToken(token), digestToken(createSecret()));

  const repository = await readFile(new URL("../server/repository.js", import.meta.url), "utf8");
  assert.match(repository, /token_digest = \$1/);
  assert.doesNotMatch(repository, /findMatchingSession/);
});

test("password policy rejects short, repetitive, and email-derived passwords", () => {
  assert.deepEqual(passwordProblems("Kariba-Sunset-Lecture-2026!", "admin@southvalley.test"), []);
  assert.ok(passwordProblems("Phase1-Admin-Password-2026!", "admin@southvalley.test").length > 0);
  assert.ok(passwordProblems("short").length > 0);
  assert.ok(passwordProblems("aaaaaaaaaaaaaaaa").length > 0);
  assert.ok(passwordProblems("tinashe-2026-password", "tinashe@example.edu").length > 0);
});

test("static server only exposes the UI and generated evidence", () => {
  for (const allowed of ["/index.html", "/src/app.js", "/src/styles.css", "/src/assets/campus-concept.jpg", "/src/assets/campus-concept-mobile.jpg", "/docs/phase-1/EXIT_GATE_EVIDENCE.generated.json"]) {
    assert.ok(isPublicPath(allowed), allowed);
  }
  for (const blocked of [
    "/server/config.js",
    "/package.json",
    "/svu-dev.log",
    "/migrations/001_phase1_foundation.sql",
    "/_legacy_php_system/southval_db2.sql",
    "/data/dev-outbox/x.json",
    "/src/../server/db.js",
    "/src/assets/private.jpg",
    "/src/assets/campus-concept.jpg/../private.jpg",
    "/docs/phase-1/API_CONTRACTS.md"
  ]) {
    assert.ok(!isPublicPath(blocked), blocked);
  }
});

test("TOTP matches RFC 6238 vectors and tolerates one step of drift", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 59 * 1000), "287082");
  assert.equal(totp(secret, 1111111109 * 1000), "081804");
  assert.equal(totp(secret, 1234567890 * 1000), "005924");

  const now = 1_790_000_000_000;
  assert.notEqual(matchTotp(secret, totp(secret, now - 30_000), now), null);
  assert.notEqual(matchTotp(secret, totp(secret, now + 30_000), now), null);
  assert.equal(matchTotp(secret, totp(secret, now - 90_000), now), null);
  assert.equal(matchTotp(secret, "12345", now), null);
});

test("secrets at rest are authenticated-encrypted", () => {
  const key = Buffer.alloc(32, 1);
  const envelope = encryptSecret("JBSWY3DPEHPK3PXP", key);
  assert.equal(decryptSecret(envelope, key), "JBSWY3DPEHPK3PXP");
  assert.notEqual(encryptSecret("JBSWY3DPEHPK3PXP", key), envelope);
  assert.throws(() => decryptSecret(envelope, Buffer.alloc(32, 2)));
  const [version, iv, tag, ciphertext] = envelope.split(".");
  const tampered = [version, iv, tag, `${ciphertext.slice(0, -2)}AA`].join(".");
  assert.throws(() => decryptSecret(tampered, key));
});

test("MFA policy decides verify, enrol, or none", () => {
  assert.equal(mfaRequirement({ policy: "off", hasFactor: true, privileged: true }), "none");
  assert.equal(mfaRequirement({ policy: "enrolled", hasFactor: true, privileged: false }), "verify");
  assert.equal(mfaRequirement({ policy: "enrolled", hasFactor: false, privileged: true }), "none");
  assert.equal(mfaRequirement({ policy: "privileged", hasFactor: false, privileged: true }), "enrol");
  assert.equal(mfaRequirement({ policy: "privileged", hasFactor: false, privileged: false }), "none");
  assert.equal(mfaRequirement({ policy: "privileged", hasFactor: true, privileged: false }), "verify");
});

test("non-development environments must supply a data key and default to privileged MFA", () => {
  assert.throws(() => loadConfig({ SVU_ENV: "production" }), /SVU_DATA_KEY/);
  assert.throws(() => loadConfig({ SVU_DATA_KEY: Buffer.alloc(16).toString("base64") }), /32-byte/);
  const production = loadConfig({ SVU_ENV: "production", SVU_DATA_KEY: Buffer.alloc(32, 3).toString("base64") });
  assert.equal(production.mfaPolicy, "privileged");
  assert.equal(production.devOutboxDir, null);
  assert.equal(loadConfig({}).mfaPolicy, "enrolled");
  assert.throws(() => loadConfig({ SVU_MFA_POLICY: "sometimes" }), /SVU_MFA_POLICY/);
});

test("course catalogue rules: codes, credits, prerequisite cycles, curriculum ordering", () => {
  assert.doesNotThrow(() => assertCourseInput({ code: "COMP101", credits: 15, level: 1 }));
  assert.doesNotThrow(() => assertCourseInput({ code: "INFS2010A", credits: 7.5, level: 2 }));
  for (const invalid of [{ code: "comp101" }, { code: "C101" }, { credits: 0 }, { credits: 7.3 }, { credits: 61 }, { level: 9 }, { level: 1.5 }]) {
    assert.throws(() => assertCourseInput(invalid), (error) => error.statusCode === 400, JSON.stringify(invalid));
  }

  const edges = new Map([["a", ["b"]], ["b", ["c"]], ["c", []]]);
  assert.equal(findPrerequisiteCycle(edges, "a"), null);
  edges.set("c", ["a"]);
  assert.deepEqual(findPrerequisiteCycle(edges, "a"), ["a", "b", "c", "a"]);

  const entries = [
    { courseId: "a", code: "A101", yearOfStudy: 1, term: "S1", status: "active", prerequisites: [] },
    { courseId: "b", code: "A102", yearOfStudy: 1, term: "S2", status: "active", prerequisites: ["a"] },
    { courseId: "c", code: "A201", yearOfStudy: 2, term: "ANY", status: "active", prerequisites: ["b"] }
  ];
  assert.deepEqual(curriculumProblems(entries), []);
  assert.equal(curriculumProblems([{ ...entries[1], term: "S1" }, entries[0]]).length, 1);
  assert.equal(curriculumProblems([entries[1]]).length, 1);
  assert.equal(curriculumProblems([{ ...entries[0], status: "retired" }]).length, 1);
});

const sampleScheme = {
  bands: [
    { minMark: 0, maxMark: 49, grade: "F", points: 0, passing: false },
    { minMark: 50, maxMark: 59, grade: "P", points: 1, passing: true },
    { minMark: 60, maxMark: 64, grade: "2.2", points: 2, passing: true },
    { minMark: 65, maxMark: 74, grade: "2.1", points: 3, passing: true },
    { minMark: 75, maxMark: 100, grade: "1", points: 4, passing: true }
  ],
  classifications: [
    { minGpa: 3.5, label: "First class" },
    { minGpa: 2.75, label: "Upper second" },
    { minGpa: 2, label: "Lower second" },
    { minGpa: 1, label: "Pass" }
  ]
};
const sampleResults = [
  { courseCode: "COMP101", credits: 15, mark: 80 },
  { courseCode: "INFS101", credits: 15, mark: 62 },
  { courseCode: "COMP102", credits: 30, mark: 45, attempt: 1 },
  { courseCode: "COMP102", credits: 30, mark: 68, attempt: 2 },
  { courseCode: "STAT101", credits: 15, grade: "W" }
];
const baseRules = {
  creditWeighted: true,
  retakePolicy: "latest",
  excludeGrades: ["W", "EX"],
  includeFailed: true,
  rounding: { decimals: 2, mode: "half_up" }
};

test("grading schemes must cover 0-100 without gaps, overlaps, or inverted points", () => {
  assert.doesNotThrow(() => assertGradingScheme(sampleScheme));
  const withBand = (index, change) => ({
    ...sampleScheme,
    bands: sampleScheme.bands.map((band, position) => (position === index ? { ...band, ...change } : band))
  });
  for (const broken of [
    withBand(1, { minMark: 51 }),
    withBand(1, { minMark: 49 }),
    withBand(4, { maxMark: 99 }),
    withBand(4, { points: 2.5 }),
    withBand(3, { passing: false }),
    withBand(2, { grade: "P" })
  ]) {
    assert.throws(() => assertGradingScheme(broken), (error) => error.statusCode === 400);
  }
});

test("GPA follows credit weighting, retake policy, exclusions, and rounding rules", () => {
  const latest = calculateGpa(sampleResults, baseRules, sampleScheme);
  assert.equal(latest.gpa, 3);
  assert.equal(latest.classification, "Upper second");
  assert.equal(latest.creditsCounted, 60);
  assert.ok(latest.excluded.some((item) => item.courseCode === "STAT101"));
  assert.ok(latest.excluded.some((item) => item.courseCode === "COMP102" && item.attempt === 1));

  assert.equal(calculateGpa(sampleResults, { ...baseRules, retakePolicy: "best" }, sampleScheme).gpa, 3);
  const all = calculateGpa(sampleResults, { ...baseRules, retakePolicy: "all" }, sampleScheme);
  assert.equal(all.gpa, 2);
  assert.equal(all.classification, "Lower second");
  assert.equal(calculateGpa(sampleResults, { ...baseRules, retakePolicy: "all", includeFailed: false }, sampleScheme).gpa, 3);
  assert.equal(calculateGpa(sampleResults, { ...baseRules, creditWeighted: false }, sampleScheme).gpa, 3);
  assert.equal(calculateGpa([{ courseCode: "X", credits: 15, grade: "W" }], baseRules, sampleScheme).gpa, null);

  assert.equal(roundGpa(2.675, { decimals: 2, mode: "half_up" }), 2.68);
  assert.equal(roundGpa(2.675, { decimals: 2, mode: "truncate" }), 2.67);
  assert.equal(roundGpa(10 / 3, { decimals: 2, mode: "half_up" }), 3.33);

  const outcomes = runValidationSamples(
    [
      { name: "retake counts latest", results: sampleResults, expectedGpa: 3, expectedClassification: "Upper second" },
      { name: "deliberately wrong", results: sampleResults, expectedGpa: 2.5 }
    ],
    baseRules,
    sampleScheme
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.passed), [true, false]);
});

test("uploads are checked against file signatures and links are signed per operation", () => {
  assert.ok(matchesFileSignature("application/pdf", Buffer.from("%PDF-1.7\n")));
  assert.ok(matchesFileSignature("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])));
  assert.ok(matchesFileSignature("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(!matchesFileSignature("application/pdf", Buffer.from("MZ\x90\x00")));
  assert.ok(!matchesFileSignature("image/png", Buffer.from("%PDF-1.7")));

  const key = Buffer.alloc(32, 9);
  const expires = Date.now() + 60_000;
  const signature = signDocumentUrl(key, "download", "doc_1", expires);
  assert.doesNotThrow(() => verifyDocumentUrl(key, "download", "doc_1", expires, signature));
  const status = (fn) => {
    try {
      fn();
      return 200;
    } catch (error) {
      return error.statusCode;
    }
  };
  assert.equal(status(() => verifyDocumentUrl(key, "upload", "doc_1", expires, signature)), 403);
  assert.equal(status(() => verifyDocumentUrl(key, "download", "doc_2", expires, signature)), 403);
  assert.equal(status(() => verifyDocumentUrl(key, "download", "doc_1", expires + 1, signature)), 403);
  const past = Date.now() - 1;
  assert.equal(status(() => verifyDocumentUrl(key, "download", "doc_1", past, signDocumentUrl(key, "download", "doc_1", past))), 410);
});

test("scope checks only count roles that grant the permission being exercised", () => {
  const actor = {
    roles: [
      { code: "admissions_officer", scope: { programmeCodes: ["BSC-IS"], intakeIds: ["intake_2027_feb"] }, permissions: ["workflow.transition"] },
      { code: "auditor", scope: {}, permissions: ["audit.view"] }
    ]
  };
  const inScope = { programmeCode: "BSC-IS", intakeId: "intake_2027_feb" };
  const outOfScope = { programmeCode: "BCOM", intakeId: "intake_2027_feb" };
  const status = (fn) => {
    try {
      fn();
      return 200;
    } catch (error) {
      return error.statusCode;
    }
  };

  assert.equal(status(() => assertActorCanAccessScope({ ...actor, authorizingPermission: "workflow.transition" }, inScope)), 200);
  assert.equal(status(() => assertActorCanAccessScope({ ...actor, authorizingPermission: "workflow.transition" }, outOfScope)), 403);
  assert.equal(status(() => assertActorCanAccessScope({ ...actor, authorizingPermission: "audit.view" }, outOfScope)), 200);
});

test("applicant profiles validate inputs and report what is missing", () => {
  const complete = {
    dateOfBirth: "2006-05-14",
    nationalityCode: "ZW",
    phone: "+263771234567",
    priorLevelCode: "CERTIFICATE",
    studyModeCode: "FULL_TIME",
    address: { line1: "12 Samora Machel Ave", city: "Harare", countryCode: "ZW" }
  };
  assert.deepEqual(profileCompleteness(complete), { complete: true, missing: [] });
  assert.deepEqual(profileCompleteness({ ...complete, phone: null, address: { line1: "x" } }).missing, ["phone", "address"]);
  assert.equal(profileCompleteness(null).complete, false);

  assert.doesNotThrow(() => assertProfileInput(complete, "2026-10-01"));
  for (const invalid of [{ dateOfBirth: "2015-01-01" }, { dateOfBirth: "1900-01-01" }, { dateOfBirth: "2006-02-30" }, { phone: "0771234567" }, { address: ["x"] }]) {
    assert.throws(() => assertProfileInput(invalid, "2026-10-01"), (error) => error.statusCode === 400, JSON.stringify(invalid));
  }
});

test("applications are submittable only with profile, study mode, fee, and clean documents", () => {
  const application = { programmeVersionId: "pv_1", studyModeCode: "FULL_TIME", fee: { status: "verified" } };
  const completeProfile = { complete: true, missing: [], profile: { studyModeCode: "FULL_TIME" } };
  const cleanChecklist = [
    { documentType: "national_id", satisfied: true, status: "available" },
    { documentType: "prior_transcript", satisfied: true, status: "verified" }
  ];
  assert.deepEqual(readinessFor(application, cleanChecklist, completeProfile), { ready: true, blockers: [] });

  const blocked = readinessFor(
    { programmeVersionId: null, studyModeCode: null },
    [{ documentType: "national_id", satisfied: false, status: "missing" }, { documentType: "prior_transcript", satisfied: false, status: "quarantined" }],
    { complete: false, missing: ["phone"], profile: null }
  );
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    "complete your profile (phone)",
    "choose a study mode",
    "national_id is missing",
    "prior_transcript is still quarantined",
    "verify your application fee or waiver code",
    "the programme has no published version for this intake"
  ]);
});

test("duplicate detection explains why two applicants may be the same person", () => {
  const subject = { legalName: "Rufaro Sibanda", dateOfBirth: "2004-03-21", phone: "+263771000001" };
  assert.deepEqual(duplicateReasons(subject, { legalName: " rufaro sibanda ", dateOfBirth: "2004-03-21", phone: "+263779999999" }), ["same legal name and date of birth"]);
  assert.deepEqual(duplicateReasons(subject, { legalName: "Someone Else", dateOfBirth: "1999-01-01", phone: "+263771000001" }), ["same phone number"]);
  assert.deepEqual(duplicateReasons(subject, { legalName: "Rufaro Sibanda", dateOfBirth: "2004-03-22", phone: null }), []);
  assert.deepEqual(duplicateReasons({ ...subject, phone: null }, { legalName: "X", dateOfBirth: null, phone: null }), []);
});

test("student numbers encode the entry year and a zero-padded sequence", () => {
  assert.equal(formatStudentNumber("2027", 1), "S27000001");
  assert.equal(formatStudentNumber(2031, 123456), "S31123456");
});
