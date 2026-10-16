import { randomUUID } from "node:crypto";

// Shared persistence, audit, scope, and validation helpers used by every repository module.

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertAudit(pool, event) {
  await pool.query(
    `insert into audit_events (
      id,
      actor_id,
      action,
      subject_type,
      subject_id,
      source,
      reason,
      before_ref,
      after_ref,
      metadata
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      `audit_${randomUUID()}`,
      event.actorId,
      event.action,
      event.subjectType,
      event.subjectId,
      "svu-foundation",
      event.reason,
      event.beforeRef || null,
      event.afterRef || null,
      event.metadata || {}
    ]
  );
}

export async function getResourceScope(pool, resourceType, resourceId) {
  const result = await pool.query(
    `select programme_code as "programmeCode", intake_id as "intakeId"
     from resource_scopes
     where resource_type = $1 and resource_id = $2`,
    [resourceType, resourceId]
  );

  if (result.rowCount === 0) {
    const error = new Error(`No scope is registered for ${resourceType} ${resourceId}.`);
    error.statusCode = 403;
    throw error;
  }

  return result.rows[0];
}

export function assertActorCanAccessScope(actor, targetScope) {
  if (!targetScope || Object.keys(targetScope).length === 0) {
    return;
  }

  // Only roles that grant the permission authorising this request may lend it their scope.
  const roles = actor.authorizingPermission
    ? actor.roles.filter((role) => (role.permissions || []).includes(actor.authorizingPermission))
    : actor.roles;

  if (roles.some((role) => role.code === "system_administrator" || isGlobalScope(role.scope))) {
    return;
  }

  const allowed = roles.some((role) => scopeContains(role.scope, targetScope));
  if (!allowed) {
    const error = new Error("The requested action is outside your authorized scope.");
    error.statusCode = 403;
    throw error;
  }
}

// Boolean form of assertActorCanAccessScope, for filtering lists to what the caller may see.
export function actorCanAccessScope(actor, targetScope) {
  try {
    assertActorCanAccessScope(actor, targetScope);
    return true;
  } catch {
    return false;
  }
}

export function isGlobalScope(scope = {}) {
  return Object.keys(scope).length === 0;
}

export function scopeContains(actorScope = {}, targetScope = {}) {
  const programmeCodes = actorScope.programmeCodes || [];
  const intakeIds = actorScope.intakeIds || [];

  if (targetScope.programmeCode && !programmeCodes.includes(targetScope.programmeCode)) {
    return false;
  }

  if (targetScope.intakeId && !intakeIds.includes(targetScope.intakeId)) {
    return false;
  }

  return true;
}

export function parseEffectiveDate(value) {
  if (value === undefined || value === null || value === "") {
    return todayIso();
  }
  const text = String(value);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw requestError(400, `Invalid date ${text}; use YYYY-MM-DD.`);
  }
  return text;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Maker-checker: whoever drafted an official rule cannot also be the one who publishes it.
export function assertSeparateApprover(createdBy, actor) {
  if (createdBy && createdBy === actor.accountId) {
    throw requestError(403, "Separation of duties: the person who drafted this cannot also publish it. Ask another approver.");
  }
}

export function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function requireFields(input, fields) {
  const missing = fields.filter((field) => input[field] === undefined || input[field] === null || input[field] === "");
  if (missing.length > 0) {
    const error = new Error(`Missing required field(s): ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
}
