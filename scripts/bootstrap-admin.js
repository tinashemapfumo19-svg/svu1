// Creates the first System Administrator on an empty (non-demo) database. It refuses to run once any
// active system_administrator assignment exists, so it cannot be used to add accounts later; further
// people are invited from the app. Usage:
//   SVU_BOOTSTRAP_EMAIL=you@example.edu SVU_BOOTSTRAP_NAME="Your Name" node scripts/bootstrap-admin.js
// The password comes from SVU_BOOTSTRAP_PASSWORD, or a strong one is generated and printed once.
import { randomBytes, randomUUID } from "node:crypto";
import { loadConfig } from "../server/config.js";
import { createPool } from "../server/db.js";
import { hashSecret, normalizeEmail, passwordProblems } from "../server/security.js";
import { insertAudit } from "../server/support.js";

const email = normalizeEmail(process.env.SVU_BOOTSTRAP_EMAIL);
const name = String(process.env.SVU_BOOTSTRAP_NAME || "").trim();
if (!email.includes("@") || !name) {
  console.error("Set SVU_BOOTSTRAP_EMAIL and SVU_BOOTSTRAP_NAME.");
  process.exit(1);
}
const generated = !process.env.SVU_BOOTSTRAP_PASSWORD;
const password = process.env.SVU_BOOTSTRAP_PASSWORD || randomBytes(18).toString("base64url");
const problems = passwordProblems(password, email);
if (problems.length) {
  console.error(`Password rejected: ${problems.join("; ")}.`);
  process.exit(1);
}

const pool = createPool(loadConfig());
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("lock table role_assignments in share row exclusive mode");
  const existing = await client.query(
    `select 1 from role_assignments
     where role_code = 'system_administrator' and (effective_to is null or effective_to >= current_date)
     limit 1`
  );
  if (existing.rowCount) throw new Error("A System Administrator already exists; invite further people from the app.");
  const taken = await client.query("select 1 from accounts where email = $1", [email]);
  if (taken.rowCount) throw new Error(`An account for ${email} already exists.`);

  const personId = `person_${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const assignmentId = `ra_${randomUUID()}`;
  const secret = await hashSecret(password);
  await client.query(
    `insert into people (id, preferred_name, legal_name, personas, status) values ($1, $2, $2, $3, 'active')`,
    [personId, name, JSON.stringify(["staff"])]
  );
  await client.query(
    `insert into accounts (id, person_id, email, status, mfa_required, password_hash, password_salt, password_set_at)
     values ($1, $2, $3, 'active', true, $4, $5, now())`,
    [accountId, personId, email, secret.hash, secret.salt]
  );
  await client.query(
    `insert into role_assignments (id, account_id, role_code, scope, effective_from, granted_by, reason)
     values ($1, $2, 'system_administrator', '{}', current_date, 'bootstrap', 'First administrator created at deployment')`,
    [assignmentId, accountId]
  );
  await insertAudit(client, {
    actorId: accountId,
    action: "access.role_assignment.created",
    subjectType: "RoleAssignment",
    subjectId: assignmentId,
    reason: "First System Administrator created by scripts/bootstrap-admin.js"
  });
  await client.query("commit");
  console.log(`Created System Administrator ${email}.`);
  if (generated) console.log(`Temporary password (shown once, change it after signing in): ${password}`);
  console.log("You will be asked to set up two-step verification on first sign-in.");
} catch (error) {
  await client.query("rollback");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
