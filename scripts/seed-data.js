export function createSeedData() {
  const seed = {
    schemaVersion: 1,
    seededAt: new Date().toISOString(),
    people: [
      {
        id: "person_tinashe",
        preferredName: "Tinashe",
        legalName: "Tinashe Ncube",
        personas: ["student"],
        status: "active"
      },
      {
        id: "person_admissions_officer",
        preferredName: "Amina",
        legalName: "Amina Dube",
        personas: ["staff", "admissions_officer"],
        status: "active"
      },
      {
        id: "person_registrar",
        preferredName: "Rudo",
        legalName: "Rudo Moyo",
        personas: ["staff", "academic_registrar"],
        status: "active"
      },
      {
        id: "person_system_admin",
        preferredName: "System",
        legalName: "SVU System Administrator",
        personas: ["staff", "system_administrator"],
        status: "active"
      }
    ],
    accounts: [
      {
        id: "acct_tinashe",
        personId: "person_tinashe",
        email: "tinashe@example.edu",
        status: "active",
        mfaRequired: false,
        devPassword: "Phase1-Student-Password-2026!"
      },
      {
        id: "acct_admissions_officer",
        personId: "person_admissions_officer",
        email: "admissions@example.edu",
        status: "active",
        mfaRequired: true
      },
      {
        id: "acct_registrar",
        personId: "person_registrar",
        email: "registrar@southvalley.test",
        status: "active",
        mfaRequired: false,
        devPassword: "Kariba-Senate-Approvals-2026!"
      },
      {
        id: "acct_system_admin",
        personId: "person_system_admin",
        email: "admin@southvalley.test",
        status: "active",
        mfaRequired: true,
        devPassword: "Phase1-Admin-Password-2026!"
      }
    ],
    roles: [
      {code:'record_recipient',name:'Shared Records Recipient',risk:'medium'},
      {code:'privacy_officer',name:'Privacy Policy Officer',risk:'high'},
      {code:'privacy_approver',name:'Privacy Policy Approver',risk:'high'},
      {code:'religion_records_officer',name:'Restricted Religion Records Officer',risk:'high'},
      {code:'disability_support_officer',name:'Disability Support Officer',risk:'high'},
      {code:'student_medical_officer',name:'Student Medical Records Officer',risk:'high'},
      {code:'asset_officer',name:'Asset Officer',risk:'high'},
      {code:'asset_approver',name:'Asset Disposal Approver',risk:'high'},
      {code:'report_scheduler',name:'Private Report Scheduler',risk:'high'},
      {code:'support_officer',name:'Student Support Officer',risk:'high'},
      {code:'support_manager',name:'Student Support Manager',risk:'high'},
      {code:'exam_arrangements_officer',name:'Exam Arrangements Officer',risk:'high'},
      { code: "applicant", name: "Applicant", risk: "low" },
      { code: "student", name: "Student", risk: "medium" },
      { code: "admissions_officer", name: "Admissions Officer", risk: "medium" },
      { code: "admissions_manager", name: "Admissions Manager", risk: "high" },
      { code: "system_administrator", name: "System Administrator", risk: "critical" },
      { code: "auditor", name: "Auditor", risk: "high" },
      { code: "academic_registrar", name: "Academic Registrar", risk: "high" },
      { code: "finance_officer", name: "Finance Officer", risk: "high" },
      { code: "examinations_officer", name: "Examinations Officer", risk: "high" },
      { code: "academic_approver", name: "Academic Approver", risk: "high" },
      { code: "external_examiner", name: "External Examiner", risk: "high" },
      { code: "exam_invigilator", name: "Exam Invigilator", risk: "medium" },
      { code: "lecturer", name: "Lecturer", risk: "medium" },
      { code: "hr_officer", name: "HR Officer", risk: "high" },
      { code: "lms_connector", name: "LMS Connector (service)", risk: "high" },
      { code: "records_manager", name: "Records Manager", risk: "high" }
    ],
    permissions: [
      'reports.schedule',
      "integrations.view", "integrations.manage",
      "documents.templates.manage", "documents.templates.approve",
      'communications.self','admissions.communicate',
      'guidance.manage','guidance.publish',
      'enquiries.self','enquiries.manage','enquiries.escalate',
      "repository.manage", "repository.contribute", "repository.publish",
      'support.self','support.view','support.manage','support.escalate',
      'exams.arrangements.manage',
      'exams.arrangements.review',
      "registry.award.request",
      "registry.award.approve",
      "exams.schedule",
      "exams.venues.manage",
      "exams.papers.manage",
      "exams.papers.review",
      "exams.papers.scan",
      "exams.papers.release",
      "exams.duties.self",
      "exams.publish",
      "registry.transcript.issue",
      "assessment.plan.manage",
      "assessment.plan.approve",
      "assessment.marks",
      "assessment.review",
      "assessment.moderate",
      "assessment.external",
      "results.amend.request",
      "results.amend.approve",
      "lms.sync",
      "lms.outcomes.review",
      "teaching.view",
      "teaching.allocate",
      "teaching.approve",
      "teaching.self",
      "staff.view",
      "staff.manage",
      "leave.self",
      "leave.manage",
      "assets.view",
      "assets.manage",
      "assets.approve",
      "restricted.policy.manage",
      "sharing.read",
      "restricted.policy.approve",
      "restricted.religion.read",
      "restricted.disability.read",
      "restricted.medical.read",
      "finance.migrate",
      "finance.import",
      "finance.adjustment.request",
      "finance.adjustment.approve",
      "finance.view",
      "finance.schedule.manage",
      "finance.schedule.publish",
      "finance.billing.run",
      "finance.payment.record",
      "registry.duplicate.request",
      "registry.duplicate.approve",
      "registry.identity.request",
      "registry.identity.approve",
      "academic.view",
      "academic.request",
      "registry.exception.request",
      "registry.lifecycle.request",
      "registry.credit.request",
      "registry.credit.approve",
      "registry.transfer.request",
      "registry.transfer.approve",
      "registry.lifecycle.approve",
      "registry.exception.approve",
      "academic.approve",
      "academic.policy.manage",
      "academic.policy.publish",
      "results.view",
      "results.import",
      "results.review",
      "results.publish",
      "registry.self",
      "registry.view",
      "registry.onboard",
      "registry.registration.configure",
      "registry.registration.academic",
      "registry.registration.financial",
      "identity.invite",
      "identity.manage",
      "identity.activate",
      "admissions.decide",
      "admissions.review",
      "admissions.configure",
      "admissions.migrate",
      "access.assign_role",
      "audit.view",
      "workflow.transition",
      "task.assign",
      "document.create",
      "document.review",
      "document.scan.record",
      "notification.send",
      "master_data.publish",
      "foundation.view",
      "admissions.apply"
    ],
    rolePermissions: {
      report_scheduler:['reports.schedule'],
      support_officer:['support.view','support.manage'],
      support_manager:['support.view','support.manage','support.escalate'],
      exam_arrangements_officer:['exams.arrangements.manage','exams.arrangements.review'],
      system_administrator: [
        'reports.schedule',
        "integrations.view", "integrations.manage",
        "documents.templates.manage", "documents.templates.approve",
        'communications.self','admissions.communicate',
        'guidance.manage','guidance.publish',
        'enquiries.self','enquiries.manage','enquiries.escalate',
        "repository.manage", "repository.contribute", "repository.publish",
        'support.self','support.view','support.manage','support.escalate',
        'exams.arrangements.manage',
        'exams.arrangements.review',
        "exams.papers.manage",
        "exams.papers.review",
        "exams.papers.scan",
        "exams.papers.release",
        "exams.venues.manage",
        "exams.duties.self",
        "registry.award.request",
        "registry.award.approve",
        "exams.schedule",
        "exams.publish",
        "registry.transcript.issue",
        "assessment.plan.manage",
        "assessment.plan.approve",
        "assessment.marks",
        "assessment.review",
        "assessment.moderate",
        "assessment.external",
        "results.amend.request",
        "results.amend.approve",
        "lms.outcomes.review",
        "teaching.view",
        "teaching.allocate",
        "teaching.approve",
        "staff.view",
        "staff.manage",
        "leave.self",
        "leave.manage",
        "assets.view",
        "assets.manage",
        "assets.approve",
        "restricted.policy.manage",
        "restricted.policy.approve",
        "finance.migrate",
        "finance.import",
        "finance.adjustment.request",
        "finance.adjustment.approve",
        "finance.view",
        "finance.schedule.manage",
        "finance.schedule.publish",
        "finance.billing.run",
        "finance.payment.record",
        "registry.duplicate.request",
        "registry.duplicate.approve",
        "registry.identity.request",
        "registry.identity.approve",
        "academic.view",
        "academic.request",
        "registry.exception.request",
        "registry.lifecycle.request",
        "registry.credit.request",
        "registry.credit.approve",
        "registry.transfer.request",
        "registry.transfer.approve",
        "registry.lifecycle.approve",
        "registry.exception.approve",
        "academic.approve",
        "academic.policy.manage",
        "academic.policy.publish",
        "results.view",
        "results.import",
        "results.review",
        "results.publish",
        "registry.view",
        "registry.onboard",
        "registry.registration.configure",
        "registry.registration.academic",
        "registry.registration.financial",
        "admissions.configure",
        "admissions.migrate",
        "admissions.decide",
        "admissions.review",
        "identity.invite",
        "identity.manage",
        "identity.activate",
        "access.assign_role",
        "audit.view",
        "workflow.transition",
        "task.assign",
        "document.create",
        "document.review",
        "document.scan.record",
        "notification.send",
        "master_data.publish",
        "foundation.view"
      ],
      admissions_manager: [
        "leave.self",
        'enquiries.manage','enquiries.escalate',
        'guidance.manage','guidance.publish',
        'admissions.communicate',
        "admissions.configure",
        "admissions.decide",
        "admissions.review",
        "identity.invite",
        "access.assign_role",
        "workflow.transition",
        "task.assign",
        "document.create",
        "document.review",
        "notification.send",
        "foundation.view"
      ],
      admissions_officer: [
        "leave.self",
        'enquiries.manage',
        'guidance.manage',
        'admissions.communicate',
        "admissions.review",
        "workflow.transition",
        "task.assign",
        "document.create",
        "document.review",
        "notification.send",
        "foundation.view"
      ],
      auditor: ["integrations.view", "audit.view", "foundation.view"],
      academic_registrar: ["leave.self", "exams.papers.review", "exams.duties.self", "master_data.publish", "foundation.view", "registry.view", "registry.onboard", "registry.registration.configure", "registry.registration.academic", "results.view", "results.import", "academic.view", "academic.request", "academic.policy.manage", "registry.exception.request", "registry.lifecycle.request", "registry.credit.request", "registry.transfer.request", "registry.identity.request", "registry.identity.approve", "registry.duplicate.request", "registry.duplicate.approve", "finance.view", "staff.view", "teaching.view", "teaching.allocate", "lms.outcomes.review", "results.amend.request", "assessment.plan.manage", "registry.transcript.issue", "exams.publish", "registry.award.request", "repository.contribute", "documents.templates.manage"],
      hr_officer: ["staff.view", "staff.manage", "leave.self", "leave.manage"],
      asset_officer: ["assets.view","assets.manage","leave.self"],
      privacy_officer: ["restricted.policy.manage"],
      record_recipient: ["sharing.read"],
      privacy_approver: ["restricted.policy.approve"],
      religion_records_officer: ["restricted.religion.read"],
      disability_support_officer: ["restricted.disability.read"],
      student_medical_officer: ["restricted.medical.read"],
      asset_approver: ["assets.view","assets.approve","leave.self"],
      lecturer: ["teaching.self", "exams.duties.self", "leave.self"],
      lms_connector: ["lms.sync"],
      academic_approver: ["leave.self", "assessment.moderate", "registry.award.approve", "assessment.plan.approve", "assessment.review", "results.view", "results.amend.approve", "teaching.view", "teaching.approve", "staff.view", "registry.view", "academic.view", "academic.approve", "academic.policy.publish", "registry.exception.approve", "registry.lifecycle.approve", "registry.credit.approve", "registry.transfer.approve"],
      external_examiner: ["assessment.external", "teaching.view"],
      records_manager: ["repository.manage", "repository.contribute", "repository.publish", "documents.templates.approve"],
      examinations_officer: ["leave.self", "exams.papers.manage", "exams.papers.review", "exams.papers.release", "exams.venues.manage", "exams.duties.self", "exams.schedule", "exams.publish", "registry.view", "results.view", "results.review", "results.publish", "lms.outcomes.review", "results.amend.request", "results.amend.approve", "assessment.marks", "assessment.review"],
      exam_invigilator: ["exams.duties.self"],
      finance_officer: ["leave.self", "registry.view", "registry.registration.financial", "finance.view", "finance.schedule.manage", "finance.schedule.publish", "finance.billing.run", "finance.payment.record", "finance.adjustment.request", "finance.adjustment.approve", "finance.import"],
      student: ["foundation.view", "registry.self", "support.self", "communications.self", "enquiries.self"],
      applicant: ["admissions.apply", "foundation.view", "communications.self", "enquiries.self"]
    },
    demoCredentials: {
      email: "admin@southvalley.test",
      password: "Phase1-Admin-Password-2026!"
    },
    restrictedDemoCredentials: {
      email: "tinashe@example.edu",
      password: "Phase1-Student-Password-2026!"
    },
    roleAssignments: [
      {
        id: "ra_admissions_officer",
        accountId: "acct_admissions_officer",
        roleCode: "admissions_officer",
        scope: { programmeCodes: ["BSC-IS"], intakeIds: ["intake_2027_feb"] },
        effectiveFrom: "2026-10-01",
        grantedBy: "system_seed"
      },
      {
        id: "ra_registrar",
        accountId: "acct_registrar",
        roleCode: "academic_registrar",
        scope: {},
        effectiveFrom: "2026-10-01",
        grantedBy: "system_seed"
      },
      {
        id: "ra_system_admin",
        accountId: "acct_system_admin",
        roleCode: "system_administrator",
        scope: {},
        effectiveFrom: "2026-10-01",
        grantedBy: "system_seed"
      }
    ],
    foundationLanes: [
      { name: "Identity", status: "building", trace: "IAM-01 to IAM-12" },
      { name: "Roles", status: "building", trace: "IAM-05, IAM-12" },
      { name: "Audit", status: "building", trace: "IAM-07, IAM-08, OPS-10" },
      { name: "Workflow", status: "building", trace: "ADM-10, ADM-14, REG-09" },
      { name: "Documents", status: "building", trace: "ADM-07, RPT-12" },
      { name: "Notifications", status: "building", trace: "COM-01 to COM-05" },
      { name: "Master Data", status: "building", trace: "ACA-01 to ACA-15" },
      { name: "Operations", status: "building", trace: "OPS-01 to OPS-12" }
    ],
    decisions: [
      { id: "ADR-001", decision: "Application architecture", status: "proposed", recommendation: "Modular monolith" },
      { id: "ADR-002", decision: "Primary database", status: "accepted", recommendation: "PostgreSQL with SQL migrations and seed data" },
      { id: "ADR-003", decision: "Identity provider", status: "open", recommendation: "Foundation-compatible identity now; external IdP later if approved" },
      { id: "ADR-006", decision: "Runtime stack", status: "proposed", recommendation: "Node modular monolith scaffold with PostgreSQL for Phase 1" },
      { id: "ADR-007", decision: "Hosting model", status: "open", recommendation: "Confirm on-prem, cloud, or hybrid" }
    ],
    implementationTickets: [
      { id: "FND-0.1", title: "Choose runtime stack and scaffold app", status: "done" },
      { id: "FND-0.2", title: "Add environment configuration pattern", status: "done" },
      { id: "FND-0.3", title: "Add migration and seed-data framework", status: "done" },
      { id: "FND-0.4", title: "Add health check and structured logging", status: "done" }
    ],
    masterData: {
      faculties: [
        { id: "fac_technology", code: "TECH", name: "Faculty of Technology", status: "active" }
      ],
      departments: [
        { id: "dept_computing", code: "COMP", name: "Department of Computing", facultyId: "fac_technology", status: "active" }
      ],
      programmes: [
        {
          id: "prog_bsc_is",
          code: "BSC-IS",
          name: "BSc Information Systems",
          departmentId: "dept_computing",
          status: "published"
        }
      ],
      intakes: [
        {
          id: "intake_2027_feb",
          programmeId: "prog_bsc_is",
          label: "February 2027",
          capacity: 120,
          status: "published",
          applicationOpensAt: "2026-09-01T00:00:00.000Z",
          applicationClosesAt: "2027-01-15T23:59:59.000Z",
          startsOn: "2027-02-01"
        }
      ]
    },
    workflowInstances: [
      {
        id: "wfi_mock_application",
        definitionId: "wf_admissions_v2",
        subjectType: "Application",
        subjectId: "app_mock_001",
        state: "Submitted",
        ownerAccountId: "acct_admissions_officer",
        status: "active"
      }
    ],
    tasks: [
      {
        id: "task_review_mock_application",
        title: "Review BSc Information Systems application",
        queue: "admissions.completeness",
        assigneeAccountId: "acct_admissions_officer",
        workflowInstanceId: "wfi_mock_application",
        priority: "normal",
        dueAt: "2026-10-08T12:00:00.000Z",
        status: "open"
      }
    ],
    documents: [
      {
        id: "doc_mock_transcript",
        ownerType: "Application",
        ownerId: "app_mock_001",
        documentType: "prior_transcript",
        classification: "confidential",
        storageKey: "private/applications/app_mock_001/prior-transcript.pdf",
        checksum: "pending",
        lifecycle: "uploaded",
        malwareScanStatus: "pending"
      }
    ],
    notifications: [],
    invitations: [],
    exitGates: [
      { id: "gate_identity", title: "Invite, authenticate, authorize, suspend, and audit a user", status: "in_progress" },
      { id: "gate_roles", title: "Assign scoped roles with approval history", status: "in_progress" },
      { id: "gate_master_data", title: "Protect effective-dated master data changes", status: "planned" },
      { id: "gate_services", title: "Reuse workflow, task, document, and notification services", status: "in_progress" },
      { id: "gate_schema", title: "Recreate schema and seed data from automation", status: "in_progress" },
      { id: "gate_backup", title: "Demonstrate backup restoration and rollback", status: "planned" }
    ],
    auditEvents: [
      {
        id: "audit_seed_001",
        occurredAt: new Date().toISOString(),
        actorId: "system_seed",
        action: "foundation.seed.created",
        subjectType: "SeedData",
        subjectId: "schema_v1",
        source: "svu-foundation",
        reason: "Initialize Phase 1 foundation scaffold"
      }
    ]
  };
  seed.permissions.push('messages.self');
  for (const role of ['applicant','student','lecturer','system_administrator','admissions_officer','admissions_manager',
    'academic_registrar','finance_officer','examinations_officer','academic_approver','hr_officer',
    'exam_invigilator','exam_arrangements_officer','support_officer','support_manager','records_manager','asset_officer','asset_approver']) {
    seed.rolePermissions[role].push('messages.self');
  }
  seed.roles.push({code:'cashbook_officer',name:'Institutional Cashbook Officer',risk:'high'},{code:'cashbook_approver',name:'Institutional Cashbook Approver',risk:'high'});
  const cashbookPermissions=['cashbook.view','cashbook.manage','cashbook.approve','cashbook.policy.manage','cashbook.policy.approve'];
  seed.permissions.push(...cashbookPermissions);
  seed.rolePermissions.system_administrator.push(...cashbookPermissions);
  seed.rolePermissions.cashbook_officer=['cashbook.view','cashbook.manage','cashbook.policy.manage','leave.self','messages.self'];
  seed.rolePermissions.cashbook_approver=['cashbook.view','cashbook.approve','cashbook.policy.approve','leave.self','messages.self'];
  seed.permissions.push('rooms.self','rooms.manage','rooms.approve');
  for(const permissions of Object.values(seed.rolePermissions))if(permissions.includes('messages.self'))permissions.push('rooms.self');
  seed.roles.push({code:'room_steward',name:'Institutional Room Steward',risk:'high'},{code:'room_approver',name:'Institutional Room Approver',risk:'high'});
  seed.rolePermissions.system_administrator.push('rooms.manage','rooms.approve');
  seed.rolePermissions.room_steward=['rooms.self','rooms.manage'];
  seed.rolePermissions.room_approver=['rooms.self','rooms.approve'];
  seed.permissions.push('rooms.triage');
  seed.roles.push({code:'room_safety_reviewer',name:'Room Safety Reviewer',risk:'high'});
  seed.rolePermissions.room_safety_reviewer=['rooms.self','rooms.triage'];
  seed.rolePermissions.system_administrator.push('rooms.triage');
  const fleetPermissions=['fleet.view','fleet.manage','fleet.approve','fleet.incidents'];
  seed.permissions.push(...fleetPermissions);
  seed.rolePermissions.system_administrator.push(...fleetPermissions);
  seed.roles.push({code:'fleet_officer',name:'Fleet Officer',risk:'high'},{code:'fleet_approver',name:'Fleet Approver',risk:'high'},{code:'fleet_safety_officer',name:'Fleet Safety Officer',risk:'high'});
  seed.rolePermissions.fleet_officer=['fleet.view','fleet.manage','leave.self','messages.self','rooms.self'];
  seed.rolePermissions.fleet_approver=['fleet.view','fleet.approve','leave.self','messages.self','rooms.self'];
  seed.rolePermissions.fleet_safety_officer=['fleet.view','fleet.incidents','leave.self','messages.self','rooms.self'];
  return seed;
}
