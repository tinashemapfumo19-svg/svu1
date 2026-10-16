(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const categories = {marking_error:"Marking error",transcription_error:"Transcription error",moderation:"Moderation",appeal:"Appeal",academic_misconduct:"Academic misconduct"};
  // Published batches show the official mark, which reflects approved amendments; the published mark stays visible.
  function table(rows,official = []) {
    const current = (row) => official.find((entry) => entry.registrationId === row.registrationId && entry.courseId === row.courseId && entry.revision > 0);
    return `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student</th><th>Course</th><th>Mark</th><th>Grade</th></tr></thead><tbody>${rows.map((row) => {const amended = current(row);
      return `<tr data-result-row="${esc(row.registrationId)}:${esc(row.courseId)}"><td>${esc(row.studentNumber)}</td><td>${esc(row.code)}</td><td>${amended ? `${amended.snapshot.mark} (amended from ${row.mark})` : row.mark}</td><td>${esc(amended ? amended.snapshot.grade : row.grade)}</td></tr>`;}).join("")}</tbody></table></div>`;
  }
  function amendments(data,period,official,list,batch) {
    if (batch.status !== "published") return "";
    const open = new Set(list.filter((row) => row.status === "requested").map((row) => `${row.registrationId}:${row.courseId}`));
    const choices = official.filter((row) => !open.has(`${row.registrationId}:${row.courseId}`));
    return `${data.capabilities["amend.request"] && choices.length ? `<details><summary>Request result amendment</summary><form class="form form-grid" data-result-amend="${esc(period.id)}">
        <label class="field"><span>Result to amend</span><select class="input" name="result">${choices.map((row) => `<option value="${esc(row.registrationId)}|${esc(row.courseId)}|${row.revision}">${esc(row.snapshot.studentNumber)} ${esc(row.snapshot.code)} - ${row.snapshot.mark}</option>`).join("")}</select></label>
        <label class="field"><span>Amended mark</span><input class="input" name="mark" type="number" min="0" max="100" step="1" required></label>
        <label class="field"><span>Amendment category</span><select class="input" name="category">${Object.entries(categories).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label class="field"><span>Amendment evidence</span><input class="input" name="evidenceRef" maxlength="300" required></label>
        <label class="field"><span>Amendment reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
        <div><button class="button button-primary" type="submit">Request amendment</button></div></form></details>` : ""}
      ${list.map((row) => `<section class="result-amendment" data-result-amendment="${row.id}"><header class="section-header"><h4>${esc(row.from.studentNumber)} ${esc(row.from.code)}: ${row.from.mark} to ${row.to.mark} (${esc(row.to.grade)})</h4><strong>${esc(row.status)}</strong></header>
        <p>${esc(categories[row.category])} - ${esc(row.reason)} - evidence ${esc(row.evidenceRef)}</p>${row.reviewReason ? `<p>${esc(row.reviewReason)}</p>` : ""}
        ${data.capabilities["amend.approve"] && row.status === "requested" && row.requestedBy !== data.accountId ? `<form class="form form-grid" data-amendment-review="${row.id}" data-period="${esc(period.id)}">
          <label class="field"><span>Amendment decision</span><select class="input" name="outcome"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
          <label class="field"><span>Amendment review reason</span><input class="input" name="reason" maxlength="2000" required></label><div><button class="button button-primary" type="submit">Review amendment</button></div></form>` : ""}
      </section>`).join("")}`;
  }
  function render(state) {
    const data = state.results;
    if (!data) return state.resultsUnavailable ? `<section class="registry-results"><header class="section-header"><h3>Results</h3><button class="button button-secondary" type="button" data-results-refresh>Refresh results</button></header></section>` : "";
    return `<section class="registry-results"><header class="section-header"><h3>Results</h3><button class="button button-secondary" type="button" data-results-refresh>Refresh results</button></header>
      ${data.periods.length ? data.periods.map(({period,roster,batches,official = [],amendments: changes = [],completion}) => `<section class="result-period" data-result-period="${esc(period.id)}">
        <h3>${esc(period.name)}</h3><p>${roster.length} enrolled course records</p>
        ${completion ? `<dl class="result-completion" data-result-completion="${esc(period.id)}">${[['awaitingRecording','Awaiting recording'],['awaitingReview','Awaiting review'],['awaitingPublication','Awaiting publication'],['publishedRecords','Officially published']].map(([id,label]) => `<div><dt>${label}</dt><dd data-result-completion-count="${id}">${esc(completion.counts[id])}</dd></div>`).join('')}</dl>
          ${!completion.sourceCurrent ? `<p role="status" data-result-source-changed>Recorded source differs from the confirmed roster.</p>` : ''}
          ${completion.counts.outsideRosterRecords ? `<p>${esc(completion.counts.outsideRosterRecords)} recorded course result(s) outside the confirmed roster</p>` : ''}
          ${completion.counts.rejectedBatches ? `<p>${esc(completion.counts.rejectedBatches)} retained rejected batch(es)</p>` : ''}` : ''}
        ${data.capabilities.import && period.status === "closed" && roster.length && !batches.some((batch) => batch.status !== "rejected") ? `<details><summary>Import results</summary>
          <button class="button button-secondary" type="button" data-result-roster="${esc(period.id)}">Download roster</button>
          <form class="form" data-result-import="${esc(period.id)}">
          <label class="field"><span>Result export</span><input class="input" type="file" name="export" accept=".json,application/json" required></label>
          <label class="field"><span>GPA policy</span><select class="input" name="gpaRuleSetId" required><option value="">Select policy</option>${data.policies.map((policy) => `<option value="${esc(policy.id)}">${esc(policy.name)} - v${policy.version}</option>`).join("")}</select></label>
          <label class="field"><span>Import reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
          <div><button class="button button-primary" type="submit">Import result batch</button></div></form></details>` : ""}
        ${batches.length ? batches.map((batch) => `<section class="result-batch" data-result-batch="${esc(batch.id)}">
          <header class="section-header"><h4>${esc(batch.sourceRef)}</h4><strong>${esc(batch.status)}</strong></header>
          <p>${batch.rowCount} rows - mark total ${batch.markTotal}</p><p class="result-checksum">${esc(batch.checksum)}</p>
          ${table(batch.rows,official)}<p>${esc(batch.importReason)}</p>
          ${batch.evidenceRef ? `<p>${esc(batch.evidenceRef)} - ${esc(batch.reviewReason)}</p>` : ""}
          ${data.capabilities.review && batch.status === "draft" && batch.createdBy !== data.accountId ? `<form class="form" data-result-review="${esc(batch.id)}" data-period="${esc(period.id)}">
            <label class="field"><span>Review decision</span><select class="input" name="outcome"><option value="reviewed">Approve review</option><option value="rejected">Reject batch</option></select></label>
            <label class="field"><span>Evidence reference</span><input class="input" name="evidenceRef" maxlength="300" required></label>
            <label class="field"><span>Review reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
            <div><button class="button button-primary" type="submit">Record result review</button></div></form>` : ""}
          ${data.capabilities.publish && batch.status === "reviewed" && batch.createdBy !== data.accountId ? `<form class="form" data-result-publish="${esc(batch.id)}" data-period="${esc(period.id)}">
            <label class="field"><span>Publication reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>
            <div><button class="button button-primary" type="submit">Publish results</button></div></form>` : ""}
          ${batch.publishedAt ? `<p>Published ${esc(new Date(batch.publishedAt).toLocaleDateString())}</p>` : ""}
          ${amendments(data,period,official.filter((row) => row.snapshot && batch.status === "published"),changes.filter((row) => row.batchId === batch.id),batch)}
        </section>`).join("") : `<p>No result batches</p>`}
      </section>`).join("") : `<p>No registration periods</p>`}
    </section>`;
  }
  function bind(root,state,{api,act,loadDetail}) {
    const base = `/api/registry/programmes/${state.detail?.id}/results`;
    root.querySelector("[data-results-refresh]")?.addEventListener("click",() => act(() => loadDetail(state.detail.id)));
    root.querySelectorAll("[data-result-roster]").forEach((button) => button.addEventListener("click",() => {
      const period = state.results.periods.find((entry) => entry.period.id === button.dataset.resultRoster);
      const rows = period.roster.map(({registrationId,courseId}) => ({registrationId,courseId,mark:null}));
      const url = URL.createObjectURL(new Blob([JSON.stringify({sourceRef:"",rows,expectedRowCount:rows.length,expectedMarkTotal:null,checksum:null},null,2)],{type:"application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = `results-roster-${period.period.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
    root.querySelectorAll("[data-result-import]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = new FormData(form),file = values.get("export"),periodId = form.dataset.resultImport;
      act(async () => {
        if (file.size > 2_000_000) throw new Error("Result exports must be under 2 MB.");
        const input = JSON.parse(await file.text());
        await api("POST",`${base}/${periodId}/batches`,{...input,gpaRuleSetId:values.get("gpaRuleSetId"),reason:values.get("reason")});
        await loadDetail(state.detail.id); state.notice = "Result batch imported and reconciled.";
      });
    }));
    for (const action of ["review","publish"]) root.querySelectorAll(`[data-result-${action}]`).forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const input = Object.fromEntries(new FormData(form)),batchId = form.dataset[action === "review" ? "resultReview" : "resultPublish"],periodId = form.dataset.period;
      act(async () => {
        await api("POST",`${base}/${periodId}/batches/${batchId}/${action}`,input);
        await loadDetail(state.detail.id); state.notice = action === "review" ? "Result review recorded." : "Results published.";
      });
    }));
    root.querySelectorAll("[data-result-amend]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form)),[registrationId,courseId,revision] = values.result.split("|");
      act(async () => {
        await api("POST",`${base}/${form.dataset.resultAmend}/amendments`,{registrationId,courseId,revision:Number(revision),mark:Number(values.mark),category:values.category,evidenceRef:values.evidenceRef,reason:values.reason});
        await loadDetail(state.detail.id); state.notice = "Result amendment requested.";
      });
    }));
    root.querySelectorAll("[data-amendment-review]").forEach((form) => form.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(form));
      act(async () => {
        await api("POST",`${base}/${form.dataset.period}/amendments/${form.dataset.amendmentReview}/review`,values);
        await loadDetail(state.detail.id); state.notice = "Result amendment reviewed.";
      });
    }));
  }
  window.registryResultsUI = {render,bind};
})();
