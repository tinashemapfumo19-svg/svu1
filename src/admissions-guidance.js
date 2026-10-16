(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const base = '/api/guidance/manage',option = (v,label,current) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(label)}</option>`;
  const pages = (list,kind) => `<div class="communication-pagination"><button class="icon-button" type="button" data-guidance-${kind}-page="${Math.max(0,list.offset-25)}" title="Previous guidance" aria-label="Previous guidance" ${!list.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(list.offset/25)+1}</span><button class="icon-button" type="button" data-guidance-${kind}-page="${list.offset+25}" title="Next guidance" aria-label="Next guidance" ${list.items.length < 25 ? 'disabled' : ''}>&rarr;</button></div>`;
  async function loadPublic(state,api) {
    const generation = Symbol();state.guidancePublicGeneration = generation;
    try {
      const result = await api('GET',`/api/guidance/articles?${new URLSearchParams(state.guidancePublicFilters || {})}`);
      if (generation !== state.guidancePublicGeneration) return;
      state.guidancePublic = result;state.guidancePublicError = null;
    } catch(error) {if (generation === state.guidancePublicGeneration) {state.guidancePublic = null;state.guidancePublicError = error.message;}}
  }
  function publicView(state) {
    const list = state.guidancePublic,filters = state.guidancePublicFilters || {},catalogue = state.catalogue || [];
    const programmes = [...new Map(catalogue.map((r) => [r.programmeId,r])).values()];
    return `<section class="guidance-workspace" data-guidance-public><h2>Admissions guidance</h2><form class="form form-grid" data-guidance-search>
      <label class="field"><span>Search</span><input class="input" type="search" name="q" maxlength="160" value="${esc(filters.q)}"></label>
      <label class="field"><span>Programme</span><select class="input" name="programmeId">${option('','All programmes',filters.programmeId)}${programmes.map((r) => option(r.programmeId,`${r.programmeCode} - ${r.programmeName}`,filters.programmeId)).join('')}</select></label>
      <label class="field"><span>Intake</span><select class="input" name="intakeId">${option('','All intakes',filters.intakeId)}${catalogue.filter((r) => !filters.programmeId || r.programmeId === filters.programmeId).map((r) => option(r.intakeId,`${r.programmeCode} - ${r.label}`,filters.intakeId)).join('')}</select></label>
      <div class="field"><span>&nbsp;</span><button class="button button-secondary" type="submit">Search</button></div></form>
      ${state.guidancePublicError ? `<p class="notice notice-warning" role="alert">${esc(state.guidancePublicError)}</p>` : ''}
      ${list ? `${list.items.length ? list.items.map((r) => `<details class="guidance-entry" data-guidance-article="${esc(r.id)}"><summary>${esc(r.title)}</summary><p class="muted">${esc(r.programmeCode || 'Institutional')} ${esc(r.intakeLabel)} - Version ${r.version}</p><p class="communication-body">${esc(r.body)}</p><p class="small">Source: ${esc(r.sourceRef)}</p><p class="small muted">Effective ${esc(r.effectiveFrom)}${r.validUntil ? ` to ${esc(r.validUntil)}` : ''}</p>${state.enquiryOwnList ? `<button class="button button-secondary" type="button" data-enquiry-guidance="${esc(r.versionId)}">Ask admissions</button>` : ''}</details>`).join('') : '<p>No published guidance matches.</p>'}${pages(list,'public')}` : ''}</section>`;
  }
  function publicBind(root,state,{api,act}) {
    const form = root.querySelector('[data-guidance-search]');
    form?.querySelector('[name="programmeId"]')?.addEventListener('change',() => {
      const select = form.querySelector('[name="intakeId"]'),programmeId = form.elements.programmeId.value;
      select.innerHTML = option('','All intakes','') + (state.catalogue || []).filter((r) => !programmeId || r.programmeId === programmeId).map((r) => option(r.intakeId,`${r.programmeCode} - ${r.label}`,'')).join('');
    });
    form?.addEventListener('submit',(event) => {event.preventDefault();state.guidancePublicFilters = {...Object.fromEntries(new FormData(form)),offset:'0'};act(() => loadPublic(state,api));});
    root.querySelectorAll('[data-guidance-public-page]').forEach((b) => b.addEventListener('click',() => {state.guidancePublicFilters = {...state.guidancePublicFilters,offset:b.dataset.guidancePublicPage};act(() => loadPublic(state,api));}));
  }
  function clearStaff(state) {for (const key of ['guidanceMetadata','guidanceList','guidanceDetail','guidanceDraft','guidanceKey','guidanceSubmission','guidanceReviewReason','guidanceWithdrawalReason','guidanceSelectedId']) delete state[key];}
  async function loadStaff(state,api) {
    const token = state.session?.token,generation = Symbol();state.guidanceGeneration = generation;
    const current = () => token === state.session?.token && generation === state.guidanceGeneration;
    try {
      const metadata = await api('GET',`${base}/metadata`);if (!current()) return;
      const list = await api('GET',`${base}/articles?offset=${state.guidanceOffset || 0}`);if (!current()) return;
      let detail = null;
      if (state.guidanceSelectedId) {detail = await api('GET',`${base}/articles/${encodeURIComponent(state.guidanceSelectedId)}`);if (!current()) return;}
      state.guidanceMetadata = metadata;state.guidanceList = list;state.guidanceDetail = detail;state.guidanceError = null;state.guidanceAuthorized = true;
    } catch(error) {
      if (!current()) return;
      if ([401,403,404].includes(error.status)) clearStaff(state);
      else {state.guidanceMetadata = null;state.guidanceList = null;state.guidanceDetail = null;}
      state.guidanceError = state.guidanceAuthorized ? error.message : null;
    }
  }
  function editor(state) {
    const metadata = state.guidanceMetadata,article = state.guidanceDetail,draft = state.guidanceDraft || {},scope = draft.scope || '';
    const scopes = [...(metadata.institutional ? [['institutional','Institutional']] : []),...metadata.programmes.filter((r) => r.canDraft).map((r) => [`programme:${r.id}`,`${r.programmeCode} - All intakes`]),...metadata.intakes.filter((r) => r.canDraft).map((r) => [`intake:${r.intakeId}`,`${r.programmeCode} - ${r.label}`])];
    if (article && !article.canDraft || !article && !scopes.length) return '';
    return `<form class="form form-grid" data-guidance-editor>${article ? `<p class="communication-wide">New version - revision ${article.revision}</p>` : `<label class="field communication-wide"><span>Scope</span><select class="input" name="scope" required>${option('','Choose scope',scope)}${scopes.map(([v,label]) => option(v,label,scope)).join('')}</select></label>`}
      <label class="field communication-wide"><span>Title</span><input class="input" name="title" maxlength="180" value="${esc(draft.title)}" required></label>
      <label class="field communication-wide"><span>Guidance</span><textarea class="input" name="body" maxlength="6000" required>${esc(draft.body)}</textarea></label>
      <label class="field communication-wide"><span>Public source reference</span><input class="input" name="sourceRef" maxlength="500" value="${esc(draft.sourceRef)}" required></label>
      <label class="field"><span>Effective from</span><input class="input" type="date" name="effectiveFrom" value="${esc(draft.effectiveFrom)}" required></label>
      <label class="field"><span>Valid until</span><input class="input" type="date" name="validUntil" value="${esc(draft.validUntil)}"></label>
      <label class="field communication-wide"><span>Internal reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc(draft.reason)}</textarea></label><div><button class="button button-secondary" type="submit">Save draft</button></div></form>`;
  }
  function staffView(state) {
    const metadata = state.guidanceMetadata,list = state.guidanceList,article = state.guidanceDetail;
    if (!metadata && !state.guidanceError) return '';
    return `<details class="guidance-workspace" data-guidance-staff ${state.guidanceOpen ? 'open' : ''}><summary>Guidance publishing</summary><header class="section-header"><h3>Guidance publishing</h3><button class="icon-button" type="button" data-guidance-refresh title="Refresh guidance" aria-label="Refresh guidance">&#8635;</button></header>
      ${state.guidanceError ? `<p class="notice notice-warning" role="alert">${esc(state.guidanceError)}</p>` : ''}<fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}>
      ${metadata ? `<button class="button button-secondary" type="button" data-guidance-new>New article</button>${editor(state)}` : ''}
      ${article ? `<section class="guidance-review" data-guidance-detail><h4>${esc(article.programmeCode || 'Institutional')} ${esc(article.intakeLabel)} - ${esc(article.status)}</h4>
        ${article.versions.map((v,i) => `<details class="guidance-entry" ${i === 0 ? 'open' : ''}><summary>Version ${v.version} - ${esc(v.status)} - ${esc(v.title)}</summary><p class="communication-body">${esc(v.body)}</p><p>Source: ${esc(v.sourceRef)}</p><p class="muted">Effective ${esc(v.effectiveFrom)}${v.validUntil ? ` to ${esc(v.validUntil)}` : ''}</p><p class="communication-body">Internal reason: ${esc(v.reason)}</p>
          ${i === 0 && v.canPublish ? `<form class="form" data-guidance-publish="${esc(v.id)}"><label class="field"><span>Approval reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc(state.guidanceReviewReason)}</textarea></label><button class="button button-primary" type="submit">Publish version</button></form>` : ''}</details>`).join('')}
        ${article.canWithdraw ? `<form class="form" data-guidance-withdraw><label class="field"><span>Withdrawal reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc(state.guidanceWithdrawalReason)}</textarea></label><button class="button button-secondary" type="submit">Withdraw article</button></form>` : ''}
        <details><summary>Review history</summary>${article.history.map((h) => `<p class="communication-body">Revision ${h.revision} - ${esc(h.action)}${h.version ? ` - Version ${h.version}` : ''}: ${esc(h.reason)}</p>`).join('')}</details></section>` : ''}
      ${list ? `<h4>Articles</h4><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Title</th><th>Scope</th><th>Status</th><th>Version</th></tr></thead><tbody>${list.items.map((r) => `<tr><td><button class="text-button" type="button" data-guidance-open="${esc(r.id)}">${esc(r.title)}</button></td><td>${esc(r.programmeCode || 'Institutional')} ${esc(r.intakeLabel)}</td><td>${esc(r.status)}</td><td>${r.latestVersion}</td></tr>`).join('')}</tbody></table></div>${pages(list,'staff')}` : ''}</fieldset></details>`;
  }
  function staffBind(root,state,{api,act}) {
    const request = async (...args) => {
      const token = state.session?.token;
      try {return await api(...args);} catch(error) {if (token === state.session?.token && [403,404].includes(error.status)) {clearStaff(state);state.guidanceError = error.message;}throw error;}
    };
    root.querySelector('[data-guidance-staff]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.guidanceOpen = event.currentTarget.open;});
    root.querySelector('[data-guidance-refresh]')?.addEventListener('click',() => act(() => loadStaff(state,request)));
    const clearIntent = () => {for (const key of ['guidanceDraft','guidanceKey','guidanceSubmission','guidanceReviewReason','guidanceWithdrawalReason']) delete state[key];};
    root.querySelector('[data-guidance-new]')?.addEventListener('click',() => act(async () => {delete state.guidanceSelectedId;state.guidanceDetail = null;clearIntent();}));
    root.querySelectorAll('[data-guidance-open]').forEach((b) => b.addEventListener('click',() => act(async () => {state.guidanceSelectedId = b.dataset.guidanceOpen;clearIntent();await loadStaff(state,request);} )));
    root.querySelectorAll('[data-guidance-staff-page]').forEach((b) => b.addEventListener('click',() => act(async () => {state.guidanceOffset = Number(b.dataset.guidanceStaffPage);await loadStaff(state,request);} )));
    const form = root.querySelector('[data-guidance-editor]'),capture = () => Object.fromEntries(new FormData(form));
    form?.addEventListener('input',() => {state.guidanceDraft = capture();state.guidanceKey = null;state.guidanceSubmission = null;});
    form?.addEventListener('submit',(event) => {
      event.preventDefault();const values = capture(),article = state.guidanceDetail,token = state.session?.token;
      state.guidanceDraft = values;const requestKey = state.guidanceKey ||= `guidance_${crypto.randomUUID()}`;
      const {scope,...content} = values;content.validUntil ||= null;
      let data,path;
      if (article) {data = {...content,revision:article.revision,requestKey};path = `${base}/articles/${article.id}/versions`;}
      else {
        const intake = state.guidanceMetadata.intakes.find((r) => `intake:${r.intakeId}` === scope);
        data = {...content,programmeId:intake?.programmeId || (scope?.startsWith('programme:') ? scope.slice(10) : null),intakeId:intake?.intakeId || null,requestKey};path = `${base}/articles`;
      }
      act(async () => {
        const submission = state.guidanceSubmission ||= {path,data};
        let result;
        try {result = await request('POST',submission.path,submission.data);} catch(error) {
          if (token === state.session?.token && error.status === 409) {state.guidanceSubmission = null;state.guidanceKey = null;}
          throw error;
        }
        if (token !== state.session?.token) return;
        state.guidanceSelectedId = result.id;state.guidanceDetail = result;clearIntent();await loadStaff(state,request);
      });
    });
    for (const selector of ['[data-guidance-publish]','[data-guidance-withdraw]']) {
      const field = selector === '[data-guidance-publish]' ? 'guidanceReviewReason' : 'guidanceWithdrawalReason';
      root.querySelector(`${selector} [name="reason"]`)?.addEventListener('input',(event) => {state[field] = event.target.value;});
      root.querySelector(selector)?.addEventListener('submit',(event) => {
      event.preventDefault();const form = event.currentTarget,article = state.guidanceDetail,reason = new FormData(form).get('reason'),token = state.session?.token;
      const path = form.dataset.guidancePublish ? `${base}/articles/${article.id}/versions/${form.dataset.guidancePublish}/publish` : `${base}/articles/${article.id}/withdraw`;
      act(async () => {const result = await request('POST',path,{revision:article.revision,reason});if (token !== state.session?.token) return;state.guidanceDetail = result;delete state[field];await loadStaff(state,request);});
    });
    }
  }
  window.admissionsGuidanceUI = {loadPublic,publicView,publicBind,loadStaff,staffView,staffBind,clearStaff};
})();
