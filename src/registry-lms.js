(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  function render(state) {
    const data = state.lmsOutcomes;
    if (!data?.periods.length) return "";
    return `<details class="registry-lms" data-lms-panel ${state.lmsOpen ? "open" : ""}><summary>Course results for transfer (${data.periods.filter((row) => !row.transferred).length} open)</summary>
      ${data.periods.map((status) => `<section class="lms-period" data-lms-period="${esc(status.period.id)}"><header class="section-header"><h3>${esc(status.period.programmeCode)} ${esc(status.period.intakeLabel)} - ${esc(status.period.name)}</h3>
        <strong>${status.transferred ? "Transferred" : status.readyToTransfer ? "Ready to transfer" : "Waiting for outcomes"}</strong></header>
        <ul class="lms-courses">${status.courses.map((course) => `<li data-lms-course="${esc(course.courseId)}"><span><strong>${esc(course.code)}</strong> ${esc(course.title)} - ${course.enrolled} enrolled</span>
          <span>${course.assessment ? `SVU marks: ${esc(course.assessment.status)} (${course.assessment.finals.length} students${course.deferred ? `, ${course.deferred} deferred` : ""})` : course.live ? `LMS ${esc(course.live.externalRef)}: ${esc(course.live.status)} (${course.live.rowCount} marks)` : "No approved marks or LMS outcomes yet"}</span>
          ${course.live?.status === "received" ? `<form class="form form-grid" data-lms-review="${course.live.id}"><label class="field"><span>LMS outcome decision</span><select class="input" name="outcome"><option value="accepted">Accept</option><option value="rejected">Reject</option></select></label>
            <label class="field"><span>LMS review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review outcomes</button></div></form>` : ""}</li>`).join("")}</ul>
        ${status.readyToTransfer ? `<form class="form form-grid" data-lms-transfer="${esc(status.period.id)}"><label class="field"><span>GPA rule set</span><select class="input" name="gpaRuleSetId" required>${(state.gpaRuleSets || []).map((row) => `<option value="${esc(row.id)}">${esc(row.code)} v${esc(row.version)}</option>`).join("")}</select></label>
          <label class="field"><span>Transfer reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Transfer to official results</button></div></form>` : ""}
        ${status.transferred ? `<p>Official result batch ${esc(status.courses[0].assessment?.resultBatchId || status.courses[0].live?.resultBatchId)} now needs independent results review and publication.</p>` : ""}
      </section>`).join("")}</details>`;
  }
  async function load(state,api) {
    state.lmsOutcomes = await api("GET","/api/lms/outcomes").catch(() => null);
    if (state.lmsOutcomes?.periods.length && !state.gpaRuleSets) state.gpaRuleSets = (await api("GET","/api/master-data/gpa-rule-sets").catch(() => [])).filter((row) => row.status === "published");
  }
  function bind(root,state,{api,act}) {
    // A panel removed by a re-render (for example on sign-out) can still deliver a late toggle; only the live panel counts.
    root.querySelector("[data-lms-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.lmsOpen = event.currentTarget.open;});
    root.querySelectorAll("[data-lms-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",`/api/lms/outcomes/${form.dataset.lmsReview}/review`,values); await load(state,api); state.notice = `LMS outcomes ${values.outcome}.`;});
    }));
    root.querySelectorAll("[data-lms-transfer]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {const result = await api("POST",`/api/lms/periods/${form.dataset.lmsTransfer}/transfer`,values); await load(state,api); state.notice = `Transferred ${result.rowCount} marks to result batch ${result.resultBatchId}.`;});
    }));
  }
  window.registryLmsUI = {render,bind,load};
})();
