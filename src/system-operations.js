(function () {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const id = value => encodeURIComponent(value);
  const field = (name, label, value = '', type = 'text', extra = '') => `<label class="field"><span>${esc(label)}</span><input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const options = (rows, selected, key = 'id', label = 'name') => rows.map(row => `<option value="${esc(row[key])}" ${row[key] === selected ? 'selected' : ''}>${esc(row[label] || row[key])}</option>`).join('');
  const reason = () => field('reason', 'Reason', '', 'text', 'required maxlength="2000"');
  const tabs = [
    ['workflows', 'Workflows', 'workflow.transition'], ['tasks', 'Tasks', 'task.assign'],
    ['reference', 'Reference lists', 'master_data.publish'], ['notifications', 'Notifications', 'notification.send'],
    ['evidence', 'Verification records', 'foundation.view']
  ];
  const secretTemplates = new Set(['password_recovery', 'registration_activation', 'staff.invitation']);
  async function load(state, call) {
    if (state.tab === 'evidence') {
      state.developmentEvidence = await call('GET', '/docs/phase-1/EXIT_GATE_EVIDENCE.generated.json');
      state.recoveryEvidence = await call('GET', '/docs/phase-1/BACKUP_RESTORE_EVIDENCE.generated.json');
    }
    if (state.tab === 'workflows') {
      state.workflowDefinitions = await call('GET', '/api/workflows/definitions');
      state.workflowRows = await call('GET', '/api/workflows/instances');
      state.programmes = await call('GET', '/api/master-data/programmes');
      state.intakes = await call('GET', '/api/master-data/intakes');
    }
    if (state.tab === 'tasks') state.taskRows = await call('GET', '/api/tasks');
    if (state.tab === 'reference') {
      state.referenceLists = await call('GET', '/api/master-data/reference-lists');
      state.referenceCode ||= state.referenceLists[0]?.code;
      if (state.referenceCode) state.referenceDetail = await call('GET', `/api/master-data/reference-lists/${id(state.referenceCode)}?includeRetired=true`);
    }
    if (state.tab === 'notifications') {
      state.notificationTemplates = (await call('GET', '/api/notifications/templates')).filter(row => row.status === 'active' && !secretTemplates.has(row.code));
      state.notificationRows = await call('GET', `/api/notifications?${new URLSearchParams(state.notificationFilters || {})}`);
    }
  }
  function paged(state, rows, renderRow) {
    const page = state.operationsPage || 0, start = page * 20;
    return `<div class="system-operation-list">${rows.slice(start, start + 20).map(renderRow).join('') || '<p>No matching records.</p>'}</div>
      <div class="hero-actions"><button class="icon-button" title="Previous page" aria-label="Previous page" type="button" data-operations-page="-1" ${!page ? 'disabled' : ''}>&larr;</button><span>Page ${page + 1} / ${Math.max(1, Math.ceil(rows.length / 20))}</span><button class="icon-button" title="Next page" aria-label="Next page" type="button" data-operations-page="1" ${start + 20 >= rows.length ? 'disabled' : ''}>&rarr;</button></div>`;
  }
  function workflows(state) {
    if (!state.workflowRows) return '<p>Loading workflows...</p>';
    const detail = state.workflowDetail;
    return `<details><summary>Start workflow</summary><form class="form form-grid" data-operation="workflow-create">
      <label class="field"><span>Definition</span><select class="input" name="definitionCode" required>${options((state.workflowDefinitions || []).filter(row => row.active), '', 'code', 'code')}</select></label>
      ${field('subjectType', 'Record type', '', 'text', 'required maxlength="80"')}${field('subjectId', 'Record ID', '', 'text', 'required maxlength="200"')}
      <label class="field"><span>Programme</span><select class="input" name="programmeCode"><option value="">Existing record scope</option>${options(state.programmes || [], '', 'code')}</select></label>
      <label class="field"><span>Intake</span><select class="input" name="intakeId"><option value="">None</option>${options(state.intakes || [], '', 'id', 'label')}</select></label>
      ${reason()}<div><button class="button button-primary" type="submit">Start workflow</button></div></form></details>
      <div class="registry-grid"><div>${paged(state, state.workflowRows, row => `<button class="review-row ${row.id === detail?.id ? 'is-selected' : ''}" ${row.id === detail?.id ? 'aria-current="true"' : ''} type="button" data-operation-workflow="${esc(row.id)}"><strong>${esc(row.definitionCode)} - ${esc(row.subjectId)}</strong><span>${esc(row.subjectType)} / ${esc(row.state)} / ${esc(row.status)}</span></button>`)}</div>
      <div>${detail ? `<h2>${esc(detail.subjectId)}</h2><p>${esc(detail.definitionCode)} v${esc(detail.definitionVersion)} / ${esc(detail.state)}</p>
        ${detail.allowedTransitions.length ? `<form class="form" data-operation="workflow-transition"><label class="field"><span>Next state</span><select class="input" name="toState">${detail.allowedTransitions.map(value => `<option>${esc(value)}</option>`).join('')}</select></label>${reason()}<button class="button button-primary" type="submit">Transition</button></form>` : '<p>No available transitions.</p>'}
        <h3>History</h3><ol>${detail.history.map(row => `<li>${esc(row.occurredAt)}: ${esc(row.fromState || 'Started')} to ${esc(row.toState)}. ${esc(row.reason)}</li>`).join('')}</ol>` : '<p>Select a workflow.</p>'}</div></div>`;
  }
  function tasks(state) {
    if (!state.taskRows) return '<p>Loading tasks...</p>';
    return `<form class="form form-grid" data-operation="task-filter">${field('q', 'Search tasks', state.taskSearch || '')}<label class="field"><span>Status</span><select class="input" name="status">${['', 'open', 'assigned', 'completed'].map(value => `<option value="${value}" ${state.taskStatus === value ? 'selected' : ''}>${value || 'All statuses'}</option>`).join('')}</select></label><div><button class="button button-primary" type="submit">Search</button></div></form>
      ${paged(state, state.taskRows.filter(row => (!state.taskStatus || row.status === state.taskStatus) && `${row.title} ${row.queue}`.toLowerCase().includes((state.taskSearch || '').toLowerCase())), row => `<article class="system-operation-row"><h2>${esc(row.title)}</h2><p>${esc(row.queue)} / ${esc(row.status)} / Priority ${esc(row.priority)}</p><p class="meta">${row.dueAt ? `Due ${esc(row.dueAt)}` : 'No due date'}${row.assigneeAccountId ? ` / ${esc(row.assigneeAccountId)}` : ''}</p>
        ${row.status !== 'completed' ? `<details><summary>Update task</summary><form class="form form-grid" data-operation="task-update" data-record-id="${esc(row.id)}"><label class="field"><span>Action</span><select class="input" name="action"><option value="assign">Assign</option><option value="handoff">Hand off</option><option value="complete">Complete</option></select></label>${field('assigneeAccountId', 'Assignee account ID', row.assigneeAccountId || '')}${field('queue', 'Queue', row.queue)}${reason()}<label><input name="assignToMe" type="checkbox"> Assign to me</label><div><button class="button button-primary" type="submit">Update task</button></div></form></details>` : ''}</article>`)}`;
  }
  function reference(state) {
    const detail = state.referenceDetail;
    return `<form class="form inline-form" data-operation="reference-select"><label class="field"><span>List</span><select class="input" name="code">${options(state.referenceLists || [], state.referenceCode, 'code')}</select></label><button class="button button-primary" type="submit">Open list</button></form>
      ${detail ? `<p>${esc(detail.owner)} / ${esc(detail.status)} / ${esc(detail.sensitivity)}</p>${detail.lawfulPurpose ? `<p>${esc(detail.lawfulPurpose)}</p>` : ''}
        ${detail.status === 'active' ? `<details><summary>Add value</summary><form class="form form-grid" data-operation="reference-create">${field('valueCode', 'Code', '', 'text', 'required pattern="[A-Z0-9_]{1,40}" maxlength="40"')}${field('label', 'Label', '', 'text', 'required')}${field('sortOrder', 'Sort order', '1000', 'number', 'required step="1"')}${field('effectiveFrom', 'Effective from', '', 'date', 'required')}${detail.code === 'currency' ? field('minorUnits', 'Minor units', '2', 'number', 'required min="0" max="4" step="1"') : ''}${reason()}<div><button class="button button-primary" type="submit">Add value</button></div></form></details>` : ''}
        ${paged(state, detail.values, row => `<article class="system-operation-row"><h2>${esc(row.valueCode)} - ${esc(row.label)}</h2><p>${esc(row.status)} / ${esc(row.effectiveFrom || 'Any start')}${row.effectiveTo ? ` to ${esc(row.effectiveTo)}` : ''}</p>
          <details><summary>Edit value</summary><form class="form form-grid" data-operation="reference-edit" data-record-id="${esc(row.id)}">${field('label', 'Label', row.label, 'text', 'required')}${field('sortOrder', 'Sort order', row.sortOrder, 'number', 'required step="1"')}${detail.code === 'currency' ? field('minorUnits', 'Minor units', row.metadata?.minorUnits ?? 2, 'number', 'required min="0" max="4" step="1"') : ''}${reason()}<div><button class="button button-primary" type="submit">Save value</button></div></form></details>
          ${row.status === 'active' || detail.status === 'active' ? `<form class="form inline-form" data-operation="reference-status" data-record-id="${esc(row.id)}" data-action="${row.status === 'active' ? 'retire' : 'restore'}">${row.status === 'active' ? field('effectiveTo', 'Retire on', '', 'date', 'required') : ''}${reason()}<button class="button button-secondary" type="submit">${row.status === 'active' ? 'Retire' : 'Restore'}</button></form>` : ''}</article>`)} ` : '<p>Select a reference list.</p>'}`;
  }
  function notifications(state) {
    const draft = state.notificationDraft || {};
    const variables = state.notificationVariables || [];
    return `<form class="form form-grid" data-operation="notification-template"><label class="field"><span>Template</span><select class="input" name="templateId" required>${options(state.notificationTemplates || [], draft.templateId, 'id', 'subject')}</select></label><div><button class="button button-primary" type="submit">Compose</button></div></form>
      ${state.notificationPreview ? `<form class="form form-grid" data-operation="notification-compose">${field('recipientAccountId', 'Recipient account ID', draft.recipientAccountId, 'text', 'required')}${variables.map(key => field(`variable:${key}`, key, draft.variables?.[key], 'text', 'required')).join('')}<div class="hero-actions"><button class="button button-secondary" type="submit" name="action" value="preview">Preview</button><button class="button button-primary" type="submit" name="action" value="send">Queue message</button></div></form><section class="system-message-preview" data-notification-preview><h2>${esc(state.notificationPreview.subject)}</h2><p>${esc(state.notificationPreview.body)}</p></section>` : ''}
      <h2>Delivery queue</h2><form class="form form-grid" data-operation="notification-filter">${field('recipientAccountId', 'Recipient account ID', state.notificationFilters?.recipientAccountId)}<label class="field"><span>Status</span><select class="input" name="status">${['', 'queued', 'sent', 'failed'].map(value => `<option value="${value}" ${state.notificationFilters?.status === value ? 'selected' : ''}>${value || 'All statuses'}</option>`).join('')}</select></label><div><button class="button button-primary" type="submit">Search</button></div></form>
      ${paged(state, state.notificationRows || [], row => `<article class="system-operation-row"><h3>${esc(row.payload?.subject || 'Notification')}</h3><p>${esc(row.status)} / ${esc(row.channel)} / ${esc(row.createdAt)}</p><p class="meta">${esc(row.recipientAccountId || 'No account recipient')}</p></article>`)}`;
  }
  function evidence(state) {
    const table = (title, receipt, rows) => `<section><h2>${title}</h2><p class="meta">${esc(receipt?.startedAt || 'Not loaded')}</p><div class="result-table-wrap"><table class="result-table"><thead><tr><th>Check</th><th>Status</th></tr></thead><tbody>${(rows || []).map(row => `<tr><td>${esc(row.summary || row.id)}</td><td>${esc(row.status)}</td></tr>`).join('') || '<tr><td colspan="2">No recorded checks.</td></tr>'}</tbody></table></div></section>`;
    return `<p>Development verification records. Institutional and production approvals remain separate.</p>${table('Development checks', state.developmentEvidence, state.developmentEvidence?.gates)}${table('Database recovery', state.recoveryEvidence, state.recoveryEvidence?.checks)}`;
  }
  const views = { workflows, tasks, reference, notifications, evidence };
  function bind(app, state, call, run, paint) {
    if (state.operationsDraft) {
      const draft = state.operationsDraft;
      const form = Array.from(app.querySelectorAll('[data-operation]')).find(form => form.dataset.operation === draft.operation && form.dataset.recordId === draft.recordId);
      if (form) for (const control of form.elements) {
        if (!control.name) continue;
        if (control.type === 'checkbox') control.checked = Boolean(draft.input[control.name]);
        else if (Object.hasOwn(draft.input, control.name)) control.value = draft.input[control.name];
      }
    }
    app.querySelectorAll('[data-operations-page]').forEach(button => button.addEventListener('click', () => { state.operationsPage = Math.max(0, (state.operationsPage || 0) + Number(button.dataset.operationsPage)); paint(); }));
    app.querySelectorAll('[data-operation-workflow]').forEach(button => button.addEventListener('click', () => run(async () => { state.workflowDetail = await call('GET', `/api/workflows/instances/${id(button.dataset.operationWorkflow)}`); })));
    app.querySelectorAll('[data-operation]').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      const input = Object.fromEntries(new FormData(form));
      const operation = form.dataset.operation, recordId = form.dataset.recordId, action = event.submitter?.value || form.dataset.action;
      state.operationsDraft = { operation, recordId, input };
      run(async () => {
        if (operation === 'workflow-create') {
          const created = await call('POST', '/api/workflows/instances', { definitionCode: input.definitionCode, subjectType: input.subjectType, subjectId: input.subjectId, reason: input.reason, ...(input.programmeCode ? { scope: { programmeCode: input.programmeCode, intakeId: input.intakeId || null } } : {}) });
          await load(state, call); state.workflowDetail = await call('GET', `/api/workflows/instances/${id(created.id)}`); return 'Workflow started.';
        }
        if (operation === 'workflow-transition') {
          await call('POST', `/api/workflows/instances/${id(state.workflowDetail.id)}/transitions`, { ...input, expectedState: state.workflowDetail.state });
          state.workflowDetail = await call('GET', `/api/workflows/instances/${id(state.workflowDetail.id)}`); await load(state, call); return 'Workflow transitioned.';
        }
        if (operation === 'task-filter') { state.taskSearch = input.q; state.taskStatus = input.status; state.operationsPage = 0; }
        if (operation === 'task-update') {
          const assigneeAccountId = input.assignToMe ? window.svuSession.cached()?.account?.id : input.assigneeAccountId;
          await call('POST', `/api/tasks/${id(recordId)}/${id(input.action)}`, { reason: input.reason, ...(input.action !== 'complete' && assigneeAccountId ? { assigneeAccountId } : {}), ...(input.action === 'handoff' ? { queue: input.queue } : {}) });
          await load(state, call); return 'Task updated.';
        }
        if (operation === 'reference-select') { state.referenceCode = input.code; state.operationsPage = 0; await load(state, call); }
        if (operation.startsWith('reference-') && operation !== 'reference-select') {
          const metadata = state.referenceDetail.code === 'currency' ? { ...(state.referenceDetail.values.find(row => row.id === recordId)?.metadata || {}), minorUnits: Number(input.minorUnits) } : undefined;
          if (operation === 'reference-create') await call('POST', `/api/master-data/reference-lists/${id(state.referenceCode)}/values`, { valueCode: input.valueCode, label: input.label, sortOrder: Number(input.sortOrder), effectiveFrom: input.effectiveFrom, reason: input.reason, ...(metadata ? { metadata } : {}) });
          if (operation === 'reference-edit') await call('PATCH', `/api/master-data/reference-values/${id(recordId)}`, { label: input.label, sortOrder: Number(input.sortOrder), reason: input.reason, ...(metadata ? { metadata } : {}) });
          if (operation === 'reference-status') await call('POST', `/api/master-data/reference-values/${id(recordId)}/${id(action)}`, { reason: input.reason, ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}) });
          await load(state, call); return 'Reference value saved.';
        }
        if (operation === 'notification-template') {
          const template = state.notificationTemplates.find(row => row.id === input.templateId);
          if (!template) throw new Error('Select an active template.');
          state.notificationDraft = { templateId: template.id, templateCode: template.code, channel: template.channel, variables: {} };
          state.notificationPreview = await call('POST', '/api/notifications/preview', { templateCode: template.code, channel: template.channel, variables: {} });
          state.notificationVariables = [...new Set([...`${state.notificationPreview.subject} ${state.notificationPreview.body}`.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(match => match[1]))];
        }
        if (operation === 'notification-compose') {
          const variables = Object.fromEntries(state.notificationVariables.map(key => [key, input[`variable:${key}`]]));
          const draft = { ...state.notificationDraft, recipientAccountId: input.recipientAccountId, variables };
          state.notificationDraft = draft;
          const payload = { recipientAccountId: draft.recipientAccountId, templateCode: draft.templateCode, channel: draft.channel, variables };
          state.notificationPreview = await call('POST', '/api/notifications/preview', payload);
          if (action === 'send') { await call('POST', '/api/notifications/send', payload); await load(state, call); return 'Message queued.'; }
        }
        if (operation === 'notification-filter') { state.notificationFilters = Object.fromEntries(Object.entries(input).filter(([, value]) => value)); state.operationsPage = 0; await load(state, call); }
      });
    }));
  }
  window.systemOperationsUI = { tabs, load, render: state => views[state.tab]?.(state) || '', bind };
})();
