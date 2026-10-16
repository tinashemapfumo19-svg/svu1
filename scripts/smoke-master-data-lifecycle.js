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

const runId = Date.now();
const today = new Date().toISOString().slice(0, 10);
const results = {};

try {
  const admin = await login(adminCredentials);
  // Maker-checker: the admin drafts, the registrar publishes.
  const registrar = await login(registrarCredentials);
  const student = await login(studentCredentials);

  results.studentCreateUnitDenied = await expectStatus(
    "/api/master-data/organization-units",
    request("POST", { code: `F${runId}`, name: "Denied", unitType: "faculty" }, student.token),
    403
  );

  const faculty = await send("POST", "/api/master-data/organization-units", {
    code: `FAC-${runId}`,
    name: "Faculty of Smoke Testing",
    unitType: "faculty",
    reason: "Lifecycle smoke test"
  }, admin.token);
  const department = await send("POST", "/api/master-data/organization-units", {
    code: `DEP-${runId}`,
    name: "Department of Effective Dates",
    unitType: "department",
    parentId: faculty.data.id,
    reason: "Lifecycle smoke test"
  }, admin.token);

  results.departmentWithoutFacultyRejected = await expectStatus(
    "/api/master-data/organization-units",
    request("POST", { code: `ORPHAN-${runId}`, name: "Orphan", unitType: "department" }, admin.token),
    400
  );
  results.departmentUnderDepartmentRejected = await expectStatus(
    "/api/master-data/organization-units",
    request("POST", { code: `NESTED-${runId}`, name: "Nested", unitType: "department", parentId: department.data.id }, admin.token),
    409
  );

  const renamed = await send("PATCH", `/api/master-data/organization-units/${department.data.id}`, {
    name: "Department of Effective Dating",
    reason: "Approved rename"
  }, admin.token);
  results.renamedTo = renamed.data.name;

  results.futureChangeRejected = await expectStatus(
    `/api/master-data/organization-units/${department.data.id}`,
    request("PATCH", { name: "Too early", effectiveFrom: "2099-01-01", reason: "Scheduled" }, admin.token),
    400
  );
  results.backdatedChangeRejected = await expectStatus(
    `/api/master-data/organization-units/${department.data.id}`,
    request("PATCH", { name: "Too late", effectiveFrom: "2020-01-01", reason: "Backdated" }, admin.token),
    409
  );

  const history = await send("GET", `/api/master-data/organization-units/${department.data.id}/history`);
  results.historyRows = history.data.length;
  results.historyNames = history.data.map((row) => row.name);

  const programme = await send("POST", "/api/master-data/programmes", {
    code: `PRG-${runId}`,
    name: "BSc Smoke Testing",
    departmentId: department.data.id,
    reason: "Lifecycle smoke test"
  }, admin.token);

  results.deactivateDepartmentWithProgrammeRejected = await expectStatus(
    `/api/master-data/organization-units/${department.data.id}/deactivate`,
    request("POST", { reason: "Should be blocked by programme" }, admin.token),
    409
  );
  results.deactivateFacultyWithDepartmentRejected = await expectStatus(
    `/api/master-data/organization-units/${faculty.data.id}/deactivate`,
    request("POST", { reason: "Should be blocked by department" }, admin.token),
    409
  );

  const emptyDepartment = await send("POST", "/api/master-data/organization-units", {
    code: `DEP2-${runId}`,
    name: "Department to Retire",
    unitType: "department",
    parentId: faculty.data.id,
    reason: "Lifecycle smoke test"
  }, admin.token);
  const deactivated = await send("POST", `/api/master-data/organization-units/${emptyDepartment.data.id}/deactivate`, {
    reason: "Merged into another department"
  }, admin.token);
  results.deactivatedStatus = deactivated.data.status;
  const reactivated = await send("POST", `/api/master-data/organization-units/${emptyDepartment.data.id}/reactivate`, {
    reason: "Merge reversed"
  }, admin.token);
  results.reactivatedStatus = reactivated.data.status;

  const versionsPath = `/api/master-data/programmes/${programme.data.id}/versions`;
  const v2026 = await send("POST", versionsPath, {
    versionLabel: "2026",
    requirements: { documents: ["prior_transcript"] },
    effectiveFrom: "2026-01-01"
  }, admin.token);
  await send("POST", `/api/master-data/programme-versions/${v2026.data.id}/publish`, { reason: "Senate approval 2026" }, registrar.token);

  const v2027 = await send("POST", versionsPath, {
    versionLabel: "2027",
    requirements: { documents: ["prior_transcript", "national_id"] }
  }, admin.token);
  const published2027 = await send("POST", `/api/master-data/programme-versions/${v2027.data.id}/publish`, {
    effectiveFrom: "2027-01-01",
    reason: "Senate approval 2027"
  }, registrar.token);
  results.supersededVersionIds = published2027.data.supersededVersionIds;

  results.duplicateLabelRejected = await expectStatus(versionsPath, request("POST", { versionLabel: "2027" }, admin.token), 409);

  const backdated = await send("POST", versionsPath, { versionLabel: "2026-mid" }, admin.token);
  results.overlappingPublishRejected = await expectStatus(
    `/api/master-data/programme-versions/${backdated.data.id}/publish`,
    request("POST", { effectiveFrom: "2026-06-01", reason: "Should overlap 2027" }, registrar.token),
    409
  );

  const mid2026 = await send("GET", `${versionsPath}?asOf=2026-07-01`);
  const early2027 = await send("GET", `${versionsPath}?asOf=2027-02-01`);
  results.effectiveIn2026 = mid2026.effectiveVersionId === v2026.data.id;
  results.effectiveIn2027 = early2027.effectiveVersionId === v2027.data.id;
  results.version2026EffectiveTo = mid2026.data.find((version) => version.id === v2026.data.id).effectiveTo;

  const retired = await send("POST", `/api/master-data/programme-versions/${v2027.data.id}/retire`, {
    effectiveTo: "2027-12-31",
    reason: "Programme closing"
  }, admin.token);
  results.retiredStatus = retired.data.status;
  results.republishRetiredRejected = await expectStatus(
    `/api/master-data/programme-versions/${v2027.data.id}/publish`,
    request("POST", { reason: "Should be blocked" }, registrar.token),
    409
  );

  const audit = await send(
    "GET",
    `/api/audit/events?subjectType=OrganizationUnit&subjectId=${department.data.id}&action=master_data.organization_unit.updated`,
    null,
    admin.token
  );
  const updateEvent = audit.data[0];
  results.auditHasBeforeAfter = Boolean(updateEvent?.beforeRef && updateEvent?.afterRef && updateEvent?.metadata?.before?.name);

  const failures = [
    results.historyRows !== 2 && "expected two history rows after rename",
    results.version2026EffectiveTo !== "2026-12-31" && "2026 version was not end-dated",
    !results.effectiveIn2026 && "2026 version not effective mid-2026",
    !results.effectiveIn2027 && "2027 version not effective in 2027",
    results.retiredStatus !== "retired" && "2027 version not retired",
    !results.auditHasBeforeAfter && "update audit event missing before/after references"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  results.checkedOn = today;
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
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
