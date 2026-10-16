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
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);
  const otherAdminSession = await login(adminCredentials);

  results.studentRevokeOthersDenied = await expectStatus(
    `/api/identity/sessions/${otherAdminSession.id}`,
    request("DELETE", null, student.token),
    404
  );
  results.otherSessionStillValid = await expectStatus("/api/audit/events?limit=1", request("GET", null, otherAdminSession.token), 200);

  results.ownLogout = await expectStatus(`/api/identity/sessions/${student.id}`, request("DELETE", null, student.token), 200);
  results.revokedTokenRejected = await expectStatus(
    `/api/identity/sessions/${student.id}`,
    request("DELETE", null, student.token),
    401
  );

  results.adminRevokesOther = await expectStatus(
    `/api/identity/sessions/${otherAdminSession.id}`,
    request("DELETE", null, admin.token),
    200
  );

  const invitation = await send("POST", "/api/identity/invitations", {
    email: `session.smoke.${Date.now()}@southvalley.test`,
    roleCode: "auditor",
    reason: "Session smoke test"
  }, admin.token);
  const activation = {
    token: invitation.data.activationToken,
    password: "Session-Smoke-Password-2026!",
    preferredName: "Session",
    legalName: "Session Smoke"
  };
  await send("POST", "/api/identity/activations", activation);
  results.activationReplayRejected = await expectStatus("/api/identity/activations", request("POST", activation), 400);
  results.garbageTokenRejected = await expectStatus("/api/audit/events", request("GET", null, "not-a-real-token"), 401);

  // Authentication is one indexed lookup now, so 20 sequential calls should take well under a second.
  const started = Date.now();
  for (let index = 0; index < 20; index += 1) {
    await send("GET", "/api/audit/events?limit=1", null, admin.token);
  }
  results.twentyAuthenticatedCallsMs = Date.now() - started;

  if (results.twentyAuthenticatedCallsMs > 5000) {
    throw new Error(`Authenticated calls are too slow: ${JSON.stringify(results, null, 2)}`);
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
