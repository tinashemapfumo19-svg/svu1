(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const label = (row) => `${row.programmeCode} - ${row.label} (${row.status})`;
  const comparisons = ['pendingOnboarding','onboarded','transferred','draftRegistrations','confirmedRegistrations','courseEnrolments'];
  function render(state) {
    const data = state.registryReport,intakes = data?.availableIntakes || state.registryReportIntakes,filters = data?.filters || state.registryReportFilters || {};
    if (!data && !intakes) return '';
    return `<details class="registry-enrolment-report" data-registry-report ${state.registryReportOpen ? 'open' : ''}><summary>Registry and enrolment</summary>
      <header class="section-header"><h3>Registry and enrolment</h3>${data ? `<span>${esc(window.svuUI.dateTime(data.generatedAt))}</span>` : ''}</header>
      <form class="form form-grid" data-registry-report-filter><label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((row) => `<option value="${esc(row.intakeId)}" ${filters.intakeId === row.intakeId ? 'selected' : ''}>${esc(label(row))}</option>`).join('')}</select></label>
        <div class="hero-actions"><button class="icon-button" type="submit" title="Refresh registry report" aria-label="Refresh registry report">&#8635;</button><button class="button button-secondary" type="button" data-registry-report-export ${!data ? 'disabled' : ''}>&darr; CSV</button></div></form>
      ${state.registryReportError ? `<div class="notice notice-warning" role="alert" data-registry-report-error>${esc(state.registryReportError)}</div>` : ''}
      ${data ? `${Object.values(data.controls).some((value) => !value) ? '<div class="notice notice-warning" role="status">Source partitions require review.</div>' : ''}
      ${data.totals.unclassifiedProgrammes ? '<div class="notice notice-warning">Unclassified programme states require review.</div>' : ''}
      <div class="registry-report-totals">${['programme','registration'].map((group) => `<section><h4>${group === 'programme' ? 'Current programme records' : 'Retained registrations and enrolments'}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Count</th><th>Unit</th></tr></thead><tbody>${data.metrics.filter((entry) => entry.group === group).map((entry) => `<tr data-registry-metric="${esc(entry.id)}"><td>${esc(entry.label)}</td><td>${esc(data.totals[entry.id])}</td><td>${esc(entry.unit)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
      <h4>By intake (${data.rows.length})</h4><div class="result-table-wrap"><table class="result-table registry-report-intakes"><thead><tr><th>Intake</th>${comparisons.map((key) => `<th>${esc(data.metrics.find((entry) => entry.id === key).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${data.rows.map((row) => `<tr data-registry-report-intake="${esc(row.intakeId)}"><td>${esc(label(row))}</td>${comparisons.map((key) => `<td>${esc(row.counts[key])}</td>`).join('')}<td>${Object.values(row.controls).every(Boolean) ? 'Agree' : 'Review differences'}</td></tr>`).join('')}</tbody></table></div>
      ${!data.rows.length ? '<p>No matching authorized intakes.</p>' : ''}
      <details data-registry-definitions ${state.registryDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(data.definitionVersion)}</summary>${data.metrics.map((entry) => `<details class="report-definition"><summary>${esc(entry.label)}</summary><dl>${['owner','approval','unit','formula','exclusions','filters','refresh'].map((key) => `<dt>${key.charAt(0).toUpperCase()+key.slice(1)}</dt><dd>${esc(entry[key])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</details>`;
  }
  async function load(state,api,filters = {}) {
    const token = state.session?.token;
    try {
      const data = await api('GET',`/api/reports/registry?${new URLSearchParams(filters)}`);
      if (token !== state.session?.token) return;
      state.registryReport = data;state.registryReportError = null;state.registryReportIntakes = null;state.registryReportFilters = data.filters;
    } catch(error) {
      if (token !== state.session?.token) return;
      state.registryReport = null;state.registryReportFilters = filters;
      const intakes = await api('GET','/api/reports/registry/intakes').catch(() => null);
      if (token !== state.session?.token) return;
      state.registryReportIntakes = intakes;state.registryReportError = intakes ? error.message : null;
    }
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-registry-report]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.registryReportOpen = event.currentTarget.open;});
    root.querySelector('[data-registry-definitions]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.registryDefinitionsOpen = event.currentTarget.open;});
    root.querySelector('[data-registry-report-filter]')?.addEventListener('submit',(event) => {event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-registry-report-export]')?.addEventListener('click',() => act(async () => {
      const result = await api('GET',`/api/reports/registry?${new URLSearchParams({...state.registryReport.filters,format:'csv'})}`);
      const url = URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = result.fileName;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.registryEnrolmentReportingUI = {render,load,bind};
})();
