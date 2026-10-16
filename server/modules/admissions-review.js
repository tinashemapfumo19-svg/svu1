import { randomUUID } from "node:crypto";
import { queueNotification } from "../notification-queue.js";
import { intakeSeatsSql, transferredSeatsSql } from "./intake-capacity.js";
import {
  actorCanAccessScope,
  assertActorCanAccessScope,
  getResourceScope,
  insertAudit,
  requestError,
  requireFields,
  withTransaction
} from "../support.js";
import { applicationSelect, buildChecklist, expireOffer } from "./admissions.js";
import { convertAcceptedApplication } from "./student-conversion.js";
import { allowedTransitionsFrom, transitionWorkflowInTransaction } from "./workflow.js";

// Staff side of admissions: scoped review queues (ADM-10, ADM-11), vetting notes and evidence
// (ADM-12), requests for more information (ADM-15), and duplicate-applicant detection (ADM-08).

const maxQueueSize = 200;

export function duplicateReasons(subject, other) {
  const reasons = [];
  const sameName = subject.legalName && other.legalName
    && subject.legalName.trim().toLowerCase() === other.legalName.trim().toLowerCase();
  if (sameName && subject.dateOfBirth && subject.dateOfBirth === other.dateOfBirth) {
    reasons.push("same legal name and date of birth");
  }
  if (subject.phone && subject.phone === other.phone) {
    reasons.push("same phone number");
  }
  return reasons;
}

async function applicantFacts(db, applicationIds) {
  const result = await db.query(
    `select
      a.id as "applicationId",
      a.applicant_account_id as "accountId",
      a.reference_number as "referenceNumber",
      a.status,
      p.legal_name as "legalName",
      to_char(ap.date_of_birth, 'YYYY-MM-DD') as "dateOfBirth",
      ap.phone
     from applications a
     join accounts acc on acc.id = a.applicant_account_id
     join people p on p.id = acc.person_id
     left join applicant_profiles ap on ap.account_id = a.applicant_account_id
     where a.id = any($1)`,
    [applicationIds]
  );
  return new Map(result.rows.map((row) => [row.applicationId, row]));
}

export async function findDuplicateCandidates(db, subject) {
  // Narrow in SQL on the strong identifiers, then explain each match in code.
  const result = await db.query(
    `select
      a.id as "applicationId",
      a.reference_number as "referenceNumber",
      a.status,
      p.legal_name as "legalName",
      to_char(ap.date_of_birth, 'YYYY-MM-DD') as "dateOfBirth",
      ap.phone
     from applications a
     join accounts acc on acc.id = a.applicant_account_id
     join people p on p.id = acc.person_id
     left join applicant_profiles ap on ap.account_id = a.applicant_account_id
     where a.applicant_account_id <> $1
       and a.status <> 'withdrawn'
       and ((lower(p.legal_name) = lower($2) and ap.date_of_birth = $3::date) or (ap.phone is not null and ap.phone = $4))
     limit 20`,
    [subject.accountId, subject.legalName || "", subject.dateOfBirth || null, subject.phone || null]
  );
  return result.rows
    .map((row) => ({ applicationId: row.applicationId, referenceNumber: row.referenceNumber, status: row.status, reasons: duplicateReasons(subject, row) }))
    .filter((row) => row.reasons.length > 0);
}

