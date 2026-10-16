(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const human = (value) => String(value ?? "").replaceAll("_"," ");
  const roles = ["lead","co_lecturer","tutor","moderator","examiner"];
  function classList(state,id) {
    const list = state.classLists?.[id];
    return list ? `<div class="class-list" data-class-list="${id}"><strong>${list.students.length} enrolled</strong><ul>${list.students.map((row) => `<li>${esc(row.studentNumber)} - ${esc(row.legalName)} (${esc(row.registrationReference)})</li>`).join("")}</ul></div>` : "";
  }
  function allocationRow(state,data,row) {
    return `<li class="teaching-allocation" data-allocation="${row.id}"><span><strong>${esc(human(row.role))}</strong>: ${esc(row.staffName)} (${esc(row.employeeNumber)}) - ${row.workloadUnits} units from ${esc(row.effectiveFrom)}${row.effectiveTo ? ` to ${esc(row.effectiveTo)}` : ""}</span>
      <span>${esc(row.status)}${row.staffStatus !== "active" ? ` - staff ${esc(row.staffStatus)}` : ""}${row.replacesAllocationId ? ` - substitutes allocation ${row.replacesAllocationId}` : ""}${row.endReason ? ` - ${esc(row.endReason)}` : ""}</span>
      ${data.capabilities.approve && row.status === "proposed" && row.proposedBy !== data.accountId ? `<form class="form form-grid" data-allocation-review="${row.id}"><label class="field"><span>Allocation outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
        <label class="field"><span>Allocation review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review allocation</button></div></form>` : ""}
      ${data.capabilities.allocate && row.status === "active" ? `<form class="form form-grid" data-allocation-end="${row.id}"><label class="field"><span>Last teaching date</span><input class="input" name="effectiveTo" type="date" required></label>
        <label class="field"><span>End reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">End allocation</button></div></form>` : ""}
      ${row.status === "active" ? `<button class="button button-secondary" type="button" data-class-list-load="${row.id}">Class list</button>${classList(state,row.id)}` : ""}</li>`;
  }
  function periodView(state) {
    const data = state.teachingPeriod;
    if (!data) return "";
    return `<section class="teaching-period" data-teaching-period="${esc(data.period.id)}"><header class="section-header"><h3>${esc(data.period.programmeCode)} ${esc(data.period.intakeLabel)} - ${esc(data.period.name)}</h3><strong>${esc(data.period.status)}</strong></header>
      ${data.offerings.map((offering) => `<section class="teaching-offering" data-offering="${esc(offering.courseId)}"><header class="section-header"><h4>${esc(offering.code)} - ${esc(offering.title)}</h4><strong>${offering.covered ? "Covered" : "Uncovered"}</strong></header>
        <p>${offering.enrolled} enrolled - ${esc(offering.delivery)}${offering.reason ? ` - ${esc(offering.reason)}` : ""}</p><button class="button button-secondary" type="button" data-assessment-load="${esc(data.period.id)}:${esc(offering.courseId)}">Assessment and marks</button>
        <ul class="allocation-list">${offering.allocations.map((row) => allocationRow(state,data,row)).join("")}</ul>
        ${data.capabilities.allocate ? `<details><summary>Allocate staff to ${esc(offering.code)}</summary><form class="form form-grid" data-allocation-propose="${esc(offering.courseId)}">
          <label class="field"><span>Staff member</span><select class="input" name="staffId" required>${data.staff.map((row) => `<option value="${esc(row.id)}">${esc(row.legalName)} (${esc(row.employeeNumber)})</option>`).join("")}</select></label>
          <label class="field"><span>Allocation role</span><select class="input" name="role">${roles.map((role) => `<option value="${role}">${human(role)}</option>`).join("")}</select></label>
          <label class="field"><span>Workload units</span><input class="input" name="workloadUnits" type="number" min="0" max="1000" step="0.25" required></label>
          <label class="field"><span>Starts on</span><input class="input" name="effectiveFrom" type="date" required></label>
          <label class="field"><span>Substitutes allocation</span><select class="input" name="replacesAllocationId"><option value="">None</option>${offering.allocations.filter((row) => row.status === "active").map((row) => `<option value="${row.id}">${esc(human(row.role))}: ${esc(row.staffName)}</option>`).join("")}</select></label>
          <label class="field"><span>Allocation reason</span><input class="input" name="reason" maxlength="2000" required></label>
          <div><button class="button button-primary" type="submit">Propose allocation</button></div></form></details>` : ""}
      </section>`).join("") || "<p>No offerings configured for this period.</p>"}</section>`;
  }
  function render(state) {
    const overview = state.teachingOverview,mine = state.myTeaching;
    if (!overview && !mine) return "";
    return `${mine ? `<section class="my-teaching" data-my-teaching><h2>My teaching</h2>${mine.allocations.length ? `<ul class="allocation-list">${mine.allocations.map((row) => `<li data-allocation="${row.id}"><span><strong>${esc(row.code)} - ${esc(row.title)}</strong>: ${esc(human(row.role))}, ${row.workloadUnits} units from ${esc(row.effectiveFrom)}</span>
      <div class="hero-actions"><button class="button button-secondary" type="button" data-class-list-load="${row.id}">Class list</button><button class="button button-secondary" type="button" data-assessment-load="${esc(row.periodId)}:${esc(row.courseId)}">Marks</button></div>${classList(state,row.id)}</li>`).join("")}</ul>` : "<p>No active teaching allocations.</p>"}</section>` : ""}
      ${overview ? `<details class="registry-teaching" data-teaching-panel ${state.teachingOpen ? "open" : ""}><summary>Teaching allocation (${overview.uncovered.length} uncovered)</summary>
        <h3>Uncovered offerings</h3>${overview.uncovered.length ? `<ul class="uncovered-list">${overview.uncovered.map((row) => `<li><strong>${esc(row.code)}</strong> ${esc(row.title)} - ${esc(row.programmeCode)} ${esc(row.intakeLabel)} ${esc(row.periodName)} - ${row.enrolled} enrolled - ${esc(row.reason)}</li>`).join("")}</ul>` : "<p>Every open offering has an active lead lecturer.</p>"}
        <h3>Workload</h3>${overview.workload.length ? `<ul class="workload-list">${overview.workload.map((row) => `<li data-workload="${esc(row.staffId)}">${esc(row.staffName)} (${esc(row.employeeNumber)}): ${row.units} units across ${row.allocations} allocation(s)${row.staffStatus !== "active" ? ` - ${esc(row.staffStatus)}` : ""}</li>`).join("")}</ul>` : "<p>No active allocations.</p>"}
        <h3>Registration periods</h3><div class="hero-actions">${overview.periods.map((row) => `<button class="button button-secondary" type="button" data-teaching-load="${esc(row.id)}">${esc(row.programmeCode)} ${esc(row.intakeLabel)} - ${esc(row.name)}</button>`).join("") || "<p>No open registration periods.</p>"}</div>
        ${periodView(state)}</details>` : ""}`;
  }
  async function load(state,api) {
    state.teachingOverview = await api("GET","/api/teaching/overview").catch(() => null);
    state.myTeaching = await api("GET","/api/teaching/me").catch(() => null);
    if (state.teachingPeriod) state.teachingPeriod = await api("GET",`/api/teaching/periods/${state.teachingPeriod.period.id}`).catch(() => null);
  }
  function bind(root,state,{api,act}) {
    root.querySelector("[data-teaching-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.teachingOpen = event.currentTarget.open;});
    const reload = async () => {state.classLists = {}; await load(state,api);};
    root.querySelectorAll("[data-teaching-load]").forEach((button) => button.addEventListener("click",() => act(async () => {state.teachingPeriod = await api("GET",`/api/teaching/periods/${button.dataset.teachingLoad}`);})));
    root.querySelectorAll("[data-class-list-load]").forEach((button) => button.addEventListener("click",() => act(async () => {state.classLists = {...state.classLists,[button.dataset.classListLoad]:await api("GET",`/api/teaching/allocations/${button.dataset.classListLoad}/class-list`)};})));
    root.querySelectorAll("[data-allocation-propose]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      const body = {courseId:form.dataset.allocationPropose,staffId:values.staffId,role:values.role,workloadUnits:Number(values.workloadUnits),effectiveFrom:values.effectiveFrom,reason:values.reason};
      if (values.replacesAllocationId) body.replacesAllocationId = Number(values.replacesAllocationId);
      act(async () => {await api("POST",`/api/teaching/periods/${state.teachingPeriod.period.id}/allocations`,body); await reload(); state.notice = "Allocation proposed for approval.";});
    }));
    root.querySelectorAll("[data-allocation-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",`/api/teaching/allocations/${form.dataset.allocationReview}/review`,values); await reload(); state.notice = "Allocation reviewed.";});
    }));
    root.querySelectorAll("[data-allocation-end]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",`/api/teaching/allocations/${form.dataset.allocationEnd}/end`,values); await reload(); state.notice = "Allocation ended.";});
    }));
  }
  window.registryTeachingUI = {render,bind,load};
})();
