(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const value = (v) => v === null ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(v);
  function clear(state) {for (const key of Object.keys(state)) if (key.startsWith('continuationReport')) delete state[key];}
  async function load(state,api,filters = state.continuationReportFilters || {}) {
    const token = state.session?.token,generation = Symbol();state.continuationReportGeneration = generation;
    const current = () => token === state.session?.token && generation === state.continuationReportGeneration;
    try {
      const periods = await api('GET','/api/reports/continuation/periods');if (!current()) return;
      const report = filters.baselinePeriodId && filters.followupPeriodId ? await api('GET',`/api/reports/continuation?${new URLSearchParams(filters)}`) : null;if (!current()) return;
      state.continuationReport = report;state.continuationReportPeriods = report?.availablePeriods || periods;state.continuationReportFilters = report?.filters || filters;state.continuationReportError = null;
    } catch(error) {
      if (!current()) return;if ([401,403,404].includes(error.status)) {clear(state);return;}
      state.continuationReport = null;state.continuationReportPeriods = null;state.continuationReportFilters = filters;state.continuationReportError = error.message;
      const periods = await api('GET','/api/reports/continuation/periods').catch(() => null);if (!current()) return;
      if (!periods) {clear(state);return;}state.continuationReportPeriods = periods;
    }
  }
  function render(state) {
    const report = state.continuationReport,periods = state.continuationReportPeriods,filters = state.continuationReportFilters || {};if (!periods) return '';
    const choices = (selected) => periods.map((p) => `<option value="${esc(p.periodId)}" ${selected === p.periodId ? 'selected' : ''}>${esc(p.name)} (${esc(p.startsOn)}) - ${esc(p.programmeCode)} - ${esc(p.intakeLabel)}</option>`).join('');
    return `<details class="continuation-report" data-continuation-report ${state.continuationReportOpen ? 'open' : ''}><summary>Confirmed period continuation</summary>
      <header class="section-header"><h3>Confirmed period continuation</h3>${report ? `<span>${esc(window.svuUI.dateTime(report.generatedAt))}</span>` : ''}</header>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-continuation-report-filter>
        <label class="field"><span>Baseline period</span><select class="input" name="baselinePeriodId" required><option value="">Select baseline period</option>${choices(filters.baselinePeriodId)}</select></label>
        <label class="field"><span>Follow-up period</span><select class="input" name="followupPeriodId" required><option value="">Select follow-up period</option>${choices(filters.followupPeriodId)}</select></label>
        <div class="field"><span>&nbsp;</span><div class="hero-actions"><button class="icon-button" type="submit" title="Refresh continuation report" aria-label="Refresh continuation report">&#8635;</button><button class="icon-button" type="button" data-continuation-report-export title="Download continuation CSV" aria-label="Download continuation CSV" ${!report ? 'disabled' : ''}>&darr;</button></div></div></form>
      ${state.continuationReportError ? `<p class="notice notice-warning" role="alert">${esc(state.continuationReportError)}</p>` : ''}
      ${report ? `${!report.periodsStarted ? '<p class="notice" role="status">Periods not started. Continuation share unavailable.</p>' : ''}<div class="result-table-wrap"><table class="result-table continuation-report-metrics"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>${report.metrics.map((m) => `<tr data-continuation-metric="${esc(m.id)}"><td>${esc(m.label)}${m.unit === 'percent' ? ' (%)' : ''}</td><td>${esc(value(report.totals[m.id]))}</td></tr>`).join('')}</tbody></table></div>
        <details data-continuation-definitions ${state.continuationReportDefinitionsOpen ? 'open' : ''}><summary>Metric definitions - ${esc(report.definitionVersion)}</summary>${report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','filters','refresh'].map((k) => `<dt>${k.charAt(0).toUpperCase()+k.slice(1)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details>` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act}) {
    root.querySelector('[data-continuation-report]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.continuationReportOpen = e.currentTarget.open;});
    root.querySelector('[data-continuation-definitions]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.continuationReportDefinitionsOpen = e.currentTarget.open;});
    const form = root.querySelector('[data-continuation-report-filter]');
    const updateFollowup = () => {if (!form) return;const periods = state.continuationReportPeriods || [],baseline = periods.find((p) => p.periodId === form.elements.baselinePeriodId.value),select = form.elements.followupPeriodId;
      for (const option of select.options) {const p = periods.find((r) => r.periodId === option.value);option.disabled = Boolean(option.value && (!baseline || !p || baseline.intakeId !== p.intakeId || baseline.startsOn >= p.startsOn));if (option.selected && option.disabled) select.value = '';}};
    form?.elements.baselinePeriodId.addEventListener('change',updateFollowup);updateFollowup();
    form?.addEventListener('submit',(e) => {e.preventDefault();const filters = Object.fromEntries(new FormData(e.currentTarget));act(() => load(state,api,filters));});
    root.querySelector('[data-continuation-report-export]')?.addEventListener('click',() => act(async () => {
      const token = state.session?.token,filters = state.continuationReport?.filters;if (!filters) return;
      let data;try {data = await api('GET',`/api/reports/continuation?${new URLSearchParams({...filters,format:'csv'})}`);} catch(error) {
        if (token === state.session?.token) {if ([401,403,404].includes(error.status)) clear(state);else await load(state,api,filters);}throw error;
      }
      if (token !== state.session?.token) return;const url = URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link = document.createElement('a');link.href = url;link.download = data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }));
  }
  window.continuationReportingUI = {clear,load,render,bind};
})();
