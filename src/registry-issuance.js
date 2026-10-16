(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const day = (value) => value ? String(value).slice(0,10) : "";
  const kindLabel = {progressive:"Transcript",certificate:"Certificate"};
  // Register of official documents issued, superseded, and revoked within the reader's scope, with CSV export.
  function render(state) {
    const data = state.issuance;
    if (!data) return "";
    const f = data.filters;
    return `<details class="registry-issuance" data-issuance-panel ${state.issuanceOpen ? "open" : ""}><summary>Issued documents (${data.rows.length})</summary>
      <form class="form form-grid" data-issuance-filter>
        <label class="field"><span>Document</span><select class="input" name="kind"><option value="">All</option>${Object.entries(kindLabel).map(([value,label]) => `<option value="${value}" ${f.kind === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>Status</span><select class="input" name="status"><option value="">All</option>${["issued","superseded","revoked"].map((value) => `<option value="${value}" ${f.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="field"><span>Issued from</span><input class="input" type="date" name="from" value="${esc(f.from)}"></label><label class="field"><span>Issued to</span><input class="input" type="date" name="to" value="${esc(f.to)}"></label>
        <label class="field"><span>Reference, student number, or name</span><input class="input" name="q" maxlength="100" value="${esc(f.q)}"></label>
        <div class="button-row"><button class="button button-primary" type="submit">Filter</button><button class="button button-secondary" type="button" data-issuance-csv>Download CSV</button></div></form>
      <p data-issuance-totals>${data.totals.issued} current, ${data.totals.superseded} superseded, ${data.totals.revoked} revoked - ${data.totals.progressive} transcript(s), ${data.totals.certificate} certificate(s)</p>
      ${data.rows.length ? `<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Reference</th><th>Document</th><th>Student</th><th>Issued</th><th>Status</th></tr></thead><tbody>
        ${data.rows.map((row) => `<tr data-issuance-row="${esc(row.referenceNumber || row.id)}"><td>${esc(row.referenceNumber || row.verificationCode)}</td><td>${esc(kindLabel[row.kind])}${row.templateVersion ? ` (template v${row.templateVersion})` : ""}</td>
          <td>${esc(row.studentNumber)}<br>${esc(row.studentName)}</td><td>${esc(day(row.issuedAt))}</td><td>${esc(row.status)}${row.revokedAt ? ` ${esc(day(row.revokedAt))}: ${esc(row.revokeReason)}` : row.supersededAt ? ` ${esc(day(row.supersededAt))}` : ""}</td></tr>`).join("")}</tbody></table></div>` : "<p>No documents match.</p>"}
    </details>`;
  }
  async function load(state,api,filters = {}) {
    state.issuance = await api("GET",`/api/reports/document-issuance?${new URLSearchParams(Object.entries(filters).filter(([,value]) => value))}`).catch(() => null);
  }
  function bind(root,state,{api,act}) {
    root.querySelector("[data-issuance-panel]")?.addEventListener("toggle",(event) => {if (event.currentTarget.isConnected) state.issuanceOpen = event.currentTarget.open;});
    root.querySelector("[data-issuance-filter]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      act(() => load(state,api,values));
    });
    root.querySelector("[data-issuance-csv]")?.addEventListener("click",() => act(async () => {
      // Export exactly what is displayed: the filters the list was loaded with, not unsubmitted form edits.
      const {format,...applied} = state.issuance.filters;
      const result = await api("GET",`/api/reports/document-issuance?${new URLSearchParams({...Object.fromEntries(Object.entries(applied).filter(([,value]) => value)),format:"csv"})}`);
      const url = URL.createObjectURL(new Blob([result.csv],{type:"text/csv"})),link = document.createElement("a");
      link.href = url; link.download = result.fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
      state.notice = `Exported ${result.rows} document record(s).`;
    }));
  }
  window.registryIssuanceUI = {render,load,bind};
})();
