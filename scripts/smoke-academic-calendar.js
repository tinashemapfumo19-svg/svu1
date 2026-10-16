const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

// Academic years may not overlap, so each run uses its own far-future year.
const year = 3000 + (Math.floor(Date.now() / 1000) % 6000);
const runId = Date.now();
const results = { year };

try {
  const admin = await login(adminCredentials);
  const student = await login(studentCredentials);
  const periods = "/api/master-data/academic-periods";

  results.studentCreateDenied = await expectStatus(periods, request("POST", {
    code: `AY-${runId}`, name: "Denied", periodType: "academic_year", startsOn: `${year}-01-01`, endsOn: `${year}-12-31`
  }, student.token), 403);

  const academicYear = await send("POST", periods, {
    code: `AY-${year}-${runId}`,
    name: `Academic Year ${year}`,
    periodType: "academic_year",
    startsOn: `${year}-01-01`,
    endsOn: `${year}-12-31`,
    reason: "Calendar smoke test"
  }, admin.token);

  results.overlappingYearRejected = await expectStatus(periods, request("POST", {
    code: `AY-OVERLAP-${runId}`, name: "Overlap", periodType: "academic_year", startsOn: `${year}-06-01`, endsOn: `${year + 1}-05-31`
  }, admin.token), 409);
  results.orphanSemesterRejected = await expectStatus(periods, request("POST", {
    code: `S-ORPHAN-${runId}`, name: "Orphan", periodType: "semester", startsOn: `${year}-02-01`, endsOn: `${year}-06-30`
  }, admin.token), 400);
  results.semesterOutsideYearRejected = await expectStatus(periods, request("POST", {
    code: `S-OUT-${runId}`, name: "Outside", periodType: "semester", parentId: academicYear.data.id,
    startsOn: `${year}-11-01`, endsOn: `${year + 1}-03-31`
  }, admin.token), 400);

  const semester1 = await send("POST", periods, {
    code: `S1-${year}-${runId}`,
    name: `${year} Semester 1`,
    periodType: "semester",
    parentId: academicYear.data.id,
    startsOn: `${year}-02-01`,
    endsOn: `${year}-06-30`,
    windows: {
      registration: [`${year}-01-15`, `${year}-02-15`],
      teaching: [`${year}-02-01`, `${year}-05-31`],
      assessment: [`${year}-06-01`, `${year}-06-30`]
    },
    reason: "Calendar smoke test"
  }, admin.token);

  results.overlappingSemesterRejected = await expectStatus(periods, request("POST", {
    code: `S2-BAD-${runId}`, name: "Overlap", periodType: "semester", parentId: academicYear.data.id,
    startsOn: `${year}-06-01`, endsOn: `${year}-11-30`
  }, admin.token), 409);

  await send("POST", periods, {
    code: `S2-${year}-${runId}`,
    name: `${year} Semester 2`,
    periodType: "semester",
    parentId: academicYear.data.id,
    startsOn: `${year}-07-01`,
    endsOn: `${year}-11-30`,
    reason: "Calendar smoke test"
  }, admin.token);

  const s1 = `${periods}/${semester1.data.id}`;
  results.skipPublishRejected = await expectStatus(`${s1}/transitions`, request("POST", { toStatus: "active", reason: "Skip" }, admin.token), 409);
  await send("POST", `${s1}/transitions`, { toStatus: "published", reason: "Calendar approved" }, admin.token);
  results.activateBeforeYearPublishedRejected = await expectStatus(
    `${s1}/transitions`,
    request("POST", { toStatus: "active", reason: "Year still planning" }, admin.token),
    409
  );
  await send("POST", `${periods}/${academicYear.data.id}/transitions`, { toStatus: "published", reason: "Year approved" }, admin.token);
  const active = await send("POST", `${s1}/transitions`, { toStatus: "active", reason: "Semester started" }, admin.token);
  results.semesterStatus = active.data.lifecycleStatus;

  results.activeDateChangeRejected = await expectStatus(s1, request("PATCH", { endsOn: `${year}-07-15`, reason: "Extend" }, admin.token), 409);
  const extended = await send("PATCH", s1, {
    windows: {
      ...active.data.windows,
      registration: [`${year}-01-15`, `${year}-02-20`]
    },
    reason: "Late registration extension approved"
  }, admin.token);
  results.registrationWindow = extended.data.windows.registration;

  const onDate = await send("GET", `${periods}?asOf=${year}-02-17`);
  results.openWindowsOnFeb17 = onDate.data.find((period) => period.id === semester1.data.id).openWindows.sort();

  results.shrinkYearAroundChildrenRejected = await expectStatus(
    `${periods}/${academicYear.data.id}`,
    request("PATCH", { endsOn: `${year}-10-31`, reason: "Shrink" }, admin.token),
    409
  );
  results.closeYearWithOpenTermsRejected = await expectStatus(
    `${periods}/${academicYear.data.id}/transitions`,
    request("POST", { toStatus: "closed", reason: "Too soon" }, admin.token),
    409
  );

  await send("POST", `${s1}/transitions`, { toStatus: "closed", reason: "Semester ended" }, admin.token);
  results.closedPeriodEditRejected = await expectStatus(s1, request("PATCH", { name: "Renamed", reason: "Late" }, admin.token), 409);
  const archived = await send("POST", `${s1}/transitions`, { toStatus: "archived", reason: "Archive cut-off" }, admin.token);
  results.finalStatus = archived.data.lifecycleStatus;

  const audit = await send("GET", `/api/audit/events?subjectType=AcademicPeriod&subjectId=${semester1.data.id}`, null, admin.token);
  results.auditActions = audit.data.map((event) => event.action).sort();

  const failures = [
    results.semesterStatus !== "active" && "semester did not activate",
    results.registrationWindow[1] !== `${year}-02-20` && "registration window not extended",
    results.openWindowsOnFeb17.join(",") !== "registration,teaching" && "unexpected open windows",
    results.finalStatus !== "archived" && "semester not archived",
    results.auditActions.length < 6 && "missing audit events"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function login(credentials) {
  const response = await send("POST", "/api/identity/sessions", credentials);
  return response.data;
}

async function send(method, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, request(method, body, token));
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function request(method, body, token) {
  const options = {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json"
    }
  };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }
  return options;
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`Expected ${expectedStatus} for ${options.method} ${path}, received ${response.status}: ${body}`);
  }
  return response.status;
}
