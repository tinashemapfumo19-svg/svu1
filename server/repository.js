import { randomUUID } from "node:crypto";
import { accountMailbox, lockAccountMailbox, requireNewAccountMailbox } from './account-mailbox.js';
import { createSecret, digestToken, hashSecret, normalizeEmail, passwordProblems, verifySecret } from "./security.js";
import {
  assertActorCanAccessScope,
  actorCanAccessScope,
  assertSeparateApprover,
  getResourceScope,
  insertAudit,
  parseEffectiveDate,
  requestError,
  requireFields,
  todayIso,
  withTransaction
} from "./support.js";
import { createAcademicCalendarModule } from "./modules/academic-calendar.js";
import { admissionsPlacesSql, transferredSeatsSql, intakeSeatsSql } from './modules/intake-capacity.js';
import { createReferenceDataModule } from "./modules/reference-data.js";
import { createWorkflowModule } from "./modules/workflow.js";
import { createIdentitySelfServiceModule } from "./modules/identity-self-service.js";
import { createAccountAdminModule } from "./modules/account-admin.js";
import { createNotificationInboxModule } from './modules/notification-inbox.js';
import { createPrivateMessagesModule } from './modules/private-messages.js';
import { createMessageRoomsModule } from './modules/message-rooms.js';
import { createChatCommandContextModule } from './modules/chat-command-context.js';
import { createEmailDelivery } from './email-delivery.js';
import { createIdentityMfaModule, mfaRequirement } from "./modules/identity-mfa.js";
import { assertCurriculumPublishable, createCurriculumModule } from "./modules/curriculum.js";
import { createGradingModule } from "./modules/grading.js";
import { createDocumentsModule } from "./modules/documents.js";
import { createExamPapersModule } from './modules/exam-papers.js';
import { createExamArrangementsModule } from './modules/exam-arrangements.js';
import { createAdmissionsModule } from "./modules/admissions.js";
import { createAdmissionsReviewModule } from "./modules/admissions-review.js";
import { createAdmissionsOperationsModule } from "./modules/admissions-operations.js";
import { createAdmissionsMigrationModule } from "./modules/admissions-migration.js";
import { validateAdmissionsRequirements } from "./modules/admissions-routing.js";
import { createRegistryModule } from "./modules/registry.js";
import { createCourseRegistrationModule } from "./modules/course-registration.js";
import { createResultsModule } from "./modules/results.js";
import { createAcademicProgressModule } from "./modules/academic-progress.js";
import { createProgrammeLifecycleModule } from "./modules/programme-lifecycle.js";
import { createCreditRecognitionModule } from "./modules/credit-recognition.js";
import { createProgrammeTransferModule } from "./modules/programme-transfer.js";
import { createIdentityCorrectionsModule } from "./modules/identity-corrections.js";
import { createDuplicateResolutionModule } from "./modules/duplicate-resolution.js";
import { createStudentFinanceModule } from "./modules/student-finance.js";
import { createFinanceAdjustmentsModule } from "./modules/finance-adjustments.js";
import { createPaymentImportsModule } from "./modules/payment-imports.js";
import { createFinanceMigrationModule } from "./modules/finance-migration.js";
import { createStaffModule, linkActivatedStaff } from "./modules/staff.js";
import { createStaffLeaveModule } from "./modules/staff-leave.js";
import { createAssetsModule } from "./modules/assets.js";
import {createFleetModule} from './modules/fleet.js';
import { createAssetReportingModule } from "./modules/asset-reporting.js";
import { createCashbookModule } from "./modules/cashbook.js";
import { createCashbookReportingModule } from "./modules/cashbook-reporting.js";
import { createRestrictedProfilesModule } from './modules/restricted-profiles.js';
import { createStudentSharingModule } from './modules/student-sharing.js';
import { createTeachingModule } from "./modules/teaching.js";
import { createCourseWorkspaceModule } from './modules/course-workspace.js';
import { createAutomationsModule } from './modules/automations.js';
import { createAiFeaturesModule } from './modules/ai-features.js';
import { createCalendarModule } from './modules/calendar.js';
import { createStudentLettersModule } from './modules/student-letters.js';
import { createStudentCardModule } from './modules/student-card.js';
import { createNotificationPreferencesModule } from './notification-preferences.js';
import { createAttendanceModule } from './modules/attendance.js';
import { createCourseEvaluationsModule } from './modules/course-evaluations.js';
import { createAppointmentsModule } from './modules/appointments.js';
import { createOnlinePaymentsModule } from './modules/online-payments.js';
import { createPushModule } from './push-notifications.js';
import { createSmsModule } from './sms.js';
import { createLmsModule } from "./modules/lms.js";
import { createResultAmendmentsModule } from "./modules/result-amendments.js";
import { createAssessmentModule } from "./modules/assessment.js";
import { createTranscriptsModule } from "./modules/transcripts.js";
import { createExamsModule } from "./modules/exams.js";
import { createExamResourcesModule } from './modules/exam-resources.js';
import { createExamManifestsModule } from './modules/exam-manifests.js';
import { createExamSeatingModule } from './modules/exam-seating.js';
import { createExamPublicationsModule } from './modules/exam-publications.js';
import { createExaminationReportingModule } from './modules/examination-reporting.js';
import { createAdmissionsReportingModule } from './modules/admissions-reporting.js';
import { createRegistryReportingModule } from './modules/registry-reporting.js';
import { createSupportCasesModule } from './modules/support-cases.js';
import { createApplicantCommunicationsModule } from './modules/applicant-communications.js';
import { createAdmissionsGuidanceModule } from './modules/admissions-guidance.js';
import { createProspectiveEnquiriesModule } from './modules/prospective-enquiries.js';
import { createEnquiryReportingModule } from './modules/enquiry-reporting.js';
import { createSupportReportingModule } from './modules/support-reporting.js';
import { createCommunicationReportingModule } from './modules/communication-reporting.js';
import { createAcademicReportingModule } from './modules/academic-reporting.js';
import { createAssessmentReportingModule } from './modules/assessment-reporting.js';
import { createContinuationReportingModule } from './modules/continuation-reporting.js';
import { createReportEditionsModule } from './modules/report-editions.js';
import { createReportSchedulesModule } from './modules/report-schedules.js';
import { createAwardsModule } from "./modules/awards.js";
import { createDocumentRepositoryModule } from "./modules/document-repository.js";
import { createDocumentTemplatesModule } from "./modules/document-templates.js";
import { createIntegrationsModule } from "./modules/integrations.js";
import { createPaymentPlansModule } from "./modules/payment-plans.js";
import { createSponsorshipsModule } from "./modules/sponsorships.js";
import { createDocumentIssuanceModule } from "./modules/document-issuance.js";
import { createCourseWithdrawalsModule } from "./modules/course-withdrawals.js";

export { parseEffectiveDate } from "./support.js";
export { allowedUploadContentTypes, assertUploadIsAllowed, documentClassifications } from "./modules/documents.js";

export const maxLoginFailures = 5;
const loginThrottleWindowMinutes = 15;
// Fixed hash used to equalise timing when the account does not exist.
const dummyPasswordHash = await hashSecret("svu-timing-equaliser");

