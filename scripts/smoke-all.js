import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Runs every smoke script plus the Phase 1 demo against a running server and reports pass/fail.
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = Object.entries(packageJson.scripts)
  .filter(([name]) => name.startsWith("smoke:") && name !== "smoke:all")
  .map(([name, command]) => ({ name, file: command.replace(/^node\s+/, "") }));
scripts.push({ name: "demo:phase1", file: "scripts/demo-phase1.js" });

const results = [];
for (const script of scripts) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [script.file], { encoding: "utf8", env: process.env });
  results.push({
    name: script.name,
    status: run.status === 0 ? "passed" : "failed",
    durationMs: Date.now() - started,
    ...(run.status === 0 ? {} : { error: (run.stderr || run.stdout).trim().slice(0, 600) })
  });
}

const failed = results.filter((result) => result.status === "failed");
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
