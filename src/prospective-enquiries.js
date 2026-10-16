(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,(c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const label = (v) => String(v ?? '').replaceAll('_',' '),date = (v) => v ? window.svuUI.dateTime(v) : '';
  const statuses = ['open','in_progress','waiting_applicant','resolved','withdrawn'];
  const option = (v,title,current) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(title)}</option>`;
  const text = (name,title,max,value = '') => `<label class="field communication-wide"><span>${esc(title)}</span>${name === 'subject' ? `<input class="input" name="subject" maxlength="${max}" value="${esc(value)}" required>` : `<textarea class="input" name="${name}" maxlength="${max}" required>${esc(value)}</textarea>`}</label>`;
  const consent = (checked = false) => `<label class="check-option communication-wide"><input type="checkbox" name="consent" required ${checked ? 'checked' : ''}>Allow admissions to reply in this enquiry.</label>`;
  const path = (self) => `/api/enquiries/${self ? 'me/' : ''}cases`;
  function clear(state,prefix) {for (const key of Object.keys(state)) if (key.startsWith(prefix)) delete state[key];}
  const clearOwn = (state) => clear(state,'enquiryOwn');
  async function load(state,api,getToken,self = false) {
    const prefix = self ? 'enquiryOwn' : 'enquiryStaff',token = getToken(),generation = Symbol(),selected = state[`${prefix}SelectedId`];state[`${prefix}Generation`] = generation;
    const current = () => token === getToken() && generation === state[`${prefix}Generation`] && selected === state[`${prefix}SelectedId`];
    try {
      let metadata = null;
      if (!self) {metadata = await api('GET','/api/enquiries/metadata');if (!current()) return;}
      const list = await api('GET',`${path(self)}?${new URLSearchParams(state[`${prefix}Filters`] || {})}`);if (!current()) return;
      const detail = selected ? await api('GET',`${path(self)}/${encodeURIComponent(selected)}`) : null;if (!current()) return;
      state[`${prefix}Metadata`] = metadata;state[`${prefix}List`] = list;state[`${prefix}Detail`] = detail;state[`${prefix}Error`] = null;state[`${prefix}Authorized`] = true;
    } catch(error) {
      if (!current()) return;
      const hadAccess = state[`${prefix}Authorized`];
      if ([401,403,404].includes(error.status)) clear(state,prefix);
      else {state[`${prefix}Metadata`] = null;state[`${prefix}List`] = null;state[`${prefix}Detail`] = null;}
      state[`${prefix}Error`] = self || hadAccess ? error.message : null;
    }
  }
  function pages(list,self) {return `<div class="communication-pagination"><button class="icon-button" type="button" data-enquiry-${self ? 'own' : 'staff'}-page="${Math.max(0,list.offset-25)}" title="Previous enquiries" aria-label="Previous enquiries" ${!list.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(list.offset/25)+1}</span><button class="icon-button" type="button" data-enquiry-${self ? 'own' : 'staff'}-page="${list.offset+25}" title="Next enquiries" aria-label="Next enquiries" ${list.items.length < 25 ? 'disabled' : ''}>&rarr;</button></div>`;}
  function queue(list,self) {
    const mode = self ? 'own' : 'staff';
    return `<div class="result-table-wrap"><table class="result-table enquiry-queue"><thead><tr><th>Enquiry</th>${self ? '' : '<th>Applicant</th>'}<th>Intake</th><th>Status</th><th>Updated</th></tr></thead><tbody>${list.items.map((r) => `<tr><td><button class="enquiry-link" type="button" data-enquiry-${mode}-open="${esc(r.id)}">${esc(r.subject)}</button></td>${self ? '' : `<td>${esc(r.ownerName)}</td>`}<td>${esc(r.programmeCode)} - ${esc(r.intakeLabel)}</td><td>${esc(label(r.status))}${r.escalated ? ' - Escalated' : ''}</td><td>${esc(date(r.updatedAt))}</td></tr>`).join('') || `<tr><td colspan="${self ? 4 : 5}">No enquiries</td></tr>`}</tbody></table></div>${pages(list,self)}`;
  }
  function detail(state,self) {
    const prefix = self ? 'enquiryOwn' : 'enquiryStaff',mode = self ? 'own' : 'staff',row = state[`${prefix}Detail`];if (!row) return '';
    const draft = state[`${prefix}CommentDraft`] || {},triage = state[`${prefix}UpdateDraft`] || {},escalation = state[`${prefix}EscalateDraft`] || {},managers = row.assignees.filter((r) => r.canEscalate),applications = state.enquiryOwnApplications || [],application = applications.find((r) => r.intakeId === row.intakeId),intake = (state.catalogue || []).find((r) => r.intakeId === row.intakeId);
    return `<section class="enquiry-detail" data-enquiry-${mode}-detail data-enquiry-revision="${row.revision}"><h3>${esc(row.subject)}</h3><p>${esc(row.programmeCode)} - ${esc(row.intakeLabel)} - ${esc(label(row.status))}${row.escalated ? ' - Escalated' : ''}</p><p class="muted">Reply consent: ${row.consentActive ? 'Active' : row.status === 'withdrawn' ? 'Withdrawn' : 'Ended'} - ${esc(row.consentPolicy)}</p>
      ${row.guidanceVersion ? `<p class="small">Captured guidance reference: version ${row.guidanceVersion}</p>` : ''}
      ${self && application ? `<button class="button button-secondary" type="button" data-enquiry-application="${esc(application.id)}">Open application</button>` : self && intake?.applicationsOpen ? `<button class="button button-secondary" type="button" data-start="${esc(row.intakeId)}">Start application</button>` : ''}
      ${!self ? `<p>Assigned: ${esc(row.assignees.find((r) => r.id === row.assigneeId)?.name || (row.assigneeId ? 'No longer available' : 'Unassigned'))} - Escalations: ${row.escalationLevel}</p>` : ''}
      <ol class="enquiry-thread">${row.messages.map((m) => `<li data-enquiry-message><header><strong>${m.authorKind === 'applicant' ? 'Applicant' : 'Admissions'}${m.visibility === 'internal' ? ' - Staff only' : ''}</strong><time>${esc(date(m.createdAt))}</time></header><p class="communication-body">${esc(m.body)}</p></li>`).join('')}</ol>
      ${row.canComment ? `<form class="form form-grid" data-enquiry-${mode}-action="comment">${text('body',self ? 'Reply' : 'Message',4000,draft.body)}${!self ? `<label class="field"><span>Visibility</span><select class="input" name="visibility">${option('public','Applicant reply',draft.visibility || 'public')}${option('internal','Staff only',draft.visibility)}</select></label>` : ''}<div><button class="button button-primary" type="submit">Send reply</button></div></form>` : ''}
      ${!self && row.canTriage ? `<details><summary>Assignment and status</summary><form class="form form-grid" data-enquiry-staff-action="update"><label class="field"><span>Status</span><select class="input" name="status">${statuses.filter((s) => s !== 'withdrawn').map((s) => option(s,label(s),triage.status || row.status)).join('')}</select></label><label class="field"><span>Assignee</span><select class="input" name="assigneeId">${option('','Unassigned',triage.assigneeId ?? row.assigneeId)}${row.assignees.map((r) => option(r.id,r.name,triage.assigneeId ?? row.assigneeId)).join('')}</select></label>${row.canSupervise && row.escalated ? `<label class="check-option communication-wide"><input type="checkbox" name="resolveEscalation" ${triage.resolveEscalation ? 'checked' : ''}>Resolve escalation</label>` : ''}${text('reason','Triage reason',2000,triage.reason)}<div><button class="button button-secondary" type="submit">Update enquiry</button></div></form></details>` : ''}
      ${!self && row.canEscalate && managers.length ? `<details><summary>Escalation</summary><form class="form form-grid" data-enquiry-staff-action="escalate"><label class="field"><span>Escalation manager</span><select class="input" name="assigneeId" required>${managers.map((r) => option(r.id,r.name,escalation.assigneeId)).join('')}</select></label>${text('reason','Escalation reason',2000,escalation.reason)}<div><button class="button button-secondary" type="submit">Escalate enquiry</button></div></form></details>` : ''}
      ${row.canReopen ? `<form class="form form-grid" data-enquiry-own-action="reopen">${text('reason','Reopening reason',2000,state.enquiryOwnReopenDraft?.reason)}${consent(state.enquiryOwnReopenDraft?.consent)}<div><button class="button button-secondary" type="submit">Reopen enquiry</button></div></form>` : ''}
      ${row.canWithdraw ? `<details><summary>Withdraw reply consent</summary><form class="form form-grid" data-enquiry-own-action="withdraw">${text('reason','Withdrawal reason',2000,state.enquiryOwnWithdrawDraft?.reason)}<div><button class="button button-secondary" type="submit">Withdraw consent</button></div></form></details>` : ''}
      <details><summary>Enquiry history</summary><ol class="enquiry-history">${row.history.map((h) => `<li>${esc(label(h.action))} - ${esc(label(h.toStatus))} - ${esc(date(h.recordedAt))}${h.reason ? `<p class="communication-body">${esc(h.reason)}</p>` : ''}</li>`).join('')}</ol></details></section>`;
  }
  function ownView(state) {
    const list = state.enquiryOwnList,draft = state.enquiryOwnCreateDraft || {};
    if (!list && !state.enquiryOwnError) return '';
    return `<section class="enquiry-workspace" data-enquiry-own><header class="section-header"><h2>Admissions enquiries</h2><button class="icon-button" type="button" data-enquiry-own-refresh title="Refresh own enquiries" aria-label="Refresh own enquiries" ${state.enquiryOwnBusy ? 'disabled' : ''}>&#8635;</button></header>${state.enquiryOwnError ? `<p class="notice notice-warning" role="alert">${esc(state.enquiryOwnError)}</p>` : ''}<fieldset class="communication-controls" ${state.enquiryOwnBusy ? 'disabled' : ''}>
      ${list ? `<details data-enquiry-create-panel ${state.enquiryOwnCreateOpen ? 'open' : ''}><summary>New enquiry</summary><form class="form form-grid" data-enquiry-create><label class="field communication-wide"><span>Intake</span><select class="input" name="intakeId" required>${option('','Choose intake',draft.intakeId)}${(state.catalogue || []).map((r) => option(r.intakeId,`${r.programmeCode} - ${r.label}`,draft.intakeId)).join('')}</select></label>${draft.guidanceVersionId ? '<p class="small communication-wide">Guidance reference attached <button class="icon-button" type="button" data-enquiry-detach title="Remove guidance reference" aria-label="Remove guidance reference">&times;</button></p>' : ''}${text('subject','Subject',180,draft.subject)}${text('body','Question',4000,draft.body)}${consent(draft.consent)}<div><button class="button button-primary" type="submit">Send enquiry</button></div></form></details>
        <form class="form enquiry-filter" data-enquiry-own-filter><label class="field"><span>Status</span><select class="input" name="status">${option('','All',state.enquiryOwnFilters?.status)}${statuses.map((s) => option(s,label(s),state.enquiryOwnFilters?.status)).join('')}</select></label><button class="button button-secondary" type="submit">Filter</button></form>${queue(list,true)}${detail(state,true)}` : ''}</fieldset></section>`;
  }
  function staffView(state) {
    const list = state.enquiryStaffList,metadata = state.enquiryStaffMetadata,f = state.enquiryStaffFilters || {};
    if (!list && !state.enquiryStaffError) return '';
    return `<details class="enquiry-workspace" data-enquiry-staff ${state.enquiryStaffOpen ? 'open' : ''}><summary>Prospective applicant enquiries</summary><header class="section-header"><h3>Prospective applicant enquiries</h3><button class="icon-button" type="button" data-enquiry-staff-refresh title="Refresh prospective enquiries" aria-label="Refresh prospective enquiries">&#8635;</button></header>${state.enquiryStaffError ? `<p class="notice notice-warning" role="alert">${esc(state.enquiryStaffError)}</p>` : ''}<fieldset class="communication-controls" ${state.busy ? 'disabled' : ''}>
      ${list && metadata ? `<form class="form form-grid" data-enquiry-staff-filter><label class="field"><span>Status</span><select class="input" name="status">${option('','All',f.status)}${statuses.map((s) => option(s,label(s),f.status)).join('')}</select></label><label class="field"><span>Assignment</span><select class="input" name="assignee">${option('','All',f.assignee)}${option('mine','Mine',f.assignee)}${option('unassigned','Unassigned',f.assignee)}</select></label><label class="field"><span>Intake</span><select class="input" name="intakeId">${option('','All',f.intakeId)}${metadata.intakes.map((r) => option(r.intakeId,`${r.programmeCode} - ${r.label}`,f.intakeId)).join('')}</select></label><div class="field"><span>&nbsp;</span><button class="button button-secondary" type="submit">Filter</button></div></form>${queue(list,false)}${detail(state,false)}` : ''}</fieldset></details>`;
  }
  function bind(root,state,{api,act:perform,getToken},self = false) {
    const mode = self ? 'own' : 'staff',prefix = self ? 'enquiryOwn' : 'enquiryStaff',current = getToken || (() => state.session?.token);
    const request = async (...args) => {const token = current();try {return await api(...args);} catch(error) {if (token === current() && [403,404].includes(error.status)) {clear(state,prefix);state[`${prefix}Error`] = error.message;}throw error;}};
    const refresh = () => load(state,request,current,self);
    const act = (work) => {
      if (!self) return perform(work);
      if (state.enquiryOwnBusy) return;
      const nonce = Symbol(),token = current();state.enquiryOwnBusy = nonce;root.querySelector('[data-enquiry-own] fieldset')?.setAttribute('disabled','');root.querySelector('[data-enquiry-own-refresh]')?.setAttribute('disabled','');
      return perform(async () => {try {if (token === current()) await work();} finally {if (state.enquiryOwnBusy === nonce) delete state.enquiryOwnBusy;}});
    };
    root.querySelector('[data-enquiry-staff]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.enquiryStaffOpen = event.currentTarget.open;});
    root.querySelector('[data-enquiry-create-panel]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.enquiryOwnCreateOpen = event.currentTarget.open;});
    root.querySelector(`[data-enquiry-${mode}-refresh]`)?.addEventListener('click',() => act(refresh));
    root.querySelectorAll(`[data-enquiry-${mode}-page]`).forEach((b) => b.addEventListener('click',() => act(async () => {state[`${prefix}Filters`] = {...state[`${prefix}Filters`],offset:b.dataset[`enquiry${self ? 'Own' : 'Staff'}Page`]};await refresh();})));
    const clearActions = () => {for (const suffix of ['CommentDraft','CommentKey','CommentSubmission','UpdateDraft','EscalateDraft','ReopenDraft','WithdrawDraft']) delete state[`${prefix}${suffix}`];};
    root.querySelectorAll(`[data-enquiry-${mode}-open]`).forEach((b) => b.addEventListener('click',() => act(async () => {state[`${prefix}SelectedId`] = b.dataset[`enquiry${self ? 'Own' : 'Staff'}Open`];state[`${prefix}Detail`] = null;clearActions();await refresh();})));
    root.querySelector(`[data-enquiry-${mode}-filter]`)?.addEventListener('submit',(event) => {event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));act(async () => {state[`${prefix}Filters`] = {...filters,offset:'0'};await refresh();});});
    if (self) {
      root.querySelectorAll('[data-enquiry-application]').forEach((b) => b.addEventListener('click',() => act(async () => {state.selectedApplicationId = b.dataset.enquiryApplication;state.selectedProgrammeId = null;})));
      root.querySelectorAll('[data-enquiry-guidance]').forEach((b) => b.addEventListener('click',() => {const token = current();const result = act(async () => {
        const row = state.guidancePublic?.items.find((r) => r.versionId === b.dataset.enquiryGuidance);if (!row) return;
        state.enquiryOwnCreateDraft = {intakeId:row.intakeId || '',guidanceVersionId:row.versionId,subject:`Question about ${row.title}`.slice(0,180),body:'',consent:false};state.enquiryOwnCreateKey = null;state.enquiryOwnCreateSubmission = null;state.enquiryOwnCreateOpen = true;
      });Promise.resolve(result).then(() => {if (token === current()) root.querySelector('[data-enquiry-create-panel]')?.scrollIntoView({block:'start',behavior:'instant'});});}));
      root.querySelector('[data-enquiry-detach]')?.addEventListener('click',() => act(async () => {state.enquiryOwnCreateDraft = {...state.enquiryOwnCreateDraft,guidanceVersionId:null};state.enquiryOwnCreateKey = null;state.enquiryOwnCreateSubmission = null;}));
      const form = root.querySelector('[data-enquiry-create]');
      const capture = () => {const values = Object.fromEntries(new FormData(form));return {...values,consent:values.consent === 'on',guidanceVersionId:state.enquiryOwnCreateDraft?.guidanceVersionId || null};};
      form?.addEventListener('input',() => {state.enquiryOwnCreateDraft = capture();state.enquiryOwnCreateKey = null;state.enquiryOwnCreateSubmission = null;});
      form?.querySelector('[name="intakeId"]')?.addEventListener('change',() => {state.enquiryOwnCreateDraft = {...capture(),guidanceVersionId:null};state.enquiryOwnCreateKey = null;state.enquiryOwnCreateSubmission = null;});
      form?.addEventListener('submit',(event) => {
        event.preventDefault();const token = current(),values = capture();state.enquiryOwnCreateDraft = values;
        const submission = state.enquiryOwnCreateSubmission ||= {...values,requestKey:state.enquiryOwnCreateKey ||= `enquiry_${crypto.randomUUID()}`};
        act(async () => {const result = await request('POST',path(true),submission);if (token !== current()) return;state.enquiryOwnSelectedId = result.id;state.enquiryOwnDetail = result;state.enquiryOwnCreateDraft = null;state.enquiryOwnCreateKey = null;state.enquiryOwnCreateSubmission = null;state.enquiryOwnCreateOpen = false;await refresh();});
      });
    }
    root.querySelectorAll(`[data-enquiry-${mode}-action]`).forEach((form) => {
      const action = form.dataset[`enquiry${self ? 'Own' : 'Staff'}Action`],suffix = `${action[0].toUpperCase()}${action.slice(1)}Draft`;
      const capture = () => {const values = Object.fromEntries(new FormData(form));if (action === 'update') return {...values,assigneeId:values.assigneeId || null,resolveEscalation:values.resolveEscalation === 'on'};if (action === 'reopen') return {...values,consent:values.consent === 'on'};return values;};
      if (action === 'comment' && !self) form.querySelector('[name="visibility"]')?.addEventListener('change',(event) => {form.querySelector('button[type="submit"]').textContent = event.target.value === 'internal' ? 'Add note' : 'Send reply';});
      form.addEventListener('input',() => {state[`${prefix}${suffix}`] = capture();if (action === 'comment') {state[`${prefix}CommentKey`] = null;state[`${prefix}CommentSubmission`] = null;}});
      form.addEventListener('submit',(event) => {
        event.preventDefault();const row = state[`${prefix}Detail`],values = capture(),token = current();state[`${prefix}${suffix}`] = values;
        let submission = {path:`${path(self)}/${row.id}/${action}`,data:{...values,revision:row.revision}};
        if (action === 'comment') {submission.data.visibility ||= 'public';submission.data.requestKey = state[`${prefix}CommentKey`] ||= `reply_${crypto.randomUUID()}`;submission = state[`${prefix}CommentSubmission`] ||= submission;}
        act(async () => {
          let result;
          try {result = await request('POST',submission.path,submission.data);} catch(error) {if (token === current() && error.status === 409 && action === 'comment') {state[`${prefix}CommentKey`] = null;state[`${prefix}CommentSubmission`] = null;}throw error;}
          if (token !== current()) return;state[`${prefix}Detail`] = result;delete state[`${prefix}${suffix}`];if (action === 'comment') {state[`${prefix}CommentKey`] = null;state[`${prefix}CommentSubmission`] = null;}await refresh();
        });
      });
    });
  }
  window.prospectiveEnquiriesUI = {clearOwn,loadOwn:(state,api,getToken) => load(state,api,getToken,true),loadStaff:(state,api) => load(state,api,() => state.session?.token,false),ownView,staffView,ownBind:(root,state,options) => bind(root,state,options,true),staffBind:(root,state,options) => bind(root,state,options,false)};
})();
