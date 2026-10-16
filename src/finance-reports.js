(function () {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const amount = (minor) => {const value = BigInt(minor),absolute = value < 0n ? -value : value;return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2,'0')}`;};
  const columns = [["accounts","Programme accounts"],["opening","Opening"],["charged","Charged"],["paid","Paid"],["credited","Credited"],["balance","Balance"],["outstanding","Outstanding"],["due","Due"],["unallocated","Unallocated credit"]];
  function render(state) {
    const data = state.controlTotals;
    if (!data) return state.financeReportError ? `<section class="finance-reports" data-control-totals><header class="section-header"><h2>Finance control totals</h2></header><div class="notice notice-warning" role="alert">${esc(state.financeReportError)}</div><form class="form form-grid" data-control-asof><label class="field"><span>Recording cutoff</span><input class="input" name="asOf" type="date" value="${esc(state.financeReportFilters?.asOf || new Date().toISOString().slice(0,10))}" required></label><label class="field"><span>Currency</span><input class="input" name="currency" maxlength="3" pattern="[A-Z]{3}" value="${esc(state.financeReportFilters?.currency)}"></label><button class="button button-secondary" type="submit">Run report</button></form></section>` : '';
    const cell = (key,value) => key === "accounts" ? value : amount(value);
    return `<section class="finance-reports" data-control-totals><header class="section-header"><h2>Finance control totals</h2><span>As of ${esc(data.asOf)} (UTC)</span></header>
      <p>${esc(window.svuUI.dateTime(data.generatedAt))} - ${esc(data.definitionVersion)}</p>
      <form class="form form-grid" data-control-asof><label class="field"><span>Recording cutoff</span><input class="input" name="asOf" type="date" value="${esc(data.asOf)}" required></label>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${(data.availableIntakes || []).map((row) => `<option value="${esc(row.intakeId)}" ${data.filters.intakeId === row.intakeId ? 'selected' : ''}>${esc(row.programmeCode)} - ${esc(row.intakeLabel)}</option>`).join('')}</select></label>
        <label class="field"><span>Currency</span><select class="input" name="currency"><option value="">All currencies</option>${[...new Set([...data.totals.map((row) => row.currency),data.filters.currency].filter(Boolean))].map((code) => `<option value="${esc(code)}" ${data.filters.currency === code ? 'selected' : ''}>${esc(code)}</option>`).join('')}</select></label>
        <div class="hero-actions"><button class="button button-secondary" type="submit">Run report</button><button class="button button-secondary" type="button" data-control-csv ${data.rows.length ? "" : "disabled"}>Download CSV</button></div></form>
      ${data.totals.map((row) => `<div class="control-total" data-control-currency="${esc(row.currency)}"><strong>${esc(row.currency)} total</strong>
        <dl class="finance-summary">${columns.map(([key,label]) => `<div><dt>${label}</dt><dd>${esc(cell(key,row[key]))}</dd></div>`).join("")}</dl>
        <p>${row.reconciles ? "Outstanding charges less unallocated credit agree with the balance for every programme." : "Reconciliation difference found. Check the rows below."}</p></div>`).join("") || "<p>No ledger activity in your finance scope.</p>"}
      ${data.unmatchedQueue?.length ? `<p data-control-queue>Current unmatched statement lines (${esc(window.svuUI.dateTime(data.unmatchedQueueAsOf))}): ${data.unmatchedQueue.map((row) => `${row.lines} line(s), ${esc(row.currency)} ${amount(row.amount)}`).join("; ")}</p>` : ""}
      ${data.rows.length ? `<details><summary>By programme and intake (${data.rows.length})</summary><ul class="control-rows">${data.rows.map((row) => `<li><strong>${esc(row.programmeCode)} - ${esc(row.intakeLabel)} (${esc(row.currency)})</strong><span>${columns.map(([key,label]) => `${label} ${esc(cell(key,row[key]))}`).join(" | ")}</span>${row.reconciles ? "" : "<span>Does not reconcile</span>"}</li>`).join("")}</ul></details>` : ""}
      <details data-finance-definitions ${state.financeDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(data.definitionVersion)}</summary>${data.metrics.map((entry) => `<details class="report-definition"><summary>${esc(entry.label)}</summary><dl>${['owner','approval','unit','formula','exclusions','filters','refresh'].map((key) => `<dt>${key.charAt(0).toUpperCase()+key.slice(1)}</dt><dd>${esc(entry[key])}</dd>`).join('')}</dl></details>`).join('')}</details>
    </section>`;
  }
  async function load(state,api,filters = {}) {
    const token = state.session?.token;
    try {
      const data = await api('GET',`/api/finance/reports/control-totals?${new URLSearchParams(filters)}`);
      if (token !== state.session?.token) return;
      state.controlTotals = data;state.financeReportError = null;state.financeReportFilters = data.filters;
    } catch(error) {
      if (token !== state.session?.token) return;
      state.controlTotals = null;
      // Initial cross-domain loading tolerates absent finance authority; explicit report failures stay actionable.
      state.financeReportError = Object.keys(filters).length ? error.message : null;state.financeReportFilters = filters;
    }
  }
  function bind(root,state,{api,act}) {
    root.querySelector("[data-control-asof]")?.addEventListener("submit",(event) => {
      event.preventDefault(); const filters = Object.fromEntries(new FormData(event.currentTarget)); act(() => load(state,api,filters));
    });
    root.querySelector('[data-finance-definitions]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.financeDefinitionsOpen = event.currentTarget.open;});
    root.querySelector("[data-control-csv]")?.addEventListener("click",() => act(async () => {
      const result = await api('GET',`/api/finance/reports/control-totals?${new URLSearchParams({...state.controlTotals.filters,format:'csv'})}`);
      const link = document.createElement("a");
      const url = URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));link.href = url;
      link.download = result.fileName;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.financeReportsUI = {render,bind,load};
})();
