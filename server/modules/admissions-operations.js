import { randomUUID } from "node:crypto";
import { applicationSelect, loadOwnedApplication } from "./admissions.js";
import { admissionsDefinition } from "./admissions-routing.js";
import { startWorkflowInTransaction, transitionWorkflowInTransaction } from "./workflow.js";
import { queueNotification } from "../notification-queue.js";
import { assertActorCanAccessScope, getResourceScope, insertAudit, isGlobalScope, requestError, requireFields, withTransaction } from "../support.js";

const reopenable = ["Rejected", "Declined", "Deferred", "Withdrawn", "Expired"];

export function createAdmissionsOperationsModule(pool) {
  async function staffApplication(db, actor, id) {
    const result = await db.query(`${applicationSelect} where a.id = $1 for update of a`, [id]);
    if (!result.rowCount) throw requestError(404, "Application was not found.");
    assertActorCanAccessScope(actor, await getResourceScope(db, "Application", id));
    return result.rows[0];
  }
  async function targetIntake(db, application, intakeId) {
    const result = await db.query(`select target.id, target.label from intakes target join intakes current on current.id = $1
      where target.id = $2 and target.programme_id = current.programme_id and target.starts_on > current.starts_on and target.status = 'published'`, [application.intakeId, intakeId]);
    if (!result.rowCount) throw requestError(400, "Choose a later published intake for the same programme.");
    return result.rows[0];
  }
  async function message(db, actorId, applicationId, accountId, body) {
    const id = `msg_${randomUUID()}`;
    await db.query("insert into application_messages (id, application_id, author_account_id, body) values ($1, $2, $3, $4)", [id, applicationId, actorId, body]);
    await queueNotification(db, accountId, "admissions.portal_message", { message: body },{link:'#apply'});
    await insertAudit(db, { actorId, action: "admissions.message.sent", subjectType: "Application", subjectId: applicationId, reason: "Applicant communication", afterRef: id });
  }
  return {
    async listAdmissionsRoutes() {
      return (await pool.query(`select code, name, definition_code as "definitionCode", academic_stages as "academicStages" from admissions_routes order by code`)).rows;
    },
    async configureAdmissionsRoute(actor, code, input) {
      requireFields(input, ["academicStages", "reason"]);
      if (!actor.roles.some((role) => role.permissions.includes("admissions.configure") && isGlobalScope(role.scope))) throw requestError(403, "Route configuration requires institution-wide admissions.configure authority.");
      if (!["undergraduate", "postgraduate"].includes(code)) throw requestError(400, "Unknown admissions route.");
      return withTransaction(pool, async (db) => {
        const route = (await db.query("select * from admissions_routes where code = $1 for update", [code])).rows[0];
        const version = (await db.query("select coalesce(max(version), 0) + 1 as version from workflow_definitions where code = $1", [route.definition_code])).rows[0].version;
        const definition = admissionsDefinition(route.definition_code, version, input.academicStages);
        await db.query("update workflow_definitions set active = false where code = $1", [definition.code]);
        await db.query(`insert into workflow_definitions (id, code, version, states, transitions, initial_state, terminal_states, active)
          values ($1, $2, $3, $4, $5, $6, $7, true)`, [definition.id, definition.code, definition.version, JSON.stringify(definition.states), JSON.stringify(definition.transitions), definition.initialState, JSON.stringify(definition.terminalStates)]);
        await db.query("update admissions_routes set academic_stages = $1, updated_by = $2, updated_at = now() where code = $3", [JSON.stringify(input.academicStages), actor.accountId, code]);
        if (input.programmeIds !== undefined) {
          if (!Array.isArray(input.programmeIds) || input.programmeIds.length > 100 || input.programmeIds.some((id) => typeof id !== "string")) throw requestError(400, "programmeIds must be a list of programme IDs.");
          for (const programmeId of input.programmeIds) {
            if (!(await db.query("select 1 from programmes where id = $1", [programmeId])).rowCount) throw requestError(400, "Programme was not found.");
            await db.query("insert into admissions_programme_routes (programme_id, route_code) values ($1, $2) on conflict (programme_id) do update set route_code = excluded.route_code", [programmeId, code]);
          }
        }
        await insertAudit(db, { actorId: actor.accountId, action: "admissions.route.configured", subjectType: "AdmissionsRoute", subjectId: code, reason: input.reason, afterRef: definition.id });
        return { code, version, academicStages: input.academicStages };
      });
    },
    async getApplicationActivity(actor, id) {
      await loadOwnedApplication(pool, actor, id);
      const activity = await this.loadAdmissionsActivity(pool, id);
      return { ...activity, history: activity.history.map(({ state, occurredAt }) => ({ state, occurredAt })) };
    },
    async loadAdmissionsActivity(db, id) {
      const messages = (await db.query('select id, body, created_at as "createdAt" from application_messages where application_id = $1 order by created_at', [id])).rows;
      const requests = (await db.query(`select r.id, r.reason, r.status, r.target_intake_id as "targetIntakeId", i.label as "targetIntakeLabel",
        r.review_reason as "reviewReason", r.requested_at as "requestedAt" from application_requests r
        left join intakes i on i.id = r.target_intake_id where r.application_id = $1 order by r.requested_at desc`, [id])).rows;
      const history = (await db.query(`select e.occurred_at as "occurredAt", e.after_ref as "state", e.reason from audit_events e
        join workflow_instances w on e.subject_type = 'WorkflowInstance' and e.subject_id = w.id
        where w.subject_type = 'Application' and w.subject_id = $1 order by e.occurred_at`, [id])).rows;
      return { messages, requests, history };
    },
    async requestDeferral(actor, id, input) {
      requireFields(input, ["reason", "targetIntakeId"]);
      if (String(input.reason).trim().length < 3 || String(input.reason).length > 1000) throw requestError(400, "Give a deferral reason of 3-1000 characters.");
      return withTransaction(pool, async (db) => {
        const application = await loadOwnedApplication(db, actor, id, { forUpdate: true });
        if (!["Decision", "Offer issued"].includes(application.workflowState)) throw requestError(409, "Deferral can be requested at Decision or while an offer is open.");
        if ((await db.query("select 1 from application_requests where application_id = $1 and status = 'pending'", [id])).rowCount) throw requestError(409, "A deferral request is already pending.");
        await targetIntake(db, application, input.targetIntakeId);
        const requestId = `req_${randomUUID()}`;
        await db.query("insert into application_requests (id, application_id, target_intake_id, reason, requested_by) values ($1, $2, $3, $4, $5)", [requestId, id, input.targetIntakeId, input.reason, actor.accountId]);
        await insertAudit(db, { actorId: actor.accountId, action: "admissions.deferral.requested", subjectType: "Application", subjectId: id, reason: input.reason, afterRef: requestId });
        return { id: requestId, status: "pending" };
      });
    },
    async resolveDeferral(actor, id, input) {
      requireFields(input, ["decision", "reason"]);
      if (!["approve", "reject"].includes(input.decision)) throw requestError(400, "decision must be approve or reject.");
      return withTransaction(pool, async (db) => {
        const application = await staffApplication(db, actor, id);
        if (!input.requestId) {
          requireFields(input, ["targetIntakeId"]);
          await targetIntake(db, application, input.targetIntakeId);
          if ((await db.query("select 1 from application_requests where application_id = $1 and status = 'pending'", [id])).rowCount) throw requestError(409, "Review the pending applicant request first.");
          input = { ...input, requestId: `req_${randomUUID()}` };
          await db.query("insert into application_requests (id, application_id, target_intake_id, reason, requested_by) values ($1, $2, $3, $4, $5)", [input.requestId, id, input.targetIntakeId, input.reason, actor.accountId]);
        }
        const result = await db.query("select * from application_requests where id = $1 and application_id = $2 and status = 'pending' for update", [input.requestId, id]);
        if (!result.rowCount) throw requestError(409, "There is no pending request to review.");
        if (!["Decision", "Offer issued"].includes(application.workflowState)) throw requestError(409, "This application is no longer eligible for deferral.");
        if (input.decision === "approve") {
          const target = await targetIntake(db, application, result.rows[0].target_intake_id);
          assertActorCanAccessScope(actor, { programmeCode: application.programmeCode, intakeId: target.id });
          await transitionWorkflowInTransaction(db, application.workflowInstanceId, { toState: "Deferred", actorId: actor.accountId, reason: input.reason, permissions: actor.permissions });
          await db.query("update application_decisions set response = 'deferred', responded_at = now() where application_id = $1 and response is null and decision = 'offer'", [id]);
        }
        const status = input.decision === "approve" ? "approved" : "rejected";
        await db.query("update application_requests set status = $1, reviewed_by = $2, reviewed_at = now(), review_reason = $3 where id = $4", [status, actor.accountId, input.reason, input.requestId]);
        const accountId = (await db.query("select applicant_account_id from applications where id = $1", [id])).rows[0].applicant_account_id;
        await message(db, actor.accountId, id, accountId, `Your deferral request was ${status}. ${input.reason}`);
        await insertAudit(db, { actorId: actor.accountId, action: `admissions.deferral.${status}`, subjectType: "Application", subjectId: id, reason: input.reason, afterRef: input.requestId });
        return { id, status, workflowState: status === "approved" ? "Deferred" : application.workflowState };
      });
    },
    async reopenApplication(actor, id, input) {
      requireFields(input, ["reason"]);
      return withTransaction(pool, async (db) => {
        const application = await staffApplication(db, actor, id);
        if (!reopenable.includes(application.workflowState)) throw requestError(409, "Only rejected, declined, deferred, withdrawn, or expired applications can be reopened.");
        if ((await db.query("select 1 from applications where applicant_account_id = (select applicant_account_id from applications where id = $1) and intake_id = $2 and id <> $1 and status <> 'withdrawn'", [id, application.intakeId])).rowCount) throw requestError(409, "Another live application already exists for this intake.");
        const route = (await db.query("select definition_code from admissions_routes where code = $1", [application.reviewRoute])).rows[0];
        const workflow = await startWorkflowInTransaction(db, { definitionCode: route.definition_code, subjectType: "Application", subjectId: id, ownerAccountId: actor.accountId,
          actorId: actor.accountId, reason: input.reason, moveTo: ["Submitted", "Payment verified", "Completeness review"] });
        await db.query("update applications set workflow_instance_id = $1, status = 'submitted', withdrawn_at = null, updated_at = now() where id = $2", [workflow.id, id]);
        await db.query("update application_decisions set response = 'superseded', responded_at = now() where application_id = $1 and response is null", [id]);
        await db.query("update application_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_reason = 'Application reopened for a new review' where application_id = $2 and status = 'pending'", [actor.accountId, id]);
        await insertAudit(db, { actorId: actor.accountId, action: "admissions.application.reopened", subjectType: "Application", subjectId: id, reason: input.reason, beforeRef: application.workflowInstanceId, afterRef: workflow.id });
        return { id, workflowState: workflow.state };
      });
    },
    async communicateApplications(actor, input) {
      requireFields(input, ["applicationIds", "message"]);
      if (!Array.isArray(input.applicationIds) || !input.applicationIds.length || input.applicationIds.length > 100 || input.applicationIds.some((id) => typeof id !== "string")) throw requestError(400, "Select 1-100 applications.");
      if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 5000) throw requestError(400, "Messages must contain 1-5000 characters.");
      return withTransaction(pool, async (db) => {
        const ids = [...new Set(input.applicationIds)].sort();
        for (const id of ids) await staffApplication(db, actor, id);
        for (const id of ids) {
          const accountId = (await db.query("select applicant_account_id from applications where id = $1", [id])).rows[0].applicant_account_id;
          await message(db, actor.accountId, id, accountId, input.message.trim());
        }
        return { sent: ids.length };
      });
    },
    async withdrawReviewedApplication(actor, id, input) {
      requireFields(input, ["reason"]);
      return withTransaction(pool, async (db) => {
        const application = await staffApplication(db, actor, id);
        await transitionWorkflowInTransaction(db, application.workflowInstanceId, { toState: "Withdrawn", actorId: actor.accountId, reason: input.reason, permissions: actor.permissions });
        await db.query("update applications set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = $1", [id]);
        await db.query("update application_decisions set response = 'withdrawn', responded_at = now() where application_id = $1 and decision = 'offer' and response is null", [id]);
        await db.query("update application_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_reason = 'Application withdrawn by admissions' where application_id = $2 and status = 'pending'", [actor.accountId, id]);
        await insertAudit(db, { actorId: actor.accountId, action: "admissions.application.withdrawn", subjectType: "Application", subjectId: id, reason: input.reason });
        return { id, workflowState: "Withdrawn" };
      });
    }
  };
}
