import { insertAudit, requestError, requireFields, withTransaction } from "../support.js";

// Account administration: find accounts with their current roles, and end a role without deleting its history.
const assignmentActive = "ra.effective_from <= current_date and (ra.effective_to is null or ra.effective_to >= current_date) and ra.ended_at is null";

export function createAccountAdminModule(pool) {
  return {
    async listAccounts(filters = {}) {
      const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 25, 1), 100);
      const offset = Math.max(Number.parseInt(filters.offset, 10) || 0, 0);
      const conditions = [], values = [];
      const q = String(filters.q || "").trim();
      if (q) { values.push(`%${q.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`); conditions.push(`(lower(a.email) like $${values.length} or lower(p.legal_name) like $${values.length} or lower(coalesce(p.preferred_name, '')) like $${values.length})`); }
      if (filters.status) {
        if (!["active", "invited", "suspended"].includes(filters.status)) throw requestError(400, "Unknown account status.");
        values.push(filters.status); conditions.push(`a.status = $${values.length}`);
      }
      if (filters.roleCode) { values.push(filters.roleCode); conditions.push(`exists (select 1 from role_assignments ra where ra.account_id = a.id and ra.role_code = $${values.length} and ${assignmentActive})`); }
      const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
      const total = (await pool.query(`select count(*)::int as total from accounts a join people p on p.id = a.person_id ${where}`, values)).rows[0].total;
      const rows = (await pool.query(
        `select a.id, a.email, a.status, a.last_login_at as "lastLoginAt", a.created_at as "createdAt", p.legal_name as "legalName", p.preferred_name as "preferredName", p.personas,
           exists (select 1 from mfa_factors f where f.account_id = a.id and f.status = 'active') as "mfaEnrolled",
           coalesce((select json_agg(json_build_object('id', ra.id, 'roleCode', ra.role_code, 'roleName', r.name, 'risk', r.risk, 'scope', ra.scope, 'effectiveFrom', to_char(ra.effective_from, 'YYYY-MM-DD'), 'reason', ra.reason) order by ra.created_at)
             from role_assignments ra join roles r on r.code = ra.role_code where ra.account_id = a.id and ${assignmentActive}), '[]'::json) as roles
         from accounts a join people p on p.id = a.person_id ${where}
         order by lower(p.legal_name), a.email limit ${limit} offset ${offset}`,
        values
      )).rows;
      const roles = (await pool.query("select code, name, risk from roles where active and is_assignable order by legacy_access_level desc nulls last,name")).rows;
      return { items: rows, total, limit, offset, roles };
    },

    async endRoleAssignment(assignmentId, input, actor) {
      requireFields(input, ["reason"]);
      const reason = String(input.reason).trim();
      if (!reason || reason.length > 2000) throw requestError(400, "Give a reason of up to 2000 characters.");
      return withTransaction(pool, async (client) => {
        const row = (await client.query(`select ra.id, ra.account_id as "accountId", ra.role_code as "roleCode" from role_assignments ra where ra.id = $1 and ${assignmentActive} for update`, [assignmentId])).rows[0];
        if (!row) throw requestError(404, "Active role assignment was not found.");
        // Nobody removes their own access here; another administrator must do it, so a mistake cannot lock everyone out.
        if (row.accountId === actor.accountId) throw requestError(403, "Ask another administrator to end your own role.");
        await client.query("update role_assignments set effective_to = current_date - 1, ended_at = now(), ended_by = $2, end_reason = $3 where id = $1", [assignmentId, actor.accountId, reason]);
        await insertAudit(client, { actorId: actor.accountId, action: "access.role_assignment.ended", subjectType: "RoleAssignment", subjectId: assignmentId, reason, metadata: { accountId: row.accountId, roleCode: row.roleCode } });
        return { id: assignmentId, status: "ended" };
      });
    }
  };
}
