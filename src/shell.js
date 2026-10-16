(function () {
  // App chrome: role-aware navigation, profile menu, staff search and the shared sign-in page.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const glyphs = window.svuIcons || {
    home: svg("M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3Z"),
    apply: svg("M6 3h12v18H6zM9 8h6M9 12h4M9 16h6"),
    admissions: svg("M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"),
    workspace: svg("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"),
    learning: svg("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"),
    resources: svg("M4 5h6l2 2h8v12H4ZM8 12h8M8 15h5"),
    verify: svg("M12 3 4 7v5c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7ZM9 12l2 2 4-4"),
    account: svg("M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"),
    system: svg("M12 3 4 7v5c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7Z"),
    bell: svg("M15 17H9m9-6a6 6 0 1 0-12 0c0 3-1 4.5-2 6h16c-1-1.5-2-3-2-6Zm-4 9a2 2 0 0 1-4 0"),
    search: svg("m21 21-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z")
  };

  // Staff work areas. Each opens a screen of the staff workspace and is shown only to people who can use it.
  const areas = [
    { id: "students", label: "Students", text: "Search student records, onboarding, registration, results and lifecycle.", perms: ["registry.view"] },
    { id: "support", label: "Support", text: "Student support cases, escalation and service reporting.", perms: ["support.view", "support.manage", "support.escalate"] },
    { id: "finance", label: "Finance", text: "Payment imports, sponsors, control totals and finance reports.", perms: ["finance.*"] },
    { id: "teaching", label: "Teaching", text: "Teaching allocation, assessment marks and LMS transfer.", perms: ["teaching.*", "assessment.*", "lms.*"] },
    { id: "exams", label: "Examinations", text: "Timetables, papers, special arrangements and examination reports.", perms: ["exams.*"] },
    { id: "documents", label: "Documents", text: "Official document issuance and verification.", perms: ["registry.transcript.issue", "documents.templates.manage", "documents.templates.approve"] },
    { id: "reports", label: "Reports", text: "Enrolment, outcomes, continuation, editions and scheduled reports.", perms: ["reports.schedule", "registry.view", "results.view", "academic.view", "audit.view"] },
    { id: "academic", label: "Academic setup", text: "Faculties, programmes, curricula, academic periods, intakes, grading and GPA rules.", perms: ["master_data.publish"] },
    { id: "admin", label: "People & systems", text: "Staff records, appointments and integration governance.", perms: ["staff.view", "staff.manage", "integrations.view", "integrations.manage"] },
    { id: "leave", label: "Staff leave", text: "Leave requests, recommendations, approvals and balances.", perms: ["leave.self", "leave.manage"] },
    { id: "assets", label: "Assets", text: "Asset register, allocations, stock checks and disposals.", perms: ["assets.view", "assets.manage", "assets.approve"] },
    { id: "fleet", label: "Fleet", text: "Vehicles, drivers, trips, fuel, servicing and incidents.", perms: ["fleet.view"] },
    { id: "cashbook", label: "Cashbook", text: "Cashbook movements, reconciliation and period closure.", perms: ["cashbook.view"] },
    { id: "privacy", label: "Restricted records", text: "Religion, disability and medical records under purpose-bound consent.", perms: ["restricted.policy.manage", "restricted.policy.approve", "restricted.religion.read", "restricted.disability.read", "restricted.medical.read"] }
  ];
  const admissionsPerms = ["admissions.review", "admissions.decide", "admissions.completeness", "admissions.configure", "admissions.communicate", "admissions.migrate", "enquiries.manage", "enquiries.escalate", "guidance.manage", "guidance.publish"];
  const visibleAreas = () => areas.filter((area) => window.svuSession.canAny(area.perms));
  const isStaff = () => visibleAreas().length > 0 || window.svuSession.canAny(admissionsPerms);
  const isStudent = () => window.svuSession.can("registry.self");
  const isApplicant = () => window.svuSession.can("admissions.apply");
  const canUseSystem = () => window.svuSession.canAny(["foundation.view", "identity.manage", "identity.invite", "audit.view", "workflow.transition", "task.assign", "master_data.publish", "notification.send"]);

  function navItems() {
    const session = window.svuSession.get();
    const me = window.svuSession.cached();
    if (!session) return [
      { route: "home", label: "Home", icon: "home" },
      { route: "apply", label: "Apply", icon: "apply" },
      { route: "verify", label: "Verify a document", short: "Verify", icon: "verify" },
      { route: "resources", label: "Resources", icon: "resources" }
    ];
    const items = isStudent() ? [] : [{ route: "home", label: "Home", icon: "home" }];
    if (!me) return items;
    if (isStudent()) items.push({ route: "study", href: window.studentUI?.spaceLink("study") || "#study/today", label: "Study", icon: "learning" }, { route: "office", href: window.studentUI?.spaceLink("office") || "#office/overview", label: "Student Office", icon: "workspace" });
    else if (isApplicant() || !isStaff() && !window.svuSession.can('sharing.read')) items.push({ route: "apply", label: "My application", short: "Application", icon: "apply" });
    if(window.svuSession.can('sharing.read'))items.push({route:'shared',label:'Shared records',short:'Shared',icon:'verify'});
    if (window.svuSession.can("teaching.self")) items.push({ route: "learning", label: "My teaching", short: "Teaching", icon: "learning" });
    if (window.svuSession.canAny(admissionsPerms)) items.push({ route: "admissions", label: "Admissions", icon: "admissions" });
    const first = visibleAreas()[0];
    if (first) items.push({ route: "registry", href: `#registry/${first.id}`, label: isStudent() ? "Staff workspace" : "Workspace", short: "Staff", icon: "workspace" });
    if (!isStudent()) items.push({ route: "resources", label: "Resources", icon: "resources" });
    items.push({ route: "messages", label: "Inbox", icon: "bell" });
    return items;
  }

  const initials = (me) => {
    const name = me?.person?.preferredName && me.person.preferredName !== "System" ? `${me.person.preferredName} ${me.person.legalName?.split(" ").slice(-1)[0] || ""}` : me?.person?.legalName || me?.account?.email || "?";
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
  };
  const displayName = (me) => me?.person?.preferredName && me.person.preferredName !== "System" ? me.person.preferredName : me?.person?.legalName || me?.account?.email || "";

  let unread = 0, unreadToken = null, active = "home";
  async function refreshUnread() {
    const session = window.svuSession.get();
    if (!session) { unread = 0; unreadToken = null; return; }
    const response = await fetch("/api/notifications/me?limit=1", { headers: { Authorization: `Bearer ${session.token}` } }).catch(() => null);
    if (!response?.ok || window.svuSession.get()?.token !== session.token) return;
    unread = (await response.json()).data?.unread || 0; unreadToken = session.token; paint();
  }

  function paint() {
    const session = window.svuSession.get();
    const me = window.svuSession.cached();
    const items = navItems();
    document.body.classList.toggle("student-mode", isStudent());
    const link = (item, mobile) => `<a href="${item.href || `#${item.route}`}" data-route="${item.route}" class="${item.route === active ? "is-active" : ""}" ${item.route === active ? 'aria-current="page"' : ""}>${mobile ? `${glyphs[item.icon]}<span>${esc(item.short || item.label)}</span>` : esc(item.label)}</a>`;
    const nav = document.querySelector(".nav-links");
    if (nav) nav.innerHTML = items.map((item) => link(item, false)).join("");
    const actions = document.querySelector(".nav-actions");
    if (actions) actions.innerHTML = `
      ${session ? `<button class="icon-button student-command-button" type="button" data-shell-command aria-label="Search" title="Search SVU">${glyphs.search}</button>` : ''}
      ${session && window.svuSession.can("registry.view") ? `<form class="search" role="search" data-shell-search><label class="visually-hidden" for="shell-search">Search students</label>${glyphs.search}<input id="shell-search" name="q" type="search" placeholder="Search students by name or number" autocomplete="off"></form>` : ""}
      ${session ? `<a class="icon-button notification-button" href="#messages" data-route="messages" aria-label="Messages${unread ? `, ${unread} unread` : ""}" title="Messages">${glyphs.bell}${unread ? `<span class="badge" data-unread-count>${unread > 99 ? "99+" : unread}</span>` : ""}</a>
        <div class="profile-menu" data-profile-menu><button class="profile-button" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu for ${esc(displayName(me) || "your account")}" data-profile-toggle>${esc(initials(me))}</button>
          <div class="profile-dropdown" role="menu" hidden>
            <div class="profile-summary"><strong>${esc(me?.person?.legalName || "Signed in")}</strong><span>${esc(me?.account?.email || "")}</span>${me?.roles?.length ? `<span class="meta">${esc(me.roles.map((role) => role.code.replaceAll("_", " ")).join(", "))}</span>` : ""}${me?.roles?.some(role => role.code === 'system_administrator') ? `<span class="meta">Two-step verification: ${me.mfa?.enrolled ? 'On' : 'Off'}</span>` : ''}</div>
            <a role="menuitem" href="#home">Home</a><a role="menuitem" href="#messages">Inbox</a><a role="menuitem" href="#settings">Settings</a>
            ${canUseSystem() ? `<a role="menuitem" href="#foundation">System administration</a>` : ""}
            ${items.filter((item) => !["home", "resources", "messages"].includes(item.route)).map((item) => `<a class="profile-destination" role="menuitem" href="${item.href || `#${item.route}`}">${esc(item.label)}</a>`).join("")}
            <button role="menuitem" type="button" data-shell-signout>Sign out</button>
          </div></div>`
      : `<a class="button button-primary" href="#signin" data-route="signin">Sign in</a>`}`;
    const mobile = document.querySelector(".mobile-nav");
    if (mobile) {
      const destinations = items.filter((item) => item.route !== "messages");
      const mobileItems = destinations.slice(0, 3);
      const resources = destinations.find((item) => item.route === "resources");
      if (resources && !mobileItems.includes(resources)) mobileItems.push(resources);
      mobileItems.push(session ? { route: "settings", label: "Account", icon: "account" } : { route: "signin", label: "Sign in", icon: "account" });
      if (isStudent()) {
        const office = active === "office";
        const pages = office ? [["overview", "Overview", "home"], ["registration", "Registration", "apply"], ["fees", "Fees", "resources"], ["requests", "Requests", "workspace"]] : [["today", "Today", "home"], ["courses", "Courses", "learning"], ["timetable", "Calendar", "apply"]];
        const studentItems = pages.map(([page, label, icon]) => ({ route: office ? "office" : "study", href: window.studentUI?.link(office ? "office" : "study", page) || `#${office ? "office" : "study"}/${page}`, label, icon }));
        if (!office) studentItems.push({ route: "messages", label: "Inbox", icon: "bell" });
        studentItems.push({ route: "settings", label: "Account", icon: "account" });
        mobile.innerHTML = studentItems.map((item) => link(item, true)).join("");
        mobile.querySelectorAll("a").forEach((node) => {
          const selected = node.getAttribute("href").split("?")[0] === location.hash.split("?")[0];
          node.classList.toggle("is-active", selected);
          if (selected) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current");
        });
      } else mobile.innerHTML = mobileItems.map((item) => link(item, true)).join("");
    }
    bind();
  }

  function closeMenu(focusToggle) {
    const menu = document.querySelector("[data-profile-menu]");
    if (!menu) return;
    menu.querySelector(".profile-dropdown").hidden = true;
    menu.querySelector("[data-profile-toggle]").setAttribute("aria-expanded", "false");
    if (focusToggle) menu.querySelector("[data-profile-toggle]").focus();
  }
  function bind() {
    document.querySelector('[data-shell-command]')?.addEventListener('click', openCommand);
    const toggle = document.querySelector("[data-profile-toggle]");
    toggle?.addEventListener("click", () => {
      const dropdown = toggle.parentElement.querySelector(".profile-dropdown");
      dropdown.hidden = !dropdown.hidden;
      toggle.setAttribute("aria-expanded", String(!dropdown.hidden));
      if (!dropdown.hidden) dropdown.querySelector("[role=menuitem]")?.focus();
    });
    document.querySelectorAll("[data-profile-menu] [role=menuitem]").forEach((item) => item.addEventListener("click", () => closeMenu(false)));
    document.querySelector("[data-shell-signout]")?.addEventListener("click", () => signOut());
    document.querySelector("[data-shell-search]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = new FormData(event.currentTarget).get("q").trim();
      location.hash = `#registry/students${q ? `?q=${encodeURIComponent(q)}` : ""}`;
    });
  }
  document.addEventListener("click", (event) => { if (!event.target.closest("[data-profile-menu]")) closeMenu(false); });
  document.querySelector("[data-skip-link]")?.addEventListener("click", () => document.querySelector("#app")?.focus());
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !document.querySelector(".profile-dropdown")?.hidden) closeMenu(true); });

  let commandDialog = null, commandOrigin = null;
  function closeCommand() {
    if (!commandDialog) return;
    commandDialog.close(); commandDialog.remove(); commandDialog = null;
    (commandOrigin?.isConnected ? commandOrigin : document.querySelector('[data-shell-command]'))?.focus();
    commandOrigin = null;
  }
  function openCommand() {
    if (!window.svuSession.get() || !window.svuSession.cached() || commandDialog) return;
    closeMenu(false); commandOrigin = document.activeElement?.matches('a,button,input,select,textarea,[tabindex]') ? document.activeElement : document.querySelector('[data-shell-command]');
    const dialog = document.createElement('dialog'); commandDialog = dialog;
    dialog.className = 'student-command-dialog';
    dialog.innerHTML = `<div class="student-command-head"><h2 id="student-command-title">Search SVU</h2><button class="icon-button" type="button" data-command-close aria-label="Close search" title="Close search">${window.svuUI.glyph('x')}</button></div><label class="student-command-field"><span class="visually-hidden">Search pages and courses</span>${glyphs.search}<input type="search" placeholder="Search SVU" autocomplete="off" data-command-query></label><div class="student-command-results" data-command-results></div><p class="visually-hidden" role="status" data-command-status></p>`;
    dialog.setAttribute('aria-labelledby', 'student-command-title');
    document.body.append(dialog);
    const input = dialog.querySelector('[data-command-query]'), results = dialog.querySelector('[data-command-results]');
    const paintResults = () => {
      const query = input.value.trim().toLowerCase();
      const items = commandItems().filter(item => `${item.title} ${item.detail} ${item.terms || ''}`.toLowerCase().includes(query)).slice(0, 16);
      if (query && window.svuSession.can('registry.view')) items.unshift({ title: `Find student: ${input.value.trim()}`, detail: 'Student records', href: `#registry/students?q=${encodeURIComponent(input.value.trim())}` });
      results.innerHTML = items.length ? items.map(item => `<a class="student-command-result" href="${esc(item.href)}"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></a>`).join('') : '<div class="ui-empty ui-empty-compact"><p class="ui-card-title">No matches</p></div>';
      dialog.querySelector('[data-command-status]').textContent = `${items.length} results`;
      results.querySelectorAll('a').forEach(anchor => anchor.addEventListener('click', closeCommand));
    };
    input.addEventListener('input', paintResults);
    dialog.querySelector('[data-command-close]').addEventListener('click', closeCommand);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeCommand(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeCommand(); } });
    dialog.addEventListener('keydown', event => {
      const links = Array.from(results.querySelectorAll('a')), index = links.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && links.length) {
          const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : links.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
          event.preventDefault(); links[next].focus();
      } else if (event.key === 'Enter' && event.target === input && links.length) { event.preventDefault(); links[0].click(); }
    });
    paintResults(); dialog.showModal(); input.focus();
  }
  function commandItems() {
    if (!window.svuSession.get() || !window.svuSession.cached()) return [];
    const destinations = navItems().map(item => ({ title: item.label, detail: 'Workspace', href: item.href || `#${item.route}` }));
    for (const area of visibleAreas()) destinations.push({ title: area.label, detail: area.text, href: `#registry/${area.id}` });
    if (isStudent()) destinations.push(...(window.studentUI?.searchItems() || []));
    destinations.push({ title: 'Verify a document', detail: 'Official documents', href: '#verify' }, { title: 'Account and security', detail: 'Settings', href: '#settings' });
    if (canUseSystem()) destinations.push({ title: 'System administration', detail: 'Access and configuration', href: '#foundation' });
    return [...new Map(destinations.map(item => [item.href, item])).values()];
  }
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && window.svuSession.get()) { event.preventDefault(); commandDialog ? closeCommand() : openCommand(); } });
  window.addEventListener('hashchange', closeCommand);

  async function signOut() {
    await window.svuSession.signOut();
    location.hash = "#home";
    window.svuRender?.();
  }

  // Called by the router on every navigation.
  async function update(route) {
    active = route;
    paint();
    const session = window.svuSession.get();
    if (session && !window.svuSession.cached()) {
      await window.svuSession.me();
      paint();
      if (window.svuSession.get()?.token === session.token) window.svuRender?.({ fromShell: true });
    }
    if (session && unreadToken !== session.token) refreshUnread();
  }
  window.svuSession.onChange(() => { closeCommand(); unreadToken = null; unread = 0; update(active); });

  // ---------- shared sign-in ----------
  const signin = { step: "password", pending: null, notice: null, busy: false, recoveryCodes: null };
  async function call(method, path, body, token) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error?.message || "Request failed."); error.status = response.status; throw error; }
    return payload.data;
  }
  const nextRoute = () => {
    const next = new URLSearchParams((location.hash.split("?")[1]) || "").get("next");
    return next && /^[a-z][a-z0-9/_-]*$/i.test(next) && !next.startsWith("signin") ? `#${next}` : "#home";
  };

  function renderSignIn(app) {
    if (window.svuSession.get() && signin.step !== "codes") { location.replace(nextRoute()); return; }
    const notice = signin.notice ? `<div class="notice ${signin.notice.tone === "error" ? "notice-error" : "notice-success"}" role="${signin.notice.tone === "error" ? "alert" : "status"}">${esc(signin.notice.text)}</div>` : "";
    const forms = {
      password: `<form class="form" data-shell-signin>
        <label class="field"><span>Email, student number or username</span><input class="input" name="email" type="text" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="button button-primary" type="submit">Sign in</button>
        <button class="link-button" type="button" data-signin-step="recover">Forgot your password?</button>
      </form>`,
      verify: `<form class="form" data-shell-mfa>
        <p>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <label class="field"><span>Authenticator code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
        <label class="field"><span>Recovery code</span><input class="input" name="recoveryCode" autocomplete="one-time-code"></label>
        <div class="hero-actions"><button class="button button-primary" type="submit">Verify</button><button class="button button-secondary" type="button" data-signin-cancel>Cancel</button></div>
      </form>`,
      enrol: `<form class="form" data-shell-mfa>
        <p>Your role requires two-step verification. Add this key to an authenticator app, then enter the code it shows.</p>
        <p class="secret-key" data-mfa-secret>${esc(signin.pending?.secret)}</p>
        <label class="field"><span>Authenticator code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        <div class="hero-actions"><button class="button button-primary" type="submit">Turn on and continue</button><button class="button button-secondary" type="button" data-signin-cancel>Cancel</button></div>
      </form>`,
      codes: `<div class="form"><p><strong>Save your recovery codes.</strong> Each code works once if you lose your authenticator. They will not be shown again.</p>
        <ul class="recovery-codes">${(signin.recoveryCodes || []).map((code) => `<li><code>${esc(code)}</code></li>`).join("")}</ul>
        <button class="button button-primary" type="button" data-signin-done>I have saved them, continue</button></div>`,
      recover: `<form class="form" data-shell-recover>
        <p>Enter your account email. If it belongs to an active account, we will send a reset code.</p>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="username" required></label>
        <div class="hero-actions"><button class="button button-primary" type="submit">Send reset code</button><button class="button button-secondary" type="button" data-signin-step="password">Back to sign in</button></div>
      </form>`,
      reset: `<form class="form" data-shell-reset>
        <label class="field"><span>Reset code</span><input class="input" name="token" autocomplete="one-time-code" required></label>
        <label class="field"><span>New password</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="12" required></label>
        <div class="hero-actions"><button class="button button-primary" type="submit">Set new password</button><button class="button button-secondary" type="button" data-signin-step="password">Back to sign in</button></div>
      </form>`
    };
    const titles = { password: "Sign in", verify: "Two-step verification", enrol: "Set up two-step verification", codes: "Recovery codes", recover: "Reset your password", reset: "Choose a new password" };
    app.innerHTML = `<section class="signin-page" aria-busy="${signin.busy}"><div class="signin-card">
      <div class="signin-identity"><span class="brand-mark" aria-hidden="true">SV</span><span>South Valley University</span></div>
      <h1 class="page-title">${titles[signin.step]}</h1>
      ${notice}
      <fieldset class="review-controls" ${signin.busy ? "disabled" : ""}>${forms[signin.step]}</fieldset>
      ${signin.busy ? `<p class="meta signin-progress" role="status">Please wait...</p>` : ""}
      ${signin.step === "password" ? `<p class="meta">New applicant? <a href="#apply">Create an account and apply</a>.</p>` : ""}
    </div></section>`;
    const run = async (work) => {
      if (signin.busy) return;
      const step = signin.step;
      const values = Array.from(app.querySelectorAll('input')).map((input) => [input.name, input.value]);
      signin.busy = true; signin.notice = null; renderSignIn(app);
      try { await work(); } catch (error) { signin.notice = { tone: "error", text: error.message }; }
      finally {
        signin.busy = false;
        if (location.hash.startsWith("#signin")) {
          renderSignIn(app);
          if (signin.notice?.tone === 'error' && signin.step === step) {
            for (const [name, value] of values) {
              const input = Array.from(app.querySelectorAll('input')).find((row) => row.name === name);
              if (input) input.value = value;
            }
          }
        }
      }
    };
    const finish = (session) => {
      window.svuSession.set({ token: session.token, sessionId: session.sessionId });
      signin.pending = null;
      if (signin.step !== "codes") { signin.step = "password"; location.hash = nextRoute(); }
    };
    app.querySelector("[data-shell-signin]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => {
        const session = await call("POST", "/api/identity/sessions", values);
        if (session.status === "mfa_pending") { signin.pending = { token: session.token, sessionId: session.id }; signin.step = "verify"; return; }
        if (session.status === "mfa_enrolment_required") {
          signin.pending = { token: session.token, sessionId: session.id, secret: (await call("POST", "/api/identity/mfa/totp", undefined, session.token)).secret };
          signin.step = "enrol"; return;
        }
        finish({ token: session.token, sessionId: session.id });
      });
    });
    app.querySelector("[data-shell-mfa]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => {
        const pending = signin.pending;
        if (signin.step === "enrol") {
          signin.recoveryCodes = (await call("POST", "/api/identity/mfa/totp/confirm", { code: values.code }, pending.token)).recoveryCodes || [];
          signin.step = "codes";
        } else await call("POST", "/api/identity/sessions/current/mfa", { code: values.code || undefined, recoveryCode: values.recoveryCode || undefined }, pending.token);
        finish(pending);
      });
    });
    app.querySelector("[data-signin-cancel]")?.addEventListener("click", () => run(async () => {
      const pending = signin.pending; signin.pending = null; signin.step = "password";
      if (pending) await call("DELETE", `/api/identity/sessions/${encodeURIComponent(pending.sessionId)}`, undefined, pending.token).catch(() => null);
      signin.notice = { tone: "success", text: "Sign-in cancelled." };
    }));
    app.querySelector("[data-signin-done]")?.addEventListener("click", () => { signin.step = "password"; signin.recoveryCodes = null; location.hash = nextRoute(); });
    app.querySelectorAll("[data-signin-step]").forEach((button) => button.addEventListener("click", () => { signin.step = button.dataset.signinStep; signin.notice = null; renderSignIn(app); }));
    app.querySelector("[data-shell-recover]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => { const result = await call("POST", "/api/identity/recovery-requests", values); signin.step = "reset"; signin.notice = { tone: "success", text: result.message }; });
    });
    app.querySelector("[data-shell-reset]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => { await call("POST", "/api/identity/recovery-confirmations", values); signin.step = "password"; signin.notice = { tone: "success", text: "Password changed. Sign in with your new password." }; });
    });
    app.querySelector("input")?.focus({ preventScroll: true });
  }

  window.svuShell = { update, signOut, renderSignIn, areas, visibleAreas, admissionsPerms, isStaff, isStudent, isApplicant, canUseSystem, commandItems, displayName, glyphs, refreshUnread };
})();
