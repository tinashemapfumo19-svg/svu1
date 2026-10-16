(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const blockers = (assessment) => assessment?.blockers.length ? `<ul class="registration-blockers">${assessment.blockers.map((row) => `<li>${esc(row.message)}</li>`).join("")}</ul>` : "";
  function render(state) {
    const data = state.academic;
    if (!data) return "";
    const cap = data.capabilities;
    return `<section class="registry-academic"><header class="section-header"><h3>Academic decisions</h3><button class="button button-secondary" type="button" data-academic-refresh>Refresh academic record</button></header>
      ${cap["policy.manage"] ? `<details><summary>Draft academic policy</summary><form class="form form-grid" data-academic-policy>
        <label class="field"><span>Policy code</span><input class="input" name="code" pattern="[a-z0-9_]{3,40}" required></label>
        <label class="field"><span>Name</span><input class="input" name="name" maxlength="200" required></label>
        <label class="field"><span>GPA rule set</span><select class="input" name="gpaRuleSetId" required>${data.gpaPolicies.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Minimum GPA</span><input class="input" name="minGpa" type="number" min="0" max="10" step="0.01" value="2" required></label>
        <label class="field"><span>Minimum passed credits</span><input class="input" name="minPassedCredits" type="number" min="0" max="480" step="0.5" value="30" required></label>
        <label class="field"><span>Maximum failed credits</span><input class="input" name="maxFailedCredits" type="number" min="0" max="480" step="0.5" value="0" required></label>
        <label class="field"><span>Maximum outstanding core courses</span><input class="input" name="maxOutstandingCoreCourses" type="number" min="0" max="100" step="1" value="0" required></label>
        <label class="field"><span>Maximum attempts</span><input class="input" name="maxAttempts" type="number" min="1" max="10" step="1" value="2" required></label>
        <label><input type="checkbox" name="allowPassedRetake"> Allow passed-course retakes</label>
        <label><input type="checkbox" name="recognisedCredits"> Permit recognized credit, excluded from GPA</label>
        <label class="field"><span>Draft reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Draft policy</button></div></form></details>` : ""}
      ${data.policies.filter((row) => row.status === "draft").map((policy) => `<section class="academic-policy"><h4>${esc(policy.name)} - v${policy.version}</h4>
        ${cap["policy.publish"] && policy.createdBy !== data.accountId ? `<form class="form form-grid" data-academic-publish="${esc(policy.id)}">
          <label class="field"><span>Effective from</span><input class="input" name="effectiveFrom" type="date" required></label>
          <label class="field"><span>Approval evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
          <label class="field"><span>Publication reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
          <div><button class="button button-primary" type="submit">Publish academic policy</button></div></form>` : `<p>Draft</p>`}</section>`).join("")}
      ${data.contexts.map((context) => {
        const {period,registration,policy,decisions,progression,repeats} = context;
        const mutable = period.status !== "closed" && registration?.status !== "confirmed";
        const options = [...(period.yearOfStudy > 1 ? [{value:"progression",label:`Progression to Year ${period.yearOfStudy}`}] : []),
          ...repeats.filter((row) => registration?.selectedCourses.includes(row.courseId)).map((row) => ({value:`repeat:${row.courseId}`,label:`Repeat ${row.code}`}))];
        return `<section class="academic-period" data-academic-period="${esc(period.id)}"><h4>${esc(period.name)} - Year ${period.yearOfStudy}</h4>
          <p>${policy ? `${esc(policy.name)} - v${policy.version}` : "No attached academic policy"}</p>
          ${state.detail.canConfigureRegistration && period.status === "planning" ? `<details><summary>Academic period setup</summary><form class="form" data-academic-setup="${esc(period.id)}">
            <label class="field"><span>Academic policy</span><select class="input" name="academicPolicyId" required><option value="">Select policy</option>${data.policies.filter((row) => row.status === "published").map((row) => `<option value="${esc(row.id)}" ${period.academicPolicyId === row.id ? "selected" : ""}>${esc(row.name)} - v${row.version}</option>`).join("")}</select></label>
            <fieldset class="review-controls"><legend>Repeat offerings</legend>${context.repeatCandidates.map((row) => `<label class="course-choice"><input type="checkbox" name="repeatCourseIds" value="${esc(row.courseId)}" ${context.repeatCourseIds.includes(row.courseId) ? "checked" : ""}><span>${esc(row.code)} - ${esc(row.title)}</span></label>`).join("")}</fieldset>
            <label class="field"><span>Setup reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-secondary" type="submit">Save academic setup</button></div></form></details>` : ""}
          ${mutable && progression ? `<p>Progression GPA: ${progression.gpa ?? "unknown"} - passed credits: ${progression.passedCredits ?? 0} - failed credits: ${progression.failedCredits ?? 0}</p>${blockers(progression)}` : ""}
          ${mutable ? repeats.map((row) => `<details><summary>${esc(row.code)} repeat eligibility</summary>${blockers(row)}${row.ready ? `<p>Eligible for independent approval</p>` : ""}</details>`).join("") : ""}
          ${cap.request && mutable && policy && options.length ? `<form class="form form-grid" data-academic-request="${esc(period.id)}">
            <input type="hidden" name="evidenceHash" value="${esc(context.evidenceHash)}"><input type="hidden" name="revision" value="${registration?.revision || 0}">
            <label class="field"><span>Decision</span><select class="input" name="decision">${options.map((row) => `<option value="${esc(row.value)}">${esc(row.label)}</option>`).join("")}</select></label>
            <label class="field"><span>Evidence reference</span><input class="input" name="evidenceRef" maxlength="300" required></label>
            <label class="field"><span>Expires on</span><input class="input" name="expiresOn" type="date" max="${esc(period.windows?.registration?.[1])}" required></label>
            <label class="field"><span>Request reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
            <div><button class="button button-primary" type="submit">Request academic decision</button></div></form>` : ""}
          ${decisions.map((decision) => `<section class="academic-decision" data-academic-decision="${esc(decision.id)}">
            <header class="section-header"><h4>${esc(decision.kind)} ${decision.courseId ? esc(context.repeatCandidates.find((row) => row.courseId === decision.courseId)?.code || decision.courseId) : `to Year ${period.yearOfStudy}`}</h4><strong>${esc(decision.status)}</strong></header>
            <p>${esc(decision.reason)}</p><p>${esc(decision.evidenceRef)} - expires ${esc(decision.expiresOn)}</p>${blockers(decision.assessment)}
            ${decision.reviewReason ? `<p>${esc(decision.reviewReason)}</p>` : ""}
            ${cap.approve && mutable && decision.status === "requested" && decision.requestedBy !== data.accountId ? `<form class="form" data-academic-review="${esc(decision.id)}" data-period="${esc(period.id)}">
              <label class="field"><span>Decision outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
              <label class="field"><span>Review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review academic decision</button></div></form>` : ""}
          </section>`).join("")}</section>`;
      }).join("")}
    </section>`;
  }
  function bind(root,state,{api,act,loadDetail}) {
    const base = `/api/registry/programmes/${state.detail?.id}/academic`;
    root.querySelector("[data-academic-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    root.querySelectorAll("[data-academic-policy], [data-academic-publish], [data-academic-setup], [data-academic-request], [data-academic-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const data = new FormData(form),values = Object.fromEntries(data);
      let path,body,notice;
      if (form.hasAttribute("data-academic-policy")) {
        const rules = Object.fromEntries(["minGpa","minPassedCredits","maxFailedCredits","maxOutstandingCoreCourses","maxAttempts"].map((key) => [key,Number(values[key])])); rules.allowPassedRetake = data.has("allowPassedRetake"); rules.recognisedCredits = data.has("recognisedCredits");
        path = `${base}/policies`; body = {code:values.code,name:values.name,gpaRuleSetId:values.gpaRuleSetId,rules,reason:values.reason}; notice = "Academic policy drafted.";
      } else if (form.dataset.academicPublish) {path = `${base}/policies/${form.dataset.academicPublish}/publish`; body = values; notice = "Academic policy published.";}
      else if (form.dataset.academicSetup) {path = `/api/registry/programmes/${state.detail.id}/registration-periods/${form.dataset.academicSetup}`; body = {academicPolicyId:values.academicPolicyId,repeatCourseIds:data.getAll("repeatCourseIds"),reason:values.reason}; notice = "Academic setup saved.";}
      else if (form.dataset.academicRequest) {
        const repeat = values.decision.startsWith("repeat:"); path = `${base}/${form.dataset.academicRequest}/decisions`;
        body = {kind:repeat ? "repeat" : "progression",...(repeat ? {courseId:values.decision.slice(7),revision:Number(values.revision)} : {}),evidenceHash:values.evidenceHash,expiresOn:values.expiresOn,evidenceRef:values.evidenceRef,reason:values.reason}; notice = "Academic decision requested.";
      } else {path = `${base}/${form.dataset.period}/decisions/${form.dataset.academicReview}/review`; body = values; notice = "Academic decision reviewed.";}
      act(async () => {await api("POST",path,body); await loadDetail(state.detail.id); state.notice = notice;});
    }));
  }
  window.registryAcademicUI = {render,bind};
})();
