import { spawn, spawnSync } from "node:child_process";
import { openSync } from "node:fs";
import { rm } from "node:fs/promises";
import pg from "pg";
import { loadConfig } from "../server/config.js";
import { captureIntegrationSources, compareIntegrationSources } from './integration-sources.js';

// One-command, isolated integration run: fresh database -> migrate -> seed -> server on its own port
// -> unit tests + browser journeys + every smoke script -> teardown.

const base = new URL(loadConfig().databaseUrl);
const databaseName = `svu_rebuild_it_${Date.now()}`;
const testUrl = new URL(base);
testUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(base);
adminUrl.pathname = "/postgres";
const port = process.env.SVU_INTEGRATION_PORT || "4180";
const scratch = { outbox: `data/${databaseName}-outbox`, storage: `data/${databaseName}-storage` };
const browserOnly = process.argv.includes("--browser");
const argumentSeparator = process.argv.indexOf("--");
const browserArgs = argumentSeparator < 0 ? [] : process.argv.slice(argumentSeparator + 1);
const testConcurrency=process.env.SVU_TEST_CONCURRENCY;
if(testConcurrency !== undefined && (!/^\d+$/.test(testConcurrency) || Number(testConcurrency) < 1 || Number(testConcurrency) > 32))throw new Error('SVU_TEST_CONCURRENCY must be an integer from 1 through 32.');

const env = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  SVU_ENV: "development",
  SVU_MFA_POLICY: "enrolled",
  SVU_HOST: "127.0.0.1",
  SVU_PORT: port,
  SVU_BASE_URL: `http://127.0.0.1:${port}`,
  SVU_TEST_NOW: process.env.SVU_TEST_NOW || String(Date.now()),
  SVU_DEV_OUTBOX: scratch.outbox,
  SVU_DEV_STORAGE: scratch.storage
};

const summary = { database: databaseName, steps: [] };
let server;
let exitCode = 1;
let sourceBefore;

try {
  sourceBefore = await captureIntegrationSources();
  await adminQuery(`create database ${databaseName}`);
  step("migrate", run("scripts/migrate.js"));
  step("seed", run("scripts/seed-postgres.js",['--reset-database',databaseName]));

  // SVU_INTEGRATION_SERVER_LOG=<file> keeps the server log (request failures included) for diagnosing a run.
  const serverLog = process.env.SVU_INTEGRATION_SERVER_LOG;
  // The file is handed to the server directly; a pipe that stops draining would block its synchronous logging.
  server = spawn(process.execPath, ["server/server.js"], { env, stdio: ["ignore", serverLog ? openSync(serverLog,"w") : "ignore", "pipe"] });
  let serverErrors = "";
  server.stderr.on("data", (chunk) => {
    serverErrors += chunk;
  });
  await waitForHealth(env.SVU_BASE_URL, () => serverErrors);
  summary.steps.push({ name: "server", status: "passed" });

  if (!browserOnly) step("unit tests", spawnSync(process.execPath, ["--test",...(testConcurrency ? [`--test-concurrency=${Number(testConcurrency)}`] : [])], { env, encoding: "utf8" }));
  step("browser journey", spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...browserArgs], { env, encoding: "utf8" }));
  if (!browserOnly) {
    const smoke = run("scripts/smoke-all.js");
    step("smoke:all", smoke);
    try {
      summary.smoke = JSON.parse(smoke.stdout);
    } catch {
      summary.smoke = smoke.stdout.slice(0, 2000);
    }
  }

  exitCode = summary.steps.every((item) => item.status === "passed") ? 0 : 1;
} catch (error) {
  summary.error = error.message;
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
  try {
    await adminQuery(`drop database if exists ${databaseName} with (force)`);
    summary.teardown = "database dropped";
  } catch (error) {
    summary.teardown = `could not drop ${databaseName}: ${error.message}`;
  }
  await rm(scratch.outbox, { recursive: true, force: true });
  await rm(scratch.storage, { recursive: true, force: true });
  if (sourceBefore) {
    try {
      summary.sources = compareIntegrationSources(sourceBefore,await captureIntegrationSources());
      if (summary.sources.status !== 'passed') exitCode = 1;
    } catch (error) {
      summary.sources = {status:'failed',error:error.message};
      exitCode = 1;
    }
  }
  summary.status = exitCode === 0 ? "passed" : "failed";
  console.log(JSON.stringify(summary, null, 2));
  process.exit(exitCode);
}

function run(file,args = []) {
  return spawnSync(process.execPath, [file,...args], { env, encoding: "utf8" });
}

function step(name, result) {
  const passed = result.status === 0;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  // The tail of the output is truncated, so failing test titles are listed separately to stay visible.
  const failedTests = [...new Set(output.split("\n").filter((line) => /^\s+\d+\) \[/.test(line)).map((line) => line.trim()))];
  summary.steps.push({ name, status: passed ? "passed" : "failed", ...(passed ? {} : { ...(failedTests.length ? { failedTests } : {}), output: output.slice(-6000) }) });
  if (!passed && ["migrate", "seed"].includes(name)) {
    throw new Error(`${name} failed`);
  }
}

async function adminQuery(sql) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function waitForHealth(baseUrl, errors) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Integration server did not become healthy: ${errors().slice(-500)}`);
}
