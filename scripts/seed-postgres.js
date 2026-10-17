import { loadConfig } from "../server/config.js";
import { createPool } from "../server/db.js";
import { hashSecret } from "../server/security.js";
import { createSeedData } from "./seed-data.js";
import { loadReferenceData } from "./reference-data.js";
import { loadWorkflowDefinitions } from "./workflow-definitions.js";
import { loadNotificationTemplates } from "./notification-templates.js";
import { loadIntegrationCatalogue } from "./integration-catalogue.js";
import { assertDevelopmentSeed,databaseSeedTarget } from './development-seed-safety.js';

assertDevelopmentSeed();
const config = loadConfig();
const acknowledgedDatabase = databaseSeedTarget(config.databaseUrl,process.argv.slice(2));
const pool = createPool(config);
const seed = createSeedData();

try {
  await pool.query("begin");
  const actualDatabase = (await pool.query('select current_database() as name')).rows[0].name;
  if (actualDatabase !== acknowledgedDatabase) throw new Error('Connected database does not match the reset acknowledgement.');
  const roleSetup = await captureMigrationRoleSetup();
  await clearData();
  await insertSeedData();
  await restoreMigrationRoleSetup(roleSetup);
  await pool.query("commit");
  console.log("Seeded PostgreSQL Phase 1 foundation data");
} catch (error) {
  await pool.query("rollback");
  throw error;
} finally {
  await pool.end();
}

// Migrations (e.g. 119 consolidated legacy profiles) define roles, assignability and profile membership
// that the seed's own role list does not know about. The reset truncates them, so carry them across.
async function captureMigrationRoleSetup() {
  const roles = (await pool.query(
    "select code, name, risk, active, is_assignable, legacy_access_level from roles"
  )).rows;
  const members = await pool.query("select to_regclass('role_profile_members') is not null as present");
  const profiles = members.rows[0].present
    ? (await pool.query("select profile_code, member_code from role_profile_members")).rows
    : [];
  return { roles, profiles };
}

async function restoreMigrationRoleSetup({ roles, profiles }) {
  for (const role of roles) {
    await pool.query(
      `insert into roles (code, name, risk, active, is_assignable, legacy_access_level) values ($1, $2, $3, $4, $5, $6)
       on conflict (code) do update set name = excluded.name, active = excluded.active,
         is_assignable = excluded.is_assignable, legacy_access_level = excluded.legacy_access_level`,
      [role.code, role.name, role.risk, role.active, role.is_assignable, role.legacy_access_level]
    );
  }
  for (const profile of profiles) {
    await pool.query(
      "insert into role_profile_members (profile_code, member_code) values ($1, $2) on conflict do nothing",
      [profile.profile_code, profile.member_code]
    );
  }
  if ((await pool.query("select to_regprocedure('refresh_legacy_access_profiles()') is not null as present")).rows[0].present) {
    await pool.query("select refresh_legacy_access_profiles()");
  }
}

async function clearData() {
  await pool.query(`
    truncate
      admissions_legacy_records,
      admissions_migration_batches,
      admissions_routes,
      student_programmes,
      students,
      gpa_rule_sets,
      grading_schemes,
      curriculum_entries,
      course_prerequisites,
      courses,
      invitations,
      notifications,
      notification_templates,
      documents,
      tasks,
      workflow_instances,
      workflow_definitions,
      resource_scopes,
      reference_values,
      academic_periods,
      intakes,
      programme_versions,
      programmes,
      organization_units,
      audit_events,
      role_assignments,
      permissions,
      roles,
      role_permissions,
      accounts,
      people,
      foundation_lanes,
      decisions,
      implementation_tickets,
      exit_gates
    restart identity cascade
  `);
}

