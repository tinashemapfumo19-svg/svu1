import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { loadConfig } from "../server/config.js";
import { createPool } from "../server/db.js";
import { createRepository } from "../server/repository.js";
import { createRouter } from "../server/router.js";
import { createLogger } from "../server/logger.js";
import { createLocalStorage } from "../server/storage.js";
import { totp } from "../server/security.js";

for (const persona of ["staff", "applicant", "registry"]) {
test(`${persona} MFA enrolment, cancellation, verification, and single-use recovery`, async ({ page, request }, testInfo) => {
  const staff = persona === "staff";
  const registry = persona === "registry";
  const signInForm = registry ? "registry-signin" : staff ? "staff-signin" : "signin";
  const mfaForm = registry ? "registry-mfa" : staff ? "staff-mfa" : "mfa";
  const signout = registry ? "[data-registry-signout]" : staff ? "[data-staff-signout]" : "[data-signout]";
  const storageKey = registry ? "svu.registry.session" : staff ? "svu.staff.session" : "svu.applicant.session";
  const verifiedMessage = staff ? "MFA verified. Loading review queue." : "MFA verified.";
  const admin = await send(request, "POST", "/api/identity/sessions", {
    email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!"
  });
  const email = `browser.mfa.${persona}.${testInfo.project.name}.${Date.now()}@example.com`;
  const password = "Browser-MFA-Password-2026!";
  const invitation = await send(request, "POST", "/api/identity/invitations", {
    email, roleCode: "system_administrator"
  }, admin.token);
  await send(request, "POST", "/api/identity/activations", {
    token: invitation.activationToken, password, preferredName: "MFA", legalName: "Browser MFA Pilot"
  });

  // Exercise mandatory enrolment with the real router and policy on an ephemeral port.
  if (persona === "applicant") {
    const accountSession = await send(request, "POST", "/api/identity/sessions", { email, password });
    await send(request, "POST", "/api/access/role-assignments", { accountId: accountSession.account.id, roleCode: "applicant", reason: "Applicant MFA browser coverage" }, admin.token);
  }
  const config = loadConfig({ ...process.env, SVU_MFA_POLICY: "privileged" });
  const pool = createPool(config);
  const repository = createRepository(pool, {
    devOutboxDir: config.devOutboxDir, dataEncryptionKey: config.dataEncryptionKey,
    mfaPolicy: config.mfaPolicy, storage: createLocalStorage(config.devStorageDir)
  });
  const server = createServer(createRouter({ rootDir: process.cwd(), config, repository, logger: createLogger(config) }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${baseUrl}/#${registry ? "registry" : staff ? "admissions" : "apply"}`);
    await signIn();
    await expect(page.locator(`[data-form="${mfaForm}"]`)).toContainText("MFA enrolment required");
    await cancel();
    await signIn();
    const secret = await page.locator(`[data-form="${mfaForm}"] .notice p`).last().innerText();
    await submitMfa({ code: "invalid" });
    await expect(page.getByRole("status")).toContainText("code");
    const confirmedAt = Date.now();
    await submitMfa({ code: totp(secret, confirmedAt) });
    await expect(page.getByRole("status")).toHaveText("MFA enrolled. Store 10 recovery code(s) securely.");
    const recoveryCodes = (await page.locator(".notice").filter({ has: page.getByText("Recovery codes", { exact: true }) }).locator("p").innerText()).split(/\s+/);
    expect(recoveryCodes).toHaveLength(10);
    await expect(page.locator(signout)).toBeVisible();
    await page.locator(signout).click();
    await signIn();
    await expect(page.locator(`[data-form="${mfaForm}"]`)).toContainText("MFA verification required");
    await cancel();
    await signIn();
    await submitMfa({ code: totp(secret, confirmedAt + 30_000) });
    await expect(page.getByRole("status")).toHaveText(verifiedMessage);
    await page.locator(signout).click();
    await signIn();
    await submitMfa({ recoveryCode: recoveryCodes[0] });
    await expect(page.getByRole("status")).toHaveText(verifiedMessage);
    const session = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), storageKey);
    const me = await send(request, "GET", `${baseUrl}/api/identity/me`, undefined, session.token);
    expect(me.mfa.recoveryCodesRemaining).toBe(9);
    await page.locator(signout).click();
    await signIn();
    await submitMfa({ recoveryCode: recoveryCodes[0] });
    await expect(page.getByRole("status")).toHaveText("That code is not valid.");
    await expect(page.locator(`[data-form="${mfaForm}"]`)).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
    await cancel();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }

  async function signIn() {
    const form = page.locator(`[data-form="${signInForm}"]`);
    await form.locator('[name="email"]').fill(email);
    await form.locator('[name="password"]').fill(password);
    if (staff) await page.evaluate(() => window.renderAdmissions());
    if (persona === "applicant") await page.evaluate(() => window.renderApply(document.querySelector("#app")));
    await expect(form.locator('[name="email"]')).toHaveValue(email);
    await expect(form.locator('[name="password"]')).toHaveValue(password);
    await form.locator('[type="submit"]').click();
    await expect(page.locator(`[data-form="${mfaForm}"]`)).toBeVisible();
  }

  async function submitMfa(values) {
    const form = page.locator(`[data-form="${mfaForm}"]`);
    await form.locator('[name="code"]').fill(values.code || "");
    if (await form.locator('[name="recoveryCode"]').count()) await form.locator('[name="recoveryCode"]').fill(values.recoveryCode || "");
    await form.locator('[type="submit"]').click();
  }

  async function cancel() {
    const revoked = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/identity/sessions/"));
    await page.locator(registry ? "[data-registry-cancel]" : staff ? "[data-staff-cancel-mfa]" : "[data-cancel-mfa]").click();
    const response = await revoked;
    expect(response.ok()).toBeTruthy();
    await expect(page.getByRole("status")).toHaveText("MFA sign-in cancelled.");
    await expect(page.locator(`[data-form="${signInForm}"]`)).toBeVisible();
    const refused = await request.get(`${new URL(response.url()).origin}/api/identity/me`, {
      headers: { Authorization: response.request().headers().authorization }
    });
    expect(refused.status()).toBe(401);
  }
});
}

async function send(request, method, path, data, token) {
  const response = await request.fetch(path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
