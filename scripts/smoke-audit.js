const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

try {
  const admin = await login(adminCredentials);
  // Create the evidence this script queries, so it does not depend on other scripts running first.
  const instance = await postJson("/api/workflows/instances", {
    definitionCode: "admissions_application",
    subjectType: "Application",
    subjectId: `app_smoke_audit_${Date.now()}`,
    scope: { programmeCode: "BSC-IS", intakeId: "intake_2027_feb" }
  }, admin.token);
  const instanceId = instance.data.id;
  await postJson(`/api/workflows/instances/${instanceId}/transitions`, {
    toState: "Submitted",
    reason: "Audit smoke test evidence"
  }, admin.token);

  const workflowEvents = await get("/api/audit/events?action=workflow.transitioned&limit=5", admin.token);
  if (workflowEvents.data.length === 0) {
    throw new Error("Expected at least one workflow.transitioned audit event.");
  }
  if (workflowEvents.data.some((event) => event.action !== "workflow.transitioned")) {
    throw new Error("Audit action filter returned mixed actions.");
  }

  const subjectEvents = await get(
    `/api/audit/events?subjectType=WorkflowInstance&subjectId=${instanceId}&limit=5`,
    admin.token
  );
  if (subjectEvents.data.length !== 2) {
    throw new Error(`Expected created and transitioned events for ${instanceId}, got ${subjectEvents.data.length}.`);
  }
  if (subjectEvents.data.some((event) => event.subjectId !== instanceId)) {
    throw new Error("Audit subject filter returned unexpected subject IDs.");
  }

  console.log(JSON.stringify({
    workflowEventCount: workflowEvents.data.length,
    subjectEventCount: subjectEvents.data.length,
    verified: ["action", "subjectType", "subjectId", "limit"]
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
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

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function postJson(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
