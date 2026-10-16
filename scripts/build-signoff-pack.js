import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";

// FND-6.3: builds the Phase 1 sign-off pack from fresh evidence. It runs the isolated integration suite,
// reads the latest demo and backup evidence, and maps every Stage 1 exit gate to what proves it and
// what is still open. Output: SIGNOFF_PACK.generated.json and PHASE1_SIGNOFF_PACK.generated.md.

const docs = new URL("../docs/phase-1/", import.meta.url);
const generatedAt = new Date().toISOString();

const integrationRun = spawnSync(process.execPath, ["scripts/integration.js"], { encoding: "utf8", env: process.env });
let integration;
try {
  integration = JSON.parse(integrationRun.stdout);
} catch {
  integration = { status: "failed", error: (integrationRun.stderr || integrationRun.stdout).slice(-1000) };
}
const smokeResults = new Map((integration.smoke?.results || []).map((result) => [result.name, result.status]));
const exitGateEvidence = await readJson("EXIT_GATE_EVIDENCE.generated.json");
const backupEvidence = await readJson("BACKUP_RESTORE_EVIDENCE.generated.json");
const migrations = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
const openDecisions = parseOpenDecisions(await readFile(new URL("DECISION_REGISTER.md", docs), "utf8"));

const gates = [
  {
    gate: "A user can be invited, authenticated, authorized, suspended, and audited securely.",
    smokes: ["demo:phase1", "smoke:identity", "smoke:identity-hardening", "smoke:sessions", "smoke:mfa", "smoke:authz", "smoke:audit"],
    notes: [
      "Tokens are stored as SHA-256 digests; passwords use scrypt; TOTP seeds are AES-256-GCM encrypted.",
      "Login throttling, password recovery, TOTP MFA with recovery codes, and admin MFA reset are covered.",
      "The `privileged` MFA policy (the production default) was checked manually, not in CI, because the shared smoke admin signs in without MFA."
    ]
  },
  {
    gate: "Master data changes are effective-dated and protected by permission.",
    smokes: ["smoke:master-data", "smoke:master-data-lifecycle", "smoke:academic-calendar", "smoke:reference-data", "smoke:curriculum", "smoke:grading"],
    notes: [
      "Organisation units, programme versions, curricula, academic periods, reference values, grading schemes, and GPA rule sets are effective-dated, audited with before/after snapshots, and need `master_data.publish`.",
      "Maker-checker: the drafter cannot publish programme versions, grading schemes, or GPA rule sets.",
      "Seeded grading bands and GPA rules are placeholders pending Academic Board approval."
    ]
  },
  {
    gate: "Workflows, documents, and notifications are reusable by business modules.",
    smokes: ["smoke:workflow", "smoke:tasks", "smoke:documents", "smoke:service-reads"],
    notes: [
      "Workflows are versioned definitions with guarded transitions, decision authority, and terminal states.",
      "Documents go through signed upload, size, checksum, and file-signature checks, scan, review, and audited signed download.",
      "Malware scanning is recorded through an API; no scanner engine is integrated yet. Notifications queue but are not delivered (ADR-005)."
    ]
  },
  {
    gate: "Environments and schema can be recreated from version-controlled automation.",
    smokes: [],
    integration: true,
    notes: [
      "`npm run test:integration` builds a throwaway database from migrations, seeds it, and runs every smoke script.",
      "CI workflow exists (`.github/workflows/ci.yml`) but has not run on a hosted runner because this workspace is not yet a git repository.",
      "Staging and production environments do not exist yet (ADR-007 hosting is open)."
    ]
  },
  {
    gate: "Backup restoration and deployment rollback have been demonstrated.",
    smokes: [],
    backup: true,
    partial: "Backup restore is rehearsed; deployment rollback cannot be shown until a deployment target exists (ADR-007).",
    notes: ["`npm run backup:rehearse` dumps, restores into a separate database, and verifies foundation counts."]
  }
];

const evaluated = gates.map((item) => {
  const evidence = item.smokes.map((name) => ({ name, status: smokeResults.get(name) || "not run" }));
  let status = evidence.every((entry) => entry.status === "passed") ? "passed" : "failed";
  if (item.integration) {
    status = integration.status === "passed" ? "passed" : "failed";
  }
  if (item.backup) {
    status = backupEvidence?.status === "passed" ? "partial" : "failed";
  }
  return { ...item, status, evidence };
});

