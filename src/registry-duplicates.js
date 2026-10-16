(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const reasons = {nameAndBirthDate:"Same legal name and birth date",phone:"Same phone",studentNumber:"Looked up by number"};
  function render(state) {
    const data = state.duplicates;
    if (!data) return "";
    const open = data.cases.some((row) => row.status === "requested");
    return `<section class="registry-duplicates"><header class="section-header"><h3>Duplicate records</h3><button class="button button-secondary" type="button" data-duplicate-refresh>Refresh duplicates</button></header>
      <form class="form form-grid" data-duplicate-lookup><label class="field"><span>Compare with student number</span><input class="input" name="studentNumber" value="${esc(state.duplicateLookup)}"></label><div><button class="button button-secondary" type="submit">Find record</button></div></form>
      ${data.candidates.length ? data.candidates.map((row) => `<section class="duplicate-candidate" data-duplicate-candidate="${esc(row.studentNumber)}"><header class="section-header"><h4>${esc(row.studentNumber)} - ${esc(row.legalName)}</h4>${row.distinct ? "<strong>confirmed distinct</strong>" : ""}</header>
        <p>${row.reasons.map((reason) => reasons[reason]).join(", ")}${row.dateOfBirth ? ` - born ${esc(row.dateOfBirth)}` : ""}</p>
        <ul>${row.programmes.map((programme) => `<li>${esc(programme.programmeCode)} - ${esc(programme.intakeLabel)} - ${esc(programme.status.replaceAll("_"," "))}</li>`).join("")}</ul>
        ${data.capabilities.request && !open ? `<details><summary>Resolve with ${esc(row.studentNumber)}</summary><form class="form form-grid" data-duplicate-request="${esc(row.id)}" data-evidence="${esc(row.evidenceHash)}">
          <label class="field"><span>Proposal</span><select class="input" name="proposal"><option value="merge">Same person - merge records</option><option value="distinct">Different people - keep separate</option></select></label>
          <label class="field"><span>Surviving record</span><select class="input" name="survivor"><option value="current">${esc(data.studentNumber)} (this record)</option><option value="candidate">${esc(row.studentNumber)}</option></select></label>
          <label class="field"><span>Duplicate evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
          <label class="field"><span>Duplicate reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
          <div><button class="button button-primary" type="submit">Request duplicate review</button></div></form></details>` : ""}</section>`).join("") : "<p>No possible duplicates found in your scope.</p>"}
      ${data.cases.length ? `<details data-duplicate-history ${open ? "open" : ""}><summary>Duplicate cases (${data.cases.length})</summary>${data.cases.map((row) => `<section class="duplicate-case" data-duplicate-case="${esc(row.id)}">
        <header class="section-header"><h4>${row.proposal === "merge" ? `Merge ${esc(row.duplicateNumber)} into ${esc(row.survivorNumber)}` : `${esc(row.survivorNumber)} and ${esc(row.duplicateNumber)} are different people`}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}</p><p>Evidence: ${esc(row.evidenceRef)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
        ${row.mergeResult ? `<p>${row.mergeResult.programmeIds.length} programme record(s) and ${row.mergeResult.enrolments} course enrolment(s) moved</p>` : ""}
        ${data.capabilities.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form" data-duplicate-review="${esc(row.id)}">
          <label class="field"><span>Duplicate outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Duplicate review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review duplicate case</button></div></form>` : ""}
      </section>`).join("")}</details>` : ""}</section>`;
  }
  async function loadDuplicates(state,api) {
    state.duplicates = await api("GET",`/api/registry/programmes/${state.detail.id}/duplicates?${new URLSearchParams(state.duplicateLookup ? {studentNumber:state.duplicateLookup} : {})}`);
  }
  function bind(root,state,{api,act,loadDetail,load}) {
    const base = `/api/registry/programmes/${state.detail.id}/duplicates`;
    root.querySelector("[data-duplicate-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    root.querySelector("[data-duplicate-lookup]")?.addEventListener("submit",(event) => {
      event.preventDefault(); state.duplicateLookup = event.currentTarget.elements.studentNumber.value.trim(); act(() => loadDuplicates(state,api));
    });
    root.querySelectorAll("[data-duplicate-request]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",base,{...values,candidateStudentId:form.dataset.duplicateRequest,evidenceHash:form.dataset.evidence}); await loadDetail(state.detail.id); state.notice = "Duplicate review requested.";});
    }));
    root.querySelectorAll("[data-duplicate-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {await api("POST",`${base}/${form.dataset.duplicateReview}/review`,values); await loadDetail(state.detail.id); await load(state.filters); state.notice = "Duplicate case reviewed.";});
    }));
  }
  window.registryDuplicatesUI = {render,bind,loadDuplicates};
})();
