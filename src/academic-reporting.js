(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value = (v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for (const key of Object.keys(state)) if (key.startsWith('academicOutcomeReport')) delete state[key];}
  async function load(state,api,filters = state.academicOutcomeReportFilters || {}) {
    const token = state.session?.token,generation = Symbol();state.academicOutcomeReportGeneration = generation;
    const current = () => token === state.session?.token && generation === state.academicOutcomeReportGeneration;
    try {
      const data = await api('GET',`/api/reports/academic?${new URLSearchParams(filters)}`);
      if (!current()) return;
      state.academicOutcomeReport = data;state.academicOutcomeReportFilters = data.filters;state.academicOutcomeReportIntakes = null;state.academicOutcomeReportError = null;
    } catch(error) {
      if (!current()) return;
      if ([401,403,404].includes(error.status)) {clear(state);return;}
      state.academicOutcomeReport = null;state.academicOutcomeReportIntakes = null;state.academicOutcomeReportFilters = filters;state.academicOutcomeReportError = error.message;
      const intakes = await api('GET','/api/reports/academic/intakes').catch(() => null);
      if (!current()) return;
      if (!intakes) {clear(state);return;}state.academicOutcomeReportIntakes = intakes;
    }
  }
  function render(state) {
    const report = state.academicOutcomeReport,intakes = report?.availableIntakes || state.academicOutcomeReportIntakes,filters = report?.filters || state.academicOutcomeReportFilters || {};
    if (!intakes) return '';
    const columns = ['officialResults','withoutOfficialResult','approvedDecisions','requestedAwards','approvedAwards','completedProgrammeRecords'];

    return `<details class="academic-outcome-report" data-academic-outcome-report ${state.academicOutcomeReportOpen ? 'open' : ''}><summary>Academic outcomes and awards</summary>
      <header class="section-header"><h3>Academic outcomes and awards</h3>${report ? `<span>${esc(window.svuUI.dateTime(report.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-academic-outcome-report-filter>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((r) => `<option value="${esc(r.intakeId)}" data-domains="${Object.entries(r.authority).filter(([,v]) => v).map(([d]) => d).join(',')}" ${filters.intakeId === r.intakeId ? 'selected' : ''}>${esc(r.programmeCode)} - ${esc(r.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Domain</span><select class="input" name="domain"><option value="">All available domains</option>${[['results','Official results'],['decisions','Academic decisions'],['awards','Awards']].filter(([d]) => intakes.some((r) => r.authority[d])).map(([d,label]) => `<option value="${d}" ${filters.domain === d ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh academic report" aria-label="Refresh academic report">&#8635;</button><button class="icon-button" type="button" data-academic-outcome-report-export title="Download academic CSV" aria-label="Download academic CSV" ${!report ? 'disabled' : ''}>&darr;</button></div></div></form>
      ${state.academicOutcomeReportError ? `<p class="notice notice-warning" role="alert">${esc(state.academicOutcomeReportError)}</p>` : ''}
      ${report ? `${Object.values(report.controls).some((v) => v === false) ? '<p class="notice notice-warning" role="status">Source reconciliation differences require review.</p>' : ''}
        ${Object.values(report.authority).some((v) => !v) ? '<p class="notice">Some domain measures are unavailable for this selection.</p>' : ''}<div class="academic-outcome-report-totals">${[['results','Official results and retained enrolments'],['decisions','Retained academic decisions'],['awards','Award requests and conferrals']].map(([group,title]) => `<section><h4>${title}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${report.metrics.filter((m) => m.group === group).map((m) => `<tr data-academic-outcome-metric="${esc(m.id)}"><td>${esc(m.label)}${m.unit === 'mark points' ? ' (mark points)' : ''}</td><td>${esc(value(report.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <h4>By intake (${report.rows.length})</h4><div class="result-table-wrap"><table class="result-table academic-outcome-report-intakes"><thead><tr><th>Intake</th>${columns.map((k) => `<th>${esc(report.metrics.find((m) => m.id === k).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${report.rows.map((r) => `<tr data-academic-outcome-report-intake="${esc(r.intakeId)}"><td>${esc(r.programmeCode)} - ${esc(r.label)}</td>${columns.map((k) => `<td>${esc(value(r.counts[k]))}</td>`).join('')}<td>${Object.values(r.controls).some((v) => v === false) ? 'Review differences' : Object.values(r.authority).some((v) => !v) ? 'Partial authority' : 'Agree'}</td></tr>`).join('')}</tbody></table></div>
        <details data-academic-outcome-definitions ${state.academicOutcomeReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(report.definitionVersion)}</summary>${report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((k) => `<dt>${k.charAt(0).toUpperCase()+k.slice(1)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-academic-outcome-report]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.academicOutcomeReportOpen = e.currentTarget.open;});
    root.querySelector('[data-academic-outcome-definitions]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.academicOutcomeReportDefinitionsOpen = e.currentTarget.open;});
    const form = root.querySelector('[data-academic-outcome-report-filter]');
    const updateIntakes = () => {if (!form) return;const domain = form.elements.domain.value,select = form.elements.intakeId;for (const option of select.options) {option.disabled = Boolean(option.value && domain && !option.dataset.domains.split(',').includes(domain));if (option.selected && option.disabled) select.value = '';}};
    form?.elements.domain.addEventListener('change',updateIntakes);updateIntakes();
    root.querySelector('[data-academic-outcome-report-filter]')?.addEventListener('submit',(e) => {e.preventDefault();const filters = Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-academic-outcome-report-export]')?.addEventListener('click',() => act(async () => {
      const token = state.session?.token,filters = state.academicOutcomeReport?.filters;if (!filters) return;
      let data;try {data = await api('GET',`/api/reports/academic?${new URLSearchParams({...filters,format:'csv'})}`);} catch(error) {
        if (token === state.session?.token) {if ([401,403,404].includes(error.status)) clear(state);else await load(state,api,filters);}throw error;
      }
      if (token !== state.session?.token) return;
      const url = URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.academicOutcomeReportingUI = {clear,load,render,bind};
})();
