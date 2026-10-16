(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const label = (status) => status === "onboarded" ? "Re-entry" : status[0].toUpperCase() + status.slice(1);
  function render(state) {
    const data = state.lifecycle;
    if (!data) return "";
    return `<section class="registry-lifecycle"><header class="section-header"><h3>Programme lifecycle</h3><button class="button button-secondary" type="button" data-lifecycle-refresh>Refresh lifecycle</button></header>
      <p>${esc(data.status)} - revision ${data.revision}</p>
      ${data.capabilities.request && data.targets.length ? `<details><summary>Request status change</summary><form class="form form-grid" data-lifecycle-request>
        <input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="evidenceHash" value="${esc(data.evidenceHash)}">
        <label class="field"><span>Programme action</span><select class="input" name="toStatus">${data.targets.map((status) => `<option value="${status}">${label(status)}</option>`).join("")}</select></label>
        <label class="field"><span>Request expires</span><input class="input" name="expiresOn" type="date" required></label>
        <label class="field" data-lifecycle-followup><span>Follow-up review</span><input class="input" name="reviewOn" type="date"></label>
        <label class="field"><span>Lifecycle evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Lifecycle reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Request programme change</button></div></form></details>` : ""}
      ${data.requests.length ? `<details data-lifecycle-history ${data.requests.some((row) => row.status === "requested") ? "open" : ""}><summary>Lifecycle decisions (${data.requests.length})</summary>${data.requests.map((row) => `<section class="lifecycle-decision" data-lifecycle-decision="${esc(row.id)}"><header class="section-header"><h4>${esc(row.fromStatus)} to ${esc(row.toStatus)}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}</p><p>${esc(row.evidenceRef)} - request expires ${esc(row.expiresOn)}</p>${row.reviewOn ? `<p>Follow-up review ${esc(row.reviewOn)}</p>` : ""}${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
        ${data.capabilities.approve && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form" data-lifecycle-review="${esc(row.id)}">
          <label class="field"><span>Lifecycle outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Lifecycle review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review programme change</button></div></form>` : ""}
      </section>`).join("")}</details>` : ""}</section>`;
  }
  function bind(root,state,{api,act,loadDetail,load}) {
    const base = `/api/registry/programmes/${state.detail.id}/lifecycle`;
    root.querySelector("[data-lifecycle-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    const request = root.querySelector("[data-lifecycle-request]");
    if (request) {
      const update = () => {const held = ["suspended","interrupted"].includes(request.elements.toStatus.value); request.querySelector("[data-lifecycle-followup]").hidden = !held; request.elements.reviewOn.disabled = !held; request.elements.reviewOn.required = held;};
      request.elements.toStatus.addEventListener("change",update); update();
    }
    root.querySelectorAll("[data-lifecycle-request], [data-lifecycle-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      if (form.hasAttribute("data-lifecycle-request")) values.revision = Number(values.revision);
      act(async () => {await api("POST",`${base}${form.dataset.lifecycleReview ? `/${form.dataset.lifecycleReview}/review` : ""}`,values); await loadDetail(state.detail.id); await load(state.filters);
        state.notice = form.dataset.lifecycleReview ? "Programme change reviewed." : "Programme change requested.";});
    }));
  }
  window.registryLifecycleUI = {render,bind};
})();
