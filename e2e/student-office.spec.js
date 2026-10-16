import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Student Office behaviour checks (Claude, UX-03/04/05 review) complementing student-experience.spec.js:
// failed-write input retention, request tracking groups, partial-load recovery and account switching.
// Runs only on an isolated integration database; the walkthrough provisioner is additive.
const tariro = { email: "active.student@southvalley.test", password: "Active-Student-Demo-2026!" };
const nyasha = { email: "demo.classmate@southvalley.test", password: "Active-Student-Demo-2026!" };

test.beforeAll(({}, info) => {
  info.setTimeout(600_000);
  if (process.env.DATABASE_URL && /^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) {
    execFileSync(process.execPath, ["scripts/seed-walkthrough.js"], { env: process.env, timeout: 540_000, stdio: "pipe" });
  }
});

async function api(method, path, body, token) {
  const response = await fetch(new URL(path, process.env.SVU_BASE_URL || "http://127.0.0.1:4180"), {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload.data ?? payload;
}

async function signIn(page, who) {
  await page.goto("/#signin");
  await page.locator("[data-shell-signin] [name=email]").fill(who.email);
  await page.locator("[data-shell-signin] [name=password]").fill(who.password);
  await page.locator("[data-shell-signin] button[type=submit]").click();
  await expect(page).toHaveURL(/#study\/today/);
}

async function open(page, path, ready) {
  await page.goto(`/#${path}`);
  await expect(page.locator(ready)).toBeVisible();
}

test("student office keeps failed input, tracks requests and recovers partial loads", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await api("POST", "/api/identity/sessions", tariro);
  const me = await api("GET", "/api/registry/me", null, session.token), programme = me.programmes[0];
  const own = `/api/registry/me/programmes/${programme.id}`;
  const account = await api("GET", `${own}/account`, null, session.token);
  await signIn(page, tariro);

  // Fees: the statement lists every ledger entry and offers no payment action.
  await open(page, "office/fees", "[data-finance-hold]");
  await expect(page.locator("[data-ledger-entry]")).toHaveCount(account.entries.length);
  await expect(page.locator("[data-finance-hold]")).toHaveText(account.hold.held ? /Financial hold/ : "No financial hold.");
  await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);

  // My Details: a refused save keeps what the student typed; the retry saves it.
  await open(page, "office/details", '[data-form="student-profile"]');
  const city = `${info.project.name === "desktop" ? "Harare" : "Bulawayo"} ${Date.now() % 1000}`;
  await page.route("**/api/registry/me", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Records service is temporarily unavailable." } }) })
    : route.continue());
  await page.locator('[data-form="student-profile"] [name=city]').fill(city);
  await page.locator('[data-form="student-profile"] button[type=submit]').click();
  await expect(page.locator(".notice")).toContainText("Records service is temporarily unavailable.");
  await expect(page.locator('[data-form="student-profile"] [name=city]')).toHaveValue(city);
  await page.unroute("**/api/registry/me");
  await page.locator('[data-form="student-profile"] button[type=submit]').click();
  await expect(page.locator(".notice")).toContainText("saved");
  expect((await api("GET", "/api/registry/me", null, session.token)).profile.address.city).toBe(city);

  // Identity correction: submitted for registry review, then tracked as an open request (not awaiting the student).
  const identity = await api("GET", "/api/registry/me/identity", null, session.token);
  if (!identity.requests.some((row) => row.status === "requested")) {
    await page.locator(".student-identity summary").filter({ hasText: "Request a correction" }).click();
    const form = page.locator('form[data-form="student-identity"]');
    await form.locator("[name=preferredName]").fill(`Tari ${info.project.name}`);
    await form.locator("[name=evidenceRef]").fill("SYNTHETIC-ID-EVIDENCE");
    await form.locator("[name=reason]").fill("Preferred name update for the walkthrough");
    await form.locator("button[type=submit]").click();
    await expect(page.locator(".notice")).toContainText("Identity correction sent");
  }
  const support = await api("GET", "/api/support/me/cases?offset=0", null, session.token);
  await open(page, "office/requests", "[data-support-student]");
  const filter = (name) => page.locator(".student-filter-links").getByRole("link", { name, exact: true });
  const identityRow = page.locator(".student-update").filter({ hasText: "Identity correction" });
  await expect(identityRow).toHaveCount(1);
  await expect(identityRow).toContainText("requested");
  await expect(page.locator(".student-update").filter({ hasText: "Support case" })).toHaveCount(support.items.length);
  await filter("Completed").click();
  await expect(page).toHaveURL(/filter=completed/);
  await expect(page.locator(".student-update").filter({ hasText: "Identity correction" })).toHaveCount(0);
  await filter("Awaiting you").click();
  await expect(page.locator(".student-update").filter({ hasText: "Identity correction" })).toHaveCount(0);
  await filter("Open").click();
  await expect(page.locator(".student-update").filter({ hasText: "Identity correction" })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`office-requests-${info.project.name}.png`), fullPage: true });

  // A failed module stays visible beside the data that did load, and retry recovers it.
  await page.route(`**${own}/account`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "Ledger unavailable" } }) }));
  await open(page, "office/overview", ".student-load-errors");
  await expect(page.locator(".student-load-errors")).toContainText("Ledger unavailable");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.unroute(`**${own}/account`);
  await page.locator("[data-student-retry]").click();
  await expect(page.locator(".student-load-errors")).toHaveCount(0);

  // Switching accounts drops the previous student's unsaved input and notices.
  await open(page, "office/details", '[data-form="student-profile"]');
  await page.locator('[data-form="student-profile"] [name=line1]').fill("Unsaved private address 99");
  await page.evaluate(() => window.svuSession.signOut());
  await signIn(page, nyasha);
  await open(page, "office/details", '[data-form="student-profile"]');
  await expect(page.locator('[data-form="student-profile"] [name=line1]')).not.toHaveValue("Unsaved private address 99");
  await expect(page.locator(".student-context")).not.toContainText(me.studentNumber);
  await page.evaluate(() => window.svuSession.signOut());
  expect(errors).toEqual([]);
});
