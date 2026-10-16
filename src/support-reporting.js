(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value = (v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for (const key of Object.keys(state)) if (key.startsWith('supportReport')) delete state[key];}
  async function load(state,api,filters = state.supportReportFilters || {}) {
    const token = state.session?.token,generation = Symbol();state.supportReportGeneration = generation;
    const current = () => token === state.session?.token && generation === state.supportReportGeneration;
    try {
      const data = await api('GET',`/api/reports/support?${new URLSearchParams(filters)}`);
      if (!current()) return;
      state.supportReport = data;state.supportReportFilters = data.filters;state.supportReportIntakes = null;state.supportReportError = null;
    } catch(error) {
      if (!current()) return;
      if ([401,403,404].includes(error.status)) {clear(state);return;}
      state.supportReport = null;state.supportReportIntakes = null;state.supportReportFilters = filters;state.supportReportError = error.message;
      const intakes = await api('GET','/api/reports/support/intakes').catch(() => null);
      if (!current()) return;
      if (!intakes) {clear(state);return;}state.supportReportIntakes = intakes;
    }
  }
  function render(state) {
    const report = state.supportReport,intakes = report?.availableIntakes || state.supportReportIntakes,filters = report?.filters || state.supportReportFilters || {};
    if (!intakes) return '';
    const columns = ['casesTotal','activeCases','awaitingFirstReply','escalatedActive','urgentActive','meanFirstReplyMinutes'];
    const options = (name,values) => `<label class="field"><span>${name.charAt(0).toUpperCase()+name.slice(1)}</span><select class="input" name="${name}"><option value="">All ${name === 'category' ? 'categories' : 'priorities'}</option>${values.map((v) => `<option value="${v}" ${filters[name] === v ? 'selected' : ''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}</select></label>`;
    return `<details class="support-report" data-support-report ${state.supportReportOpen ? 'open' : ''}><summary>Student support workload</summary>
      <header class="section-header"><h3>Student support workload</h3>${report ? `<span>${esc(window.svuUI.dateTime(report.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-support-report-filter>
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All authorized intakes</option>${intakes.map((r) => `<option value="${esc(r.intakeId)}" ${filters.intakeId === r.intakeId ? 'selected' : ''}>${esc(r.programmeCode)} - ${esc(r.label)}</option>`).join('')}</select></label>
        ${options('category',['academic','registration','finance','learning','feedback','other'])}${options('priority',['low','normal','high','urgent'])}
        <label class="field"><span>Created from (UTC)</span><input class="input" name="from" type="date" value="${esc(filters.from)}"></label>
        <label class="field"><span>Created through (UTC)</span><input class="input" name="to" type="date" value="${esc(filters.to)}"></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh support report" aria-label="Refresh support report">&#8635;</button><button class="icon-button" type="button" data-support-report-export title="Download support CSV" aria-label="Download support CSV" ${!report ? 'disabled' : ''}>&darr;</button></div></div></form>
      ${state.supportReportError ? `<p class="notice notice-warning" role="alert">${esc(state.supportReportError)}</p>` : ''}
      ${report ? `${Object.values(report.controls).some((v) => v === false) ? '<p class="notice notice-warning" role="status">Source reconciliation differences require review.</p>' : ''}
        <div class="support-report-totals">${[['workload','Current status and ownership'],['responses','Active workload and replies'],['priority','Current priority'],['category','Current category'],['timing','Elapsed timing']].map(([group,title]) => `<section><h4>${title}</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${report.metrics.filter((m) => m.group === group).map((m) => `<tr data-support-metric="${esc(m.id)}"><td>${esc(m.label)}${m.unit === 'minutes' ? ' (minutes)' : ''}</td><td>${esc(value(report.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>
        <h4>By intake (${report.rows.length})</h4><div class="result-table-wrap"><table class="result-table support-report-intakes"><thead><tr><th>Intake</th>${columns.map((k) => `<th>${esc(report.metrics.find((m) => m.id === k).label)}</th>`).join('')}<th>Controls</th></tr></thead><tbody>${report.rows.map((r) => `<tr data-support-report-intake="${esc(r.intakeId)}"><td>${esc(r.programmeCode)} - ${esc(r.label)}</td>${columns.map((k) => `<td>${esc(value(r.counts[k]))}</td>`).join('')}<td>${Object.values(r.controls).some((v) => v === false) ? 'Review differences' : 'Agree'}</td></tr>`).join('')}</tbody></table></div>
        <details data-support-definitions ${state.supportReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(report.definitionVersion)}</summary>${report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((k) => `<dt>${k.charAt(0).toUpperCase()+k.slice(1)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-support-report]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.supportReportOpen = e.currentTarget.open;});
    root.querySelector('[data-support-definitions]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.supportReportDefinitionsOpen = e.currentTarget.open;});
    root.querySelector('[data-support-report-filter]')?.addEventListener('submit',(e) => {e.preventDefault();const filters = Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-support-report-export]')?.addEventListener('click',() => act(async () => {
      const token = state.session?.token,filters = state.supportReport?.filters;if (!filters) return;
      let data;try {data = await api('GET',`/api/reports/support?${new URLSearchParams({...filters,format:'csv'})}`);} catch(error) {
        if (token === state.session?.token) {if ([401,403,404].includes(error.status)) clear(state);else await load(state,api,filters);}throw error;
      }
      if (token !== state.session?.token) return;
      const url = URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.supportReportingUI = {clear,load,render,bind};
})();