export function createRepository(pool, options = {}) {
  const core = {
    async health() {
      const result = await pool.query("select now() as checked_at");
      return result.rows[0];
    },

    async foundationStatus() {
      const [
        people,
        roles,
        permissions,
        rolePermissions,
        auditEvents,
        tasks,
        workflowInstances,
        programmes,
        tickets,
        lanes,
        gates,
        decisions
      ] = await Promise.all([
        count(pool, "people"),
        count(pool, "roles"),
        count(pool, "permissions"),
        count(pool, "role_permissions"),
        count(pool, "audit_events"),
        count(pool, "tasks"),
        count(pool, "workflow_instances"),
        count(pool, "programmes"),
        list(pool, "implementation_tickets", "display_order"),
        list(pool, "foundation_lanes", "display_order"),
        list(pool, "exit_gates", "display_order"),
        list(pool, "decisions", "display_order")
      ]);

      return {
        phase: "Phase 1",
        architecture: "modular_monolith",
        tickets: tickets.map((ticket) => ({
          id: ticket.ticket_id,
          title: ticket.title,
          status: ticket.status
        })),
        workLanes: lanes.map((lane) => ({
          name: lane.name,
          status: lane.status,
          trace: lane.trace
        })),
        exitGates: gates.map((gate) => ({
          id: gate.gate_id,
          title: gate.title,
          status: gate.status
        })),
        decisions: decisions.map((decision) => ({
          id: decision.decision_id,
          decision: decision.title,
          status: decision.status,
          recommendation: decision.recommendation
        })),
        counts: {
          people,
          roles,
          permissions,
          rolePermissions,
          auditEvents,
          tasks,
          workflowInstances,
          programmes
        }
      };
    },

    // Only fully active sessions are accepted unless a caller (the MFA endpoints) opts into partial ones.
    async authenticateSession(token, { allowStatuses = ["active"] } = {}) {
      if (!token) {
        const error = new Error("Authentication is required.");
        error.statusCode = 401;
        throw error;
      }

      const sessions = await pool.query(
        `select
          s.id,
          s.account_id,
          s.status,
          s.assurance,
          s.expires_at,
          a.email,
          a.status as account_status,
          exists (select 1 from mfa_factors where account_id = s.account_id and status = 'active') as "hasFactor",
          grants.privileged,
          grants.roles
        from sessions s
        join accounts a on a.id = s.account_id
        cross join lateral (
          select coalesce(bool_or(current_roles.privileged), false) as privileged,
            coalesce(jsonb_agg(jsonb_build_object(
              'code', current_roles.role_code, 'scope', current_roles.scope,
              'permissions', current_roles.permissions
            ) order by current_roles.id), '[]'::jsonb) as roles
          from (
            select ra.id, ra.role_code, ra.scope,
              r.risk in ('critical', 'high') as privileged,
              coalesce(array_agg(rp.permission_code order by rp.permission_code)
                filter (where rp.permission_code is not null), '{}'::text[]) as permissions
            from role_assignments ra
            join roles r on r.code = ra.role_code and r.active
            left join role_permissions rp on rp.role_code = r.code
            where ra.account_id = s.account_id
              and ra.ended_at is null
              and ra.effective_from <= current_date
              and (ra.effective_to is null or ra.effective_to >= current_date)
            group by ra.id, ra.role_code, ra.scope, r.risk
          ) current_roles
        ) grants
        where s.token_digest = $1
          and s.expires_at > now()
          and a.status = 'active'`,
        [digestToken(token)]
      );
      const session = sessions.rows[0];
      if (!session || !allowStatuses.includes(session.status)) {
        const pendingMfa = session && ["mfa_pending", "mfa_enrolment_required"].includes(session.status);
        throw requestError(401, pendingMfa
          ? `Multi-factor authentication is incomplete (${session.status}).`
          : "Session token is invalid or expired.");
      }

      // Factor enrolment and effective role changes must not grandfather password-only sessions.
      const requirement = mfaRequirement({ policy: options.mfaPolicy || "enrolled", ...session });
      if ((requirement === "verify" && session.assurance !== "mfa" && session.status !== "mfa_pending") ||
          (requirement === "enrol" && session.status !== "mfa_enrolment_required")) {
        throw requestError(401, "Multi-factor authentication requirements have changed. Sign in again.");
      }

      // Flatten only this snapshot's role grants; unrelated roles cannot widen permission scopes.
      const roles = session.roles;
      const permissions = [...new Set(roles.flatMap((role) => role.permissions))].sort();

      return {
        sessionId: session.id,
        sessionStatus: session.status,
        assurance: session.assurance,
        accountId: session.account_id,
        email: session.email,
        permissions,
        roles
      };
    },

    async requirePermission(token, permissionCode) {
      const actor = await this.authenticateSession(token);
      if (!actor.permissions.includes(permissionCode)) {
        const error = new Error(`Permission required: ${permissionCode}`);
        error.statusCode = 403;
        throw error;
      }
      // Later scope checks in this request only count roles that grant this permission.
      return { ...actor, authorizingPermission: permissionCode };
    },

    async listAuditEvents(filters = {}) {
      const conditions = [];
      const values = [];
      const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);

      if (filters.actorId) {
        values.push(filters.actorId);
        conditions.push(`actor_id = $${values.length}`);
      }

      if (filters.action) {
        values.push(filters.action);
        conditions.push(`action = $${values.length}`);
      }

      if (filters.subjectType) {
        values.push(filters.subjectType);
        conditions.push(`subject_type = $${values.length}`);
      }

      if (filters.subjectId) {
        values.push(filters.subjectId);
        conditions.push(`subject_id = $${values.length}`);
      }

      if (filters.occurredFrom) {
        values.push(filters.occurredFrom);
        conditions.push(`occurred_at >= $${values.length}`);
      }

      if (filters.occurredTo) {
        values.push(filters.occurredTo);
        conditions.push(`occurred_at <= $${values.length}`);
      }

      values.push(limit);
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(
        `select
          id,
          occurred_at as "occurredAt",
          actor_id as "actorId",
          action,
          subject_type as "subjectType",
          subject_id as "subjectId",
          source,
          reason,
          before_ref as "beforeRef",
          after_ref as "afterRef",
          metadata
        from audit_events
        ${where}
        order by occurred_at desc
        limit $${values.length}`,
        values
      );
      return result.rows;
    },

    async listProgrammes() {
      const result = await pool.query(
        `select
          id,
          code,
          name,
          department_id as "departmentId",
          status
        from programmes
        order by code`
      );
      return result.rows;
    },

    async listIntakes() {
      const result = await pool.query(
        `select
          id,
          programme_id as "programmeId",
          label,
          capacity,
          application_opens_at as "applicationOpensAt",
          application_closes_at as "applicationClosesAt",
          status,
          to_char(starts_on, 'YYYY-MM-DD') as "startsOn",
          ${admissionsPlacesSql} + ${transferredSeatsSql} as "placesUsed",
          greatest(capacity - ${admissionsPlacesSql} - ${transferredSeatsSql}, 0) as "placesRemaining"
        from intakes i
        order by label, id`
      );
      return result.rows;
    },

    async listTasks(actor) {
      const result = await pool.query(
        `select
          t.id, t.title, t.queue,
          t.assignee_account_id as "assigneeAccountId",
          t.workflow_instance_id as "workflowInstanceId",
          t.priority, t.due_at as "dueAt", t.status,
          rs.id as "scopeId", rs.programme_code as "programmeCode", rs.intake_id as "intakeId"
        from tasks t
        left join workflow_instances w on w.id = t.workflow_instance_id
        left join resource_scopes rs on rs.resource_type = w.subject_type and rs.resource_id = w.subject_id
        order by t.due_at nulls last, t.id`
      );
      return result.rows.filter(row => !row.workflowInstanceId || (row.scopeId && actorCanAccessScope(actor, { programmeCode: row.programmeCode, intakeId: row.intakeId })))
        .map(({ scopeId, programmeCode, intakeId, ...row }) => row);
    },

    async createInvitation(input, actor = { accountId: "system_demo" }) {
      requireFields(input, ["email", "roleCode"]);
      assertActorCanAccessScope(actor, input.scope || {});
      const activationToken = createSecret();
      const invitation = {
        id: `inv_${randomUUID()}`,
        email: accountMailbox(input.email),
        roleCode: input.roleCode,
        scope: input.scope || {},
        status: "pending_activation",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
      };

      await withTransaction(pool, async (client) => {
        await lockAccountMailbox(client, invitation.email);
        await requireNewAccountMailbox(client, invitation.email);
        await client.query(
          `insert into invitations (id, email, role_code, scope, status, expires_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            invitation.id,
            invitation.email,
            invitation.roleCode,
            invitation.scope,
            invitation.status,
            invitation.expiresAt
          ]
        );
        await client.query(
          `insert into account_activation_tokens (id, invitation_id, email, token_digest, status, expires_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            `act_${randomUUID()}`,
            invitation.id,
            invitation.email,
            digestToken(activationToken),
            "active",
            invitation.expiresAt
          ]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.invitation.created",
          subjectType: "Invitation",
          subjectId: invitation.id,
          reason: "Phase 1 foundation demo"
        });
      });

      return {
        ...invitation,
        activationToken,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: new Date().toISOString()
      };
    },

    async activateAccount(input) {
      requireFields(input, ["token", "password", "preferredName", "legalName"]);
      const tokenRows = await pool.query(
        `select *
         from account_activation_tokens
         where token_digest = $1 and status = 'active' and used_at is null and expires_at > now()`,
        [digestToken(input.token)]
      );
      const activationToken = tokenRows.rows[0];
      if (!activationToken) {
        const error = new Error("Activation token is invalid or expired.");
        error.statusCode = 400;
        throw error;
      }

      const problems = passwordProblems(input.password, activationToken.email);
      if (problems.length > 0) {
        throw requestError(400, `Password rejected: ${problems.join("; ")}.`);
      }
      const password = await hashSecret(input.password);
      let account;
      await withTransaction(pool, async (client) => {
        const email = await lockAccountMailbox(client, activationToken.email);
        // Recheck expiry after waiting on the mailbox, then claim before creating identity records.
        const claimed = await client.query(
          `update account_activation_tokens
           set status = 'used', used_at = now()
           where id = $1 and status = 'active' and used_at is null and expires_at > clock_timestamp()`,
          [activationToken.id]
        );
        if (claimed.rowCount === 0) {
          throw requestError(400, "Activation token is invalid or expired.");
        }

        await requireNewAccountMailbox(client, email);
        const personId = `person_${randomUUID()}`;
        const accountId = `acct_${randomUUID()}`;
        const invitedRole = await client.query("select role_code from invitations where id = $1", [activationToken.invitation_id]);
        const persona = { applicant: "applicant", student: "student" }[invitedRole.rows[0]?.role_code] || "staff";
        await client.query(
          `insert into people (id, preferred_name, legal_name, personas, status)
           values ($1, $2, $3, $4, $5)`,
          [personId, input.preferredName, input.legalName, JSON.stringify([persona]), "active"]
        );
        const inserted = await client.query(
          `insert into accounts (id, person_id, email, status, mfa_required, password_hash, password_salt, password_set_at)
           values ($1, $2, $3, $4, $5, $6, $7, now())
           returning id, person_id as "personId", email, status, mfa_required as "mfaRequired"`,
          [accountId, personId, email, "active", false, password.hash, password.salt]
        );
        account = inserted.rows[0];

        const invited = await client.query(
          "update invitations set status = 'activated' where id = $1 returning role_code, scope",
          [activationToken.invitation_id]
        );
        // The invitation names the role and scope the person was invited into; grant it on activation.
        const { role_code: roleCode, scope } = invited.rows[0];
        const alreadyGranted = await client.query(
          `select 1 from role_assignments
           where account_id = $1 and role_code = $2 and scope = $3::jsonb
             and (effective_to is null or effective_to >= current_date)`,
          [account.id, roleCode, JSON.stringify(scope || {})]
        );
        if (alreadyGranted.rowCount === 0) {
          const assignmentId = `ra_${randomUUID()}`;
          await client.query(
            `insert into role_assignments (id, account_id, role_code, scope, effective_from, granted_by, reason)
             values ($1, $2, $3, $4, current_date, $5, 'Granted by accepted invitation')`,
            [assignmentId, account.id, roleCode, scope || {}, `invitation:${activationToken.invitation_id}`]
          );
          await insertAudit(client, {
            actorId: account.id,
            action: "access.role_assignment.created",
            subjectType: "RoleAssignment",
            subjectId: assignmentId,
            reason: `Granted ${roleCode} from invitation ${activationToken.invitation_id}`
          });
        }
        await linkActivatedStaff(client, activationToken.invitation_id, account.id);
        await insertAudit(client, {
          actorId: account.id,
          action: "identity.account.activated",
          subjectType: "Account",
          subjectId: account.id,
          reason: "Account activated from invitation"
        });
      });

      return account;
    },

    async createSession(input) {
      requireFields(input, ["email", "password"]);
      const email = normalizeEmail(input.email);

      // Throttle by email whether or not the account exists, so the response never reveals which emails are real.
      const recent = await pool.query(
        `select count(*)::int as failures
         from login_failures
         where email_normalized = $1 and occurred_at > now() - make_interval(mins => $2)`,
        [email, loginThrottleWindowMinutes]
      );
      if (recent.rows[0].failures >= maxLoginFailures) {
        await insertAudit(pool, {
          actorId: "anonymous",
          action: "identity.login.throttled",
          subjectType: "Account",
          subjectId: email,
          reason: `${recent.rows[0].failures} failed attempts in ${loginThrottleWindowMinutes} minutes`
        });
        throw requestError(429, `Too many failed sign-in attempts. Try again in ${loginThrottleWindowMinutes} minutes or reset your password.`);
      }

      const result = await pool.query(
        `select id, email, status, password_hash, password_salt, mfa_required as "mfaRequired"
         from accounts
         where lower(btrim(email)) = $1 or exists (
           select 1 from legacy_login_aliases la where la.account_id = accounts.id and la.alias = $1
         ) limit 2`,
        [email]
      );
      const account = result.rows.length === 1 ? result.rows[0] : null;
      const usable = account && account.status === "active" && account.password_hash;
      // Always pay for one password check so response time does not reveal whether the account exists.
      const passwordOk = usable
        ? await verifySecret(input.password, account.password_hash, account.password_salt)
        : (await verifySecret(input.password, dummyPasswordHash.hash, dummyPasswordHash.salt)) && false;
      if (!passwordOk) {
        await recordLoginFailure(pool, email, input.ipAddress);
        throw requestError(401, "Invalid email or password.");
      }
      await pool.query("delete from login_failures where email_normalized = $1", [email]);

      const mfaContext = await pool.query(
        `select
          exists (select 1 from mfa_factors where account_id = $1 and status = 'active') as "hasFactor",
          exists (
            select 1 from role_assignments ra
            join roles r on r.code = ra.role_code
            where ra.account_id = $1
              and r.active
              and ra.ended_at is null
              and r.risk in ('critical', 'high')
              and ra.effective_from <= current_date
              and (ra.effective_to is null or ra.effective_to >= current_date)
          ) as "privileged"`,
        [account.id]
      );
      const requirement = mfaRequirement({ policy: options.mfaPolicy || "enrolled", ...mfaContext.rows[0] });
      const status = { none: "active", verify: "mfa_pending", enrol: "mfa_enrolment_required" }[requirement];

      const sessionToken = createSecret();
      const session = {
        id: `ses_${randomUUID()}`,
        accountId: account.id,
        token: sessionToken,
        status,
        // A half-finished sign-in only lives long enough to enter a code or enrol.
        expiresAt: new Date(Date.now() + (status === "active" ? 1000 * 60 * 60 * 8 : 1000 * 60 * 10))
      };

      await withTransaction(pool, async (client) => {
        await client.query(
          `insert into sessions (id, account_id, token_digest, status, ip_address, user_agent, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            session.id,
            session.accountId,
            digestToken(sessionToken),
            session.status,
            input.ipAddress || null,
            input.userAgent || null,
            session.expiresAt
          ]
        );
        await client.query("update accounts set last_login_at = now(), updated_at = now() where id = $1", [account.id]);
        await client.query(
          "update sessions set status = 'expired' where account_id = $1 and status = 'active' and expires_at <= now()",
          [account.id]
        );
        await insertAudit(client, {
          actorId: account.id,
          action: "identity.session.created",
          subjectType: "Session",
          subjectId: session.id,
          reason: status === "active" ? "User login" : `User login awaiting MFA (${status})`
        });
      });

      return {
        ...session,
        expiresAt: session.expiresAt.toISOString(),
        nextStep: { active: null, mfa_pending: "verify_mfa", mfa_enrolment_required: "enrol_mfa" }[status],
        account: {
          id: account.id,
          email: account.email,
          mfaRequired: requirement !== "none"
        }
      };
    },

    async revokeSession(sessionId, actor) {
      // Users may end their own sessions; ending someone else's requires identity.manage.
      // A session still waiting on MFA has proven only the password, so it may end itself and nothing else.
      const canManage = actor.sessionStatus === "active" && actor.permissions.includes("identity.manage");
      const result = await pool.query(
        `update sessions
         set status = 'revoked', revoked_at = now()
         where id = $1
           and status in ('active', 'mfa_pending', 'mfa_enrolment_required')
           and ($2 or (account_id = $3 and (id = $4 or $5)))
         returning id, account_id as "accountId", status`,
        [sessionId, canManage, actor.accountId, actor.sessionId, actor.sessionStatus === "active"]
      );
      if (result.rowCount === 0) {
        // Same response whether the session is missing or belongs to someone else.
        throw requestError(404, "Active session was not found.");
      }
      await insertAudit(pool, {
        actorId: actor.accountId,
        action: "identity.session.revoked",
        subjectType: "Session",
        subjectId: sessionId,
        reason: result.rows[0].accountId === actor.accountId ? "User logout" : "Session revoked by identity administrator"
      });
      return result.rows[0];
    },

    async listAccountSessions(accountId) {
      const result = await pool.query(
        `select
          id,
          account_id as "accountId",
          status,
          ip_address as "ipAddress",
          user_agent as "userAgent",
          expires_at as "expiresAt",
          revoked_at as "revokedAt",
          created_at as "createdAt"
         from sessions
         where account_id = $1
         order by created_at desc`,
        [accountId]
      );
      return result.rows;
    },

    async suspendAccount(accountId, input, actor) {
      const reason = input.reason || "Account suspended";
      return withTransaction(pool, async (client) => {
        const account = await client.query(
          `update accounts
           set status = 'suspended',
               updated_at = now()
           where id = $1
           returning id, person_id as "personId", email, status, mfa_required as "mfaRequired"`,
          [accountId]
        );
        if (account.rowCount === 0) {
          const error = new Error("Account was not found.");
          error.statusCode = 404;
          throw error;
        }

        const revoked = await client.query(
          `update sessions
           set status = 'revoked',
               revoked_at = now()
           where account_id = $1 and status = 'active'
           returning id`,
          [accountId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.account.suspended",
          subjectType: "Account",
          subjectId: accountId,
          reason
        });
        return {
          ...account.rows[0],
          revokedSessions: revoked.rows.map((row) => row.id)
        };
      });
    },

    async reactivateAccount(accountId, input, actor) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `update accounts
           set status = 'active',
               updated_at = now()
           where id = $1
           returning id, person_id as "personId", email, status, mfa_required as "mfaRequired"`,
          [accountId]
        );
        if (result.rowCount === 0) {
          const error = new Error("Account was not found.");
          error.statusCode = 404;
          throw error;
        }
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "identity.account.reactivated",
          subjectType: "Account",
          subjectId: accountId,
          reason: input.reason || "Account reactivated"
        });
        return result.rows[0];
      });
    },

    async createRoleAssignment(input, actor) {
      requireFields(input, ["accountId", "roleCode"]);
      // Granting yourself a role would bypass review; another administrator must do it.
      if (input.accountId === actor.accountId) throw requestError(403, "You cannot grant a role to your own account.");
      assertActorCanAccessScope(actor, input.scope || {});
      const assignment = {
        id: `ra_${randomUUID()}`,
        accountId: input.accountId,
        roleCode: input.roleCode,
        scope: input.scope || {},
        effectiveFrom: input.effectiveFrom || new Date().toISOString().slice(0, 10),
        grantedBy: actor.accountId,
        reason: input.reason || "Phase 1 scoped role assignment"
      };

      await withTransaction(pool, async (client) => {
        await client.query(
          `insert into role_assignments (id, account_id, role_code, scope, effective_from, granted_by, reason)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            assignment.id,
            assignment.accountId,
            assignment.roleCode,
            assignment.scope,
            assignment.effectiveFrom,
            assignment.grantedBy,
            assignment.reason
          ]
        );
        await insertAudit(client, {
          actorId: assignment.grantedBy,
          action: "access.role_assignment.created",
          subjectType: "RoleAssignment",
          subjectId: assignment.id,
          reason: assignment.reason
        });
      });

      return assignment;
    },

    async createProgramme(input, actor) {
      requireFields(input, ["code", "name", "departmentId"]);
      const programme = {
        id: input.id || `prog_${randomUUID()}`,
        code: input.code,
        name: input.name,
        departmentId: input.departmentId,
        status: input.status || "draft"
      };

      return withTransaction(pool, async (client) => {
        const department = await findOrganizationUnit(client, programme.departmentId);
        if (department.unitType !== "department" || department.status !== "active") {
          throw requestError(409, "Programmes must be owned by an active department.");
        }
        const inserted = await client.query(
          `insert into programmes (id, code, name, department_id, status)
           values ($1, $2, $3, $4, $5)
           returning id, code, name, department_id as "departmentId", status`,
          [programme.id, programme.code, programme.name, programme.departmentId, programme.status]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.programme.created",
          subjectType: "Programme",
          subjectId: inserted.rows[0].id,
          reason: input.reason || "Programme created"
        });
        return inserted.rows[0];
      });
    },

    async updateProgramme(programmeId, input, actor) {
      requireFields(input, ['name', 'departmentId', 'reason']);
      if (input.code !== undefined || input.status !== undefined) throw requestError(400, 'Programme codes and status cannot be changed here.');
      return withTransaction(pool, async client => {
        await client.query('select id from programmes where id = $1 for update', [programmeId]);
        const before = await findProgramme(client, programmeId);
        if (['retired','inactive'].includes(before.status)) throw requestError(409, 'Inactive programmes cannot be edited.');
        const department = await findOrganizationUnit(client, input.departmentId);
        if (department.unitType !== 'department' || department.status !== 'active') throw requestError(409, 'Select an active department.');
        const result = await client.query(`update programmes set name = $1, department_id = $2 where id = $3
          returning id, code, name, department_id as "departmentId", status`, [input.name, input.departmentId, programmeId]);
        await insertAudit(client, {actorId:actor.accountId, action:'master_data.programme.updated', subjectType:'Programme', subjectId:programmeId, reason:input.reason, metadata:{before,after:result.rows[0]}});
        return result.rows[0];
      });
    },

    async updateIntake(intakeId, input, actor) {
      requireFields(input, ['label','capacity','reason']);
      if (!Number.isInteger(input.capacity) || input.capacity < 1) throw requestError(400, 'Capacity must be a positive whole number.');
      if (input.programmeId !== undefined || input.status !== undefined) throw requestError(400, 'An intake programme and status cannot be changed here.');
      return withTransaction(pool, async client => {
        const found = await client.query('select * from intakes where id = $1 for update', [intakeId]);
        if (!found.rowCount) throw requestError(404, 'Intake was not found.');
        const before = found.rows[0];
        if (before.status === 'closed') throw requestError(409, 'Closed intakes cannot be edited.');
        const used = (await client.query(intakeSeatsSql,[intakeId])).rows[0].used;
        if (input.capacity < used) throw requestError(409, `Capacity cannot be below ${used} reserved places.`);
        const changesDates = ['applicationOpensAt','applicationClosesAt','startsOn'].some(key => input[key] !== undefined);
        if (changesDates && before.status !== 'draft') throw requestError(409, 'Published intake dates are immutable.');
        const opens = input.applicationOpensAt ?? before.application_opens_at;
        const closes = input.applicationClosesAt ?? before.application_closes_at;
        if ((opens || closes) && (!opens || !closes || !Number.isFinite(new Date(opens).getTime()) || !Number.isFinite(new Date(closes).getTime()) || new Date(opens) >= new Date(closes))) throw requestError(400, 'Applications must open before they close.');
        const start = input.startsOn === undefined ? before.starts_on : parseEffectiveDate(input.startsOn);
        const result = await client.query(`update intakes set label=$1,capacity=$2,application_opens_at=$3,application_closes_at=$4,starts_on=$5 where id=$6
          returning id, programme_id as "programmeId", label, capacity, status`,[input.label,input.capacity,opens,closes,start,intakeId]);
        await insertAudit(client,{actorId:actor.accountId,action:'master_data.intake.updated',subjectType:'Intake',subjectId:intakeId,reason:input.reason,metadata:{before,after:result.rows[0]}});
        return result.rows[0];
      });
    },

    async createIntake(input, actor) {
      requireFields(input, ["programmeId", "label", "capacity"]);
      if (!Number.isInteger(input.capacity) || input.capacity < 1) throw requestError(400, 'Capacity must be a positive whole number.');
      const intake = {
        id: input.id || `intake_${randomUUID()}`,
        programmeId: input.programmeId,
        label: input.label,
        capacity: input.capacity,
        applicationOpensAt: input.applicationOpensAt || null,
        applicationClosesAt: input.applicationClosesAt || null,
        startsOn: input.startsOn ? parseEffectiveDate(input.startsOn) : null,
        // New intakes are always drafts; publication goes through transitionIntake and its checks.
        status: "draft"
      };

      return withTransaction(pool, async (client) => {
        const inserted = await client.query(
          `insert into intakes (
             id,
             programme_id,
             label,
             capacity,
             application_opens_at,
             application_closes_at,
             status,
             starts_on
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning
             id,
             programme_id as "programmeId",
             label,
             capacity,
             application_opens_at as "applicationOpensAt",
             application_closes_at as "applicationClosesAt",
             status,
             to_char(starts_on, 'YYYY-MM-DD') as "startsOn"`,
          [
            intake.id,
            intake.programmeId,
            intake.label,
            intake.capacity,
            intake.applicationOpensAt,
            intake.applicationClosesAt,
            intake.status,
            intake.startsOn
          ]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.intake.created",
          subjectType: "Intake",
          subjectId: inserted.rows[0].id,
          reason: input.reason || "Intake created"
        });
        return inserted.rows[0];
      });
    },

    async listOrganizationUnits(filters = {}) {
      const values = [];
      const conditions = [];
      if (filters.unitType) {
        values.push(filters.unitType);
        conditions.push(`unit_type = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        conditions.push(`status = $${values.length}`);
      }
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(`${organizationUnitSelect} ${where} order by unit_type desc, code`, values);
      return result.rows;
    },

    async listOrganizationUnitHistory(unitId) {
      await findOrganizationUnit(pool, unitId);
      const result = await pool.query(
        `select
          id,
          name,
          parent_id as "parentId",
          status,
          to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
          to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo",
          changed_by as "changedBy",
          reason,
          recorded_at as "recordedAt"
        from organization_unit_history
        where unit_id = $1
        order by effective_from, recorded_at`,
        [unitId]
      );
      return result.rows;
    },

    async createOrganizationUnit(input, actor) {
      requireFields(input, ["code", "name", "unitType"]);
      if (!["faculty", "department"].includes(input.unitType)) {
        throw requestError(400, "Unit type must be faculty or department.");
      }
      const effectiveFrom = parseEffectiveDate(input.effectiveFrom);
      const id = input.id || `${input.unitType === "faculty" ? "fac" : "dept"}_${randomUUID()}`;

      return withTransaction(pool, async (client) => {
        const parentId = await resolveParentUnit(client, input.unitType, input.parentId);
        const duplicate = await client.query("select 1 from organization_units where code = $1", [input.code]);
        if (duplicate.rowCount > 0) {
          throw requestError(409, `Organization unit code ${input.code} already exists.`);
        }
        await client.query(
          `insert into organization_units (id, code, name, unit_type, parent_id, status, effective_from)
           values ($1, $2, $3, $4, $5, 'active', $6)`,
          [id, input.code, input.name, input.unitType, parentId, effectiveFrom]
        );
        const historyId = await insertUnitHistory(client, {
          unitId: id,
          name: input.name,
          parentId,
          status: "active",
          effectiveFrom,
          changedBy: actor.accountId,
          reason: input.reason || "Organization unit created"
        });
        const unit = await findOrganizationUnit(client, id);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.organization_unit.created",
          subjectType: "OrganizationUnit",
          subjectId: id,
          reason: input.reason || "Organization unit created",
          afterRef: historyId,
          metadata: { after: unit }
        });
        return unit;
      });
    },

    async updateOrganizationUnit(unitId, input, actor) {
      requireFields(input, ["reason"]);
      if (input.name === undefined && input.parentId === undefined) {
        throw requestError(400, "Provide a new name or parentId.");
      }
      const effectiveFrom = parseEffectiveDate(input.effectiveFrom);

      return withTransaction(pool, async (client) => {
        const before = await findOrganizationUnit(client, unitId, { forUpdate: true });
        if (before.status !== "active") {
          throw requestError(409, "Only active organization units can be changed. Reactivate it first.");
        }
        const parentId = input.parentId === undefined
          ? before.parentId
          : await resolveParentUnit(client, before.unitType, input.parentId);
        if (parentId === unitId) {
          throw requestError(400, "An organization unit cannot be its own parent.");
        }
        const name = input.name === undefined ? before.name : input.name;

        const { beforeRef, afterRef } = await recordUnitChange(client, unitId, {
          name,
          parentId,
          status: "active",
          effectiveFrom,
          changedBy: actor.accountId,
          reason: input.reason
        });
        await client.query(
          "update organization_units set name = $1, parent_id = $2 where id = $3",
          [name, parentId, unitId]
        );
        const after = await findOrganizationUnit(client, unitId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.organization_unit.updated",
          subjectType: "OrganizationUnit",
          subjectId: unitId,
          reason: input.reason,
          beforeRef,
          afterRef,
          metadata: { before, after, effectiveFrom }
        });
        return after;
      });
    },

    async deactivateOrganizationUnit(unitId, input, actor) {
      requireFields(input, ["reason"]);
      const effectiveFrom = parseEffectiveDate(input.effectiveFrom);

      return withTransaction(pool, async (client) => {
        const before = await findOrganizationUnit(client, unitId, { forUpdate: true });
        if (before.status !== "active") {
          throw requestError(409, "Organization unit is already inactive.");
        }
        const children = await client.query(
          "select code from organization_units where parent_id = $1 and status = 'active'",
          [unitId]
        );
        if (children.rowCount > 0) {
          throw requestError(409, `Deactivate or move active child units first: ${children.rows.map((row) => row.code).join(", ")}.`);
        }
        const programmes = await client.query(
          "select code from programmes where department_id = $1 and status not in ('retired', 'inactive')",
          [unitId]
        );
        if (programmes.rowCount > 0) {
          throw requestError(409, `Retire or move programmes owned by this unit first: ${programmes.rows.map((row) => row.code).join(", ")}.`);
        }

        const { beforeRef, afterRef } = await recordUnitChange(client, unitId, {
          name: before.name,
          parentId: before.parentId,
          status: "inactive",
          effectiveFrom,
          changedBy: actor.accountId,
          reason: input.reason
        });
        await client.query(
          "update organization_units set status = 'inactive', effective_to = $1::date - 1 where id = $2",
          [effectiveFrom, unitId]
        );
        const after = await findOrganizationUnit(client, unitId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.organization_unit.deactivated",
          subjectType: "OrganizationUnit",
          subjectId: unitId,
          reason: input.reason,
          beforeRef,
          afterRef,
          metadata: { before, after, effectiveFrom }
        });
        return after;
      });
    },

    async reactivateOrganizationUnit(unitId, input, actor) {
      requireFields(input, ["reason"]);
      const effectiveFrom = parseEffectiveDate(input.effectiveFrom);

      return withTransaction(pool, async (client) => {
        const before = await findOrganizationUnit(client, unitId, { forUpdate: true });
        if (before.status === "active") {
          throw requestError(409, "Organization unit is already active.");
        }
        if (before.parentId) {
          const parent = await findOrganizationUnit(client, before.parentId);
          if (parent.status !== "active") {
            throw requestError(409, "Reactivate the parent faculty first.");
          }
        }

        const { beforeRef, afterRef } = await recordUnitChange(client, unitId, {
          name: before.name,
          parentId: before.parentId,
          status: "active",
          effectiveFrom,
          changedBy: actor.accountId,
          reason: input.reason
        });
        await client.query(
          "update organization_units set status = 'active', effective_to = null where id = $1",
          [unitId]
        );
        const after = await findOrganizationUnit(client, unitId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.organization_unit.reactivated",
          subjectType: "OrganizationUnit",
          subjectId: unitId,
          reason: input.reason,
          beforeRef,
          afterRef,
          metadata: { before, after, effectiveFrom }
        });
        return after;
      });
    },

    async listProgrammeVersions(programmeId, asOf) {
      await findProgramme(pool, programmeId);
      const effectiveOn = parseEffectiveDate(asOf);
      const result = await pool.query(
        `${programmeVersionSelect} where programme_id = $1 order by effective_from nulls last, version_label`,
        [programmeId]
      );
      const effective = result.rows.find((version) => isEffectiveOn(version, effectiveOn));
      return {
        data: result.rows,
        effectiveOn,
        effectiveVersionId: effective ? effective.id : null
      };
    },

    async createProgrammeVersion(programmeId, input, actor) {
      requireFields(input, ["versionLabel"]);
      const effectiveFrom = input.effectiveFrom ? parseEffectiveDate(input.effectiveFrom) : null;
      if (input.requirements !== undefined) validateAdmissionsRequirements(input.requirements);
      const id = input.id || `pv_${randomUUID()}`;

      return withTransaction(pool, async (client) => {
        await findProgramme(client, programmeId);
        const duplicate = await client.query(
          "select 1 from programme_versions where programme_id = $1 and version_label = $2",
          [programmeId, input.versionLabel]
        );
        if (duplicate.rowCount > 0) {
          throw requestError(409, `Version ${input.versionLabel} already exists for this programme.`);
        }
        await client.query(
          `insert into programme_versions (id, programme_id, version_label, requirements, status, effective_from, created_by)
           values ($1, $2, $3, $4, 'draft', $5, $6)`,
          [id, programmeId, input.versionLabel, input.requirements || {}, effectiveFrom, actor.accountId]
        );
        const version = await findProgrammeVersion(client, id);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.programme_version.created",
          subjectType: "ProgrammeVersion",
          subjectId: id,
          reason: input.reason || "Programme version drafted",
          metadata: { after: version }
        });
        return version;
      });
    },

    async updateProgrammeRequirements(versionId,input,actor) {
      if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['revision','requirements','reason'].includes(key))
        || !Number.isInteger(input.revision) || input.revision<1 || typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>2000) throw requestError(400,'Provide the current revision, admission requirements and a reason.');
      validateAdmissionsRequirements(input.requirements);
      return withTransaction(pool,async client=>{
        const before=await findProgrammeVersion(client,versionId,{forUpdate:true});
        if (before.status!=='draft') throw requestError(409,'Admission requirements can only be changed on a draft version.');
        if (before.revision!==input.revision) throw requestError(409,'This version changed. Reload before saving requirements.');
        await client.query('update programme_versions set requirements=$2,revision=revision+1 where id=$1',[versionId,input.requirements]);
        const after=await findProgrammeVersion(client,versionId);
        await insertAudit(client,{actorId:actor.accountId,action:'master_data.programme_requirements.updated',subjectType:'ProgrammeVersion',subjectId:versionId,reason:input.reason.trim(),metadata:{before,after}});
        return after;
      });
    },

    async publishProgrammeVersion(versionId, input, actor) {
      requireFields(input, ["reason"]);

      return withTransaction(pool, async (client) => {
        const before = await findProgrammeVersion(client, versionId, { forUpdate: true });
        if (before.status !== "draft") {
          throw requestError(409, `Only draft versions can be published; this version is ${before.status}.`);
        }
        assertSeparateApprover(before.createdBy, actor);
        const ownRequirements=await client.query("select 1 from audit_events where subject_id=$1 and subject_type='ProgrammeVersion' and action='master_data.programme_requirements.updated' and actor_id=$2 limit 1",[versionId,actor.accountId]);
        if (ownRequirements.rowCount) throw requestError(403,'Admission requirement editors cannot publish this version. Ask an independent approver.');
        validateAdmissionsRequirements(before.requirements);
        await assertCurriculumPublishable(client, versionId);
        const effectiveFrom = parseEffectiveDate(input.effectiveFrom || before.effectiveFrom);

        const later = await client.query(
          `select version_label from programme_versions
           where programme_id = $1 and status = 'published' and effective_from >= $2::date`,
          [before.programmeId, effectiveFrom]
        );
        if (later.rowCount > 0) {
          throw requestError(409, `Effective date must be after published version ${later.rows[0].version_label}.`);
        }

        const superseded = await client.query(
          `update programme_versions
           set effective_to = $1::date - 1
           where programme_id = $2
             and status = 'published'
             and (effective_to is null or effective_to >= $1::date)
           returning id`,
          [effectiveFrom, before.programmeId]
        );
        await client.query(
          `update programme_versions
           set status = 'published', effective_from = $1, published_at = now(), published_by = $2
           where id = $3`,
          [effectiveFrom, actor.accountId, versionId]
        );
        const after = await findProgrammeVersion(client, versionId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.programme_version.published",
          subjectType: "ProgrammeVersion",
          subjectId: versionId,
          reason: input.reason,
          beforeRef: superseded.rows[0]?.id,
          afterRef: versionId,
          metadata: { before, after, supersededVersionIds: superseded.rows.map((row) => row.id) }
        });
        return { ...after, supersededVersionIds: superseded.rows.map((row) => row.id) };
      });
    },

    async retireProgrammeVersion(versionId, input, actor) {
      requireFields(input, ["reason"]);
      const effectiveTo = parseEffectiveDate(input.effectiveTo);

      return withTransaction(pool, async (client) => {
        const before = await findProgrammeVersion(client, versionId, { forUpdate: true });
        if (before.status !== "published") {
          throw requestError(409, `Only published versions can be retired; this version is ${before.status}.`);
        }
        if (effectiveTo < before.effectiveFrom) {
          throw requestError(400, "Retirement date cannot be before the version's effective start date.");
        }
        await client.query(
          `update programme_versions
           set status = 'retired',
               effective_to = least(coalesce(effective_to, $1::date), $1::date),
               retired_at = now(),
               retired_by = $2
           where id = $3`,
          [effectiveTo, actor.accountId, versionId]
        );
        const after = await findProgrammeVersion(client, versionId);
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "master_data.programme_version.retired",
          subjectType: "ProgrammeVersion",
          subjectId: versionId,
          reason: input.reason,
          beforeRef: versionId,
          afterRef: versionId,
          metadata: { before, after }
        });
        return after;
      });
    },

    async assignTask(taskId, input, actor) {
      requireFields(input, ["assigneeAccountId"]);
      const task = await findTask(pool, taskId);
      await assertActorCanAccessTask(pool, actor, task);

      return withTransaction(pool, async (client) => {
        const updated = await client.query(
          `update tasks
           set assignee_account_id = $1,
               status = 'assigned',
               updated_at = now()
           where id = $2
           returning
             id,
             title,
             queue,
             assignee_account_id as "assigneeAccountId",
             workflow_instance_id as "workflowInstanceId",
             priority,
             due_at as "dueAt",
             status`,
          [input.assigneeAccountId, taskId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "task.assigned",
          subjectType: "Task",
          subjectId: taskId,
          reason: input.reason || `Task assigned to ${input.assigneeAccountId}`
        });
        return updated.rows[0];
      });
    },

    async completeTask(taskId, input, actor) {
      const task = await findTask(pool, taskId);
      await assertActorCanAccessTask(pool, actor, task);

      return withTransaction(pool, async (client) => {
        const updated = await client.query(
          `update tasks
           set status = 'completed',
               updated_at = now()
           where id = $1
           returning
             id,
             title,
             queue,
             assignee_account_id as "assigneeAccountId",
             workflow_instance_id as "workflowInstanceId",
             priority,
             due_at as "dueAt",
             status`,
          [taskId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "task.completed",
          subjectType: "Task",
          subjectId: taskId,
          reason: input.reason || "Task completed"
        });
        return updated.rows[0];
      });
    },

    async handoffTask(taskId, input, actor) {
      requireFields(input, ["queue"]);
      const task = await findTask(pool, taskId);
      await assertActorCanAccessTask(pool, actor, task);

      return withTransaction(pool, async (client) => {
        const updated = await client.query(
          `update tasks
           set queue = $1,
               assignee_account_id = $2,
               status = 'open',
               updated_at = now()
           where id = $3
           returning
             id,
             title,
             queue,
             assignee_account_id as "assigneeAccountId",
             workflow_instance_id as "workflowInstanceId",
             priority,
             due_at as "dueAt",
             status`,
          [input.queue, input.assigneeAccountId || null, taskId]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "task.handed_off",
          subjectType: "Task",
          subjectId: taskId,
          reason: input.reason || `Task handed off to ${input.queue}`
        });
        return updated.rows[0];
      });
    },

    async listNotificationTemplates() {
      const result = await pool.query(
        `select
          id,
          code,
          channel,
          subject,
          version,
          status
        from notification_templates
        order by code, channel, version desc`
      );
      return result.rows;
    },

    async listNotifications(filters = {}) {
      const conditions = [];
      const values = [];

      if (filters.recipientAccountId) {
        values.push(filters.recipientAccountId);
        conditions.push(`recipient_account_id = $${values.length}`);
      }

      if (filters.status) {
        values.push(filters.status);
        conditions.push(`status = $${values.length}`);
      }

      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const result = await pool.query(
        `select
          id,
          recipient_account_id as "recipientAccountId",
          channel,
          template_id as "templateId",
          payload,
          status,
          created_at as "createdAt"
        from notifications
        ${where}
        order by created_at desc`,
        values
      );
      return result.rows;
    },

    async previewNotification(input) {
      requireFields(input, ["templateCode", "channel"]);
      const template = await findTemplate(pool, input.templateCode, input.channel);
      return {
        channel: template.channel,
        subject: template.subject,
        body: renderTemplate(template.body, input.variables || {}),
        variables: input.variables || {}
      };
    },

    async sendNotification(input, actor) {
      requireFields(input, ["recipientAccountId", "templateCode", "channel"]);
      const template = await findTemplate(pool, input.templateCode, input.channel);
      const notification = {
        id: `not_${randomUUID()}`,
        recipientAccountId: input.recipientAccountId,
        channel: input.channel,
        templateId: template.id,
        payload: {
          subject: template.subject,
          body: renderTemplate(template.body, input.variables || {}),
          variables: input.variables || {}
        },
        status: "queued"
      };

      return withTransaction(pool, async (client) => {
        await client.query(
          `insert into notifications (id, recipient_account_id, channel, template_id, payload, status)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            notification.id,
            notification.recipientAccountId,
            notification.channel,
            notification.templateId,
            notification.payload,
            notification.status
          ]
        );
        await insertAudit(client, {
          actorId: actor.accountId,
          action: "notification.queued",
          subjectType: "Notification",
          subjectId: notification.id,
          reason: input.reason || "Phase 1 notification stub"
        });
        return notification;
      });
    }
  };

  const repository = {
    ...core,
    ...createEmailDelivery(pool,options),
    ...createAcademicCalendarModule(pool),
    ...createReferenceDataModule(pool),
    ...createWorkflowModule(pool),
    ...createIdentitySelfServiceModule(pool, { devOutboxDir: options.devOutboxDir, dataEncryptionKey: options.dataEncryptionKey }),
    ...createAccountAdminModule(pool),
    ...createNotificationInboxModule(pool),
    ...createPrivateMessagesModule(pool,{dataEncryptionKey:options.dataEncryptionKey}),
    ...createMessageRoomsModule(pool,{dataEncryptionKey:options.dataEncryptionKey}),
    ...createChatCommandContextModule(pool,{dataEncryptionKey:options.dataEncryptionKey}),
    ...createIdentityMfaModule(pool, { dataEncryptionKey: options.dataEncryptionKey }),
    ...createCurriculumModule(pool),
    ...createGradingModule(pool),
    ...createResultsModule(pool),
    ...createAcademicProgressModule(pool),
    ...createProgrammeLifecycleModule(pool),
    ...createCreditRecognitionModule(pool),
    ...createProgrammeTransferModule(pool),
    ...createIdentityCorrectionsModule(pool),
    ...createDuplicateResolutionModule(pool),
    ...createStudentFinanceModule(pool),
    ...createFinanceAdjustmentsModule(pool),
    ...createPaymentImportsModule(pool),
    ...createFinanceMigrationModule(pool),
    ...createStaffModule(pool, { devOutboxDir: options.devOutboxDir, dataEncryptionKey: options.dataEncryptionKey }),
    ...createStaffLeaveModule(pool),
    ...createAssetsModule(pool),
    ...createFleetModule(pool,{dataEncryptionKey:options.dataEncryptionKey}),
    ...createAssetReportingModule(pool),
    ...createCashbookModule(pool,options),
    ...createCashbookReportingModule(pool),
    ...createRestrictedProfilesModule(pool,options),
    ...createStudentSharingModule(pool,options),
    ...createTeachingModule(pool),
    ...createCourseWorkspaceModule(pool,options),
    ...createLmsModule(pool),
    ...createResultAmendmentsModule(pool),
    ...createAssessmentModule(pool),
    ...createTranscriptsModule(pool),
    ...createExamsModule(pool),
    ...createExamResourcesModule(pool),
    ...createExamManifestsModule(pool),
    ...createExamSeatingModule(pool),
    ...createExamPublicationsModule(pool),
    ...createExaminationReportingModule(pool),
    ...createAdmissionsReportingModule(pool),
    ...createRegistryReportingModule(pool),
    ...createSupportCasesModule(pool,options),
    ...createApplicantCommunicationsModule(pool,options),
    ...createAdmissionsGuidanceModule(pool,options),
    ...createProspectiveEnquiriesModule(pool,options),
    ...createEnquiryReportingModule(pool),
    ...createSupportReportingModule(pool),
    ...createCommunicationReportingModule(pool),
    ...createAcademicReportingModule(pool),
    ...createAssessmentReportingModule(pool),
    ...createContinuationReportingModule(pool),
    ...createReportEditionsModule(pool,options),
    ...createReportSchedulesModule(pool,options),
    ...createAwardsModule(pool),
    ...createDocumentsModule(pool, { storage: options.storage, signingKey: options.dataEncryptionKey }),
    ...createDocumentRepositoryModule(pool, { storage: options.storage, signingKey: options.dataEncryptionKey }),
    ...createDocumentTemplatesModule(pool),
    ...createIntegrationsModule(pool),
    ...createPaymentPlansModule(pool),
    ...createSponsorshipsModule(pool),
    ...createDocumentIssuanceModule(pool),
    ...createCourseWithdrawalsModule(pool),
    ...createExamPapersModule(pool,{storage:options.storage}),
    ...createExamArrangementsModule(pool,{dataEncryptionKey:options.dataEncryptionKey}),
    ...createAdmissionsModule(pool, { devOutboxDir: options.devOutboxDir, dataEncryptionKey: options.dataEncryptionKey }),
    ...createAdmissionsReviewModule(pool, { devOutboxDir: options.devOutboxDir }),
    ...createAdmissionsOperationsModule(pool),
    ...createAdmissionsMigrationModule(pool, { storage: options.storage }),
    ...createRegistryModule(pool),
    ...createCourseRegistrationModule(pool)
  };
  // Automations read other modules (registration eligibility), so they receive the assembled repository.
  Object.assign(repository, createAutomationsModule(pool, { repository: () => repository }), createAiFeaturesModule(pool, { ...options, repository: () => repository }), createCalendarModule(pool, { repository: () => repository }), createStudentLettersModule(pool, { repository: () => repository }), createStudentCardModule(pool, { repository: () => repository, dataEncryptionKey: options.dataEncryptionKey }), createNotificationPreferencesModule(pool), createAttendanceModule(pool, { dataEncryptionKey: options.dataEncryptionKey }), createCourseEvaluationsModule(pool), createAppointmentsModule(pool), createOnlinePaymentsModule(pool, { payments: options.payments }), createPushModule(pool, { push: options.push }), createSmsModule(pool, { sms: options.sms }));
  return repository;
}

