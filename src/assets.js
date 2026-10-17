(function () {
  const esc=(v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const human=(v) => String(v ?? '').replaceAll('_',' ');
  const today=() => new Date().toISOString().slice(0,10);
  const money=(v) => {const n=BigInt(v || 0);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;};
  const conditions=['serviceable','damaged','repair','missing'];
  const statuses=['available','allocated','disposal_pending','disposed'];
  const input=(name,label,value='',attributes='') => `<label class="field"><span>${label}</span><input class="input" name="${name}" value="${esc(value)}" ${attributes}></label>`;
  const options=(rows,value) => rows.map((r) => `<option value="${esc(r.code ?? r.id)}" ${(r.code ?? r.id)===value ? 'selected' : ''}>${esc(r.label ?? r.name ?? `${r.legalName} (${r.employeeNumber})`)}</option>`).join('');
  const select=(name,label,rows,value) => `<label class="field"><span>${label}</span><select class="input" name="${name}" required>${options(rows,value)}</select></label>`;
  const condition=(name,value='serviceable') => select(name,'Condition',conditions.map((code) => ({code,label:human(code)})),value);
  const reason=() => `<label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>`;
  const date=(name,label,value=today(),minimum='1900-01-01',readOnly=false) => input(name,label,value,`type="date" min="${minimum}" max="${today()}" required ${readOnly ? 'readonly' : ''}`);
  const amount=(name,label,value='0.00',readOnly=false) => input(name,label,value,`type="number" step="0.01" min="0" max="100000000" required ${readOnly ? 'readonly' : ''}`);
  function definition(d,a={}) {
    return `${input('assetTag','Asset tag',a.assetTag,'pattern="[A-Z0-9][A-Z0-9_-]{2,49}" maxlength="50" required')}${input('barcode','Barcode',a.barcode,'maxlength="100"')}${input('serialNumber','Serial number',a.serialNumber,'maxlength="100"')}
      ${input('name','Asset name',a.name,'maxlength="200" required')}${input('category','Category',a.category,'maxlength="100" required')}${date('acquiredOn','Acquired on',a.acquiredOn || today(),'1900-01-01',Boolean(a.id))}
      ${input('acquisitionMethod','Acquisition method',a.acquisitionMethod,'maxlength="100" required')}${amount('value','Acquisition value',money(a.valueMinor),Boolean(a.id))}
      ${a.id ? `${input('currency','Currency',a.currency,'readonly required')}` : select('currency','Currency',d.currencies,a.currency)}
      ${select('departmentId','Owner department',d.departments,a.departmentId)}${input('location','Location',a.location,'maxlength="200" required')}${condition('condition',a.condition)}${reason()}`;
  }
  const copyRow=() => `<div class="asset-copy-row" data-asset-copy-row>${input('assetTag','New asset tag','','pattern="[A-Z0-9][A-Z0-9_-]{2,49}" maxlength="50" required')}${input('barcode','New barcode','','maxlength="100"')}${input('serialNumber','New serial number','','maxlength="100"')}<button class="icon-button" type="button" data-asset-remove-copy aria-label="Remove copy" title="Remove copy">&times;</button></div>`;
  function actionForm(d,a,action) {
    let fields='';
    if (action==='edit') fields=definition(d,a);
    if (action==='allocate') fields=`${select('staffId','Staff custodian',d.staff)}${date('allocatedOn','Allocated on',today(),a.lastActivityOn)}${input('location','Custody location',a.location,'maxlength="200" required')}${reason()}`;
    if (action==='return') fields=`${date('returnedOn','Returned on',today(),a.lastActivityOn)}${input('location','Return location','','maxlength="200" required')}${condition('condition')}${reason()}`;
    if (action==='check') fields=`${date('checkedOn','Checked on',today(),a.lastActivityOn)}${select('outcome','Stock-check outcome',['found','missing','damaged'].map((code) => ({code,label:human(code)})))}${condition('observedCondition',a.condition)}${input('observedLocation','Observed location',a.location,'maxlength="200"')}${reason()}`;
    if (action==='dispose') fields=`${date('proposedOn','Proposed on',today(),a.lastActivityOn)}${amount('value','Value at disposal',money(a.valueMinor))}${input('method','Disposal method','','maxlength="100" required')}${reason()}`;
    if (action==='review') fields=`${select('outcome','Disposal decision',[{code:'approve',label:'Approve disposal'},{code:'deny',label:'Deny disposal'}])}${date('reviewedOn','Decision effective on',today(),a.lastActivityOn)}${reason()}`;
    if (action==='copy') fields=`${date('acquiredOn','New assets acquired on')}${select('departmentId','Owner department',d.departments,a.departmentId)}${input('location','New assets location','','maxlength="200" required')}${condition('condition')}<div class="asset-copy-fields" data-asset-copy-fields>${copyRow()}</div><div><button class="icon-button" type="button" data-asset-add-copy aria-label="Add copy" title="Add copy">+</button></div>${reason()}`;
    const labels={edit:'Edit asset',allocate:'Allocate asset',return:'Record return',check:'Record stock check',dispose:'Propose disposal',review:'Decide disposal',copy:'Copy acquisition details'};
    return `<details data-asset-action-panel="${action}"><summary>${labels[action]}</summary><form class="form form-grid" data-asset-action="${action}"><input type="hidden" name="revision" value="${a.revision}">${fields}<div><button class="button button-primary" type="submit">${action==='copy' ? 'Register copies' : labels[action]}</button></div></form></details>`;
  }
  function render(state) {
    const d=state.assets,a=state.assetDetail;if (!d) return '';
    return `<section class="asset-workspace">
      <form class="form form-grid" data-asset-report><label class="field"><span>Report</span><select class="input" name="kind"><option value="register">Asset register</option><option value="allocations">Current allocations</option><option value="stock_checks">Stock checks</option></select></label>${input('from','Checks from','','type="date" disabled')}${input('to','Checks through','','type="date" disabled')}<div><button class="icon-button" type="submit" aria-label="Download asset report" title="Download asset report">&darr;</button></div></form>
      <div class="asset-totals">${d.totals.map((t) => `<p><strong>${esc(t.currency)} ${money(t.valueMinor)}</strong><span>${t.count} assets / acquisition value</span></p>`).join('')}</div>
      ${d.capabilities.manage ? `<details data-asset-create-panel><summary>Register asset</summary><form class="form form-grid" data-asset-create>${definition(d)}<div><button class="button button-primary" type="submit">Register asset</button></div></form></details>` : ''}
      <div class="registry-grid asset-workspace-workbench"><aside class="review-sidebar workspace-picker" aria-label="Asset register"><form class="workspace-picker-filter" data-asset-filter>${input('q','Asset tag, name, barcode or serial number',state.assetFilters?.q,'maxlength="200"')}
      <label class="field"><span>Asset status</span><select class="input" name="status"><option value="">All</option>${statuses.map((s) => `<option value="${s}" ${state.assetFilters?.status===s ? 'selected' : ''}>${human(s)}</option>`).join('')}</select></label>
      <label class="field"><span>Owner department</span><select class="input" name="departmentId"><option value="">All</option>${options(d.departments,state.assetFilters?.departmentId)}</select></label>
      ${d.capabilities.manage ? input('staffQ','Custodian name or employee number',state.assetFilters?.staffQ,'maxlength="200"') : ''}<div><button class="button button-secondary" type="submit">Search</button></div></form><h3>Asset register (${d.total})</h3><div class="workspace-picker-results" tabindex="0" role="region" aria-label="Asset register results"><ul class="staff-list">${d.items.map((r) => `<li><button class="review-row" type="button" data-asset-detail="${esc(r.id)}"><strong>${esc(r.assetTag)} - ${esc(r.name)}</strong><span>${esc(human(r.status))} / ${esc(r.condition)} / ${esc(r.location)}</span><span>${esc(r.currency)} ${money(r.valueMinor)}${r.custodianName ? ` / ${esc(r.custodianName)}` : ''}</span></button></li>`).join('') || '<li>No assets.</li>'}</ul></div>
      <div class="hero-actions"><button class="icon-button" type="button" data-asset-page="-1" aria-label="Previous asset page" title="Previous page" ${!d.offset ? 'disabled' : ''}>&larr;</button><span>${d.total ? d.offset+1 : 0}-${Math.min(d.offset+d.limit,d.total)} of ${d.total}</span><button class="icon-button" type="button" data-asset-page="1" aria-label="Next asset page" title="Next page" ${d.offset+d.limit>=d.total ? 'disabled' : ''}>&rarr;</button></div>
      </aside><div class="review-detail">${a ? `<section class="asset-detail" data-asset-record="${esc(a.id)}"><header class="section-header"><h3>${esc(a.assetTag)} - ${esc(a.name)}</h3><strong data-asset-status>${esc(human(a.status))}</strong></header>
        <dl class="asset-facts"><div><dt>Identifiers</dt><dd>${esc(a.barcode || 'No barcode')} / ${esc(a.serialNumber || 'No serial number')}</dd></div><div><dt>Acquisition</dt><dd>${a.acquiredOn} / ${esc(a.acquisitionMethod)} / ${esc(a.currency)} ${money(a.valueMinor)}</dd></div><div><dt>Department</dt><dd>${esc(a.departmentName)}</dd></div><div><dt>Location / condition</dt><dd>${esc(a.location)} / ${esc(a.condition)}</dd></div><div><dt>Custodian</dt><dd>${esc(a.custodianName || 'Unallocated')}${a.custodianStatus && a.custodianStatus!=='active' ? ` / ${esc(a.custodianStatus)}` : ''}</dd></div></dl>
        ${a.actions.map((action) => actionForm(d,a,action)).join('')}${a.canReview ? actionForm(d,a,'review') : ''}
        <h4>Custody history</h4><ol>${a.custody.map((c) => `<li>${esc(c.staffName)} / ${c.allocatedOn} to ${c.endedOn || 'now'} / ${esc(c.location)}<p>${esc(c.reason)}${c.endedOn ? ` / ${esc(c.endKind)} / ${esc(c.endCondition)} / ${esc(c.endLocation)} / ${esc(c.endReason)}` : ''}</p></li>`).join('') || '<li>No allocations.</li>'}</ol>
        <h4>Stock checks</h4><ol>${a.checks.map((c) => `<li>${c.checkedOn} / ${esc(c.outcome)} / ${esc(c.observedCondition)}<p>Expected: ${esc(c.expectedLocation)} / observed: ${esc(c.observedLocation || 'Not found')} / ${esc(c.reason)}</p></li>`).join('') || '<li>No stock checks.</li>'}</ol>
        <h4>Disposal history</h4><ol>${a.disposals.map((p) => `<li>${p.proposedOn} / ${esc(p.status)} / ${esc(p.method)} / ${esc(p.currency)} ${money(p.valueMinor)}<p>${esc(p.reason)}${p.reviewedOn ? ` / ${p.reviewedOn} / ${esc(p.reviewReason)}` : ''}</p></li>`).join('') || '<li>No disposal proposals.</li>'}</ol>
        <h4>Change history</h4><ol>${a.events.map((e) => `<li>${esc(human(e.action))} / ${esc(window.svuUI.dateTime(e.recordedAt))}<p>${esc(e.reason)}</p></li>`).join('')}</ol>
        <div class="hero-actions"><button class="icon-button" type="button" data-asset-history="-1" aria-label="Previous asset history" title="Previous history" ${!a.historyOffset ? 'disabled' : ''}>&larr;</button><span>${a.historyOffset+1}-${Math.min(a.historyOffset+25,a.historyTotal)} of ${a.historyTotal} changes</span><button class="icon-button" type="button" data-asset-history="1" aria-label="Next asset history" title="Next history" ${a.historyOffset+25>=a.historyTotal ? 'disabled' : ''}>&rarr;</button></div></section>` : '<p>Select an asset to view custody, checks and disposal history.</p>'}</div></div></section>`;
  }
  async function load(state,api) {state.assets=await api('GET',`/api/assets?${new URLSearchParams(state.assetFilters || {})}`);}
  function bind(root,state,{api,act}) {
    const data=(form) => Object.fromEntries(new FormData(form));
    const refresh=async (id) => {await load(state,api);if (id) state.assetDetail=await api('GET',`/api/assets/${id}`);};
    const onSubmit=(selector,work) => root.querySelectorAll(selector).forEach((form) => form.addEventListener('submit',(e) => {e.preventDefault();work(data(form),form);}));
    const replay=(kind,body) => {state.assetReplay ||= {};const signature=JSON.stringify(body),prior=state.assetReplay[kind];if (!prior || prior.signature!==signature) state.assetReplay[kind]={signature,key:crypto.randomUUID()};return state.assetReplay[kind].key;};
    const minor=(body) => {if (body.value!==undefined) {if (!/^\d+(\.\d{1,2})?$/.test(body.value)) throw new Error('Enter a non-negative value with at most two decimal places.');const [whole,fraction='']=body.value.split('.');body.valueMinor=Number(whole)*100+Number(fraction.padEnd(2,'0'));delete body.value;}};
    onSubmit('[data-asset-filter]',(body) => act(async () => {state.assetFilters=body;await refresh();}));
    root.querySelector('[data-asset-report] [name="kind"]')?.addEventListener('change',e=>{
      const form=e.target.form;for (const name of ['from','to']) form.elements[name].disabled=e.target.value!=='stock_checks';
    });
    onSubmit('[data-asset-report]',body=>act(async()=>{
      const filters={...state.assetFilters,...body};delete filters.offset;delete filters.limit;
      const token=state.session?.token,result=await api('GET',`/api/assets/reports?${new URLSearchParams(filters)}`);
      if (token!==state.session?.token) return;
      const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
      link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      state.notice=`Asset report exported: ${result.rowCount} rows.`;
    }));
    onSubmit('[data-asset-create]',(body) => act(async () => {minor(body);body.replayKey=replay('create',body);const a=await api('POST','/api/assets',body);delete state.assetReplay.create;await refresh(a.id);state.notice='Asset registered.';}));
    root.querySelectorAll('[data-asset-detail]').forEach((b) => b.addEventListener('click',() => act(() => refresh(b.dataset.assetDetail))));
    root.querySelectorAll('[data-asset-page]').forEach((b) => b.addEventListener('click',() => act(async () => {state.assetFilters={...state.assetFilters,offset:state.assets.offset+Number(b.dataset.assetPage)*state.assets.limit};await refresh();})));
    root.querySelectorAll('[data-asset-history]').forEach((b) => b.addEventListener('click',() => act(async () => {state.assetDetail=await api('GET',`/api/assets/${state.assetDetail.id}?historyOffset=${state.assetDetail.historyOffset+Number(b.dataset.assetHistory)*25}`);}))); 
    root.querySelector('[data-asset-add-copy]')?.addEventListener('click',() => {if (root.querySelectorAll('[data-asset-copy-row]').length<50) root.querySelector('[data-asset-copy-fields]').insertAdjacentHTML('beforeend',copyRow());});
    root.querySelector('[data-asset-copy-fields]')?.addEventListener('click',(e) => {const b=e.target.closest('[data-asset-remove-copy]');if (b && root.querySelectorAll('[data-asset-copy-row]').length>1) b.closest('[data-asset-copy-row]').remove();});
    onSubmit('[data-asset-action]',(body,form) => {
      const action=form.dataset.assetAction,id=state.assetDetail.id;body.revision=Number(body.revision);
      if (action==='copy') {body.copies=Array.from(form.querySelectorAll('[data-asset-copy-row]'),(row) => Object.fromEntries(Array.from(row.querySelectorAll('input'),(i) => [i.name,i.value])));delete body.assetTag;delete body.barcode;delete body.serialNumber;}
      act(async () => {minor(body);body.replayKey=replay(`${id}:${action}`,body);const result=await api(action==='edit' ? 'PUT' : 'POST',`/api/assets/${id}${action==='edit' ? '' : `/${action}`}`,body);delete state.assetReplay[`${id}:${action}`];await refresh(action==='copy' ? result.items[0].id : id);state.notice=action==='copy' ? `${result.items.length} assets copied.` : 'Asset action recorded.';});
    });
  }
  window.assetsUI={render,load,bind};
})();
