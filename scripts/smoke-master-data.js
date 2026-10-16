const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";
const suffix = Date.now();

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

const results = {};

try {
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);

  results.studentCreateProgrammeDenied = await expectStatus(
    "/api/master-data/programmes",
    {
      method: "POST",
      headers: {
        ...bearer(student.token),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: `DENIED-${suffix}`,
        name: "Denied Programme",
        departmentId: "dept_computing"
      })
    },
    403
  );

  const programme = await post(
    "/api/master-data/programmes",
    {
      code: `P1-MD-${suffix}`,
      name: "Phase 1 Master Data Smoke Programme",
      departmentId: "dept_computing",
      status: "draft",
      reason: "Master-data smoke programme"
    },
    admin.token
  );
  results.programmeCode = programme.data.code;

  const intake = await post(
    "/api/master-data/intakes",
    {
      programmeId: programme.data.id,
      label: `Smoke Intake ${suffix}`,
      capacity: 24,
      applicationOpensAt: "2027-03-01T00:00:00.000Z",
      applicationClosesAt: "2027-04-30T23:59:59.000Z",
      status: "draft",
      reason: "Master-data smoke intake"
    },
    admin.token
  );
  results.intakeId = intake.data.id;
  results.intakeCapacity = intake.data.capacity;

  const audit = await get("/api/audit/events", admin.token);
  const actions = audit.data.map((event) => event.action);
  for (const action of ["master_data.programme.created", "master_data.intake.created"]) {
    if (!actions.includes(action)) {
      throw new Error(`Missing audit action: ${action}`);
    }
  }
  results.auditActionsVerified = ["master_data.programme.created", "master_data.intake.created"];

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

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}
