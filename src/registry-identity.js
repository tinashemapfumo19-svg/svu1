(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const labels = {legalName:"Legal name",preferredName:"Preferred name",dateOfBirth:"Date of birth",nationalityCode:"Nationality"};
  const fields = Object.keys(labels);
  function changesFrom(form,identity) {
    return Object.fromEntries(fields.map((field) => [field,form.elements[field].value.trim()]).filter(([field,value]) => value && value !== (identity[field] ?? "")));
  }
  function decisions(data,reviewable) {
    return data.requests.map((row) => `<section class="identity-decision" data-identity-decision="${esc(row.id)}"><header class="section-header"><h4>${row.channel === "self" ? "Student request" : "Registry request"}</h4><strong>${esc(row.status)}</strong></header>
      <ul>${Object.entries(row.changes).map(([field,value]) => `<li>${labels[field]}: ${esc(row.currentSnapshot[field] || "not recorded")} to ${esc(value)}</li>`).join("")}</ul>
      <p>${esc(row.reason)}</p><p>Evidence: ${esc(row.evidenceRef)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
      ${reviewable && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form" data-identity-review="${esc(row.id)}">
        <label class="field"><span>Identity outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
        <label class="field"><span>Identity review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review identity correction</button></div></form>` : ""}
    </section>`).join("");
  }
  function form(data,attribute,submitLabel) {
    return `<form class="form form-grid" ${attribute}><input type="hidden" name="revision" value="${data.revision}">
      ${fields.map((field) => `<label class="field"><span>${labels[field]}</span><input class="input" name="${field}" ${field === "dateOfBirth" ? 'type="date"' : field === "nationalityCode" ? 'maxlength="2" pattern="[A-Z]{2}"' : 'maxlength="200"'} value="${esc(data.identity[field])}"></label>`).join("")}
      <label class="field"><span>Identity evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
      <label class="field"><span>Correction reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
      <div><button class="button button-primary" type="submit">${submitLabel}</button></div></form>`;
  }
  function render(state) {
    const data = state.identity;
    if (!data) return "";
    const open = data.requests.some((row) => row.status === "requested");
    return `<section class="registry-identity"><header class="section-header"><h3>Identity</h3><button class="button button-secondary" type="button" data-identity-refresh>Refresh identity</button></header>
      <dl class="identity-summary">${fields.map((field) => `<div><dt>${labels[field]}</dt><dd>${esc(data.identity[field] || "Not recorded")}</dd></div>`).join("")}</dl>
      <p>Identity revision ${data.revision}</p>
      ${data.capabilities.request && !open ? `<details><summary>Request identity correction</summary>${form(data,"data-identity-request","Request identity correction")}</details>` : ""}
      ${data.requests.length ? `<details data-identity-history ${open ? "open" : ""}><summary>Identity corrections (${data.requests.length})</summary>${decisions(data,data.capabilities.approve)}</details>` : ""}</section>`;
  }
  function bind(root,state,{api,act,loadDetail,load}) {
    const base = `/api/registry/programmes/${state.detail.id}/identity`;
    root.querySelector("[data-identity-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    root.querySelector("[data-identity-request]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const target = event.currentTarget;
      const body = {revision:Number(target.elements.revision.value),changes:changesFrom(target,state.identity.identity),evidenceRef:target.elements.evidenceRef.value,reason:target.elements.reason.value};
      act(async () => {await api("POST",base,body); await loadDetail(state.detail.id); state.notice = "Identity correction requested.";});
    });
    root.querySelectorAll("[data-identity-review]").forEach((target) => target.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(target));
      act(async () => {await api("POST",`${base}/${target.dataset.identityReview}/review`,values); await loadDetail(state.detail.id); await load(state.filters); state.notice = "Identity correction reviewed.";});
    }));
  }
  window.registryIdentityUI = {render,bind,form,decisions,changesFrom,labels};
})();
