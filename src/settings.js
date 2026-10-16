(function () {
  // Account settings for every signed-in person: profile, password, two-step verification and devices.
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const when = (value) => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
  const device = (agent) => {
    const text = String(agent || "");
    const browser = /Edg\//.test(text) ? "Edge" : /Firefox\//.test(text) ? "Firefox" : /Chrome\//.test(text) ? "Chrome" : /Safari\//.test(text) ? "Safari" : "Browser";
    const system = /Windows/.test(text) ? "Windows" : /Android/.test(text) ? "Android" : /iPhone|iPad/.test(text) ? "iOS" : /Mac OS/.test(text) ? "macOS" : /Linux/.test(text) ? "Linux" : "";
    return text ? `${browser}${system ? ` on ${system}` : ""}` : "Unknown device";
  };
  const state = { token: null, sessions: null, enrolment: null, recoveryCodes: null, notice: null, busy: false };

  async function call(method, path, body) {
    const session = window.svuSession.get();
    const response = await fetch(path, { method, headers: { Accept: "application/json", "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) window.svuSession.clear();
    if (!response.ok) throw new Error(payload.error?.message || "Request failed.");
    return payload.data;
  }

  function paint(app) {
    if (!location.hash.startsWith("#settings")) return;
    const me = window.svuSession.cached();
    if (!me) { app.innerHTML = `<p class="meta">Loading your settings…</p>`; return; }
    const notice = state.notice ? `<div class="notice ${state.notice.tone === "error" ? "notice-error" : "notice-success"}" role="status">${esc(state.notice.text)}</div>` : "";
    const roles = me.roles || [];
    const ui = window.svuUI;
    const profile = `<article class="ui-panel" data-settings-profile><h2 class="ui-section-title">Profile</h2>
          ${ui.facts([["Name", me.person.legalName], me.person.preferredName && me.person.preferredName !== me.person.legalName ? ["Preferred name", me.person.preferredName] : null, ["Email", me.account.email], ["Last sign-in", when(me.account.lastLoginAt)]])}
          <div class="ui-subsection"><h3>Roles</h3><div class="ui-toolbar">${roles.length ? roles.map((role) => `<span class="pill pill-neutral">${esc(ui.sentence(role.code))}${Object.keys(role.scope || {}).length ? ` (${esc(Object.values(role.scope).join(", "))})` : ""}</span>`).join(" ") : `<span class="ui-meta">None</span>`}</div></div>
          ${window.svuSession.can("registry.self") ? `<p class="meta">Contact details and next of kin are kept with your student record. <a href="#apply">Update them in your portal</a>.</p>` : ""}
          ${window.svuSession.can("admissions.apply") && !window.svuSession.can("registry.self") ? `<p class="meta">Applicant profile details are edited in <a href="#apply">your application</a>.</p>` : ""}
          <p class="meta">Name or email wrong? Ask the registry to correct it; changes to identity details are reviewed.</p>
        </article>`;
    app.innerHTML = `<section class="settings-page registry-workspace">
      <header class="section-header staff-page-head"><div><p class="eyebrow">Your account</p><h1 class="page-title">Settings</h1><p class="meta ui-page-description">Manage how you sign in and keep your account secure.</p></div></header>
      ${notice}
      <fieldset class="review-controls" ${state.busy ? "disabled" : ""}>
        <div class="ui-main-rail"><div class="ui-main">
        <article class="ui-panel" data-settings-password><h2 class="ui-section-title">Password</h2>
          <form class="form" data-settings-password-form>
            <label class="field"><span>Current password</span><input class="input" name="currentPassword" type="password" autocomplete="current-password" required></label>
            <label class="field"><span>New password</span><input class="input" name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label>
            <label class="field"><span>Confirm new password</span><input class="input" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></label>
            <p class="meta">At least 12 characters. Changing your password signs you out on your other devices.</p>
            <div><button class="button button-primary" type="submit">Change password</button></div>
          </form>
        </article>
        <article class="ui-panel" data-settings-mfa><h2 class="ui-section-title">Two-step verification</h2>
          ${me.mfa?.enrolled ? `<p><span class="pill pill-blue" data-mfa-status="on">On</span> An authenticator app is required when you sign in.</p><p class="meta">${me.mfa.recoveryCodesRemaining} recovery code${me.mfa.recoveryCodesRemaining === 1 ? "" : "s"} left. If you lose your authenticator, ask an administrator to reset it.</p>`
            : state.recoveryCodes ? `<p><strong>Two-step verification is on.</strong> Save these recovery codes now; they will not be shown again.</p><ul class="recovery-codes">${state.recoveryCodes.map((code) => `<li><code>${esc(code)}</code></li>`).join("")}</ul><button class="button button-secondary" type="button" data-settings-codes-done>I have saved them</button>`
            : state.enrolment ? `<form class="form" data-settings-mfa-confirm><p>Add this key to your authenticator app (for example Microsoft or Google Authenticator), then enter the 6-digit code it shows.</p><p class="secret-key" data-mfa-secret>${esc(state.enrolment.secret)}</p>
                <label class="field"><span>Authenticator code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
                <div class="hero-actions"><button class="button button-primary" type="submit">Turn on</button><button class="button button-secondary" type="button" data-settings-mfa-cancel>Cancel</button></div></form>`
            : `<p><span class="pill pill-neutral" data-mfa-status="off">Off</span> ${window.svuShell.isStaff() ? "Staff accounts should use two-step verification." : "Add a second step to protect your account."}</p><button class="button button-primary" type="button" data-settings-mfa-start>Set up authenticator app</button>`}
        </article>
        <article class="ui-panel" data-settings-sessions><h2 class="ui-section-title">Where you're signed in</h2>
          ${state.sessions ? `<ul class="ui-rows">${state.sessions.map((row) => `<li class="ui-row">${ui.ico("grid", row.current ? "blue" : "", "ui-icon-sm")}<div><strong>${esc(device(row.userAgent))}</strong><span class="meta">Signed in ${esc(when(row.createdAt))}</span></div>${row.current ? ` <span class="pill pill-blue">This device</span>` : ""}</li>`).join("")}</ul>` : `<p class="meta">Loading…</p>`}
          <div class="ui-actions">${state.sessions?.some((row) => !row.current) ? `<button class="button button-secondary" type="button" data-settings-revoke-others>Sign out other devices</button>` : ""}<button class="button button-secondary" type="button" data-settings-signout>Sign out</button></div>
        </article>
        <article class="ui-panel" data-settings-notifications></article>
        </div><aside class="ui-rail">${profile}</aside></div>
      </fieldset></section>`;
    bind(app);
  }

  function bind(app) {
    const run = async (work) => {
      if (state.busy) return;
      state.busy = true; state.notice = null; paint(app);
      try { const text = await work(); if (text) state.notice = { tone: "success", text }; } catch (error) { state.notice = { tone: "error", text: error.message }; }
      finally { state.busy = false; paint(app); }
    };
    app.querySelector("[data-settings-password-form]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      if (values.newPassword !== values.confirmPassword) { state.notice = { tone: "error", text: "The new passwords do not match." }; paint(app); return; }
      run(async () => {
        const result = await call("POST", "/api/identity/me/password", { currentPassword: values.currentPassword, newPassword: values.newPassword });
        state.sessions = await call("GET", "/api/identity/me/sessions");
        return `Password changed.${result.revokedSessions ? ` Signed out ${result.revokedSessions} other session${result.revokedSessions === 1 ? "" : "s"}.` : ""}`;
      });
    });
    app.querySelector("[data-settings-mfa-start]")?.addEventListener("click", () => run(async () => { state.enrolment = await call("POST", "/api/identity/mfa/totp"); }));
    app.querySelector("[data-settings-mfa-cancel]")?.addEventListener("click", () => { state.enrolment = null; paint(app); });
    app.querySelector("[data-settings-mfa-confirm]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      run(async () => {
        state.recoveryCodes = (await call("POST", "/api/identity/mfa/totp/confirm", { code: values.code })).recoveryCodes || [];
        state.enrolment = null;
        return "Two-step verification is on.";
      });
    });
    app.querySelector("[data-settings-codes-done]")?.addEventListener("click", () => run(async () => {
      state.recoveryCodes = null;
      // Reload the profile so the enrolled state comes from the server.
      await window.svuSession.refresh();
    }));
    app.querySelector("[data-settings-revoke-others]")?.addEventListener("click", () => run(async () => {
      const result = await call("DELETE", "/api/identity/me/sessions");
      state.sessions = await call("GET", "/api/identity/me/sessions");
      return `Signed out ${result.revokedSessions} other session${result.revokedSessions === 1 ? "" : "s"}.`;
    }));
    app.querySelector("[data-settings-signout]")?.addEventListener("click", () => window.svuShell.signOut());
  }

  async function render(app) {
    const session = window.svuSession.get();
    if (!session) { location.replace("#signin?next=settings"); return; }
    if (state.token !== session.token) Object.assign(state, { token: session.token, sessions: null, enrolment: null, recoveryCodes: null, notice: null });
    paint(app);
    await window.svuSession.me();
    paint(app);
    if (!state.sessions) {
      state.sessions = await call("GET", "/api/identity/me/sessions").catch(() => []);
      paint(app);
    }
  }
  window.settingsUI = { render };
})();
