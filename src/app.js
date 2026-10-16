const app = document.querySelector("#app");
let admissionsData = {
  catalogue: null,
  tasks: null,
  workflows: null,
  programmes: null,
  intakes: null,
  decisionReasons: null
};
const initialStaffReview = () => ({
  session: null,
  mfa: null,
  recoveryCodes: null,
  queue: null,
  selectedId: null,
  detail: null,
  manifest: null,
  filters: {},
  routes: [],
  notice: null,
  queueSearch: '',
  mobileDetail: false,
  busy: false
});
let staffReview = {...initialStaffReview(),session:window.svuSession.get()};
function clearStaffSessionState() {
  const busy = staffReview.busy;
  for (const field of Object.keys(staffReview)) delete staffReview[field];
  Object.assign(staffReview,initialStaffReview(),{busy});window.svuSession.clear();
}
function syncStaffSession() {
  const session = window.svuSession.get();
  if (session?.token === staffReview.session?.token) return;
  const busy = staffReview.busy;
  for (const field of Object.keys(staffReview)) delete staffReview[field];
  Object.assign(staffReview, initialStaffReview(), { busy, session });
}

const icons = window.svuIcons || {
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m8 15 3-4 3 2 4-7"/></svg>',
  message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2v-9a8 8 0 1 1 18-1Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 7.8 8 9 4.6-1.2 8-4 8-9V7Z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12 21 2"/><path d="m16 7 3 3"/><path d="m19 4 1 1"/></svg>',
  database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>'
};

async function loadLiveData() {
  if (location.protocol === "file:") {
    return;
  }

  const [catalogue, tasks, workflows, programmes, intakes, decisionReasons] = await Promise.allSettled([
    fetchJson("/api/admissions/catalogue"),
    Promise.resolve({ data: null }),
    Promise.resolve({ data: null }),
    fetchJson("/api/master-data/programmes"),
    fetchJson("/api/master-data/intakes"),
    fetchJson("/api/master-data/reference-lists/decision_reason")
  ]);

  admissionsData = {
    catalogue: fulfilledData(catalogue),
    tasks: fulfilledData(tasks),
    workflows: fulfilledData(workflows),
    programmes: fulfilledData(programmes),
    intakes: fulfilledData(intakes),
    decisionReasons: fulfilledData(decisionReasons)?.values || []
  };
  if ((location.hash || "").startsWith("#admissions")) renderAdmissions();
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}

function fulfilledData(result) {
  return result.status === "fulfilled" ? result.value.data : null;
}

