(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value = (v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for (const key of Object.keys(state)) if (key.startsWith('communicationReport')) delete state[key];}
  async function load(state,api,filters = state.communicationReportFilters || {}) {
    const token = state.session?.token,generation = Symbol();state.communicationReportGeneration = generation;
    const current = () => token === state.session?.token && generation === state.communicationReportGeneration;
    try {
      const data = await api('GET',`/api/reports/communications?${new URLSearchParams(filters)}`);
      if (!current()) return;
      state.communicationReport = data;state.communicationReportFilters = data.filters;state.communicationReportIntakes = null;state.communicationReportError = null;
    } catch(error) {
      if (!current()) return;
      if ([401,403,404].includes(error.status)) {clear(state);return;}
      state.communicationReport = null;state.communicationReportIntakes = null;state.communicationReportFilters = filters;state.communicationReportError = error.message;
      const intakes = await api('GET','/api/reports/communications/intakes').catch(() => null);
      if (!current()) return;
      if (!intakes) {clear(state);return;}state.communicationReportIntakes = intakes;
    }
  }
  function render(state) {
    const report = state.communicationReport,intakes = report?.availableIntakes || state.communicationReportIntakes,filters = report?.filters || state.communicationReportFilters || {};
    if (!intakes) return '';
    const columns = ['publishedCampaigns','ownPreviews','recipientAccounts','inAppRead','emailQueued','emailCancelled'];

    return `<details class="communication-report" data-communication-report ${state.communicationReportOpen ? 'open' : ''}><summary>Applicant campaign workload</summary>
      <header class="section-header"><h3>Applicant campaign workload</h3>${report ? `<span>${esc(window.svuUI.dateTime(report.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-communication-report-filter>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((r) => `<option value="${esc(r.intakeId)}" ${filters.intakeId === r.intakeId ? 'selected' : ''}>${esc(r.programmeCode)} - ${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Campaign status</span><select class="input" name="status"><option value="">Published and own previews</option><option value="published" ${filters.status === 'published' ? 'selected' : ''}>Published</option><option value="preview" ${filters.status === 'preview' ? 'selected' : ''}>Own previews</option></select></label>
        <label class="field"><span>Campaign created from (UTC)</span><input class="input" name="from" type="date" value="${esc(filters.from)}"></label>
        <label class="field"><span>Campaign created through (UTC)</span><input class="input" name="to" type="date" value="${esc(filters.to)}"></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh campaign report" aria-label="Refresh campaign report">&#8635;</button><button class="icon-button" type="button" data-communication-report-export title="Download campaign CSV" aria-label="Download campaign CSV" ${!report ? 'disabled' : ''}>&darr;</button></div></div></form>
      ${state.communicationReportError ? `<p class="notice notice-warning" role="alert">${esc(state.communicationReportError)}</p>` : ''}
      ${report ? `${Object.values(report.controls).some((v) => v === false) ? '<p class="notice notice-warning" role="status">Source reconciliation differences require review.</p>' : ''}
        <p class="notice">${report.providerDeliveryEvidenceAvailable ? 'Retained provider outcomes are included. Acceptance is not delivery.' : 'No provider delivery outcomes are recorded for this cohort.'}</p><div class="communication-report-totals">${[['campaigns','Published and own previews'],['audience','Captured audience opportunities'],['recipients','Retained recipient channels'],['timing','Elapsed timing']].map(([group,title]) => `<section><h4>${title}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${report.metrics.filter((m) => m.group === group).map((m) => `<tr data-communication-metric="${esc(m.id)}"><td>${esc(m.label)}${m.unit === 'minutes' ? ' (minutes)' : ''}</td><td>${esc(value(report.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <h4>By intake (${report.rows.length})</h4><div class="result-table-wrap"><table class="result-table communication-report-intakes"><thead><tr><th>Intake</th>${columns.map((k) => `<th>${esc(report.metrics.find((m) => m.id === k).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${report.rows.map((r) => `<tr data-communication-report-intake="${esc(r.intakeId)}"><td>${esc(r.programmeCode)} - ${esc(r.label)}</td>${columns.map((k) => `<td>${esc(value(r.counts[k]))}</td>`).join('')}<td>${Object.values(r.controls).some((v) => v === false) ? 'Review differences' : 'Agree'}</td></tr>`).join('')}</tbody></table></div>
        <details data-communication-definitions ${state.communicationReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(report.definitionVersion)}</summary>${report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((k) => `<dt>${k.charAt(0).toUpperCase()+k.slice(1)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-communication-report]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.communicationReportOpen = e.currentTarget.open;});
    root.querySelector('[data-communication-definitions]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.communicationReportDefinitionsOpen = e.currentTarget.open;});
    root.querySelector('[data-communication-report-filter]')?.addEventListener('submit',(e) => {e.preventDefault();const filters = Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-communication-report-export]')?.addEventListener('click',() => act(async () => {
      const token = state.session?.token,filters = state.communicationReport?.filters;if (!filters) return;
      let data;try {data = await api('GET',`/api/reports/communications?${new URLSearchParams({...filters,format:'csv'})}`);} catch(error) {
        if (token === state.session?.token) {if ([401,403,404].includes(error.status)) clear(state);else await load(state,api,filters);}throw error;
      }
      if (token !== state.session?.token) return;
      const url = URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.communicationReportingUI = {clear,load,render,bind};
})();
