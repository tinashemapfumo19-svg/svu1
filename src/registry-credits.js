(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  function render(state) {
    const data = state.credits;
    if (!data) return "";
    return `<section class="registry-credits"><header class="section-header"><h3>Credit recognition</h3><button class="button button-secondary" type="button" data-credit-refresh>Refresh credits</button></header>
      ${data.capabilities.request ? `<details><summary>Request course recognition</summary><form class="form form-grid" data-credit-request>
        <label class="field"><span>Target course</span><select class="input" name="courseId" required>${data.curriculum.map((row) => `<option value="${esc(row.courseId)}">${esc(row.code)} - ${row.credits} credits</option>`).join("")}</select></label>
        <label class="field"><span>Academic policy</span><select class="input" name="policyId" required><option value="">Select policy</option>${data.policies.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} - v${row.version}</option>`).join("")}</select></label>
        <label class="field"><span>Credit type</span><select class="input" name="kind"><option value="internal_transfer">Internal transfer</option><option value="external_transfer">External transfer</option><option value="exemption">Exemption</option></select></label>
        <label class="field" data-credit-internal><span>Published source course</span><select class="input" name="internalSource" required><option value="">Select source</option>${data.sources.map((row,index) => `<option value="${index}">${esc(row.programmeCode)} - ${esc(row.code)} (${row.credits} credits)</option>`).join("")}</select></label>
        ${[["institution","Source institution","text"],["course","Source course / qualification","text"],["reference","Source record reference","text"],["credits","Source credits","number"],["completedOn","Source completed","date"]].map(([name,label,type]) => `<label class="field" data-credit-external hidden><span>${label}</span><input class="input" name="${name}" type="${type}" ${type === "number" ? 'min="0.5" max="480" step="0.5"' : 'maxlength="300"'} required disabled></label>`).join("")}
        <label class="field"><span>Recognition evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Request expires</span><input class="input" name="expiresOn" type="date" required></label>
        <label class="field"><span>Recognition reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Request credit recognition</button></div></form></details>` : ""}
      ${data.recognitions.length ? `<details data-credit-history ${data.recognitions.some((row) => row.status === "requested") ? "open" : ""}><summary>Recognition decisions (${data.recognitions.length})</summary>${data.recognitions.map((row) => `<section class="credit-decision" data-credit-decision="${esc(row.id)}"><header class="section-header"><h4>${esc(data.curriculum.find((course) => course.courseId === row.courseId)?.code || row.courseId)} - ${row.credits} credits</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.kind.replaceAll("_"," "))} - completed ${esc(row.completedOn)} - GPA excluded</p><p>${esc(row.reason)}</p><p>${esc(row.evidenceRef)} - request expires ${esc(row.expiresOn)}</p>
        ${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}${row.revokeReason ? `<p>${esc(row.revokeReason)}</p>` : ""}
        ${data.capabilities.approve && row.requestedBy !== data.accountId && ["requested","approved"].includes(row.status) ? `<form class="form" data-credit-review="${esc(row.id)}">
          <label class="field"><span>Recognition outcome</span><select class="input" name="outcome">${row.status === "requested" ? `<option value="approved">Approve</option><option value="rejected">Reject</option>` : `<option value="revoked">Revoke</option>`}</select></label>
          <label class="field"><span>Recognition review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review credit recognition</button></div></form>` : ""}
      </section>`).join("")}</details>` : ""}</section>`;
  }
  function bind(root,state,{api,act,loadDetail}) {
    const base = `/api/registry/programmes/${state.detail.id}/credits`;
    root.querySelector("[data-credit-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    const request = root.querySelector("[data-credit-request]");
    request?.elements.kind.addEventListener("change",() => {
      const internal = request.elements.kind.value === "internal_transfer";
      request.querySelector("[data-credit-internal]").hidden = !internal; request.elements.internalSource.disabled = !internal;
      request.querySelectorAll("[data-credit-external]").forEach((label) => {label.hidden = internal; label.querySelector("input").disabled = internal;});
    });
    root.querySelectorAll("[data-credit-request], [data-credit-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      const selected = state.credits.sources[Number(values.internalSource)];
      const body = form.hasAttribute("data-credit-request") ? {courseId:values.courseId,policyId:values.policyId,kind:values.kind,
        source:values.kind === "internal_transfer" ? {registrationId:selected?.registrationId,courseId:selected?.courseId} : {institution:values.institution,course:values.course,reference:values.reference,credits:Number(values.credits),completedOn:values.completedOn},
        evidenceRef:values.evidenceRef,expiresOn:values.expiresOn,reason:values.reason} : values;
      act(async () => {await api("POST",`${base}${form.dataset.creditReview ? `/${form.dataset.creditReview}/review` : ""}`,body); await loadDetail(state.detail.id); state.notice = form.dataset.creditReview ? "Credit recognition reviewed." : "Credit recognition requested.";});
    }));
  }
  window.registryCreditsUI = {render,bind};
})();
