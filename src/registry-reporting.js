(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const label = (row) => `${row.programmeCode} - ${row.intakeLabel} - ${row.name}`;
  function render(state) {
    const data = state.examinationReport;
    if (!data) return state.examinationReportError ? `<details class="examination-report" data-examination-report open><summary>Examination workload</summary><p role="alert">${esc(state.examinationReportError)}</p><button class="icon-button" type="button" data-examination-report-retry title="Refresh report" aria-label="Refresh report">&#8635;</button></details>` : '';
    return `<details class="examination-report" data-examination-report ${state.examinationReportOpen ? 'open' : ''}><summary>Examination workload</summary>
      <header class="section-header"><h3>Examination workload</h3><span>${esc(window.svuUI.dateTime(data.generatedAt))}</span></header>
      <form class="form form-grid" data-examination-report-filter><label class="field"><span>Registration period</span><select class="input" name="periodId"><option value="">All authorized periods</option>${data.availablePeriods.map((row) => `<option value="${esc(row.periodId)}" ${data.filters.periodId === row.periodId ? 'selected' : ''}>${esc(label(row))}</option>`).join('')}</select></label>
        <div class="hero-actions"><button class="icon-button" type="submit" title="Refresh report" aria-label="Refresh report">&#8635;</button><button class="button button-secondary" type="button" data-examination-report-export>&darr; CSV</button></div></form>
      <div class="result-table-wrap"><table class="result-table" data-report-totals><thead><tr><th>Measure</th><th>Count</th><th>Unit</th></tr></thead><tbody>${data.metrics.map((metric) => `<tr data-report-metric="${esc(metric.id)}"><td>${esc(metric.label)}</td><td>${esc(data.totals[metric.id])}</td><td>${esc(metric.unit)}</td></tr>`).join('')}</tbody></table></div>
      <h4>By registration period (${data.rows.length})</h4><div class="result-table-wrap"><table class="result-table report-period-table"><thead><tr><th>Period</th>${data.metrics.map((metric) => `<th>${esc(metric.label)}</th>`).join('')}</tr></thead><tbody>${data.rows.map((row) => `<tr data-report-period="${esc(row.periodId)}"><td>${esc(label(row))}</td>${data.metrics.map((metric) => `<td>${esc(row.counts[metric.id])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${!data.rows.length ? '<p>No matching authorized periods.</p>' : ''}
      ${data.controls ? `<details data-examination-report-controls><summary>Source controls - ${esc(data.controlsVersion)}</summary><div class="result-table-wrap"><table class="result-table"><tbody>${Object.entries(data.controls).map(([key,value]) => `<tr><th>${esc(({ordersReconcile:'Order status partition',timetablesReconcile:'Timetable status partition',sittingsReconcile:'Sitting status partition',publicationOriginsReconcile:'Publication source custody'})[key] || key)}</th><td>${value ? 'Agree' : 'Review differences'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <details data-report-definitions ${state.examinationDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(data.definitionVersion)}</summary>${data.metrics.map((metric) => `<section class="report-definition"><h4>${esc(metric.label)}</h4><dl><dt>Owner</dt><dd>${esc(metric.owner)}</dd><dt>Approval</dt><dd>${esc(metric.approval)}</dd><dt>Formula</dt><dd>${esc(metric.formula)}</dd><dt>Exclusions</dt><dd>${esc(metric.exclusions)}</dd><dt>Filters</dt><dd>${esc(metric.filters)}</dd><dt>Refresh</dt><dd>${esc(metric.refresh)}</dd></dl></section>`).join('')}</details></details>`;
  }
  async function load(state,api,filters = {}) {
    const token=state.session?.token,generation=(state.examinationReportGeneration || 0)+1;
    state.examinationReportGeneration=generation;
    try {
      const report=await api('GET',`/api/reports/examinations?${new URLSearchParams(filters)}`);
      if(state.session?.token !== token || state.examinationReportGeneration !== generation)return;
      state.examinationReport=report;delete state.examinationReportError;
    } catch(error) {
      if(state.session?.token !== token || state.examinationReportGeneration !== generation)return;
      state.examinationReport=null;
      if([401,403,404].includes(error.status || error.statusCode))delete state.examinationReportError;
      else state.examinationReportError=error.message;
    }
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-examination-report]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.examinationReportOpen = event.currentTarget.open;});
    root.querySelector('[data-report-definitions]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.examinationDefinitionsOpen = event.currentTarget.open;});
    root.querySelector('[data-examination-report-filter]')?.addEventListener('submit',(event) => {
      event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));
      act(() => load(state,api,filters));
    });
    root.querySelector('[data-examination-report-retry]')?.addEventListener('click',() => act(() => load(state,api)));
    root.querySelector('[data-examination-report-export]')?.addEventListener('click',() => act(async () => {
      const token=state.session?.token,generation=state.examinationReportGeneration;
      let result;
      try {result = await api('GET',`/api/reports/examinations?${new URLSearchParams({...state.examinationReport.filters,format:'csv'})}`);}
      catch(error) {
        if(state.session?.token !== token || state.examinationReportGeneration !== generation)return;
        state.examinationReport=null;
        if([401,403,404].includes(error.status || error.statusCode))delete state.examinationReportError;
        else state.examinationReportError=error.message;
        throw error;
      }
      if(state.session?.token !== token || state.examinationReportGeneration !== generation)return;
      const url = URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = result.fileName;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.registryReportingUI = {render,load,bind};
})();