async function insertSeedData() {
  for (const person of seed.people) {
    await pool.query(
      `insert into people (id, preferred_name, legal_name, personas, status)
       values ($1, $2, $3, $4, $5)`,
      [person.id, person.preferredName, person.legalName, JSON.stringify(person.personas), person.status]
    );
  }

  for (const account of seed.accounts) {
    const password = account.devPassword ? await hashSecret(account.devPassword) : null;
    await pool.query(
      `insert into accounts (id, person_id, email, status, mfa_required, password_hash, password_salt, password_set_at)
       values ($1, $2, $3, $4, $5, $6, $7, case when $6::text is null then null else now() end)`,
      [
        account.id,
        account.personId,
        account.email,
        account.status,
        account.mfaRequired,
        password?.hash || null,
        password?.salt || null
      ]
    );
  }

  for (const role of seed.roles) {
    await pool.query(
      "insert into roles (code, name, risk) values ($1, $2, $3)",
      [role.code, role.name, role.risk]
    );
  }

  // The permissions trigger grants new permissions to this migration-defined role.
  // Recreate it after the development reset before inserting permissions.
  await pool.query("insert into roles (code, name, risk) values ('master_administrator', 'Master Administrator', 'critical') on conflict (code) do nothing");

  for (const permission of seed.permissions) {
    await pool.query(
      "insert into permissions (code, description) values ($1, $2)",
      [permission, permission]
    );
  }

  for (const [roleCode, permissions] of Object.entries(seed.rolePermissions)) {
    for (const permissionCode of permissions) {
      await pool.query(
        `insert into role_permissions (role_code, permission_code)
         values ($1, $2)`,
        [roleCode, permissionCode]
      );
    }
  }

  for (const assignment of seed.roleAssignments) {
    await pool.query(
      `insert into role_assignments (id, account_id, role_code, scope, effective_from, granted_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        assignment.id,
        assignment.accountId,
        assignment.roleCode,
        JSON.stringify(assignment.scope),
        assignment.effectiveFrom,
        assignment.grantedBy
      ]
    );
  }

  for (const unit of [
    ["fac_technology", "TECH", "Faculty of Technology", "faculty", null],
    ["dept_computing", "COMP", "Department of Computing", "department", "fac_technology"]
  ]) {
    const [id, code, name, unitType, parentId] = unit;
    await pool.query(
      `insert into organization_units (id, code, name, unit_type, parent_id, status, effective_from)
       values ($1, $2, $3, $4, $5, 'active', '2026-01-01')`,
      [id, code, name, unitType, parentId]
    );
    await pool.query(
      `insert into organization_unit_history (id, unit_id, name, parent_id, status, effective_from, changed_by, reason)
       values ($1, $2, $3, $4, 'active', '2026-01-01', 'system_seed', 'Seeded organization unit')`,
      [`ouh_seed_${id}`, id, name, parentId]
    );
  }

  for (const programme of seed.masterData.programmes) {
    await pool.query(
      `insert into programmes (id, code, name, department_id, status)
       values ($1, $2, $3, $4, $5)`,
      [programme.id, programme.code, programme.name, programme.departmentId, programme.status]
    );
  }

  await pool.query(
    `insert into programme_versions (id, programme_id, version_label, requirements, status, effective_from, created_by, published_by, published_at)
     values ($1, $2, $3, $4, $5, $6, 'system_seed', 'system_seed', now())`,
    ["pv_bsc_is_2027", "prog_bsc_is", "2027", JSON.stringify({ documents: ["prior_transcript", "national_id"] }), "published", "2027-01-01"]
  );

  for (const intake of seed.masterData.intakes) {
    await pool.query(
      `insert into intakes (id, programme_id, label, capacity, status, application_opens_at, application_closes_at, starts_on, published_at, published_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $5 = 'published' then now() end, case when $5 = 'published' then 'system_seed' end)`,
      [intake.id, intake.programmeId, intake.label, intake.capacity, intake.status, intake.applicationOpensAt || null, intake.applicationClosesAt || null, intake.startsOn || null]
    );
  }

  await pool.query(
    `insert into academic_periods (id, code, name, period_type, starts_on, ends_on, lifecycle_status, windows, created_by)
     values ('ay_2027', 'AY-2027', 'Academic Year 2027', 'academic_year', '2027-01-01', '2027-12-31', 'planning', '{}'::jsonb, 'system_seed')`
  );
  await pool.query(
    `insert into academic_periods (id, code, name, period_type, starts_on, ends_on, lifecycle_status, windows, parent_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'ay_2027')`,
    [
      "period_2027_s1",
      "2027-S1",
      "2027 Semester 1",
      "semester",
      "2027-02-01",
      "2027-06-30",
      "planning",
      JSON.stringify({ registration: ["2027-01-15", "2027-02-15"], teaching: ["2027-02-01", "2027-05-31"] })
    ]
  );

  await loadReferenceData(pool);

  const pilotCourses = [
    ["course_comp101", "COMP101", "Introduction to Programming", 15, 1, []],
    ["course_infs101", "INFS101", "Foundations of Information Systems", 15, 1, []],
    ["course_comp102", "COMP102", "Data Structures", 15, 1, ["course_comp101"]],
    ["course_comp201", "COMP201", "Database Systems", 15, 2, ["course_comp102"]]
  ];
  for (const [id, code, title, credits, level] of pilotCourses) {
    await pool.query(
      `insert into courses (id, code, title, credits, level, department_id, status, effective_from, created_by)
       values ($1, $2, $3, $4, $5, 'dept_computing', 'active', '2026-01-01', 'system_seed')`,
      [id, code, title, credits, level]
    );
  }
  for (const [id, , , , , prerequisites] of pilotCourses) {
    for (const prerequisiteId of prerequisites) {
      await pool.query(
        "insert into course_prerequisites (course_id, prerequisite_course_id) values ($1, $2)",
        [id, prerequisiteId]
      );
    }
  }
  for (const [courseId, year, term] of [
    ["course_comp101", 1, "S1"],
    ["course_infs101", 1, "S1"],
    ["course_comp102", 1, "S2"],
    ["course_comp201", 2, "S1"]
  ]) {
    await pool.query(
      `insert into curriculum_entries (id, programme_version_id, course_id, year_of_study, term, requirement_type)
       values ($1, 'pv_bsc_is_2027', $2, $3, $4, 'core')`,
      [`cur_seed_${courseId}`, courseId, year, term]
    );
  }

  // Placeholder scheme and GPA rules so later modules have something to calculate with. The real
  // bands, points, and thresholds need Academic Board approval before any official use.
  await pool.query(
    `insert into grading_schemes (id, code, version, name, status, bands, classifications, effective_from, created_by, published_by, published_at)
     values ('gs_svu_undergraduate_v1', 'svu_undergraduate', 1, 'Undergraduate grading (placeholder pending Academic Board)', 'published', $1, $2, '2026-01-01', 'system_seed', 'system_seed', now())`,
    [
      JSON.stringify([
        { minMark: 0, maxMark: 49, grade: "F", points: 0, passing: false },
        { minMark: 50, maxMark: 59, grade: "P", points: 1, passing: true },
        { minMark: 60, maxMark: 64, grade: "2.2", points: 2, passing: true },
        { minMark: 65, maxMark: 74, grade: "2.1", points: 3, passing: true },
        { minMark: 75, maxMark: 100, grade: "1", points: 4, passing: true }
      ]),
      JSON.stringify([
        { minGpa: 3.5, label: "First class" },
        { minGpa: 2.75, label: "Upper second" },
        { minGpa: 2, label: "Lower second" },
        { minGpa: 1, label: "Pass" }
      ])
    ]
  );
  await pool.query(
    `insert into gpa_rule_sets (id, code, version, name, status, grading_scheme_id, rules, samples, effective_from, created_by, published_by, published_at)
     values ('gpa_svu_undergraduate_gpa_v1', 'svu_undergraduate_gpa', 1, 'Undergraduate GPA (placeholder pending Academic Board)', 'published',
             'gs_svu_undergraduate_v1', $1, $2, '2026-01-01', 'system_seed', 'system_seed', now())`,
    [
      JSON.stringify({ creditWeighted: true, retakePolicy: "latest", excludeGrades: ["W", "EX"], includeFailed: true, rounding: { decimals: 2, mode: "half_up" } }),
      JSON.stringify([
        {
          name: "failed then passed retake counts the latest attempt",
          results: [
            { courseCode: "COMP101", credits: 15, mark: 80 },
            { courseCode: "INFS101", credits: 15, mark: 62 },
            { courseCode: "COMP102", credits: 30, mark: 45, attempt: 1 },
            { courseCode: "COMP102", credits: 30, mark: 68, attempt: 2 }
          ],
          expectedGpa: 3,
          expectedClassification: "Upper second"
        }
      ])
    ]
  );

  await loadWorkflowDefinitions(pool);
  await pool.query(`insert into admissions_routes (code, name, definition_code, academic_stages) values
    ('undergraduate', 'Undergraduate', 'admissions_application', '["Academic review"]'),
    ('postgraduate', 'Postgraduate', 'admissions_postgraduate', '["Academic review", "Faculty review"]')`);
  await loadNotificationTemplates(pool);
  await loadIntegrationCatalogue(pool);

  for (const instance of seed.workflowInstances) {
    await pool.query(
      `insert into workflow_instances (id, definition_id, subject_type, subject_id, state, owner_account_id, status)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        instance.id,
        instance.definitionId,
        instance.subjectType,
        instance.subjectId,
        instance.state,
        instance.ownerAccountId,
        instance.status
      ]
    );
  }

  await pool.query(
    `insert into resource_scopes (id, resource_type, resource_id, programme_code, intake_id)
     values ($1, $2, $3, $4, $5)`,
    ["scope_app_mock_001", "Application", "app_mock_001", "BSC-IS", "intake_2027_feb"]
  );

  for (const task of seed.tasks) {
    await pool.query(
      `insert into tasks (id, title, queue, assignee_account_id, workflow_instance_id, priority, due_at, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        task.id,
        task.title,
        task.queue,
        task.assigneeAccountId,
        task.workflowInstanceId,
        task.priority,
        task.dueAt,
        task.status
      ]
    );
  }

  for (const document of seed.documents) {
    await pool.query(
      `insert into documents (id, owner_type, owner_id, document_type, classification, storage_key, checksum, lifecycle, malware_scan_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        document.id,
        document.ownerType,
        document.ownerId,
        document.documentType,
        document.classification,
        document.storageKey,
        document.checksum,
        document.lifecycle,
        document.malwareScanStatus
      ]
    );
  }

  await pool.query(
    `insert into notification_templates (id, code, channel, subject, body, version, status)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    ["nt_admissions_receipt_email_v1", "admissions.receipt", "email", "Application received", "Your application has been received.", 1, "draft"]
  );

  for (const [index, lane] of seed.foundationLanes.entries()) {
    await pool.query(
      `insert into foundation_lanes (id, name, status, trace, display_order)
       values ($1, $2, $3, $4, $5)`,
      [`lane_${lane.name.toLowerCase().replaceAll(" ", "_")}`, lane.name, lane.status, lane.trace, index + 1]
    );
  }

  for (const [index, decision] of seed.decisions.entries()) {
    await pool.query(
      `insert into decisions (id, decision_id, title, recommendation, status, display_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [`decision_${decision.id.toLowerCase()}`, decision.id, decision.decision, decision.recommendation, decision.status, index + 1]
    );
  }

  for (const [index, ticket] of seed.implementationTickets.entries()) {
    await pool.query(
      `insert into implementation_tickets (id, ticket_id, title, status, display_order)
       values ($1, $2, $3, $4, $5)`,
      [`ticket_${ticket.id.toLowerCase().replaceAll(".", "_")}`, ticket.id, ticket.title, ticket.status, index + 1]
    );
  }

  for (const [index, gate] of seed.exitGates.entries()) {
    await pool.query(
      `insert into exit_gates (id, gate_id, title, status, display_order)
       values ($1, $2, $3, $4, $5)`,
      [`exit_${gate.id}`, gate.id, gate.title, gate.status, index + 1]
    );
  }

  for (const event of seed.auditEvents) {
    await pool.query(
      `insert into audit_events (id, occurred_at, actor_id, action, subject_type, subject_id, source, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event.id, event.occurredAt, event.actorId, event.action, event.subjectType, event.subjectId, event.source, event.reason]
    );
  }
}
