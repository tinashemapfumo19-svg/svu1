(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const date = (value) => value ? window.svuUI.dateTime(value) : '';
  const ownPath = '/api/admissions/me/communications',staffPath = '/api/admissions/communications';
  function clearOwn(state) {for (const key of Object.keys(state)) if (key.startsWith('communicationOwn')) delete state[key];}
  async function loadOwn(state,api,getToken) {
    const token = getToken(),generation = Symbol();state.communicationOwnGeneration = generation;
    try {
      const preferences = await api('GET',`${ownPath}/preferences`);
      if (token !== getToken() || generation !== state.communicationOwnGeneration) return;
      const inbox = await api('GET',`${ownPath}/messages?offset=${state.communicationOwnOffset || 0}`);
      if (token !== getToken() || generation !== state.communicationOwnGeneration) return;
      state.communicationOwnPreferences = preferences;state.communicationOwnInbox = inbox;state.communicationOwnError = null;
    } catch(error) {
      if (token !== getToken() || generation !== state.communicationOwnGeneration) return;
      state.communicationOwnPreferences = null;state.communicationOwnInbox = null;state.communicationOwnError = error.message;
    }
  }
  function ownView(state) {
    const preferences = state.communicationOwnPreferences,inbox = state.communicationOwnInbox,choices = state.communicationOwnDraft || preferences;
    if (!preferences && !state.communicationOwnError) return '';
    return `<section class="communication-workspace" data-communication-own><header class="section-header"><h2>Admissions updates</h2><button class="icon-button" type="button" data-communication-own-refresh title="Refresh admissions updates" aria-label="Refresh admissions updates">&#8635;</button></header>
      ${state.communicationOwnError ? `<p class="notice notice-warning" role="alert">${esc(state.communicationOwnError)}</p>` : ''}
      <fieldset class="communication-controls" ${state.communicationOwnBusy ? 'disabled' : ''}>
      ${preferences ? `<details><summary>Optional update preferences</summary><form class="form" data-communication-preferences>
        <label class="check-option"><input type="checkbox" name="inApp" ${choices.inApp ? 'checked' : ''}>In-app admissions updates</label>
        <label class="check-option"><input type="checkbox" name="email" ${choices.email ? 'checked' : ''}>Email admissions updates</label>
        <button class="button button-secondary" type="submit">Save preferences</button></form></details>` : ''}
      ${inbox ? `<h3>Inbox</h3>${inbox.items.length ? inbox.items.map((row) => `<details class="communication-message" data-communication-message="${esc(row.id)}"><summary>${esc(row.subject)}${row.readAt ? '' : ' - Unread'}</summary><p class="muted">${esc(date(row.createdAt))}</p><p class="communication-body">${esc(row.body)}</p>${row.readAt ? '' : `<button class="icon-button" type="button" data-communication-read="${esc(row.id)}" title="Mark message read" aria-label="Mark message read">&#10003;</button>`}</details>`).join('') : '<p>No admissions updates.</p>'}
        <div class="communication-pagination"><button class="icon-button" type="button" data-communication-own-page="${Math.max(0,inbox.offset-25)}" title="Previous messages" aria-label="Previous messages" ${!inbox.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(inbox.offset/25)+1}</span><button class="icon-button" type="button" data-communication-own-page="${inbox.offset+25}" title="Next messages" aria-label="Next messages" ${inbox.items.length < 25 ? 'disabled' : ''}>&rarr;</button></div>` : ''}</fieldset></section>`;
  }
  function ownBind(root,state,{api,getToken,act}) {
    const run = (work) => {
      const token = getToken(),nonce = Symbol();state.communicationOwnBusy = nonce;
      root.querySelector('[data-communication-own] fieldset')?.setAttribute('disabled','');
      act(async () => {try {if (token !== getToken()) return;await work();if (token === getToken()) await loadOwn(state,api,getToken);} finally {if (state.communicationOwnBusy === nonce) delete state.communicationOwnBusy;}});
    };
    root.querySelector('[data-communication-own-refresh]')?.addEventListener('click',() => run(async () => {}));
    root.querySelector('[data-communication-preferences]')?.addEventListener('submit',(event) => {
      event.preventDefault();const form = new FormData(event.currentTarget),revision = state.communicationOwnPreferences.revision;
      const choices = {inApp:form.has('inApp'),email:form.has('email')},token = getToken();state.communicationOwnDraft = choices;
      run(async () => {await api('PUT',`${ownPath}/preferences`,{revision,...choices});if (token === getToken()) delete state.communicationOwnDraft;});
    });
    root.querySelectorAll('[data-communication-own-page]').forEach((button) => button.addEventListener('click',() => run(async () => {state.communicationOwnOffset = Number(button.dataset.communicationOwnPage);} )));
    root.querySelectorAll('[data-communication-read]').forEach((button) => button.addEventListener('click',() => run(() => api('POST',`${ownPath}/messages/${button.dataset.communicationRead}/read`,{}))));
  }
  async function loadStaff(state,api) {
    const token = state.session?.token,generation = Symbol();state.communicationStaffGeneration = generation;
    try {
      const metadata = await api('GET',`${staffPath}/metadata`);
      if (token !== state.session?.token || generation !== state.communicationStaffGeneration) return;
      const list = await api('GET',`${staffPath}/campaigns?offset=${state.communicationStaffOffset || 0}`);
      if (token !== state.session?.token || generation !== state.communicationStaffGeneration) return;
      state.communicationStaffMetadata = metadata;state.communicationStaffList = list;state.communicationStaffError = null;state.communicationStaffAuthorized = true;
    } catch(error) {
      if (token !== state.session?.token || generation !== state.communicationStaffGeneration) return;
      state.communicationStaffMetadata = null;state.communicationStaffList = null;state.communicationStaffPreview = null;
      state.communicationStaffError = state.communicationStaffAuthorized ? error.message : null;
    }
  }
  function staffView(state) {
    const metadata = state.communicationStaffMetadata,list = state.communicationStaffList,preview = state.communicationStaffPreview,draft = state.communicationStaffDraft || {};
    if (!metadata && !state.communicationStaffError) return '';
    const option = (value,label,current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
    return `<details class="communication-workspace" data-communication-staff ${state.communicationStaffOpen ? 'open' : ''}><summary>Applicant group updates</summary><header class="section-header"><h3>Applicant group updates</h3><button class="icon-button" type="button" data-communication-staff-refresh title="Refresh group updates" aria-label="Refresh group updates">&#8635;</button></header>
      ${state.communicationStaffError ? `<p class="notice notice-warning" role="alert">${esc(state.communicationStaffError)}</p>` : ''}
      <fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}>
      ${metadata ? `<form class="form form-grid" data-communication-preview>
        <label class="field"><span>Intake</span><select class="input" name="intakeId" required>${metadata.intakes.map((row) => option(row.intakeId,`${row.programmeCode} - ${row.label}`,draft.intakeId)).join('')}</select></label>
        <label class="field"><span>Application status</span><select class="input" name="status">${['submitted','draft','withdrawn'].map((value) => option(value,value,draft.status || 'submitted')).join('')}</select></label>
        <label class="field"><span>Workflow state</span><select class="input" name="workflowState" ${draft.status && draft.status !== 'submitted' ? 'disabled' : ''}>${option('','All states',draft.workflowState)}${metadata.states.map((value) => option(value,value,draft.workflowState)).join('')}</select></label>
        <div class="field"><span>Channels</span><label class="check-option"><input type="checkbox" name="inApp" ${draft.inApp !== false ? 'checked' : ''}>In-app</label><label class="check-option"><input type="checkbox" name="email" ${draft.email ? 'checked' : ''}>Email</label></div>
        <label class="field communication-wide"><span>Subject</span><input class="input" name="subject" value="${esc(draft.subject)}" maxlength="160" required></label>
        <label class="field communication-wide"><span>Message</span><textarea class="input" name="body" maxlength="4000" required>${esc(draft.body)}</textarea></label>
        <label class="field communication-wide"><span>Internal reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc(draft.reason)}</textarea></label>
        <div><button class="button button-secondary" type="submit" ${!metadata.intakes.length ? 'disabled' : ''}>Preview audience</button></div></form>` : ''}
      ${preview ? `<section class="communication-preview" data-communication-preview-result><h4>${esc(preview.subject)}</h4><p class="communication-body">${esc(preview.body)}</p><p>${esc(preview.intakeLabel)} - ${esc(preview.status)}</p>
        ${Object.keys(preview.emailDelivery || {}).length ? `<h4>Email delivery</h4><dl class="communication-counts" data-campaign-email-status>${Object.entries(preview.emailDelivery).map(([status,total]) => `<dt>${esc(status)}</dt><dd>${esc(total)}</dd>`).join('')}</dl>` : ''}
        <dl class="communication-counts">${Object.entries({Applications:preview.counts.applications,Accounts:preview.counts.accounts,'In-app recipients':preview.counts.inApp,'Email recipients':preview.counts.email,'Excluded in-app':preview.counts.excludedInApp,'Excluded email':preview.counts.excludedEmail}).map(([label,value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
        <details><summary>Audience (${preview.counts.recipientChannels})</summary><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Applicant</th><th>Channel</th></tr></thead><tbody>${preview.recipients.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.channel.replaceAll('_',' '))}</td></tr>`).join('')}</tbody></table></div></details>
        ${preview.status === 'preview' ? `<p class="muted">Expires ${esc(date(preview.expiresAt))}</p><button class="button button-primary" type="button" data-communication-publish ${preview.expired || !preview.counts.recipientChannels ? 'disabled' : ''}>Publish and queue</button>` : `<p class="pill">Published ${esc(date(preview.publishedAt))}</p>`}</section>` : ''}
      ${list ? `<h4>Campaign history</h4><div class="result-table-wrap"><table class="result-table communication-history"><thead><tr><th>Subject</th><th>Intake</th><th>Status</th><th>Recipients</th></tr></thead><tbody>${list.items.map((row) => `<tr><td><button class="text-button" type="button" data-communication-open="${esc(row.id)}">${esc(row.subject)}</button></td><td>${esc(row.intakeLabel)}</td><td>${esc(row.status)}</td><td>${row.counts.recipientChannels}</td></tr>`).join('')}</tbody></table></div>
      <div class="communication-pagination"><button class="icon-button" type="button" data-communication-staff-page="${Math.max(0,list.offset-25)}" title="Previous campaigns" aria-label="Previous campaigns" ${!list.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(list.offset/25)+1}</span><button class="icon-button" type="button" data-communication-staff-page="${list.offset+25}" title="Next campaigns" aria-label="Next campaigns" ${list.items.length < 25 ? 'disabled' : ''}>&rarr;</button></div>` : ''}</fieldset></details>`;
  }
  function staffBind(root,state,{api,act}) {
    const request = async (...args) => {
      const token = state.session?.token;
      try {return await api(...args);} catch(error) {
        if (token === state.session?.token && [403,404].includes(error.status)) {
          state.communicationStaffMetadata = null;state.communicationStaffList = null;state.communicationStaffPreview = null;
          state.communicationStaffDraft = null;state.communicationStaffKey = null;state.communicationStaffError = error.message;
        }
        throw error;
      }
    };
    root.querySelector('[data-communication-staff]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.communicationStaffOpen = event.currentTarget.open;});
    const form = root.querySelector('[data-communication-preview]');
    const capture = () => {const values = Object.fromEntries(new FormData(form));return {...values,inApp:values.inApp === 'on',email:values.email === 'on'};};
    form?.addEventListener('input',() => {state.communicationStaffDraft = capture();state.communicationStaffKey = null;state.communicationStaffPreview = null;root.querySelector('[data-communication-preview-result]')?.remove();});
    form?.querySelector('[name="status"]')?.addEventListener('change',(event) => {const field = form.querySelector('[name="workflowState"]');field.disabled = event.target.value !== 'submitted';if (field.disabled) field.value = '';state.communicationStaffDraft = capture();});
    form?.addEventListener('submit',(event) => {
      event.preventDefault();const values = capture();state.communicationStaffDraft = values;
      const requestKey = state.communicationStaffKey ||= `preview_${crypto.randomUUID()}`,token = state.session?.token;
      act(async () => {const result = await request('POST',`${staffPath}/preview`,{filters:{intakeId:values.intakeId,status:values.status,workflowState:values.workflowState || ''},subject:values.subject,body:values.body,reason:values.reason,channels:[...(values.inApp ? ['in_app'] : []),...(values.email ? ['email'] : [])],requestKey});if (token === state.session?.token) {state.communicationStaffPreview = result;state.communicationStaffKey = null;}});
    });
    root.querySelector('[data-communication-staff-refresh]')?.addEventListener('click',() => act(() => loadStaff(state,api)));
    root.querySelector('[data-communication-publish]')?.addEventListener('click',() => {
      const id = state.communicationStaffPreview.id,token = state.session?.token;
      act(async () => {try {const result = await request('POST',`${staffPath}/campaigns/${id}/publish`,{});if (token === state.session?.token) {state.communicationStaffPreview = result;await loadStaff(state,api);}} catch(error) {if (token === state.session?.token && [403,404,409].includes(error.status)) {state.communicationStaffPreview = null;state.communicationStaffKey = null;}throw error;}});
    });
    root.querySelectorAll('[data-communication-open]').forEach((button) => button.addEventListener('click',() => {
      const token = state.session?.token;state.communicationStaffPreview = null;
      act(async () => {const result = await request('GET',`${staffPath}/campaigns/${button.dataset.communicationOpen}`);if (token === state.session?.token) state.communicationStaffPreview = result;});
    }));
    root.querySelectorAll('[data-communication-staff-page]').forEach((button) => button.addEventListener('click',() => act(async () => {state.communicationStaffOffset = Number(button.dataset.communicationStaffPage);await loadStaff(state,api);} )));
  }
  window.applicantCommunicationsUI = {clearOwn,loadOwn,ownView,ownBind,loadStaff,staffView,staffBind};
})();
