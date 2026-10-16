const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const results = {};

try {
  const admin = await login(adminCredentials);

  const assigned = await post(
    "/api/tasks/task_review_mock_application/assign",
    {
      assigneeAccountId: "acct_admissions_officer",
      reason: "Task smoke assignment"
    },
    admin.token
  );
  results.assignedStatus = assigned.data.status;
  results.assignedTo = assigned.data.assigneeAccountId;

  const handedOff = await post(
    "/api/tasks/task_review_mock_application/handoff",
    {
      queue: "admissions.academic_review",
      assigneeAccountId: "acct_admissions_officer",
      reason: "Task smoke handoff"
    },
    admin.token
  );
  results.handoffStatus = handedOff.data.status;
  results.handoffQueue = handedOff.data.queue;

  const completed = await post(
    "/api/tasks/task_review_mock_application/complete",
    {
      reason: "Task smoke completion"
    },
    admin.token
  );
  results.completedStatus = completed.data.status;

  const audit = await get("/api/audit/events", admin.token);
  const actions = audit.data.map((event) => event.action);
  for (const action of ["task.assigned", "task.handed_off", "task.completed"]) {
    if (!actions.includes(action)) {
      throw new Error(`Missing audit action: ${action}`);
    }
  }
  results.auditActionsVerified = ["task.assigned", "task.handed_off", "task.completed"];

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function login(credentials) {
  const response = await post("/api/identity/sessions", credentials);
  return response.data;
}

async function get(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: bearer(token)
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

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
