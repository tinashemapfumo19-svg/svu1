const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const targetCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const results = {};

try {
  const admin = await login(adminCredentials);
  const target = await login(targetCredentials);

  const beforeSessions = await get(`/api/identity/accounts/${target.account.id}/sessions`, admin.token);
  results.sessionsBeforeSuspend = beforeSessions.data.length;

  const suspended = await post(
    `/api/identity/accounts/${target.account.id}/suspend`,
    { reason: "Identity admin smoke suspension" },
    admin.token
  );
  results.suspendedStatus = suspended.data.status;
  results.revokedSessions = suspended.data.revokedSessions.length;

  results.loginDeniedWhileSuspended = await expectStatus(
    "/api/identity/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetCredentials)
    },
    401
  );

  const reactivated = await post(
    `/api/identity/accounts/${target.account.id}/reactivate`,
    { reason: "Identity admin smoke reactivation" },
    admin.token
  );
  results.reactivatedStatus = reactivated.data.status;

  const restoredLogin = await login(targetCredentials);
  results.restoredLoginAccount = restoredLogin.account.id;

  const audit = await get("/api/audit/events", admin.token);
  const actions = audit.data.map((event) => event.action);
  for (const action of ["identity.account.suspended", "identity.account.reactivated"]) {
    if (!actions.includes(action)) {
      throw new Error(`Missing audit action: ${action}`);
    }
  }
  results.auditActionsVerified = ["identity.account.suspended", "identity.account.reactivated"];

  console.log(JSON.stringify(results, null, 2));
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
