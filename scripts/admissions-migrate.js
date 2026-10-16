import { readFile } from "node:fs/promises";
import { validateAdmissionsExport } from "../server/modules/admissions-migration.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run admissions:migrate -- export.json [--apply]");
const input = JSON.parse(await readFile(file, "utf8"));
const totals = validateAdmissionsExport(input);
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ source: input.source, validated: true, totals, applied: false }, null, 2));
} else {
  const token = process.env.SVU_ADMISSIONS_MIGRATION_TOKEN;
  if (!token) throw new Error("Set SVU_ADMISSIONS_MIGRATION_TOKEN to a session with admissions.migrate authority.");
  const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
  const response = await fetch(`${baseUrl}/api/admissions/migrations`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "Migration failed.");
  const checked = await fetch(`${baseUrl}/api/admissions/migrations/${payload.data.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const report = await checked.json();
  if (!checked.ok || !report.data.reconciled) throw new Error("Imported records did not reconcile with source control totals.");
  console.log(JSON.stringify({ migrationId: payload.data.id, replayed: payload.data.replayed, ...report.data }, null, 2));
}
