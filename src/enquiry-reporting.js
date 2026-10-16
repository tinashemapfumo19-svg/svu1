(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value = (v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for (const key of Object.keys(state)) if (key.startsWith('enquiryReport')) delete state[key];}
  async function load(state,api,filters = state.enquiryReportFilters || {}) {
    const token = state.session?.token,generation = Symbol();state.enquiryReportGeneration = generation;
    const current = () => token === state.session?.token && generation === state.enquiryReportGeneration;
    try {
      const data = await api('GET',`/api/reports/enquiries?${new URLSearchParams(filters)}`);
      if (!current()) return;
      state.enquiryReport = data;state.enquiryReportFilters = data.filters;state.enquiryReportIntakes = null;state.enquiryReportError = null;
    } catch(error) {
      if (!current()) return;
      if ([401,403,404].includes(error.status)) {clear(state);return;}
      state.enquiryReport = null;state.enquiryReportIntakes = null;state.enquiryReportFilters = filters;state.enquiryReportError = error.message;
      const intakes = await api('GET','/api/reports/enquiries/intakes').catch(() => null);
      if (!current()) return;
      if (!intakes) {clear(state);return;}state.enquiryReportIntakes = intakes;
    }
  }
  function render(state) {
    const report = state.enquiryReport,intakes = report?.availableIntakes || state.enquiryReportIntakes,filters = report?.filters || state.enquiryReportFilters || {};
    if (!intakes) return '';
    const columns = ['enquiriesTotal','activeConsent','awaitingFirstReply','escalatedActive','enquiriesWithApplication','meanFirstReplyMinutes'];
    return `<details class="enquiry-report" data-enquiry-report ${state.enquiryReportOpen ? 'open' : ''}><summary>Prospective enquiry workload</summary>
      <header class="section-header"><h3>Prospective enquiry workload</h3>${report ? `<span>${esc(window.svuUI.dateTime(report.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-enquiry-report-filter>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((r) => `<option value="${esc(r.intakeId)}" ${filters.intakeId === r.intakeId ? 'selected' : ''}>${esc(r.programmeCode)} - ${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Created from (UTC)</span><input class="input" name="from" type="date" value="${esc(filters.from)}"></label>
        <label class="field"><span>Created through (UTC)</span><input class="input" name="to" type="date" value="${esc(filters.to)}"></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh enquiry report" aria-label="Refresh enquiry report">&#8635;</button><button class="button button-secondary" type="button" data-enquiry-report-export ${!report ? 'disabled' : ''}>&darr; CSV</button></div></div></form>
      ${state.enquiryReportError ? `<p class="notice notice-warning" role="alert">${esc(state.enquiryReportError)}</p>` : ''}
      ${report ? `${Object.values(report.controls).some((v) => v === false) ? '<p class="notice notice-warning" role="status">Source reconciliation differences require review.</p>' : ''}${!report.applicationAuthority ? '<p class="notice">Application associations are unavailable for part of this scope.</p>' : ''}
        <div class="enquiry-report-totals">${[['workload','Current status'],['replies','Reply consent and responses'],['applications','Accounts and application associations'],['timing','Elapsed timing']].map(([group,title]) => `<section><h4>${title}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${report.metrics.filter((m) => m.group === group).map((m) => `<tr data-enquiry-metric="${esc(m.id)}"><td>${esc(m.label)}${m.unit === 'minutes' ? ' (minutes)' : ''}</td><td>${esc(value(report.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <h4>By intake (${report.rows.length})</h4><div class="result-table-wrap"><table class="result-table enquiry-report-intakes"><thead><tr><th>Intake</th>${columns.map((k) => `<th>${esc(report.metrics.find((m) => m.id === k).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${report.rows.map((r) => `<tr data-enquiry-report-intake="${esc(r.intakeId)}"><td>${esc(r.programmeCode)} - ${esc(r.label)}</td>${columns.map((k) => `<td>${esc(value(r.counts[k]))}</td>`).join('')}<td>${Object.values(r.controls).some((v) => v === false) ? 'Review differences' : r.applicationAuthority ? 'Agree' : 'Partial authority'}</td></tr>`).join('')}</tbody></table></div>
        <details data-enquiry-definitions ${state.enquiryReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(report.definitionVersion)}</summary>${report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((k) => `<dt>${k.charAt(0).toUpperCase()+k.slice(1)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-enquiry-report]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.enquiryReportOpen = e.currentTarget.open;});
    root.querySelector('[data-enquiry-definitions]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.enquiryReportDefinitionsOpen = e.currentTarget.open;});
    root.querySelector('[data-enquiry-report-filter]')?.addEventListener('submit',(e) => {e.preventDefault();const filters = Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-enquiry-report-export]')?.addEventListener('click',() => act(async () => {
      const token = state.session?.token,filters = state.enquiryReport?.filters;if (!filters) return;
      let data;try {data = await api('GET',`/api/reports/enquiries?${new URLSearchParams({...filters,format:'csv'})}`);} catch(error) {if (token === state.session?.token && [401,403,404].includes(error.status)) clear(state);throw error;}
      if (token !== state.session?.token) return;
      const url = URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.enquiryReportingUI = {clear,load,render,bind};
})();
