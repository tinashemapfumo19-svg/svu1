(function () {
  const esc=v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={programme_status:'Programme status',confirmed_registration:'Confirmed registrations',published_results:'Published results',fee_summary:'Fee summary'};
  const date=v => window.svuUI.dateTime(v);
  const expired=r => new Date(r.expiresAt)<=new Date();
  const input=(name,label,extra='') => `<label class="field"><span>${label}</span><input class="input" name="${name}" ${extra}></label>`;
  const pages=(d,attribute) => `<div class="ui-actions"><button class="icon-button" type="button" ${attribute}="-1" aria-label="Previous shares" title="Previous shares" ${d.offset ? '' : 'disabled'}>&larr;</button><span>${d.total ? d.offset+1 : 0}-${Math.min(d.offset+d.limit,d.total)} of ${d.total}</span><button class="icon-button" type="button" ${attribute}="1" aria-label="Next shares" title="Next shares" ${d.offset+d.limit<d.total ? '' : 'disabled'}>&rarr;</button></div>`;
  function ownRender(d) {
    if(!d)return '';
    return `<section class="sharing-own ui-stack"><form class="form form-grid" data-share-invite>${input('email','Recipient email','type="email" maxlength="254" required')}${input('days','Access duration (days)','type="number" min="1" max="366" step="1" required')}
      <fieldset class="ui-fieldset"><legend>Shared records</legend>${Object.entries(labels).map(([key,label]) => `<label class="ui-choice"><input type="checkbox" name="categories" value="${key}"><span>${label}</span></label>`).join('')}</fieldset><div><button class="button button-primary" type="submit">Invite recipient</button></div></form>
      <h2 class="ui-section-title">Your record shares</h2><ul class="staff-list">${d.shares.map(r => `<li data-share-row="${esc(r.id)}"><strong>${esc(r.email)}</strong><p>${r.categories.map(c => labels[c]).join(' / ')}</p><p>${expired(r) && ['pending','accepted'].includes(r.status) ? 'Expired' : r.status} / expires ${esc(date(r.expiresAt))}</p>
        <div class="ui-actions">${['pending','accepted'].includes(r.status) ? `<button class="button button-secondary" data-share-action="revoke" data-id="${esc(r.id)}">Revoke access</button>` : ''}${r.status==='pending' && !expired(r) && r.invitationCount<5 ? `<button class="button button-secondary" data-share-action="resend" data-id="${esc(r.id)}">Resend invitation</button>` : ''}</div></li>`).join('') || '<li>No record shares.</li>'}</ul>${pages(d,'data-share-own-page')}
      <h3>Recent recipient access</h3><ul class="ui-rows">${d.access.map(r => `<li>${esc(d.shares.find(s => s.id===r.shareId)?.email)} / ${labels[r.category]} / ${esc(date(r.accessedAt))}</li>`).join('') || '<li>No recipient reads.</li>'}</ul></section>`;
  }
  function ownBind(root,d,{api,run,setOffset}) {
    if(!d)return;
    root.querySelector('[data-share-invite]')?.addEventListener('submit',e => {e.preventDefault();const form=e.currentTarget,body={email:form.elements.email.value,days:Number(form.elements.days.value),categories:new FormData(form).getAll('categories'),requestKey:crypto.randomUUID()};
      run(async () => {await api('POST',`/api/registry/me/sharing/${encodeURIComponent(d.programmeId)}`,body);return 'Sharing invitation queued.';});});
    root.querySelectorAll('[data-share-action]').forEach(b => b.addEventListener('click',() => {const r=d.shares.find(r => r.id===b.dataset.id);run(async () => {await api('POST',`/api/student-sharing/${r.id}/${b.dataset.shareAction}`,{revision:r.revision,requestKey:crypto.randomUUID()});return b.dataset.shareAction==='revoke' ? 'Record access revoked.' : 'New invitation queued.';});}));
    root.querySelectorAll('[data-share-own-page]').forEach(b => b.addEventListener('click',() => run(async () => {setOffset(d.offset+Number(b.dataset.shareOwnPage)*25);}))); 
  }
  let state={},invitation='',epoch=0;
  window.svuSession.onChange(session => {
    epoch++;state={};if(!session?.token)invitation='';
    if(/^#shared(?:\/|\?|$)/.test(location.hash))render(document.querySelector('#app'));
  });
  async function api(method,path,body) {
    const token=window.svuSession.get()?.token;
    const r=await fetch(path,{method,headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},body:body===undefined ? undefined : JSON.stringify(body)});
    const payload=await r.json();if(token!==window.svuSession.get()?.token)throw new Error('The session changed.');
    if(!r.ok){if(r.status===401)window.svuSession.clear();throw new Error(payload.error?.message || 'Shared records unavailable.');}return payload.data;
  }
  const recordView=r => {
    const d=r.data;
    if(r.category==='programme_status')return `<p>${esc(d.status.replaceAll('_',' '))}</p>`;
    if(r.category==='fee_summary')return `<dl class="ui-facts">${d.currencies.map(c => `<div><dt>${esc(c.currency)} balance</dt><dd>${esc((c.balance/100).toFixed(2))}</dd></div><div><dt>${esc(c.currency)} due</dt><dd>${esc((c.due/100).toFixed(2))}</dd></div>`).join('') || '<div><dt>Account</dt><dd>No recorded charges or payments.</dd></div>'}</dl>`;
    return `<ul class="ui-rows">${d.records.map(item => `<li>${r.category==='published_results' ? `<strong>${esc(item.code)} / ${esc(item.title)}</strong><p>${esc(item.period)} / Mark ${esc(item.mark)} / Grade ${esc(item.grade)}</p>` : `<strong>${esc(item.period)} / ${esc(item.reference)}</strong><p>Year ${item.yearOfStudy} / ${esc(item.term)} / ${esc(item.credits)} credits</p><ul>${item.courses.map(c => `<li>${esc(c.code)} / ${esc(c.title)} / ${esc(c.credits)} credits</li>`).join('')}</ul>`}</li>`).join('') || '<li>No released records.</li>'}</ul>${pages(d,'data-share-record-page')}`;
  };
  function paint(root) {
    const signed=!!window.svuSession.get();
    root.innerHTML=`<section class="shared-workspace registry-workspace"><header class="section-header staff-page-head"><div><p class="eyebrow">Shared with you</p><h1 class="page-title">Shared records</h1><p class="ui-meta ui-page-description">Student records that students have chosen to share with you, for a limited time.</p></div></header>${state.notice ? `<p class="notice ${state.error ? 'notice-error' : 'notice-success'}" role="${state.error ? 'alert' : 'status'}">${esc(state.notice)}</p>` : ''}<div class="staff-body" data-share-controls ${state.busy ? 'inert aria-busy="true"' : ''}>
      ${invitation || location.hash.startsWith('#shared/invitation') ? `<form class="form form-grid" data-share-accept autocomplete="off">${invitation ? '' : input('token','Email invitation code','required maxlength="43" autocomplete="off"')}
        ${signed ? '' : `${input('legalName','Full name','required maxlength="160" autocomplete="name"')}${input('preferredName','Preferred name','required maxlength="80"')}${input('password','New account password','type="password" required minlength="12" maxlength="256" autocomplete="new-password"')}`}
        <label class="field"><span><input type="checkbox" name="accept" required> I accept this invitation to view the selected student records.</span></label><div><button class="button button-primary" type="submit">${signed ? 'Accept invitation' : 'Create account and accept'}</button></div></form>${!signed ? '<a href="#signin?next=shared%2Finvitation">Sign in to an existing account</a>' : ''}` : `<div class="ui-panel">${window.svuUI.head("Invitations", { desc: "Received a sharing invitation by email? Accept it here." })}<div><a class="button button-secondary" href="#shared/invitation">Accept an email invitation</a></div></div>`}
      ${state.list ? `<section><h2>Your received shares</h2><ul class="staff-list">${state.list.shares.map(r => `<li data-received-share="${esc(r.id)}"><strong>${esc(r.student?.legalName)} / ${esc(r.student?.programmeName)}</strong><p>${expired(r) && r.status==='accepted' ? 'Expired' : r.status} / expires ${esc(date(r.expiresAt))}</p><div class="ui-actions">${r.status==='accepted' && !expired(r) ? r.categories.map(c => `<button class="button button-secondary" type="button" data-share-read="${c}" data-id="${esc(r.id)}">${labels[c]}</button>`).join('') : ''}${r.status==='accepted' ? `<button class="button button-secondary" type="button" data-share-decline="${esc(r.id)}">End access</button>` : ''}</div></li>`).join('') || '<li>No accepted shares.</li>'}</ul>${pages(state.list,'data-share-received-page')}</section>` : ''}
      ${state.record ? `<section data-shared-record><h2>${esc(state.record.student.legalName)} / ${esc(state.record.student.programmeName)}</h2><h3>${labels[state.record.category]}</h3>${recordView(state.record)}<button class="button button-secondary" type="button" data-share-close>Close record</button></section>` : ''}</div></section>`;
    window.svuUI.enhance(root);
    const run=async work => {if(state.busy)return;state.busy=true;state.notice='';const generation=epoch,token=window.svuSession.get()?.token,route=location.hash;paint(root);
      try {await work();}catch(e){if(generation===epoch){delete state.record;state.notice=e.message;state.error=true;}}
      finally {if(generation===epoch && token===window.svuSession.get()?.token){state.busy=false;if(route===location.hash)paint(root);}}
    };
    const refresh=async () => {const generation=epoch,route=location.hash;const list=await api('GET',`/api/student-sharing/received?offset=${state.offset || 0}`);if(generation===epoch && route===location.hash)state.list=list;};
    root.querySelector('[data-share-accept]')?.addEventListener('submit',e => {e.preventDefault();const v=Object.fromEntries(new FormData(e.currentTarget));const token=invitation || v.token,password=v.password;
      run(async () => {if(signed){await api('POST','/api/student-sharing/accept',{token,accept:true});invitation='';await window.svuSession.refresh();await refresh();state.notice='Sharing invitation accepted.';}
        else {const result=await api('POST','/api/student-sharing/register',{token,legalName:v.legalName,preferredName:v.preferredName,password,accept:true});invitation='';const session=await api('POST','/api/identity/sessions',{email:result.email,password});window.svuSession.set(session);location.hash='#shared';await render(root);}
      });
    });
    root.querySelectorAll('[data-share-read]').forEach(b => b.addEventListener('click',() => run(async () => {delete state.record;const generation=epoch,route=location.hash;const r=await api('GET',`/api/student-sharing/${b.dataset.id}/${b.dataset.shareRead}`);if(generation===epoch && route===location.hash)state.record=r;})));
    root.querySelector('[data-share-close]')?.addEventListener('click',() => {delete state.record;paint(root);});
    root.querySelectorAll('[data-share-decline]').forEach(b => b.addEventListener('click',() => run(async () => {const r=state.list.shares.find(r => r.id===b.dataset.shareDecline);await api('POST',`/api/student-sharing/${r.id}/decline`,{revision:r.revision,requestKey:crypto.randomUUID()});delete state.record;await refresh();state.notice='Record access ended.';})));
    root.querySelectorAll('[data-share-received-page]').forEach(b => b.addEventListener('click',() => run(async () => {delete state.record;state.offset=state.list.offset+Number(b.dataset.shareReceivedPage)*25;await refresh();})));
    root.querySelectorAll('[data-share-record-page]').forEach(b => b.addEventListener('click',() => run(async () => {const r=state.record,generation=epoch,route=location.hash;delete state.record;const record=await api('GET',`/api/student-sharing/${r.shareId}/${r.category}?offset=${r.data.offset+Number(b.dataset.shareRecordPage)*25}`);if(generation===epoch && route===location.hash)state.record=record;}))); 
  }
  async function render(root) {
    const query=new URLSearchParams(location.hash.split('?')[1] || '');
    if(query.has('token')){invitation=query.get('token');history.replaceState(null,'','#shared/invitation');}
    const generation=++epoch,route=location.hash;delete state.record;state.busy=true;paint(root);
    try {if(window.svuSession.get()){const list=await api('GET',`/api/student-sharing/received?offset=${state.offset || 0}`);if(generation===epoch && route===location.hash)state.list=list;}}
    catch(e){if(generation===epoch){state.notice=e.message;state.error=true;delete state.list;}}
    finally {if(generation===epoch && route===location.hash){state.busy=false;paint(root);}}
  }
  window.studentSharingUI={ownRender,ownBind,render};
})();
