(function () {
  const esc=v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={religion:'Religion',disability:'Disability',medical:'Medical information'};
  const fields={religion:{religion:['Religion',120]},disability:{disability:['Disability',500]},medical:{chronicConditions:['Chronic conditions',1000],provider:['Medical insurer',160],providerAddress:['Insurer address',500],medicalAidNumber:['Medical aid number',100],physicianContact:['Physician name and contact',300]}};
  const input=(name,label,value='',max=160,extra='') => `<label class="field"><span>${esc(label)}</span><input class="input" name="${name}" value="${esc(value)}" maxlength="${max}" ${extra}></label>`;
  const policyInfo=p => `<dl class="ui-facts"><div><dt>Purpose</dt><dd>${esc(p.purpose)}</dd></div><div><dt>Policy owner</dt><dd>${esc(p.owner)}</dd></div><div><dt>Policy reference</dt><dd>${esc(p.policyReference)}</dd></div><div><dt>Retention</dt><dd>${esc(p.retentionRule)}</dd></div><div><dt>Consent duration</dt><dd>${p.consentDays} days</dd></div></dl>`;
  const policies=(rows,id) => `<label class="field"><span>Approved purpose</span><select class="input" name="policyId" required><option value="">Select purpose</option>${rows.map(p => `<option value="${esc(p.id)}" ${p.id===id ? 'selected' : ''}>${esc(p.title)} / ${esc(p.purposeCode)}</option>`).join('')}</select></label>`;
  function ownRender(data) {
    if (!data)return '';
    return `<section class="restricted-own ui-stack"><h2 class="ui-section-title">Restricted information</h2>${Object.keys(labels).map(group => {
      const profile=data.profiles.find(p => p.group===group),available=data.policies.filter(p => p.group===group);
      return `<details data-restricted-own-panel="${group}"><summary>${labels[group]}${profile ? ` / ${esc(profile.status)} / expires ${esc(new Date(profile.expiresAt).toLocaleDateString())}` : ''}</summary>
        ${available.length ? `<form class="form form-grid" data-restricted-self="${group}" autocomplete="off">${policies(available,available.some(p => p.id===profile?.policyId) ? profile.policyId : '')}<div class="restricted-policy-copy" data-restricted-policy-copy></div>
          ${Object.entries(fields[group]).map(([name,[label,max]]) => input(name,label,profile?.values[name],max)).join('')}
          <label class="field"><span><input type="checkbox" name="consent" required> I consent to this information being used for the selected purpose.</span></label>
          <div><button class="button button-primary" type="submit">Save with consent</button></div></form>` : '<p class="ui-meta">Collection unavailable: no approved active policy.</p>'}
        ${profile?.status==='consented' ? `<button class="button button-secondary" type="button" data-restricted-withdraw="${group}">Withdraw consent</button>` : ''}
        ${profile && !available.length ? `<dl class="ui-facts">${Object.entries(fields[group]).map(([name,[label]]) => `<div><dt>${label}</dt><dd>${esc(profile.values[name]) || 'Not supplied'}</dd></div>`).join('')}</dl>` : ''}</details>`;
    }).join('')}</section>`;
  }
  function ownBind(root,data,{api,run}) {
    if (!data)return;const base=`/api/registry/me/restricted/${encodeURIComponent(data.programmeId)}`;
    root.querySelectorAll('[data-restricted-self]').forEach(form => {
      const select=form.elements.policyId,copy=form.querySelector('[data-restricted-policy-copy]');
      const update=() => {const p=data.policies.find(p => p.id===select.value);copy.innerHTML=p ? policyInfo(p) : '';form.elements.consent.checked=false;};
      select.addEventListener('change',update);update();
      form.addEventListener('submit',event => {event.preventDefault();const group=form.dataset.restrictedSelf,values=Object.fromEntries(Object.keys(fields[group]).map(name => [name,form.elements[name].value]));
        const body={revision:data.profiles.find(p => p.group===group)?.revision || 0,policyId:select.value,consent:form.elements.consent.checked,values,requestKey:crypto.randomUUID()};
        run(async () => {await api('PUT',`${base}/${group}`,body);return 'Restricted information saved with consent.';});
      });
    });
    root.querySelectorAll('[data-restricted-withdraw]').forEach(button => button.addEventListener('click',() => {
      const group=button.dataset.restrictedWithdraw,revision=data.profiles.find(p => p.group===group).revision;
      run(async () => {await api('POST',`${base}/${group}/withdraw`,{revision,requestKey:crypto.randomUUID()});return 'Consent withdrawn.';});
    }));
  }
  async function load(state,api) {
    const token=state.session?.token,route=location.hash;delete state.restrictedRead;
    await window.svuSession.me();
    if (token!==state.session?.token || route!==location.hash)return;
    const can=p => window.svuSession.can(p),govern=can('restricted.policy.manage') || can('restricted.policy.approve');
    const group=Object.keys(labels).find(g => g===state.restrictedGroup && can(`restricted.${g}.read`)) || Object.keys(labels).find(g => can(`restricted.${g}.read`));
    const governance=govern ? await api('GET',`/api/restricted-profiles/policies?offset=${state.restrictedPolicyOffset || 0}`) : null;
    const care=group ? await api('GET',`/api/restricted-profiles/care?${new URLSearchParams({group,...state.restrictedFilters})}`) : null;
    if (token!==state.session?.token || route!==location.hash)return;
    state.restrictedGovernance=governance;state.restrictedCare=care;state.restrictedGroup=group;
  }
  function render(state) {
    const d=state.restrictedGovernance,c=state.restrictedCare;
    const governance=d ? `<section class="ui-stack"><h3>Policy governance</h3>${d.capabilities.manage ? `<details data-restricted-create-panel><summary>New policy version</summary><form class="form form-grid" data-restricted-policy-create>
      <label class="field"><span>Category</span><select class="input" name="group">${Object.entries(labels).map(([g,l]) => `<option value="${g}">${l}</option>`).join('')}</select></label>
      ${input('purposeCode','Purpose code','',60,'pattern="[A-Z][A-Z0-9_]{2,59}" required')}${input('title','Policy title','',160,'required')}${input('owner','Policy owner','',160,'required')}${input('policyReference','Policy reference','',500,'required')}
      <label class="field"><span>Purpose</span><textarea class="input" name="purpose" maxlength="2000" required></textarea></label><label class="field"><span>Retention rule</span><textarea class="input" name="retentionRule" maxlength="2000" required></textarea></label>
      ${input('consentDays','Consent duration (days)','',3,'type="number" min="1" max="366" step="1" required')}<div><button class="button button-primary" type="submit">Create policy draft</button></div></form></details>` : ''}
      ${d.policies.map(p => `<details data-restricted-policy="${esc(p.id)}"><summary>${esc(labels[p.group])} / ${esc(p.title)} / ${p.status}</summary>${policyInfo(p)}
      ${p.status==='draft' && d.capabilities.approve ? `<button class="button button-primary" type="button" data-restricted-decision="publish" data-id="${esc(p.id)}" data-revision="${p.revision}">Approve policy</button>` : ''}
      ${p.status==='published' && d.capabilities.manage ? `<button class="button button-secondary" type="button" data-restricted-decision="retire" data-id="${esc(p.id)}" data-revision="${p.revision}">Retire policy</button>` : ''}</details>`).join('') || '<p>No restricted profile policies.</p>'}</section>` : '';
    const care=c ? `<section class="ui-stack"><h3>Purpose-bound access</h3><form class="form form-grid" data-restricted-care-filter><label class="field"><span>Category</span><select class="input" name="group">${Object.keys(labels).filter(g => window.svuSession.can(`restricted.${g}.read`)).map(g => `<option value="${g}" ${g===c.group ? 'selected' : ''}>${labels[g]}</option>`).join('')}</select></label>${input('q','Student name or number',c.q)}<div><button class="button button-secondary" type="submit">Search</button></div></form>
      <ul class="staff-list">${c.students.map(s => `<li><form class="form form-grid" data-restricted-read="${esc(s.id)}"><strong>${esc(s.studentNumber)} / ${esc(s.legalName)} / ${esc(s.intakeLabel)}</strong>${policies(c.policies)}<div><button class="button button-primary" type="submit" ${c.policies.length ? '' : 'disabled'}>View for purpose</button></div></form></li>`).join('') || '<li>No students in your authorized scope.</li>'}</ul>
      <div class="ui-actions"><button class="icon-button" type="button" data-restricted-page="-1" aria-label="Previous students" title="Previous students" ${c.offset ? '' : 'disabled'}>&larr;</button><span>${c.total ? c.offset+1 : 0}-${Math.min(c.offset+c.limit,c.total)} of ${c.total}</span><button class="icon-button" type="button" data-restricted-page="1" aria-label="Next students" title="Next students" ${c.offset+c.limit<c.total ? '' : 'disabled'}>&rarr;</button></div>
      ${state.restrictedRead ? `<section data-restricted-read-result><h4>${esc(state.restrictedRead.student?.studentNumber)} / ${esc(state.restrictedRead.student?.legalName)}</h4><p>${esc(labels[c.group])} / ${esc(state.restrictedRead.purposeCode)}</p><dl class="ui-facts">${Object.entries(fields[c.group]).map(([n,[l]]) => `<div><dt>${l}</dt><dd>${esc(state.restrictedRead.values[n]) || 'Not supplied'}</dd></div>`).join('')}</dl><button class="button button-secondary" type="button" data-restricted-clear>Close restricted record</button></section>` : ''}</section>` : '';
    const pages=d ? `<div class="ui-actions"><button class="icon-button" type="button" data-restricted-policy-page="-1" aria-label="Previous policies" title="Previous policies" ${d.offset ? '' : 'disabled'}>&larr;</button><span>${d.total ? d.offset+1 : 0}-${Math.min(d.offset+d.limit,d.total)} of ${d.total} policies</span><button class="icon-button" type="button" data-restricted-policy-page="1" aria-label="Next policies" title="Next policies" ${d.offset+d.limit<d.total ? '' : 'disabled'}>&rarr;</button></div>` : '';
    return `<div class="restricted-workspace ui-stack">${governance}${pages}${care}</div>`;
  }
  function bind(root,state,{api,act}) {
    const submit=(selector,work) => root.querySelectorAll(selector).forEach(form => form.addEventListener('submit',e => {e.preventDefault();work(Object.fromEntries(new FormData(form)),form);}));
    submit('[data-restricted-policy-create]',body => act(async () => {body.consentDays=Number(body.consentDays);body.requestKey=crypto.randomUUID();await api('POST','/api/restricted-profiles/policies',body);await load(state,api);state.notice='Restricted policy drafted.';}));
    root.querySelectorAll('[data-restricted-decision]').forEach(b => b.addEventListener('click',() => act(async () => {await api('POST',`/api/restricted-profiles/policies/${b.dataset.id}`,{revision:Number(b.dataset.revision),action:b.dataset.restrictedDecision});await load(state,api);state.notice=b.dataset.restrictedDecision==='publish' ? 'Restricted policy approved.' : 'Restricted policy retired.';})));
    submit('[data-restricted-care-filter]',body => act(async () => {state.restrictedGroup=body.group;state.restrictedFilters={q:body.q,offset:0};await load(state,api);}));
    submit('[data-restricted-read]',(body,form) => act(async () => {
      delete state.restrictedRead;const p=state.restrictedCare.policies.find(p => p.id===body.policyId);if(!p)throw new Error('Select an approved purpose.');
      const token=state.session?.token,route=location.hash,group=state.restrictedCare.group;
      const result=await api('POST',`/api/restricted-profiles/students/${encodeURIComponent(form.dataset.restrictedRead)}/${group}/read`,{policyId:p.id,purposeCode:p.purposeCode});
      if (token===state.session?.token && route===location.hash)state.restrictedRead={...result,purposeCode:p.purposeCode,student:state.restrictedCare.students.find(s => s.id===form.dataset.restrictedRead)};
    }));
    root.querySelector('[data-restricted-clear]')?.addEventListener('click',() => act(async () => {delete state.restrictedRead;}));
    root.querySelectorAll('[data-restricted-page]').forEach(b => b.addEventListener('click',() => act(async () => {state.restrictedFilters={q:state.restrictedCare.q,offset:state.restrictedCare.offset+Number(b.dataset.restrictedPage)*25};await load(state,api);})));
    root.querySelectorAll('[data-restricted-policy-page]').forEach(b => b.addEventListener('click',() => act(async () => {state.restrictedPolicyOffset=state.restrictedGovernance.offset+Number(b.dataset.restrictedPolicyPage)*25;await load(state,api);}))); 
  }
  window.restrictedProfilesUI={load,render,bind,ownRender,ownBind};
})();
