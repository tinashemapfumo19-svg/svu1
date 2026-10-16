(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const label = (row) => `${row.programmeCode} - ${row.label} (${row.status})`;
  const comparisons = ['underReview','openOffers','acceptedApplications','placesTaken','placesRemaining','overCapacity'];
  function render(state) {
    const data = state.admissionsReport;
    const intakes = data?.availableIntakes || state.admissionsReportIntakes,filters = data?.filters || state.admissionsReportFilters || {};
    if (!data && !intakes) return '';
    return `<details class="admissions-report" data-admissions-report ${state.admissionsReportOpen ? 'open' : ''}><summary>Admissions workload</summary>
      <header class="section-header"><h3>Admissions workload</h3>${data ? `<span>${esc(window.svuUI.dateTime(data.generatedAt))}</span>` : ''}</header>
      <form class="form form-grid" data-admissions-report-filter><label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((row) => `<option value="${esc(row.intakeId)}" ${filters.intakeId === row.intakeId ? 'selected' : ''}>${esc(label(row))}</option>`).join('')}</select></label>
        <div class="hero-actions"><button class="icon-button" type="submit" title="Refresh admissions report" aria-label="Refresh admissions report">&#8635;</button><button class="button button-secondary" type="button" data-admissions-report-export ${!data ? 'disabled' : ''}>&darr; CSV</button></div></form>
      ${state.admissionsReportError ? `<div class="notice notice-warning" role="alert" data-admissions-report-error>${esc(state.admissionsReportError)}</div>` : ''}
      ${data ? `
      ${!data.controls.applicationsReconcile || !data.controls.capacityReconciles ? '<div class="notice notice-warning" role="status">Source reconciliation differences require review.</div>' : ''}
      ${data.totals.unclassifiedSubmitted ? '<div class="notice notice-warning">Submitted records without a recognized current workflow require review.</div>' : ''}
      <div class="admissions-report-totals">${['applications','capacity'].map((group) => `<section><h4>${group === 'applications' ? 'Application records' : 'Intake capacity'}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Count</th></tr></thead><tbody>${data.metrics.filter((entry) => entry.group === group).map((entry) => `<tr data-admissions-metric="${esc(entry.id)}"><td>${esc(entry.label)}</td><td>${esc(data.totals[entry.id])}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
      <h4>By intake (${data.rows.length})</h4><div class="result-table-wrap"><table class="result-table admissions-report-intakes"><thead><tr><th>Intake</th>${comparisons.map((key) => `<th>${esc(data.metrics.find((entry) => entry.id === key).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${data.rows.map((row) => `<tr data-admissions-report-intake="${esc(row.intakeId)}"><td>${esc(label(row))}</td>${comparisons.map((key) => `<td>${esc(row.counts[key])}</td>`).join('')}<td>${row.controls.applicationsReconcile && row.controls.capacityReconciles ? 'Agree' : 'Review differences'}</td></tr>`).join('')}</tbody></table></div>
      ${!data.rows.length ? '<p>No matching authorized intakes.</p>' : ''}
      <details data-admissions-definitions ${state.admissionsDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(data.definitionVersion)}</summary>${data.metrics.map((entry) => `<details class="report-definition"><summary>${esc(entry.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((key) => `<dt>${key.charAt(0).toUpperCase()+key.slice(1)}</dt><dd>${esc(entry[key])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</details>`;
  }
  async function load(state,api,filters = {}) {
    const token = state.session?.token;
    try {
      const data = await api('GET',`/api/reports/admissions?${new URLSearchParams(filters)}`);
      if (token !== state.session?.token) return;
      state.admissionsReport = data;state.admissionsReportError = null;state.admissionsReportIntakes = null;state.admissionsReportFilters = data.filters;
    } catch(error) {
      if (token !== state.session?.token) return;
      state.admissionsReport = null;state.admissionsReportFilters = filters;
      const intakes = await api('GET','/api/reports/admissions/intakes').catch(() => null);
      if (token !== state.session?.token) return;
      state.admissionsReportIntakes = intakes;state.admissionsReportError = intakes ? error.message : null;
    }
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-admissions-report]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.admissionsReportOpen = event.currentTarget.open;});
    root.querySelector('[data-admissions-definitions]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.admissionsDefinitionsOpen = event.currentTarget.open;});
    root.querySelector('[data-admissions-report-filter]')?.addEventListener('submit',(event) => {
      event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));
      act(() => load(state,api,filters));
    });
    root.querySelector('[data-admissions-report-export]')?.addEventListener('click',() => act(async () => {
      const result = await api('GET',`/api/reports/admissions?${new URLSearchParams({...state.admissionsReport.filters,format:'csv'})}`);
      const url = URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = result.fileName;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.admissionsReportingUI = {render,load,bind};
})();
