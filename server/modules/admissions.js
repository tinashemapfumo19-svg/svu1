import { randomUUID } from "node:crypto";
import { queueNotification } from "../notification-queue.js";
import { lockAccountMailbox } from "../account-mailbox.js";
import { convertAcceptedApplication } from "./student-conversion.js";
import { requiredDocuments } from "./admissions-routing.js";
import { transferredSeatsSql } from "./intake-capacity.js";
import { startWorkflowInTransaction, transitionWorkflowInTransaction } from "./workflow.js";
import { createSecret, digestToken, normalizeEmail } from "../security.js";
import {
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  todayIso,
  withTransaction
} from "../support.js";

// Stage 2 admissions: public intake catalogue (ADM-05), applicant self-registration (ADM-01), and the
// reusable applicant profile captured against governed reference data (ADM-03, ADM-04).

const maxRegistrationsPerHour = 3;
const intakeTransitions = { draft: ["published"], published: ["closed"], closed: [] };
const profileFields = ["dateOfBirth", "nationalityCode", "phone", "priorLevelCode", "studyModeCode"];
const waiverCodes = new Set(["SVU-WAIVER-2027", "STAFF-DEPENDANT", "PARTNER-SCHOLARSHIP"]);

export function profileCompleteness(profile) {
  const missing = profileFields.filter((field) => !profile?.[field]);
  if (!profile?.address?.line1 || !profile?.address?.city || !profile?.address?.countryCode) {
    missing.push("address");
  }
  return { complete: missing.length === 0, missing };
}