export function createAdmissionsReviewModule(pool, { devOutboxDir = null } = {}) {
  async function eligibleReviewers(db, scope) {
    const result = await db.query(`select acc.id, pe.preferred_name as "name", r.code as "roleCode", ra.scope,
      array_agg(rp.permission_code) as permissions from accounts acc join people pe on pe.id = acc.person_id
      join role_assignments ra on ra.account_id = acc.id join roles r on r.code = ra.role_code
      join role_permissions rp on rp.role_code = r.code
      where acc.status = 'active' and ra.effective_from <= current_date and (ra.effective_to is null or ra.effective_to >= current_date)
      group by acc.id, pe.preferred_name, ra.id, r.code, ra.scope order by pe.preferred_name`, []);
    const candidates = new Map();
    for (const row of result.rows) {
      const role = { code: row.roleCode, scope: row.scope, permissions: row.permissions };
      if (role.permissions.includes("admissions.review") && actorCanAccessScope({ roles: [role], authorizingPermission: "admissions.review" }, scope)) {
        const candidate = candidates.get(row.id) || { accountId: row.id, name: row.name, roles: [] };
        candidate.roles.push(row.roleCode);
        candidates.set(row.id, candidate);
      }
    }
    return [...candidates.values()];
  }
  async function loadForStaff(db, actor, applicationId, { forUpdate = false } = {}) {
    const result = await db.query(`${applicationSelect} where a.id = $1 ${forUpdate ? "for update of a" : ""}`, [applicationId]);
    if (result.rowCount === 0) {
      throw requestError(404, "Application was not found.");
    }
    assertActorCanAccessScope(actor, await getResourceScope(db, "Application", applicationId));
    return result.rows[0];
  }

  return {
    async listReviewQueue(actor, filters = {}) {
      const values = [];
      const conditions = [filters.includeClosed ? "a.status in ('submitted', 'withdrawn')" : "a.status = 'submitted'"];
      if (!filters.includeClosed) conditions.push("w.status = 'active'");
      for (const [key, column] of [["intakeId", "a.intake_id"], ["programmeCode", "p.code"], ["state", "w.state"], ["reviewRoute", "a.review_route"]]) {
        if (filters[key]) {
          values.push(filters[key]);
          conditions.push(`${column} = $${values.length}`);
        }
      }
      if (filters.assigned === "me") {
        values.push(actor.accountId);
        conditions.push(`w.owner_account_id = $${values.length}`);
      } else if (filters.assigned === "unassigned") {
        conditions.push("w.owner_account_id is null");
      }
      const limit = Math.max(1, Math.min(Number.parseInt(filters.limit || "50", 10) || 50, maxQueueSize));
      const offset = Math.max(0, Number.parseInt(filters.offset || "0", 10) || 0);
      const result = await pool.query(
        `select
          a.id,
          a.reference_number as "referenceNumber",
          p.code as "programmeCode",
          i.id as "intakeId",
          i.label as "intakeLabel",
          w.state,
          a.review_route as "reviewRoute",
          w.owner_account_id as "assigneeAccountId",
          a.submitted_at as "submittedAt",
          floor(extract(epoch from (now() - a.submitted_at)) / 86400)::int as "daysWaiting",
          pe.legal_name as "applicantName",
          rs.programme_code as "scopeProgrammeCode",
          rs.intake_id as "scopeIntakeId"
         from applications a
         join intakes i on i.id = a.intake_id
         join programmes p on p.id = i.programme_id
         join workflow_instances w on w.id = a.workflow_instance_id
         join accounts acc on acc.id = a.applicant_account_id
         join people pe on pe.id = acc.person_id
         join resource_scopes rs on rs.resource_type = 'Application' and rs.resource_id = a.id
         where ${conditions.join(" and ")}
         order by a.submitted_at asc`,
        values
      );
      // Oldest first, and only what this reviewer's admissions.review roles cover.
      const visible = result.rows
        .filter((row) => actorCanAccessScope(actor, { programmeCode: row.scopeProgrammeCode, intakeId: row.scopeIntakeId }))
        .slice(offset, offset + limit);
      const facts = await applicantFacts(pool, visible.map((row) => row.id));
      const rows = [];
      for (const row of visible) {
        const { scopeProgrammeCode, scopeIntakeId, ...rest } = row;
        const duplicates = await findDuplicateCandidates(pool, facts.get(row.id));
        rows.push({ ...rest, possibleDuplicates: duplicates.length });
      }
      return rows;
    },

    async getReviewApplication(actor, applicationId) {
      const application = await loadForStaff(pool, actor, applicationId);
      const facts = (await applicantFacts(pool, [applicationId])).get(applicationId);
      const profile = await pool.query(
        `select to_char(date_of_birth, 'YYYY-MM-DD') as "dateOfBirth", nationality_code as "nationalityCode", phone,
                prior_level_code as "priorLevelCode", study_mode_code as "studyModeCode", address
         from applicant_profiles where account_id = $1`,
        [facts.accountId]
      );
      const notes = await pool.query(
        `select id, category, body, author_account_id as "authorAccountId", created_at as "createdAt"
         from application_notes where application_id = $1 order by created_at`,
        [applicationId]
      );
      const fee = await pool.query(
        `select method, reference, status, verified_at as "verifiedAt"
         from application_fee_acknowledgements
         where application_id = $1`,
        [applicationId]
      );
      let allowedTransitions = [];
      if (application.workflowInstanceId) {
        const definition = await pool.query(
          `select d.states, d.transitions, d.terminal_states as "terminalStates", d.code, d.version
           from workflow_instances w join workflow_definitions d on d.id = w.definition_id where w.id = $1`,
          [application.workflowInstanceId]
        );
        allowedTransitions = actor.permissions.includes("workflow.transition")
          ? allowedTransitionsFrom(definition.rows[0], application.workflowState, actor.permissions)
          : [];
      }
      return {
        ...application,
        reviewers: await eligibleReviewers(pool, { programmeCode: application.programmeCode, intakeId: application.intakeId }),
        ...await this.loadAdmissionsActivity(pool, applicationId),
        capabilities: Object.fromEntries(["admissions.decide", "admissions.configure", "document.review", "document.create", "workflow.transition"].map((permission) => [permission,
          actor.permissions.includes(permission) && actorCanAccessScope({ ...actor, authorizingPermission: permission }, { programmeCode: application.programmeCode, intakeId: application.intakeId })])),
        applicant: { accountId: facts.accountId, legalName: facts.legalName, profile: profile.rows[0] || null },
        fee: fee.rows[0] || null,
        checklist: await buildChecklist(pool, application),
        notes: notes.rows,
        allowedTransitions,
        possibleDuplicates: await findDuplicateCandidates(pool, facts)
      };
    },

    async assignReviewer(actor, applicationId, input) {
      const assigneeId = input.assigneeAccountId || actor.accountId;
      return withTransaction(pool, async (client) => {
        const application = await loadForStaff(client, actor, applicationId, { forUpdate: true });
        if (!application.workflowInstanceId) {
          throw requestError(409, "Only submitted applications can be assigned.");
        }
        if (!(await eligibleReviewers(client, { programmeCode: application.programmeCode, intakeId: application.intakeId })).some((candidate) => candidate.accountId === assigneeId)) throw requestError(409, "Choose an active reviewer authorized for this application.");
        // The assignee must be able to review this application too.
        const assignee = await client.query(
          `select ra.role_code, ra.scope, array_agg(rp.permission_code) as permissions
           from role_assignments ra join role_permissions rp on rp.role_code = ra.role_code
           where ra.account_id = $1 and ra.effective_from <= current_date
             and (ra.effective_to is null or ra.effective_to >= current_date)
           group by ra.id, ra.role_code, ra.scope`,
          [assigneeId]
        );
        const assigneeActor = {
          authorizingPermission: "admissions.review",
          roles: assignee.rows.map((row) => ({ code: row.role_code, scope: row.scope, permissions: row.permissions }))
        };
        const scope = await getResourceScope(client, "Application", applicationId);
        if (!assigneeActor.roles.some((role) => role.permissions.includes("admissions.review")) || !actorCanAccessScope(assigneeActor, scope)) {
          throw requestError(409, "The assignee cannot review applications for this programme and intake.");
        }
        await client.query("update workflow_instances set owner_account_id = $1, updated_at = now() where id = $2", [assigneeId, application.workflowInstanceId]);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application.assigned",
          subjectType: "Application",
          subjectId: applicationId,
          reason: input.reason || `Assigned to ${assigneeId}`,
          afterRef: assigneeId
        });
        return { id: applicationId, assigneeAccountId: assigneeId };
      });
    },

    async addApplicationNote(actor, applicationId, input) {
      requireFields(input, ["category", "body"]);
      if (!["completeness", "academic", "general"].includes(input.category)) {
        throw requestError(400, "category must be completeness, academic, or general.");
      }
      if (String(input.body).length > 5000) {
        throw requestError(400, "Notes must be 5000 characters or fewer.");
      }
      return withTransaction(pool, async (client) => {
        await loadForStaff(client, actor, applicationId);
        const id = `note_${randomUUID()}`;
        await client.query(
          "insert into application_notes (id, application_id, author_account_id, category, body) values ($1, $2, $3, $4, $5)",
          [id, applicationId, actor.accountId, input.category, input.body]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application.note_added",
          subjectType: "Application",
          subjectId: applicationId,
          reason: `${input.category} note`,
          afterRef: id
        });
        return { id, category: input.category };
      });
    },

    async recordDecision(actor, applicationId, input) {
      requireFields(input, ["decision"]);
      if (input.decision === "defer") {
        const result = await this.resolveDeferral(actor, applicationId, { decision: "approve", reason: input.note, targetIntakeId: input.targetIntakeId });
        return { ...result, decision: "defer" };
      }
      if (!["offer", "reject"].includes(input.decision)) {
        throw requestError(400, "decision must be offer or reject.");
      }
      const conditions = input.conditions || [];
      if (!Array.isArray(conditions) || conditions.length > 10 || conditions.some((item) => typeof item !== "string" || item.length > 300)) {
        throw requestError(400, "conditions must be up to 10 short statements.");
      }
      const expiresInDays = input.offerExpiresInDays ?? 21;
      if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
        throw requestError(400, "offerExpiresInDays must be 1-90.");
      }

      return withTransaction(pool, async (client) => {
        const application = await loadForStaff(client, actor, applicationId, { forUpdate: true });
        if (application.workflowState !== "Decision") {
          throw requestError(409, `Decisions are recorded at the Decision step; this application is at ${application.workflowState || application.status}.`);
        }
        const scope = await getResourceScope(client, "Application", applicationId);
        assertActorCanAccessScope({ ...actor, authorizingPermission: "admissions.decide" }, scope);

        let reasonLabel = null;
        if (input.decision === "reject") {
          requireFields(input, ["reasonCode"]);
          const reason = await client.query(
            "select label from reference_values where list_code = 'decision_reason' and value_code = $1 and status = 'active'",
            [input.reasonCode]
          );
          if (reason.rowCount === 0) {
            throw requestError(400, `reasonCode ${input.reasonCode} is not an active decision reason.`);
          }
          reasonLabel = reason.rows[0].label;
        } else {
          // Serialise offers per intake so two deciders cannot oversubscribe the last seat.
          await client.query("select pg_advisory_xact_lock(hashtext($1))", [`intake-seats:${application.intakeId}`]);
          const seats = await client.query(
            intakeSeatsSql,
            [application.intakeId]
          );
          if (seats.rows[0].used >= seats.rows[0].capacity) {
            throw requestError(409, `The intake is full (${seats.rows[0].used} of ${seats.rows[0].capacity} places offered or accepted).`);
          }
        }

        const toState = input.decision === "offer" ? "Offer issued" : "Rejected";
        await transitionWorkflowInTransaction(client, application.workflowInstanceId, {
          toState,
          actorId: actor.accountId,
          reason: input.note || (input.decision === "offer" ? "Offer issued" : `Rejected: ${reasonLabel}`),
          permissions: actor.permissions
        });
        const decisionId = `dec_${randomUUID()}`;
        const offerExpiresAt = input.decision === "offer" ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
        await client.query(
          `insert into application_decisions (id, application_id, decision, reason_code, conditions, offer_expires_at, decided_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [decisionId, applicationId, input.decision, input.reasonCode || null, JSON.stringify(conditions), offerExpiresAt, actor.accountId]
        );
        if (input.note) {
          await client.query(
            "insert into application_notes (id, application_id, author_account_id, category, body) values ($1, $2, $3, 'academic', $4)",
            [`note_${randomUUID()}`, applicationId, actor.accountId, `Decision note: ${input.note}`]
          );
        }
        const facts = (await applicantFacts(client, [applicationId])).get(applicationId);
        const programme = `${application.programmeName} (${application.intakeLabel})`;
        if (input.decision === "offer") {
          await queueNotification(client, facts.accountId, "admissions.offer_issued", {
            referenceNumber: application.referenceNumber,
            programme,
            conditions: conditions.length > 0 ? `This offer is conditional on: ${conditions.join("; ")}.` : "This is an unconditional offer.",
            expiresOn: offerExpiresAt.toISOString().slice(0, 10)
          },{link:'#apply'});
        } else {
          await queueNotification(client, facts.accountId, "admissions.application_unsuccessful", {
            referenceNumber: application.referenceNumber,
            programme,
            reason: reasonLabel
          },{link:'#apply'});
        }
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.decision.recorded",
          subjectType: "Application",
          subjectId: applicationId,
          reason: input.decision === "offer" ? "Offer issued" : `Rejected: ${reasonLabel}`,
          afterRef: decisionId,
          metadata: { decision: input.decision, reasonCode: input.reasonCode || null, conditions }
        });
        return {
          id: applicationId,
          decisionId,
          decision: input.decision,
          workflowState: toState,
          offerExpiresAt: offerExpiresAt?.toISOString() ?? null
        };
      });
    },

    // Offers past their deadline free their seats. Safe to run repeatedly (e.g. from a scheduler).
    async expireOffers(actor) {
      const overdue = await pool.query(
        `select d.id, d.application_id, a.workflow_instance_id
         from application_decisions d
         join applications a on a.id = d.application_id
         join workflow_instances w on w.id = a.workflow_instance_id
         where d.decision = 'offer' and d.response is null and d.offer_expires_at < now() and w.state = 'Offer issued'`
      );
      let expired = 0;
      for (const row of overdue.rows) {
        if (!actorCanAccessScope(actor, await getResourceScope(pool, "Application", row.application_id))) continue;
        await withTransaction(pool, async (client) => {
          await client.query("select id from applications where id = $1 for update", [row.application_id]);
          const current = await client.query("select 1 from workflow_instances where id = $1 and state = 'Offer issued'", [row.workflow_instance_id]);
          if (!current.rowCount) return;
          await expireOffer(client, row, actor.accountId);
          expired += 1;
        });
      }
      return { expired };
    },

    // Idempotent retry/backfill for conversion; returns the existing record if it already happened.
    async convertApplication(actor, applicationId) {
      await loadForStaff(pool, actor, applicationId);
      return withTransaction(pool, (client) => convertAcceptedApplication(client, applicationId, actor.accountId));
    },

    async getIntakeManifest(actor, intakeId) {
      const intake = await pool.query(
        `select i.id, i.label, i.capacity, i.status, p.code as "programmeCode", p.name as "programmeName"
         from intakes i join programmes p on p.id = i.programme_id where i.id = $1`,
        [intakeId]
      );
      if (intake.rowCount === 0) {
        throw requestError(404, "Intake was not found.");
      }
      assertActorCanAccessScope(actor, { programmeCode: intake.rows[0].programmeCode, intakeId });
      const byState = await pool.query(
        `select coalesce(w.state, 'Draft (not submitted)') as state, count(*)::int as count
         from applications a left join workflow_instances w on w.id = a.workflow_instance_id
         where a.intake_id = $1 and (a.workflow_instance_id is not null or a.status <> 'withdrawn')
         group by 1 order by 1`,
        [intakeId]
      );
      const accepted = await pool.query(
        `select a.reference_number as "referenceNumber", s.student_number as "studentNumber", pe.legal_name as "legalName",
                sp.status as "onboardingStatus"
         from applications a
         join workflow_instances w on w.id = a.workflow_instance_id
         join accounts acc on acc.id = a.applicant_account_id
         join people pe on pe.id = acc.person_id
         left join student_programmes sp on sp.application_id = a.id and sp.origin_programme_id is null
         left join students s on s.id = sp.student_id
         where a.intake_id = $1 and w.state = 'Accepted'
         order by a.reference_number`,
        [intakeId]
      );
      const counts = Object.fromEntries(byState.rows.map((row) => [row.state, row.count]));
      const transferPlaces = (await pool.query(`select ${transferredSeatsSql} as count from intakes i where i.id = $1`,[intakeId])).rows[0].count;
      const placesTaken = (counts["Offer issued"] || 0) + (counts.Accepted || 0) + transferPlaces;
      return {
        intake: intake.rows[0],
        counts,
        placesTaken,
        transferPlaces,
        placesRemaining: Math.max(intake.rows[0].capacity - placesTaken, 0),
        accepted: accepted.rows,
        notConverted: accepted.rows.filter((row) => !row.studentNumber).length
      };
    },

    async requestInformation(actor, applicationId, input) {
      requireFields(input, ["message"]);
      if (!actor.permissions.includes("workflow.transition")) {
        throw requestError(403, "Permission required: workflow.transition");
      }
      return withTransaction(pool, async (client) => {
        const application = await loadForStaff(client, actor, applicationId, { forUpdate: true });
        if (!application.workflowInstanceId) {
          throw requestError(409, "Only submitted applications can be sent back for information.");
        }
        // Moving the workflow must also be within the scope of the roles that grant workflow.transition.
        assertActorCanAccessScope(
          { ...actor, authorizingPermission: "workflow.transition" },
          await getResourceScope(client, "Application", applicationId)
        );
        await transitionWorkflowInTransaction(client, application.workflowInstanceId, {
          toState: "Information requested",
          actorId: actor.accountId,
          reason: input.message
        });
        const facts = (await applicantFacts(client, [applicationId])).get(applicationId);
        await queueNotification(client, facts.accountId, "admissions.information_requested", {
          referenceNumber: application.referenceNumber,
          message: input.message
        },{link:'#apply'});
        await client.query("insert into application_messages (id, application_id, author_account_id, body) values ($1, $2, $3, $4)",
          [`msg_${randomUUID()}`, applicationId, actor.accountId, input.message]);
        await client.query(
          "insert into application_notes (id, application_id, author_account_id, category, body) values ($1, $2, $3, 'completeness', $4)",
          [`note_${randomUUID()}`, applicationId, actor.accountId, `Information requested: ${input.message}`]
        );
        return { id: applicationId, state: "Information requested" };
      });
    }
  };
}