async function count(pool, table) {
  const result = await pool.query(`select count(*)::int as count from ${table}`);
  return result.rows[0].count;
}

async function list(pool, table, orderBy) {
  const result = await pool.query(`select * from ${table} order by ${orderBy}`);
  return result.rows;
}

async function getWorkflowScope(pool, workflowInstance) {
  return getResourceScope(pool, workflowInstance.subject_type, workflowInstance.subject_id);
}

async function findTask(pool, taskId) {
  const result = await pool.query(
    `select
      id,
      title,
      queue,
      assignee_account_id,
      workflow_instance_id,
      priority,
      due_at,
      status
     from tasks
     where id = $1`,
    [taskId]
  );

  if (result.rowCount === 0) {
    const error = new Error("Task was not found.");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

async function assertActorCanAccessTask(pool, actor, task) {
  if (!task.workflow_instance_id) {
    return;
  }

  const workflow = await pool.query("select * from workflow_instances where id = $1", [task.workflow_instance_id]);
  if (workflow.rowCount === 0) {
    const error = new Error("Task workflow instance was not found.");
    error.statusCode = 404;
    throw error;
  }

  const targetScope = await getWorkflowScope(pool, workflow.rows[0]);
  assertActorCanAccessScope(actor, targetScope);
}

async function recordLoginFailure(pool, email, ipAddress) {
  await pool.query(
    "insert into login_failures (id, email_normalized, ip_address) values ($1, $2, $3)",
    [`lf_${randomUUID()}`, email, ipAddress || null]
  );
  await insertAudit(pool, {
    actorId: "anonymous",
    action: "identity.login.failed",
    subjectType: "Account",
    subjectId: email,
    reason: "Invalid login attempt"
  });
}

async function findTemplate(pool, templateCode, channel) {
  const result = await pool.query(
    `select id, code, channel, subject, body
     from notification_templates
     where code = $1 and channel = $2
     order by version desc
     limit 1`,
    [templateCode, channel]
  );
  if (result.rowCount === 0) {
    const error = new Error("Notification template was not found.");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

function renderTemplate(template, variables) {
  return Object.entries(variables).reduce(
    (body, [key, value]) => body.replaceAll(`{{${key}}}`, String(value)),
    template
  );
}

const organizationUnitSelect = `select
  id,
  code,
  name,
  unit_type as "unitType",
  parent_id as "parentId",
  status,
  to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo"
from organization_units`;

const programmeVersionSelect = `select
  id,
  programme_id as "programmeId",
  version_label as "versionLabel",
  revision,
  requirements,
  status,
  to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') as "effectiveTo",
  created_by as "createdBy",
  published_at as "publishedAt",
  published_by as "publishedBy",
  retired_at as "retiredAt",
  retired_by as "retiredBy"
from programme_versions`;

async function findOrganizationUnit(db, unitId, { forUpdate = false } = {}) {
  const result = await db.query(`${organizationUnitSelect} where id = $1 ${forUpdate ? "for update" : ""}`, [unitId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Organization unit was not found.");
  }
  return result.rows[0];
}

async function resolveParentUnit(db, unitType, parentId) {
  if (unitType === "faculty") {
    if (parentId) {
      throw requestError(400, "Faculties are top-level units and cannot have a parent.");
    }
    return null;
  }
  if (!parentId) {
    throw requestError(400, "Departments must belong to a faculty.");
  }
  const parent = await findOrganizationUnit(db, parentId);
  if (parent.unitType !== "faculty" || parent.status !== "active") {
    throw requestError(409, "A department's parent must be an active faculty.");
  }
  return parent.id;
}

async function insertUnitHistory(db, entry) {
  const id = `ouh_${randomUUID()}`;
  await db.query(
    `insert into organization_unit_history (id, unit_id, name, parent_id, status, effective_from, changed_by, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, entry.unitId, entry.name, entry.parentId, entry.status, entry.effectiveFrom, entry.changedBy, entry.reason]
  );
  return id;
}

// Closes the unit's open history period and opens a new one. A same-day change closes the old
// period with an empty range; readers resolve a date to the latest-recorded row starting on or before it.
async function recordUnitChange(db, unitId, entry) {
  if (entry.effectiveFrom > todayIso()) {
    throw requestError(400, "Organization unit changes cannot be scheduled for a future date yet.");
  }
  const open = await db.query(
    `select id, to_char(effective_from, 'YYYY-MM-DD') as "effectiveFrom"
     from organization_unit_history
     where unit_id = $1 and effective_to is null
     order by effective_from desc, recorded_at desc
     limit 1
     for update`,
    [unitId]
  );
  const current = open.rows[0];
  if (current && entry.effectiveFrom < current.effectiveFrom) {
    throw requestError(409, `Effective date cannot be before the current period, which started ${current.effectiveFrom}.`);
  }
  if (current) {
    await db.query(
      "update organization_unit_history set effective_to = $1::date - 1 where id = $2",
      [entry.effectiveFrom, current.id]
    );
  }
  const afterRef = await insertUnitHistory(db, { unitId, ...entry });
  return { beforeRef: current?.id, afterRef };
}

async function findProgramme(db, programmeId) {
  const result = await db.query("select id, code, status from programmes where id = $1", [programmeId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Programme was not found.");
  }
  return result.rows[0];
}

async function findProgrammeVersion(db, versionId, { forUpdate = false } = {}) {
  const result = await db.query(`${programmeVersionSelect} where id = $1 ${forUpdate ? "for update" : ""}`, [versionId]);
  if (result.rowCount === 0) {
    throw requestError(404, "Programme version was not found.");
  }
  return result.rows[0];
}

export function isEffectiveOn(version, date) {
  return ["published", "retired"].includes(version.status)
    && Boolean(version.effectiveFrom)
    && version.effectiveFrom <= date
    && (!version.effectiveTo || version.effectiveTo >= date);
}
