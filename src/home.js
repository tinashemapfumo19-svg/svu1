(function () {
  // Home: a public landing page, or a dashboard built from the signed-in person's own records and work areas.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const money = (currency, minor) => `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  const human = (value) => String(value ?? "").replaceAll("_", " ");
  let view = { token: undefined, data: null, loading: false, error: null };
  let catalogue = null;
  let areaFilter = 'all';

  async function get(path, token) {
    const response = await fetch(path, { headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) { const error = new Error(`Request failed (${response.status})`); error.status = response.status; throw error; }
    return (await response.json()).data;
  }
  const optional = (promise) => promise.catch(() => null);

  async function loadCatalogue() {
    if (catalogue) return catalogue;
    catalogue = await optional(get("/api/admissions/catalogue")) || [];
    return catalogue;
  }

  async function loadSignedIn(token) {
    const session = window.svuSession;
    const data = { errors: [], messages: null, applications: null, student: null, programme: null, registrations: null, account: null, queue: null, teaching: null, exams: null, results: null };
    const read = (path, label) => get(path, token).catch((error) => { data.errors.push({ label, status: error.status }); return null; });
    const tasks = [read("/api/notifications/me?limit=3", "Messages").then((value) => { data.messages = value; })];
    if (session.can("admissions.apply")) tasks.push(read("/api/admissions/applications", "Applications").then((value) => { data.applications = value; }));
    if (session.can("registry.self")) tasks.push(read("/api/registry/me", "Student record").then(async (student) => {
      data.student = student;
      const programme = student?.programmes?.[0];
      if (!programme) return;
      data.programme = programme;
      const base = `/api/registry/me/programmes/${encodeURIComponent(programme.id)}`;
      [data.registrations, data.account, data.exams, data.results] = await Promise.all([read(`${base}/registrations`, "Registration"), read(`${base}/account`, "Account statement"), read(`${base}/exams`, "Examination timetable"), read(`${base}/results`, "Published results")]);
    }));
    if (session.canAny(["admissions.review", "admissions.decide", "admissions.completeness"])) tasks.push(read("/api/admissions/review/applications?limit=50", "Admissions queue").then((value) => { data.queue = value; }));
    if (session.can("teaching.self")) tasks.push(read("/api/teaching/me", "Teaching allocations").then((value) => { data.teaching = value; }));
    if (window.svuShell.isStaff()) tasks.push(read("/api/me/work-summary", "Work summary").then((value) => { data.work = value; }));
    if (session.can("admissions.apply") && !session.can("registry.self")) tasks.push(read("/api/calendar/me", "Calendar").then((value) => { data.calendar = value; }));
    await Promise.all(tasks);
    return data;
  }

  function publicHome(app) {
    const intakes = (catalogue || []).filter((entry) => entry.applicationsOpen);
    const ui = window.svuUI;
    app.innerHTML = `<div class="home-ui ui-home public-home"><section class="dashboard-head landing-hero">
        <div>
          <p class="eyebrow">South Valley University</p>
          <h1 class="page-title">Apply, study and manage your university records in one place.</h1>
          <p class="ui-meta">Applicants, students and staff use one account. Apply online, register for courses, see your results and fees, and verify official documents.</p>
          <div class="ui-actions"><a class="button button-primary" href="#apply">Apply now</a><a class="button button-secondary" href="#signin">Sign in</a></div>
        </div>
      </section>
      <div class="ui-main-rail"><div class="ui-main">
      ${ui.panel("Open for applications", `<div class="ui-course-grid">${intakes.map((entry, index) => `<article class="catalogue-card ui-course ${["", "tint-green", "tint-lavender"][index % 3]}"><div class="ui-course-top"><span class="ui-course-code">${esc(entry.programmeCode)}</span>${ui.badge("Open", "green")}</div><h3 class="ui-card-title">${esc(entry.programmeName)}</h3>
          <p class="ui-meta">${esc(entry.label)} · starts ${esc(date(entry.startsOn))}</p><p class="ui-meta">${esc(entry.department)} · ${esc(entry.faculty)}</p>
          <span class="ui-course-foot"><a class="ui-link" href="#apply">Apply ${ui.icons.chevron}</a></span></article>`).join("")}</div>${intakes.length ? "" : ui.emptyState({ glyph: "cap", title: "No intakes are open right now", text: "Check back soon, or sign in to continue an existing application.", compact: true })}`,
        { desc: intakes.length ? `${intakes.length} intake${intakes.length === 1 ? "" : "s"} accepting applications` : "No intakes are open right now", actions: `<a class="button button-secondary" href="#apply">Start an application</a>` })}
      </div><aside class="ui-rail">
        <form class="ui-panel verify-card" data-home-verify>
          <h2 class="ui-section-title">Verify a document</h2>
          <p class="meta">Enter the verification code printed on a transcript or certificate.</p>
          <label class="field"><span>Verification code</span><input class="input" name="code" required autocomplete="off"></label>
          <div><button class="button button-primary" type="submit">Verify</button></div>
        </form>
        ${ui.panel("Already have an account?", `<div class="ui-rows">${[["#signin", "Sign in", "account"], ["#apply", "Continue an application", "apply"], ["#resources", "Browse resources", "resources"]].map(([href, title, glyph]) => ui.row({ href, glyph, tone: "blue", title })).join("")}</div>`)}
      </aside></div></div>`;
    app.querySelector("[data-home-verify]").addEventListener("submit", (event) => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get("code").trim();
      if (code) location.hash = `#verify/${encodeURIComponent(code)}`;
    });
  }

  function messagesCard(messages, compact = false) {
    if (!messages) return "";
    const ui = window.svuUI;
    return ui.panel("Recent updates", messages.items.length ? `<div class="ui-rows">${messages.items.map((item) => ui.row({ href: ui.inAppLink(item.link), glyph: "inbox", tone: "blue", title: item.subject, meta: esc(date(item.createdAt)), trail: item.readAt ? "" : '<span class="ui-dot is-unread" aria-label="Unread"></span>' })).join("")}</div>`
      : compact ? '<p class="ui-meta home-updates-empty">No new updates.</p>' : ui.emptyState({ glyph: "inbox", text: "No messages yet. University updates for your account appear here.", compact: true }),
      { desc: messages.unread ? `${messages.unread} unread` : compact ? '' : "You're up to date", href: "#messages", label: "Open inbox", attrs: "data-home-messages" });
  }

  function studentCards(data) {
    const cards = [];
    const { programme, student } = data;
    if (programme) {
      const confirmed = (data.registrations || []).filter((row) => row.registration?.status === "confirmed");
      const current = confirmed[confirmed.length - 1] || null;
      const open = (data.registrations || []).find((row) => row.period?.status === "open" && row.registration?.status !== "confirmed");
      const latest = data.results?.[data.results.length - 1];
      const upcoming = (data.exams || []).flatMap((row) => row.sittings || []).filter((row) => Date.parse(row.startsAt) > Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
      cards.push(`<section class="home-programme" data-home-programme><div><p class="home-context">${esc(student.studentNumber)}</p><h2>${esc(programme.programmeName)}</h2>
          <p>${programme.yearOfStudy ? `Year ${esc(programme.yearOfStudy)} · ` : ""}${esc(programme.intakeLabel)} · ${esc(human(programme.status))}</p></div><a class="home-link" href="#apply">Open portal</a></section>
        <section class="home-section home-attention"><h2>Your attention</h2>
        ${programme.status === "pending_onboarding" ? `<a class="home-action-row" href="#apply"><div><h3>Complete your student profile</h3><p>Registry needs your contact and next-of-kin details.</p></div><span class="home-link">Update profile</span></a>` : ""}
        ${open ? `<a class="home-action-row" href="#apply"><div><h3>Course registration</h3><p>${esc(open.period.name)}</p><p>${open.registration.selectedCourses?.length || 0} of ${open.offerings.length} courses selected · ${open.eligibility.credits} credits</p><span class="home-status ${open.eligibility.blockers.length ? "needs-attention" : "is-ready"}">${open.eligibility.blockers.length ? `${open.eligibility.blockers.length} requirements need attention` : "Ready to confirm"}</span></div><span class="home-link">Continue</span></a>` : programme.status !== "pending_onboarding" && data.registrations ? `<p class="meta">No registration actions outstanding.</p>` : ""}</section>
        <section class="home-section home-academics"><div class="section-header"><h2>Academics</h2><a class="home-link" href="#learning">My learning</a></div>
        <div class="home-course-summary"><h3>${current ? esc(current.period.name) : "Courses"}</h3>${current ? `<p>${current.registration.confirmation.courses.length} registered courses · ${current.registration.confirmation.credits} credits</p><ul class="plain-list">${current.registration.confirmation.courses.map((course) => `<li><strong>${esc(course.code)}</strong><span>${esc(course.title)}</span><span class="meta">${course.credits} credits</span></li>`).join("")}</ul>` : data.registrations ? `<p class="meta">Courses appear after registration is confirmed.</p>` : `<p class="meta">Course registration could not be loaded.</p>`}</div>
        ${latest ? `<a class="home-action-row" href="#learning"><div><h3>Results published</h3><p>${esc(date(latest.publishedAt))}${latest.gpa !== null ? ` · GPA ${esc(latest.gpa)}` : ""}${latest.classification ? ` · ${esc(latest.classification)}` : ""}</p></div><span class="home-link">View results</span></a>` : ""}
        ${upcoming ? `<a class="home-action-row" href="#learning"><div><h3>Next examination</h3><p>${esc(upcoming.code)} · ${esc(upcoming.paper)}</p><p>${esc(date(upcoming.startsAt))} · ${esc(new Date(upcoming.startsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))} · ${esc(upcoming.venue)}</p></div><span class="home-link">Timetable</span></a>` : ""}
        </section>`);
      const currencies = data.account?.currencies || [];
      cards.push(`<section class="home-section home-account" data-home-fees><div class="section-header"><h2>Account</h2><a class="home-link" href="#apply">View statement</a></div>
        ${currencies.map((row) => `<dl class="finance-summary"><div><dt>Balance</dt><dd>${esc(money(row.currency, row.balance))}</dd></div><div><dt>Due now</dt><dd>${esc(money(row.currency, row.due))}</dd></div></dl>`).join("")}
        ${data.account ? `<p class="home-status ${data.account.hold.held ? "needs-attention" : "is-ready"}">${data.account.hold.held ? "A financial hold needs attention" : currencies.some((row) => row.due > 0) ? "Payment is due" : "Nothing currently due"}</p>` : `<p class="meta">Your account statement could not be loaded.</p>`}</section>`);
    }
    return cards.join("");
  }

  // Applicant home: each application is a page band with its state and next step.
  function applicantCards(data) {
    const ui = window.svuUI;
    if (data.programme) return "";
    const cards = (data.applications || []).map((application) => ui.panel("", `<div class="staff-record-hero"><div><p class="ui-eyebrow">${esc(application.programmeCode)}</p><h2 class="ui-section-title">${esc(application.programmeName)}</h2>
        <p class="ui-meta">${esc(application.intakeLabel)} intake${application.referenceNumber ? ` · ${esc(application.referenceNumber)}` : ""}</p></div><span class="pill pill-blue">${esc(application.workflowState || "Draft")}</span></div>
        <div class="ui-actions"><a class="button button-primary" href="#apply">${(application.workflowState || "Draft") === "Draft" ? "Continue application" : "View application"}</a></div>`, { attrs: "data-home-application" }));
    if (data.applications && !data.applications.length) cards.push(ui.panel("Start your application", `<p class="ui-meta">Choose a programme and intake, then complete your profile and documents.</p><div class="ui-actions"><a class="button button-primary" href="#apply">Choose a programme</a></div>`));
    return cards.join("");
  }

  const areaGlyphs = { students: "users", support: "support", finance: "wallet", teaching: "book", exams: "calendar", documents: "file", reports: "chart", academic: "cap", admin: "settings", leave: "sun", assets: "box", fleet: "truck", cashbook: "bank", privacy: "lock" };
  const areaGroups = { students: 'student', support: 'student', finance: 'business', teaching: 'academic', exams: 'academic', documents: 'academic', reports: 'academic', academic: 'academic', admin: 'system', leave: 'business', assets: 'business', fleet: 'business', cashbook: 'business', privacy: 'system' };
  const areaTones = { admissions: 'lavender', students: 'blue', support: 'cyan', finance: 'green', teaching: 'blue', exams: 'lavender', documents: 'blue', reports: 'blue', academic: 'blue', admin: '', leave: 'amber', assets: '', fleet: 'cyan', cashbook: 'green', privacy: '' };
  function staffAreas(data, includeSummary = true) {
    const shell = window.svuShell, ui = window.svuUI;
    const tiles = [];
    if (window.svuSession.canAny(shell.admissionsPerms)) tiles.push({ id: 'admissions', group: 'student', href: "#admissions", label: "Admissions", text: "Application review, decisions, enquiries and guidance.", glyph: "admissions", count: data.queue?.length ? `${data.queue.length}${data.queue.length === 50 ? "+" : ""} in queue` : null });
    for (const area of shell.visibleAreas()) tiles.push({ id: area.id, group: areaGroups[area.id], href: `#registry/${area.id}`, label: area.label, text: area.text, glyph: areaGlyphs[area.id] || "workspace" });
    if (data.teaching) tiles.push({ id: 'my-teaching', group: 'academic', href: "#learning", label: "My teaching", text: "Your allocated courses and class lists.", glyph: "learning" });
    tiles.push({ id: 'resources', group: 'business', href: "#resources", label: "Resources", text: "Library catalogue, document repository and templates.", glyph: "resources" });
    const groups = [['all', 'All'], ['student', 'Student'], ['academic', 'Academic'], ['business', 'Business'], ['system', 'System']];
    const card = tile => `<article class="home-area-item"><a class="area-tile ui-course" href="${tile.href}" data-home-area="${esc(tile.label)}"><div class="ui-course-top">${ui.ico(tile.glyph, areaTones[tile.id] || 'blue', 'ui-icon-sm')}${tile.count ? ui.badge(tile.count, 'amber') : ''}</div><h3>${esc(tile.label)}</h3><p class="ui-meta">${esc(tile.text)}</p></a></article>`;
    const visible = tiles.filter(tile => areaFilter === 'all' || tile.group === areaFilter);
    const filters = `<div class="ui-segmented home-area-filters" role="group" aria-label="Work area filters">${groups.filter(([id]) => id === 'all' || tiles.some(tile => tile.group === id)).map(([id, label]) => `<button type="button" data-home-filter="${id}" aria-pressed="${areaFilter === id}">${label}</button>`).join('')}</div>`;
    return `${includeSummary ? weekTiles(data) : ''}${includeSummary && window.svuSession.can("appointments.host") ? '<section class="ui-panel" data-appointments-host></section>' : ''}${ui.panel('Your work areas', `${filters}<div class="ui-area-grid">${visible.map(card).join('')}</div>`, { cls: 'home-work-areas' })}`;
  }

  // "This week" tiles: the same counts as the Monday digest, each opening the matching list.
  function weekTiles(data) {
    const ui = window.svuUI, shell = window.svuShell, work = data.work;
    if (!work) return "";
    const tiles = [
      window.svuSession.can("teaching.self") ? ["Unmarked submissions", work.unmarked, "#learning", "book", "blue"] : null,
      window.svuSession.canAny(shell.admissionsPerms) && data.queue ? ["Applications waiting", data.queue.length, "#admissions", "admissions", "lavender"] : null,
      window.svuSession.canAny(['support.view', 'support.manage', 'support.escalate']) ? ["Support cases assigned", work.support, "#registry/support", "support", "cyan"] : null,
      shell.canUseSystem() ? ["Open tasks", work.tasks, "#foundation", "list", "green"] : null
    ].filter(Boolean);
    return tiles.length ? ui.panel("This week", `<div class="week-tiles">${tiles.map(([label, count, href, glyph, tone]) => `<a class="week-tile" href="${href}" data-week-tile>${ui.ico(glyph, tone, "ui-icon-sm")}<span class="week-tile-count">${count === 0 ? 'All clear' : esc(count ?? 'Unavailable')}</span><span class="ui-meta">${esc(label)}</span></a>`).join("")}</div>`, { cls: 'home-week-summary' }) : '';
  }

  function quickActions(staff) {
    const quick = [["#verify", "Verify a document", "verify"]];
    if (window.svuSession.can('registry.view')) quick.unshift(['#registry/students', 'Find a student', 'search']);
    if (window.svuSession.canAny(window.svuShell.admissionsPerms)) quick.push(['#admissions', 'Review applications', 'admissions']);
    if (window.svuSession.canAny(['support.view', 'support.manage', 'support.escalate'])) quick.push(['#registry/support', 'Open support queue', 'support']);
    if (!staff && window.svuSession.can('admissions.apply')) quick.unshift(["#apply", "Continue application", "apply"]);
    return quick;
  }

  function accountRail(me, data, staff) {
    const ui = window.svuUI;
    const roles = (me?.roles || []).map((role) => ui.sentence(role.code));
    const account = ui.panel("Your account", `${ui.facts([["Name", me?.person?.legalName || ""], ["Email", me?.account?.email || ""], roles.length ? ["Roles", roles.join(", ")] : null, ["Two-step verification", { html: me?.mfa?.enrolled ? ui.badge("On", "green") : ui.badge("Off", "amber") }]])}<a class="ui-link" href="#settings">Manage account ${ui.icons.chevron}</a>`);
    const quick = quickActions(staff);
    const actions = ui.panel("Quick actions", `<div class="ui-rows">${quick.map(([href, title, glyph]) => ui.row({ href, glyph, tone: "blue", title })).join("")}</div>`);
    const calendar = window.svuSession.canAny(["teaching.self", "admissions.apply"]) ? `<section class="ui-panel" data-calendar-mini></section>` : "";
    return `<aside class="ui-rail" aria-label="Your account">${calendar}${account}${actions}</aside>`;
  }

  function attentionItems(me, data, staff, includeQueue = true) {
    const ui = window.svuUI, items = [];
    if (me && !me.mfa?.enrolled && staff) items.push(ui.attention({ tone: "warning", glyph: "shield", title: "Protect your staff account", text: "Turn on two-step verification in Settings.", act: `<a class="button button-primary" href="#settings">Turn it on</a>`, attrs: "data-home-mfa" }));
    for (const event of (data?.calendar?.events || []).filter((row) => row.type === "offer")) items.push(ui.attention({ tone: "warning", glyph: "clock", eyebrow: "Your offer", title: `Your offer expires ${window.svuCalendar.countdown(event.start)}`, text: `${esc(event.title.replace(/^Offer expires: /, ""))} · ${esc(event.subtitle)}. Accept or decline before it expires.`, act: `<div class="ui-actions"><a class="button button-primary" href="#apply">Respond to offer</a></div>` }));
    if (includeQueue && data?.queue?.length) items.push(ui.attention({ tone: "info", glyph: "admissions", eyebrow: "Waiting for review", title: `${data.queue.length}${data.queue.length === 50 ? "+" : ""} ${data.queue.length === 1 ? "application is" : "applications are"} in the admissions queue`, text: "Applications in your review scope.", act: `<a class="button ${items.length ? "button-secondary" : "button-primary"}" href="#admissions">Review applications</a>` }));
    return items.length ? `<div class="ui-attention-list" aria-label="Your attention">${items.join("")}</div>` : "";
  }

  function dashboard(app, data) {
    const me = window.svuSession.cached();
    const shell = window.svuShell, ui = window.svuUI;
    const staff = shell.isStaff();
    const systemAdmin = staff && me?.roles?.some(role => role.code === 'system_administrator');
    const student = !staff && shell.isStudent();
    const main = data ? (systemAdmin ? `${attentionItems(me, data, true, false)}${weekTiles(data)}${staffAreas(data, false)}${window.svuSession.can('appointments.host') ? '<section class="ui-panel" data-appointments-host></section>' : ''}${messagesCard(data.messages, true)}` : student ? `${studentCards(data)}${messagesCard(data.messages)}` : `${attentionItems(me, data, staff)}${staff ? staffAreas(data) : applicantCards(data)}${messagesCard(data.messages)}`)
      : `<div class="home-skeleton ui-panel" data-home-loading role="status"><span class="meta">Loading your dashboard...</span><div></div><div></div></div>`;
    app.innerHTML = `<div class="home-ui ui-home"><section class="dashboard-head"><div><p class="eyebrow home-context">${esc(staff ? "Staff home" : student ? "Student home" : "Applicant home")}</p>
        <h1 class="page-title"><span data-home-greeting>${ui.greeting()}</span>, ${esc(shell.displayName(me))}.</h1>${staff && me?.roles?.length ? `<p class="ui-meta">${esc(me.roles.length)} ${me.roles.length === 1 ? "role" : "roles"} · ${esc(shell.visibleAreas().length)} work ${shell.visibleAreas().length === 1 ? "area" : "areas"}</p>` : ""}</div>
        <time class="student-date-widget" datetime="${new Date().toISOString().slice(0, 10)}">${ui.ico("calendar", "blue", "ui-icon-sm")}<span>${esc(ui.today())}</span></time></section>
      ${view.error ? ui.alert("error", "Your dashboard could not be loaded", view.error) : ""}
      ${data?.errors?.length ? `<section class="home-load-errors ui-alert ui-alert-warning" role="status"><div><h2>Some information is unavailable</h2><ul>${data.errors.map((error) => `<li>${esc(error.label)}: ${error.status === 403 ? 'access is restricted' : error.status === 404 ? 'no linked record was found' : 'could not be loaded'}.</li>`).join('')}</ul><button class="button button-secondary" type="button" data-home-retry>Try again</button></div></section>` : ""}
      <section class="home-content" aria-busy="${!data}">${systemAdmin ? `<nav class="home-quick-actions" aria-label="Quick actions">${quickActions(true).map(([href, title, glyph]) => `<a class="button button-secondary" href="${href}">${ui.glyph(glyph)}<span>${esc(title)}</span></a>`).join('')}</nav>${main}` : `<div class="ui-main-rail"><div class="ui-main">${main}</div>${accountRail(me, data, staff)}</div>`}</section></div>`;
    if (systemAdmin) app.querySelector('.home-ui').classList.add('system-admin-home');
    app.querySelector('[data-home-retry]')?.addEventListener('click', () => { refresh(); render(app); });
    bindAreas(app, data);
  }

  function bindAreas(app, data) {
    const update = () => {
      const template = document.createElement('template');
      template.innerHTML = staffAreas(data);
      app.querySelector('.home-work-areas')?.replaceWith(template.content.querySelector('.home-work-areas'));
      bindAreas(app, data);
    };
    app.querySelectorAll('[data-home-filter]').forEach(button => button.addEventListener('click', () => { areaFilter = button.dataset.homeFilter; update(); app.querySelector(`[data-home-filter="${areaFilter}"]`)?.focus(); }));
  }

  async function render(app) {
    const session = window.svuSession.get();
    if (!session) {
      view = { token: undefined, data: null, loading: false, error: null };
      publicHome(app);
      if (!catalogue) { await loadCatalogue(); if (location.hash === "" || location.hash.startsWith("#home")) publicHome(app); }
      return;
    }
    const me = await window.svuSession.me();
    if (!location.hash.startsWith("#home") && location.hash !== "") return;
    if (!me) {
      if (!window.svuSession.get()) publicHome(app);
      else {
        app.innerHTML = `<section class="home-load-errors" role="alert"><h1>Unable to load your account</h1><p>Please try again to load your dashboard.</p><button class="button button-secondary" data-home-retry>Try again</button></section>`;
        app.querySelector('[data-home-retry]').addEventListener('click', () => render(app));
      }
      return;
    }
    if (view.token === session.token && view.data) { dashboard(app, view.data); return; }
    dashboard(app, null);
    if (view.loading === session.token) return;
    view.loading = session.token;
    try {
      const data = await loadSignedIn(session.token);
      if (window.svuSession.get()?.token !== session.token) return;
      view = { token: session.token, data, loading: false, error: null };
    } catch (error) { view = { token: session.token, data: {}, loading: false, error: error.message }; }
    if (location.hash.startsWith("#home") || location.hash === "") dashboard(app, view.data);
  }
  // Fresh data each time the person comes back to Home.
  const refresh = () => { view = { token: undefined, data: null, loading: false, error: null }; };
  const updateClock = () => {
    const greeting = document.querySelector('[data-home-greeting]');
    if (!greeting) return;
    greeting.textContent = window.svuUI.greeting();
    const widget = document.querySelector('.home-ui .student-date-widget');
    if (widget) {
      widget.dateTime = new Date().toISOString().slice(0, 10);
      widget.querySelector('span:last-child').textContent = window.svuUI.today();
    }
  };
  setInterval(updateClock, 60000);
  window.addEventListener('focus', updateClock);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
  window.svuSession.onChange(() => { refresh(); areaFilter = 'all'; });
  window.homeUI = { render, refresh };
})();