function readStored(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  if (value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  } else {
    sessionStorage.removeItem(key);
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setActive(route) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
}

function formatDateTime(value) {
  if (!value) {
    return "Unscheduled";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) {
    return "Unscheduled";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function requestJson(method, path, body, token) {
  const sessionBound = Boolean(token && token === staffReview.session?.token);
  const response = await fetch(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (sessionBound && token !== staffReview.session?.token) throw new Error('The session changed. Reload the admissions workspace.');
  if (!response.ok) {
    if (response.status === 401 && sessionBound && !staffReview.mfa) clearStaffSessionState();
    const error = new Error(payload.error?.message || `Request failed (${response.status})`);error.status = response.status;throw error;
  }
  return payload.data ?? payload;
}

const admissionsTabs = [['applications', 'Applications'], ['enquiries', 'Enquiries'], ['communication', 'Communication'], ['guidance', 'Guidance'], ['reports', 'Reports'], ['setup', 'Setup']];
const admissionsTab = () => {
  const tab = location.hash.split('/')[1]?.split('?')[0];
  return admissionsTabs.some(([id]) => id === tab) ? tab : 'applications';
};

function renderAdmissions(options = {}) {
  syncStaffSession();
  const uiState = options.uiState || window.admissionsLayout.capture(app);
  const signInForm = app.querySelector('[data-form="staff-signin"]');
  // Background data refreshes must not replace a form while the user is typing.
  if (signInForm?.contains(document.activeElement) && !staffReview.busy) return;
  const signInDraft = signInForm ? Object.fromEntries(Array.from(signInForm.elements).filter((field) => field.name).map((field) => [field.name, field.value])) : null;
  const focusedField = signInForm?.contains(document.activeElement) ? document.activeElement.name : null;
  const catalogue = admissionsData.catalogue || [];
  const liveTasks = admissionsData.tasks || [];
  const liveWorkflows = admissionsData.workflows || [];
  const liveProgrammes = admissionsData.programmes || [];
  const liveIntakes = admissionsData.intakes || [];
  const queues = liveTasks.length > 0 ? buildLiveQueues(liveTasks) : [];
  const pilotWorkflow = liveWorkflows[0];
  const pilotProgramme = liveProgrammes[0];
  const pilotIntake = liveIntakes[0];

  const catalogueBand = `<details class="admissions-catalogue" ${staffReview.session ? "" : "open"}>
        <summary>Programme catalogue (${catalogue.length})</summary>
        <div class="ui-section">
        ${window.svuUI.head("Open intakes", { desc: "Programmes and intakes applicants can choose from.", actions: `<a class="button button-secondary" href="#apply">Open Apply ${icons.arrow}</a>` })}
        <div class="ui-course-grid admissions-catalogue-grid">
          ${catalogue.map((entry, index) => `
            <article class="catalogue-card ui-course ${["", "tint-green", "tint-lavender"][index % 3]}">
              <div class="ui-course-top"><span class="ui-course-code">${esc(entry.programmeCode)}</span>${window.svuUI.badge(entry.applicationsOpen ? "Open" : "Closed", entry.applicationsOpen ? "green" : "")}</div>
              <h3 class="ui-card-title">${esc(entry.programmeName)}</h3>
              <p class="ui-meta">${esc(entry.label)} · starts ${esc(formatDate(entry.startsOn))}</p>
              <p class="ui-meta">${esc(entry.department)} · ${esc(entry.faculty)}</p>
            </article>
          `).join("") || window.svuUI.emptyState({ glyph: "cap", text: "The programme catalogue is not loaded yet.", compact: true })}
        </div>
        </div>
      </details>`;

  app.innerHTML = `
    <section class="registry-workspace admissions-page">
    <header class="section-header staff-page-head">
      <div>
        <p class="eyebrow">Staff workspace</p>
        <h1 class="page-title">Admissions</h1>
        <p class="ui-meta ui-page-description">Review applications, record decisions and manage applicant communication.</p>
      </div>
      <div class="ui-actions"><a class="button button-secondary" href="#registry">Student registry</a><a class="button button-secondary" href="#apply">Applicant portal ${icons.arrow}</a>${staffReview.session ? `<button class="button button-secondary" type="button" data-staff-signout ${staffReview.busy ? 'disabled' : ''}>Sign out</button>` : ""}</div>
    </header>

    ${staffReview.session ? `<dl class="ui-stats admissions-summary"><div><dt>Queue items</dt><dd>${staffReview.queue?.length ?? '-'}</dd></div><div><dt>Places remaining</dt><dd>${staffReview.manifest?.placesRemaining ?? '-'}</dd></div><div><dt>Accepted</dt><dd>${staffReview.manifest?.accepted?.length ?? '-'}</dd></div></dl><nav class="workspace-tabs admissions-tabs" aria-label="Admissions">${admissionsTabs.map(([id, label]) => `<a href="#admissions/${id}" data-admissions-tab="${id}" ${admissionsTab() === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : ''}

    <section class="admissions-workspace staff-body">
      ${staffReview.session ? "" : catalogueBand}
      <section class="admissions-review ui-bare">
        <fieldset class="review-controls ui-bands" ${staffReview.busy ? "disabled" : ""}>${renderStaffReview()}</fieldset>
      </section>
      ${staffReview.session ? `<section class="admissions-setup-band ui-bare" data-admissions-panel="setup" ${admissionsTab() === 'setup' ? '' : 'hidden'}>${catalogueBand}</section>` : ""}

      ${!staffReview.session && queues.length ? `<article class="span-12">
        <div class="section-header">
          <div>
            <h2>Application Workflow</h2>
            <p>${pilotWorkflow ? `Live pilot application ${pilotWorkflow.subjectId} is in ${pilotWorkflow.state}.` : "Draft to student onboarding, with explicit exceptions."}</p>
          </div>
          <span class="pill pill-blue">${pilotProgramme?.code || "Pilot intake"}</span>
        </div>
        <div class="timeline">
          ${["Draft", "Submitted", "Payment verified", "Completeness review", "Academic review", "Decision", "Offer issued", "Accepted or closed"].map((step, index) => `
            <div class="timeline-step ${pilotWorkflow?.state === step ? "is-current" : ""}">
              <span class="step-mark">${index + 1}</span>
              <strong>${step}</strong>
              <span class="meta">ADM-${String(index + 1).padStart(2, "0")}</span>
            </div>
          `).join("")}
        </div>
      </article>

      <section class="span-12">
        <div class="section-header">
          <div>
            <h2>Staff Work Queues</h2>
            <p>Ownership and next action are visible before legacy writes are retired.</p>
          </div>
          <span class="pill pill-blue">${pilotIntake?.label || "Live queue"}</span>
        </div>
        <div class="kanban">
          ${queues.map((queue) => `
            <div class="queue-column">
              <h3>${queue.title}</h3>
              ${queue.items.map((item) => `
                <article class="queue-card">
                  <strong>${item.name || item.title}</strong>
                  <span class="meta">${item.programme}</span>
                  <div>
                    <span class="pill pill-neutral">${item.age}</span>
                    <span class="pill pill-blue">${item.status}</span>
                  </div>
                </article>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </section>` : ""}
    </section>
    </section>
  `;
  window.svuUI.enhance(app);
  bindAdmissions();
  window.admissionsLayout.restore(app, uiState, options);
  const restoredForm = app.querySelector('[data-form="staff-signin"]');
  if (signInDraft && restoredForm) {
    for (const name of ["email", "password"]) restoredForm.elements.namedItem(name).value = signInDraft[name] || "";
    if (focusedField && !staffReview.busy) restoredForm.elements.namedItem(focusedField)?.focus({ preventScroll: true });
  }
}

function renderStaffReview() {
  const notice = staffReview.notice
    ? `<div class="notice ${staffReview.notice.tone === "error" ? "notice-error" : "notice-success"}" role="status">${esc(staffReview.notice.text)}</div>`
    : "";

  if (!staffReview.session) {
    if (staffReview.mfa) {
      return `
        ${notice}
        <form class="form ui-panel" data-form="staff-mfa">
          ${staffReview.mfa.mode === "enrol" ? `
            <div class="notice notice-warning">
              <strong>MFA enrolment required</strong>
              <p class="meta">Add this TOTP secret to an authenticator app, then enter the current code.</p>
              <p class="meta">${esc(staffReview.mfa.secret)}</p>
            </div>
          ` : `
            <div class="notice notice-warning">
              <strong>MFA verification required</strong>
              <p class="meta">Enter an authenticator code or a recovery code to finish sign-in.</p>
            </div>
          `}
          <label class="field"><span>Authenticator code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
          <label class="field"><span>Recovery code</span><input class="input" name="recoveryCode" autocomplete="one-time-code"></label>
          <div class="hero-actions">
            <button class="button button-primary" type="submit">Continue</button>
            <button class="button button-secondary" type="button" data-staff-cancel-mfa>Cancel</button>
          </div>
        </form>
      `;
    }

    return `
      ${notice}
      <div class="ui-panel staff-signin-panel">${window.svuUI.head("Application review", { desc: "Sign in with your staff account to review applications." })}
      <form class="form" data-form="staff-signin">
        <label class="field"><span>Email or username</span><input class="input" name="email" type="text" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" required></label>
        <div><button class="button button-primary" type="submit">Sign in</button></div>
      </form></div>
    `;
  }

  return `
    ${notice}
    ${staffReview.recoveryCodes?.length ? `
      <div class="notice notice-warning">
        <strong>Recovery codes</strong>
        <p class="meta">${staffReview.recoveryCodes.map(esc).join(" ")}</p>
      </div>
    ` : ""}
    <div class="ui-bands ui-bare admissions-bands">
    <section class="ui-bare" data-admissions-panel="applications" ${admissionsTab() === 'applications' ? '' : 'hidden'}>
    ${staffReview.reviewUnavailable ? window.svuUI.emptyState({ glyph: 'lock', title: 'Application review is unavailable for this account', compact: true }) : `<div class="staff-workspace ui-workbench admissions-workbench ${staffReview.mobileDetail ? 'is-detail-view' : ''}"><aside class="review-queue ui-workbench-list" aria-label="Application queue">
    <div class="admissions-queue-head"><h2 class="ui-section-title">Applications</h2><button class="icon-button" type="button" data-load-review aria-label="Refresh queue" title="Refresh queue">${window.svuUI.glyph('refresh')}</button></div>
    <label class="admissions-queue-search"><span class="visually-hidden">Search this queue</span>${window.svuUI.glyph('search')}<input class="input" type="search" data-review-search value="${esc(staffReview.queueSearch)}" placeholder="Name or reference"></label>
    <details class="admissions-queue-filters"><summary>Filters</summary>
    <form class="staff-filter" data-form="review-filters">
      <label class="field"><span>Review route</span><select class="input" name="reviewRoute"><option value="">All routes</option>${(staffReview.routes || []).map((route) => `<option value="${esc(route.code)}" ${staffReview.filters?.reviewRoute === route.code ? "selected" : ""}>${esc(route.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Assignment</span><select class="input" name="assigned"><option value="">All reviewers</option><option value="me" ${staffReview.filters?.assigned === "me" ? "selected" : ""}>Assigned to me</option><option value="unassigned" ${staffReview.filters?.assigned === "unassigned" ? "selected" : ""}>Unassigned</option></select></label>
      <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All intakes</option>${(admissionsData.intakes || []).map((intake) => `<option value="${esc(intake.id)}" ${staffReview.filters?.intakeId === intake.id ? "selected" : ""}>${esc(intake.label)}</option>`).join("")}</select></label>
      <label class="field"><span>State</span><input class="input" name="state" value="${esc(staffReview.filters?.state || "")}" list="admissions-states"></label>
      <datalist id="admissions-states">${["Submitted", "Completeness review", "Academic review", "Faculty review", "Decision", "Offer issued", "Rejected", "Deferred", "Accepted", "Declined", "Withdrawn", "Expired"].map((state) => `<option value="${state}">`).join("")}</datalist>
      <label class="check-inline"><input type="checkbox" name="includeClosed" ${staffReview.filters?.includeClosed === "true" ? "checked" : ""}> Include completed applications</label>
      <button class="button button-secondary" type="submit">Filter queue</button>
    </form>
    </details>
    <div class="ui-rows admissions-queue-list" tabindex="0" aria-label="Applications in this queue" data-review-list>
      ${(staffReview.queue || []).map((item) => `
        <button type="button" data-review-detail="${esc(item.id)}" data-review-search-text="${esc(`${item.applicantName || ''} ${item.referenceNumber || item.id} ${item.programmeCode || ''}`.toLowerCase())}" class="row-item queue-row ${staffReview.detail?.id === item.id ? "is-selected" : ""}" aria-pressed="${staffReview.detail?.id === item.id}" aria-label="Open ${esc(item.applicantName || item.referenceNumber || 'application')}, waiting ${esc(item.daysWaiting ?? 0)} days">
          ${window.svuUI.ico(item.possibleDuplicates ? "alert" : "file", item.possibleDuplicates ? "amber" : "blue", "ui-icon-sm")}
          <div>
            <strong>${esc(item.applicantName || item.referenceNumber || item.id)}</strong>
            <span class="ui-meta">${esc(item.referenceNumber || item.id)} · ${esc(item.programmeCode || "Application")}</span><span class="ui-meta">${esc(item.workflowState || item.state || "In review")}${item.possibleDuplicates ? " · possible duplicate" : ""}</span>
          </div>
          <span class="admissions-queue-age">${esc(item.daysWaiting ?? 0)}d</span>
        </button>
      `).join("") || window.svuUI.emptyState({ glyph: "inbox", text: staffReview.queue ? "No applications match these filters." : "No queue loaded yet.", compact: true })}
    </div>
    <p class="ui-meta" data-review-search-empty hidden>No matching applications in this queue.</p>
      <div class="staff-pager">
        <button class="icon-button" type="button" data-review-page="-1" ${Number(staffReview.filters?.offset || 0) === 0 ? "disabled" : ""} aria-label="Previous queue page" title="Previous queue page">${window.svuUI.glyph('arrowLeft')}</button>
        <span class="ui-meta">Page ${Math.floor(Number(staffReview.filters?.offset || 0) / 50) + 1}</span>
        <button class="icon-button" type="button" data-review-page="1" ${(staffReview.queue || []).length < 50 ? "disabled" : ""} aria-label="Next queue page" title="Next queue page">${window.svuUI.glyph('arrowRight')}</button>
      </div>
    </aside><section class="review-application ui-workbench-detail" tabindex="-1" aria-label="Selected application"><button class="button button-secondary admissions-back" type="button" data-review-back>${window.svuUI.glyph('arrowLeft')}<span>Back to applications</span></button>
    ${staffReview.detail ? renderReviewDetail(staffReview.detail) : window.svuUI.emptyState({ glyph: "admissions", title: "Select an application", text: "Choose an application from the queue to see its checklist, documents, review stage and decision." })}
    </section></div>`}
    </section>
    <section class="ui-bare" data-admissions-panel="communication" ${admissionsTab() === 'communication' ? '' : 'hidden'}>
    <form class="form admissions-bulk-message" data-form="review-message"><h2 class="ui-section-title">Message applicants</h2>
      <label class="field"><span>Applicant message</span><textarea class="input" name="message" required maxlength="5000" rows="3"></textarea></label>
      <label class="field"><span>Recipients</span><select class="input" name="recipients"><option value="selected">Selected application</option><option value="queue">All applications in this queue</option></select></label>
      <div><button class="button button-primary" type="submit">Send message</button></div>
    </form>
    ${window.applicantCommunicationsUI.staffView(staffReview)}
    </section>
    <section class="ui-bare" data-admissions-panel="guidance" ${admissionsTab() === 'guidance' ? '' : 'hidden'}>
    ${window.admissionsGuidanceUI.staffView(staffReview)}
    </section>
    <section class="ui-bare" data-admissions-panel="enquiries" ${admissionsTab() === 'enquiries' ? '' : 'hidden'}>
    ${window.prospectiveEnquiriesUI.staffView(staffReview)}
    </section>
    <section class="ui-bare" data-admissions-panel="reports" ${admissionsTab() === 'reports' ? '' : 'hidden'}>
    ${window.admissionsReportingUI.render(staffReview)}
    ${window.enquiryReportingUI.render(staffReview)}
    ${window.communicationReportingUI.render(staffReview)}
    ${window.reportEditionsUI.render(staffReview)}
    ${window.reportSchedulesUI.render(staffReview)}
    </section>
    <section class="ui-bare" data-admissions-panel="setup" ${admissionsTab() === 'setup' ? '' : 'hidden'}>
      <div class="ui-toolbar"><button class="button button-secondary" type="button" data-load-manifest>Load manifest</button><button class="button button-secondary" type="button" data-expire-offers>Expire stale offers</button></div>
      ${renderReviewRouteConfiguration(staffReview.detail)}
    </section>
    </div>
  `;
}

function renderReviewDetail(detail) {
  const decisionReasons = admissionsData.decisionReasons || [];
  const canDecide = detail.workflowState === "Decision" && detail.capabilities?.["admissions.decide"];
  const canConvert = detail.workflowState === "Accepted" && detail.capabilities?.["admissions.decide"];
  const latestNotes = (detail.notes || []).slice(-3).reverse();
  const reviewSteps = detail.allowedTransitions.filter((step) => !["Withdrawn", "Deferred", "Offer issued", "Rejected", "Accepted", "Declined", "Expired", "Information requested"].includes(step));

  return `
    <div class="review-detail" data-application-id="${esc(detail.id)}">
      <div class="section-header staff-record-hero">
        <div>
          <p class="ui-eyebrow">${esc(detail.programmeCode)}</p>
          <h2 class="ui-section-title">${esc(detail.applicant?.legalName || "Applicant")}</h2>
          <p class="meta">${esc(detail.referenceNumber || detail.id)} · ${esc(detail.workflowState || detail.status)}</p>
        </div>
        <span class="pill pill-blue">${esc(detail.workflowState || detail.status)}</span>
      </div>
      <nav class="admissions-record-nav" aria-label="Application sections">${[['overview','Overview'],['documents','Documents'],['review','Review'],['history','History']].map(([id,label]) => `<button type="button" data-review-jump="${id}">${label}</button>`).join('')}</nav>
      <dl class="ui-stats readiness-grid" data-review-section="overview">
        <div><dt>Checklist</dt><dd>${detail.checklist.filter((item) => item.satisfied).length} / ${detail.checklist.length}</dd></div>
        <div><dt>Possible duplicates</dt><dd>${detail.possibleDuplicates.length}</dd></div>
        <div><dt>Application fee</dt><dd class="ui-card-title">${detail.fee ? `${esc(titleCase(detail.fee.status))} via ${esc(titleCase(detail.fee.method))}` : "Not recorded"}</dd></div>
      </dl>
      <div class="ui-subsection" data-review-section="documents"><h3>Checklist and documents</h3>
      <div class="evidence-grid ui-rows">
        ${detail.checklist.map((item) => evidenceItem(item.documentType, `${item.status} · ${item.documents.length} file(s)`, item.satisfied ? "passed" : "pending")).join("")}
      </div>
      ${detail.checklist.flatMap((item) => item.documents).map((document) => `
        <div class="row-item ui-row">${window.svuUI.ico("file", "blue", "ui-icon-sm")}<div><strong>${esc(document.fileName)}</strong><span class="ui-meta">${esc(document.lifecycle)}</span></div>
          ${["available", "verified"].includes(document.lifecycle) && detail.capabilities?.["document.create"] ? `<button class="button button-soft" type="button" data-document-download="${esc(document.id)}">View file</button>` : ""}
        </div>
        ${document.lifecycle === "available" && detail.capabilities?.["document.review"] ? `<form class="form form-grid" data-document-review="${esc(document.id)}">
          <label class="field"><span>Document decision</span><select class="input" name="decision"><option value="verified">Verify</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Reason</span><input class="input" name="reason" required maxlength="500"></label>
          <button class="button button-secondary" type="submit">Record document review</button>
        </form>` : ""}
      `).join("")}
      </div>
      <div class="ui-subsection" data-review-section="review"><h3>Review stage</h3>
      <div class="ui-toolbar" aria-label="Allowed next steps">
        ${detail.allowedTransitions.map((step) => `<span class="pill pill-neutral">${esc(step)}</span>`).join("") || `<span class="pill pill-neutral">No transitions</span>`}
      </div>
      ${reviewSteps.length ? `
        <form class="form" data-form="review-transition">
          <label class="field"><span>Next review stage</span>
            <select class="input" name="toState" required>${reviewSteps.map((step) => `<option value="${esc(step)}">${esc(step)}</option>`).join("")}</select>
          </label>
          <label class="field"><span>Review reason</span><input class="input" name="reason" required maxlength="500"></label>
          <div><button class="button button-secondary" type="submit">Advance review</button></div>
        </form>` : ""}
      </div>
      ${canDecide ? `<form class="form decision-panel ui-subsection" data-form="review-decision"><h3>Decision</h3>
        <div class="form-grid">
          <label class="field"><span>Decision</span>
            <select class="input" name="decision" required ${canDecide ? "" : "disabled"}>
              <option value="offer">Offer</option>
              <option value="reject">Reject</option>
              <option value="defer">Defer</option>
            </select>
          </label>
          <label class="field"><span>Reject reason</span>
            <select class="input" name="reasonCode" ${canDecide ? "" : "disabled"}>
              <option value="">Only needed for rejection</option>
              ${decisionReasons.map((reason) => `<option value="${esc(reason.valueCode)}">${esc(reason.label)}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Offer days</span><input class="input" name="offerExpiresInDays" type="number" min="1" max="90" value="21" ${canDecide ? "" : "disabled"}></label>
          <label class="field"><span>Deferral intake</span><select class="input" name="targetIntakeId" ${canDecide ? "" : "disabled"}><option value="">Only needed for deferral</option>${(admissionsData.catalogue || []).filter((intake) => intake.programmeCode === detail.programmeCode && intake.startsOn > detail.startsOn).map((intake) => `<option value="${esc(intake.intakeId)}">${esc(intake.label)}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Conditions</span><textarea class="input" name="conditions" rows="3" maxlength="1200" placeholder="One condition per line" ${canDecide ? "" : "disabled"}></textarea></label>
        <label class="field"><span>Decision note</span><textarea class="input" name="note" rows="2" maxlength="500" ${canDecide ? "" : "disabled"}></textarea></label>
        <div class="hero-actions">
          <button class="button button-primary" type="submit" ${canDecide ? "" : "disabled"}>Record decision</button>
        </div>
      </form>` : ""}
      ${canConvert ? `<div><button class="button button-primary" type="button" data-review-convert>Convert accepted offer</button></div>` : ""}
      <div class="ui-subsection"><h3>Notes and ownership</h3>
      <div class="row-list tight-list ui-rows">
        ${latestNotes.map((note) => `
          <div class="row-item ui-row">
            ${window.svuUI.ico("list", "blue", "ui-icon-sm")}
            <div>
              <strong>${esc(titleCase(note.category))}</strong>
              <span class="ui-meta">${esc(note.body)}</span>
            </div>
          </div>
        `).join("") || `<p class="meta">No review notes yet.</p>`}
      </div>
      <form class="form" data-form="review-note">
        <label class="field"><span>Review note</span><textarea class="input" name="body" rows="3" maxlength="5000" required></textarea></label>
        <label class="field"><span>Category</span><select class="input" name="category"><option value="general">General</option><option value="completeness">Completeness</option><option value="academic">Academic assessment</option></select></label>
        <button class="button button-secondary" type="submit">Add note</button>
      </form>
      <div class="hero-actions">
        <button class="button button-soft" type="button" data-review-assign>Assign to me</button>
        <button class="button button-secondary" type="button" data-review-info>Request information</button>
      </div>
      <form class="form form-grid" data-form="review-handoff">
        <label class="field"><span>Reviewer</span><select class="input" name="assigneeAccountId" required>${(detail.reviewers || []).map((reviewer) => `<option value="${esc(reviewer.accountId)}" ${detail.ownerAccountId === reviewer.accountId ? "selected" : ""}>${esc(reviewer.name)} (${esc(reviewer.roles.map(titleCase).join(", "))})</option>`).join("")}</select></label>
        <label class="field"><span>Handoff reason</span><input class="input" name="reason" required maxlength="500"></label><button class="button button-secondary" type="submit">Assign reviewer</button>
      </form>
      <form class="form" data-form="review-information">
        <label class="field"><span>Information needed</span><textarea class="input" name="message" required maxlength="5000" rows="3"></textarea></label>
        <div><button class="button button-secondary" type="submit" ${detail.allowedTransitions.includes("Information requested") ? "" : "disabled"}>Send information request</button></div>
      </form>
      </div>
      ${detail.capabilities?.["admissions.decide"] ? `
        ${detail.allowedTransitions.includes("Withdrawn") ? `<form class="form" data-form="review-withdraw"><label class="field"><span>Withdrawal reason</span><input class="input" name="reason" required maxlength="1000"></label><button class="button button-secondary" type="submit">Withdraw application</button></form>` : ""}
        ${(detail.requests || []).filter((request) => request.status === "pending").map((request) => `<form class="form" data-form="review-deferral">
          <h3>Deferral request</h3><p>${esc(request.reason)} - ${esc(request.targetIntakeLabel)}</p>
          <input type="hidden" name="requestId" value="${esc(request.id)}">
          <label class="field"><span>Decision</span><select class="input" name="decision"><option value="approve">Approve deferral</option><option value="reject">Reject request</option></select></label>
          <label class="field"><span>Reason</span><input class="input" name="reason" required maxlength="1000"></label>
          <button class="button button-secondary" type="submit">Record deferral decision</button>
        </form>`).join("")}
        ${["Rejected", "Declined", "Deferred", "Withdrawn", "Expired"].includes(detail.workflowState) ? `<form class="form" data-form="review-reopen">
          <label class="field"><span>Reopen reason</span><input class="input" name="reason" required maxlength="1000"></label><button class="button button-secondary" type="submit">Reopen application</button>
        </form>` : ""}` : ""}
      <details data-review-section="history"><summary>Application history</summary><ul class="ui-rows">${(detail.history || []).map((entry) => `<li class="ui-row">${window.svuUI.ico("history", "blue", "ui-icon-sm")}<div><strong>${esc(entry.state)}</strong><span class="ui-meta">${esc(entry.reason)} · ${esc(formatDateTime(entry.occurredAt))}</span></div></li>`).join("")}</ul></details>
    </div>
  `;
}

function renderReviewRouteConfiguration(detail) {
  return detail?.capabilities?.['admissions.configure'] ? `<section class="admissions-route-configuration"><h2 class="ui-section-title">Review route configuration</h2>
        <form class="form" data-form="review-route">
          <label class="field"><span>Route</span><select class="input" name="route">${(staffReview.routes || []).map((route) => `<option value="${route.code}">${esc(route.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Academic stages</span><textarea class="input" name="academicStages" required rows="3">Academic review</textarea></label>
          <label class="field"><span>Programme</span><select class="input" name="programmeId"><option value="">Keep programme mappings</option>${(admissionsData.programmes || []).map((programme) => `<option value="${esc(programme.id)}">${esc(programme.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Reason</span><input class="input" name="reason" required></label><button class="button button-secondary" type="submit">Save route version</button>
        </form></section>` : '<p class="ui-meta">Select an application with configuration access to manage its review route.</p>';
}

function bindAdmissions() {
  window.admissionsLayout.bind(app, staffReview);
  if (staffReview.session) window.applicantCommunicationsUI.staffBind(app,staffReview,{api:(method,path,body) => requestJson(method,path,body,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.admissionsGuidanceUI.staffBind(app,staffReview,{api:(method,path,body) => requestJson(method,path,body,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.prospectiveEnquiriesUI.staffBind(app,staffReview,{api:(method,path,body) => requestJson(method,path,body,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.admissionsReportingUI.bind(app,staffReview,{api:(method,path) => requestJson(method,path,undefined,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.enquiryReportingUI.bind(app,staffReview,{api:(method,path) => requestJson(method,path,undefined,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.communicationReportingUI.bind(app,staffReview,{api:(method,path) => requestJson(method,path,undefined,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.reportEditionsUI.bind(app,staffReview,{api:(method,path,body) => requestJson(method,path,body,staffReview.session?.token),act:runStaffAction});
  if (staffReview.session) window.reportSchedulesUI.bind(app,staffReview,{api:(method,path,body) => requestJson(method,path,body,staffReview.session?.token),act:runStaffAction});
  app.querySelectorAll("[data-review-page]").forEach((button) => button.addEventListener("click", () => {
    staffReview.filters ||= {};
    staffReview.filters.offset = String(Math.max(0, Number(staffReview.filters.offset || 0) + Number(button.dataset.reviewPage) * 50));
    staffReview.selectedId = null;
    staffReview.detail = null;
    runStaffAction(loadStaffQueue);
  }));
  app.querySelector('[data-form="review-filters"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    staffReview.filters = Object.fromEntries(new FormData(event.currentTarget));
    staffReview.filters.includeClosed = staffReview.filters.includeClosed ? "true" : "false";
    staffReview.selectedId = null;
    staffReview.detail = null;
    runStaffAction(loadStaffQueue);
  });
  for (const name of ["review-deferral", "review-reopen", "review-withdraw", "review-handoff", "review-message", "review-information", "review-route"]) {
    app.querySelectorAll(`[data-form="${name}"]`).forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      runStaffAction(async () => {
        let path = `/api/admissions/review/applications/${staffReview.selectedId}`;
        let body = values;
        let method = "POST";
        if (name === "review-message") {
          path = "/api/admissions/review/messages";
          body = { message: values.message, applicationIds: values.recipients === "queue" ? (staffReview.queue || []).map((item) => item.id) : [staffReview.selectedId] };
        } else if (name === "review-route") {
          path = `/api/admissions/routes/${values.route}`;
          method = "PUT";
          body = { reason: values.reason, academicStages: values.academicStages.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), ...(values.programmeId ? { programmeIds: [values.programmeId] } : {}) };
        } else path += `/${name === "review-information" ? "request-information" : name === "review-handoff" ? "assign" : name.replace("review-", "")}`;
        await requestJson(method, path, body, staffReview.session.token);
        await loadStaffQueue();
        staffReview.notice = { tone: "success", text: name === "review-message" ? "Message sent." : name === "review-route" ? "Review route saved." : "Application updated." };
      });
    }));
  }
  app.querySelectorAll("[data-document-review]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    runStaffAction(async () => {
      await requestJson("POST", `/api/documents/${form.dataset.documentReview}/reviews`, body, staffReview.session.token);
      await loadReviewDetail(staffReview.selectedId);
      staffReview.notice = { tone: "success", text: "Document review recorded." };
    });
  }));
  app.querySelectorAll("[data-document-download]").forEach((button) => button.addEventListener("click", () => runStaffAction(async () => {
    const result = await requestJson("POST", `/api/documents/${button.dataset.documentDownload}/download-requests`, { reason: "Admissions evidence review" }, staffReview.session.token);
    window.open(result.url, "_blank", "noopener,noreferrer");
  })));
  app.querySelector("[data-form='review-transition']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    runStaffAction(async () => {
      if (!staffReview.detail?.workflowInstanceId) return;
      await requestJson("POST", `/api/workflows/instances/${staffReview.detail.workflowInstanceId}/transitions`, values, staffReview.session?.token);
      await loadStaffQueue();
      await loadReviewDetail(staffReview.selectedId);
      staffReview.notice = { tone: "success", text: `Review advanced to ${values.toState}.` };
    });
  });
  app.querySelector("[data-form='staff-signin']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    runStaffAction(async () => {
      const session = await requestJson("POST", "/api/identity/sessions", values, null);
      if (session.status === "mfa_pending") {
        staffReview.mfa = { mode: "verify", token: session.token, sessionId: session.id };
        staffReview.notice = { tone: "success", text: "Enter your second factor to finish sign-in." };
        return;
      }
      if (session.status === "mfa_enrolment_required") {
        const enrolment = await requestJson("POST", "/api/identity/mfa/totp", {}, session.token);
        staffReview.mfa = {
          mode: "enrol",
          token: session.token,
          sessionId: session.id,
          secret: enrolment.secret,
          otpauthUri: enrolment.otpauthUri
        };
        staffReview.notice = { tone: "success", text: "MFA setup started." };
        return;
      }
      if (session.status !== "active") {
        throw new Error("Sign-in is not active yet.");
      }
      staffReview.session = { token: session.token, sessionId: session.id };
      staffReview.mfa = null;
      window.svuSession.set(staffReview.session);
      staffReview.notice = { tone: "success", text: "Signed in. Loading review queue." };
      await loadStaffQueue();
    });
  });
  app.querySelector("[data-form='staff-mfa']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    runStaffAction(async () => {
      const pending = staffReview.mfa;
      if (!pending) return;
      let verified;
      if (pending.mode === "enrol") {
        verified = await requestJson("POST", "/api/identity/mfa/totp/confirm", { code: values.code }, pending.token);
        staffReview.recoveryCodes = verified.recoveryCodes || [];
        staffReview.notice = {
          tone: "success",
          text: `MFA enrolled. Store ${staffReview.recoveryCodes.length} recovery code(s) securely.`
        };
      } else {
        verified = await requestJson("POST", "/api/identity/sessions/current/mfa", {
          code: values.code || undefined,
          recoveryCode: values.recoveryCode || undefined
        }, pending.token);
        staffReview.notice = { tone: "success", text: "MFA verified. Loading review queue." };
      }
      staffReview.session = { token: pending.token, sessionId: pending.sessionId };
      staffReview.mfa = null;
      window.svuSession.set(staffReview.session);
      await loadStaffQueue();
    });
  });
  app.querySelector("[data-staff-cancel-mfa]")?.addEventListener("click", () => runStaffAction(async () => {
    const pending = staffReview.mfa;
    if (pending?.sessionId) {
      await requestJson("DELETE", `/api/identity/sessions/${pending.sessionId}`, undefined, pending.token).catch(() => {});
    }
    staffReview.mfa = null;
    staffReview.notice = { tone: "success", text: "MFA sign-in cancelled." };
  }));
  app.querySelector("[data-staff-signout]")?.addEventListener("click", () => runStaffAction(async () => {
    const current = staffReview.session;
    clearStaffSessionState();render();
    if (current?.sessionId) {
      await requestJson("DELETE", `/api/identity/sessions/${current.sessionId}`, undefined, current.token).catch(() => {});
    }
  }));
  app.querySelector("[data-load-review]")?.addEventListener("click", () => runStaffAction(loadStaffQueue));
  app.querySelector("[data-load-manifest]")?.addEventListener("click", () => runStaffAction(loadStaffManifest));
  app.querySelector("[data-expire-offers]")?.addEventListener("click", () => runStaffAction(async () => {
    const result = await requestJson("POST", "/api/admissions/review/offers/expire", {}, staffReview.session?.token);
    await loadStaffQueue();
    await loadStaffManifest();
    staffReview.notice = { tone: "success", text: `${result.expired} stale offer(s) expired.` };
  }));
  app.querySelectorAll("[data-review-detail]").forEach((button) => button.addEventListener("click", () => runStaffAction(async () => {
    await loadReviewDetail(button.dataset.reviewDetail);
    staffReview.mobileDetail = true;
    staffReview.notice = { tone: "success", text: "Application loaded." };
  }, { openDetail: true })));
  app.querySelector("[data-review-assign]")?.addEventListener("click", () => runStaffAction(async () => {
    if (!staffReview.selectedId) return;
    await requestJson("POST", `/api/admissions/review/applications/${staffReview.selectedId}/assign`, {}, staffReview.session?.token);
    await loadStaffQueue();
    await loadReviewDetail(staffReview.selectedId);
    staffReview.notice = { tone: "success", text: "Application assigned." };
  }));
  app.querySelector("[data-review-info]")?.addEventListener("click", () => runStaffAction(async () => {
    if (!staffReview.selectedId) return;
    await requestJson("POST", `/api/admissions/review/applications/${staffReview.selectedId}/request-information`, {
      message: "Please upload the outstanding evidence requested by admissions."
    }, staffReview.session?.token);
    await loadStaffQueue();
    await loadReviewDetail(staffReview.selectedId);
    staffReview.notice = { tone: "success", text: "Information request sent." };
  }));
  app.querySelector("[data-form='review-note']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    runStaffAction(async () => {
      if (!staffReview.selectedId) return;
      await requestJson("POST", `/api/admissions/review/applications/${staffReview.selectedId}/notes`, values, staffReview.session?.token);
      await loadReviewDetail(staffReview.selectedId);
      staffReview.notice = { tone: "success", text: "Review note added." };
    });
  });
  app.querySelector("[data-form='review-decision']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    runStaffAction(async () => {
      if (!staffReview.selectedId) return;
      const body = {
        decision: values.decision,
        note: values.note || undefined
      };
      if (values.decision === "offer") {
        const days = Number.parseInt(values.offerExpiresInDays, 10);
        body.offerExpiresInDays = Number.isInteger(days) ? days : 21;
        body.conditions = String(values.conditions || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      } else if (values.decision === "defer") {
        body.targetIntakeId = values.targetIntakeId;
      } else {
        body.reasonCode = values.reasonCode;
      }
      const result = await requestJson("POST", `/api/admissions/review/applications/${staffReview.selectedId}/decision`, body, staffReview.session?.token);
      await loadStaffQueue();
      await loadReviewDetail(staffReview.selectedId);
      await loadStaffManifest();
      staffReview.notice = { tone: "success", text: `${titleCase(result.decision)} recorded. State is ${result.workflowState}.` };
    });
  });
  app.querySelector("[data-review-convert]")?.addEventListener("click", () => runStaffAction(async () => {
    if (!staffReview.selectedId) return;
    const result = await requestJson("POST", `/api/admissions/review/applications/${staffReview.selectedId}/convert`, {}, staffReview.session?.token);
    await loadStaffQueue();
    await loadReviewDetail(staffReview.selectedId);
    await loadStaffManifest();
    staffReview.notice = { tone: "success", text: `${result.studentNumber} ${result.created ? "created" : "already existed"}.` };
  }));
}

async function runStaffAction(action, options = {}) {
  if (staffReview.busy) return;
  const uiState = window.admissionsLayout.capture(app);
  const submittingForm = document.activeElement?.closest('form');
  let succeeded = false;
  staffReview.busy = true;
  const controls = app.querySelector('.review-controls');
  if (controls) { controls.disabled = true; controls.setAttribute('aria-busy', 'true'); }
  try {
    staffReview.notice = null;
    await action();
    succeeded = true;
  } catch (error) {
    staffReview.notice = { tone: "error", text: error.message };
  } finally {
    staffReview.busy = false;
  }
  if (location.hash.startsWith('#admissions')) renderAdmissions({ ...options, openDetail: options.openDetail && succeeded, uiState, resetForm: succeeded ? window.admissionsLayout.formKey(submittingForm) : null });
}

async function loadStaffQueue() {
  staffReview.routes = await requestJson("GET", "/api/admissions/routes", undefined, staffReview.session?.token).catch((error) => {if (error.status === 403) return null;throw error;});
  staffReview.reviewUnavailable = staffReview.routes === null;
  const filters = new URLSearchParams({ limit: "50", ...(staffReview.filters || {}) });
  if (staffReview.reviewUnavailable) {
    staffReview.queue = null;staffReview.selectedId = null;staffReview.detail = null;staffReview.manifest = null;
  } else staffReview.queue = await requestJson("GET", `/api/admissions/review/applications?${filters}`, undefined, staffReview.session?.token);
  await Promise.all([
    window.admissionsReportingUI.load(staffReview,(method,path) => requestJson(method,path,undefined,staffReview.session?.token),staffReview.admissionsReport?.filters || staffReview.admissionsReportFilters),
    window.applicantCommunicationsUI.loadStaff(staffReview,(method,path,body) => requestJson(method,path,body,staffReview.session?.token)),
    window.admissionsGuidanceUI.loadStaff(staffReview,(method,path,body) => requestJson(method,path,body,staffReview.session?.token)),
    window.prospectiveEnquiriesUI.loadStaff(staffReview,(method,path,body) => requestJson(method,path,body,staffReview.session?.token)),
    window.enquiryReportingUI.load(staffReview,(method,path) => requestJson(method,path,undefined,staffReview.session?.token)),
    window.communicationReportingUI.load(staffReview,(method,path) => requestJson(method,path,undefined,staffReview.session?.token)),
    window.reportEditionsUI.load(staffReview,(method,path,body) => requestJson(method,path,body,staffReview.session?.token)),
    window.reportSchedulesUI.load(staffReview,(method,path,body) => requestJson(method,path,body,staffReview.session?.token))
  ]);
  const selectedId = staffReview.selectedId || staffReview.queue?.[0]?.id;
  if (selectedId) {
    await loadReviewDetail(selectedId);
  }
}

async function loadStaffManifest() {
  const intakeId = staffReview.detail?.intakeId || admissionsData.catalogue?.[0]?.intakeId || "intake_2027_feb";
  staffReview.manifest = await requestJson("GET", `/api/admissions/review/intakes/${encodeURIComponent(intakeId)}/manifest`, undefined, staffReview.session?.token);
}

async function loadReviewDetail(applicationId) {
  staffReview.selectedId = applicationId;
  staffReview.detail = await requestJson("GET", `/api/admissions/review/applications/${encodeURIComponent(applicationId)}`, undefined, staffReview.session?.token);
}

function buildLiveQueues(tasks) {
  const grouped = tasks.reduce((groups, task) => {
    const queueName = titleCase(task.queue || "unassigned");
    groups[queueName] ||= [];
    groups[queueName].push({
      title: task.title,
      programme: `Workflow ${task.workflowInstanceId}`,
      age: formatDateTime(task.dueAt),
      status: titleCase(task.status)
    });
    return groups;
  }, {});

  return Object.entries(grouped).map(([title, items]) => ({ title, items }));
}

// One checklist line: what the requirement is, its recorded state, and whether it is satisfied.
function evidenceItem(title, detail, state) {
  const passed = state === "passed";
  return `
    <div class="evidence-item ui-row" data-evidence-state="${esc(state)}">
      ${window.svuUI.ico(passed ? "check" : "clock", passed ? "green" : "amber", "ui-icon-sm")}
      <div><strong>${esc(titleCase(title))}</strong><span class="ui-meta">${esc(detail)}</span></div>
      ${window.svuUI.badge(passed ? "Satisfied" : "Pending", passed ? "green" : "amber")}
    </div>`;
}

function evidencePlaceholder(message) {
  return `
    <div class="evidence-item">
      <span class="dot warning"></span>
      <div>
        <strong>Evidence pending</strong>
        <p class="meta">${message}</p>
      </div>
    </div>
  `;
}

// Routes that need a signed-in person send everyone else to the shared sign-in page first.
const signedInRoutes = ["settings", "learning", "messages", "study", "office", "attend"];
const knownRoutes = ["home", "signin", "verify", "apply", "admissions", "registry", "foundation", "learning", "resources", "messages", "settings", "study", "office", "shared", "attend"];
let previousRoute = null;

function render(options = {}) {
  const entry = window.svuSession.get() ? '#home' : '#signin';
  if (!location.hash) history.replaceState(null, '', entry);
  const [path] = (location.hash || entry).replace("#", "").split("?");
  const [route, param] = path.split("/");
  const normalizedRoute = knownRoutes.includes(route) ? route : "home";
  if(normalizedRoute==='home' && window.svuSession.can('sharing.read') && !window.svuShell.isStudent() && !window.svuShell.isStaff() && !window.svuShell.isApplicant()) {location.replace('#shared');return;}
  if (window.svuSession.can("registry.self")) {
    const alias = { home: "#study/today", learning: window.svuSession.can('teaching.self') ? null : "#study/courses", apply: "#office/overview" }[route];
    if (alias && !(route === "apply" && new URLSearchParams(location.hash.split("?")[1]).has("history"))) {
      location.replace(alias); return;
    }
  }
  if (!knownRoutes.includes(route) && location.hash) history.replaceState(null, "", "#home");
  if (signedInRoutes.includes(normalizedRoute) && !window.svuSession.get()) { location.replace(`#signin?next=${encodeURIComponent(path)}`); return; }
  // A repaint triggered by the profile arriving only matters to screens built from roles and permissions.
  if (options.fromShell) {
    if (["home", "apply", "learning", "study", "office"].includes(normalizedRoute) && window.svuSession.can("registry.self")) render();
    else if (normalizedRoute === "home") window.homeUI.render(app);
    else if (["learning", "settings"].includes(normalizedRoute)) render();
    else if (normalizedRoute === "registry") window.registryUI.repaint();
    return;
  }
  if (normalizedRoute === "home" && previousRoute !== "home") window.homeUI.refresh();
  previousRoute = normalizedRoute;
  setActive(normalizedRoute);
  window.svuShell.update(normalizedRoute);
  if (["study", "office"].includes(normalizedRoute)) { window.studentUI.render(app); return; }
  if (normalizedRoute !== 'admissions' || !app.querySelector('.admissions-page')) window.scrollTo?.({ top: 0 });
  if (normalizedRoute === "verify") window.transcriptsUI.renderVerify(app, param);
  if (normalizedRoute === "attend") window.attendanceUI.renderCheckIn(app, param);
  if (normalizedRoute === "home") window.homeUI.render(app);
  if (normalizedRoute === "signin") window.svuShell.renderSignIn(app);
  if (normalizedRoute === "settings") window.settingsUI.render(app);
  if (normalizedRoute === "learning") window.learningUI.render(app);
  if (normalizedRoute === "apply") window.renderApply(app);
  if (normalizedRoute === "admissions") { renderAdmissions(); autoLoadStaffQueue(); }
  if (normalizedRoute === "registry") window.renderRegistry(app);
  if (normalizedRoute === "foundation") window.systemUI.render(app);
  if (normalizedRoute === "resources") window.renderResources(app);
  if (normalizedRoute === "messages") window.renderMessages(app);
  if (normalizedRoute === "shared") window.studentSharingUI.render(app);
}

// Arriving on Admissions already signed in (from another screen) loads the review queue straight away.
function autoLoadStaffQueue() {
  if (!staffReview.session || staffReview.queue || staffReview.autoLoadedFor === staffReview.session.token) return;
  staffReview.autoLoadedFor = staffReview.session.token;
  runStaffAction(loadStaffQueue);
}
window.svuRender = render;

window.addEventListener("hashchange", render);
render();
loadLiveData();
