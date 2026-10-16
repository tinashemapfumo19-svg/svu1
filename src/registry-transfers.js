(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  function render(state) {
    const data = state.transfers;
    if (!data) return "";
    return `<section class="registry-transfers"><header class="section-header"><h3>Programme transfers</h3><button class="button button-secondary" type="button" data-transfer-refresh>Refresh transfers</button></header>
      ${data.capabilities.request && !data.blockers.length ? `<details><summary>Request transfer</summary><form class="form form-grid" data-transfer-request>
        <input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="evidenceHash" value="${esc(data.evidenceHash)}">
        <label class="field"><span>Destination programme / intake / curriculum</span><select class="input" name="destination" required><option value="">Select destination</option>${data.destinations.map((row,index) => `<option value="${index}">${esc(row.programmeCode)} - ${esc(row.intakeLabel)} - ${esc(row.versionLabel)}</option>`).join("")}</select></label>
        <label class="field"><span>Request expires</span><input class="input" name="expiresOn" type="date" required></label>
        <label class="field"><span>Transfer evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Transfer reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Request transfer</button></div></form></details>` : ""}
      ${data.blockers.map((message) => `<p class="muted">${esc(message)}</p>`).join("")}
      ${data.requests.length ? `<details data-transfer-history ${data.requests.some((row) => row.status === "requested") ? "open" : ""}><summary>Transfer decisions (${data.requests.length})</summary>${data.requests.map((row) => `<section class="transfer-decision"><header class="section-header"><h4>${esc(row.programmeCode)} - ${esc(row.intakeLabel)} - ${esc(row.versionLabel)}</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(row.reason)}</p><p>${esc(row.evidenceRef)} - expires ${esc(row.expiresOn)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
        ${row.sourceProgrammeId !== data.programmeId ? `<button class="button button-secondary" type="button" data-transfer-target="${esc(row.sourceProgrammeId)}">Open source record</button>` : ""}
        ${row.targetProgrammeId && row.targetProgrammeId !== data.programmeId ? `<button class="button button-secondary" type="button" data-transfer-target="${esc(row.targetProgrammeId)}">Open destination record</button>` : ""}
        ${data.capabilities.approve && row.sourceProgrammeId === data.programmeId && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form" data-transfer-review="${esc(row.id)}">
          <label class="field"><span>Transfer outcome</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Transfer review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label><div><button class="button button-primary" type="submit">Review transfer</button></div></form>` : ""}
      </section>`).join("")}</details>` : ""}</section>`;
  }
  function bind(root,state,{api,act,loadDetail,load}) {
    const base = `/api/registry/programmes/${state.detail.id}/transfers`;
    root.querySelector("[data-transfer-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    root.querySelectorAll("[data-transfer-target]").forEach((button) => button.addEventListener("click",() => act(() => loadDetail(button.dataset.transferTarget))));
    root.querySelectorAll("[data-transfer-request], [data-transfer-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      if (form.hasAttribute("data-transfer-request")) {
        const destination = state.transfers.destinations[Number(values.destination)];
        delete values.destination; values.intakeId = destination?.intakeId; values.programmeVersionId = destination?.programmeVersionId; values.revision = Number(values.revision);
      }
      act(async () => {await api("POST",`${base}${form.dataset.transferReview ? `/${form.dataset.transferReview}/review` : ""}`,values); await loadDetail(state.detail.id); await load(state.filters);
        state.notice = form.dataset.transferReview ? "Transfer reviewed." : "Transfer requested.";});
    }));
  }
  window.registryTransfersUI = {render,bind};
})();
