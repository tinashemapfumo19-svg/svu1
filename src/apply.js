// Applicant portal (Stage 2): catalogue, account, profile, application, documents, submission, offer.
// Dependency-free. Every value from the API goes through esc() before it reaches innerHTML.

(function () {
  const sessionKey = "svu.applicant.session";
  const state = {
    view: "signin",
    notice: null,
    mfa: null,
    recoveryCodes: null,
    catalogue: null,
    lists: {},
    selectedApplicationId: null,
    selectedProgrammeId: null
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function session() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    } catch {
      return null;
    }
  }

  // Signing in or out here signs in or out of the whole app.
  function saveSession(value) {
    window.svuSession.set(value);
  }

  async function api(method, path, body, { auth = true, token = null } = {}) {
    const headers = { Accept: "application/json" };
    const current = session();
    if (token || (auth && current?.token)) headers.Authorization = `Bearer ${token || current.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (auth && !token && current?.token && current.token !== session()?.token) {
      const error = new Error('The session changed. Reload this workspace.');error.status = 409;throw error;
    }
    if (response.status === 401 && auth && current && current.token === session()?.token) {
      saveSession(null);
      window.registryExamArrangementsUI.clearStudent(state);
      window.supportCasesUI.clearStudent(state);
      window.applicantCommunicationsUI.clearOwn(state);
      window.prospectiveEnquiriesUI.clearOwn(state);
    }
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload.data ?? payload;
  }

  async function list(code) {
    if (!state.lists[code]) {
      state.lists[code] = (await api("GET", `/api/master-data/reference-lists/${code}`, undefined, { auth: false })).values;
    }
    return state.lists[code];
  }

  function notice() {
    if (!state.notice) return "";
    const tone = state.notice.tone === "error" ? "notice-error" : "notice-success";
    return `<div class="notice ${tone}" role="status">${esc(state.notice.text)}</div>`;
  }

  function badge(text, tone = "neutral") {
    return `<span class="pill pill-${tone}">${esc(text)}</span>`;
  }

  function formatDate(value) {
    if (!value) return "";
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // ---------- signed out ----------

  function catalogueCards(entries, signedIn) {
    if (!entries || entries.length === 0) {
      return `<p class="muted">No intakes are open right now. Please check back soon.</p>`;
    }
    return entries.map((entry) => `
      <article class="apply-card">
        <div>
          <p class="eyebrow">${esc(entry.faculty || entry.department)}</p>
          <h3>${esc(entry.programmeName)}</h3>
          <p class="muted">${esc(entry.label)} intake · starts ${esc(formatDate(entry.startsOn))}</p>
          <p class="muted">Applications ${entry.applicationsOpen ? "close" : "open"} ${esc(formatDate(entry.applicationsOpen ? entry.applicationClosesAt : entry.applicationOpensAt))}</p>
          <p class="small">You will need: ${esc((entry.requirements?.documents || []).map(humanise).join(", ") || "no documents")}</p>
        </div>
        ${signedIn && entry.applicationsOpen
          ? `<button class="button button-primary" type="button" data-start="${esc(entry.intakeId)}">Start application</button>`
          : entry.applicationsOpen ? badge("Open", "blue") : badge("Opening soon")}
      </article>`).join("");
  }

  function signedOutView() {
    const tabs = [["signin", "Sign in"], ["register", "Create account"], ["activate", "I have a code"]];
    const mfaForm = state.mfa ? `
      <form class="form" data-form="mfa">
        ${state.mfa.mode === "enrol" ? `
          <div class="notice notice-warning">
            <strong>MFA enrolment required</strong>
            <p class="muted">Add this TOTP secret to an authenticator app, then enter the current code.</p>
            <p class="muted">${esc(state.mfa.secret)}</p>
          </div>
        ` : `
          <div class="notice notice-warning">
            <strong>MFA verification required</strong>
            <p class="muted">Enter an authenticator code or a recovery code to finish sign-in.</p>
          </div>
        `}
        <label class="field"><span>Authenticator code</span><input class="input" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
        <label class="field"><span>Recovery code</span><input class="input" name="recoveryCode" autocomplete="one-time-code"></label>
        <div class="hero-actions">
          <button class="button button-primary" type="submit">Continue</button>
          <button class="button button-secondary" type="button" data-cancel-mfa>Cancel</button>
        </div>
      </form>` : "";
    const forms = {
      signin: `
        <form class="form" data-form="signin">
          <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <button class="button button-primary" type="submit">Sign in</button>
        </form>`,
      register: `
        <form class="form" data-form="register">
          <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Preferred name</span><input class="input" name="preferredName" required></label>
          <label class="field"><span>Full legal name</span><input class="input" name="legalName" required></label>
          <button class="button button-primary" type="submit">Email me a code</button>
          <p class="small muted">We send a one-time code to finish creating your account.</p>
        </form>`,
      activate: `
        <form class="form" data-form="activate">
          <label class="field"><span>Code from your email</span><input class="input" name="token" required autocomplete="one-time-code"></label>
          <label class="field"><span>Preferred name</span><input class="input" name="preferredName" required></label>
          <label class="field"><span>Full legal name</span><input class="input" name="legalName" required></label>
          <label class="field"><span>Choose a password</span><input class="input" name="password" type="password" minlength="12" autocomplete="new-password" required></label>
          <p class="small muted">At least 12 characters. Avoid using your email name.</p>
          <button class="button button-primary" type="submit">Create my account</button>
        </form>`
    };
    return `
      <section class="apply-layout">
        <div>
          <p class="eyebrow">Admissions</p>
          <h1 class="page-title">Apply to South Valley University</h1>
          <p class="lead">Choose an intake, create your account, and track every step of your application in one place.</p>
          <div class="apply-list">${state.catalogue ? catalogueCards(state.catalogue, false) : `<div class="skeleton"></div>`}</div>
          ${window.admissionsGuidanceUI.publicView(state)}
        </div>
        <aside class="card apply-panel">
          <div class="tabs" role="tablist">
            ${tabs.map(([id, label]) => `<button type="button" role="tab" class="tab ${state.view === id ? "is-active" : ""}" aria-selected="${state.view === id}" data-tab="${id}">${label}</button>`).join("")}
          </div>
          ${notice()}
          ${state.recoveryCodes?.length ? `
            <div class="notice notice-warning">
              <strong>Recovery codes</strong>
              <p class="muted">${state.recoveryCodes.map(esc).join(" ")}</p>
            </div>
          ` : ""}
          ${mfaForm || forms[state.view] || forms.signin}
        </aside>
      </section>`;
  }

  // ---------- signed in ----------

  async function signedInView() {
    const enquiryToken = session()?.token;
    const supportContext = {applicationId:state.selectedApplicationId,programmeId:state.selectedProgrammeId};
    const [applications, profile] = await Promise.all([
      api("GET", "/api/admissions/applications"), api("GET", "/api/admissions/profile"),
      window.prospectiveEnquiriesUI.loadOwn(state,api,() => session()?.token),
      window.applicantCommunicationsUI.loadOwn(state,api,() => session()?.token)
    ]);
    if (enquiryToken === session()?.token) state.enquiryOwnApplications = applications.map(({id,intakeId}) => ({id,intakeId}));
    const appointments = await api("GET", "/api/identity/staff-appointments").catch(() => []);
    const live = applications;
    const selectedId = state.selectedApplicationId && live.some((a) => a.id === state.selectedApplicationId)
      ? state.selectedApplicationId
      : live[0]?.id;
    const application = selectedId ? await api("GET", `/api/admissions/applications/${selectedId}`) : null;
    const [countries, levels, modes] = await Promise.all([list("country"), list("academic_level"), list("study_mode")]);
    const historyView = new URLSearchParams(location.hash.split('?')[1] || '').has('history');
    const student = application?.workflowState === "Accepted" && !historyView ? await api("GET", "/api/registry/me") : null;
    const programmeRecords = student?.programmes.filter((entry) => entry.applicationId === application?.id) || [];
    const studentProgramme = programmeRecords.find((entry) => entry.id === state.selectedProgrammeId) || programmeRecords[0];
    state.withdrawalProgrammeId = studentProgramme?.id || null;
    const programmeRead = (resource,empty = null) => studentProgramme
      ? api("GET", `/api/registry/me/programmes/${studentProgramme.id}/${resource}`) : Promise.resolve(empty);
    if (!studentProgramme) {
      window.registryExamArrangementsUI.clearStudent(state);
      window.supportCasesUI.clearStudent(state);
    }
    // These sections share the selected programme, but do not depend on each other's responses.
    const [withdrawals,registrations,results,academic,exams,award,transcripts,lifecycle,credits,transfers,identity,account] = await Promise.all([
      programmeRead("withdrawals").catch(() => null), programmeRead("registrations",[]), programmeRead("results",[]), programmeRead("academic"), programmeRead("exams"),
      programmeRead("award").catch(() => null), programmeRead("transcripts"), programmeRead("lifecycle"),
      programmeRead("credits"), programmeRead("transfers"), student ? api("GET", "/api/registry/me/identity") : null,
      programmeRead("account"),
      studentProgramme ? window.registryExamArrangementsUI.loadStudent(state,api,studentProgramme.id) : null,
      studentProgramme ? window.supportCasesUI.loadStudent(state,api,studentProgramme.id,() => session()?.token,supportContext) : null
    ]);
    state.studentExams = exams || [];

    return { applicationId: selectedId, html: `
      <section class="apply-signed-in registry-workspace">
        <header class="section-header staff-page-head">
          <div>
            <p class="eyebrow">${historyView ? 'Application history' : 'Applicant portal'}</p>
            <h1 class="page-title">${studentProgramme ? esc(studentProgramme.programmeName) : application ? esc(application.programmeName) : "Start your application"}</h1>
            ${studentProgramme ? `<p class="muted">${esc(student.studentNumber)} - ${esc(studentProgramme.intakeLabel)} - ${esc(studentProgramme.versionLabel)}</p>` : application ? `<p class="muted">${esc(application.intakeLabel)} intake${application.referenceNumber ? ` · ${esc(application.referenceNumber)}` : ""}</p>` : ""}
          </div>
          <div class="ui-actions"><button class="button button-secondary" type="button" data-signout>Sign out</button></div>
        </header>
        ${notice()}
        <div class="staff-body">
        ${window.staffAppointmentsUI.render(appointments)}
        ${state.recoveryCodes?.length ? `<div class="notice notice-warning"><strong>Recovery codes</strong><p class="muted">${state.recoveryCodes.map(esc).join(" ")}</p></div>` : ""}
        ${application?.status === "draft" && !application.readiness.ready ? window.svuUI.attention({ tone: "warning", glyph: "list", title: "Finish your application", text: `${application.readiness.blockers.length} ${application.readiness.blockers.length === 1 ? "item needs" : "items need"} attention before you can submit.`, act: `<a class="button button-primary" href="#apply" data-jump-readiness>See what's needed</a>` })
          : application?.status === "draft" ? window.svuUI.attention({ tone: "info", glyph: "check", eyebrow: "Ready", title: "Your application is ready to submit", text: "Check your details, then submit from the Documents panel." }) : ""}
        ${live.length > 1 ? `<div class="tabs ui-bare">${live.map((a) => `<button type="button" class="tab ${a.id === selectedId ? "is-active" : ""}" data-select="${esc(a.id)}">${esc(a.programmeCode)} · ${esc(a.intakeLabel)}</button>`).join("")}</div>` : ""}
        ${application ? applicationView(application, profile, modes) : `<section class="ui-panel">${window.svuUI.head("Choose a programme", { desc: "Pick an open intake to start your application." })}<div class="apply-list">${catalogueCards(state.catalogue, true)}</div></section>`}
        ${student ? studentOnboarding(student, countries) : ""}
        ${identity ? studentIdentity(identity) : ""}
        ${programmeRecords.length > 1 ? `<label class="field student-programme-picker"><span>Programme record</span><select class="input" data-student-programme>${programmeRecords.map((row) => `<option value="${esc(row.id)}" ${row.id === studentProgramme.id ? "selected" : ""}>${esc(row.programmeCode)} - ${esc(row.intakeLabel)} - ${esc(row.versionLabel)} - ${esc(row.status)}</option>`).join("")}</select></label>` : ""}
        ${studentProgramme ? window.studyYearUI.render(studentProgramme) : ""}
        ${account ? `<section class="student-finance"><h2>Fees and payments</h2>${window.registryFinanceUI.summary(account)}</section>` : ""}
        ${studentProgramme ? courseRegistrationView(studentProgramme, registrations, credits) : ""}
        ${studentProgramme ? window.courseWithdrawalsUI.render(withdrawals, registrations) : ""}
        ${studentProgramme ? window.registryExamsUI.studentView(exams) : ""}
        ${studentProgramme ? window.registryExamArrangementsUI.studentView(state) : ''}
        ${studentProgramme ? window.supportCasesUI.studentView(state) : ''}
        ${studentProgramme ? publishedResultsView(results) : ""}
        ${studentProgramme ? window.registryAwardsUI.studentView(award) : ""}
        ${studentProgramme ? window.transcriptsUI.studentView(transcripts,state.openTranscriptId) : ""}
        ${academic ? studentAcademicView(academic) : ""}
        ${credits?.recognitions.some((row) => row.status === "approved") ? `<section class="student-credits"><h2>Recognized credits</h2>${credits.recognitions.filter((row) => row.status === "approved").map((row) => `<p>${esc(credits.curriculum.find((course) => course.courseId === row.courseId)?.code || row.courseId)} - ${row.credits} credits - ${esc(row.kind.replaceAll("_"," "))} - GPA excluded</p>`).join("")}</section>` : ""}
        ${lifecycle?.history.length ? `<section class="student-lifecycle"><h2>Programme status history</h2>${lifecycle.history.map((row) => `<p>${esc(row.fromStatus || (studentProgramme.originProgrammeId ? "transfer" : "conversion"))} to ${esc(row.toStatus)} - ${esc(formatDate(row.effectiveAt))}: ${esc(row.reason)}</p>`).join("")}</section>` : ""}
        ${transfers?.requests.length ? `<section class="student-transfers"><h2>Programme transfers</h2>${transfers.requests.map((row) => `<p>${esc(row.programmeCode)} - ${esc(row.intakeLabel)} - ${esc(row.versionLabel)}: ${esc(row.status)}</p><p>${esc(row.reviewReason || row.reason)}</p>`).join("")}</section>` : ""}
        ${application && ["Withdrawn", "Rejected", "Declined", "Expired", "Deferred"].includes(application.workflowState) ? `<details><summary>Other intakes</summary><div class="apply-list">${catalogueCards(state.catalogue.filter((intake) => !applications.some((entry) => entry.intakeId === intake.intakeId && entry.status !== "withdrawn")), true)}</div></details>` : ""}
        ${profileCard(profile, countries, levels, modes, application?.status === "draft" || !application)}
        ${window.applicantCommunicationsUI.ownView(state)}
        ${window.admissionsGuidanceUI.publicView(state)}
        ${window.prospectiveEnquiriesUI.ownView(state)}
        </div>
      </section>` };
  }

  function studentOnboarding(student, countries) {
    const profile = student.profile;
    const kin = profile.nextOfKin;
    return `<section class="student-onboarding">
      <header class="section-header"><h2>Student onboarding</h2><strong>${esc(student.studentNumber)}</strong></header>
      ${student.programmes.map((programme) => `<p>${esc(programme.programmeName)} - ${esc(programme.status.replaceAll("_", " "))}</p>`).join("")}
      <form class="form form-grid" data-form="student-profile">
        <input type="hidden" name="revision" value="${profile.revision}">
        <label class="field"><span>Contact phone</span><input class="input" name="phone" type="tel" value="${esc(profile.phone)}" required></label>
        <label class="field"><span>Street address</span><input class="input" name="line1" value="${esc(profile.address.line1)}" required></label>
        <label class="field"><span>City</span><input class="input" name="city" value="${esc(profile.address.city)}" required></label>
        <label class="field"><span>Country</span><select class="input" name="countryCode" required>${countries.filter((country) => country.status === "active").map((country) => `<option value="${esc(country.valueCode)}" ${country.valueCode === profile.address.countryCode ? "selected" : ""}>${esc(country.label)}</option>`).join("")}</select></label>
        <label class="field"><span>Next-of-kin name</span><input class="input" name="kinName" value="${esc(kin.name)}" required></label>
        <label class="field"><span>Relationship</span><select class="input" name="relationship" required>${["parent", "spouse", "sibling", "guardian", "other"].map((code) => `<option value="${code}" ${code === kin.relationship ? "selected" : ""}>${humanise(code)}</option>`).join("")}</select></label>
        <label class="field"><span>Next-of-kin phone</span><input class="input" name="kinPhone" type="tel" value="${esc(kin.phone)}" required></label>
        <div><button class="button button-primary" type="submit">Save student profile</button></div>
      </form>
    </section>`;
  }

  function studentIdentity(identity) {
    const ui = window.registryIdentityUI;
    const open = identity.requests.some((row) => row.status === "requested");
    return `<section class="student-identity">
      <header class="section-header"><h2>Identity details</h2><span>Revision ${identity.revision}</span></header>
      <dl class="identity-summary">${Object.entries(ui.labels).map(([field, label]) => `<div><dt>${label}</dt><dd>${esc(identity.identity[field] || "Not recorded")}</dd></div>`).join("")}</dl>
      <p class="muted">Identity changes are checked by the registry against your evidence before they take effect.</p>
      ${open ? "" : `<details><summary>Request a correction</summary>${ui.form(identity, 'data-form="student-identity"', "Request identity correction")}</details>`}
      ${identity.requests.length ? ui.decisions(identity, false) : ""}
    </section>`;
  }

  function courseRegistrationView(programme, registrations, credits) {
    const recognized = (credits?.recognitions || []).filter((row) => row.status === "approved").map((row) => row.courseId);
    if (!registrations.length) return "";
    return `<section class="course-registration"><h2>Course registration</h2>${registrations.map((entry) => {
      const { period, registration, offerings, eligibility } = entry;
      const editable = registration.status === "draft" && period.status === "open" && programme.status === "onboarded";
      return `<section class="registration-period"><header class="section-header"><h3>${esc(period.name)} - Year ${period.yearOfStudy} ${esc(period.term)}</h3>${badge(registration.status === "confirmed" ? "Confirmed" : period.status)}</header>
        ${registration.status === "confirmed" ? `<p><strong>${esc(registration.referenceNumber)}</strong></p><p>${registration.confirmation.credits} credits - ${esc(formatDate(registration.confirmation.confirmedAt))}</p>
        <ul>${registration.confirmation.courses.map((course) => `<li>${esc(course.code)} - ${esc(course.title)} (${course.credits} credits)</li>`).join("")}</ul>
        ${(registration.confirmation.exceptions || []).map((row) => `<p>Approved ${row.kind === "credit_limit" ? `credit ceiling: ${row.parameters.maxCredits}` : row.kind === "prerequisite_waiver" ? `prerequisite waiver` : `timetable exception: ${row.parameters.courseIds.map((id) => registration.confirmation.courses.find((course) => course.courseId === id)?.code || id).map(esc).join(" / ")}`} - ${esc(row.reason)} - expires ${esc(formatDate(row.expiresOn))}</p>`).join("")}` : `
        <form class="form" data-form="course-selection" data-programme="${esc(programme.id)}" data-period="${esc(period.id)}">
          <input type="hidden" name="revision" value="${registration.revision}">
          <fieldset class="review-controls" ${editable ? "" : "disabled"}>
          ${offerings.map((course) => `<label class="course-choice"><input type="checkbox" name="courseIds" value="${esc(course.courseId)}" ${recognized.includes(course.courseId) ? "disabled" : registration.selectedCourses.includes(course.courseId) ? "checked" : ""}><span><strong>${esc(course.code)} - ${esc(course.title)}</strong><span>${course.credits} credits - ${recognized.includes(course.courseId) ? "recognized credit" : esc(course.requirementType)} - ${esc(course.delivery)}</span></span></label>`).join("")}
          <button class="button button-secondary" type="submit">Save course selection</button></fieldset>
        </form><p>${eligibility.credits} / ${period.creditLimit} credits</p>
        ${eligibility.blockers.length ? `<ul class="registration-blockers">${eligibility.blockers.map((blocker) => `<li>${esc(blocker.message)}</li>`).join("")}</ul>` : ""}
        <button class="button button-primary" type="button" data-confirm-registration data-programme="${esc(programme.id)}" data-period="${esc(period.id)}" data-revision="${registration.revision}" ${eligibility.ready && registration.revision > 0 ? "" : "disabled"}>Confirm registration</button>`}
      </section>`;
    }).join("")}</section>`;
  }

  function publishedResultsView(batches) {
    return `<section class="student-results"><h2>Published results</h2>${batches.length ? batches.map((batch) => `<section class="result-period">
      <header class="section-header"><h3>${esc(batch.sourceRef)}</h3><span>${esc(formatDate(batch.publishedAt))}</span></header>
      <p>GPA ${batch.gpa === null ? "Not calculated" : batch.gpa} ${batch.classification ? `- ${esc(batch.classification)}` : ""}</p>
      <div class="result-table-wrap"><table class="result-table"><thead><tr><th>Course</th><th>Credits</th><th>Mark</th><th>Grade</th></tr></thead><tbody>${batch.results.map((row) => `<tr><td>${esc(row.code)}<br>${esc(row.title)}</td><td>${row.credits}</td><td>${row.mark}${row.amended ? ` <span class="muted">(amended; published ${row.publishedMark})</span>` : ""}</td><td>${esc(row.grade)}</td></tr>`).join("")}</tbody></table></div>
    </section>`).join("") : `<p>No published results</p>`}</section>`;
  }

  function studentAcademicView(data) {
    const contexts = data.contexts.filter((row) => row.decisions.length);
    if (!contexts.length) return "";
    return `<section class="student-academic"><h2>Academic decisions</h2>${contexts.map(({period,decisions,repeatCandidates}) => `<section class="academic-period"><h3>${esc(period.name)} - Year ${period.yearOfStudy}</h3>
      ${decisions.map((row) => `<div class="academic-decision"><header class="section-header"><h4>${esc(humanise(row.kind))} ${row.courseId ? esc(repeatCandidates.find((course) => course.courseId === row.courseId)?.code || row.courseId) : `to Year ${period.yearOfStudy}`}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}<p>Expires ${esc(formatDate(row.expiresOn))}</p></div>`).join("")}
    </section>`).join("")}</section>`;
  }

  function stepper(application) {
    const order = ["Submitted", "Payment verified", "Completeness review", "Academic review", "Decision", "Offer issued", "Accepted"];
    const current = application.workflowState || "Draft";
    const index = order.indexOf(current);
    return `<ol class="stepper">${["Draft", ...order].map((step, position) => {
      const done = current === step || (index >= 0 && position <= index + 1);
      return `<li class="${done ? "is-done" : ""} ${current === step ? "is-current" : ""}">${esc(step)}</li>`;
    }).join("")}</ol>`;
  }

  function applicationView(application, profile, modes) {
    const isDraft = application.status === "draft";
    const infoRequested = application.workflowState === "Information requested";
    const canUpload = isDraft || infoRequested;
    const decision = application.decision;
    return `
      <div class="dashboard-grid ui-main-rail">
        <article class="ui-panel">
          <div class="section-header"><h2>Progress</h2>${badge(application.workflowState || "Draft", "blue")}</div>
          ${stepper(application)}
          ${infoRequested ? `
            <div class="notice notice-warning">Admissions has asked for more information. Upload the requested evidence below, then reply.</div>
            <form class="form" data-form="respond">
              <label class="field"><span>Your reply</span><textarea class="input" name="message" rows="3" required></textarea></label>
              <button class="button button-primary" type="submit">Send reply</button>
            </form>` : ""}
          ${decision && application.workflowState === "Offer issued" ? `
            <div class="offer">
              <h3>You have an offer</h3>
              ${(decision.conditions || []).length ? `<p>Conditions: ${esc(decision.conditions.join("; "))}</p>` : "<p>This is an unconditional offer.</p>"}
              <p class="muted">Respond by ${esc(formatDate(decision.offerExpiresAt))}.</p>
              <div class="hero-actions">
                <button class="button button-primary" type="button" data-offer="accept">Accept offer</button>
                <button class="button button-secondary" type="button" data-offer="decline">Decline</button>
              </div>
            </div>` : ""}
          ${application.workflowState === "Accepted" ? `<div class="notice notice-success">You accepted your offer. Welcome to South Valley University. Your student number is in your welcome email.</div>` : ""}
          ${application.workflowState === "Rejected" && decision ? `<p>We were unable to offer you a place. Reason: ${esc(decision.reason)}.</p>` : ""}
          ${application.workflowState === "Deferred" ? `<div class="notice notice-success">Your application has been deferred.</div>` : ""}
          ${(application.messages || []).length ? `<section><h3>Messages from admissions</h3>${application.messages.map((message) => `<p>${esc(message.body)}</p><p class="small muted">${esc(formatDate(message.createdAt))}</p>`).join("")}</section>` : ""}
          ${(application.requests || []).map((request) => `<p>Deferral to ${esc(request.targetIntakeLabel)}: ${esc(request.status)}${request.reviewReason ? ` - ${esc(request.reviewReason)}` : ""}</p>
            ${request.status === "approved" && application.workflowState === "Deferred" ? `<button class="button button-secondary" type="button" data-start="${esc(request.targetIntakeId)}">Start deferred intake application</button>` : ""}`).join("")}
          ${["Decision", "Offer issued"].includes(application.workflowState) && !(application.requests || []).some((request) => request.status === "pending") ? `
            <form class="form" data-form="deferral">
              <label class="field"><span>Defer to intake</span><select class="input" name="targetIntakeId" required><option value="">Choose intake</option>${(state.catalogue || []).filter((intake) => intake.programmeCode === application.programmeCode && intake.startsOn > application.startsOn).map((intake) => `<option value="${esc(intake.intakeId)}">${esc(intake.label)}</option>`).join("")}</select></label>
              <label class="field"><span>Reason for deferral</span><textarea class="input" name="reason" required minlength="3" maxlength="1000" rows="3"></textarea></label>
              <button class="button button-secondary" type="submit">Request deferral</button>
            </form>` : ""}
          <details><summary>Application history</summary><ul>${(application.history || []).map((entry) => `<li>${esc(entry.state)} - ${esc(formatDate(entry.occurredAt))}</li>`).join("")}</ul></details>
          ${isDraft ? `
            <form class="form" data-form="application">
              <label class="field"><span>Applicant category</span><select class="input" name="applicantCategory">${["standard", ...Object.keys(application.requirements.documentsByCategory || {})].map((category) => `<option value="${esc(category)}" ${(application.answers.applicantCategory || "standard") === category ? "selected" : ""}>${esc(humanise(category))}</option>`).join("")}</select></label>
              <label class="field"><span>Study mode</span>
                <select class="input" name="studyModeCode">
                  <option value="">Choose…</option>
                  ${modes.map((mode) => `<option value="${esc(mode.valueCode)}" ${mode.valueCode === (application.studyModeCode || profile.profile?.studyModeCode) ? "selected" : ""}>${esc(mode.label)}</option>`).join("")}
                </select>
              </label>
              <label class="field"><span>Personal statement</span><textarea class="input" name="personalStatement" rows="5" maxlength="4000">${esc(application.answers?.personalStatement)}</textarea></label>
              <button class="button button-secondary" type="submit">Save</button>
            </form>` : ""}
          ${isDraft ? feePanel(application) : ""}
        </article>
        <article class="ui-panel apply-documents">
          <div class="section-header"><h2>Documents</h2></div>
          <ul class="check-list">
            ${application.checklist.map((item) => `
              <li class="file-row">
                <div>
                  <strong>${esc(humanise(item.documentType))}</strong>
                  <p class="small muted">${esc(documentStatusText(item.status))}</p>
                </div>
                ${item.satisfied ? badge("Done", "blue") : canUpload ? `
                  <label class="button button-soft">Upload<input class="visually-hidden" type="file" accept="application/pdf,image/jpeg,image/png" data-upload="${esc(item.documentType)}" data-application="${esc(application.id)}"></label>` : badge(item.status)}
              </li>`).join("")}
            ${infoRequested ? `<li class="file-row"><div><strong>Additional document</strong><p class="small muted">Anything admissions asked for</p></div><label class="button button-soft">Upload<input class="visually-hidden" type="file" accept="application/pdf,image/jpeg,image/png" data-upload="other" data-application="${esc(application.id)}"></label></li>` : ""}
          </ul>
          ${isDraft ? `
            <div class="readiness">
              ${application.readiness.ready
                ? `<p>Everything is ready.</p><button class="button button-primary" type="button" data-submit>Submit application</button>`
                : `<p class="small">Before you can submit:</p><ul class="ui-stack-tight">${application.readiness.blockers.map((blocker) => `<li class="ui-requirement">${window.svuUI.ico("alert", "amber", "ui-icon-sm")}<div><strong>${esc(blocker.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()))}</strong></div></li>`).join("")}</ul>`}
            </div>` : ""}
          ${!isDraft && !["Accepted", "Rejected", "Withdrawn", "Declined", "Expired"].includes(application.workflowState)
            ? `<button class="button button-secondary" type="button" data-withdraw>Withdraw application</button>` : ""}
        </article>
      </div>`;
  }

  function feePanel(application) {
    const fee = application.fee;
    return `
      <form class="form decision-panel" data-form="fee">
        <div class="section-header">
          <div>
            <h3>Application fee</h3>
            <p class="muted">${fee ? `${humanise(fee.method)} ${fee.status}` : "Enter a payment reference or approved waiver code."}</p>
          </div>
          ${fee ? badge(fee.status === "waived" ? "Waived" : "Verified", "blue") : badge("Needed", "warning")}
        </div>
        <div class="form-grid">
          <label class="field"><span>Method</span>
            <select class="input" name="method" required>
              <option value="provider_reference" ${fee?.method === "provider_reference" ? "selected" : ""}>Payment reference</option>
              <option value="waiver_code" ${fee?.method === "waiver_code" ? "selected" : ""}>Waiver code</option>
            </select>
          </label>
          <label class="field"><span>Reference</span><input class="input" name="reference" value="${esc(fee?.reference)}" placeholder="SVU-PAY-ABC123 or SVU-WAIVER-2027" required></label>
        </div>
        <button class="button button-secondary" type="submit">Verify fee</button>
      </form>`;
  }

  function profileCard(profile, countries, levels, modes, editable) {
    const p = profile.profile || {};
    const option = (items, selected) => items.map((item) => `<option value="${esc(item.valueCode)}" ${item.valueCode === selected ? "selected" : ""}>${esc(item.label)}</option>`).join("");
    return `
      <details class="card profile-card" ${profile.complete ? "" : "open"}>
        <summary><strong>Your details</strong> ${profile.complete ? badge("Complete", "blue") : badge(`${profile.missing.length} to finish`, "warning")}</summary>
        <form class="form form-grid" data-form="profile">
          <label class="field"><span>Date of birth</span><input class="input" type="date" name="dateOfBirth" value="${esc(p.dateOfBirth)}" ${editable ? "" : "disabled"}></label>
          <label class="field"><span>Phone (international)</span><input class="input" name="phone" placeholder="+263771234567" value="${esc(p.phone)}" ${editable ? "" : "disabled"}></label>
          <label class="field"><span>Nationality</span><select class="input" name="nationalityCode" ${editable ? "" : "disabled"}><option value="">Choose…</option>${option(countries, p.nationalityCode)}</select></label>
          <label class="field"><span>Highest qualification</span><select class="input" name="priorLevelCode" ${editable ? "" : "disabled"}><option value="">Choose…</option>${option(levels, p.priorLevelCode)}</select></label>
          <label class="field"><span>Preferred study mode</span><select class="input" name="studyModeCode" ${editable ? "" : "disabled"}><option value="">Choose…</option>${option(modes, p.studyModeCode)}</select></label>
          <label class="field"><span>Address</span><input class="input" name="line1" value="${esc(p.address?.line1)}" ${editable ? "" : "disabled"}></label>
          <label class="field"><span>City</span><input class="input" name="city" value="${esc(p.address?.city)}" ${editable ? "" : "disabled"}></label>
          <label class="field"><span>Country</span><select class="input" name="countryCode" ${editable ? "" : "disabled"}><option value="">Choose…</option>${option(countries, p.address?.countryCode)}</select></label>
          ${editable ? `<div><button class="button button-secondary" type="submit">Save details</button></div>` : ""}
        </form>
      </details>`;
  }

  function humanise(code) {
    return String(code).replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
  }

  function documentStatusText(status) {
    return {
      missing: "Not uploaded yet",
      upload_requested: "Upload started; try again if it did not finish",
      uploaded: "Received; waiting for a security check",
      available: "Received and checked",
      verified: "Verified by admissions",
      rejected: "Rejected by admissions; upload a new copy",
      quarantined: "We could not accept this file; upload a PDF, JPEG, or PNG"
    }[status] || status;
  }

  // ---------- actions ----------

  async function handle(action) {
    try {
      state.notice = null;
      await action();
    } catch (error) {
      state.notice = { tone: "error", text: error.message };
    }
    await render(container, true);
  }

  async function uploadFile(applicationId, documentType, file) {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      throw new Error("Upload a PDF, JPEG, or PNG file.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Files must be 10 MB or smaller.");
    }
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const intent = await api("POST", `/api/admissions/applications/${applicationId}/documents`, {
      documentType, fileName: file.name, contentType: file.type, sizeBytes: file.size, checksum
    });
    const response = await fetch(intent.upload.url, { method: "PUT", headers: { "Content-Type": file.type }, body: bytes });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || "The upload did not complete.");
    }
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function bind(root, applicationId) {
    root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.tab;
      state.notice = null;
      state.mfa = null;
      render(container);
    }));
    root.querySelectorAll("[data-select]").forEach((button) => button.addEventListener("click", () => {
      state.selectedApplicationId = button.dataset.select;
      state.selectedProgrammeId = null;
      window.registryExamArrangementsUI.clearStudent(state);
      window.supportCasesUI.clearStudent(state);
      render(container);
    }));
    root.querySelector("[data-student-programme]")?.addEventListener("change",(event) => {
      state.selectedProgrammeId = event.target.value; state.openTranscriptId = null; window.registryExamArrangementsUI.clearStudent(state); window.supportCasesUI.clearStudent(state); render(container);
    });
    root.querySelectorAll("[data-student-transcript]").forEach((button) => button.addEventListener("click", () => {
      state.openTranscriptId = state.openTranscriptId === button.dataset.studentTranscript ? null : button.dataset.studentTranscript; render(container);
    }));
    window.transcriptsUI.bindPrint(root);
    if (state.withdrawalProgrammeId) window.courseWithdrawalsUI.bind(root, { api, own: true, programmeId: state.withdrawalProgrammeId, run: (work) => handle(async () => { state.notice = { tone: "success", text: await work() }; }) });
    window.staffAppointmentsUI.bind(root, { api, run: (work) => handle(async () => { state.notice = { tone: "success", text: await work() }; }) });
    window.registryExamsUI.bindStudent(root, state.studentExams || []);
    window.registryExamArrangementsUI.studentBind(root,state,{api,act:handle});
    window.supportCasesUI.studentBind(root,state,{api,act:handle,getToken:() => session()?.token});
    window.applicantCommunicationsUI.ownBind(root,state,{api,act:handle,getToken:() => session()?.token});
    window.admissionsGuidanceUI.publicBind(root,state,{api:(method,path) => api(method,path,undefined,{auth:false}),act:handle});
    window.prospectiveEnquiriesUI.ownBind(root,state,{api,act:handle,getToken:() => session()?.token});
    root.querySelector("[data-signout]")?.addEventListener("click", () => handle(async () => {
      window.prospectiveEnquiriesUI.clearOwn(state);
      window.applicantCommunicationsUI.clearOwn(state);
      window.registryExamArrangementsUI.clearStudent(state);
      window.supportCasesUI.clearStudent(state);
      const current = session();
      await api("DELETE", `/api/identity/sessions/${current.sessionId}`).catch(() => {});
      saveSession(null);
      state.recoveryCodes = null;
    }));
    root.querySelector("[data-cancel-mfa]")?.addEventListener("click", () => handle(async () => {
      const pending = state.mfa;
      if (pending?.sessionId) {
        await api("DELETE", `/api/identity/sessions/${pending.sessionId}`, undefined, { auth: false, token: pending.token }).catch(() => {});
      }
      state.mfa = null;
      state.notice = { tone: "success", text: "MFA sign-in cancelled." };
    }));
    root.querySelectorAll("[data-start]").forEach((button) => button.addEventListener("click", () => handle(async () => {
      const created = await api("POST", "/api/admissions/applications", { intakeId: button.dataset.start });
      state.selectedApplicationId = created.id;
      state.notice = { tone: "success", text: "Application started. Your progress saves as you go." };
    })));

    root.querySelectorAll("form[data-form]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formData(form);
      const selectedCourses = new FormData(form).getAll("courseIds");
      handle(async () => {
        if (form.dataset.form === "signin") {
          const signedIn = await api("POST", "/api/identity/sessions", values, { auth: false });
          if (signedIn.status === "mfa_pending") {
            state.mfa = { mode: "verify", token: signedIn.token, sessionId: signedIn.id };
            state.notice = { tone: "success", text: "Enter your second factor to finish sign-in." };
            return;
          }
          if (signedIn.status === "mfa_enrolment_required") {
            const enrolment = await api("POST", "/api/identity/mfa/totp", undefined, { auth: false, token: signedIn.token });
            state.mfa = {
              mode: "enrol",
              token: signedIn.token,
              sessionId: signedIn.id,
              secret: enrolment.secret,
              otpauthUri: enrolment.otpauthUri
            };
            state.notice = { tone: "success", text: "MFA setup started." };
            return;
          }
          if (signedIn.status !== "active") {
            throw new Error("Sign-in is not active yet.");
          }
          saveSession({ token: signedIn.token, sessionId: signedIn.id });
          state.mfa = null;
        }
        if (form.dataset.form === "mfa") {
          const pending = state.mfa;
          if (!pending) return;
          if (pending.mode === "enrol") {
            const confirmed = await api("POST", "/api/identity/mfa/totp/confirm", { code: values.code }, { auth: false, token: pending.token });
            state.recoveryCodes = confirmed.recoveryCodes || [];
            state.notice = { tone: "success", text: `MFA enrolled. Store ${state.recoveryCodes.length} recovery code(s) securely.` };
          } else {
            await api("POST", "/api/identity/sessions/current/mfa", {
              code: values.code || undefined,
              recoveryCode: values.recoveryCode || undefined
            }, { auth: false, token: pending.token });
            state.notice = { tone: "success", text: "MFA verified." };
          }
          saveSession({ token: pending.token, sessionId: pending.sessionId });
          state.mfa = null;
        }
        if (form.dataset.form === "register") {
          const result = await api("POST", "/api/admissions/registrations", values, { auth: false });
          state.view = "activate";
          state.notice = { tone: "success", text: result.message };
        }
        if (form.dataset.form === "activate") {
          await api("POST", "/api/identity/activations", values, { auth: false });
          state.view = "signin";
          state.notice = { tone: "success", text: "Account created. Sign in with your email and new password." };
        }
        if (form.dataset.form === "profile") {
          const { line1, city, countryCode, ...rest } = values;
          const body = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== ""));
          if (line1 || city || countryCode) body.address = { line1, city, countryCode };
          await api("PUT", "/api/admissions/profile", body);
          state.notice = { tone: "success", text: "Details saved." };
        }
        if (form.dataset.form === "student-profile") {
          await api("PUT", "/api/registry/me", { revision: Number(values.revision), phone: values.phone,
            address: { line1: values.line1, city: values.city, countryCode: values.countryCode },
            nextOfKin: { name: values.kinName, relationship: values.relationship, phone: values.kinPhone } });
          state.notice = { tone: "success", text: "Student profile saved." };
        }
        if (form.dataset.form === "student-identity") {
          const identity = await api("GET", "/api/registry/me/identity");
          await api("POST", "/api/registry/me/identity", { revision: Number(values.revision), changes: window.registryIdentityUI.changesFrom(form, identity.identity), evidenceRef: values.evidenceRef, reason: values.reason });
          state.notice = { tone: "success", text: "Identity correction sent to the registry for review." };
        }
        if (form.dataset.form === "course-selection") {
          await api("PUT", `/api/registry/me/programmes/${form.dataset.programme}/registrations/${form.dataset.period}`, { revision: Number(values.revision), courseIds: selectedCourses });
          state.notice = { tone: "success", text: "Course selection saved." };
        }
        if (form.dataset.form === "application") {
          const body = { answers: { personalStatement: values.personalStatement, applicantCategory: values.applicantCategory || "standard" } };
          if (values.studyModeCode) body.studyModeCode = values.studyModeCode;
          await api("PATCH", `/api/admissions/applications/${applicationId}`, body);
          state.notice = { tone: "success", text: "Saved." };
        }
        if (form.dataset.form === "fee") {
          await api("POST", `/api/admissions/applications/${applicationId}/fee`, values);
          state.notice = { tone: "success", text: "Application fee status saved." };
        }
        if (form.dataset.form === "respond") {
          await api("POST", `/api/admissions/applications/${applicationId}/respond`, values);
          state.notice = { tone: "success", text: "Reply sent. Admissions will continue reviewing your application." };
        }
        if (form.dataset.form === "deferral") {
          await api("POST", `/api/admissions/applications/${applicationId}/deferral`, values);
          state.notice = { tone: "success", text: "Deferral request sent." };
        }
      });
    }));

    root.querySelectorAll("[data-confirm-registration]").forEach((button) => button.addEventListener("click", () => handle(async () => {
      const result = await api("POST", `/api/registry/me/programmes/${button.dataset.programme}/registrations/${button.dataset.period}/confirm`, { revision: Number(button.dataset.revision) });
      state.notice = { tone: "success", text: `Registration confirmed. ${result.referenceNumber}` };
    })));
    root.querySelectorAll("[data-upload]").forEach((input) => input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      handle(async () => {
        await uploadFile(applicationId, input.dataset.upload, file);
        state.notice = { tone: "success", text: `${file.name} uploaded. We will check it shortly.` };
      });
    }));
    root.querySelector("[data-jump-readiness]")?.addEventListener("click", (event) => {
      event.preventDefault();
      root.querySelector(".apply-documents .readiness")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    root.querySelector("[data-submit]")?.addEventListener("click", () => handle(async () => {
      const submitted = await api("POST", `/api/admissions/applications/${applicationId}/submit`, {});
      state.notice = { tone: "success", text: `Submitted. Your reference number is ${submitted.referenceNumber}.` };
    }));
    root.querySelector("[data-withdraw]")?.addEventListener("click", async () => {
      if (!await window.svuUI.confirm({ title: "Withdraw this application?", text: "This cannot be undone. You would need to start a new application to apply again.", confirmLabel: "Withdraw application", danger: true })) return;
      handle(async () => {
        await api("POST", `/api/admissions/applications/${applicationId}/withdraw`, { reason: "Withdrawn by applicant in portal" });
        state.notice = { tone: "success", text: "Application withdrawn." };
      });
    });
    root.querySelectorAll("[data-offer]").forEach((button) => button.addEventListener("click", async () => {
      const accept = button.dataset.offer === "accept";
      if (!accept && !await window.svuUI.confirm({ title: "Decline this offer?", text: "This cannot be undone. Your place will be released to other applicants.", confirmLabel: "Decline offer", danger: true })) return;
      handle(async () => {
        const result = await api("POST", `/api/admissions/applications/${applicationId}/offer-response`, { response: accept ? "accept" : "decline" });
        state.notice = { tone: "success", text: accept ? `Offer accepted. Your student number is ${result.studentNumber}.` : "Offer declined." };
      });
    }));
  }

  let container;
  let renderVersion = 0;
  async function render(target, force = false) {
    const editingForm = () => target.contains(document.activeElement) && document.activeElement.closest("form[data-form],form[data-enquiry-create],form[data-enquiry-own-action]");
    if (!force && editingForm()) return;
    const version = ++renderVersion;
    container = target;
    try {
      if (!state.catalogue) {
        state.catalogue = await api("GET", "/api/admissions/catalogue", undefined, { auth: false });
      }
      const token = session()?.token;
      if (!token) window.prospectiveEnquiriesUI.clearOwn(state);
      await window.admissionsGuidanceUI.loadPublic(state,(method,path) => api(method,path,undefined,{auth:false}));
      const view = token ? await signedInView() : { html: signedOutView(), applicationId: null };
      if (version !== renderVersion || token !== session()?.token || location.hash.split('?')[0] !== "#apply" || !force && editingForm()) return;
      target.innerHTML = view.html;
      window.svuUI.enhance(target);
      bind(target, view.applicationId);
    } catch (error) {
      if (version !== renderVersion || location.hash.split('?')[0] !== "#apply") return;
      if (error.status === 401) {
        saveSession(null);
        state.notice = { tone: "error", text: "Your session ended. Please sign in again." };
        return render(target);
      }
      container.innerHTML = `<section class="registry-workspace"><header class="section-header staff-page-head"><div><p class="eyebrow">My application</p><h1 class="page-title">Something went wrong</h1></div></header>${window.svuUI.emptyState({ glyph: "alert", title: "This page could not be loaded", text: error.message, act: `<a class="button button-secondary" href="#home">Back to home</a>` })}</section>`;
    }
  }

  window.renderApply = render;
  window.studentFormsUI = { studentOnboarding, studentIdentity, courseRegistrationView, publishedResultsView, studentAcademicView };
})();
