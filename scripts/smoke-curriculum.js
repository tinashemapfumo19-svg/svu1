const baseUrl = process.env.SVU_BASE_URL || "http://127.0.0.1:4173";

const adminCredentials = {
  email: "admin@southvalley.test",
  password: "Phase1-Admin-Password-2026!"
};

const registrarCredentials = {
  email: "registrar@southvalley.test",
  password: "Kariba-Senate-Approvals-2026!"
};

const studentCredentials = {
  email: "tinashe@example.edu",
  password: "Phase1-Student-Password-2026!"
};

// Course codes are letters + digits, so derive a per-run letter prefix.
const prefix = `S${toLetters(Math.floor(Date.now() / 1000) % 17_576)}`;
const results = { prefix };

try {
  const admin = await login(adminCredentials);
  // Maker-checker: the admin drafts, the registrar publishes.
  const registrar = await login(registrarCredentials);
  const student = await login(studentCredentials);
  const courses = "/api/master-data/courses";

  const seeded = await send("GET", `/api/master-data/programme-versions/pv_bsc_is_2027/curriculum`);
  results.seededCurriculumCourses = seeded.data.entries.map((entry) => entry.code);
  results.seededCurriculumProblems = seeded.data.problems.length;

  results.studentCreateDenied = await expectStatus(courses, request("POST", course("101", "Denied"), student.token), 403);
  results.badCodeRejected = await expectStatus(courses, request("POST", { ...course("101", "Bad"), code: "intro" }, admin.token), 400);
  results.badCreditsRejected = await expectStatus(courses, request("POST", { ...course("101", "Bad"), credits: 7.3 }, admin.token), 400);

  const c101 = (await send("POST", courses, course("101", "Smoke Foundations"), admin.token)).data;
  const c102 = (await send("POST", courses, course("102", "Smoke Intermediate"), admin.token)).data;
  const c201 = (await send("POST", courses, { ...course("201", "Smoke Advanced"), level: 2 }, admin.token)).data;
  await send("PUT", `${courses}/${c102.id}/prerequisites`, { prerequisiteCourseIds: [c101.id], reason: "Builds on foundations" }, admin.token);
  await send("PUT", `${courses}/${c201.id}/prerequisites`, { prerequisiteCourseIds: [c102.id], reason: "Builds on intermediate" }, admin.token);
  results.cycleRejected = await expectStatus(
    `${courses}/${c101.id}/prerequisites`,
    request("PUT", { prerequisiteCourseIds: [c201.id], reason: "Would loop" }, admin.token),
    409
  );

  const programme = await send("POST", "/api/master-data/programmes", {
    code: `${prefix}-PRG-${Date.now()}`,
    name: "BSc Curriculum Smoke",
    departmentId: "dept_computing"
  }, admin.token);
  const version = await send("POST", `/api/master-data/programmes/${programme.data.id}/versions`, {
    versionLabel: "2027",
    effectiveFrom: "2027-01-01"
  }, admin.token);
  const curriculum = `/api/master-data/programme-versions/${version.data.id}/curriculum`;

  // Wrong order first: the intermediate course is scheduled before its prerequisite.
  await send("POST", curriculum, { courseId: c102.id, yearOfStudy: 1, term: "S1" }, admin.token);
  await send("POST", curriculum, { courseId: c101.id, yearOfStudy: 1, term: "S2" }, admin.token);
  const wrongOrder = await send("GET", curriculum);
  results.orderingProblemsDetected = wrongOrder.data.problems.map((problem) => problem.problem);
  results.publishWithProblemsRejected = await expectStatus(
    `/api/master-data/programme-versions/${version.data.id}/publish`,
    request("POST", { reason: "Should be blocked" }, registrar.token),
    409
  );
  results.duplicateEntryRejected = await expectStatus(curriculum, request("POST", { courseId: c101.id, yearOfStudy: 1, term: "S1" }, admin.token), 409);

  await send("DELETE", `${curriculum}/${c101.id}`, null, admin.token);
  await send("DELETE", `${curriculum}/${c102.id}`, null, admin.token);
  await send("POST", curriculum, { courseId: c101.id, yearOfStudy: 1, term: "S1" }, admin.token);
  await send("POST", curriculum, { courseId: c102.id, yearOfStudy: 1, term: "S2" }, admin.token);
  await send("POST", curriculum, { courseId: c201.id, yearOfStudy: 2, term: "S1", requirementType: "elective" }, admin.token);
  const fixed = await send("GET", curriculum);
  results.creditsByYear = fixed.data.creditsByYear;
  results.problemsAfterFix = fixed.data.problems.length;

  results.selfPublishVersionDenied = await expectStatus(
    `/api/master-data/programme-versions/${version.data.id}/publish`,
    request("POST", { reason: "Approving my own draft" }, admin.token),
    403
  );
  const published = await send("POST", `/api/master-data/programme-versions/${version.data.id}/publish`, { reason: "Senate approved curriculum" }, registrar.token);
  results.publishedBy = published.data.publishedBy;
  results.publishedStatus = published.data.status;

  results.editPublishedCurriculumRejected = await expectStatus(
    curriculum,
    request("POST", { courseId: "course_comp101", yearOfStudy: 1, term: "S1" }, admin.token),
    409
  );
  results.creditChangeInPublishedRejected = await expectStatus(
    `${courses}/${c101.id}`,
    request("PATCH", { credits: 20, reason: "Rebalance" }, admin.token),
    409
  );
  const retitled = await send("PATCH", `${courses}/${c101.id}`, { title: "Smoke Foundations of Computing", reason: "Clearer title" }, admin.token);
  results.retitled = retitled.data.title;
  results.retireRequiredCourseRejected = await expectStatus(
    `${courses}/${c101.id}/retire`,
    request("POST", { reason: "Should be blocked by dependants" }, admin.token),
    409
  );
  const retired = await send("POST", `${courses}/${c201.id}/retire`, { reason: "Replaced by new advanced course" }, admin.token);
  results.retiredStatus = retired.data.status;

  const failures = [
    results.seededCurriculumProblems !== 0 && "seeded BSc IS curriculum should be valid",
    !results.orderingProblemsDetected.some((problem) => problem.includes("not scheduled before")) && "ordering problem not detected",
    results.problemsAfterFix !== 0 && "fixed curriculum still has problems",
    results.creditsByYear["1"] !== 30 && "year 1 should total 30 credits",
    results.publishedStatus !== "published" && "version did not publish"
  ].filter(Boolean);
  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\n${JSON.stringify(results, null, 2)}`);
  }

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function course(number, title) {
  return { code: `${prefix}${number}`, title, credits: 15, level: 1, departmentId: "dept_computing", reason: "Curriculum smoke test" };
}

function toLetters(value) {
  let text = "";
  let remaining = value;
  for (let index = 0; index < 3; index += 1) {
    text = String.fromCharCode(65 + (remaining % 26)) + text;
    remaining = Math.floor(remaining / 26);
  }
  return text;
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