const pack = {
  generatedAt,
  integration: {
    status: integration.status,
    database: integration.database,
    teardown: integration.teardown,
    steps: integration.steps,
    smoke: integration.smoke ? { passed: integration.smoke.passed, failed: integration.smoke.failed } : null
  },
  exitGates: evaluated.map(({ gate, status, evidence, notes, partial }) => ({ gate, status, evidence, notes, partial })),
  demoEvidence: exitGateEvidence ? { status: exitGateEvidence.status, completedAt: exitGateEvidence.completedAt, gates: exitGateEvidence.gates?.length } : null,
  backupEvidence: backupEvidence ? { status: backupEvidence.status, completedAt: backupEvidence.completedAt, checks: backupEvidence.checks?.map((check) => check.id) } : null,
  migrations,
  openDecisions
};

await writeFile(new URL("SIGNOFF_PACK.generated.json", docs), `${JSON.stringify(pack, null, 2)}\n`);
await writeFile(new URL("PHASE1_SIGNOFF_PACK.generated.md", docs), renderMarkdown(pack));
console.log(JSON.stringify({ integration: pack.integration.status, gates: pack.exitGates.map((gate) => gate.status) }, null, 2));
process.exit(pack.integration.status === "passed" ? 0 : 1);

async function readJson(name) {
  try {
    return JSON.parse(await readFile(new URL(name, docs), "utf8"));
  } catch {
    return null;
  }
}

function parseOpenDecisions(markdown) {
  return markdown
    .split("\n")
    .filter((line) => /^\| ADR-\d+/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map(([, id, decision, recommendation, status, owner, blocks]) => ({ id, decision, recommendation, status, owner, blocks }))
    .filter((row) => row.status !== "Accepted");
}

function renderMarkdown(data) {
  const icon = { passed: "Passed", partial: "Partial", failed: "Failed" };
  const lines = [
    "# Phase 1 Sign-off Pack",
    "",
    `Generated ${data.generatedAt} by \`npm run signoff:pack\`. Do not edit by hand; re-run the command to refresh the evidence.`,
    "",
    "## Summary",
    "",
    `- Isolated integration run: **${data.integration.status}** (fresh database \`${data.integration.database}\`, ${data.integration.teardown}).`,
    `- Smoke scripts in that run: ${data.integration.smoke ? `${data.integration.smoke.passed} passed, ${data.integration.smoke.failed} failed` : "not available"}.`,
    `- Phase 1 demo evidence: ${data.demoEvidence ? `${data.demoEvidence.status} at ${data.demoEvidence.completedAt}` : "missing"}.`,
    `- Backup/restore rehearsal: ${data.backupEvidence ? `${data.backupEvidence.status} at ${data.backupEvidence.completedAt}` : "missing"}.`,
    `- Schema: ${data.migrations.length} migrations, all applied from empty in the integration run.`,
    "",
    "## Stage 1 Exit Gates",
    ""
  ];
  for (const gate of data.exitGates) {
    lines.push(`### ${icon[gate.status]}: ${gate.gate}`, "");
    if (gate.partial) {
      lines.push(`**Partial:** ${gate.partial}`, "");
    }
    if (gate.evidence.length > 0) {
      lines.push(`Evidence: ${gate.evidence.map((entry) => `\`${entry.name}\` ${entry.status}`).join(", ")}.`, "");
    }
    for (const note of gate.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push(
    "## Decisions Still Needed",
    "",
    "| ID | Decision | Status | Owner | Blocks |",
    "| --- | --- | --- | --- | --- |",
    ...data.openDecisions.map((row) => `| ${row.id} | ${row.decision} | ${row.status} | ${row.owner} | ${row.blocks} |`),
    "",
    "## Approvals",
    "",
    "| Area | Owner | Decision | Date | Signature |",
    "| --- | --- | --- | --- | --- |",
    "| Identity, access, and audit | IT/Security | | | |",
    "| Master data and academic rules | Registry / Academic Board | | | |",
    "| Documents and notifications | IT/Security, Communications | | | |",
    "| Environments, backup, and operations | IT | | | |",
    "| Phase 1 exit overall | Programme sponsor | | | |",
    ""
  );
  return lines.join("\n");
}
