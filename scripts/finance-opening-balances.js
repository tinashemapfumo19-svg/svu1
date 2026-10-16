import { readFile } from "node:fs/promises";
import { validateOpeningBalances } from "../server/modules/finance-migration.js";

// Validates an approved opening-balance export locally, then asks the server for a dry run (default) or applies it (--apply).
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run finance:opening-balances -- balances.json [--apply]");
const input = JSON.parse(await readFile(file, "utf8"));
const totals = validateOpeningBalances(input);
const token = process.env.SVU_FINANCE_MIGRATION_TOKEN;
if (!token) {
  console.log(JSON.stringify({ source: input.source, sourceRef: input.sourceRef, validated: true, lineCount: totals.balances.length, debitMinor: totals.debit, creditMinor: totals.credit, serverChecked: false }, null, 2));
} else {
  const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
  const response = await fetch(`${baseUrl}/api/finance/opening-balances`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...input, dryRun: !process.argv.includes("--apply") })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "Opening-balance import failed.");
  console.log(JSON.stringify(payload.data, null, 2));
  if (!payload.data.ready) process.exitCode = 1;
}
