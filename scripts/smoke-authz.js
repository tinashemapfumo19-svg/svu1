import { Pool } from "pg";
import { loadConfig } from "../server/config.js";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const results = {};

try {
  await expireTemporaryStudentRoles();
  results.unauthenticatedAudit = await expectStatus("/api/audit/events", {}, 401);
  results.unauthenticatedTasks = await expectStatus("/api/tasks", {}, 401);
  results.unauthenticatedWorkflows = await expectStatus("/api/workflows/instances", {}, 401);

  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);

  results.studentAuditDenied = await expectStatus(
    "/api/audit/events",
    { headers: bearer(student.token) },
    403
  );

  await post(
    "/api/access/role-assignments",
    {
      accountId: student.account.id,
      roleCode: "admissions_officer",
      scope: { programmeCodes: ["OTHER-PROG"], intakeIds: ["other_intake"] },
      reason: "Smoke test wrong-scope assignment"
    },
    admin.token
  );
  // A global-scope role that lacks workflow.transition must not widen the officer role's scope.
  await post(
    "/api/access/role-assignments",
    {
      accountId: student.account.id,
      roleCode: "auditor",
      scope: {},
      reason: "Smoke test unrelated global role"
    },
    admin.token
  );

  results.studentScopeDenied = await expectStatus(
    "/api/workflows/instances/wfi_mock_application/transitions",
    {
      method: "POST",
      headers: {
        ...bearer(student.token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        toState: "Completeness review",
        reason: "Smoke test should be denied by scope"
      })
    },
    403
  );

  const instance = await post(
    "/api/workflows/instances",
    {
      definitionCode: "admissions_application",
      subjectType: "Application",
      subjectId: `app_smoke_authz_${Date.now()}`,
      scope: { programmeCode: "BSC-IS", intakeId: "intake_2027_feb" }
    },
    admin.token
  );
  const workflow = await post(
    `/api/workflows/instances/${instance.data.id}/transitions`,
    {
      toState: "Submitted",
      reason: "Smoke test allowed admin transition"
    },
    admin.token
  );

  const audit = await get("/api/audit/events", admin.token);
  results.adminWorkflowState = workflow.data.state;
  results.auditEvents = audit.data.length;

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await expireTemporaryStudentRoles();
}

async function expireTemporaryStudentRoles() {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  try {
    await pool.query(
      `update role_assignments
       set effective_to = current_date - 1
       where account_id = 'acct_tinashe'
         and role_code in ('auditor', 'admissions_officer')
         and reason like 'Smoke test%'
         and (effective_to is null or effective_to >= current_date)`
    );
  } finally {
    await pool.end();
  }
}

async function login(credentials) {
  const response = await post("/api/identity/sessions", credentials);
  return response.data;
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: bearer(token)
  });
  return parseResponse(response);
}

async function post(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(token ? bearer(token) : {}),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Expected ${expectedStatus} for ${path}, received ${response.status}: ${body}`);
  }
  return response.status;
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
