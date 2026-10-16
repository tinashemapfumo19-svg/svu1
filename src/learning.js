(function () {
  // "My learning" for students (courses, exam timetable, published results) and "My teaching" for lecturers.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const state = { token: null, data: null, classLists: {}, notice: null, busy: false };
  let generation = 0;

  async function get(path) {
    const session = window.svuSession.get();
    const response = await fetch(path, { headers: { Accept: "application/json", Authorization: `Bearer ${session?.token}` } });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) window.svuSession.clear();
    if (!response.ok) { const error = new Error(payload.error?.message || "Request failed."); error.status = response.status; throw error; }
    return payload.data;
  }
  const optional = (promise) => promise.catch(() => null);

  async function load() {
    const data = { student: null, programme: null, registrations: [], withdrawals: null, exams: null, results: [], teaching: null };
    const tasks = [];
    if (window.svuSession.can("registry.self")) tasks.push(optional(get("/api/registry/me")).then(async (student) => {
      data.student = student; data.programme = student?.programmes?.[0] || null;
      if (!data.programme) return;
      const base = `/api/registry/me/programmes/${encodeURIComponent(data.programme.id)}`;
      const [registrations, withdrawals, exams, results] = await Promise.all([optional(get(`${base}/registrations`)), optional(get(`${base}/withdrawals`)), optional(get(`${base}/exams`)), optional(get(`${base}/results`))]);
      Object.assign(data, { registrations: registrations || [], withdrawals, exams, results: results || [] });
    }));
    if (window.svuSession.can("teaching.self")) tasks.push(optional(get("/api/teaching/me")).then((value) => { data.teaching = value; }));
    await Promise.all(tasks);
    return data;
  }

  function studentView(data) {
    if (window.svuSession.can('teaching.self')) return '';
    if (!data.programme) return `<article class="card"><h2>No student programme yet</h2><p>Your courses appear here once you are enrolled. Track your application in <a href="#apply">your portal</a>.</p></article>`;
    const withdrawn = new Set((data.withdrawals?.requests || []).filter((row) => row.status === "approved").map((row) => `${row.periodId}|${row.courseId}`));
    const periods = data.registrations.filter((row) => row.registration?.status === "confirmed").reverse();
    const open = data.registrations.find((row) => row.period?.status === "open" && row.registration?.status !== "confirmed");
    return `${open ? `<div class="notice"><strong>Registration is open for ${esc(open.period.name)}.</strong> <a href="#apply">Choose your courses in the portal</a>.</div>` : ""}
      <section class="card" data-learning-courses><div class="section-header"><div><h2>My courses</h2><p>${esc(data.programme.programmeName)} · ${esc(data.student.studentNumber)}</p></div><a class="button button-soft" href="#apply">Registration</a></div>
        ${periods.map((row) => `<section class="learning-period"><h3>${esc(row.period.name)}</h3><div class="course-list">${row.registration.confirmation.courses.map((course) => {
          const gone = withdrawn.has(`${row.period.id}|${course.courseId}`);
          return `<article class="course-card ${gone ? "is-withdrawn" : ""}" data-learning-course="${esc(course.courseId)}"><p class="eyebrow">${esc(course.code)}</p><h3>${esc(course.title)}</h3><p class="meta">${course.credits} credits${gone ? " · withdrawn" : ""}</p></article>`;
        }).join("")}</div></section>`).join("") || `<p class="meta">You have no confirmed course registration yet.</p>`}
      </section>
      ${data.exams?.length ? `<section class="card">${window.registryExamsUI.studentView(data.exams)}</section>` : ""}
      <section class="card" data-learning-results><div class="section-header"><div><h2>Published results</h2><p>${data.results.length ? "Most recent first" : "No results have been published yet"}</p></div><a class="button button-soft" href="#apply">Transcripts</a></div>
        ${data.results.slice().reverse().map((batch) => `<section class="result-period"><header class="section-header"><h3>${esc(batch.sourceRef)}</h3><span class="meta">${esc(date(batch.publishedAt))}</span></header>
          <p>GPA ${batch.gpa === null ? "not calculated" : esc(batch.gpa)}${batch.classification ? ` · ${esc(batch.classification)}` : ""}</p>
          <div class="result-table-wrap"><table class="result-table"><thead><tr><th>Course</th><th>Mark</th><th>Grade</th></tr></thead><tbody>${batch.results.map((row) => `<tr><td>${esc(row.code)} ${esc(row.title)}</td><td>${esc(row.mark ?? "")}</td><td>${esc(row.grade ?? "")}</td></tr>`).join("")}</tbody></table></div></section>`).join("")}
      </section>`;
  }

  function teachingView(teaching) {
    if (!teaching) return "";
    const ui = window.svuUI;
    return `<section class="ui-panels" data-learning-teaching><div class="ui-panel">${ui.head("Allocations", { desc: `${teaching.allocations.length} active allocation${teaching.allocations.length === 1 ? "" : "s"}`, actions: window.svuSession.canAny(["assessment.marks", "teaching.view"]) ? `<a class="button button-soft" href="#registry/teaching">Marks and allocation</a>` : "" })}</div>
      ${teaching.allocations.map((row) => {
        const list = state.classLists[row.id];
        return `<article class="allocation-card ui-panel" data-learning-allocation="${row.id}"><div class="section-header staff-record-hero"><div class="ui-row-lead">${ui.ico("book", "blue")}<div><p class="eyebrow">${esc(row.code)} · ${esc(ui.sentence(row.role))}</p><h3 class="ui-section-title">${esc(row.title)}</h3>
          <p class="meta">From ${esc(row.effectiveFrom)}${row.effectiveTo ? ` to ${esc(row.effectiveTo)}` : ""} · ${esc(row.workloadUnits)} workload units</p></div></div>
          <button class="button button-secondary" type="button" data-learning-class-list="${row.id}">${list ? "Refresh class list" : "Show class list"}</button></div>
          ${list ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student number</th><th>Name</th><th>Registration</th></tr></thead><tbody>${list.students.map((student) => `<tr><td>${esc(student.studentNumber)}</td><td>${esc(student.legalName)}</td><td>${esc(student.registrationReference)}</td></tr>`).join("") || `<tr><td colspan="3">No students enrolled.</td></tr>`}</tbody></table></div>` : ""}
          ${['lead','co_lecturer','tutor'].includes(row.role) ? window.courseWorkspaceUI.accordion(row,row.periodId,'Course content',state.expanded.has(`${row.periodId}:${row.courseId}`)) : ''}
        </article>`;
      }).join("") || ui.emptyState({ glyph: "book", title: "No active teaching allocations", text: "Courses you are allocated to teach appear here with their class lists and content." })}</section>`;
  }

  function paint(app) {
    if (!location.hash.startsWith("#learning")) return;
    const data = state.data;
    state.expanded = new Set(Array.from(app.querySelectorAll('[data-course-expand][open] [data-course-workspace]')).map(node => `${node.dataset.period}:${node.dataset.course}`));
    const title = window.svuSession.can("registry.self") && !window.svuSession.can("teaching.self") ? "My learning" : "My teaching";
    app.innerHTML = `<section class="learning-page registry-workspace"><header class="section-header staff-page-head"><div><p class="eyebrow">${title === "My teaching" ? "Teaching" : "Study"}</p><h1 class="page-title">${title}</h1><p class="ui-meta ui-page-description">${title === "My teaching" ? "Your allocated courses, class lists and course content." : "Your courses, examinations and published results."}</p></div></header>
      ${state.notice ? `<div class="notice notice-error" role="status">${esc(state.notice)}</div>` : ""}
      <fieldset class="review-controls learning-stack" ${state.busy ? "disabled" : ""}>
      ${!data ? `<p class="meta">Loading…</p>` : `${window.svuSession.can("registry.self") ? studentView(data) : ""}${teachingView(data.teaching)}
        ${!window.svuSession.can("registry.self") && !data.teaching ? window.svuUI.emptyState({ glyph: "book", title: "Nothing to show yet", text: "Your courses or teaching allocations will appear here.", act: `<a class="button button-primary" href="#home">Back to home</a>` }) : ""}`}
      </fieldset></section>`;
    if (data?.exams?.length) window.registryExamsUI.bindStudent(app, data.exams);
    window.courseWorkspaceUI.bind(app);
    app.querySelectorAll("[data-learning-class-list]").forEach((button) => button.addEventListener("click", async () => {
      if (state.busy) return;
      state.busy = true; state.notice = null; paint(app);
      try { state.classLists[button.dataset.learningClassList] = await get(`/api/teaching/allocations/${encodeURIComponent(button.dataset.learningClassList)}/class-list`); }
      catch (error) { state.notice = error.message; }
      finally { state.busy = false; paint(app); }
    }));
  }

  async function render(app) {
    const current = ++generation;
    const session = window.svuSession.get();
    if (!session) { location.replace("#signin?next=learning"); return; }
    if (state.token !== session.token) Object.assign(state, { token: session.token, data: null, classLists: {}, notice: null });
    paint(app);
    await window.svuSession.me();
    if (current !== generation || window.svuSession.get()?.token !== session.token) return;
    const data = await load();
    if (current === generation && window.svuSession.get()?.token === session.token) {state.data = data;paint(app);}
  }
  window.learningUI = { render };
})();
