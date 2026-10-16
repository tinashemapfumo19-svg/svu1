(function () {
  const esc=(v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value=(v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for(const k of Object.keys(state))if(k.startsWith('assessmentReport'))delete state[k];}
  async function load(state,api,filters=state.assessmentReportFilters || {}) {
    const token=state.session?.token,generation=Symbol();state.assessmentReportGeneration=generation;const current=() => token === state.session?.token && generation === state.assessmentReportGeneration;
    try {const data=await api('GET',`/api/reports/assessment?${new URLSearchParams(filters)}`);if(!current())return;state.assessmentReport=data;state.assessmentReportFilters=data.filters;state.assessmentReportMetadata=null;state.assessmentReportError=null;}
    catch(error) {
      if(!current())return;if([401,403,404].includes(error.status)) {clear(state);return;}
      state.assessmentReport=null;state.assessmentReportMetadata=null;state.assessmentReportFilters=filters;state.assessmentReportError=error.message;
      const data=await api('GET','/api/reports/assessment/metadata').catch(() => null);if(!current())return;if(!data) {clear(state);return;}state.assessmentReportMetadata=data;
    }
  }
  function render(state) {
    const r=state.assessmentReport,metadata=r || state.assessmentReportMetadata,f=r?.filters || state.assessmentReportFilters || {};if(!metadata)return '';
    const courses=[...new Map(metadata.availableCourses.map((c) => [c.courseId,c])).values()],columns=['rosterEnrolments','expectedCells','missingCells','awaitingInternal','awaitingExternal','approvedSubmissions','transferredSubmissions','changedLiveSources'];
    return `<details class="assessment-report" data-assessment-report ${state.assessmentReportOpen ? 'open' : ''}><summary>Assessment recording workload</summary>
      <header class="section-header"><h3>Assessment recording workload</h3>${r ? `<span>${esc(window.svuUI.dateTime(r.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-assessment-report-filter>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${metadata.availableIntakes.map((i) => `<option value="${esc(i.intakeId)}" ${f.intakeId === i.intakeId ? 'selected' : ''}>${esc(i.programmeCode)} - ${esc(i.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Period</span><select class="input" name="periodId"><option value="">All selected periods</option>${metadata.availablePeriods.map((p) => `<option value="${esc(p.periodId)}" data-intake="${esc(p.intakeId)}" ${f.periodId === p.periodId ? 'selected' : ''}>${esc(p.periodName)}</option>`).join('')}</select></label>
        <label class="field"><span>Course</span><select class="input" name="courseId"><option value="">All selected courses</option>${courses.map((c) => `<option value="${esc(c.courseId)}" data-bindings="${esc(JSON.stringify(metadata.availableCourses.filter((r) => r.courseId === c.courseId).map(({intakeId,periodId}) => ({intakeId,periodId}))))}" ${f.courseId === c.courseId ? 'selected' : ''}>${esc(c.code)} - ${esc(c.title)}</option>`).join('')}</select></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh assessment report" aria-label="Refresh assessment report">&#8635;</button><button class="icon-button" type="button" data-assessment-report-export title="Download assessment CSV" aria-label="Download assessment CSV" ${!r ? 'disabled' : ''}>&darr;</button></div></div></form>
        ${state.assessmentReportError ? `<p class="notice notice-warning" role="alert">${esc(state.assessmentReportError)}</p>` : ''}
        ${r ? `<div class="assessment-report-totals">${[['plans','Plans and rosters'],['coverage','Component coverage'],['workflow','Review and recording']].map(([group,title]) => `<section><h4>${title}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${r.metrics.filter((m) => m.group === group).map((m) => `<tr data-assessment-report-metric="${esc(m.id)}"><td>${esc(m.label)}</td><td>${esc(value(r.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <h4>By offering (${r.rows.length})</h4><div class="result-table-wrap"><table class="result-table assessment-report-offerings"><thead><tr><th>Course / period</th><th>Intake</th>${columns.map((k) => `<th>${esc(r.metrics.find((m) => m.id === k).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${r.rows.map((row) => `<tr data-assessment-report-offering="${esc(row.periodId)}:${esc(row.courseId)}"><td>${esc(row.code)} - ${esc(row.title)}<br>${esc(row.periodName)}</td><td>${esc(row.programmeCode)} - ${esc(row.intakeLabel)}</td>${columns.map((k) => `<td>${esc(value(row.counts[k]))}</td>`).join('')}<td>${Object.values(row.controls).every(Boolean) ? 'Agree' : 'Review differences'}</td></tr>`).join('')}</tbody></table></div>
        <details data-assessment-report-definitions ${state.assessmentReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(r.definitionVersion)}</summary>${r.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','unit','filters','refresh'].map((k) => `<dt>${esc(k.charAt(0).toUpperCase()+k.slice(1))}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-assessment-report]')?.addEventListener('toggle',(e) => {if(e.currentTarget.isConnected)state.assessmentReportOpen=e.currentTarget.open;});
    root.querySelector('[data-assessment-report-definitions]')?.addEventListener('toggle',(e) => {if(e.currentTarget.isConnected)state.assessmentReportDefinitionsOpen=e.currentTarget.open;});
    const form=root.querySelector('[data-assessment-report-filter]');
    const update=() => {if(!form)return;const intake=form.elements.intakeId.value;for(const o of form.elements.periodId.options) {o.disabled=Boolean(o.value && intake && o.dataset.intake !== intake);if(o.selected && o.disabled)form.elements.periodId.value='';}
      const period=form.elements.periodId.value;for(const o of form.elements.courseId.options) {o.disabled=Boolean(o.value && !JSON.parse(o.dataset.bindings).some((r) => (!intake || r.intakeId === intake) && (!period || r.periodId === period)));if(o.selected && o.disabled)form.elements.courseId.value='';}};
    form?.elements.intakeId.addEventListener('change',update);form?.elements.periodId.addEventListener('change',update);update();
    form?.addEventListener('submit',(e) => {e.preventDefault();const filters=Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-assessment-report-export]')?.addEventListener('click',() => act(async () => {
      const token=state.session?.token,filters=state.assessmentReport?.filters;if(!filters)return;let data;
      try {data=await api('GET',`/api/reports/assessment?${new URLSearchParams({...filters,format:'csv'})}`);}catch(error) {if(token === state.session?.token) {if([401,403,404].includes(error.status))clear(state);else await load(state,api,filters);}throw error;}
      if(token !== state.session?.token)return;const url=URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=data.filename;a.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.assessmentReportingUI={clear,load,render,bind};
})();
