import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { totp } from "../server/security.js";

// Records which elements received event listeners, so the audit can find buttons that do nothing.
const listenerProbe = () => {
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (this instanceof Element) (this.__svuEvents ||= new Set()).add(type);
    return original.call(this, type, ...rest);
  };
};
// Visible, enabled buttons with no click handler of their own (or on a wrapper inside the page),
// and submit buttons whose form has no submit handler.
const findDeadButtons = () => Array.from(document.querySelectorAll("button, [role=button], input[type=submit]")).filter((button) => {
  if (button.disabled || button.closest("fieldset[disabled]") || !button.getClientRects().length) return false;
  const hasHandler = (node, type) => { for (let n = node; n && n !== document.body; n = n.parentElement) if (n.__svuEvents?.has(type) || n.getAttribute?.(`on${type}`)) return true; return false; };
  if (hasHandler(button, "click")) return false;
  const form = button.form;
  if ((button.type || "submit") === "submit" && form && (form.__svuEvents?.has("submit") || hasHandler(form, "submit"))) return false;
  return true;
}).map((button) => `${button.textContent.trim().replace(/\s+/g, " ").slice(0, 60) || button.getAttribute("aria-label") || button.outerHTML.slice(0, 80)} @ ${location.hash}`);

test("one sign-in drives role-aware navigation, real dashboards, workspace screens and account settings", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const stamp = `${info.project.name}.${Date.now()}`;
  const mobile = info.project.name === "mobile";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const trail = [];const keep = (text) => { trail.push(`${Date.now() % 1000000} ${text}`); writeFileSync(info.outputPath("trail.txt"), trail.join("\n")); };
  page.on("crash", () => keep("CRASH"));page.on("close", () => keep("CLOSE"));page.on("console", (m) => keep(m.text()));page.on("request", (r) => { if (r.url().includes("/api/")) keep("-> " + r.url().replace(/^.*\/api/, "/api")); });
  await page.addInitScript(() => setInterval(() => console.log("beat " + location.hash), 400));
  await page.addInitScript(listenerProbe);
  const dead = new Set();
  const audit = async () => { await page.waitForTimeout(150); for (const row of await page.evaluate(findDeadButtons)) dead.add(row); };
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  const openMenu = async () => {
    if (mobile) { await page.locator(".mobile-nav a[data-route=settings]").click(); return; }
    await page.locator("[data-profile-toggle]").click();
  };

  // Signed out: a public landing page with working entry points, and protected screens send people to sign in.
  await page.goto("/");
  await expect(page).toHaveURL(/#signin$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("login-screen.png"), fullPage: true });
  await page.goto('/#home');
  await expect(page.getByRole("heading", { name: /Apply, study and manage/ })).toBeVisible();
  const nav = mobile ? page.locator(".mobile-nav") : page.locator(".nav-links");
  await expect(nav.locator("a")).toHaveText(mobile ? ["Home", "Apply", "Verify", "Resources", "Sign in"] : ["Home", "Apply", "Verify a document", "Resources"]);
  await audit();
  await page.locator("[data-home-verify] input[name=code]").fill("NOT-A-REAL-CODE");
  await page.locator("[data-home-verify] button").click();
  await expect(page).toHaveURL(/#verify\/NOT-A-REAL-CODE$/);
  await expect(page.getByRole("heading", { name: "Verify a transcript, certificate or letter" })).toBeVisible();
  await page.goto("/#settings");
  await expect(page).toHaveURL(/#signin\?next=settings$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await audit();
  await page.locator("[data-signin-step=recover]").click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.locator("[data-signin-step=password]").click();

  const applicant = await account(`shell.${stamp}@example.com`);

  // Staff sign in once and land where they were going; the shell shows only their areas.
  await page.locator("[data-shell-signin] input[name=email]").fill("admin@southvalley.test");
  await page.locator("[data-shell-signin] input[name=password]").fill("Phase1-Admin-Password-2026!");
  await page.locator("[data-shell-signin] button[type=submit]").click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("[data-settings-profile]")).toContainText("admin@southvalley.test");
  await page.goto("/#home");
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), SVU System Administrator\.$/ })).toBeVisible();
  for (const label of ["Admissions", "Students", "Support", "Finance", "Teaching", "Examinations", "Documents", "Reports", "People & systems", "Resources"]) await expect(page.locator(`[data-home-area="${label}"]`)).toBeVisible();
  await expect(page.locator("[data-home-mfa]")).toBeVisible();
  await audit();
  await noOverflow();
  await page.screenshot({ path: info.outputPath("staff-home.png"), fullPage: true });
  if (!mobile) {
    // Sysadmin is a superset of every staff level (migration 119), so it also sees shared records and teaching.
    await expect(page.locator(".nav-links a")).toHaveText(["Home", "Shared records", "My teaching", "Admissions", "Workspace", "Resources", "Inbox"]);
    await page.locator("#shell-search").fill("nobody-matches-this");
    await page.locator("#shell-search").press("Enter");
    await expect(page).toHaveURL(/#registry\/students$/);
    await expect(page.locator("[data-registry-filter] input[name=q]")).toHaveValue("nobody-matches-this");
    await expect(page.locator("[data-registry-count]")).toHaveText("0 programme records");
  }

  // Each workspace area is its own screen, reached from the area tabs.
  await page.locator('[data-home-area="Examinations"]').or(page.locator('[data-workspace-tab="exams"]')).first().click();
  await expect(page).toHaveURL(/#registry\/exams$/);
  for (const [id, label] of [["students", "Students"], ["support", "Support"], ["finance", "Finance"], ["teaching", "Teaching"], ["exams", "Examinations"], ["documents", "Documents"], ["reports", "Reports"], ["admin", "People & systems"]]) {
    await page.locator(`[data-workspace-tab="${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#registry/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
    await expect(page.locator(`[data-workspace-tab="${id}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".registry-workspace > fieldset.review-controls")).toBeEnabled();
    await audit();
    await noOverflow();
  }
  await page.goto("/#registry");
  await expect(page).toHaveURL(/#registry\/students$/);
  // System administration: find an account, grant and end a role, and refuse changes to your own access.
  await page.goto("/#foundation");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("System");
  await page.locator("[data-system-account-filter] [name=q]").fill(applicant.email);
  await page.locator("[data-system-account-filter] button[type=submit]").click();
  await expect(page.locator("[data-system-account-count]")).toHaveText("1 account");
  await page.locator(`[data-system-account="${applicant.id}"]`).click();
  await expect(page.locator("[data-system-account-detail] h2")).toHaveText(`Shell Person shell.${stamp}`);
  await page.locator("[data-system-account-detail] details > summary").click();
  await page.locator("[data-system-grant-role] [name=roleCode]").selectOption("legacy_reports");
  await page.locator("[data-system-grant-role] [name=reason]").fill("Temporary audit cover");
  await page.locator("[data-system-grant-role] button[type=submit]").click();
  await expect(page.locator(".notice-success")).toHaveText("Role granted.");
  const auditorRow = page.locator("[data-system-roles] li").filter({ hasText: "Reports Access Only" });
  await expect(auditorRow).toContainText("All programmes");
  await audit();
  await auditorRow.locator("[name=reason]").fill("Cover finished");
  await auditorRow.locator("button[type=submit]").click();
  await expect(page.locator(".notice-success")).toHaveText("Role ended.");
  await expect(page.locator("[data-system-roles] li").filter({ hasText: "Reports Access Only" })).toHaveCount(0);
  expect((await api("GET", "/api/identity/me", undefined, applicant.token)).permissions).not.toContain("audit.view");
  const adminSession = await admin(), adminId = (await api("GET", "/api/identity/me", undefined, adminSession.token)).account.id;
  for (const [path, body] of [["/api/access/role-assignments", { accountId: adminId, roleCode: "legacy_reports", reason: "Self grant" }], [`/api/identity/accounts/${adminId}/suspend`, { reason: "Self" }], [`/api/identity/accounts/${adminId}/mfa/reset`, { reason: "Self" }]]) {
    expect((await raw("POST", path, body, adminSession.token)).status()).toBe(403);
  }
  await page.locator("[data-system-account-filter] [name=q]").fill("admin@southvalley.test");
  await page.locator("[data-system-account-filter] button[type=submit]").click();
  await page.locator(`[data-system-account="${adminId}"]`).click();
  await expect(page.locator("[data-system-account-detail] .notice")).toContainText("This is your account");
  await expect(page.locator("[data-system-end-role]")).toHaveCount(0);
  await page.locator("[data-system-tab=audit]").click();
  await page.locator("[data-system-audit-filter] [name=action]").fill("access.role_assignment.ended");
  await page.locator("[data-system-audit-filter] button[type=submit]").click();
  await expect(page.locator("[data-system-audit] tbody tr").first()).toContainText("Cover finished");
  await audit();
  await page.locator("[data-system-tab=health]").click();
  await expect(page.locator("[data-system-health]")).toContainText("ok");
  await audit();
  await noOverflow();
  for (const route of ["admissions", "resources", "messages", "learning"]) {
    await page.goto(`/#${route}`);
    await page.waitForLoadState("networkidle");
    await audit();
  }
  await expect(page.getByRole("heading", { name: "My teaching" })).toBeVisible();

  // Signing out anywhere signs out of the whole app.
  if (mobile) { await page.goto("/#settings"); await page.locator("[data-settings-signout]").click(); }
  else { await page.locator("[data-profile-toggle]").click(); await audit(); await page.getByRole("menuitem", { name: "Sign out" }).click(); }
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByRole("heading", { name: /Apply, study and manage/ })).toBeVisible();
  expect(await page.evaluate(() => ["svu.registry.session", "svu.staff.session", "svu.applicant.session"].map((key) => sessionStorage.getItem(key)))).toEqual([null, null, null]);
  await page.goto("/#registry");
  await expect(page.locator("[data-registry-login]")).toBeVisible();

  // An applicant gets their own home and can manage password, devices and two-step verification.
  await page.goto("/#signin");
  await page.locator("[data-shell-signin] input[name=email]").fill(applicant.email);
  await page.locator("[data-shell-signin] input[name=password]").fill(applicant.password);
  await page.locator("[data-shell-signin] button[type=submit]").click();
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator(".dashboard-head .eyebrow")).toHaveText("Applicant home");
  await expect(page.getByRole("heading", { name: "Start your application" })).toBeVisible();
  await expect(nav.locator("a").filter({ hasText: /^(My application|Application)$/ })).toBeVisible();
  await expect(nav.locator("a").filter({ hasText: /^Workspace$/ })).toHaveCount(0);
  await audit();
  await openMenu();
  if (!mobile) await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("[data-mfa-status]")).toHaveAttribute("data-mfa-status", "off");
  await audit();

  const form = page.locator("[data-settings-password-form]");
  await form.locator("[name=currentPassword]").fill("Wrong-Password-2026!x");
  await form.locator("[name=newPassword]").fill("Kariba-Dam-Changed-2026!");
  await form.locator("[name=confirmPassword]").fill("Kariba-Dam-Changed-2026!");
  await form.locator("button[type=submit]").click();
  await expect(page.locator(".notice-error")).toHaveText("Current password is incorrect.");
  await form.locator("[name=currentPassword]").fill(applicant.password);
  await form.locator("[name=newPassword]").fill("Kariba-Dam-Changed-2026!");
  await form.locator("[name=confirmPassword]").fill("Kariba-Dam-Changed-2026!x");
  await form.locator("button[type=submit]").click();
  await expect(page.locator(".notice-error")).toHaveText("The new passwords do not match.");
  await form.locator("[name=currentPassword]").fill(applicant.password);
  await form.locator("[name=newPassword]").fill("Kariba-Dam-Changed-2026!");
  await form.locator("[name=confirmPassword]").fill("Kariba-Dam-Changed-2026!");
  await form.locator("button[type=submit]").click();
  await expect(page.locator(".notice-success")).toHaveText("Password changed. Signed out 1 other session.");
  expect((await raw("GET", "/api/identity/me", undefined, applicant.token)).status()).toBe(401);
  applicant.password = "Kariba-Dam-Changed-2026!";

  const other = await api("POST", "/api/identity/sessions", { email: applicant.email, password: applicant.password });
  await page.reload();
  await expect(page.locator("[data-settings-sessions] li")).toHaveCount(2);
  await page.locator("[data-settings-revoke-others]").click();
  await expect(page.locator(".notice-success")).toHaveText("Signed out 1 other session.");
  await expect(page.locator("[data-settings-sessions] li")).toHaveCount(1);
  expect((await raw("GET", "/api/identity/me", undefined, other.token)).status()).toBe(401);

  await page.locator("[data-settings-mfa-start]").click();
  const secret = (await page.locator("[data-mfa-secret]").textContent()).trim();
  await page.locator("[data-settings-mfa-confirm] [name=code]").fill(totp(secret));
  await page.locator("[data-settings-mfa-confirm] button[type=submit]").click();
  await expect(page.locator(".recovery-codes li")).toHaveCount(10);
  const recoveryCode = (await page.locator(".recovery-codes code").first().textContent()).trim();
  await page.locator("[data-settings-codes-done]").click();
  await expect(page.locator("[data-mfa-status]")).toHaveAttribute("data-mfa-status", "on");
  await noOverflow();
  await page.screenshot({ path: info.outputPath("settings.png"), fullPage: true });

  // The next sign-in asks for the second step.
  await page.locator("[data-settings-signout]").click();
  await expect(page).toHaveURL(/#home$/);
  await page.goto("/#signin?next=settings");
  await page.locator("[data-shell-signin] input[name=email]").fill(applicant.email);
  await page.locator("[data-shell-signin] input[name=password]").fill(applicant.password);
  await page.locator("[data-shell-signin] button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await audit();
  await page.locator("[data-shell-mfa] [name=recoveryCode]").fill(recoveryCode);
  await page.locator("[data-shell-mfa] button[type=submit]").click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("[data-settings-mfa]")).toContainText("9 recovery codes left");
  const events = (await api("GET", `/api/audit/events?subjectId=${applicant.id}`, undefined, (await admin()).token)).map((row) => row.action);
  expect(events).toEqual(expect.arrayContaining(["identity.password.change_failed", "identity.password.changed", "identity.sessions.revoked_others"]));

  expect([...dead]).toEqual([]);
  expect(errors).toEqual([]);

  async function raw(method, path, body, token) {
    return request.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data: body });
  }
  async function api(method, path, body, token) {
    const response = await raw(method, path, body, token);
    const payload = await response.json();
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${JSON.stringify(payload)}`);
    return payload.data;
  }
  async function admin() { return api("POST", "/api/identity/sessions", { email: "admin@southvalley.test", password: "Phase1-Admin-Password-2026!" }); }
  async function outboxToken(email) {
    const messages = await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).map(async (file) => JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX, file), "utf8"))));
    return messages.find((row) => row.recipientEmail === email).variables.activationToken;
  }
  async function account(email) {
    const password = "Kariba-Dam-Applicant-2026!", legalName = `Shell Person ${email.split("@")[0]}`;
    await api("POST", "/api/admissions/registrations", { email, preferredName: "Shell", legalName });
    await api("POST", "/api/identity/activations", { token: await outboxToken(email), password, preferredName: "Shell", legalName });
    const session = await api("POST", "/api/identity/sessions", { email, password }), me = await api("GET", "/api/identity/me", undefined, session.token);
    return { email, password, token: session.token, id: me.account.id };
  }
});
