const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

// Study-mode codes are free-form, so each run adds its own value.
const valueCode = `SMOKE_${Date.now()}`;
const results = {};

try {
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);

  const lists = await send("GET", "/api/master-data/reference-lists");
  results.lists = lists.data.map((list) => `${list.code}:${list.status}`);

  const disability = await send("GET", "/api/master-data/reference-lists/disability");
  results.disabilityIsRestricted = disability.data.sensitivity === "restricted" && Boolean(disability.data.lawfulPurpose);

  results.studentCreateDenied = await expectStatus(
    "/api/master-data/reference-lists/study_mode/values",
    request("POST", { valueCode, label: "Denied" }, student.token),
    403
  );
  results.badCountryCodeRejected = await expectStatus(
    "/api/master-data/reference-lists/country/values",
    request("POST", { valueCode: "KEN", label: "Kenya" }, admin.token),
    400
  );
  results.currencyWithoutMinorUnitsRejected = await expectStatus(
    "/api/master-data/reference-lists/currency/values",
    request("POST", { valueCode: "BWP", label: "Botswana pula" }, admin.token),
    400
  );
  results.underReviewListRejected = await expectStatus(
    "/api/master-data/reference-lists/religion/values",
    request("POST", { valueCode: "ANY", label: "Any" }, admin.token),
    409
  );
  results.duplicateRejected = await expectStatus(
    "/api/master-data/reference-lists/country/values",
    request("POST", { valueCode: "ZW", label: "Zimbabwe again" }, admin.token),
    409
  );

  const created = await send("POST", "/api/master-data/reference-lists/study_mode/values", {
    valueCode,
    label: "Smoke evening classes",
    sortOrder: 99,
    reason: "Reference data smoke test"
  }, admin.token);
  const valuePath = `/api/master-data/reference-values/${created.data.id}`;

  results.codeChangeRejected = await expectStatus(valuePath, request("PATCH", { valueCode: "OTHER", reason: "Rename code" }, admin.token), 400);
  const relabelled = await send("PATCH", valuePath, { label: "Smoke evening study", reason: "Clearer label" }, admin.token);
  results.relabelled = relabelled.data.label;

  await send("POST", `${valuePath}/retire`, { reason: "Mode discontinued" }, admin.token);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const active = await send("GET", `/api/master-data/reference-lists/study_mode?asOf=${tomorrow}`);
  const all = await send("GET", "/api/master-data/reference-lists/study_mode?includeRetired=true");
  results.hiddenAfterRetirement = !active.data.values.some((value) => value.valueCode === valueCode);
  results.keptInHistory = all.data.values.some((value) => value.valueCode === valueCode && value.status === "retired");

  const restored = await send("POST", `${valuePath}/restore`, { reason: "Mode reinstated" }, admin.token);
  results.restoredStatus = restored.data.status;
  await send("POST", `${valuePath}/retire`, { reason: "Clean up smoke value" }, admin.token);

  const audit = await send("GET", `/api/audit/events?subjectType=ReferenceValue&subjectId=${created.data.id}`, null, admin.token);
  results.auditActions = [...new Set(audit.data.map((event) => event.action))].sort();

  const failures = [
    !results.disabilityIsRestricted && "disability list should be restricted with a lawful purpose",
    !results.hiddenAfterRetirement && "retired value still listed as active",
    !results.keptInHistory && "retired value missing from history",
    results.restoredStatus !== "active" && "value was not restored",
    results.auditActions.length !== 4 && "expected created/updated/retired/restored audit events"
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
