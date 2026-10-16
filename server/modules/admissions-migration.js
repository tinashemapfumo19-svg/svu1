import { createHash, randomUUID } from "node:crypto";
import { assertUploadIsAllowed } from "./documents.js";
import { matchesFileSignature } from "../storage.js";
import { convertAcceptedApplication } from "./student-conversion.js";
import { intakeSeatsSql } from "./intake-capacity.js";
import { startWorkflowInTransaction } from "./workflow.js";
import { assertActorCanAccessScope, getResourceScope, insertAudit, requestError, requireFields, withTransaction } from "../support.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function validateAdmissionsExport(input) {
  requireFields(input, ["source", "totals", "applications"]);
  if (typeof input.source !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(input.source)) throw requestError(400, "source must be a stable export identifier.");
  if (!Array.isArray(input.applications) || !input.applications.length || input.applications.length > 200) throw requestError(400, "Provide 1-200 applications per migration batch.");
  const appIds = new Set();
  const docIds = new Set();
  let documentBytes = 0;
  for (const application of input.applications) {
    requireFields(application, ["legacyId", "accountId", "intakeId", "state"]);
    if ([application.accountId, application.intakeId, application.state].some((value) => typeof value !== "string" || !value.trim())) throw requestError(400, "Account, intake, and state mappings must be strings.");
    if (typeof application.legacyId !== "string" || appIds.has(application.legacyId)) throw requestError(400, "Application legacy IDs must be unique strings.");
    appIds.add(application.legacyId);
    if (application.answers !== undefined && (!application.answers || typeof application.answers !== "object" || Array.isArray(application.answers) || JSON.stringify(application.answers).length > 20000)) throw requestError(400, "Invalid saved application answers.");
    if (application.messages !== undefined && (!Array.isArray(application.messages) || application.messages.some((body) => typeof body !== "string" || !body.trim() || body.length > 5000))) throw requestError(400, "Invalid communication history.");
    if (!Array.isArray(application.documents || [])) throw requestError(400, "documents must be a list.");
    for (const document of application.documents || []) {
      requireFields(document, ["legacyId", "documentType", "fileName", "contentType", "contentBase64", "checksum"]);
      if (typeof document.documentType !== "string" || !/^[a-z][a-z0-9_]{0,59}$/.test(document.documentType)) throw requestError(400, "Invalid document type code.");
      if (typeof document.legacyId !== "string" || docIds.has(document.legacyId)) throw requestError(400, "Document legacy IDs must be unique strings.");
      docIds.add(document.legacyId);
      if (typeof document.contentBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.contentBase64)) throw requestError(400, "Document bytes must be canonical base64.");
      const bytes = Buffer.from(document.contentBase64, "base64");
      assertUploadIsAllowed({ ...document, sizeBytes: bytes.length, classification: "confidential" });
      if (sha256(bytes) !== document.checksum || !matchesFileSignature(document.contentType, bytes)) throw requestError(400, "Document checksum or file signature does not match the export.");
      documentBytes += bytes.length;
    }
  }
  const actual = { applications: appIds.size, documents: docIds.size, documentBytes };
  if (Object.keys(actual).some((key) => !Number.isSafeInteger(input.totals[key]) || input.totals[key] !== actual[key])) throw requestError(409, "Source control totals do not match the exported applications, documents, and bytes.");
  return actual;
}

