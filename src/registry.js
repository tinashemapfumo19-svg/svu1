(function () {
  const initialState = () => ({ session: null, rows: null, detail: null, registrations: [], results: null, academic: null, lifecycle: null, credits: null, identity: null, duplicates: null, duplicateLookup: "", account: null, adjustments: null, calendar: [], notice: "", busy: false, mfa: null, recoveryCodes: [] });
  const state = initialState();
  function clearSessionState() {
    // Reset private caches without unlocking the current in-flight action.
    const busy = state.busy;
    for (const field of Object.keys(state)) delete state[field];
    Object.assign(state,initialState(),{busy});window.svuSession.clear();
  }
  // Follow the app-wide session: another workspace may have signed in or out.
  function syncSession() {
    const current = window.svuSession.get();
    if (state.mfa || (current?.token || null) === (state.session?.token || null)) return;
    const busy = state.busy;
    for (const field of Object.keys(state)) delete state[field];
    Object.assign(state,initialState(),{busy,session:current});
  }
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  state.session = window.svuSession.get();
  async function api(method, path, body, token = state.session?.token) {
    const sessionBound = Boolean(token && token === state.session?.token);
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (sessionBound && token !== state.session?.token) throw new Error('The session changed. Reload this workspace.');
    if (!response.ok) {
      if (response.status === 401 && !state.mfa && sessionBound) clearSessionState();
      const error = new Error(payload.error?.message || "Request failed.");error.status = response.status;throw error;
    }
    return payload.data;
  }
  // The workspace is split into screens (#registry/<section>); each loads only its own panels.
  const loaders = {
    academic: [() => window.academicSetupUI.load(state, api)],
    leave: [() => window.staffLeaveUI.load(state,api)],
    assets: [() => window.assetsUI.load(state,api)],
    fleet: [() => window.fleetUI.load(state,api)],
    cashbook: [() => window.cashbookUI.load(state,api)],
    privacy: [() => window.restrictedProfilesUI.load(state,api)],
    students: [],
    support: [() => window.supportCasesUI.loadStaff(state,api), () => window.supportReportingUI.load(state,api)],
    finance: [() => window.financeImportsUI.load(state, api), () => state.controlTotals ? null : window.financeReportsUI.load(state, api), () => window.registrySponsorsUI.loadDirectory(state, api)],
    teaching: [async () => { if (!state.teachingLoaded) { await window.registryTeachingUI.load(state, api); state.teachingLoaded = true; } }, () => window.registryLmsUI.load(state, api)],
    exams: [() => window.registryExamsUI.load(state, api), () => window.registryExamPapersUI.load(state,api), () => window.registryExamArrangementsUI.load(state,api), () => window.registryReportingUI.load(state,api,state.examinationReport?.filters)],
    documents: [() => window.registryIssuanceUI.load(state, api)],
    reports: [() => window.registryEnrolmentReportingUI.load(state,api,state.registryReport?.filters || state.registryReportFilters), () => window.academicOutcomeReportingUI.load(state,api), () => window.assessmentReportingUI.load(state,api), () => window.continuationReportingUI.load(state,api), () => window.reportEditionsUI.load(state,api), () => window.reportSchedulesUI.load(state,api)],
    admin: [() => state.staff ? null : window.registryStaffUI.load(state, api), () => window.registryIntegrationsUI.load(state, api)]
  };
  function route() {
    const [path, query] = location.hash.replace(/^#/, "").split("?");
    return { section: path.split("/")[1] || "", query: new URLSearchParams(query || "") };
  }
  function currentSection() {
    const areas = window.svuShell.visibleAreas();
    const requested = route().section;
    if (areas.some((area) => area.id === requested)) return requested;
    // Before the profile arrives, trust the address; afterwards fall back to the first area this person can use.
    if (!window.svuSession.cached() && loaders[requested]) return requested;
    return areas[0]?.id || "students";
  }
  async function load(filters = state.filters || {}) {
    state.filters = filters;
    const section = currentSection();
    state.calendar = await api("GET", "/api/master-data/academic-periods").catch(() => []);
    if (section === "students") state.rows = await api("GET", `/api/registry/students?${new URLSearchParams({ limit: "25", ...filters })}`).catch(() => null);
    for (const loader of loaders[section] || []) await loader();
    state.loadedSection = section;
  }
  async function loadDetail(id) {
    state.results = null;
    state.resultsUnavailable = false;
    state.credits = null;
    state.transfers = null;
    state.identity = null;
    state.duplicates = null;
    state.account = null;
    state.adjustments = null;
    if (state.detail?.id !== id) { state.duplicateLookup = ""; state.transcriptOpen = null; }
    state.detail = await api("GET", `/api/registry/programmes/${id}`);
    state.registrations = await api("GET", `/api/registry/programmes/${id}/registrations`);
    state.resultsUnavailable = Boolean(state.detail.canViewResults);
    state.results = state.detail.canViewResults ? await api("GET", `/api/registry/programmes/${id}/results`) : null;
    state.resultsUnavailable = false;
    state.award = await api("GET", `/api/registry/programmes/${id}/award`).catch(() => null);
    state.transcripts = state.detail.canViewResults ? await api("GET", `/api/registry/programmes/${id}/transcripts`) : null;
    state.academic = state.detail.canViewAcademic ? await api("GET", `/api/registry/programmes/${id}/academic`) : null;
    state.lifecycle = await api("GET", `/api/registry/programmes/${id}/lifecycle`);
    state.credits = await api("GET", `/api/registry/programmes/${id}/credits`);
    state.transfers = await api("GET", `/api/registry/programmes/${id}/transfers`);
    state.identity = await api("GET", `/api/registry/programmes/${id}/identity`);
    await window.registryDuplicatesUI.loadDuplicates(state, api);
    await window.registryFinanceUI.loadAccount(state, api);
    await window.registryPlansUI.load(state, api, id);
    await window.registrySponsorsUI.loadProgramme(state, api, id);
    state.withdrawals = await api("GET", `/api/registry/programmes/${id}/withdrawals`).catch(() => null);
  }
  async function act(work) {
    if (state.busy) return;
    state.busy = true;
    state.notice = "";
    render();
    try { await work(); } catch (error) { state.notice = error.message; }
    finally {
      state.busy = false; render();
      if(state.fleetReload && /^#registry\/fleet(?:\?|$)/.test(location.hash))setTimeout(()=>{
        if(state.fleetReload && !state.busy && state.session && /^#registry\/fleet(?:\?|$)/.test(location.hash)){delete state.fleetReload;act(()=>load());}
      },0);
    }
  }
  const sectionPanels = {
    academic: () => window.academicSetupUI.render(state),
    leave: () => window.staffLeaveUI.render(state),
    assets: () => window.assetsUI.render(state),
    fleet: () => window.fleetUI.render(state),
    cashbook: () => window.cashbookUI.render(state),
    privacy: () => window.restrictedProfilesUI.render(state),
    support: () => `${window.supportCasesUI.staffView(state)}${window.supportReportingUI.render(state)}`,
    finance: () => `${window.financeImportsUI.render(state)}${window.registrySponsorsUI.renderDirectory(state)}${window.financeReportsUI.render(state)}`,
    teaching: () => `${window.registryTeachingUI.render(state)}${window.registryAssessmentUI.render(state)}${window.registryLmsUI.render(state)}`,
    exams: () => `${window.registryExamsUI.render(state)}${window.registryExamPapersUI.render(state)}${window.registryExamArrangementsUI.render(state)}${window.registryReportingUI.render(state)}`,
    documents: () => window.registryIssuanceUI.render(state),
    reports: () => `${window.registryEnrolmentReportingUI.render(state)}${window.academicOutcomeReportingUI.render(state)}${window.assessmentReportingUI.render(state)}${window.continuationReportingUI.render(state)}${window.reportEditionsUI.render(state)}${window.reportSchedulesUI.render(state)}`,
    admin: () => `${window.registryStaffUI.render(state)}${window.registryIntegrationsUI.render(state)}`
  };
  // Jump links for the long student record.
  const detailParts = [["record-overview", "Overview"], ["record-lifecycle", "Status and transfers"], ["record-finance", "Finance"], ["record-registration", "Registration"], ["record-results", "Results and awards"], ["record-academic", "Academic progress"]];
  function studentsPanel(detail) {
    const ui = window.svuUI;
    const page = Math.floor((state.rows?.offset || 0) / 25) + 1, pages = Math.max(1, Math.ceil((state.rows?.total || 0) / 25));
    return `<section class="ui-panel staff-search"><form class="staff-filter" data-registry-filter>
        <label class="field field-wide"><span>Student number or name</span><input class="input" name="q" value="${esc(state.filters?.q)}"></label>
        <label class="field"><span>Status</span><select class="input" name="status"><option value="">All statuses</option>${["pending_onboarding", "onboarded", "suspended", "interrupted", "withdrawn", "transferred"].map((status) => `<option value="${status}" ${state.filters?.status === status ? "selected" : ""}>${esc(ui.statusLabel(status))}</option>`).join("")}</select></label>
        <div><button class="button button-primary">Search</button></div>
      </form></section>
      <div class="registry-grid record-workbench ui-bare">
        <div class="review-sidebar">${ui.head("Records", { actions: `<p class="ui-meta" data-registry-count>${state.rows?.total ?? 0} programme records</p>` })}
        <div class="ui-rows">${state.rows?.items.map((row) => `<button type="button" class="review-row ${row.id === detail?.id ? "is-selected" : ""}" data-registry-detail="${esc(row.id)}" ${row.id === detail?.id ? 'aria-current="true"' : ""}><span class="ui-row-top"><strong>${esc(row.legalName)}</strong>${ui.status(row.status)}</span><span class="ui-meta">${esc(row.studentNumber)} · ${esc(row.programmeCode)} · ${esc(row.intakeLabel)}</span></button>`).join("") || ui.emptyState({ glyph: "search", text: "No matching student records.", compact: true })}</div>
        <div class="staff-pager"><button class="icon-button" type="button" data-registry-page="-1" title="Previous page" aria-label="Previous page" ${!state.rows?.offset ? "disabled" : ""}>&larr;</button>
        <span class="ui-meta">Page ${page} of ${pages}</span>
        <button class="icon-button" type="button" data-registry-page="1" title="Next page" aria-label="Next page" ${(state.rows?.offset || 0) + 25 >= (state.rows?.total || 0) ? "disabled" : ""}>&rarr;</button></div></div>
        <div class="review-detail">${detail ? `<nav class="record-jump" aria-label="Student record sections">${detailParts.map(([id, label]) => `<a href="#registry/students" data-record-jump="${id}">${label}</a>`).join("")}</nav>
          <section id="record-overview" class="ui-section"><div class="staff-record-hero"><div><p class="ui-eyebrow">${esc(detail.studentNumber)}</p><h2 class="ui-section-title">${esc(detail.legalName)}</h2><p class="ui-meta">${esc(detail.programmeName)} · ${esc(detail.intakeLabel)}</p></div>${ui.status(detail.status)}</div>
          ${ui.facts([["Faculty / department", `${detail.faculty} / ${detail.department}`], ["Study mode", detail.studyModeCode], ["Programme version", detail.programmeVersionId], ["Status", { html: ui.status(detail.status) }], ["Profile", detail.readiness.complete ? "Complete" : `Missing: ${detail.readiness.missing.join(", ")}`]], "ui-facts-3")}
          ${detail.legacySourceStatus ? ui.facts([["Previous system status", detail.legacySourceStatus]]) : ''}
          ${window.studyYearUI.render(detail)}${window.registryIdentityUI.render(state)}${window.registryDuplicatesUI.render(state)}
          ${detail.status === "pending_onboarding" && detail.canOnboard ? `<form class="form" data-registry-approve><label><input name="identityConfirmed" type="checkbox" required> Identity confirmed</label>
          <label class="field"><span>Approval reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><button class="button button-primary" ${!detail.readiness.complete ? "disabled" : ""}>Approve onboarding</button></form>` : ""}</section>
          <section id="record-lifecycle"><h3>Status history</h3><ul class="ui-rows">${detail.history.map((item) => `<li class="ui-row">${ui.ico("history", "blue", "ui-icon-sm")}<div><strong>${esc(item.fromStatus || (detail.originProgrammeId ? "transfer" : "conversion"))} to ${esc(item.toStatus)}</strong><span class="ui-meta">${esc(item.reason)}</span></div></li>`).join("")}</ul>${window.registryLifecycleUI.render(state)}${window.registryTransfersUI.render(state)}</section>
          <section id="record-finance">${window.registryFinanceUI.render(state)}${window.registryPlansUI.render(state)}${window.registrySponsorsUI.renderProgramme(state)}</section>
          <section id="record-registration">${window.courseWithdrawalsUI.render(state.withdrawals, state.registrations)}${window.registryRegistrationUI.render(state)}</section>
          <section id="record-results">${window.registryResultsUI.render(state)}${window.transcriptsUI.staffRender(state)}${window.registryAwardsUI.staffRender(state)}</section>
          <section id="record-academic">${window.registryAcademicUI.render(state)}${window.registryCreditsUI.render(state)}</section>` : ui.emptyState({ glyph: "user", title: "Select a student record", text: "Search, then choose a record to see its programme, status, finance, registration and results." })}</div>
      </div>`;
  }
  function render() {
    if (!/^#registry(\/|\?|$)/.test(location.hash)) return;
    const root = document.querySelector("#app");
    const detail = state.detail;
    const section = currentSection();
    const areas = window.svuShell.visibleAreas();
    const area = window.svuShell.areas.find((row) => row.id === section);
    const body = section === "students" ? studentsPanel(detail) : sectionPanels[section]?.() || "";
    const empty = state.session && state.loadedSection === section && section !== "students" && !body.trim();
    root.innerHTML = `<section class="registry-workspace">
      <header class="section-header staff-page-head"><div><p class="eyebrow">Staff workspace</p><h1 class="page-title">${esc(state.session ? area?.label || "Workspace" : "Staff sign in")}</h1>${state.session && area?.text ? `<p class="ui-meta ui-page-description workspace-intro">${esc(area.text)}</p>` : ""}</div>
      ${state.session ? `<div class="ui-actions"><button class="button button-secondary" type="button" data-registry-signout ${state.busy ? "disabled" : ""}>Sign out</button></div>` : ""}</header>
      ${state.session && areas.length > 1 ? `<nav class="workspace-tabs" aria-label="Workspace areas">${areas.map((row) => `<a href="#registry/${row.id}" data-workspace-tab="${row.id}" class="${row.id === section ? "is-active" : ""}" ${row.id === section ? 'aria-current="page"' : ""}>${esc(row.label)}</a>`).join("")}</nav>` : ""}
      ${state.notice ? `<div class="notice" role="status">${esc(state.notice)}</div>` : ""}
      ${state.recoveryCodes.length ? `<div class="notice notice-warning"><strong>Recovery codes</strong><p>${state.recoveryCodes.map(esc).join(" ")}</p></div>` : ""}
      <fieldset class="review-controls" ${state.busy ? "disabled" : ""}>
      ${!state.session ? `<form class="form registry-signin" data-registry-login data-form="${state.mfa ? "registry-mfa" : "registry-signin"}">
        ${state.mfa ? `${state.mfa.secret ? `<div class="notice"><strong>MFA enrolment required</strong><p>TOTP secret</p><p>${esc(state.mfa.secret)}</p></div>` : `<div class="notice"><strong>MFA verification required</strong></div>`}
        <label class="field"><span>Authenticator code</span><input class="input" name="code" autocomplete="one-time-code"></label>
        ${!state.mfa.secret ? `<label class="field"><span>Recovery code</span><input class="input" name="recoveryCode" autocomplete="one-time-code"></label>` : ""}
        <button class="button button-primary" type="submit">Verify</button><button class="button button-secondary" type="button" data-registry-cancel>Cancel</button>` : `
        <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="button button-primary" type="submit">Sign in</button>`}
      </form>` : `<div class="staff-body" data-staff-body="${esc(section)}">${body}
      ${empty ? window.svuUI.emptyState({ glyph: "lock", title: "Nothing to show here", text: "Your roles do not give access to anything in this area yet. Ask an administrator if you need it." }) : ""}
      ${!body.trim() && !empty ? `<div class="staff-loading ui-bare" role="status"><span class="visually-hidden">Loading ${esc(area?.label || "workspace")}</span><div></div><div></div><div></div></div>` : ""}</div>`}
      </fieldset></section>`;
    window.svuUI.enhance(root);
    const activeTab = root.querySelector(".workspace-tabs a.is-active");
    if (activeTab) activeTab.parentElement.scrollLeft = activeTab.offsetLeft - activeTab.parentElement.offsetLeft - 16;
    root.querySelectorAll("summary").forEach((summary) => {
      summary.setAttribute("aria-disabled", String(state.busy));
      summary.addEventListener("click", (event) => { if (state.busy) event.preventDefault(); });
    });
    root.querySelector("[data-registry-login]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      act(async () => {
        let signedInMessage = "";
        if (state.mfa) {
          const pending = state.mfa;
          if (pending.secret) state.recoveryCodes = (await api("POST", "/api/identity/mfa/totp/confirm", { code: values.code }, pending.token)).recoveryCodes || [];
          else await api("POST", "/api/identity/sessions/current/mfa", { code: values.code || undefined, recoveryCode: values.recoveryCode || undefined }, pending.token);
          state.session = { token: pending.token, sessionId: pending.id }; state.mfa = null;
          signedInMessage = pending.secret ? "MFA enrolled. Store 10 recovery code(s) securely." : "MFA verified.";
        } else {
          const session = await api("POST", "/api/identity/sessions", values);
          if (["mfa_pending", "mfa_enrolment_required"].includes(session.status)) {
            state.mfa = session;
            if (session.status === "mfa_enrolment_required") state.mfa.secret = (await api("POST", "/api/identity/mfa/totp", undefined, session.token)).secret;
            return;
          }
          state.session = { token: session.token, sessionId: session.id };
        }
        window.svuSession.set(state.session); await load(); state.notice = signedInMessage;
      });
    });
    root.querySelector("[data-registry-cancel]")?.addEventListener("click", () => act(async () => {
      await api("DELETE", `/api/identity/sessions/${state.mfa.id}`, undefined, state.mfa.token); state.mfa = null; state.notice = "MFA sign-in cancelled.";
    }));
    root.querySelector("[data-registry-signout]")?.addEventListener("click", () => act(async () => {
      const departing = state.session;clearSessionState();render();
      await api("DELETE", `/api/identity/sessions/${departing.sessionId}`,undefined,departing.token);
    }));
    root.querySelectorAll("[data-record-jump]").forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault(); root.querySelector(`#${link.dataset.recordJump}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    root.querySelector("[data-registry-filter]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const filters = Object.fromEntries(new FormData(event.currentTarget)); act(() => load(filters));
    });
    root.querySelectorAll("[data-registry-detail]").forEach((button) => button.addEventListener("click", () => act(async () => {
      await loadDetail(button.dataset.registryDetail);
    })));
    root.querySelectorAll("[data-registry-page]").forEach((button) => button.addEventListener("click", () => act(() => load({ ...state.filters, offset: String((state.rows?.offset || 0) + Number(button.dataset.registryPage) * 25) }))));
    root.querySelector("[data-registry-approve]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); act(async () => {
        await api("POST", `/api/registry/programmes/${detail.id}/approve`, { reason: values.reason, identityConfirmed: values.identityConfirmed === "on" });
        await loadDetail(detail.id); await load(state.filters); state.notice = "Onboarding approved.";
      });
    });
    if (state.session) window.academicSetupUI.bind(root, state, { api, act });
    if (state.session) window.financeImportsUI.bind(root, state, { api, act });
    if (state.session) window.financeReportsUI.bind(root, state, { api, act });
    if (state.session) window.registryStaffUI.bind(root, state, { api, act });
    if (state.session) window.staffLeaveUI.bind(root,state,{api,act});
    if (state.session) window.assetsUI.bind(root,state,{api,act});
    if (state.session) window.fleetUI.bind(root,state,{api,act});
    if (state.session) window.cashbookUI.bind(root,state,{api,act});
    if (state.session) window.restrictedProfilesUI.bind(root,state,{api,act});
    if (state.session) window.registryTeachingUI.bind(root, state, { api, act });
    if (state.session) window.registryLmsUI.bind(root, state, { api, act });
    if (state.session) window.registryIntegrationsUI.bind(root, state, { api, act });
    if (state.session) window.registrySponsorsUI.bind(root, state, { api, act, loadDetail });
    if (state.session) window.registryIssuanceUI.bind(root, state, { api, act });
    if (state.session) window.registryExamsUI.bind(root, state, { api, act });
    if (state.session) window.registryExamPapersUI.bind(root,state,{api,act});
    if (state.session) window.registryExamArrangementsUI.bind(root,state,{api,act});
    if (state.session) window.registryReportingUI.bind(root,state,{api,act});
    if (state.session) window.registryEnrolmentReportingUI.bind(root,state,{api,act});
    if (state.session) window.supportCasesUI.staffBind(root,state,{api,act});
    if (state.session) window.supportReportingUI.bind(root,state,{api,act});
    if (state.session) window.academicOutcomeReportingUI.bind(root,state,{api,act});
    if (state.session) window.assessmentReportingUI.bind(root,state,{api,act});
    if (state.session) window.continuationReportingUI.bind(root,state,{api,act});
    if (state.session) window.reportEditionsUI.bind(root,state,{api,act});
    if (state.session) window.reportSchedulesUI.bind(root,state,{api,act});
    if (state.session) window.registryAssessmentUI.bind(root, state, { api, act });
    window.registryRegistrationUI.bind(root, state, { api, act, loadDetail });
    window.registryResultsUI.bind(root, state, { api, act, loadDetail });
    if (detail) window.transcriptsUI.staffBind(root, state, { api, act });
    if (detail) window.registryAwardsUI.staffBind(root, state, { api, act, loadDetail });
    window.registryAcademicUI.bind(root, state, { api, act, loadDetail });
    if (detail) window.registryIdentityUI.bind(root,state,{api,act,loadDetail,load});
    if (detail) window.registryFinanceUI.bind(root,state,{api,act,loadDetail});
    if (detail) window.registryPlansUI.bind(root,state,{api,act});
    if (detail) window.courseWithdrawalsUI.bind(root,{api,own:false,programmeId:detail.id,run:(work) => act(async () => {const notice = await work(); await loadDetail(detail.id); state.notice = notice;})});
    if (detail) window.registryDuplicatesUI.bind(root,state,{api,act,loadDetail,load});
    if (detail) window.registryLifecycleUI.bind(root,state,{api,act,loadDetail,load});
    if (detail) window.registryCreditsUI.bind(root,state,{api,act,loadDetail});
    if (detail) window.registryTransfersUI.bind(root,state,{api,act,loadDetail,load});
  }
  window.renderRegistry = async () => {
    syncSession();
    const { query } = route();
    // A search from the top bar arrives as #registry/students?q=...
    if (query.has("q")) { history.replaceState(null, "", "#registry/students"); state.filters = { ...(state.filters || {}), q: query.get("q"), offset: "0" }; state.detail = null; }
    if (!route().section && state.session) {
      await window.svuSession.me();
      const first = window.svuShell.visibleAreas()[0]?.id;
      if (first && /^#registry\/?$/.test(location.hash)) history.replaceState(null, "", `#registry/${first}`);
    }
    render();
    if (state.session) await act(() => load(state.filters));
  };
  // Repaint without reloading, e.g. when the signed-in profile arrives.
  window.registryUI = { repaint: () => {syncSession();render();} };
  window.svuSession.onChange(()=>{
    if(!/^#registry\/(?:cashbook|fleet)(?:\?|$)/.test(location.hash))return;
    syncSession();render();if(state.session && !state.busy)act(()=>load());
  });
  window.addEventListener('hashchange',()=>{if(!/^#registry\/cashbook(?:\?|$)/.test(location.hash))for(const key of Object.keys(state))if(key.startsWith('cashbook'))delete state[key];});
  window.addEventListener('hashchange',event=>{
    if(window.fleetUI.clearForRoute(state,event) && state.session && /^#registry\/fleet(?:\?|$)/.test(location.hash))state.fleetReload=true;
  });
})();
