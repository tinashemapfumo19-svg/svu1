import { actorCanAccessScope, requestError } from "../support.js";

const kinds = ["progressive","certificate"],statuses = ["issued","superseded","revoked"];
const csvCell = (value) => /[",\r\n]/.test(String(value ?? "")) ? `"${String(value).replace(/"/g,'""')}"` : String(value ?? "");

export function validateIssuanceFilters(filters = {}) {
  const out = {};
  if (filters.kind) { if (!kinds.includes(filters.kind)) throw requestError(400,"kind must be progressive or certificate."); out.kind = filters.kind; }
  if (filters.status) { if (!statuses.includes(filters.status)) throw requestError(400,"status must be issued, superseded, or revoked."); out.status = filters.status; }
  for (const key of ["from","to"]) if (filters[key]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || new Date(`${filters[key]}T00:00:00Z`).toISOString().slice(0,10) !== filters[key]) throw requestError(400,`${key} must be a date (YYYY-MM-DD).`);
    out[key] = filters[key];
  }
  if (out.from && out.to && out.to < out.from) throw requestError(400,"to must not be before from.");
  if (filters.q) { if (typeof filters.q !== "string" || filters.q.length > 100) throw requestError(400,"Search text is limited to 100 characters."); out.q = filters.q.trim(); }
  out.format = filters.format === "csv" ? "csv" : "json";
  return out;
}

export function issuanceCsv(rows) {
  const header = ["reference_number","kind","status","student_number","student_name","programme_code","issued_at","issued_by","superseded_at","revoked_at","revoke_reason","template_version","verification_code"];
  return [header,...rows.map((row) => [row.referenceNumber,row.kind,row.status,row.studentNumber,row.studentName,row.programmeCode,row.issuedAt,row.issuedBy,row.supersededAt,row.revokedAt,row.revokeReason,row.templateVersion,row.verificationCode])]
    .map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// Official-document issuance history. Rows are limited to the programmes and intakes the reader's issuing or viewing
// role covers, so the register never discloses students outside their scope.
export function createDocumentIssuanceModule(pool) {
  return {
    async listDocumentIssuance(actor,rawFilters) {
      const filters = validateIssuanceFilters(rawFilters);
      const values = [],conditions = [];
      if (filters.kind) {values.push(filters.kind); conditions.push(`t.kind = $${values.length}`);}
      if (filters.status) {values.push(filters.status); conditions.push(`t.status = $${values.length}`);}
      if (filters.from) {values.push(filters.from); conditions.push(`t.issued_at >= $${values.length}::date`);}
      if (filters.to) {values.push(filters.to); conditions.push(`t.issued_at < $${values.length}::date + 1`);}
      if (filters.q) {values.push(`%${filters.q.replace(/[\\%_]/g,(c) => `\\${c}`)}%`); conditions.push(`(t.reference_number ilike $${values.length} or s.student_number ilike $${values.length} or t.content->'student'->>'legalName' ilike $${values.length})`);}
      const rows = (await pool.query(`select t.id,t.kind,t.status,t.reference_number as "referenceNumber",t.verification_code as "verificationCode",t.issued_at as "issuedAt",t.superseded_at as "supersededAt",
          t.revoked_at as "revokedAt",t.revoke_reason as "revokeReason",t.issued_by as "issuedBy",s.student_number as "studentNumber",t.content->'student'->>'legalName' as "studentName",
          p.code as "programmeCode",sp.intake_id as "intakeId",(select version from document_templates dt where dt.id = t.template_id) as "templateVersion"
        from transcripts t join student_programmes sp on sp.id = t.student_programme_id join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
        ${conditions.length ? `where ${conditions.join(" and ")}` : ""} order by t.issued_at desc,t.id limit 2000`,values)).rows
        .filter((row) => ["registry.transcript.issue","results.view"].some((permission) => actor.permissions.includes(permission)
          && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId})))
        .map(({intakeId,...row}) => ({...row,issuedAt:row.issuedAt?.toISOString?.() ?? row.issuedAt,supersededAt:row.supersededAt?.toISOString?.() ?? row.supersededAt,revokedAt:row.revokedAt?.toISOString?.() ?? row.revokedAt}));
      const totals = {issued:0,superseded:0,revoked:0,progressive:0,certificate:0};
      for (const row of rows) {totals[row.status] += 1; totals[row.kind] += 1;}
      if (filters.format === "csv") return {fileName:`document-issuance-${new Date().toISOString().slice(0,10)}.csv`,csv:issuanceCsv(rows),rows:rows.length};
      return {filters,totals,rows};
    }
  };
}
