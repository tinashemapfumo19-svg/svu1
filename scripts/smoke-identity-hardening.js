import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const outboxDir = process.env.SVU_DEV_OUTBOX || "data/dev-outbox";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const runId = Date.now();
const email = `hardening.${runId}@southvalley.test`;
const originalPassword = "Hardening-Original-Pass-2026!";
const newPassword = "Hardening-Replaced-Pass-2026!";
const results = {};

try {
  const admin = await login(adminCredentials);
  const invitation = await send("POST", "/api/identity/invitations", { email, roleCode: "auditor" }, admin.token);
  const activation = { token: invitation.data.activationToken, preferredName: "Hard", legalName: "Hardening Smoke" };

  results.weakPasswordRejected = await expectStatus("/api/identity/activations", request("POST", { ...activation, password: "short" }), 400);
  await send("POST", "/api/identity/activations", { ...activation, password: originalPassword });

  const user = await login({ email: email.toUpperCase(), password: originalPassword });
  const me = await send("GET", "/api/identity/me", null, user.token);
  results.meEmail = me.data.account.email;
  results.mePermissions = me.data.permissions;
  results.caseInsensitiveLogin = true;
  results.invitedRoleGranted = me.data.roles.some((role) => role.code === "auditor");

  // Five failures trip the throttle; even the right password is then refused until the window passes.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectStatus("/api/identity/sessions", request("POST", { email, password: "wrong-password-attempt" }), 401);
  }
  results.throttledAfterFailures = await expectStatus("/api/identity/sessions", request("POST", { email, password: originalPassword }), 429);

  const ghost = `ghost.${runId}@southvalley.test`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectStatus("/api/identity/sessions", request("POST", { email: ghost, password: "wrong-password-attempt" }), 401);
  }
  results.unknownEmailThrottledIdentically = await expectStatus("/api/identity/sessions", request("POST", { email: ghost, password: "x" }), 429);

  const ghostRecovery = await send("POST", "/api/identity/recovery-requests", { email: ghost });
  const realRecovery = await send("POST", "/api/identity/recovery-requests", { email });
  results.recoveryResponsesIdentical = ghostRecovery.data.message === realRecovery.data.message;

  const message = await latestOutboxMessage(me.data.account.id);
  const recoveryToken = message.variables.recoveryToken;
  results.outboxDelivered = Boolean(recoveryToken);

  const queue = await send("GET", `/api/notifications?recipientAccountId=${me.data.account.id}`, null, admin.token);
  const queued = queue.data.find((notification) => notification.id === message.notificationId);
  results.queueRedacted = Boolean(queued) && !JSON.stringify(queued).includes(recoveryToken);

  results.weakResetRejected = await expectStatus(
    "/api/identity/recovery-confirmations",
    request("POST", { token: recoveryToken, password: "tooshort" }),
    400
  );
  const reset = await send("POST", "/api/identity/recovery-confirmations", { token: recoveryToken, password: newPassword });
  results.revokedSessions = reset.data.revokedSessions;
  results.oldSessionRejected = await expectStatus("/api/identity/me", request("GET", null, user.token), 401);
  results.tokenReplayRejected = await expectStatus(
    "/api/identity/recovery-confirmations",
    request("POST", { token: recoveryToken, password: "Another-Valid-Pass-2026!" }),
    400
  );

  const afterReset = await login({ email, password: newPassword });
  results.loginAfterResetClearsThrottle = Boolean(afterReset.token);
  results.oldPasswordRejected = await expectStatus("/api/identity/sessions", request("POST", { email, password: originalPassword }), 401);

  const failures = [
    results.meEmail !== email && "me returned the wrong account",
    !results.invitedRoleGranted && "activation did not grant the invited role",
    !results.recoveryResponsesIdentical && "recovery responses differ between real and unknown emails",
    !results.queueRedacted && "notification queue exposes the recovery code",
    results.revokedSessions < 1 && "reset did not revoke existing sessions"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function latestOutboxMessage(accountId) {
  const files = await readdir(outboxDir);
  const messages = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(outboxDir, file), "utf8"))));
  const mine = messages
    .filter((message) => message.accountId === accountId && message.templateCode === "identity.password_recovery")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  if (mine.length === 0) {
    throw new Error(`No recovery message for ${accountId} in ${outboxDir}; is the server running with SVU_ENV=development?`);
  }
  return mine.at(-1);
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
