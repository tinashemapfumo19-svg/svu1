(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const timeText = (minutes) => `${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const timeMinutes = (value, end = false) => { const [hours, minutes] = value.split(":").map(Number); return end && hours === 0 && minutes === 0 ? 1440 : hours * 60 + minutes; };
  function exceptionView(context) {
    const {period,registration,offerings,exceptions,exceptionEvidenceHash,capabilities,accountId} = context;
    const mutable = registration.id && registration.status === "draft" && period.status === "open";
    const selected = offerings.filter((row) => registration.selectedCourses.includes(row.courseId));
    const code = (id) => offerings.find((course) => course.courseId === id)?.code || id;
    const label = (row) => row.kind === "credit_limit" ? `Credit limit: ${row.parameters.maxCredits}` : row.kind === "prerequisite_waiver" ? `Prerequisite waiver: ${code(row.parameters.courseId)}` : `Timetable: ${row.parameters.courseIds.map(code).join(" / ")}`;
    return `<section class="registration-exceptions"><h4>Registration exceptions</h4>
      ${mutable && capabilities["exception.request"] ? `<details><summary>Request exception</summary><form class="form form-grid" data-exception-request="${esc(period.id)}">
        <input type="hidden" name="revision" value="${registration.revision}"><input type="hidden" name="evidenceHash" value="${esc(exceptionEvidenceHash)}">
        <label class="field"><span>Exception type</span><select class="input" name="kind"><option value="credit_limit">Credit load</option><option value="timetable_clash">Timetable clash</option><option value="prerequisite_waiver">Prerequisite waiver</option></select></label>
        <label class="field" data-exception-waiver hidden><span>Course needing the waiver</span><select class="input" name="waiverCourse" disabled required>${selected.map((row) => `<option value="${esc(row.courseId)}">${esc(row.code)}</option>`).join("")}</select></label>
        <label class="field" data-exception-credit><span>Requested credit ceiling</span><input class="input" name="maxCredits" type="number" min="0.5" max="480" step="0.5" value="${Math.max(context.eligibility.credits,period.creditLimit)}" required></label>
        ${["firstCourse","secondCourse"].map((name,index) => `<label class="field" data-exception-course hidden><span>${index ? "Second" : "First"} course</span><select class="input" name="${name}" disabled required>${selected.map((row) => `<option value="${esc(row.courseId)}">${esc(row.code)}</option>`).join("")}</select></label>`).join("")}
        <label class="field"><span>Exception evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Exception expiry</span><input class="input" name="expiresOn" type="date" max="${esc(period.windows?.registration?.[1])}" required></label>
        <label class="field"><span>Exception reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Request registration exception</button></div></form></details>` : ""}
      ${exceptions.map((row) => `<section data-registration-exception="${esc(row.id)}"><header class="section-header"><h4>${esc(label(row))}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)} - revision ${row.registrationRevision}</p><p>${esc(row.evidenceRef)} - expires ${esc(row.expiresOn)}</p>
        ${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}${row.revokeReason ? `<p>${esc(row.revokeReason)}</p>` : ""}
        ${mutable && capabilities["exception.approve"] && row.requestedBy !== accountId && ["requested","approved"].includes(row.status) ? `<form class="form" data-exception-review="${esc(row.id)}" data-period="${esc(period.id)}">
          <label class="field"><span>Exception outcome</span><select class="input" name="outcome">${row.status === "requested" ? `<option value="approved">Approve</option><option value="rejected">Reject</option>` : `<option value="revoked">Revoke</option>`}</select></label>
          <label class="field"><span>Exception review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review registration exception</button></div></form>` : ""}
      </section>`).join("")}${!exceptions.length && !mutable ? `<p>No registration exceptions.</p>` : ""}${extensionView(context)}</section>`;
  }
  // Late registration: a dated extension of the closed calendar window for this student, approved independently.
  function extensionView(context) {
    const {period,capabilities,accountId,extensions = []} = context;
    const live = extensions.find((row) => ["requested","approved"].includes(row.status));
    return `<div class="window-extensions" data-window-extensions="${esc(period.id)}"><h4>Late registration</h4>
      ${extensions.map((row) => `<p data-window-extension="${row.id}">Window extended to ${esc(row.until)} - <strong>${esc(row.status)}</strong> - ${esc(row.reason)}${row.reviewReason ? ` (${esc(row.reviewReason)})` : ""}</p>
        ${capabilities["exception.approve"] && row.requestedBy !== accountId && ["requested","approved"].includes(row.status) ? `<form class="form form-grid" data-extension-review="${row.id}" data-period="${esc(period.id)}">
          <label class="field"><span>Extension decision</span><select class="input" name="outcome">${row.status === "requested" ? '<option value="approved">Approve</option><option value="rejected">Reject</option>' : '<option value="revoked">Revoke</option>'}</select></label>
          <label class="field"><span>Extension review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Record extension decision</button></div></form>` : ""}`).join("")}
      ${capabilities["exception.request"] && period.status === "open" && !live ? `<details><summary>Extend the registration window</summary><form class="form form-grid" data-extension-request="${esc(period.id)}">
        <label class="field"><span>Extend until</span><input class="input" type="date" name="until" required></label><label class="field"><span>Evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Request extension</button></div></form></details>` : ""}</div>`;
  }
  function meetingRow(meeting = { day: 1, start: 540, end: 600 }) {
    return `<div class="meeting-row"><label class="field"><span>Day</span><select class="input" name="day">${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day, index) => `<option value="${index + 1}" ${index + 1 === meeting.day ? "selected" : ""}>${day}</option>`).join("")}</select></label>
    <label class="field"><span>Starts</span><input class="input" type="time" name="start" value="${timeText(meeting.start)}" required></label><label class="field"><span>Ends</span><input class="input" type="time" name="end" value="${timeText(meeting.end)}" required></label>
    <button class="icon-button" type="button" data-remove-meeting title="Remove meeting" aria-label="Remove meeting">&times;</button></div>`;
  }
  function render(state) {
    const detail = state.detail;
    return `<section class="registry-registration"><header class="section-header"><h3>Course registration</h3><button class="button button-secondary" type="button" data-registration-refresh>Refresh</button></header>
    ${detail.canConfigureRegistration ? `<details><summary>New registration period</summary><form class="form form-grid" data-registration-create>
      <label class="field"><span>Academic semester</span><select class="input" name="academicPeriodId" required><option value="">Select semester</option>${state.calendar.filter((period) => ["semester", "term"].includes(period.periodType)).map((period) => `<option value="${esc(period.id)}">${esc(period.name)} (${esc(period.lifecycleStatus)})</option>`).join("")}</select></label>
      <label class="field"><span>Year of study</span><input class="input" name="yearOfStudy" type="number" min="1" max="8" step="1" value="1" required></label>
      <label class="field"><span>Term</span><select class="input" name="term"><option>S1</option><option>S2</option><option>S3</option></select></label>
      <label class="field"><span>Credit limit</span><input class="input" name="creditLimit" type="number" min="0.5" max="480" step="0.5" value="60" required></label>
      <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Create registration period</button></div>
    </form></details>` : ""}
    ${state.registrations.map((context) => { const { period, registration, offerings, eligibility, capabilities, checks } = context; return `<section class="registration-period" data-registration-period="${esc(period.id)}">
      <h3>${esc(period.name)} - ${esc(period.term)}</h3><p>${esc(period.status)} - Year ${period.yearOfStudy} - ${period.creditLimit} credit limit</p>
      ${registration.status === "confirmed" ? `<p><strong>${esc(registration.referenceNumber)}</strong> - ${registration.confirmation.credits} credits</p><ul>${registration.confirmation.courses.map((course) => `<li>${esc(course.code)} - ${esc(course.title)}</li>`).join("")}</ul>` : `<p>${registration.id ? `Saved draft: ${eligibility.credits} credits` : "No saved course selection"}</p>`}
      ${capabilities.configure && period.status === "planning" ? `<details><summary>Course delivery</summary>${offerings.map((course) => `<form class="form delivery-form" data-registration-offering="${esc(period.id)}" data-course="${esc(course.courseId)}">
        <strong>${esc(course.code)} - ${esc(course.title)}</strong><label class="field"><span>Delivery</span><select class="input" name="delivery"><option value="scheduled" ${course.delivery !== "asynchronous" ? "selected" : ""}>Scheduled</option><option value="asynchronous" ${course.delivery === "asynchronous" ? "selected" : ""}>Asynchronous</option></select></label>
        <fieldset class="review-controls meeting-fields" ${course.delivery === "asynchronous" ? "hidden disabled" : ""}><div class="meetings">${(course.meetings.length ? course.meetings : [{ day: 1, start: 540, end: 600 }]).map(meetingRow).join("")}</div><button class="icon-button" type="button" data-add-meeting title="Add meeting" aria-label="Add meeting">+</button></fieldset>
        <label class="field"><span>Schedule reason</span><input class="input" name="reason" maxlength="2000" required></label><button class="button button-secondary" type="submit">Save delivery</button>
      </form>`).join("")}</details>` : ""}
      ${capabilities.configure && period.status !== "closed" ? `<form class="form form-grid" data-registration-status="${esc(period.id)}"><label class="field"><span>Period action</span><select class="input" name="toStatus">${period.status === "planning" ? `<option value="open">Open registration</option>` : `<option value="closed">Close registration</option><option value="planning">Return to planning</option>`}</select></label><label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">Update period</button></div></form>` : ""}
      ${checks.map((check) => `<p>${esc(check.checkType)}: ${esc(check.outcome)} - ${esc(check.reason)} (expires ${esc(check.expiresOn)})</p>`).join("")}
      ${period.status === "open" && registration.id && registration.status === "draft" && (capabilities.academic || capabilities.financial) ? `<form class="form form-grid" data-registration-check="${esc(period.id)}"><input type="hidden" name="revision" value="${registration.revision}">
        <label class="field"><span>Clearance</span><select class="input" name="checkType">${["academic","financial"].filter((type) => capabilities[type]).map((type) => `<option value="${type}">${type}</option>`).join("")}</select></label>
        <label class="field"><span>Outcome</span><select class="input" name="outcome"><option value="eligible">Eligible</option><option value="blocked">Blocked</option></select></label>
        <label class="field"><span>Evidence reference</span><input class="input" name="evidenceRef" maxlength="300" required></label><label class="field"><span>Expires on</span><input class="input" name="expiresOn" type="date" required></label>
        <label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Record clearance</button></div>
      </form>` : ""}
      ${registration.status !== "confirmed" ? `<ul class="registration-blockers">${eligibility.blockers.map((blocker) => `<li>${esc(blocker.message)}</li>`).join("")}</ul>` : ""}
      ${exceptionView(context)}
    </section>`; }).join("") || `<p>No registration periods.</p>`}</section>`;
  }
  function bind(root, state, { api, act, loadDetail }) {
    const detail = state.detail;
    if (!detail || !state.session) return;
    root.querySelector("[data-registration-refresh]")?.addEventListener("click", () => act(() => loadDetail(detail.id)));
    root.querySelectorAll("[data-exception-request]").forEach((form) => {
      form.querySelector('[name="kind"]').addEventListener("change",(event) => {
        const clash = event.target.value === "timetable_clash",waiver = event.target.value === "prerequisite_waiver",credit = !clash && !waiver;
        form.querySelector("[data-exception-credit]").hidden = !credit;
        form.querySelector('[name="maxCredits"]').disabled = !credit;
        form.querySelectorAll("[data-exception-course]").forEach((label) => {label.hidden = !clash; label.querySelector("select").disabled = !clash;});
        form.querySelector("[data-exception-waiver]").hidden = !waiver; form.querySelector('[name="waiverCourse"]').disabled = !waiver;
      });
    });
    root.querySelectorAll("[data-extension-request], [data-extension-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      const periodId = form.dataset.extensionRequest || form.dataset.period;
      const path = form.dataset.extensionRequest ? `/api/registry/programmes/${detail.id}/registrations/${periodId}/extensions` : `/api/registry/programmes/${detail.id}/registrations/${periodId}/extensions/${form.dataset.extensionReview}/review`;
      act(async () => {await api("POST",path,values); await loadDetail(detail.id); state.notice = form.dataset.extensionRequest ? "Window extension requested for independent approval." : `Window extension ${values.outcome}.`;});
    }));
    root.querySelectorAll("[data-exception-request], [data-exception-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      const period = form.dataset.exceptionRequest || form.dataset.period;
      const body = form.dataset.exceptionRequest ? {kind:values.kind,parameters:values.kind === "credit_limit" ? {maxCredits:Number(values.maxCredits)} : values.kind === "prerequisite_waiver" ? {courseId:values.waiverCourse} : {courseIds:[values.firstCourse,values.secondCourse]},
        revision:Number(values.revision),evidenceHash:values.evidenceHash,evidenceRef:values.evidenceRef,reason:values.reason,expiresOn:values.expiresOn} : values;
      act(async () => {
        await api("POST",`/api/registry/programmes/${detail.id}/registrations/${period}/exceptions${form.dataset.exceptionReview ? `/${form.dataset.exceptionReview}/review` : ""}`,body);
        await loadDetail(detail.id); state.notice = form.dataset.exceptionRequest ? "Registration exception requested." : "Registration exception reviewed.";
      });
    }));
    root.querySelectorAll(".delivery-form").forEach((form) => {
      const fields = form.querySelector(".meeting-fields");
      form.querySelector('[name="delivery"]').addEventListener("change", (event) => { fields.hidden = fields.disabled = event.target.value === "asynchronous"; });
      form.querySelector("[data-add-meeting]").addEventListener("click", () => { if (form.querySelectorAll(".meeting-row").length < 20) form.querySelector(".meetings").insertAdjacentHTML("beforeend", meetingRow()); });
      form.addEventListener("click", (event) => { const button = event.target.closest("[data-remove-meeting]"); if (button && form.querySelectorAll(".meeting-row").length > 1) button.closest(".meeting-row").remove(); });
    });
    root.querySelector("[data-registration-create]")?.addEventListener("submit", (event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); act(async () => {
        await api("POST", `/api/registry/programmes/${detail.id}/registration-periods`, { ...values, yearOfStudy: Number(values.yearOfStudy), creditLimit: Number(values.creditLimit) });
        await loadDetail(detail.id); state.notice = "Registration period created.";
      });
    });
    root.querySelectorAll("[data-registration-offering], [data-registration-status], [data-registration-check]").forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault(); const data = new FormData(form); const values = Object.fromEntries(data);
      act(async () => {
        const offering = form.dataset.registrationOffering;
        const period = offering || form.dataset.registrationStatus || form.dataset.registrationCheck;
        let body = form.dataset.registrationCheck ? { ...values, revision: Number(values.revision) } : values;
        if (offering) body = { reason: values.reason, offerings: [{ courseId: form.dataset.course, delivery: values.delivery, meetings: values.delivery === "asynchronous" ? [] : data.getAll("day").map((day,index) => ({ day: Number(day), start: timeMinutes(data.getAll("start")[index]), end: timeMinutes(data.getAll("end")[index],true) })) }] };
        const path = form.dataset.registrationCheck ? `registrations/${period}/checks` : `registration-periods/${period}`;
        await api("POST", `/api/registry/programmes/${detail.id}/${path}`, body);
        await loadDetail(detail.id); state.notice = form.dataset.registrationCheck ? "Clearance recorded." : "Registration period updated.";
      });
    }));
  }
  window.registryRegistrationUI = { render, bind };
})();
