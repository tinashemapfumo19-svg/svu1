const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const subjectId = `app_smoke_workflow_${Date.now()}`;
const scope = { programmeCode: "BSC-IS", intakeId: "intake_2027_feb" };
const results = {};

try {
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);

  const definitions = await send("GET", "/api/workflows/definitions");
  results.activeDefinitions = definitions.data.filter((definition) => definition.active).map((definition) => `${definition.code} v${definition.version}`);

  results.studentStartDenied = await expectStatus("/api/workflows/instances", request("POST", {
    definitionCode: "admissions_application", subjectType: "Application", subjectId, scope
  }, student.token), 403);
  results.missingScopeRejected = await expectStatus("/api/workflows/instances", request("POST", {
    definitionCode: "admissions_application", subjectType: "Application", subjectId: `${subjectId}_noscope`
  }, admin.token), 400);

  const started = await send("POST", "/api/workflows/instances", {
    definitionCode: "admissions_application", subjectType: "Application", subjectId, scope
  }, admin.token);
  const id = started.data.id;
  const transitions = `/api/workflows/instances/${id}/transitions`;
  results.initialState = started.data.state;

  results.duplicateActiveRejected = await expectStatus("/api/workflows/instances", request("POST", {
    definitionCode: "admissions_application", subjectType: "Application", subjectId, scope
  }, admin.token), 409);
  results.missingReasonRejected = await expectStatus(transitions, request("POST", { toState: "Submitted" }, admin.token), 400);
  results.unknownStateRejected = await expectStatus(transitions, request("POST", { toState: "Enrolled", reason: "x" }, admin.token), 400);
  results.skipAheadRejected = await expectStatus(transitions, request("POST", { toState: "Decision", reason: "Skip" }, admin.token), 409);

  await send("POST", transitions, { toState: "Submitted", reason: "Applicant submitted", expectedState: "Draft" }, admin.token);
  results.staleExpectedStateRejected = await expectStatus(
    transitions,
    request("POST", { toState: "Payment verified", reason: "Stale screen", expectedState: "Draft" }, admin.token),
    409
  );

  const detail = await send("GET", `/api/workflows/instances/${id}`, null, admin.token);
  results.allowedFromSubmitted = detail.data.allowedTransitions.sort();
  results.historyStates = detail.data.history.map((entry) => entry.toState);

  results.studentDetailDenied = await expectStatus(`/api/workflows/instances/${id}`, request("GET", null, student.token), 403);

  const withdrawn = await send("POST", transitions, { toState: "Withdrawn", reason: "Applicant withdrew" }, admin.token);
  results.withdrawnStatus = withdrawn.data.status;
  results.terminalMoveRejected = await expectStatus(transitions, request("POST", { toState: "Submitted", reason: "Reopen" }, admin.token), 409);

  const restarted = await send("POST", "/api/workflows/instances", {
    definitionCode: "admissions_application", subjectType: "Application", subjectId
  }, admin.token);
  results.restartAfterCompletion = restarted.data.state;

  const failures = [
    results.initialState !== "Draft" && "instances should start in Draft",
    results.allowedFromSubmitted.join(",") !== "Payment verified,Withdrawn" && "unexpected allowed transitions",
    results.historyStates.join(",") !== "Draft,Submitted" && "unexpected workflow history",
    results.withdrawnStatus !== "completed" && "terminal state should complete the instance"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

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