export function createAdmissionsMigrationModule(pool, { storage }) {
  return {
    async importAdmissionsExport(actor, input) {
      const totals = validateAdmissionsExport(input);
      if (!storage) throw requestError(501, "Document storage is required for migration.");
      const checksum = sha256(JSON.stringify(input));
      const storedKeys = [];
      try {
        return await withTransaction(pool, async (db) => {
          await db.query("select pg_advisory_xact_lock(hashtext($1))", [`admissions-migration:${input.source}`]);
          const prior = await db.query("select id, report from admissions_migration_batches where source = $1 and checksum = $2", [input.source, checksum]);
          if (prior.rowCount) {
            for (const mapping of prior.rows[0].report.mappings) assertActorCanAccessScope(actor, await getResourceScope(db, "Application", mapping.applicationId));
            return { id: prior.rows[0].id, replayed: true, ...prior.rows[0].report };
          }
          const batchId = `amb_${randomUUID()}`;
          await db.query("insert into admissions_migration_batches (id, source, checksum, report, imported_by) values ($1, $2, $3, '{}', $4)", [batchId, input.source, checksum, actor.accountId]);
          const mappings = [];
          for (const record of input.applications) {
            if ((await db.query("select 1 from admissions_legacy_records where source = $1 and record_type = 'application' and legacy_id = $2", [input.source, record.legacyId])).rowCount) throw requestError(409, "A legacy application was already imported in another batch; reconcile it before changing the export.");
            const intake = await db.query(`select i.*, p.code as programme_code, coalesce(pr.route_code, 'undergraduate') as route_code,
              (select id from programme_versions where programme_id = p.id and status in ('published', 'retired')
                and effective_from <= i.starts_on and (effective_to is null or effective_to >= i.starts_on) order by effective_from desc limit 1) as version_id
              from intakes i join programmes p on p.id = i.programme_id left join admissions_programme_routes pr on pr.programme_id = p.id where i.id = $1`, [record.intakeId]);
            if (!intake.rowCount || !intake.rows[0].version_id) throw requestError(400, "Map the source intake to a target intake with an effective programme version.");
            const selected = intake.rows[0];
            assertActorCanAccessScope(actor, { programmeCode: selected.programme_code, intakeId: selected.id });
            if (!(await db.query("select 1 from accounts where id = $1", [record.accountId])).rowCount) throw requestError(400, "Map the applicant to an existing target account.");
            const id = `app_${randomUUID()}`;
            const isDraft = record.state === "Draft";
            const reference = isDraft ? null : record.referenceNumber;
            if (!isDraft && (typeof reference !== "string" || !reference.trim() || reference.length > 100)) throw requestError(400, "Submitted historical records need their original referenceNumber.");
            await db.query(`insert into applications (id, applicant_account_id, intake_id, programme_version_id, study_mode_code, answers, status, reference_number, submitted_at, review_route)
              values ($1, $2, $3, $4, $5, $6, $7, $8, case when $7 = 'draft' then null else now() end, $9)`,
              [id, record.accountId, record.intakeId, selected.version_id, record.studyModeCode || null, JSON.stringify(record.answers || {}), isDraft ? "draft" : record.state === "Withdrawn" ? "withdrawn" : "submitted", reference, selected.route_code]);
            await db.query("insert into resource_scopes (id, resource_type, resource_id, programme_code, intake_id) values ($1, 'Application', $2, $3, $4)", [`scope_${randomUUID()}`, id, selected.programme_code, record.intakeId]);
            if (!isDraft) {
              if (["Offer issued", "Accepted"].includes(record.state)) {
                await db.query("select pg_advisory_xact_lock(hashtext($1))", [`intake-seats:${record.intakeId}`]);
                const seats = (await db.query(intakeSeatsSql,[record.intakeId])).rows[0];
                if (seats.used >= seats.capacity) throw requestError(409, "Imported offers and acceptances exceed the mapped intake capacity.");
              }
              const route = (await db.query("select definition_code from admissions_routes where code = $1", [selected.route_code])).rows[0];
              const definition = (await db.query("select * from workflow_definitions where code = $1 and active order by version desc limit 1", [route.definition_code])).rows[0];
              const path = ["Submitted", "Payment verified", "Completeness review", ...(await db.query("select academic_stages from admissions_routes where code = $1", [selected.route_code])).rows[0].academic_stages, "Decision"];
              let moveTo;
              if (path.includes(record.state)) moveTo = path.slice(0, path.indexOf(record.state) + 1);
              else if (record.state === "Information requested") moveTo = [...path.slice(0, 3), record.state];
              else if (record.state === "Withdrawn") moveTo = ["Submitted", "Withdrawn"];
              else if (record.state === "Rejected" || record.state === "Deferred") moveTo = [...path, record.state];
              else if (["Offer issued", "Accepted", "Declined", "Expired"].includes(record.state)) moveTo = [...path, "Offer issued", ...(record.state === "Offer issued" ? [] : [record.state])];
              else throw requestError(400, `Unknown source state ${record.state}.`);
              if (!definition) throw requestError(409, "Load the admissions workflow definitions before migration.");
              const workflow = await startWorkflowInTransaction(db, { definitionCode: route.definition_code, subjectType: "Application", subjectId: id,
                ownerAccountId: actor.accountId, actorId: actor.accountId, reason: `Migration ${input.source}/${record.legacyId}`, moveTo, permissions: actor.permissions });
              await db.query("update applications set workflow_instance_id = $1 where id = $2", [workflow.id, id]);
              if (["Rejected", "Offer issued", "Accepted", "Declined", "Expired"].includes(record.state)) {
                const decision = record.decision;
                const expected = record.state === "Rejected" ? "reject" : "offer";
                if (!decision || decision.decision !== expected) throw requestError(400, "Historical decisions must match the source workflow state.");
                if (expected === "reject" && !(await db.query("select 1 from reference_values where list_code = 'decision_reason' and value_code = $1", [decision.reasonCode])).rowCount) throw requestError(400, "Map the historical rejection reason to a controlled reason code.");
                if (expected === "offer" && (!decision.offerExpiresAt || !Number.isFinite(Date.parse(decision.offerExpiresAt)))) throw requestError(400, "Historical offers need a valid offerExpiresAt.");
                const response = { Accepted: "accepted", Declined: "declined", Expired: "expired" }[record.state] || null;
                await db.query(`insert into application_decisions (id, application_id, decision, reason_code, conditions, offer_expires_at, decided_by, response)
                  values ($1, $2, $3, $4, $5, $6, $7, $8)`, [`dec_${randomUUID()}`, id, expected, decision.reasonCode || null, JSON.stringify(decision.conditions || []), decision.offerExpiresAt || null, actor.accountId, response]);
              }
              if (record.state === "Accepted") await convertAcceptedApplication(db, id, actor.accountId);
            }
            await db.query("insert into admissions_legacy_records (source, legacy_id, record_type, target_id, batch_id) values ($1, $2, 'application', $3, $4)", [input.source, record.legacyId, id, batchId]);
            for (const document of record.documents || []) {
              const documentId = `doc_${randomUUID()}`;
              const storageKey = `migration/${randomUUID()}`;
              const bytes = Buffer.from(document.contentBase64, "base64");
              await storage.put(storageKey, bytes);
              storedKeys.push(storageKey);
              // Source scan labels are not trusted; imported files must pass the new scanner.
              await db.query(`insert into documents (id, owner_type, owner_id, document_type, classification, storage_key, checksum, lifecycle, malware_scan_status, file_name, content_type, size_bytes)
                values ($1, 'Application', $2, $3, 'confidential', $4, $5, 'uploaded', 'pending', $6, $7, $8)`, [documentId, id, document.documentType, storageKey, document.checksum, document.fileName, document.contentType, bytes.length]);
              await db.query("update documents set signature_verified = true where id = $1", [documentId]);
              await db.query("insert into admissions_legacy_records (source, legacy_id, record_type, target_id, batch_id) values ($1, $2, 'document', $3, $4)", [input.source, document.legacyId, documentId, batchId]);
            }
            for (const body of record.messages || []) await db.query("insert into application_messages (id, application_id, author_account_id, body) values ($1, $2, $3, $4)", [`msg_${randomUUID()}`, id, actor.accountId, body]);
            mappings.push({ legacyId: record.legacyId, applicationId: id });
          }
          const report = { source: input.source, sourceTotals: totals, targetTotals: totals, reconciled: true, mappings };
          await db.query("update admissions_migration_batches set report = $1 where id = $2", [JSON.stringify(report), batchId]);
          await insertAudit(db, { actorId: actor.accountId, action: "admissions.migration.imported", subjectType: "AdmissionsMigration", subjectId: batchId, reason: `Imported ${input.source}`, metadata: totals });
          return { id: batchId, replayed: false, ...report };
        });
      } catch (error) {
        for (const key of storedKeys) await storage.remove(key);
        if (error.code === "23505") throw requestError(409, "The export conflicts with an existing application, reference number, or legacy record.");
        throw error;
      }
    },
    async reconcileAdmissionsBatch(actor, id) {
      const batch = await pool.query("select report from admissions_migration_batches where id = $1", [id]);
      if (!batch.rowCount) throw requestError(404, "Migration batch was not found.");
      const records = await pool.query("select * from admissions_legacy_records where batch_id = $1", [id]);
      const totals = { applications: 0, documents: 0, documentBytes: 0 };
      const failures = [];
      for (const record of records.rows) {
        if (record.record_type === "application") {
          assertActorCanAccessScope(actor, await getResourceScope(pool, "Application", record.target_id));
          const found = await pool.query("select 1 from applications where id = $1", [record.target_id]);
          totals.applications += found.rowCount;
          if (!found.rowCount) failures.push(record.legacy_id);
        } else {
          const found = await pool.query("select storage_key, size_bytes, checksum from documents where id = $1", [record.target_id]);
          if (!found.rowCount) { failures.push(record.legacy_id); continue; }
          totals.documents += 1;
          try {
            const bytes = await storage.get(found.rows[0].storage_key);
            totals.documentBytes += bytes.length;
            if (bytes.length !== Number(found.rows[0].size_bytes) || sha256(bytes) !== found.rows[0].checksum) failures.push(record.legacy_id);
          } catch { failures.push(record.legacy_id); }
        }
      }
      const sourceTotals = batch.rows[0].report.sourceTotals;
      return { id, sourceTotals, targetTotals: totals, failures, reconciled: !failures.length && Object.keys(totals).every((key) => totals[key] === sourceTotals[key]) };
    }
  };
}
