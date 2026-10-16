import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: process.env.SVU_BASE_URL || "http://127.0.0.1:4180",
    browserName: "chromium",
    ...(process.env.SVU_BROWSER_CHANNEL ? { channel: process.env.SVU_BROWSER_CHANNEL } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
