(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reason = (label) => `<label class="field"><span>${label}</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>`;
  const categoryOptions = (d) => d.categories.filter((c) => c.active).map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('');
  const staffOptions = (d) => d.staff.map((s) => `<option value="${esc(s.id)}">${esc(s.legalName)} (${esc(s.employeeNumber)})</option>`).join('');
  const exclusion = () => `<div class="leave-exclusion"><input class="input" aria-label="Excluded date" type="date" required><button class="icon-button" type="button" data-leave-remove-date title="Remove excluded date" aria-label="Remove excluded date">&times;</button></div>`;
  function balances(rows) {
    return `<div class="leave-balances">${rows.map((b) => `<dl><dt>${esc(b.categoryCode)} / ${b.year}</dt><dd>Granted <strong>${b.granted}</strong></dd><dd>Reserved <strong>${b.reserved}</strong></dd><dd>Approved <strong>${b.used}</strong></dd><dd>Available <strong>${b.available}</strong></dd></dl>`).join('')}</div>`;
  }
  function render(state) {
    const d = state.staffLeave;
    if (!d) return '';
    const manage = d.capabilities.manage,selected = state.leaveDetail;
    return `<section class="staff-leave"><form class="form form-grid" data-leave-filter>
      <label class="field"><span>Leave year</span><input class="input" type="number" name="year" min="2000" max="2200" value="${d.year}" required></label>
      ${manage ? `<label class="field"><span>Staff name or number</span><input class="input" name="staffQ" maxlength="200" value="${esc(state.leaveFilters?.staffQ)}"></label>` : ''}
      <div><button class="button button-secondary" type="submit">Search</button></div></form>
      ${d.ownStaff ? `<h3>My balance</h3>${balances(d.balances)}` : ''}
      ${d.capabilities.request ? `<details data-leave-new-panel ${state.leaveNewOpen ? 'open' : ''}><summary>Request leave</summary>
        <form class="form form-grid" data-leave-new><label class="field"><span>Leave category</span><select class="input" name="categoryCode" required>${categoryOptions(d)}</select></label>
        <label class="field"><span>First day</span><input class="input" type="date" name="startsOn" min="${new Date().toISOString().slice(0,10)}" required></label>
        <label class="field"><span>Last day</span><input class="input" type="date" name="endsOn" required></label>${reason('Request reason')}
        <div><button class="button button-primary" type="submit" ${!d.categories.some((c) => c.active) ? 'disabled' : ''}>Submit request</button></div></form></details>` : ''}
      <h3>Leave requests (${d.total})</h3><ul class="staff-list">${d.items.map((r) => `<li><button class="review-row" type="button" data-leave-detail="${esc(r.id)}"><strong>${esc(r.legalName)} - ${esc(r.categoryName)}</strong><span>${r.startsOn} to ${r.endsOn} / ${r.days} days</span><span>${esc(r.status)}</span></button></li>`).join('') || '<li>No leave requests.</li>'}</ul>
      <div class="hero-actions"><button class="icon-button" type="button" data-leave-page="-1" aria-label="Previous leave page" title="Previous page" ${!d.offset ? 'disabled' : ''}>&larr;</button><span>${d.total ? d.offset+1 : 0}-${Math.min(d.offset+d.limit,d.total)} of ${d.total}</span><button class="icon-button" type="button" data-leave-page="1" aria-label="Next leave page" title="Next page" ${d.offset+d.limit>=d.total ? 'disabled' : ''}>&rarr;</button></div>
      ${selected ? `<section class="leave-detail" data-leave-record="${esc(selected.id)}"><header class="section-header"><h3>${esc(selected.legalName)} - ${esc(selected.categoryName)}</h3><strong data-leave-status>${esc(selected.status)}</strong></header>
        <p>${selected.startsOn} to ${selected.endsOn} / ${selected.days} days</p><p>${esc(selected.reason)}</p>
        ${selected.actions.length ? `<form class="form form-grid" data-leave-decision><input type="hidden" name="revision" value="${selected.revision}"><label class="field"><span>Decision</span><select class="input" name="action">${selected.actions.map((a) => `<option value="${a}">${{cancel:'Cancel request',recommend:'Recommend',deny:'Deny',approve:'Approve',reverse:'Reverse approval'}[a]}</option>`).join('')}</select></label>${reason('Decision reason')}<div><button class="button button-primary" type="submit">Record decision</button></div></form>` : ''}
        <h4>Decision history</h4><ol>${selected.history.map((h) => `<li>${esc(h.fromStatus || 'new')} to ${esc(h.toStatus)} / ${esc(window.svuUI.dateTime(h.recordedAt))}<p>${esc(h.reason)}</p></li>`).join('')}</ol></section>` : ''}
      ${manage ? `<h3>Leave administration</h3><details><summary>Categories and counting policy</summary>
        <ul class="leave-categories">${d.categories.map((c) => `<li><strong>${esc(c.name)} (${esc(c.code)})</strong><span>${c.dayBasis === 'calendar' ? 'Calendar days' : 'Monday to Friday'} / ${c.active ? 'active' : 'inactive'}</span>${c.excludedDates.length ? `<p>Excluded dates: ${c.excludedDates.map(esc).join(', ')}</p>` : ''}
        <form class="form form-grid" data-leave-category-status="${esc(c.code)}"><input type="hidden" name="revision" value="${c.revision}"><label><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Active</label>${reason('Status change reason')}<div><button class="button button-secondary" type="submit">Save status</button></div></form></li>`).join('')}</ul>
        <form class="form form-grid" data-leave-category><label class="field"><span>Category code</span><input class="input" name="code" pattern="[A-Z][A-Z0-9_]{1,39}" maxlength="40" required></label><label class="field"><span>Category name</span><input class="input" name="name" maxlength="100" required></label>
        <label class="field"><span>Counted days</span><select class="input" name="dayBasis"><option value="calendar">Calendar days</option><option value="weekdays">Monday to Friday</option></select></label><div><span>Excluded dates</span><div data-leave-exclusions></div><button class="icon-button" type="button" data-leave-add-date title="Add excluded date" aria-label="Add excluded date">+</button></div>${reason('Policy reason')}<div><button class="button button-primary" type="submit">Create category</button></div></form></details>
        <details><summary>Balance ledger</summary><form class="form form-grid" data-leave-balance-view><label class="field"><span>Staff member</span><select class="input" name="staffId" required>${staffOptions(d)}</select></label><label class="field"><span>Leave category</span><select class="input" name="categoryCode" required>${categoryOptions(d)}</select></label><input type="hidden" name="year" value="${d.year}"><div><button class="button button-secondary" type="submit">View balance</button></div></form>
        ${state.leaveBalance ? `${balances([state.leaveBalance])}<ol>${state.leaveBalance.entries.map((e) => `<li>${e.days>0 ? '+' : ''}${e.days} days / ${esc(window.svuUI.dateTime(e.recordedAt))}<p>${esc(e.reason)}</p></li>`).join('')}</ol>` : ''}
        <form class="form form-grid" data-leave-balance><label class="field"><span>Staff member</span><select class="input" name="staffId" required>${staffOptions(d)}</select></label><label class="field"><span>Leave category</span><select class="input" name="categoryCode" required>${categoryOptions(d)}</select></label><input type="hidden" name="year" value="${d.year}"><label class="field"><span>Balance change (days)</span><input class="input" type="number" name="days" min="-366" max="366" step="1" required></label>${reason('Balance entry reason')}<div><button class="button button-primary" type="submit">Record balance entry</button></div></form></details>` : ''}</section>`;
  }
  async function load(state,api) {state.staffLeave = await api('GET',`/api/staff-leave?${new URLSearchParams(state.leaveFilters || {})}`);}
  function bind(root,state,{api,act}) {
    const data = (form) => Object.fromEntries(new FormData(form));
    const refresh = async (id) => {await load(state,api);if (id) state.leaveDetail = await api('GET',`/api/staff-leave/requests/${id}`);};
    const onSubmit = (selector,work) => root.querySelectorAll(selector).forEach((form) => form.addEventListener('submit',(event) => {event.preventDefault();const body = data(form);work(body,form);}));
    root.querySelector('[data-leave-new-panel]')?.addEventListener('toggle',(e) => {if (e.currentTarget.isConnected) state.leaveNewOpen=e.currentTarget.open;});
    onSubmit('[data-leave-filter]',(body) => act(async () => {state.leaveFilters=body;state.leaveDetail=null;state.leaveBalance=null;await refresh();}));
    root.querySelectorAll('[data-leave-detail]').forEach((b) => b.addEventListener('click',() => act(() => refresh(b.dataset.leaveDetail))));
    root.querySelectorAll('[data-leave-page]').forEach((b) => b.addEventListener('click',() => act(async () => {state.leaveFilters={...state.leaveFilters,offset:state.staffLeave.offset+Number(b.dataset.leavePage)*state.staffLeave.limit};await refresh();})));
    onSubmit('[data-leave-new]',(body) => {
      const signature=JSON.stringify(body);
      if (state.leaveReplaySignature!==signature) {state.leaveReplayKey=crypto.randomUUID();state.leaveReplaySignature=signature;}
      act(async () => {const row=await api('POST','/api/staff-leave',{...body,replayKey:state.leaveReplayKey});state.leaveReplayKey=null;state.leaveReplaySignature=null;state.leaveNewOpen=false;state.leaveFilters={...state.leaveFilters,year:row.startsOn.slice(0,4),offset:0};await refresh(row.id);state.notice='Leave request submitted.';});
    });
    onSubmit('[data-leave-decision]',(body) => act(async () => {const {action,...input}=body;await api('POST',`/api/staff-leave/requests/${state.leaveDetail.id}/${action}`,{...input,revision:Number(input.revision)});await refresh(state.leaveDetail.id);state.notice='Leave decision recorded.';}));
    root.querySelector('[data-leave-add-date]')?.addEventListener('click',() => {root.querySelector('[data-leave-exclusions]').insertAdjacentHTML('beforeend',exclusion());});
    root.querySelector('[data-leave-exclusions]')?.addEventListener('click',(e) => {e.target.closest('[data-leave-remove-date]')?.closest('.leave-exclusion').remove();});
    onSubmit('[data-leave-category]',(body,form) => {body.excludedDates=Array.from(form.querySelectorAll('[data-leave-exclusions] input'),(i) => i.value);act(async () => {await api('POST','/api/staff-leave/categories',body);await refresh();state.notice='Leave category created.';});});
    onSubmit('[data-leave-category-status]',(body,form) => act(async () => {await api('PUT',`/api/staff-leave/categories/${form.dataset.leaveCategoryStatus}`,{revision:Number(body.revision),active:form.elements.active.checked,reason:body.reason});await refresh();state.notice='Leave category status saved.';}));
    onSubmit('[data-leave-balance-view]',(body) => act(async () => {state.leaveBalance=await api('GET',`/api/staff-leave/balances?${new URLSearchParams(body)}`);}));
    onSubmit('[data-leave-balance]',(body) => act(async () => {await api('POST','/api/staff-leave/balances',{...body,year:Number(body.year),days:Number(body.days)});state.leaveBalance=await api('GET',`/api/staff-leave/balances?${new URLSearchParams({staffId:body.staffId,categoryCode:body.categoryCode,year:body.year})}`);await refresh();state.notice='Leave balance entry recorded.';}));
  }
  window.staffLeaveUI={render,load,bind};
})();