export function assertProfileInput(input, today = todayIso()) {
  const problems = [];
  if (input.dateOfBirth !== undefined) {
    // parseEffectiveDate round-trips the date, so impossible dates such as 2006-02-30 are refused.
    let valid = true;
    try {
      parseEffectiveDate(input.dateOfBirth);
    } catch {
      valid = false;
    }
    const age = valid ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${input.dateOfBirth}T00:00:00Z`)) / (365.25 * 86_400_000) : -1;
    if (!valid || age < 14 || age > 100) {
      problems.push("dateOfBirth must be a real date for an applicant aged 14-100");
    }
  }
  if (input.phone !== undefined && !/^\+[1-9]\d{7,14}$/.test(input.phone)) {
    problems.push("phone must be in international format, e.g. +263771234567");
  }
  if (input.address !== undefined) {
    const address = input.address || {};
    if (typeof address !== "object" || Array.isArray(address)) {
      problems.push("address must be an object");
    } else if (["line1", "line2", "city", "postalCode"].some((key) => address[key] !== undefined && String(address[key]).length > 200)) {
      problems.push("address lines must be 200 characters or fewer");
    }
  }
  if (problems.length > 0) {
    throw requestError(400, `Profile rejected: ${problems.join("; ")}.`);
  }
}

export function createAdmissionsModule(pool, { devOutboxDir = null, dataEncryptionKey } = {}) {
  return {
    async listCatalogue() {
      const result = await pool.query(
        `select
          i.id as "intakeId",
          i.label,
          i.capacity,
          greatest(i.capacity - (select count(*)::int from applications a2 join workflow_instances w2 on w2.id = a2.workflow_instance_id where a2.intake_id = i.id and w2.state in ('Offer issued', 'Accepted')) - ${transferredSeatsSql}, 0) as "placesRemaining",
          coalesce(pr.route_code, 'undergraduate') as "reviewRoute",
          to_char(i.starts_on, 'YYYY-MM-DD') as "startsOn",
          i.application_opens_at as "applicationOpensAt",
          i.application_closes_at as "applicationClosesAt",
          (i.application_opens_at <= now() and i.application_closes_at >= now()) as "applicationsOpen",
          p.id as "programmeId",
          p.code as "programmeCode",
          p.name as "programmeName",
          d.name as "department",
          f.name as "faculty",
          v.id as "programmeVersionId",
          v.version_label as "programmeVersion",
          coalesce(v.requirements, '{}'::jsonb) as requirements
        from intakes i
        join programmes p on p.id = i.programme_id
        left join admissions_programme_routes pr on pr.programme_id = p.id
        join organization_units d on d.id = p.department_id
        left join organization_units f on f.id = d.parent_id
        left join lateral (
          select id, version_label, requirements
          from programme_versions
          where programme_id = p.id
            and status in ('published', 'retired')
            and effective_from <= i.starts_on
            and (effective_to is null or effective_to >= i.starts_on)
          order by effective_from desc
          limit 1
        ) v on true
        where i.status = 'published'
          and i.application_closes_at >= now()
        order by i.starts_on, p.code`
      );
      return result.rows;
    },

    async transitionIntake(intakeId, input, actor) {
      requireFields(input, ["toStatus", "reason"]);
      return withTransaction(pool, async (client) => {
        const found = await client.query(
          `select i.*, p.status as programme_status
           from intakes i join programmes p on p.id = i.programme_id
           where i.id = $1 for update of i`,
          [intakeId]
        );
        if (found.rowCount === 0) {
          throw requestError(404, "Intake was not found.");
        }
        const intake = found.rows[0];
        if (!(intakeTransitions[intake.status] || []).includes(input.toStatus)) {
          throw requestError(409, `Cannot move an intake from ${intake.status} to ${input.toStatus}.`);
        }
        if (input.toStatus === "published") {
          const problems = [];
          if (!intake.starts_on) problems.push("set startsOn (the entry date)");
          if (!intake.application_opens_at || !intake.application_closes_at || intake.application_opens_at >= intake.application_closes_at) {
            problems.push("set an application window that opens before it closes");
          }
          if (!(intake.capacity > 0)) problems.push("set a capacity above zero");
          if (intake.programme_status === "retired") problems.push("the programme is retired");
          if (intake.starts_on) {
            const version = await client.query(
              `select 1 from programme_versions
               where programme_id = $1 and status = 'published'
                 and effective_from <= $2 and (effective_to is null or effective_to >= $2)`,
              [intake.programme_id, intake.starts_on]
            );
            if (version.rowCount === 0) problems.push("publish a programme version in force on the entry date");
          }
          if (problems.length > 0) {
            throw requestError(409, `Intake cannot be published: ${problems.join("; ")}.`);
          }
        }
        await client.query(
          `update intakes
           set status = $1,
               published_at = case when $1 = 'published' then now() else published_at end,
               published_by = case when $1 = 'published' then $2 else published_by end,
               closed_at = case when $1 = 'closed' then now() else closed_at end
           where id = $3`,
          [input.toStatus, actor.accountId, intakeId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: `admissions.intake.${input.toStatus}`,
          subjectType: "Intake",
          subjectId: intakeId,
          reason: input.reason,
          beforeRef: intake.status,
          afterRef: input.toStatus
        });
        return { id: intakeId, status: input.toStatus };
      });
    },

    // Always answers the same way so the endpoint cannot be used to discover registered emails.
    async registerApplicant(input) {
      requireFields(input, ["email", "preferredName", "legalName"]);
      const email = normalizeEmail(input.email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
        throw requestError(400, "Enter a valid email address.");
      }
      const accepted = {
        status: "accepted",
        message: "Check your email for a code to finish creating your account."
      };

      await withTransaction(pool, async (client) => {
        await lockAccountMailbox(client, email);
        const recent = await client.query(
          "select count(*)::int as count from invitations where lower(btrim(email)) = $1 and created_at > clock_timestamp() - interval '1 hour'",
          [email]
        );
        if (recent.rows[0].count >= maxRegistrationsPerHour) return;
        const existing = await client.query("select id from accounts where lower(btrim(email)) = $1 limit 2", [email]);
        if (existing.rows.length > 1) return;
        if (existing.rowCount > 0) {
          await queueNotification(client, existing.rows[0].id, "admissions.registration_existing", {});
          await insertAudit(client, {
            actorId: "anonymous",
            action: "admissions.registration.existing_account",
            subjectType: "Account",
            subjectId: existing.rows[0].id,
            reason: "Registration attempted for an existing account"
          });
          return;
        }

        const invitationId = `inv_${randomUUID()}`;
        const activationToken = createSecret();
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
        await client.query(
          `insert into invitations (id, email, role_code, scope, status, expires_at)
           values ($1, $2, 'applicant', '{}'::jsonb, 'pending_activation', $3)`,
          [invitationId, email, expiresAt]
        );
        await client.query(
          `insert into account_activation_tokens (id, invitation_id, email, token_digest, status, expires_at)
           values ($1, $2, $3, $4, 'active', $5)`,
          [`act_${randomUUID()}`, invitationId, email, digestToken(activationToken), expiresAt]
        );
        // There is no account yet, so the message is addressed to the invitation.
        await queueNotification(client, null, "admissions.registration_activation", {
          preferredName: input.preferredName,
          activationToken
        }, { sensitive: true, devOutboxDir, recipientEmail: email, dataEncryptionKey });
        await insertAudit(client, {
          actorId: "anonymous",
          action: "admissions.registration.requested",
          subjectType: "Invitation",
          subjectId: invitationId,
          reason: "Applicant self-registration"
        });
      });
      return accepted;
    },

    async createApplication(actor, input) {
      requireFields(input, ["intakeId"]);
      return withTransaction(pool, async (client) => {
        const intake = await loadOpenIntake(client, input.intakeId);
        const id = `app_${randomUUID()}`;
        try {
          await client.query(
            `insert into applications (id, applicant_account_id, intake_id, programme_version_id, study_mode_code, status)
             values ($1, $2, $3, $4, $5, 'draft')`,
            [id, actor.accountId, intake.id, intake.programmeVersionId, input.studyModeCode || null]
          );
        } catch (error) {
          if (error.code === "23505") {
            throw requestError(409, "You already have an application for this intake.");
          }
          throw error;
        }
        await client.query(`update applications set review_route = coalesce(
          (select route_code from admissions_programme_routes where programme_id =
            (select programme_id from intakes where id = $1)), 'undergraduate') where id = $2`, [intake.id, id]);
        // Staff access to the application and its documents is scoped by programme and intake.
        await client.query(
          `insert into resource_scopes (id, resource_type, resource_id, programme_code, intake_id)
           values ($1, 'Application', $2, $3, $4)`,
          [`scope_${randomUUID()}`, id, intake.programmeCode, intake.id]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application.started",
          subjectType: "Application",
          subjectId: id,
          reason: `Started application for ${intake.programmeCode} ${intake.label}`
        });
        return { id, status: "draft", intakeId: intake.id, programmeCode: intake.programmeCode };
      });
    },

    async listMyApplications(actor) {
      const result = await pool.query(
        `${applicationSelect} where a.applicant_account_id = $1 order by a.created_at desc`,
        [actor.accountId]
      );
      return result.rows;
    },

    async getApplication(actor, applicationId) {
      const application = await loadOwnedApplication(pool, actor, applicationId);
      const checklist = await buildChecklist(pool, application);
      const profile = await this.getApplicantProfile(actor);
      const fee = await loadFeeAcknowledgement(pool, applicationId);
      const decision = await pool.query(
        `select d.decision, d.conditions, d.offer_expires_at as "offerExpiresAt", d.response, d.responded_at as "respondedAt",
                r.label as reason
         from application_decisions d
         left join reference_values r on r.list_code = 'decision_reason' and r.value_code = d.reason_code
         where d.application_id = $1 order by d.decided_at desc limit 1`,
        [applicationId]
      );
      return {
        ...application,
        ...await this.getApplicationActivity(actor, applicationId),
        checklist,
        fee,
        readiness: readinessFor({ ...application, fee }, checklist, profile),
        decision: decision.rows[0] || null
      };
    },

    async updateApplication(actor, applicationId, input) {
      if (input.answers !== undefined) {
        if (typeof input.answers !== "object" || input.answers === null || Array.isArray(input.answers)) {
          throw requestError(400, "answers must be an object.");
        }
        if (JSON.stringify(input.answers).length > 20_000) {
          throw requestError(400, "answers must be under 20 KB.");
        }
      }
      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        if (application.status !== "draft") {
          throw requestError(409, `A ${application.status} application can no longer be edited.`);
        }
        if (input.answers?.applicantCategory !== undefined && !["standard", ...Object.keys(application.requirements.documentsByCategory || {})].includes(input.answers.applicantCategory)) {
          throw requestError(400, "Choose a configured applicant category.");
        }
        if (input.studyModeCode !== undefined) {
          const mode = await client.query(
            "select 1 from reference_values where list_code = 'study_mode' and value_code = $1 and status = 'active'",
            [input.studyModeCode]
          );
          if (mode.rowCount === 0) {
            throw requestError(400, `studyModeCode ${input.studyModeCode} is not an active study mode.`);
          }
        }
        await client.query(
          `update applications
           set study_mode_code = coalesce($1, study_mode_code),
               answers = case when $2::jsonb is null then answers else answers || $2::jsonb end,
               updated_at = now()
           where id = $3`,
          [input.studyModeCode ?? null, input.answers === undefined ? null : JSON.stringify(input.answers), applicationId]
        );
        return null;
      }).then(() => this.getApplication(actor, applicationId));
    },

    async acknowledgeApplicationFee(actor, applicationId, input) {
      requireFields(input, ["method", "reference"]);
      if (!["provider_reference", "waiver_code"].includes(input.method)) {
        throw requestError(400, "method must be provider_reference or waiver_code.");
      }
      const reference = String(input.reference || "").trim().toUpperCase();
      if (input.method === "provider_reference" && !/^SVU-PAY-[A-Z0-9]{6,24}$/.test(reference)) {
        throw requestError(400, "provider_reference must look like SVU-PAY- followed by 6-24 letters or numbers.");
      }
      if (input.method === "waiver_code" && !waiverCodes.has(reference)) {
        throw requestError(400, "waiver_code is not valid for this pilot.");
      }

      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        if (application.status !== "draft") {
          throw requestError(409, `A ${application.status} application can no longer change fee details.`);
        }
        const status = input.method === "waiver_code" ? "waived" : "verified";
        const id = `fee_${randomUUID()}`;
        await client.query(
          `insert into application_fee_acknowledgements (id, application_id, method, reference, status)
           values ($1, $2, $3, $4, $5)
           on conflict (application_id) do update set
             method = excluded.method,
             reference = excluded.reference,
             status = excluded.status,
             verified_at = now()`,
          [id, applicationId, input.method, reference, status]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application_fee.acknowledged",
          subjectType: "Application",
          subjectId: applicationId,
          reason: status === "waived" ? "Application fee waived" : "Application fee reference verified",
          metadata: { method: input.method, status }
        });
        return null;
      }).then(() => this.getApplication(actor, applicationId));
    },

    // Used before issuing an upload link for an applicant's own draft application.
    async assertApplicationDocumentAllowed(actor, applicationId, documentType) {
      const application = await loadOwnedApplication(pool, actor, applicationId);
      if (application.status !== "draft" && application.workflowState !== "Information requested") {
        throw requestError(409, "Documents can only be added to a draft, or when admissions has asked for more information.");
      }
      const required = requiredDocuments(application);
      if (!required.includes(documentType) && documentType !== "other") {
        throw requestError(400, `documentType must be one of ${[...required, "other"].join(", ")}.`);
      }
      return application;
    },

    async submitApplication(actor, applicationId) {
      const preview = await this.getApplication(actor, applicationId);
      if (preview.status !== "draft") {
        throw requestError(409, `This application is already ${preview.status}.`);
      }
      if (!preview.readiness.ready) {
        throw requestError(409, `Not ready to submit: ${preview.readiness.blockers.join("; ")}.`);
      }

      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        if (application.status !== "draft") {
          throw requestError(409, `This application is already ${application.status}.`);
        }
        const intake = await loadOpenIntake(client, application.intakeId);
        const checklist = await buildChecklist(client, application);
        const profile = await client.query("select 1 from applicant_profiles where account_id = $1", [actor.accountId]);
        const fee = await loadFeeAcknowledgement(client, applicationId);
        if (!profile.rowCount || checklist.some((item) => !item.satisfied) || !fee) {
          throw requestError(409, "Submission readiness changed. Refresh and check your documents and fee.");
        }
        const route = await client.query("select definition_code from admissions_routes where code = $1", [application.reviewRoute]);
        const sequence = await client.query("select nextval('application_reference_seq') as value");
        const referenceNumber = `SVU-${intake.startsOn.slice(0, 4)}-${String(sequence.rows[0].value).padStart(6, "0")}`;
        const workflow = await startWorkflowInTransaction(client, {
          definitionCode: route.rows[0].definition_code,
          subjectType: "Application",
          subjectId: applicationId,
          ownerAccountId: null,
          actorId: actor.accountId,
          reason: `Application ${referenceNumber} submitted`,
          moveTo: ["Submitted"]
        });
        await client.query(
          `update applications
           set status = 'submitted', reference_number = $1, workflow_instance_id = $2, submitted_at = now(), updated_at = now()
           where id = $3`,
          [referenceNumber, workflow.id, applicationId]
        );
        await queueNotification(client, actor.accountId, "admissions.application_received", {
          referenceNumber,
          programme: `${intake.programmeName} (${intake.label})`
        },{link:'#apply'});
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application.submitted",
          subjectType: "Application",
          subjectId: applicationId,
          reason: `Submitted as ${referenceNumber}`,
          afterRef: workflow.id
        });
        return { id: applicationId, status: "submitted", referenceNumber, workflowInstanceId: workflow.id, workflowState: workflow.state };
      });
    },

    async respondToInformationRequest(actor, applicationId, input) {
      requireFields(input, ["message"]);
      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        if (application.workflowState !== "Information requested") {
          throw requestError(409, "Admissions has not asked for more information on this application.");
        }
        await transitionWorkflowInTransaction(client, application.workflowInstanceId, {
          toState: "Completeness review",
          actorId: actor.accountId,
          reason: `Applicant response: ${String(input.message).slice(0, 500)}`
        });
        await client.query(
          "insert into application_notes (id, application_id, author_account_id, category, body) values ($1, $2, $3, 'completeness', $4)",
          [`note_${randomUUID()}`, applicationId, actor.accountId, `Applicant response: ${String(input.message).slice(0, 5000)}`]
        );
        return { id: applicationId, state: "Completeness review" };
      });
    },

    async respondToOffer(actor, applicationId, input) {
      requireFields(input, ["response"]);
      if (!["accept", "decline"].includes(input.response)) {
        throw requestError(400, "response must be accept or decline.");
      }
      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        const offer = await client.query(
          `select id, application_id, offer_expires_at, $2::text as workflow_instance_id
           from application_decisions
           where application_id = $1 and decision = 'offer' and response is null
           order by decided_at desc limit 1`,
          [applicationId, application.workflowInstanceId]
        );
        if (offer.rowCount === 0 || application.workflowState !== "Offer issued") {
          throw requestError(409, "There is no open offer on this application.");
        }
        if (new Date(offer.rows[0].offer_expires_at) < new Date()) {
          await expireOffer(client, offer.rows[0], actor.accountId);
          // Commit the expiry, then tell the applicant.
          return { expired: true };
        }
        const toState = input.response === "accept" ? "Accepted" : "Declined";
        await transitionWorkflowInTransaction(client, application.workflowInstanceId, {
          toState,
          actorId: actor.accountId,
          reason: input.response === "accept" ? "Applicant accepted the offer" : `Applicant declined: ${input.reason || "no reason given"}`
        });
        await client.query(
          "update application_decisions set response = $1, responded_at = now() where id = $2",
          [input.response === "accept" ? "accepted" : "declined", offer.rows[0].id]
        );
        await client.query("update application_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_reason = 'Applicant responded to the offer' where application_id = $2 and status = 'pending'", [actor.accountId, applicationId]);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: `admissions.offer.${input.response === "accept" ? "accepted" : "declined"}`,
          subjectType: "Application",
          subjectId: applicationId,
          reason: input.reason || `Offer ${input.response}ed`,
          beforeRef: offer.rows[0].id
        });
        // Accepting starts onboarding in the same transaction, exactly once.
        const student = toState === "Accepted" ? await convertAcceptedApplication(client, applicationId, actor.accountId) : null;
        return { id: applicationId, workflowState: toState, studentNumber: student?.studentNumber ?? null };
      }).then((result) => {
        if (result.expired) {
          throw requestError(409, "This offer has expired.");
        }
        return result;
      });
    },

    async withdrawApplication(actor, applicationId, input) {
      requireFields(input, ["reason"]);
      return withTransaction(pool, async (client) => {
        const application = await loadOwnedApplication(client, actor, applicationId, { forUpdate: true });
        if (application.status === "withdrawn") {
          throw requestError(409, "This application is already withdrawn.");
        }
        if (application.workflowInstanceId) {
          await transitionWorkflowInTransaction(client, application.workflowInstanceId, {
            toState: "Withdrawn",
            actorId: actor.accountId,
            reason: input.reason
          });
        }
        await client.query(
          "update applications set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = $1",
          [applicationId]
        );
        await client.query("update application_decisions set response = 'withdrawn', responded_at = now() where application_id = $1 and decision = 'offer' and response is null", [applicationId]);
        await client.query("update application_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_reason = 'Application withdrawn' where application_id = $2 and status = 'pending'", [actor.accountId, applicationId]);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.application.withdrawn",
          subjectType: "Application",
          subjectId: applicationId,
          reason: input.reason
        });
        return { id: applicationId, status: "withdrawn" };
      });
    },

    async getApplicantProfile(actor) {
      const result = await pool.query(
        `select
          to_char(date_of_birth, 'YYYY-MM-DD') as "dateOfBirth",
          nationality_code as "nationalityCode",
          phone,
          prior_level_code as "priorLevelCode",
          study_mode_code as "studyModeCode",
          address,
          updated_at as "updatedAt"
         from applicant_profiles where account_id = $1`,
        [actor.accountId]
      );
      const profile = result.rows[0] || null;
      return { profile, ...profileCompleteness(profile) };
    },

    async saveApplicantProfile(actor, input) {
      assertProfileInput(input);
      return withTransaction(pool, async (client) => {
        // Once a student record exists, identity fields change only through a reviewed identity correction.
        if (input.dateOfBirth !== undefined || input.nationalityCode !== undefined) {
          const governed = (await client.query(`select to_char(p.date_of_birth, 'YYYY-MM-DD') as "dateOfBirth", p.nationality_code as "nationalityCode"
            from students s left join applicant_profiles p on p.account_id = s.account_id where s.account_id = $1`, [actor.accountId])).rows[0];
          if (governed && ["dateOfBirth", "nationalityCode"].some((field) => input[field] !== undefined && input[field] !== governed[field])) {
            throw requestError(409, "Student identity is governed by the registry. Request an identity correction instead.");
          }
        }
        // Coded answers must be active values from the governed reference lists.
        for (const [field, listCode] of [["nationalityCode", "country"], ["priorLevelCode", "academic_level"], ["studyModeCode", "study_mode"]]) {
          if (input[field] === undefined) continue;
          const value = await client.query(
            "select 1 from reference_values where list_code = $1 and value_code = $2 and status = 'active'",
            [listCode, input[field]]
          );
          if (value.rowCount === 0) {
            throw requestError(400, `${field} ${input[field]} is not an active ${listCode} value.`);
          }
        }
        if (input.address?.countryCode !== undefined) {
          const country = await client.query(
            "select 1 from reference_values where list_code = 'country' and value_code = $1 and status = 'active'",
            [input.address.countryCode]
          );
          if (country.rowCount === 0) {
            throw requestError(400, `address.countryCode ${input.address.countryCode} is not an active country.`);
          }
        }
        await client.query(
          `insert into applicant_profiles (account_id, date_of_birth, nationality_code, phone, prior_level_code, study_mode_code, address, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, now())
           on conflict (account_id) do update set
             date_of_birth = coalesce(excluded.date_of_birth, applicant_profiles.date_of_birth),
             nationality_code = coalesce(excluded.nationality_code, applicant_profiles.nationality_code),
             phone = coalesce(excluded.phone, applicant_profiles.phone),
             prior_level_code = coalesce(excluded.prior_level_code, applicant_profiles.prior_level_code),
             study_mode_code = coalesce(excluded.study_mode_code, applicant_profiles.study_mode_code),
             address = case when $8 then excluded.address else applicant_profiles.address end,
             updated_at = now()`,
          [actor.accountId, input.dateOfBirth ?? null, input.nationalityCode ?? null, input.phone ?? null,
            input.priorLevelCode ?? null, input.studyModeCode ?? null, input.address || {}, input.address !== undefined]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "admissions.profile.updated",
          subjectType: "ApplicantProfile",
          subjectId: actor.accountId,
          reason: "Applicant updated profile",
          metadata: { fields: Object.keys(input) }
        });
        return null;
      }).then(() => this.getApplicantProfile(actor));
    }
  };
}

export const applicationSelect = `select
  a.id,
  a.status,
  a.reference_number as "referenceNumber",
  a.intake_id as "intakeId",
  i.label as "intakeLabel",
  to_char(i.starts_on, 'YYYY-MM-DD') as "startsOn",
  p.code as "programmeCode",
  p.name as "programmeName",
  a.programme_version_id as "programmeVersionId",
  coalesce(v.requirements, '{}'::jsonb) as requirements,
  a.study_mode_code as "studyModeCode",
  a.answers,
  a.review_route as "reviewRoute",
  a.workflow_instance_id as "workflowInstanceId",
  w.state as "workflowState",
  w.owner_account_id as "ownerAccountId",
  a.submitted_at as "submittedAt",
  a.withdrawn_at as "withdrawnAt",
  a.created_at as "createdAt",
  a.updated_at as "updatedAt"
from applications a
join intakes i on i.id = a.intake_id
join programmes p on p.id = i.programme_id
left join programme_versions v on v.id = a.programme_version_id
left join workflow_instances w on w.id = a.workflow_instance_id`;

// Applicants only ever see their own applications; anything else looks like it does not exist.
export async function loadOwnedApplication(db, actor, applicationId, { forUpdate = false } = {}) {
  const result = await db.query(
    `${applicationSelect} where a.id = $1 and a.applicant_account_id = $2 ${forUpdate ? "for update of a" : ""}`,
    [applicationId, actor.accountId]
  );
  if (result.rowCount === 0) {
    throw requestError(404, "Application was not found.");
  }
  return result.rows[0];
}

async function loadOpenIntake(db, intakeId) {
  const result = await db.query(
    `select
      i.id,
      i.label,
      to_char(i.starts_on, 'YYYY-MM-DD') as "startsOn",
      p.code as "programmeCode",
      p.name as "programmeName",
      (
        select v.id from programme_versions v
        where v.programme_id = p.id and v.status in ('published', 'retired')
          and v.effective_from <= i.starts_on and (v.effective_to is null or v.effective_to >= i.starts_on)
        order by v.effective_from desc limit 1
      ) as "programmeVersionId"
     from intakes i join programmes p on p.id = i.programme_id
     where i.id = $1 and i.status = 'published'
       and i.application_opens_at <= now() and i.application_closes_at >= now()`,
    [intakeId]
  );
  if (result.rowCount === 0) {
    throw requestError(409, "This intake is not open for applications.");
  }
  return result.rows[0];
}

export async function buildChecklist(db, application) {
  const required = requiredDocuments(application);
  const documents = await db.query(
    `select id, document_type as "documentType", lifecycle, file_name as "fileName", created_at as "createdAt"
     from documents where owner_type = 'Application' and owner_id = $1
     order by created_at desc`,
    [application.id]
  );
  return required.map((documentType) => {
    const uploads = documents.rows.filter((document) => document.documentType === documentType);
    const satisfying = uploads.find((document) => ["available", "verified"].includes(document.lifecycle));
    return {
      documentType,
      satisfied: Boolean(satisfying),
      status: satisfying ? satisfying.lifecycle : uploads[0]?.lifecycle || "missing",
      documents: uploads
    };
  });
}

export function readinessFor(application, checklist, profile) {
  const blockers = [];
  if (!profile.complete) {
    blockers.push(`complete your profile (${profile.missing.join(", ")})`);
  }
  if (!application.studyModeCode && !profile.profile?.studyModeCode) {
    blockers.push("choose a study mode");
  }
  for (const item of checklist.filter((entry) => !entry.satisfied)) {
    blockers.push(`${item.documentType} is ${item.status === "missing" ? "missing" : `still ${item.status}`}`);
  }
  if (!application.fee?.status) {
    blockers.push("verify your application fee or waiver code");
  }
  if (!application.programmeVersionId) {
    blockers.push("the programme has no published version for this intake");
  }
  return { ready: blockers.length === 0, blockers };
}

async function loadFeeAcknowledgement(db, applicationId) {
  const result = await db.query(
    `select method, reference, status, verified_at as "verifiedAt"
     from application_fee_acknowledgements
     where application_id = $1`,
    [applicationId]
  );
  return result.rows[0] || null;
}

export async function expireOffer(client, offer, actorId) {
  await transitionWorkflowInTransaction(client, offer.workflow_instance_id, {
    toState: "Expired",
    actorId,
    reason: "Offer deadline passed without a response"
  });
  await client.query("update application_decisions set response = 'expired', responded_at = now() where id = $1", [offer.id]);
  await client.query("update application_requests set status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_reason = 'Offer expired' where application_id = $2 and status = 'pending'", [actorId, offer.application_id]);
  await insertAudit(client, {
    actorId,
    action: "admissions.offer.expired",
    subjectType: "Application",
    subjectId: offer.application_id,
    reason: "Offer deadline passed",
    beforeRef: offer.id
  });
}
