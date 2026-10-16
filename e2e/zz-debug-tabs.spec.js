import { test, expect } from "@playwright/test";
import fs from "node:fs";

const listenerProbe = () => {
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (this instanceof Element) (this.__svuEvents ||= new Set()).add(type);
    return original.call(this, type, ...rest);
  };
};

test("debug workspace tabs", async ({ page }, info) => {
  test.setTimeout(150_000);
  test.skip(info.project.name !== "desktop");
  const log = [];
  const write = () => fs.writeFileSync(info.outputPath("log.txt"), log.join("\n"));
  page.on("console", (message) => { log.push(`${Date.now() % 100000} ${message.text()}`); write(); });
  page.on("pageerror", (error) => { log.push(`ERROR ${error.message}`); write(); });
  page.on("request", (request) => { if (request.url().includes("/api/")) { log.push(`${Date.now() % 100000} -> ${request.url().replace(/^.*\/api/, "/api")}`); write(); } });
  if (process.env.SVU_DEBUG_PROBE !== "0") await page.addInitScript(listenerProbe);
  await page.addInitScript(() => { setInterval(() => console.log(`beat ${location.hash} busy=${document.querySelector(".registry-workspace fieldset")?.disabled}`), 500); });
  await page.goto("/#signin");
  await page.locator("[data-shell-signin] input[name=email]").fill("admin@southvalley.test");
  await page.locator("[data-shell-signin] input[name=password]").fill("Phase1-Admin-Password-2026!");
  await page.locator("[data-shell-signin] button[type=submit]").click();
  await expect(page).toHaveURL(/#home$/);
  await page.locator('[data-home-area="Examinations"]').click();
  for (const id of ["students", "support", "finance", "teaching", "exams", "documents", "reports", "admin"]) {
    log.push(`${Date.now() % 100000} CLICK ${id}`); write();
    await page.locator(`[data-workspace-tab="${id}"]`).click({ timeout: 20_000 });
    await expect(page.locator(".registry-workspace fieldset")).toBeEnabled({ timeout: 20_000 });
    log.push(`${Date.now() % 100000} DONE ${id}`); write();
  }
});
