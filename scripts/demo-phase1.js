import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidencePath = new URL("../docs/phase-1/EXIT_GATE_EVIDENCE.generated.json", import.meta.url);

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const demoOfficer = {
  email: `phase1.demo.${Date.now()}@southvalley.test`,
  password: "Phase1-Demo-Officer-Password-2026!",
  preferredName: "Phase 1",
  legalName: "Phase 1 Demo Officer"
};

const scope = {
  programmeCodes: ["BSC-IS"],
  intakeIds: ["intake_2027_feb"]
};

const evidence = {
  runId,
  baseUrl,
  startedAt: new Date().toISOString(),
  gates: [],
  artifacts: {}
};

try {
  const health = await get("/api/health");
  recordGate("schema_and_runtime", "passed", "Health check reached the Node server and PostgreSQL.", {
    status: health.status,
    database: health.database.status
  });

  const adminSession = await login(adminCredentials);
  recordGate("admin_authentication", "passed", "Seeded system administrator can authenticate.", {
    accountId: adminSession.account.id,
    sessionId: adminSession.id
  });

  const invitation = await post(
    "/api/identity/invitations",
    {
      email: demoOfficer.email,
      roleCode: "admissions_officer",
      scope,
      reason: "Phase 1 exit-gate demo invitation"
    },
    adminSession.token
  );
  recordGate("invite_user", "passed", "System administrator created a scoped invitation.", {
    invitationId: invitation.data.id,
    email: invitation.data.email,
    roleCode: invitation.data.roleCode,
    scope: invitation.data.scope
  });

  const account = await post("/api/identity/activations", {
    token: invitation.data.activationToken,
    password: demoOfficer.password,
    preferredName: demoOfficer.preferredName,
    legalName: demoOfficer.legalName
  });
  recordGate("activate_user", "passed", "Invited staff account activated with a password hash.", {
    accountId: account.data.id,
    email: account.data.email,
    status: account.data.status
  });

  const demoSession = await login({
    email: demoOfficer.email,
    password: demoOfficer.password
  });
  recordGate("login_user", "passed", "Activated staff account can create a bearer session.", {
    accountId: demoSession.account.id,
    sessionId: demoSession.id
  });

  const demoSessionsBeforeSuspension = await get(`/api/identity/accounts/${demoSession.account.id}/sessions`, adminSession.token);
  const suspendedDemoAccount = await post(
    `/api/identity/accounts/${demoSession.account.id}/suspend`,
    {
      reason: "Phase 1 exit-gate suspension check"
    },
    adminSession.token
  );
  const deniedWhileSuspended = await expectStatus(
    "/api/identity/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: demoOfficer.email,
        password: demoOfficer.password
      })
    },
    401
  );
  const reactivatedDemoAccount = await post(
    `/api/identity/accounts/${demoSession.account.id}/reactivate`,
    {
      reason: "Phase 1 exit-gate reactivation check"
    },
    adminSession.token
  );
  const demoSessionAfterReactivation = await login({
    email: demoOfficer.email,
    password: demoOfficer.password
  });
  recordGate("manage_account_lifecycle", "passed", "Admin listed sessions, suspended the account, revoked sessions, blocked login, and reactivated it.", {
    accountId: reactivatedDemoAccount.data.id,
    sessionsObserved: demoSessionsBeforeSuspension.data.length,
    revokedSessions: suspendedDemoAccount.data.revokedSessions.length,
    deniedWhileSuspended,
    statusAfterReactivation: reactivatedDemoAccount.data.status
  });

  const assignment = await post(
    "/api/access/role-assignments",
    {
      accountId: demoSession.account.id,
      roleCode: "admissions_officer",
      scope,
      reason: "Phase 1 exit-gate scoped role assignment"
    },
    adminSession.token
  );
  recordGate("assign_scoped_role", "passed", "Admin assigned admissions role limited to the pilot programme and intake.", {
    assignmentId: assignment.data.id,
    roleCode: assignment.data.roleCode,
    scope: assignment.data.scope
  });

  const programme = await post(
    "/api/master-data/programmes",
    {
      code: `P1-DEMO-${Date.now()}`,
      name: "Phase 1 Demo Programme",
      departmentId: "dept_computing",
      status: "draft",
      reason: "Phase 1 exit-gate master-data programme"
    },
    adminSession.token
  );
  const intake = await post(
    "/api/master-data/intakes",
    {
      programmeId: programme.data.id,
      label: `Phase 1 Demo Intake ${Date.now()}`,
      capacity: 30,
      applicationOpensAt: "2027-03-01T00:00:00.000Z",
      applicationClosesAt: "2027-04-30T23:59:59.000Z",
      status: "draft",
      reason: "Phase 1 exit-gate master-data intake"
    },
    adminSession.token
  );
  recordGate("protect_master_data", "passed", "Admin created protected programme and intake master data with audit evidence.", {
    programmeId: programme.data.id,
    programmeCode: programme.data.code,
    intakeId: intake.data.id,
    intakeCapacity: intake.data.capacity
  });

  const started = await post(
    "/api/workflows/instances",
    {
      definitionCode: "admissions_application",
      subjectType: "Application",
      subjectId: `app_phase1_demo_${Date.now()}`,
      scope: { programmeCode: "BSC-IS", intakeId: "intake_2027_feb" },
      reason: "Phase 1 exit-gate application workflow"
    },
    demoSessionAfterReactivation.token
  );
  const workflowPath = `/api/workflows/instances/${started.data.id}/transitions`;
  let workflow = started;
  for (const toState of ["Submitted", "Payment verified", "Completeness review", "Academic review", "Decision"]) {
    workflow = await post(workflowPath, { toState, reason: `Phase 1 exit-gate move to ${toState}` }, demoSessionAfterReactivation.token);
  }
  const illegalMoveStatus = await expectStatus(workflowPath, {
    method: "POST",
    headers: { ...bearer(demoSessionAfterReactivation.token), "Content-Type": "application/json" },
    body: JSON.stringify({ toState: "Accepted", reason: "Skipping the offer must be refused" })
  }, 409);
  const officerDecisionStatus = await expectStatus(workflowPath, {
    method: "POST",
    headers: { ...bearer(demoSessionAfterReactivation.token), "Content-Type": "application/json" },
    body: JSON.stringify({ toState: "Offer issued", reason: "Officer lacks decision authority" })
  }, 403);
  const offer = await post(workflowPath, { toState: "Offer issued", reason: "Admissions decision recorded" }, adminSession.token);
  recordGate("transition_workflow", "passed", "Scoped admissions officer walked a guarded application workflow to Decision; illegal moves and decisions without authority were refused.", {
    workflowId: workflow.data.id,
    definition: `${started.data.definitionCode} v${started.data.definitionVersion}`,
    officerReachedState: workflow.data.state,
    illegalMoveStatus,
    officerDecisionStatus,
    finalState: offer.data.state,
    subjectId: workflow.data.subjectId
  });

  const taskAssignment = await post(
    "/api/tasks/task_review_mock_application/assign",
    {
      assigneeAccountId: demoSession.account.id,
      reason: "Phase 1 exit-gate task assignment"
    },
    demoSessionAfterReactivation.token
  );
  const taskHandoff = await post(
    "/api/tasks/task_review_mock_application/handoff",
    {
      queue: "admissions.decision",
      assigneeAccountId: demoSession.account.id,
      reason: "Phase 1 exit-gate task handoff"
    },
    demoSessionAfterReactivation.token
  );
  const taskCompletion = await post(
    "/api/tasks/task_review_mock_application/complete",
    {
      reason: "Phase 1 exit-gate task completion"
    },
    demoSessionAfterReactivation.token
  );
  recordGate("manage_task", "passed", "Scoped admissions officer assigned, handed off, and completed the pilot task.", {
    taskId: taskCompletion.data.id,
    assignedStatus: taskAssignment.data.status,
    handoffQueue: taskHandoff.data.queue,
    completedStatus: taskCompletion.data.status
  });

  const document = await post(
    "/api/documents",
    {
      ownerType: "Application",
      ownerId: "app_mock_001",
      documentType: "phase1_demo_checklist",
      classification: "internal",
      storageKey: `private/applications/app_mock_001/phase1-demo-${runId}.json`,
      checksum: "demo-checksum-pending",
      reason: "Phase 1 exit-gate document metadata"
    },
    demoSessionAfterReactivation.token
  );
  recordGate("create_document_metadata", "passed", "Scoped admissions officer created document metadata for the pilot application.", {
    documentId: document.data.id,
    ownerId: document.data.ownerId,
    storageKey: document.data.storageKey
  });

  const preview = await post(
    "/api/notifications/preview",
    {
      templateCode: "admissions.receipt",
      channel: "email",
      variables: { applicantName: "Tinashe" }
    },
    demoSessionAfterReactivation.token
  );
  recordGate("preview_notification", "passed", "Notification template rendered through the provider-neutral preview endpoint.", {
    channel: preview.data.channel,
    subject: preview.data.subject
  });

  const notification = await post(
    "/api/notifications/send",
    {
      recipientAccountId: "acct_tinashe",
      templateCode: "admissions.receipt",
      channel: "email",
      variables: { applicantName: "Tinashe" },
      reason: "Phase 1 exit-gate notification stub"
    },
    demoSessionAfterReactivation.token
  );
  recordGate("queue_notification", "passed", "Notification send stub queued a provider-neutral message.", {
    notificationId: notification.data.id,
    status: notification.data.status
  });

  const audit = await get("/api/audit/events", adminSession.token);
  const observedActions = [...new Set(audit.data.map((event) => event.action))];
  const requiredActions = [
    "identity.invitation.created",
    "identity.account.activated",
    "identity.session.created",
    "identity.account.suspended",
    "identity.account.reactivated",
    "access.role_assignment.created",
    "master_data.programme.created",
    "master_data.intake.created",
    "workflow.instance.created",
    "workflow.transitioned",
    "task.assigned",
    "task.handed_off",
    "task.completed",
    "document.created",
    "notification.queued"
  ];
  const missingActions = requiredActions.filter((action) => !observedActions.includes(action));
  if (missingActions.length > 0) {
    throw new Error(`Audit evidence is missing action(s): ${missingActions.join(", ")}`);
  }
  recordGate("audit_evidence", "passed", "Audit log contains evidence for identity, role, workflow, document, and notification events.", {
    observedActions: requiredActions,
    auditEventsReturned: audit.data.length
  });

  const status = await get("/api/foundation/status");
  evidence.artifacts.foundationStatusCounts = status.counts;
  evidence.completedAt = new Date().toISOString();
  evidence.status = "passed";

  await mkdir(new URL("../docs/phase-1/", import.meta.url), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  evidence.status = "failed";
  evidence.error = error.message;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8").catch(() => {});
  console.error(error.message);
  process.exit(1);
}

async function login(credentials) {
  const response = await post("/api/identity/sessions", credentials);
  return response.data;
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? bearer(token) : {}
  });
  return parseResponse(response);
}

async function post(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(token ? bearer(token) : {}),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Expected ${expectedStatus} for ${path}, received ${response.status}: ${body}`);
  }
  return response.status;
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function recordGate(id, status, summary, details) {
  evidence.gates.push({
    id,
    status,
    summary,
    details
  });
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
