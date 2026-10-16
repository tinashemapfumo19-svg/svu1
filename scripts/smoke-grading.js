const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const registrarCredentials = {
  email: "registrar@southvalley.test",
  password: "Kariba-Senate-Approvals-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const code = `smoke_${Date.now()}`;
const bands = [
  { minMark: 0, maxMark: 39, grade: "F", points: 0, passing: false },
  { minMark: 40, maxMark: 69, grade: "C", points: 2, passing: true },
  { minMark: 70, maxMark: 100, grade: "A", points: 4, passing: true }
];
const classifications = [
  { minGpa: 3.5, label: "Distinction" },
  { minGpa: 2, label: "Pass" }
];
const results = {};

try {
  const admin = await login(adminCredentials);
  // Maker-checker: the admin drafts, the registrar publishes.
  const registrar = await login(registrarCredentials);
  const student = await login(studentCredentials);

  results.studentCreateDenied = await expectStatus("/api/master-data/grading-schemes", request("POST", { code, name: "x", bands, classifications }, student.token), 403);
  results.gappedSchemeRejected = await expectStatus("/api/master-data/grading-schemes", request("POST", {
    code, name: "Gapped", bands: bands.map((band) => (band.grade === "C" ? { ...band, minMark: 41 } : band)), classifications
  }, admin.token), 400);

  const v1 = (await send("POST", "/api/master-data/grading-schemes", { code, name: "Smoke scheme", bands, classifications }, admin.token)).data;
  results.ruleSetOnDraftSchemeRejected = await expectStatus("/api/master-data/gpa-rule-sets", request("POST", {
    code: `${code}_gpa`, name: "Too early", gradingSchemeId: v1.id, rules: rules()
  }, admin.token), 409);
  results.selfPublishSchemeDenied = await expectStatus(
    `/api/master-data/grading-schemes/${v1.id}/publish`,
    request("POST", { effectiveFrom: "2026-01-01", reason: "Approving my own draft" }, admin.token),
    403
  );
  await send("POST", `/api/master-data/grading-schemes/${v1.id}/publish`, { effectiveFrom: "2026-01-01", reason: "Board approved" }, registrar.token);

  const sampleResults = [
    { courseCode: "A1", credits: 10, mark: 75 },
    { courseCode: "B1", credits: 30, mark: 50 }
  ];
  // Credit-weighted: (4*10 + 2*30) / 40 = 2.5.
  const wrong = (await send("POST", "/api/master-data/gpa-rule-sets", {
    code: `${code}_gpa`,
    name: "Smoke GPA with a wrong worked example",
    gradingSchemeId: v1.id,
    rules: rules(),
    samples: [{ name: "unweighted mistake", results: sampleResults, expectedGpa: 3, expectedClassification: "Pass" }]
  }, admin.token)).data;
  results.failingSamplesBlockPublish = await expectStatus(
    `/api/master-data/gpa-rule-sets/${wrong.id}/publish`,
    request("POST", { effectiveFrom: "2026-01-01", reason: "Should fail validation" }, registrar.token),
    409
  );

  const noSamples = (await send("POST", "/api/master-data/gpa-rule-sets", {
    code: `${code}_gpa`, name: "No examples", gradingSchemeId: v1.id, rules: rules()
  }, admin.token)).data;
  results.missingSamplesBlockPublish = await expectStatus(
    `/api/master-data/gpa-rule-sets/${noSamples.id}/publish`,
    request("POST", { effectiveFrom: "2026-01-01", reason: "No examples" }, registrar.token),
    409
  );

  const good = (await send("POST", "/api/master-data/gpa-rule-sets", {
    code: `${code}_gpa`,
    name: "Smoke GPA",
    gradingSchemeId: v1.id,
    rules: rules(),
    samples: [{ name: "credit weighted", results: sampleResults, expectedGpa: 2.5, expectedClassification: "Pass" }]
  }, admin.token)).data;
  results.ruleSetVersion = good.version;
  const published = (await send("POST", `/api/master-data/gpa-rule-sets/${good.id}/publish`, { effectiveFrom: "2026-01-01", reason: "Board approved" }, registrar.token)).data;
  results.validation = published.validation.map((outcome) => `${outcome.sample}: ${outcome.passed}`);

  const preview = (await send("POST", `/api/master-data/gpa-rule-sets/${good.id}/calculate`, {
    results: [...sampleResults, { courseCode: "B1", credits: 30, mark: 90, attempt: 2 }]
  }, student.token)).data;
  results.previewGpa = preview.gpa;
  results.previewClassification = preview.classification;
  results.unauthenticatedPreviewDenied = await expectStatus(`/api/master-data/gpa-rule-sets/${good.id}/calculate`, request("POST", { results: [] }), 401);

  results.retireSchemeInUseRejected = await expectStatus(
    `/api/master-data/grading-schemes/${v1.id}/retire`,
    request("POST", { reason: "Still used" }, admin.token),
    409
  );

  const v2 = (await send("POST", "/api/master-data/grading-schemes", { code, name: "Smoke scheme v2", bands, classifications }, admin.token)).data;
  await send("POST", `/api/master-data/grading-schemes/${v2.id}/publish`, { effectiveFrom: "2027-01-01", reason: "New academic year" }, registrar.token);
  const schemes = (await send("GET", "/api/master-data/grading-schemes")).data.filter((scheme) => scheme.code === code);
  results.schemeVersions = schemes.map((scheme) => `v${scheme.version} ${scheme.status} ${scheme.effectiveFrom}..${scheme.effectiveTo ?? ""}`);

  const failures = [
    results.ruleSetVersion !== 3 && "rule set versions should number 1, 2, 3",
    results.previewGpa !== 4 && "latest attempt (90) should give a 4.0 GPA",
    results.previewClassification !== "Distinction" && "4.0 should classify as Distinction",
    !results.schemeVersions.includes("v1 published 2026-01-01..2026-12-31") && "v1 should be end-dated by v2"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function rules() {
  return { creditWeighted: true, retakePolicy: "latest", excludeGrades: ["W"], includeFailed: true, rounding: { decimals: 2, mode: "half_up" } };
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
