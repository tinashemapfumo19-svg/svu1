(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const sources = [['admissions','admissionsReport','[data-admissions-report]'],['registry','registryReport','[data-registry-report]'],['finance','controlTotals','[data-control-totals]'],['support','supportReport','[data-support-report]'],['enquiries','enquiryReport','[data-enquiry-report]'],['communications','communicationReport','[data-communication-report]'],['academic','academicOutcomeReport','[data-academic-outcome-report]'],['continuation','continuationReport','[data-continuation-report]'],['examinations','examinationReport','[data-examination-report]'],['assessment','assessmentReport','[data-assessment-report]']];
  const value = (v) => v === null || v === undefined ? '-' : new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(v);
  function clear(state) {for (const k of Object.keys(state)) if (k.startsWith('reportEdition')) delete state[k];}
  function fail(state,error) {if ([401,403,404].includes(error.status)) clear(state);else {state.reportEditionDetail=null;state.reportEditionError=error.message;}}
  async function load(state,api,filters = state.reportEditionFilters || {}) {
    const token=state.session?.token,generation=Symbol();state.reportEditionGeneration=generation;state.reportEditionDetailGeneration=Symbol();state.reportEditionDetail=null;
    const current=() => token === state.session?.token && generation === state.reportEditionGeneration;
    try {const data=await api('GET',`/api/reports/editions?${new URLSearchParams(filters)}`);if(!current())return;state.reportEditions=data;state.reportEditionFilters=data.filters;state.reportEditionError=null;}
    catch(error){if(!current())return;state.reportEditions=null;fail(state,error);}
  }
  async function read(state,api,id) {
    const token=state.session?.token,generation=Symbol();state.reportEditionDetailGeneration=generation;state.reportEditionDetail=null;
    try {const data=await api('GET',`/api/reports/editions/${encodeURIComponent(id)}`);if(token === state.session?.token && generation === state.reportEditionDetailGeneration){state.reportEditionDetail=data;state.reportEditionError=null;}}
    catch(error){if(token === state.session?.token && generation === state.reportEditionDetailGeneration)fail(state,error);}
  }
  function render(state) {
    const library=state.reportEditions,detail=state.reportEditionDetail,draft=state.reportEditionDraft,withdrawal=state.reportEditionWithdrawal,f=state.reportEditionFilters || {};
    let html='';
    if(library?.kinds.length || library?.items.length || state.reportEditionError) html=`<details class="report-editions" data-report-editions ${state.reportEditionOpen ? 'open' : ''}><summary>Saved report editions (${library?.total || 0})</summary>
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}><form class="form form-grid" data-report-edition-filter>
        <label class="field"><span>Report kind</span><select class="input" name="reportKind"><option value="">All report kinds</option>${(library?.kinds || []).map((k) => `<option value="${esc(k.reportKind)}" ${f.reportKind === k.reportKind ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Status</span><select class="input" name="status">${[['all','All editions'],['retained','Retained'],['expired','Expired'],['withdrawn','Withdrawn']].map(([v,label]) => `<option value="${v}" ${(f.status || 'all') === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="field"><span>&nbsp;</span><button class="icon-button" type="submit" title="Refresh saved report editions" aria-label="Refresh saved report editions">&#8635;</button></div></form>
        ${state.reportEditionError ? `<p class="notice notice-warning" role="alert">${esc(state.reportEditionError)}</p>` : ''}
        ${library ? `<div class="result-table-wrap"><table class="result-table report-edition-library"><thead><tr><th>Edition</th><th>Report</th><th>Source snapshot</th><th>Keep until (UTC)</th><th>Status</th><th>Actions</th></tr></thead><tbody>${library.items.map((r) => `<tr data-report-edition="${esc(r.id)}"><td>${r.status === 'retained' ? `<button type="button" class="text-button" data-report-edition-read="${esc(r.id)}">${esc(r.title)}</button>` : esc(r.title)}</td><td>${esc(r.label)}</td><td>${esc(window.svuUI.dateTime(r.sourceGeneratedAt))}</td><td>${esc(r.retainUntil)}</td><td>${esc(r.status)}</td><td><div class="hero-actions"><button type="button" class="icon-button" data-report-edition-download="${esc(r.id)}" title="Download retained edition" aria-label="Download retained edition" ${r.status !== 'retained' ? 'disabled' : ''}>&darr;</button><button type="button" class="icon-button" data-report-edition-withdraw="${esc(r.id)}" title="Withdraw saved edition" aria-label="Withdraw saved edition" ${r.status === 'withdrawn' ? 'disabled' : ''}>&times;</button></div></td></tr>`).join('')}</tbody></table></div>
          <div class="queue-pagination"><button type="button" class="icon-button" data-report-edition-page="${Math.max(0,(f.offset || 0)-(f.limit || 25))}" title="Previous editions" aria-label="Previous editions" ${!f.offset ? 'disabled' : ''}>&larr;</button><span>${library.total ? `${(f.offset || 0)+1}-${(f.offset || 0)+library.items.length} of ${library.total}` : 'No saved editions'}</span><button type="button" class="icon-button" data-report-edition-page="${(f.offset || 0)+(f.limit || 25)}" title="Next editions" aria-label="Next editions" ${(f.offset || 0)+(f.limit || 25) >= library.total ? 'disabled' : ''}>&rarr;</button></div>` : ''}
        ${detail ? `<section class="report-edition-detail" data-report-edition-detail><h3>${esc(detail.edition.title)}</h3><p>${esc(detail.edition.definitionVersion)} - ${esc(window.svuUI.dateTime(detail.edition.sourceGeneratedAt))}</p>
          ${snapshotContext(detail.report)}
          ${Array.isArray(detail.report.totals) ? detail.report.totals.map((row) => `<h4>${esc(row.currency)}</h4>${metricTable(detail.report,row,true)}`).join('') || '<p>No retained ledger activity.</p>' : metricTable(detail.report,detail.report.totals,false)}
          ${snapshotRows(detail.report)}
          <details><summary>Retained metric definitions</summary>${detail.report.metrics.map((m) => `<details class="report-definition"><summary>${esc(m.label)}</summary><dl>${['owner','approval','formula','exclusions','unit','filters','refresh'].map((k) => `<dt>${esc(k)}</dt><dd>${esc(m[k])}</dd>`).join('')}</dl></details>`).join('')}</details></section>` : ''}</fieldset></details>`;
    if(draft || withdrawal)html+=`<dialog class="report-edition-dialog" data-report-edition-dialog><h3>${withdrawal ? 'Withdraw saved edition' : 'Save latest report edition'}</h3>${state.reportEditionError ? `<p class="notice notice-warning" role="alert">${esc(state.reportEditionError)}</p>` : ''}<fieldset ${state.busy ? 'disabled' : ''}><form class="form" data-report-edition-custody>
      ${!withdrawal ? `<label class="field"><span>Edition title</span><input class="input" name="title" maxlength="160" value="${esc(draft.title)}" required></label><label class="field"><span>Keep until (UTC)</span><input class="input" name="retainUntil" type="date" value="${esc(draft.retainUntil)}" min="${new Date().toISOString().slice(0,10)}" max="${new Date(Date.now()+366*86400000).toISOString().slice(0,10)}" required></label>` : ''}
      <label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc((withdrawal || draft).reason)}</textarea></label><div class="hero-actions"><button class="button button-primary" type="submit">${withdrawal ? 'Withdraw edition' : 'Save edition'}</button><button class="button button-secondary" type="button" data-report-edition-cancel>Cancel</button></div></form></fieldset></dialog>`;
    return html;
  }
  function metricTable(report,counts,finance) {
    const money=(n) => {const v=BigInt(n),a=v < 0n ? -v : v;return `${v < 0n ? '-' : ''}${a/100n}.${String(a%100n).padStart(2,'0')}`;};
    return `<div class="result-table-wrap"><table class="result-table report-edition-metrics"><thead><tr><th>Retained measure</th><th>Value</th></tr></thead><tbody>${report.metrics.map((m) => `<tr data-report-edition-metric="${esc(m.id)}"><td>${esc(m.label)}</td><td>${esc(finance && m.id !== 'accounts' ? money(counts[m.id]) : value(counts[m.id]))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function snapshotContext(report) {
    const labels={programmeCode:'Programme',intakeId:'Intake',periodId:'Period',baselinePeriodId:'Baseline period',followupPeriodId:'Follow-up period',domain:'Domain',currency:'Currency',asOf:'As of (UTC)',cutoffTimezone:'Cutoff timezone',periodsStarted:'Periods started'};
    const entries=Object.entries(report.filters || {}).filter(([k,v]) => k !== 'format' && v !== '');
    for(const k of ['asOf','cutoffTimezone','periodsStarted'])if(Object.hasOwn(report,k) && !entries.some(([field]) => field === k))entries.push([k,report[k]]);
    if(report.baseline)entries.push(['Baseline',`${report.baseline.name} (${report.baseline.startsOn})`],['Follow-up',`${report.followup.name} (${report.followup.startsOn})`]);
    return `<dl class="report-edition-context">${entries.map(([k,v]) => `<dt>${esc(labels[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${report.controls ? `<details><summary>Retained reconciliation controls</summary><dl>${Object.entries(report.controls).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${v === null ? '-' : v ? 'Reconciled' : 'Not reconciled'}</dd>`).join('')}</dl></details>` : ''}`;
  }
  function snapshotRows(report) {
    const finance=Array.isArray(report.totals),rows=report.rows || [],courses=rows.some((r) => r.courseId);
    let html=rows.length ? `<details data-report-edition-rows><summary>Retained source rows (${rows.length})</summary><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Programme</th><th>Intake</th><th>Period / currency</th>${courses ? '<th>Course</th>' : ''}${report.metrics.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.programmeCode)}</td><td>${esc(r.label || r.intakeLabel || r.intakeId)}</td><td>${esc(r.currency || r.name || r.periodName || '-')}</td>${courses ? `<td>${esc(r.code)} - ${esc(r.title)}</td>` : ''}${report.metrics.map((m) => `<td>${esc(finance && m.id !== 'accounts' ? minorUnits(r[m.id]) : value((r.counts || r)[m.id]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '';
    if(Array.isArray(report.unmatchedQueue))html+=`<details><summary>Retained unmatched import queue (${report.unmatchedQueueAsOf})</summary><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Currency</th><th>Lines</th><th>Amount</th></tr></thead><tbody>${report.unmatchedQueue.map((r) => `<tr><td>${esc(r.currency)}</td><td>${esc(value(r.lines))}</td><td>${esc(minorUnits(r.amount))}</td></tr>`).join('')}</tbody></table></div></details>`;
    return html;
  }
  function minorUnits(n) {const v=BigInt(n),a=v < 0n ? -v : v;return `${v < 0n ? '-' : ''}${a/100n}.${String(a%100n).padStart(2,'0')}`;}
  function bind(root,state,{api,act}) {
    root.querySelector('[data-report-editions]')?.addEventListener('toggle',(e) => {if(e.currentTarget.isConnected)state.reportEditionOpen=e.currentTarget.open;});
    const perform=async (work) => {const token=state.session?.token;try {await work(token);}catch(error){if(token !== state.session?.token)return;fail(state,error);throw error;}};
    for(const [reportKind,key,selector] of sources){const panel=root.querySelector(selector),report=state[key];if(!panel || !report || panel.querySelector('[data-save-report-edition]'))continue;
      const button=document.createElement('button');button.type='button';button.className='button button-secondary report-edition-capture';button.dataset.saveReportEdition=reportKind;button.textContent='Save latest edition';button.disabled=Boolean(state.busy);
      panel.querySelector('form')?.after(button);button.addEventListener('click',() => act(async () => {const {format,...filters}=report.filters;state.reportEditionDraft={reportKind,filters,title:'',reason:'',retainUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10)};state.reportEditionRequest=null;state.reportEditionWithdrawal=null;state.reportEditionError=null;}));
    }
    root.querySelector('[data-report-edition-filter]')?.addEventListener('submit',(e) => {e.preventDefault();const filters={...Object.fromEntries(new FormData(e.currentTarget)),offset:0};act(() => load(state,api,filters));});
    root.querySelectorAll('[data-report-edition-page]').forEach((b) => b.addEventListener('click',() => act(() => load(state,api,{...state.reportEditionFilters,offset:Number(b.dataset.reportEditionPage)}))));
    root.querySelectorAll('[data-report-edition-read]').forEach((b) => b.addEventListener('click',() => act(() => read(state,api,b.dataset.reportEditionRead))));
    root.querySelectorAll('[data-report-edition-download]').forEach((b) => b.addEventListener('click',() => act(() => perform(async (token) => {
      const data=await api('GET',`/api/reports/editions/${encodeURIComponent(b.dataset.reportEditionDownload)}/download`);if(token !== state.session?.token)return;
      const url=URL.createObjectURL(new Blob([data.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
    }))));
    root.querySelectorAll('[data-report-edition-withdraw]').forEach((b) => b.addEventListener('click',() => act(async () => {state.reportEditionWithdrawal={id:b.dataset.reportEditionWithdraw,reason:''};state.reportEditionDraft=null;state.reportEditionError=null;})));
    const cancel=() => act(async () => {state.reportEditionDraft=null;state.reportEditionWithdrawal=null;state.reportEditionRequest=null;});
    root.querySelector('[data-report-edition-cancel]')?.addEventListener('click',cancel);const dialog=root.querySelector('[data-report-edition-dialog]');if(dialog){dialog.showModal();dialog.addEventListener('cancel',(e) => {e.preventDefault();if(!state.busy)cancel();});}
    root.querySelector('[data-report-edition-custody]')?.addEventListener('input',(e) => {const draft=state.reportEditionWithdrawal || state.reportEditionDraft;if(draft && e.target.name)draft[e.target.name]=e.target.value;});
    root.querySelector('[data-report-edition-custody]')?.addEventListener('submit',(e) => {e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));act(() => perform(async (token) => {
      if(state.reportEditionWithdrawal){const id=state.reportEditionWithdrawal.id;await api('POST',`/api/reports/editions/${encodeURIComponent(id)}/withdraw`,{reason:values.reason});if(token !== state.session?.token)return;state.reportEditionWithdrawal=null;await load(state,api);return;}
      const data={...state.reportEditionDraft,...values};const body=JSON.stringify(data);if(state.reportEditionRequest?.body !== body)state.reportEditionRequest={body,key:crypto.randomUUID()};
      const saved=await api('POST','/api/reports/editions',{...data,requestKey:state.reportEditionRequest.key});if(token !== state.session?.token)return;state.reportEditionDraft=null;state.reportEditionRequest=null;state.reportEditionOpen=true;await load(state,api,{status:'all',offset:0});if(token === state.session?.token)await read(state,api,saved.id);
    }));});
  }
  window.reportEditionsUI={clear,load,read,render,bind,sources};
})();
