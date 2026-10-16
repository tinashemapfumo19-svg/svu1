(function () {
  // System administration: service health, accounts and roles, invitations and the audit log.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const when = (value) => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
  const human = (value) => String(value ?? "").replaceAll("_", " ");
  const scopeText = (scope) => Object.keys(scope || {}).length ? Object.entries(scope).map(([key, list]) => `${human(key.replace(/([A-Z])/g, " $1").toLowerCase())}: ${[].concat(list).join(", ")}`).join("; ") : "All programmes";
  const initial = () => ({ token: null, tab: "accounts", health: null, accounts: null, filters: {}, selected: null, sessions: null, audit: null, auditFilters: {}, invitation: null, notice: null, busy: false });
  let state = initial();
  const current = owner => state === owner && owner.token === window.svuSession.get()?.token && location.hash.startsWith('#foundation');

  async function call(method, path, body) {
    const owner = state;
    const session = window.svuSession.get();
    const response = await fetch(path, { method, headers: { Accept: "application/json", "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!current(owner) || session?.token !== owner.token) throw new Error('This request belongs to a previous screen or session.');
    if (response.status === 401) window.svuSession.clear();
    if (response.status === 403) {
      state = { ...initial(), token: owner.token, tab: owner.tab, notice: { tone: 'error', text: payload.error?.message || 'Access refused.' } };
      paint(document.querySelector('#app'));
    }
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
    return payload.data ?? payload;
  }
  const tabs = () => [
    ["accounts", "Accounts and roles", "identity.manage"],
    ["invite", "Invite someone", "identity.invite"],
    ["audit", "Audit log", "audit.view"],
    ["health", "Service health", null],
    ["automations", "Automations", "notification.send"],
    ...window.systemOperationsUI.tabs
  ].filter(([, , permission]) => !permission || window.svuSession.can(permission));

  async function loadAccounts() { state.accounts = await call("GET", `/api/identity/accounts?${new URLSearchParams({ limit: "25", ...state.filters })}`); }
  async function loadSelected(id) {
    await loadAccounts();
    state.selected = state.accounts.items.find((row) => row.id === id) || (await call("GET", `/api/identity/accounts?${new URLSearchParams({ q: id, limit: "1" })}`)).items[0] || null;
    state.sessions = state.selected ? await call("GET", `/api/identity/accounts/${encodeURIComponent(state.selected.id)}/sessions`).catch(() => []) : null;
  }
  async function loadTab() {
    if (window.systemOperationsUI.tabs.some(([tab]) => tab === state.tab)) return window.systemOperationsUI.load(state, call);
    if (state.tab === "automations") state.automations = await call("GET", "/api/automations");
    if (state.tab === "health") state.health = await call("GET", "/api/health").catch((error) => ({ status: "unavailable", error: error.message }));
    if (state.tab === "accounts" && window.svuSession.can("identity.manage")) await loadAccounts();
    if (state.tab === "audit" && window.svuSession.can("audit.view")) state.audit = await call("GET", `/api/audit/events?${new URLSearchParams({ limit: "50", ...Object.fromEntries(Object.entries(state.auditFilters).filter(([, value]) => value)) })}`);
  }

  function accountsView() {
    const data = state.accounts;
    if (!data) return `<p class="meta">Loading accounts…</p>`;
    const me = window.svuSession.cached();
    const selected = state.selected;
    const own = selected?.id === me?.account?.id;
    const ui = window.svuUI;
    return `<section class="ui-panel"><form class="staff-filter" data-system-account-filter>
        <label class="field field-wide"><span>Name or email</span><input class="input" name="q" value="${esc(state.filters.q)}"></label>
        <label class="field"><span>Status</span><select class="input" name="status"><option value="">Any status</option>${["active", "invited", "suspended"].map((status) => `<option value="${status}" ${state.filters.status === status ? "selected" : ""}>${esc(ui.statusLabel(status))}</option>`).join("")}</select></label>
        <label class="field"><span>Role</span><select class="input" name="roleCode"><option value="">Any role</option>${data.roles.map((role) => `<option value="${esc(role.code)}" ${state.filters.roleCode === role.code ? "selected" : ""}>${esc(role.name)}</option>`).join("")}</select></label>
        <div><button class="button button-primary" type="submit">Search</button></div></form></section>
      <div class="registry-grid system-accounts ui-bare">
        <div class="review-sidebar">${ui.head("Accounts", { actions: `<p class="ui-meta" data-system-account-count>${data.total} account${data.total === 1 ? "" : "s"}</p>` })}<div class="ui-rows">${data.items.map((row) => `<button type="button" class="review-row ${row.id === selected?.id ? "is-selected" : ""}" data-system-account="${esc(row.id)}"><span class="ui-row-top"><strong>${esc(row.legalName)}</strong>${ui.status(row.status)}</span><span class="ui-meta">${esc(row.email)}${row.roles.length ? ` · ${esc(row.roles.map((role) => role.roleName).join(", "))}` : ""}</span></button>`).join("") || ui.emptyState({ glyph: "users", text: "No accounts match.", compact: true })}</div>
          <div class="staff-pager"><button class="icon-button" type="button" data-system-page="-1" aria-label="Previous page" title="Previous page" ${!data.offset ? "disabled" : ""}>&larr;</button><span class="ui-meta">Page ${Math.floor(data.offset / data.limit) + 1}</span><button class="icon-button" type="button" data-system-page="1" aria-label="Next page" title="Next page" ${data.offset + data.limit >= data.total ? "disabled" : ""}>&rarr;</button></div></div>
        <div class="review-detail" data-system-account-detail>${selected ? `<div class="staff-record-hero"><div><h2>${esc(selected.legalName)}</h2><p class="ui-meta">${esc(selected.email)}</p></div>${ui.status(selected.status)}</div>
          <dl class="detail-list"><div><dt>Status</dt><dd data-system-account-status>${esc(selected.status)}</dd></div><div><dt>Two-step</dt><dd>${selected.mfaEnrolled ? "Authenticator enrolled" : "Not set up"}</dd></div><div><dt>Last sign-in</dt><dd>${esc(when(selected.lastLoginAt))}</dd></div><div><dt>Account type</dt><dd>${esc((selected.personas || []).map(human).join(", ") || "None")}</dd></div></dl>
          ${own ? `<div class="notice">This is your account. Another administrator must change your roles, suspend you or reset your authenticator.</div>` : ""}
          <h3>Roles</h3>
          <ul class="plain-list" data-system-roles>${selected.roles.map((role) => `<li data-system-role="${esc(role.id)}"><strong>${esc(role.roleName)}</strong> <span class="pill ${["critical", "high"].includes(role.risk) ? "pill-warning" : "pill-neutral"}">${esc(role.risk)} risk</span><br><span class="meta">${esc(scopeText(role.scope))} · since ${esc(role.effectiveFrom)}</span>
            ${!own && window.svuSession.can("access.assign_role") ? `<form class="form inline-form" data-system-end-role="${esc(role.id)}"><label class="field"><span>Reason to end</span><input class="input" name="reason" maxlength="2000" required></label><button class="button button-secondary" type="submit">End role</button></form>` : ""}</li>`).join("") || `<li class="meta">No current roles.</li>`}</ul>
          ${!own && window.svuSession.can("access.assign_role") ? `<details><summary>Grant a role</summary><form class="form" data-system-grant-role>
            <label class="field"><span>Role</span><select class="input" name="roleCode" required>${data.roles.map((role) => `<option value="${esc(role.code)}">${esc(role.name)} (${esc(role.risk)} risk)</option>`).join("")}</select></label>
            <label class="field"><span>Programme codes (blank for all)</span><input class="input" name="programmeCodes" placeholder="BSC-IS, BCOM"></label>
            <label class="field"><span>Intake IDs (blank for all)</span><input class="input" name="intakeIds"></label>
            <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label>
            <button class="button button-primary" type="submit">Grant role</button></form></details>` : ""}
          ${!own ? `<h3>Account access</h3>
            <form class="form inline-form" data-system-status-form><label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label>
              <button class="button ${selected.status === "suspended" ? "button-primary" : "button-secondary"}" type="submit" data-system-status-action="${selected.status === "suspended" ? "reactivate" : "suspend"}">${selected.status === "suspended" ? "Reactivate account" : "Suspend account"}</button></form>
            ${selected.mfaEnrolled ? `<form class="form inline-form" data-system-mfa-reset><label class="field"><span>Identity check notes</span><input class="input" name="reason" maxlength="2000" required></label><button class="button button-secondary" type="submit">Reset authenticator</button></form>` : ""}` : ""}
          <h3>Sessions</h3>
          <ul class="plain-list">${(state.sessions || []).filter((row) => row.status !== "revoked").map((row) => `<li><strong>${esc(human(row.status))}</strong> · since ${esc(when(row.createdAt))}<br><span class="meta">${esc(row.userAgent || "Unknown device")}</span>
            ${!own ? `<button class="button button-secondary" type="button" data-system-revoke-session="${esc(row.id)}">End session</button>` : ""}</li>`).join("") || `<li class="meta">No open sessions.</li>`}</ul>` : ui.emptyState({ glyph: "user", title: "Select an account", text: "Choose an account to see its roles, access and sessions." })}</div>
      </div>`;
  }

  function inviteView() {
    const roles = state.accounts?.roles;
    return `<form class="form" data-system-invite>
        <p class="meta">The person receives an email with an activation code. They choose their own password.</p>
        <label class="field"><span>Email</span><input class="input" name="email" type="email" required></label>
        <label class="field"><span>Role</span>${roles ? `<select class="input" name="roleCode" required>${roles.map((role) => `<option value="${esc(role.code)}">${esc(role.name)}</option>`).join("")}</select>` : `<input class="input" name="roleCode" required placeholder="for example lecturer">`}</label>
        <label class="field"><span>Programme codes (blank for all)</span><input class="input" name="programmeCodes"></label>
        <label class="field"><span>Intake IDs (blank for all)</span><input class="input" name="intakeIds"></label>
        <button class="button button-primary" type="submit">Send invitation</button></form>
      ${state.invitation ? `<div class="notice notice-success" data-system-invitation>Invitation sent to ${esc(state.invitation.email)}. It expires ${esc(when(state.invitation.expiresAt))}.</div>` : ""}`;
  }

  function auditView() {
    const filters = state.auditFilters;
    return `<form class="form form-grid" data-system-audit-filter>
        <label class="field"><span>Action</span><input class="input" name="action" value="${esc(filters.action)}" placeholder="identity.password.changed"></label>
        <label class="field"><span>Actor account</span><input class="input" name="actorId" value="${esc(filters.actorId)}"></label>
        <label class="field"><span>Subject ID</span><input class="input" name="subjectId" value="${esc(filters.subjectId)}"></label>
        <label class="field"><span>From</span><input class="input" name="occurredFrom" type="date" value="${esc(filters.occurredFrom)}"></label>
        <div><button class="button button-primary" type="submit">Filter</button></div></form>
      <div class="result-table-wrap"><table class="result-table" data-system-audit><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Subject</th><th>Reason</th></tr></thead><tbody>
        ${(state.audit || []).map((row) => `<tr><td>${esc(when(row.occurredAt))}</td><td>${esc(row.action)}</td><td>${esc(row.actorId)}</td><td>${esc(row.subjectType)}<br><span class="meta">${esc(row.subjectId)}</span></td><td>${esc(row.reason)}</td></tr>`).join("") || `<tr><td colspan="5">${state.audit ? "No matching events." : "Loading…"}</td></tr>`}
      </tbody></table></div><p class="meta">Showing the latest 50 matching events.</p>`;
  }

  function healthView() {
    const health = state.health;
    if (!health) return `<p class="meta">Checking…</p>`;
    return `<dl class="detail-list" data-system-health><div><dt>Application</dt><dd>${esc(health.app || "South Valley University")} <span class="pill ${health.status === "ok" ? "pill-blue" : "pill-warning"}">${esc(health.status)}</span></dd></div>
      <div><dt>Environment</dt><dd>${esc(health.env || "unknown")}</dd></div><div><dt>Database</dt><dd>${esc(health.database?.status || "unavailable")}</dd></div><div><dt>Checked</dt><dd>${esc(when(health.checkedAt))}</dd></div></dl>
      <button class="button button-secondary" type="button" data-system-health-refresh>Check again</button>`;
  }

  const automationLabels = {
    deadline_reminders: ["Assignment deadline reminders", "48 and 24 hours before a deadline, to students who have not submitted."],
    missing_work: ["Missing-work alerts", "After a deadline, lecturers learn how many enrolled students did not submit."],
    offer_expiry: ["Offer expiry reminders", "7 and 2 days before an unanswered offer expires."],
    registration_ready: ["Registration ready", "Once a blocked course selection meets the registration checks."],
    fee_reminders: ["Fee reminders", "A week before a charge is due, and when a financial hold starts."],
    support_followups: ["Support follow-ups", "Cases waiting on a student for 3 days, or unanswered by staff for 5 days."],
    weekly_digest: ["Weekly staff digest", "Mondays: open tasks, unmarked submissions and assigned support cases."]
  };
  function automationsView() {
    const data = state.automations, ui = window.svuUI;
    if (!data) return `<p class="meta">Loading automations…</p>`;
    return `${ui.panel("Automated reminders", `<div class="ui-rows">${data.jobs.map((job) => ui.row({ glyph: "clock", tone: "blue", title: automationLabels[job]?.[0] || job, meta: esc(automationLabels[job]?.[1] || "") })).join("")}</div>
        <p class="ui-meta">The schedule runs every 15 minutes when <code>SVU_AUTOMATIONS=enabled</code>. Each reminder is sent once per person; running again does not repeat it.</p>`,
        { desc: "Messages go to the recipient's inbox, and by email when delivery is configured.", actions: `<button class="button button-primary" type="button" data-automations-run>Run now</button>` })}
      ${ui.panel("Recent runs", data.runs.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Started</th><th>Trigger</th><th>Messages</th><th>Status</th></tr></thead><tbody>${data.runs.map((run) => {
        const sent = Object.values(run.results || {}).reduce((sum, row) => sum + (row.sent || 0), 0);
        const errors = Object.entries(run.results || {}).filter(([, row]) => row.error).map(([job]) => automationLabels[job]?.[0] || job);
        return `<tr><td>${esc(when(run.startedAt))}</td><td>${esc(run.trigger === "manual" ? "Run now" : "Schedule")}</td><td>${sent}</td><td>${run.failed ? ui.badge(`Errors: ${errors.join(", ")}`, "red") : run.finishedAt ? ui.badge("Completed", "green") : ui.badge("Running", "blue")}</td></tr>`;
      }).join("")}</tbody></table></div>` : ui.emptyState({ glyph: "clock", text: "No automation runs yet.", compact: true }), { desc: data.last30Days.length ? `${data.last30Days.reduce((sum, row) => sum + row.count, 0)} messages in the last 30 days.` : "" })}`;
  }

  function paint(app) {
    if (!current(state)) return;
    const available = tabs();
    if (!available.some(([id]) => id === state.tab)) state.tab = available[0]?.[0] || "health";
    const views = { accounts: accountsView, invite: inviteView, audit: auditView, health: healthView, automations: automationsView };
    app.innerHTML = `<section class="system-page registry-workspace" aria-busy="${state.busy}"><header class="section-header staff-page-head"><div><p class="eyebrow">Administration</p><h1 class="page-title">System</h1><p class="ui-meta ui-page-description">Accounts, roles, invitations, audit, service health and shared reference data.</p></div><div class="ui-actions"><button class="icon-button" type="button" data-system-refresh aria-label="Refresh" title="Refresh" ${state.busy ? 'disabled' : ''}>&#8635;</button></div></header>
      <nav class="workspace-tabs" aria-label="System areas">${available.map(([id, label]) => `<a href="#foundation" data-system-tab="${id}" class="${id === state.tab ? "is-active" : ""}" ${id === state.tab ? 'aria-current="page"' : ""}>${esc(label)}</a>`).join("")}</nav>
      ${state.notice ? `<div class="notice ${state.notice.tone === "error" ? "notice-error" : "notice-success"}" role="status">${esc(state.notice.text)}</div>` : ""}
      <fieldset class="review-controls" ${state.busy ? "disabled" : ""}><div class="staff-body" data-system-body="${esc(state.tab)}">${views[state.tab] ? views[state.tab]() : window.systemOperationsUI.render(state)}</div></fieldset></section>`;
    window.svuUI.enhance(app);
    bind(app);
    const nav = app.querySelector('[aria-label="System areas"]'), active = nav?.querySelector('[aria-current="page"]');
    if (active) nav.scrollLeft = Math.max(0, nav.scrollLeft + active.getBoundingClientRect().left - nav.getBoundingClientRect().left - 12);
  }

  const scopeFrom = (values) => {
    const list = (text) => String(text || "").split(",").map((item) => item.trim()).filter(Boolean);
    const scope = {};
    if (list(values.programmeCodes).length) scope.programmeCodes = list(values.programmeCodes);
    if (list(values.intakeIds).length) scope.intakeIds = list(values.intakeIds);
    return scope;
  };
  function bind(app) {
    const run = async (work) => {
      if (state.busy) return;
      const owner = state;
      state.busy = true; state.notice = null; paint(app);
      try { const text = await work(); if (current(owner) && text) { state.notice = { tone: "success", text }; state.operationsDraft = null; } }
      catch (error) { if (current(owner)) state.notice = { tone: "error", text: error.message }; }
      finally { if (current(owner)) { state.busy = false; paint(app); } }
    };
    const values = (form) => Object.fromEntries(new FormData(form));
    app.querySelectorAll("[data-system-tab]").forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault(); if (state.busy) return; state.tab = link.dataset.systemTab; state.notice = null; state.operationsPage = 0; state.operationsDraft = null;
      run(async () => { if (state.tab === "invite" && !state.accounts && window.svuSession.can("identity.manage")) await loadAccounts(); await loadTab(); });
    }));
    app.querySelector("[data-system-account-filter]")?.addEventListener("submit", (event) => {
      event.preventDefault(); state.filters = Object.fromEntries(Object.entries(values(event.currentTarget)).filter(([, value]) => value)); state.selected = null; run(loadAccounts);
    });
    app.querySelectorAll("[data-system-page]").forEach((button) => button.addEventListener("click", () => {
      state.filters = { ...state.filters, offset: String(Math.max(0, (state.accounts.offset || 0) + Number(button.dataset.systemPage) * state.accounts.limit)) }; run(loadAccounts);
    }));
    app.querySelectorAll("[data-system-account]").forEach((button) => button.addEventListener("click", () => run(() => loadSelected(button.dataset.systemAccount))));
    app.querySelectorAll("[data-system-end-role]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault(); const reason = values(form).reason;
      run(async () => { await call("POST", `/api/access/role-assignments/${encodeURIComponent(form.dataset.systemEndRole)}/end`, { reason }); await loadSelected(state.selected.id); return "Role ended."; });
    }));
    app.querySelector("[data-system-grant-role]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const input = values(event.currentTarget);
      run(async () => { await call("POST", "/api/access/role-assignments", { accountId: state.selected.id, roleCode: input.roleCode, scope: scopeFrom(input), reason: input.reason }); await loadSelected(state.selected.id); return "Role granted."; });
    });
    app.querySelector("[data-system-status-form]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const reason = values(event.currentTarget).reason, action = event.currentTarget.querySelector("[data-system-status-action]").dataset.systemStatusAction;
      run(async () => { await call("POST", `/api/identity/accounts/${encodeURIComponent(state.selected.id)}/${action}`, { reason }); await loadSelected(state.selected.id); return action === "suspend" ? "Account suspended and signed out everywhere." : "Account reactivated."; });
    });
    app.querySelector("[data-system-mfa-reset]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const reason = values(event.currentTarget).reason;
      run(async () => { await call("POST", `/api/identity/accounts/${encodeURIComponent(state.selected.id)}/mfa/reset`, { reason }); await loadSelected(state.selected.id); return "Authenticator reset. The person must set it up again at next sign-in."; });
    });
    app.querySelectorAll("[data-system-revoke-session]").forEach((button) => button.addEventListener("click", () => run(async () => {
      await call("DELETE", `/api/identity/sessions/${encodeURIComponent(button.dataset.systemRevokeSession)}`); await loadSelected(state.selected.id); return "Session ended.";
    })));
    app.querySelector("[data-system-invite]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const input = values(event.currentTarget);
      run(async () => { state.invitation = await call("POST", "/api/identity/invitations", { email: input.email, roleCode: input.roleCode, scope: scopeFrom(input) }); return null; });
    });
    app.querySelector("[data-system-audit-filter]")?.addEventListener("submit", (event) => {
      event.preventDefault(); state.auditFilters = values(event.currentTarget); run(loadTab);
    });
    app.querySelector("[data-system-health-refresh]")?.addEventListener("click", () => run(loadTab));
    app.querySelector("[data-automations-run]")?.addEventListener("click", () => run(async () => {
      const result = await call("POST", "/api/automations/run"); await loadTab();
      const sent = Object.values(result.results).reduce((sum, row) => sum + (row.sent || 0), 0);
      return result.failed ? `Automations ran with errors; ${sent} messages sent.` : `Automations ran; ${sent} ${sent === 1 ? "message" : "messages"} sent.`;
    }));
    app.querySelector('[data-system-refresh]')?.addEventListener('click', () => run(loadTab));
    window.systemOperationsUI.bind(app, state, call, run, () => paint(app));
  }

  async function render(app) {
    const session = window.svuSession.get();
    if (!session) { location.replace("#signin?next=foundation"); return; }
    if (state.token !== session.token) state = { ...initial(), token: session.token };
    const owner = state;
    await window.svuSession.me();
    if (!current(owner)) return;
    if (!window.svuSession.canAny(['identity.manage', 'identity.invite', 'audit.view', 'foundation.view', ...window.systemOperationsUI.tabs.map(([, , permission]) => permission)])) { app.innerHTML = `<section class="empty-state"><h1 class="page-title">System</h1><p>Access is not available for your account.</p><a class="button button-primary" href="#home">Back to home</a></section>`; return; }
    paint(app);
    state.busy = true; paint(app);
    try { await loadTab(); } catch (error) { if (current(owner)) state.notice = { tone: "error", text: error.message }; }
    finally { if (current(owner)) { state.busy = false; paint(app); } }
  }
  window.svuSession.onChange(() => {
    state = initial();
    if (location.hash.startsWith('#foundation')) { const app = document.querySelector('#app'); app.replaceChildren(); render(app); }
  });
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#foundation')) state = initial(); });
  window.systemUI = { render };
})();
