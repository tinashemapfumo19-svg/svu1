(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const labels = {status:"Programme active",core:"Core courses",credits:"Credits",electives:"Elective credits",gpa:"Cumulative GPA"};
  const today = () => new Date().toISOString().slice(0,10);
  const ruleSummary = (rule) => `${esc(rule.rules.awardTitle)}: ${rule.rules.minCredits} credits (${rule.rules.minElectiveCredits} elective), GPA ${rule.rules.minCumulativeGpa}+`;

  function checks(audit) {
    return `<ul class="award-checks">${audit.checks.map((row) => `<li data-award-check="${esc(row.code)}" data-met="${row.met}"><strong>${row.met ? "Met" : "Not met"}</strong> ${esc(labels[row.code])}: ${esc(row.detail)}</li>`).join("")}</ul>`;
  }
  function courses(audit) {
    return `<details><summary>Curriculum courses (${audit.courses.filter((row) => row.satisfied).length} of ${audit.courses.length} satisfied)</summary><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Year</th><th>Course</th><th>Type</th><th>Credits</th><th>Outcome</th></tr></thead><tbody>
      ${audit.courses.map((row) => `<tr data-award-course="${esc(row.code)}"><td>${row.yearOfStudy}</td><td>${esc(row.code)} ${esc(row.title)}</td><td>${esc(row.requirementType)}</td><td>${row.credits}</td><td>${esc(row.outcome)}${row.mark !== null ? ` (${row.mark})` : ""}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function staffRender(state) {
    const data = state.award;
    if (!data) return "";
    const can = data.capabilities,open = data.requests.find((row) => row.status === "requested");
    return `<section class="registry-award" data-registry-award><header class="section-header"><h3>Graduation and award</h3><strong data-award-status>${data.award ? "Conferred" : data.audit?.eligible ? "Eligible" : "Not yet eligible"}</strong></header>
      ${data.award ? `<p class="notice" data-award-conferred>${esc(data.award.awardTitle)}${data.award.classification ? ` - ${esc(data.award.classification)}` : ""}, conferred ${esc(data.award.conferredOn)}</p>` : ""}
      ${data.published ? `<p data-award-rules>Completion rules v${data.published.version}: ${ruleSummary(data.published)}</p>` : "<p>No completion rules are published for this curriculum.</p>"}
      ${data.draft ? `<section data-award-draft="${esc(data.draft.id)}"><p>Draft v${data.draft.version} awaiting publication: ${ruleSummary(data.draft)}</p>
        ${can.publishRules && data.draft.createdBy !== data.accountId ? `<form class="form form-grid" data-award-rules-publish="${esc(data.draft.id)}"><label class="field"><span>Rules publication reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Publish completion rules</button></div></form>` : ""}</section>` : ""}
      ${can.manageRules && !data.draft ? `<details><summary>${data.published ? "Propose new completion rules" : "Draft completion rules"}</summary><form class="form form-grid" data-award-rules-draft>
        <label class="field"><span>Award title</span><input class="input" name="awardTitle" maxlength="200" value="${esc(data.published?.rules.awardTitle)}" required></label>
        <label class="field"><span>Minimum credits</span><input class="input" type="number" name="minCredits" min="0" max="1000" step="0.5" value="${data.published?.rules.minCredits ?? ""}" required></label>
        <label class="field"><span>Minimum elective credits</span><input class="input" type="number" name="minElectiveCredits" min="0" max="1000" step="0.5" value="${data.published?.rules.minElectiveCredits ?? 0}" required></label>
        <label class="field"><span>Minimum cumulative GPA</span><input class="input" type="number" name="minCumulativeGpa" min="0" max="10" step="0.01" value="${data.published?.rules.minCumulativeGpa ?? ""}" required></label>
        <label class="field"><span>GPA policy</span><select class="input" name="gpaRuleSetId" required>${(state.results?.policies || []).map((row) => `<option value="${esc(row.id)}" ${row.id === data.published?.gpaRuleSetId ? "selected" : ""}>${esc(row.name)} - v${row.version}</option>`).join("")}</select></label>
        <label class="field"><span>Rules reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Draft completion rules</button></div></form></details>` : ""}
      ${data.audit ? `<section data-award-audit><h4>Graduation audit</h4>${checks(data.audit)}<p>${data.audit.creditsEarned} credits earned - cumulative GPA ${data.audit.cumulativeGpa ?? "-"}${data.audit.classification ? ` (${esc(data.audit.classification)})` : ""}</p>${courses(data.audit)}</section>` : ""}
      ${can.request && data.audit?.eligible && !open && !data.award ? `<form class="form form-grid" data-award-request><input type="hidden" name="evidenceHash" value="${esc(data.audit.evidenceHash)}">
        <label class="field"><span>Conferral date</span><input class="input" type="date" name="conferredOn" value="${today()}" required></label>
        <label class="field"><span>Award request reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Request award</button></div></form>` : ""}
      ${data.requests.map((row) => `<section class="award-request" data-award-request-row="${row.id}"><header class="section-header"><h4>${esc(row.awardTitle)}${row.classification ? ` - ${esc(row.classification)}` : ""}, ${esc(row.conferredOn)}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}${row.reviewReason ? ` - ${esc(row.reviewReason)}` : ""}</p>
        ${can.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form form-grid" data-award-review="${row.id}"><label class="field"><span>Award decision</span><select class="input" name="outcome"><option value="approved">Confer award</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Award decision reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Record award decision</button></div></form>` : ""}</section>`).join("")}
    </section>`;
  }
  function staffBind(root,state,{api,act,loadDetail}) {
    if (!state.award) return;
    const base = `/api/registry/programmes/${state.detail.id}/award`;
    const submit = (selector,work) => root.querySelectorAll(selector).forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {const notice = await work(form,values); await loadDetail(state.detail.id); state.notice = notice;});
    }));
    submit("[data-award-rules-draft]",async (form,values) => {
      await api("POST",`${base}/rules`,{rules:{awardTitle:values.awardTitle,minCredits:Number(values.minCredits),minElectiveCredits:Number(values.minElectiveCredits),minCumulativeGpa:Number(values.minCumulativeGpa)},gpaRuleSetId:values.gpaRuleSetId,reason:values.reason});
      return "Completion rules drafted for publication.";
    });
    submit("[data-award-rules-publish]",async (form,values) => {await api("POST",`${base}/rules/${form.dataset.awardRulesPublish}/publish`,values); return "Completion rules published.";});
    submit("[data-award-request]",async (form,values) => {await api("POST",`${base}/requests`,values); return "Award requested for independent approval.";});
    submit("[data-award-review]",async (form,values) => {await api("POST",`${base}/requests/${form.dataset.awardReview}/review`,values); return values.outcome === "approved" ? "Award conferred." : "Award request rejected.";});
  }
  // Students see their own progress against the published rules and any conferred award.
  function studentView(data) {
    if (!data || (!data.audit && !data.award)) return "";
    return `<section class="student-award" data-student-award><h2>Graduation progress</h2>
      ${data.award ? `<p class="notice" data-award-conferred>${esc(data.award.awardTitle)}${data.award.classification ? ` - ${esc(data.award.classification)}` : ""}, conferred ${esc(data.award.conferredOn)}</p>` : ""}
      ${data.audit && !data.award ? `<p>${data.audit.eligible ? "You meet the published requirements for" : "Requirements for"} ${esc(data.audit.awardTitle)}</p>${checks(data.audit)}${courses(data.audit)}` : ""}</section>`;
  }
  window.registryAwardsUI = {staffRender,staffBind,studentView};
})();
