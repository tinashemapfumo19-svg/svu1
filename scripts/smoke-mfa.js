import { totp } from "../server/security.js";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const credentials = {
  email: `mfa.smoke.${Date.now()}@southvalley.test`,
  password: "Authenticator-Smoke-Pass-2026!"
};
const results = {};

try {
  const admin = await login(adminCredentials);
  const invitation = await send("POST", "/api/identity/invitations", { email: credentials.email, roleCode: "auditor" }, admin.token);
  await send("POST", "/api/identity/activations", {
    token: invitation.data.activationToken,
    password: credentials.password,
    preferredName: "MFA",
    legalName: "MFA Smoke"
  });

  const first = await login(credentials);
  results.loginBeforeEnrolment = first.status;

  const enrolment = await send("POST", "/api/identity/mfa/totp", {}, first.token);
  const secret = enrolment.data.secret;
  results.otpauthUri = enrolment.data.otpauthUri.startsWith("otpauth://totp/");
  results.wrongEnrolmentCodeRejected = await expectStatus("/api/identity/mfa/totp/confirm", request("POST", { code: "000000" }, first.token), 400);

  const confirmedAt = Date.now();
  const confirmed = await send("POST", "/api/identity/mfa/totp/confirm", { code: totp(secret, confirmedAt) }, first.token);
  const recoveryCodes = confirmed.data.recoveryCodes;
  results.recoveryCodesIssued = recoveryCodes.length;

  const me = await send("GET", "/api/identity/me", null, first.token);
  results.enrolledAssurance = me.data.assurance;
  results.mfaEnrolled = me.data.mfa.enrolled;
  results.secondEnrolmentRejected = await expectStatus("/api/identity/mfa/totp", request("POST", {}, first.token), 409);

  const pending = await login(credentials);
  results.loginAfterEnrolment = pending.status;
  results.nextStep = pending.nextStep;
  results.pendingTokenRefused = await expectStatus("/api/identity/me", request("GET", null, pending.token), 401);
  results.replayedCodeRejected = await expectStatus(
    "/api/identity/sessions/current/mfa",
    request("POST", { code: totp(secret, confirmedAt) }, pending.token),
    400
  );
  // The next time step is inside the allowed drift window and has not been used yet.
  const verified = await send("POST", "/api/identity/sessions/current/mfa", { code: totp(secret, confirmedAt + 30_000) }, pending.token);
  results.verifiedStatus = verified.data.status;
  results.meAfterVerify = await expectStatus("/api/identity/me", request("GET", null, pending.token), 200);

  const viaRecovery = await login(credentials);
  const recovered = await send("POST", "/api/identity/sessions/current/mfa", { recoveryCode: recoveryCodes[0] }, viaRecovery.token);
  results.recoveryCodesRemaining = recovered.data.recoveryCodesRemaining;
  const reuse = await login(credentials);
  results.recoveryCodeReuseRejected = await expectStatus(
    "/api/identity/sessions/current/mfa",
    request("POST", { recoveryCode: recoveryCodes[0] }, reuse.token),
    400
  );

  const lockout = await login(credentials);
  const wrongStatuses = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/identity/sessions/current/mfa`, request("POST", { code: "999999" }, lockout.token));
    wrongStatuses.push(response.status);
  }
  results.lockoutStatuses = wrongStatuses;
  results.lockedSessionRefused = await expectStatus(
    "/api/identity/sessions/current/mfa",
    request("POST", { recoveryCode: recoveryCodes[1] }, lockout.token),
    401
  );

  const cancelling = await login(credentials);
  const sibling = await login(credentials);
  results.pendingCannotRevokeOtherSession = await expectStatus(
    `/api/identity/sessions/${sibling.id}`,
    request("DELETE", null, cancelling.token),
    404
  );
  results.pendingCanCancelItself = await expectStatus(
    `/api/identity/sessions/${cancelling.id}`,
    request("DELETE", null, cancelling.token),
    200
  );

  results.resetWithoutReasonRejected = await expectStatus(
    `/api/identity/accounts/${me.data.account.id}/mfa/reset`,
    request("POST", {}, admin.token),
    400
  );
  const reset = await send("POST", `/api/identity/accounts/${me.data.account.id}/mfa/reset`, { reason: "Lost phone; identity verified at service desk" }, admin.token);
  results.resetRevokedSessions = reset.data.revokedSessions;
  results.enrolledSessionRevoked = await expectStatus("/api/identity/me", request("GET", null, first.token), 401);
  const afterReset = await login(credentials);
  results.loginAfterReset = afterReset.status;

  const failures = [
    results.loginBeforeEnrolment !== "active" && "unenrolled login should be active under the development policy",
    results.recoveryCodesIssued !== 10 && "expected 10 recovery codes",
    results.enrolledAssurance !== "mfa" && "enrolment should upgrade the session to mfa assurance",
    results.loginAfterEnrolment !== "mfa_pending" && "enrolled login should wait for a code",
    results.verifiedStatus !== "active" && "verification should activate the session",
    results.recoveryCodesRemaining !== 9 && "recovery code was not consumed",
    results.lockoutStatuses.join(",") !== "400,400,400,400,401" && "five bad codes should end the sign-in",
    results.loginAfterReset !== "active" && "reset should remove the MFA requirement"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function login(loginCredentials) {
  const response = await send("POST", "/api/identity/sessions", loginCredentials);
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
