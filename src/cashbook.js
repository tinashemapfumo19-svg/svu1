(function(){
  let generation=0;
  window.addEventListener('hashchange',()=>{generation++;});
  window.svuSession.onChange(()=>{generation++;});
  const bound=(state,api)=>{
    const current=generation,token=state.session?.token;
    const valid=()=>current===generation && token===state.session?.token && token===window.svuSession.get()?.token && /^#registry\/cashbook(?:\?|$)/.test(location.hash);
    return {valid,async request(...args){if(!valid())throw new Error('Cashbook context changed.');try{const result=await api(...args);if(!valid())throw new Error('Cashbook context changed.');return result;}catch(error){if(valid() && [401,403].includes(error.status))clear(state);throw error;}}};
  };
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const today=()=>new Date().toISOString().slice(0,10);
  const field=(name,label,value='',attrs='')=>`<label class="field"><span>${esc(label)}</span><input class="input" name="${esc(name)}" value="${esc(value)}" ${attrs}></label>`;
  const choice=(name,label,rows)=>`<label class="field"><span>${esc(label)}</span><select class="input" name="${name}" required>${rows.map(row=>`<option value="${esc(row.id ?? row.code)}">${esc(row.name ?? row.label)}</option>`).join('')}</select></label>`;
  const day=(name,label,value=today())=>field(name,label,value,`type="date" min="1900-01-01" max="${today()}" required`);
  const evidence=(name='evidenceRef',label='Evidence reference')=>field(name,label,'','maxlength="300" required');
  const amount=(name,label,value='0')=>field(name,label,value,'inputmode="numeric" maxlength="20" required');
  const reason=()=>'<label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>';
  const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
  const form=(action,path,label,content,method='POST')=>`<form class="form form-grid" data-cb-command="${action}" data-cb-path="${esc(path)}" data-cb-method="${method}">${content}${reason()}<div><button class="button button-primary" type="submit">${esc(label)}</button></div></form>`;
  const panel=(label,content)=>`<details class="cashbook-command"><summary>${esc(label)}</summary>${content}</details>`;
  function page(kind,offset,total){return `<div class="hero-actions"><button class="icon-button" type="button" data-cb-page="${kind}" data-direction="-1" title="Previous page" aria-label="Previous ${kind} page" ${offset===0 ? 'disabled' : ''}>&larr;</button><span>${total ? offset+1 : 0}-${Math.min(offset+25,total)} of ${total}</span><button class="icon-button" type="button" data-cb-page="${kind}" data-direction="1" title="Next page" aria-label="Next ${kind} page" ${offset+25>=total ? 'disabled' : ''}>&rarr;</button></div>`;}
  function movementFields(book,kind){
    if(kind==='reversal')return choice('reversesId','Original movement',book.movements.filter(row=>row.kind!=='reversal').map(row=>({id:row.id,name:`${row.occurredOn} / ${row.kind} / ${row.amountMinor} / ${row.evidenceRef}`})));
    const accounts=book.accounts.map(row=>({id:row.id,name:`${row.name} (${row.kind})`}));
    return `${amount('amountMinor','Amount (minor units)','1')}${kind==='transfer' ? `${choice('fromAccountId','From account',accounts)}${choice('toAccountId','To account',accounts)}` : choice('accountId','Account',kind==='bank_charge' ? accounts.filter(row=>book.accounts.find(a=>a.id===row.id).kind==='bank') : accounts)}`;
  }
  function snapshotMarkup(snapshot,names){
    if(!snapshot)return '';
    return `<h4>Closing balances (${snapshot.reconciles ? 'reconciled' : 'discrepancy'})</h4><ul class="staff-list">${snapshot.rows.map(row=>`<li><strong>${esc(row.currency)} / ${esc(names[row.id] ?? row.id)}</strong><dl class="cashbook-facts"><div><dt>Opening</dt><dd>${esc(row.openingMinor)}</dd></div><div><dt>Expected</dt><dd>${esc(row.expectedMinor)}</dd></div><div><dt>Observed</dt><dd>${esc(row.observedMinor)}</dd></div><div><dt>Variance</dt><dd>${esc(row.varianceMinor)}</dd></div></dl><p>${esc(row.observationEvidenceRef)}</p></li>`).join('')}</ul>`;
  }
  function render(state){
    const data=state.cashbook,book=state.cashbookBook,period=state.cashbookPeriod;if(!data)return '<button class="icon-button" type="button" data-cb-refresh title="Refresh cashbook" aria-label="Refresh cashbook">&#8635;</button>';
    const can=data.capabilities,active=book?.policyStatus==='published';
    const names=Object.fromEntries((book?.accounts || []).map(row=>[row.id,row.name])),snapshotView=snapshot=>snapshotMarkup(snapshot,names);
    return `<section class="cashbook-workspace"><div class="hero-actions"><button class="icon-button" type="button" data-cb-refresh title="Refresh cashbook" aria-label="Refresh cashbook">&#8635;</button><span>Amounts: minor units</span></div>
      <h3>Policies</h3>${can['policy.manage'] ? panel('Define policy',form('policy','/api/cashbook-policies','Save policy',`${field('title','Title','','maxlength="200" required')}${field('owner','Institutional owner','','maxlength="200" required')}${evidence('policyReference','Policy reference')}${field('retentionRule','Retention rule','','maxlength="2000" required')}`)) : ''}
      <ul class="staff-list">${data.policies.map(row=>`<li><strong>${esc(row.title)} / ${esc(row.status)}</strong><p>${esc(row.owner)} / ${esc(row.policyReference)} / ${esc(row.retentionRule)}</p>${row.status==='draft' && can['policy.approve'] && row.createdBy!==data.accountId ? panel('Publish policy',form('policy-change',`/api/cashbook-policies/${row.id}`,'Publish policy',hidden('revision',row.revision)+hidden('status','published'),'PUT')) : ''}${row.status==='published' && can['policy.manage'] ? panel('Retire policy',form('policy-change',`/api/cashbook-policies/${row.id}`,'Retire policy',hidden('revision',row.revision)+hidden('status','retired'),'PUT')) : ''}</li>`).join('') || '<li>No policies.</li>'}</ul>${page('policies',data.policyOffset,data.policyTotal)}
      <h3>Cashbooks</h3>${can.manage && data.policies.some(row=>row.status==='published') ? panel('Create cashbook',form('book','/api/cashbooks','Create cashbook',`${field('name','Cashbook name','','maxlength="200" required')}${choice('policyId','Published policy',data.policies.filter(row=>row.status==='published').map(row=>({id:row.id,name:row.title})))}${choice('currency','Currency',data.currencies)}${day('startsOn','Starts on')}`)) : ''}
      <ul class="staff-list">${data.books.map(row=>`<li><button class="review-row" type="button" data-cb-book="${esc(row.id)}" ${book?.id===row.id ? 'aria-current="true"' : ''}><strong>${esc(row.name)}</strong><span>${esc(row.currency)} / ${esc(row.startsOn)} / ${esc(row.policyStatus)}</span></button></li>`).join('') || '<li>No cashbooks.</li>'}</ul>${page('books',data.bookOffset,data.bookTotal)}
      ${book ? `<section class="cashbook-book" data-cb-book-record="${esc(book.id)}"><h3>${esc(book.name)} (${esc(book.currency)})</h3><h4>Accounts</h4><ul class="staff-list">${book.accounts.map(row=>`<li><strong>${esc(row.name)} / ${esc(row.kind)}</strong><span>${esc(row.openedOn)} / ${esc(row.openingMinor)} minor units / ${esc(row.openingEvidenceRef)}</span></li>`).join('') || '<li>No accounts.</li>'}</ul>
      ${can.manage && active ? panel('Open account',form('account',`/api/cashbooks/${book.id}/accounts`,'Open account',`${field('name','Account name','','maxlength="200" required')}${choice('kind','Kind',[{id:'bank',name:'Bank'},{id:'cash',name:'Physical cash'}])}${day('openedOn','Opened on')}${amount('openingMinor','Opening balance (minor units)')}${evidence()}`)) : ''}
      <form class="form form-grid" data-cb-report>${choice('kind','Report',[{id:'movements',name:'Movements'},{id:'accounts',name:'Account definitions'},...(period?.snapshot ? [{id:'reconciliation',name:'Captured reconciliation'}] : [])])}${field('from','Movements from','','type="date" min="1900-01-01"')}${field('to','Movements through','','type="date" min="1900-01-01"')}<div><button class="icon-button" type="submit" aria-label="Download cashbook report" title="Download cashbook report">&darr;</button></div></form>
      <h4>Movements</h4>${can.manage && active && book.accounts.length ? panel('Record movement',form('movement',`/api/cashbooks/${book.id}/movements`,'Record movement',`${choice('kind','Movement kind',['revenue','expenditure','bank_charge','transfer','reversal'].map(id=>({id,name:id.replaceAll('_',' ')})))}${day('occurredOn','Occurred on')}<div class="cashbook-movement-fields" data-cb-movement-fields>${movementFields(book,'revenue')}</div>${evidence()}`)) : ''}
      <ul class="staff-list">${book.movements.map(row=>`<li><strong>${esc(row.occurredOn)} / ${esc(row.kind)} / ${esc(row.amountMinor ?? 'Exact reversal')}</strong><span>${esc(row.evidenceRef)}</span><p>${esc(row.reason)}</p></li>`).join('') || '<li>No movements.</li>'}</ul>${page('movements',book.movementOffset,book.movementTotal)}
      <h4>Periods</h4>${can.manage && active ? panel('Create period',form('period',`/api/cashbooks/${book.id}/periods`,'Create period',`${day('from','From')}${day('to','Through')}`)) : ''}<ul class="staff-list">${book.periods.map(row=>`<li><button class="review-row" type="button" data-cb-period="${esc(row.id)}"><strong>${esc(row.from)} to ${esc(row.to)}</strong><span>${esc(row.status)} / revision ${row.revision}</span></button></li>`).join('') || '<li>No periods.</li>'}</ul>${page('periods',book.periodOffset,book.periodTotal)}
      ${period ? `<section data-cb-period-record="${esc(period.id)}"><h4>${esc(period.from)} to ${esc(period.to)} / ${esc(period.status)}</h4>${snapshotView(period.snapshot)}${can.manage && active && period.status==='draft' ? panel('Capture closing observations',form('capture',`/api/cashbook-periods/${period.id}/capture`,'Capture reconciliation',hidden('revision',period.revision)+book.accounts.filter(row=>row.openedOn<=period.to).map(row=>`<fieldset><legend>${esc(row.name)} / ${esc(book.currency)}</legend>${amount(`observed_${row.id}`,'Observed closing (minor units)',period.snapshot?.rows.find(a=>a.id===row.id)?.observedMinor ?? '0')}${evidence(`evidence_${row.id}`)}</fieldset>`).join(''))) : ''}${active && period.canClose ? panel('Close reconciliation',form('close',`/api/cashbook-periods/${period.id}/close`,'Close reconciliation',hidden('revision',period.revision)+hidden('evidenceHash',period.evidenceHash))) : ''}
      <h4>Capture history</h4>${period.captures.map(row=>panel(`Revision ${row.revision}`,snapshotView(row.snapshot))).join('') || '<p>No captures.</p>'}${page('captures',period.captureOffset,period.captureTotal)}</section>` : ''}</section>` : ''}</section>`;
  }
  function clear(state){for(const key of Object.keys(state))if(key.startsWith('cashbook'))delete state[key];}
  async function load(state,rawApi){
    const context=bound(state,rawApi),api=context.request;
    try{state.cashbook=await api('GET',`/api/cashbooks?${new URLSearchParams(state.cashbookFilters || {})}`);if(state.cashbookBook)state.cashbookBook=await api('GET',`/api/cashbooks/${state.cashbookBook.id}?${new URLSearchParams(state.cashbookBookFilters || {})}`);if(state.cashbookPeriod)state.cashbookPeriod=await api('GET',`/api/cashbook-periods/${state.cashbookPeriod.id}?${new URLSearchParams(state.cashbookPeriodFilters || {})}`);}catch(error){if(context.valid())clear(state);throw error;}
  }
  function bind(root,state,{api:rawApi,act}){
    const api=bound(state,rawApi).request;
    const refresh=()=>load(state,rawApi);
    root.querySelector('[data-cb-refresh]')?.addEventListener('click',()=>act(refresh));
    const reportForm=root.querySelector('[data-cb-report]');
    reportForm?.elements.kind.addEventListener('change',()=>{for(const key of ['from','to'])reportForm.elements[key].disabled=reportForm.elements.kind.value!=='movements';});
    reportForm?.addEventListener('submit',event=>{
      event.preventDefault();const filters=Object.fromEntries(new FormData(reportForm)),bookId=state.cashbookBook.id;
      if(filters.kind==='reconciliation')filters.periodId=state.cashbookPeriod.id;
      act(async()=>{const result=await api('GET',`/api/cashbooks/${bookId}/reports?${new URLSearchParams(filters)}`);
        const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
        link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        state.notice=`Cashbook report exported: ${result.rowCount} rows.`;
      });
    });
    root.querySelectorAll('[data-cb-book]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.cashbookBookFilters={};state.cashbookPeriod=null;state.cashbookBook=await api('GET',`/api/cashbooks/${button.dataset.cbBook}`);}))); 
    root.querySelectorAll('[data-cb-period]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.cashbookPeriodFilters={};state.cashbookPeriod=await api('GET',`/api/cashbook-periods/${button.dataset.cbPeriod}`);}))); 
    root.querySelectorAll('[data-cb-page]').forEach(button=>button.addEventListener('click',()=>act(async()=>{const kind=button.dataset.cbPage,map={books:['cashbookFilters','bookOffset',state.cashbook],policies:['cashbookFilters','policyOffset',state.cashbook],movements:['cashbookBookFilters','movementOffset',state.cashbookBook],periods:['cashbookBookFilters','periodOffset',state.cashbookBook],captures:['cashbookPeriodFilters','captureOffset',state.cashbookPeriod]},[key,fieldName,data]=map[kind];state[key]={...state[key],[fieldName]:String(data[fieldName]+25*Number(button.dataset.direction))};await refresh();})));
    root.querySelectorAll('[data-cb-command]').forEach(formElement=>{
      const action=formElement.dataset.cbCommand,path=formElement.dataset.cbPath,key=`${action}:${path}`,draft=state.cashbookDrafts?.[key];
      const kind=formElement.elements.kind;
      if(action==='capture' && !state.cashbookPeriod.snapshot && !draft)for(const input of formElement.querySelectorAll('[name^="observed_"]'))input.value='';
      if(action==='movement' && draft?.kind) {kind.value=draft.kind;formElement.querySelector('[data-cb-movement-fields]').innerHTML=movementFields(state.cashbookBook,draft.kind);}
      if(draft) {
        for(const [name,value] of Object.entries(draft))if(formElement.elements[name])formElement.elements[name].value=value;
        const discard=document.createElement('button');discard.type='button';discard.className='icon-button';discard.title='Discard command draft';discard.setAttribute('aria-label','Discard command draft');discard.textContent='\u00d7';
        discard.addEventListener('click',()=>act(async()=>{delete state.cashbookDrafts[key];delete state.cashbookReplay[key];await refresh();state.notice='Command draft discarded.';}));formElement.append(discard);
      }
      if(action==='movement')kind.addEventListener('change',()=>{formElement.querySelector('[data-cb-movement-fields]').innerHTML=movementFields(state.cashbookBook,kind.value);});
      formElement.addEventListener('submit',event=>{
        event.preventDefault();const raw=Object.fromEntries(new FormData(formElement)),body={...raw};state.cashbookDrafts ||= {};state.cashbookDrafts[key]=raw;
        if(body.revision!==undefined)body.revision=Number(body.revision);
        if(action==='capture'){body.observations=state.cashbookBook.accounts.filter(row=>row.openedOn<=state.cashbookPeriod.to).map(row=>({accountId:row.id,observedMinor:raw[`observed_${row.id}`],evidenceRef:raw[`evidence_${row.id}`]}));for(const name of Object.keys(body))if(name.startsWith('observed_') || name.startsWith('evidence_'))delete body[name];}
        state.cashbookReplay ||= {};const signature=JSON.stringify(body);if(state.cashbookReplay[key]?.signature!==signature)state.cashbookReplay[key]={signature,key:crypto.randomUUID()};body.requestKey=state.cashbookReplay[key].key;
        act(async()=>{try{const result=await api(formElement.dataset.cbMethod,path,body);delete state.cashbookDrafts[key];delete state.cashbookReplay[key];if(action==='book'){state.cashbookBook=await api('GET',`/api/cashbooks/${result.id}`);state.cashbookPeriod=null;}if(action==='period')state.cashbookPeriod=await api('GET',`/api/cashbook-periods/${result.id}`);await refresh();state.notice='Cashbook command recorded.';}catch(error){if([401,403].includes(error.status))clear(state);throw error;}});
      });
    });
  }
  window.cashbookUI={load,render,bind};
})();
