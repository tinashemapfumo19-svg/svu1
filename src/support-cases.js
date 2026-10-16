(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const label = (value) => String(value).replaceAll('_',' ');
  const date = (value) => value ? window.svuUI.dateTime(value) : '';
  const categories = ['academic','registration','finance','learning','feedback','other'];
  const priorities = ['low','normal','high','urgent'],statuses = ['open','in_progress','waiting_student','resolved','closed'];
  const done = (row) => ['resolved','closed'].includes(row.status);
  const options = (values,current,all = false) => `${all ? '<option value="">All</option>' : ''}${values.map((value) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label(value))}</option>`).join('')}`;
  const select = (name,title,values,current,all = false) => `<label class="field"><span>${esc(title)}</span><select class="input" name="${name}">${options(values,current,all)}</select></label>`;
  const reason = '<label class="field support-wide"><span data-support-reason-label>Reason</span><textarea class="input" name="reason" maxlength="2000" required></textarea></label>';
  const field = (name,title,max,value = '') => `<label class="field support-wide"><span>${title}</span>${name === 'subject' ? `<input class="input" name="${name}" value="${esc(value)}" maxlength="${max}" required>` : `<textarea class="input" name="${name}" maxlength="${max}" required>${esc(value)}</textarea>`}</label>`;
  function clearStudent(state) {for (const key of Object.keys(state)) if (key.startsWith('supportStudent')) delete state[key];}
  async function loadStudent(state,api,programmeId,getToken,context) {
    const matches = () => !context || context.applicationId === state.selectedApplicationId && context.programmeId === state.selectedProgrammeId;
    if (!matches()) return;
    const token = getToken(),generation = {};state.supportStudentGeneration = generation;state.supportStudentProgrammeId = programmeId;
    try {
      const list = await api('GET',`/api/support/me/cases?offset=${state.supportStudentOffset || 0}`);
      const detail = state.supportStudentDetail ? await api('GET',`/api/support/me/cases/${state.supportStudentDetail.id}`) : null;
      if (token !== getToken() || state.supportStudentGeneration !== generation || !matches()) return;
      state.supportStudentList = list;state.supportStudentDetail = detail;state.supportStudentError = '';
    } catch(error) {
      if (token !== getToken() || state.supportStudentGeneration !== generation || !matches()) return;
      state.supportStudentList = null;state.supportStudentDetail = null;state.supportStudentError = error.message;
    }
  }
  async function loadStaff(state,api,filters = state.supportStaffFilters || {}) {
    const token = state.session?.token,hadAccess = Boolean(state.supportStaffList || state.supportStaffUnavailable);
    try {
      const list = await api('GET',`/api/support/cases?${new URLSearchParams(filters)}`);
      const detail = state.supportStaffDetail ? await api('GET',`/api/support/cases/${state.supportStaffDetail.id}`).catch(() => null) : null;
      if (token !== state.session?.token) return;
      state.supportStaffList = list;state.supportStaffDetail = detail;state.supportStaffFilters = filters;state.supportStaffError = '';state.supportStaffUnavailable = false;
    } catch(error) {
      if (token !== state.session?.token) return;
      state.supportStaffList = null;state.supportStaffDetail = null;state.supportStaffFilters = {};state.supportStaffError = error.message;state.supportStaffUnavailable = hadAccess;
    }
  }
  function detailView(row,self,state) {
    if (!row) return '';
    const managers = row.assignees.filter((entry) => entry.canEscalate),triage = row.canManage && (!row.escalated || row.canSupervise);
    const draft = state[self ? 'supportStudentCommentDraft' : 'supportStaffCommentDraft'] || {};
    return `<section class="support-detail" data-support-detail="${esc(row.id)}">
      <header class="support-heading"><div><h3>${esc(row.subject)}</h3><p>${esc(row.studentNumber)} - ${esc(row.intakeLabel)}</p></div><button class="icon-button" type="button" data-support-detail-refresh title="Refresh case" aria-label="Refresh case">&#8635;</button></header>
      <p><span class="pill pill-neutral">${esc(label(row.status))}</span> ${esc(label(row.category))} / ${esc(row.priority)}${row.escalated ? ' <span class="pill pill-warning">Escalated</span>' : ''}</p>
      <p class="muted">Opened ${esc(date(row.createdAt))} - Updated ${esc(date(row.updatedAt))}</p>
      ${!self ? `<p>Assignee: ${esc(row.assignees.find((entry) => entry.id === row.assigneeId)?.name || (row.assigneeId ? 'No longer available' : 'Unassigned'))} - Escalations: ${row.escalationLevel}</p>` : ''}
      <ol class="support-thread">${row.comments.map((comment) => `<li data-support-comment><header><strong>${comment.authorKind === 'student' ? 'Student' : 'Support team'}${comment.visibility === 'internal' ? ' - Staff only' : ''}</strong><time>${esc(date(comment.createdAt))}</time></header><p>${esc(comment.body)}</p></li>`).join('')}</ol>
      ${!done(row) && (self || row.canManage) ? `<form class="form support-form" data-support-action="comment" data-form="support-comment">${field('body',self ? 'Reply' : 'Message',4000,draft.body)}${!self ? select('visibility','Visibility',['public','internal'],draft.visibility || 'public') : ''}<button class="button button-primary" type="submit">Send reply</button></form>` : ''}
      ${!self && triage && !done(row) ? `<details><summary>Assignment and status</summary><form class="form support-form" data-support-action="update" data-form="support-update">
        ${select('category','Category',categories,row.category)}${select('priority','Priority',priorities,row.priority)}${select('status','Status',statuses.filter((status) => status !== 'closed'),row.status)}
        <label class="field"><span>Assignee</span><select class="input" name="assigneeId"><option value="">Unassigned</option>${row.assignees.filter((entry) => !row.escalated || entry.canEscalate).map((entry) => `<option value="${esc(entry.id)}" ${entry.id === row.assigneeId ? 'selected' : ''}>${esc(entry.name)}</option>`).join('')}</select></label>
        ${reason.replace('>Reason<','>Triage reason<')}<button class="button button-primary" type="submit">Update case</button></form></details>` : ''}
      ${!self && row.canManage && !done(row) && managers.length ? `<details><summary>Escalation</summary><form class="form support-form" data-support-action="escalate" data-form="support-escalate"><label class="field"><span>Escalation manager</span><select class="input" name="assigneeId">${managers.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join('')}</select></label>${reason}<button class="button button-secondary" type="submit">Escalate case</button></form></details>` : ''}
      ${done(row) && (self || row.canManage) ? `<form class="form support-form" data-support-action="reopen" data-form="support-reopen">${reason}<button class="button button-secondary" type="submit">Reopen case</button></form>` : ''}
      ${row.status === 'resolved' && (self || row.canManage) ? `<form class="form support-form" data-support-action="close" data-form="support-close">${reason}<button class="button button-secondary" type="submit">Close case</button></form>` : ''}
      <details><summary>Case history</summary><ol class="support-history">${row.history.map((event) => `<li><strong>${esc(label(event.action))}</strong> - ${esc(label(event.toStatus))} - ${esc(date(event.recordedAt))}${event.reason ? `<p>${esc(event.reason)}</p>` : ''}</li>`).join('')}</ol></details>
    </section>`;
  }
  function queueView(list,self) {
    return `<div class="result-table-wrap support-queue-wrap"><table class="support-queue"><thead><tr><th>Case</th><th>${self ? 'Programme / intake' : 'Student / intake'}</th><th>Status</th><th>Category</th><th>Priority</th><th>Updated</th></tr></thead><tbody>${list.items.map((row) => `<tr><td><button class="support-case-link" type="button" data-support-open="${esc(row.id)}">${esc(row.subject)}</button></td><td>${esc(self ? row.programmeCode : row.studentNumber)}<br>${esc(row.intakeLabel)}</td><td>${esc(label(row.status))}${row.escalated ? ' - Escalated' : ''}</td><td>${esc(label(row.category))}</td><td>${esc(row.priority)}</td><td>${esc(date(row.updatedAt))}</td></tr>`).join('') || '<tr><td colspan="6">No cases</td></tr>'}</tbody></table></div>`;
  }
  function staffView(state) {
    const list = state.supportStaffList;
    if (!list) return state.supportStaffUnavailable ? `<section class="support-workspace"><header class="support-heading"><h2>Student support</h2><button class="icon-button" type="button" data-support-refresh aria-label="Refresh support queue" title="Refresh support queue">&#8635;</button></header><p role="alert">${esc(state.supportStaffError)}</p></section>` : '';
    const f = state.supportStaffFilters || {};
    return `<details class="support-workspace" data-support-workspace ${state.supportStaffOpen ? 'open' : ''}><summary>Student support</summary><header class="support-heading"><h2>Student support</h2><button class="icon-button" type="button" data-support-refresh aria-label="Refresh support queue" title="Refresh support queue">&#8635;</button></header>
      <form class="form support-form" data-support-filter>${select('status','Status',statuses,f.status,true)}${select('category','Category',categories,f.category,true)}${select('priority','Priority',priorities,f.priority,true)}${select('assignee','Assignment',['mine','unassigned'],f.assignee,true)}
        <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">All</option>${list.availableIntakes.map((row) => `<option value="${esc(row.intakeId)}" ${f.intakeId === row.intakeId ? 'selected' : ''}>${esc(row.programmeCode)} - ${esc(row.label)}</option>`).join('')}</select></label><button class="button button-secondary" type="submit">Filter cases</button></form>
      ${state.supportStaffError ? `<p role="alert">${esc(state.supportStaffError)}</p>` : ''}<p>${list.total} cases</p>${queueView(list,false)}
      <div class="support-pagination"><button class="icon-button" type="button" data-support-page="-1" aria-label="Previous support cases" title="Previous support cases" ${!list.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(list.offset/list.limit)+1}</span><button class="icon-button" type="button" data-support-page="1" aria-label="Next support cases" title="Next support cases" ${list.offset+list.limit >= list.total ? 'disabled' : ''}>&rarr;</button></div>
      ${detailView(state.supportStaffDetail,false,state)}</details>`;
  }
  function studentView(state) {
    const list = state.supportStudentList,draft = state.supportStudentDraft || {};
    return `<section class="support-workspace" data-support-student><fieldset class="review-controls" ${state.supportStudentBusy ? 'disabled' : ''}><header class="support-heading"><h2>Student support</h2><button class="icon-button" type="button" data-support-refresh aria-label="Refresh support cases" title="Refresh support cases">&#8635;</button></header>${state.supportStudentError ? `<p role="alert">${esc(state.supportStudentError)}</p>` : ''}
      ${list ? `<details data-support-create-panel ${state.supportStudentCreateOpen ? 'open' : ''}><summary>New case</summary><form class="form support-form" data-support-create data-form="support-create">${field('subject','Subject',160,draft.subject)}${select('category','Category',categories,draft.category || 'feedback')}${field('body','Message',4000,draft.body)}<button class="button button-primary" type="submit">Open case</button></form></details>${queueView(list,true)}
        <div class="support-pagination"><button class="icon-button" type="button" data-support-student-page="-1" aria-label="Previous support cases" title="Previous support cases" ${!list.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(list.offset/list.limit)+1}</span><button class="icon-button" type="button" data-support-student-page="1" aria-label="Next support cases" title="Next support cases" ${list.offset+list.limit >= list.total ? 'disabled' : ''}>&rarr;</button></div>${detailView(state.supportStudentDetail,true,state)}` : ''}</fieldset></section>`;
  }
  function bind(root,state,{api,act:perform,getToken},self = false) {
    const prefix = self ? 'supportStudent' : 'supportStaff',base = `/api/support/${self ? 'me/' : ''}cases`;
    const current = () => self ? getToken() : state.session?.token;
    const act = (work) => {
      if (!self) return perform(work);
      if (state.supportStudentBusy) return;
      const busy = {};state.supportStudentBusy = busy;root.querySelector('[data-support-student] > fieldset')?.setAttribute('disabled','');
      return perform(async () => {try {await work();} finally {if (state.supportStudentBusy === busy) delete state.supportStudentBusy;}});
    };
    const refresh = async () => self ? loadStudent(state,api,state.supportStudentProgrammeId,getToken) : loadStaff(state,api);
    root.querySelector('[data-support-workspace]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.supportStaffOpen = event.currentTarget.open;});
    root.querySelector('[data-support-create-panel]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.supportStudentCreateOpen = event.currentTarget.open;});
    root.querySelector('[data-support-refresh]')?.addEventListener('click',() => act(refresh));
    root.querySelector('[data-support-filter]')?.addEventListener('submit',(event) => {event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));act(() => loadStaff(state,api,filters));});
    root.querySelectorAll('[data-support-page]').forEach((button) => button.addEventListener('click',() => act(() => loadStaff(state,api,{...state.supportStaffFilters,offset:String(Math.max(0,state.supportStaffList.offset+Number(button.dataset.supportPage)*state.supportStaffList.limit))}))));
    root.querySelectorAll('[data-support-open]').forEach((button) => button.addEventListener('click',() => act(async () => {
      const token = current(),programme = state.supportStudentProgrammeId;state[`${prefix}Detail`] = null;state[`${prefix}CommentDraft`] = null;
      const detail = await api('GET',`${base}/${button.dataset.supportOpen}`);
      if (token !== current() || self && programme !== state.supportStudentProgrammeId) return;state[`${prefix}Detail`] = detail;state[`${prefix}CommentKey`] = null;
    })));
    root.querySelector('[data-support-detail-refresh]')?.addEventListener('click',() => act(refresh));
    root.querySelectorAll('[data-support-student-page]').forEach((button) => button.addEventListener('click',() => act(async () => {
      const list = state.supportStudentList;state.supportStudentOffset = Math.max(0,list.offset+Number(button.dataset.supportStudentPage)*list.limit);await refresh();
    })));
    root.querySelector('[data-support-create]')?.addEventListener('submit',(event) => {
      event.preventDefault();if (state.supportStudentBusy) return;const input = Object.fromEntries(new FormData(event.currentTarget));state.supportStudentDraft = {...input};state.supportStudentCreateOpen = true;state.supportStudentRequestKey ||= crypto.randomUUID();
      const token = current(),programme = state.supportStudentProgrammeId;Object.assign(input,{programmeId:programme,requestKey:state.supportStudentRequestKey});
      act(async () => {const detail = await api('POST',base,input);if (token !== current() || programme !== state.supportStudentProgrammeId) return;state.supportStudentDetail = detail;state.supportStudentRequestKey = null;state.supportStudentDraft = null;state.supportStudentCreateOpen = false;state.supportStudentOffset = 0;await refresh();});
    });
    root.querySelectorAll('[data-support-action]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault();if (self && state.supportStudentBusy) return;const action = form.dataset.supportAction,input = Object.fromEntries(new FormData(form)),row = state[`${prefix}Detail`],token = current(),programme = state.supportStudentProgrammeId;input.revision = row.revision;
      if (action === 'comment') {state[`${prefix}CommentDraft`] = {...input};state[`${prefix}CommentKey`] ||= crypto.randomUUID();input.requestKey = state[`${prefix}CommentKey`];if (self) input.visibility = 'public';}
      if (action === 'update') input.assigneeId ||= null;
      act(async () => {const detail = await api('POST',`${base}/${row.id}/${action}`,input);if (token !== current() || self && programme !== state.supportStudentProgrammeId) return;state[`${prefix}Detail`] = detail;state[`${prefix}CommentKey`] = null;state[`${prefix}CommentDraft`] = null;await refresh();});
    }));
    root.querySelector('[data-support-action="update"] [name="status"]')?.addEventListener('change',(event) => {
      event.currentTarget.closest('form').querySelector('[data-support-reason-label]').textContent = event.currentTarget.value === 'resolved' ? 'Resolution message' : 'Triage reason';
    });
  }
  window.supportCasesUI = {clearStudent,loadStudent,loadStaff,staffView,studentView,staffBind:(root,state,helpers) => bind(root,state,helpers),studentBind:(root,state,helpers) => bind(root,state,helpers,true)};
})();
