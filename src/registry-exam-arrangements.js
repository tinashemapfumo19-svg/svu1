(function () {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g,(char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const when = (value) => window.svuUI.dateTime(value);
  const fields = `<label class="field"><span>Extra minutes requested</span><input class="input" type="number" name="extraMinutes" min="0" max="240" step="15" value="0" required></label>
    <label class="field"><span><input type="checkbox" name="separateRoom"> Separate room requested</span></label><label class="field"><span>Private request note</span><textarea class="input" name="requestNote" maxlength="2000" required></textarea></label>
    <label class="field"><span>Private evidence reference</span><input class="input" name="evidenceRef" maxlength="200" required></label>`;
  function panel(data,self = false) {
    if (!data) return '';
    return `<section class="assessment-panel" data-arrangement-panel="${esc(data.sitting.id)}"><header class="section-header"><h2>${esc(data.sitting.paper)} arrangements</h2><button class="button button-secondary" type="button" data-arrangements-close>Close</button></header>
      <p>${esc(data.sitting.code)} - ${esc(when(data.sitting.startsAt))} - ${data.sitting.durationMinutes} minutes - ${esc(data.sitting.status)}</p>
      ${data.cases.map((row) => `<details data-arrangement-case="${esc(row.id)}" open><summary>${self ? '' : `${esc(row.studentNumber)} - `}${esc(row.status)}${!row.current ? ' - sitting changed' : ''}</summary>
        <p>Requested ${row.extraMinutes} extra minutes${row.separateRoom ? ', separate room' : ''}</p><p>${esc(row.requestNote)}</p><p>Evidence: ${esc(row.evidenceRef)}</p>${row.reviewNote ? `<p>${esc(row.reviewNote)}</p>` : ''}${row.instruction ? `<p>${esc(row.instruction)}${row.venue ? ` - ${esc(row.venue)}` : ''}</p>` : ''}${row.closeNote ? `<p>${esc(row.closeNote)}</p>` : ''}
        ${!self && data.capabilities.review && row.status === 'requested' && row.requestedBy !== data.accountId ? `<form class="form form-grid" data-arrangement-review="${esc(row.id)}" data-revision="${row.revision}">
          <label class="field"><span>Decision</span><select class="input" name="outcome">${data.capabilities.approve && row.current ? '<option value="approved">Approve</option>' : ''}<option value="returned">Return for changes</option></select></label>
          <label class="field"><span>Private review note</span><textarea class="input" name="reviewNote" maxlength="2000" required></textarea></label>${data.capabilities.approve && row.current ? '<label class="field"><span>Operational instruction</span><textarea class="input" name="instruction" maxlength="500"></textarea></label>' : ''}
          ${row.separateRoom && data.capabilities.approve && row.current ? `<label class="field"><span>Separate venue</span><select class="input" name="venueId"><option value="">Select venue</option>${data.venues.map((venue) => `<option value="${esc(venue.id)}">${esc(venue.code)} ${esc(venue.name)} - ${venue.capacity} seats</option>`).join('')}</select></label>
            <label class="field"><span>Dedicated invigilator</span><select class="input" name="invigilatorStaffId"><option value="">Select invigilator</option>${data.staff.map((staff) => `<option value="${esc(staff.id)}">${esc(staff.employeeNumber)} ${esc(staff.legalName)}</option>`).join('')}</select></label>` : ''}
          <div><button class="button button-primary" type="submit">Review arrangement</button></div></form>` : ''}
        ${data.capabilities.manage && (row.status === 'requested' || data.capabilities.revoke && row.status === 'approved') ? `<form class="form form-grid" data-arrangement-close="${esc(row.id)}" data-revision="${row.revision}"><label class="field"><span>Private ${row.status === 'approved' ? 'revocation' : 'withdrawal'} note</span><input class="input" name="closeNote" maxlength="2000" required></label><div><button class="button button-secondary" type="submit">${row.status === 'approved' ? 'Revoke approval' : 'Withdraw request'}</button></div></form>` : ''}</details>`).join('')}
      ${data.capabilities.request && (!self || !data.cases.some((row) => ['requested','approved'].includes(row.status))) ? `<form class="form form-grid" data-arrangement-request>${self ? '' : `<label class="field"><span>Confirmed candidate</span><select class="input" name="registrationId">${data.candidates.map((row) => `<option value="${esc(row.registrationId)}">${esc(row.studentNumber)}</option>`).join('')}</select></label>`}${fields}<div><button class="button button-primary" type="submit">Request arrangement</button></div></form>` : ''}
      ${!self && data.history.length ? `<details><summary>Private case history (${data.history.length})</summary><ul>${data.history.map((row) => `<li>${esc(when(row.recordedAt))} - ${esc(row.snapshot.studentNumber)} - ${esc(row.snapshot.status)} - revision ${row.revision}</li>`).join('')}</ul></details>` : ''}</section>`;
  }
  function historyView(data,open,self = false) {
    if (!data) return '';
    return `<details data-arrangement-history-workspace ${open ? 'open' : ''}><summary>Arrangement cases (${data.total})</summary>
      <form class="form form-grid" data-arrangement-history-filter><label class="field"><span>${self ? 'Course or paper' : 'Course, paper or student number'}</span><input class="input" name="q" maxlength="100" value="${esc(data.q)}"></label>
      <label class="field"><span>Case status</span><select class="input" name="status">${['all','requested','approved','returned','withdrawn','revoked'].map((status) => `<option value="${status}" ${data.status === status ? 'selected' : ''}>${status === 'all' ? 'All statuses' : status}</option>`).join('')}</select></label><div><button class="button button-secondary" type="submit">Search</button></div></form>
      ${data.items.map((row) => `<p><button class="button button-secondary" type="button" data-arrangement-history-open="${esc(row.id)}" data-sitting="${esc(row.sittingId)}"><span>${self ? '' : `${esc(row.studentNumber)} - `}${esc(row.code)} - ${esc(row.paper)} - ${esc(row.status)}</span><span class="arrangement-queue-meta">${esc(row.intakeLabel)} - ${esc(when(row.startsAt))} - ${esc(row.sittingStatus)}</span></button></p>`).join('') || '<p>No arrangement cases.</p>'}
      <div class="hero-actions"><button class="icon-button" type="button" data-arrangement-history-page="-1" title="Previous page" aria-label="Previous case page" ${!data.offset ? 'disabled' : ''}>&larr;</button><span>Page ${Math.floor(data.offset/data.limit)+1}</span>
      <button class="icon-button" type="button" data-arrangement-history-page="1" title="Next page" aria-label="Next case page" ${data.offset+data.limit >= data.total ? 'disabled' : ''}>&rarr;</button></div></details>`;
  }
  function render(state) {
    return `${state.arrangementSittings ? `<details data-arrangements-workspace ${state.arrangementsOpen ? 'open' : ''}><summary>Candidate arrangements (${state.arrangementSittings.length} sittings)</summary>${state.arrangementSittings.map((row) => `<p><button class="button button-secondary" type="button" data-arrangements-open="${esc(row.id)}"><span>${esc(row.code)} - ${esc(row.paper)}</span><span class="arrangement-queue-meta">${esc(row.intakeLabel)} - ${esc(when(row.startsAt))}</span></button></p>`).join('')}</details>` : ''}${historyView(state.arrangementHistory,state.arrangementHistoryOpen)}${panel(state.examArrangements)}`;
  }
  async function load(state,api) {
    state.arrangementSittings = await api('GET','/api/exams/arrangements/sittings').catch(() => null);
    state.arrangementHistory = await api('GET',`/api/exams/arrangements/history?${new URLSearchParams(state.arrangementHistoryFilters || {})}`).catch(() => null);
  }
  function clearStudent(state) {
    state.studentArrangementContext = (state.studentArrangementContext || 0)+1;
    state.studentArrangement = null;state.studentArrangementHistory = null;state.studentArrangementHistoryFilters = null;state.studentArrangementHistoryOpen = false;state.studentArrangementProgrammeId = null;
  }
  async function loadStudent(state,api,programmeId) {
    if (state.studentArrangementProgrammeId !== programmeId) {clearStudent(state);state.studentArrangementProgrammeId = programmeId;}
    const version = state.studentArrangementLoadVersion = (state.studentArrangementLoadVersion || 0)+1,context = state.studentArrangementContext;
    const data = await api('GET',`/api/registry/me/programmes/${programmeId}/exam-arrangements?${new URLSearchParams(state.studentArrangementHistoryFilters || {})}`);
    if (version === state.studentArrangementLoadVersion && context === state.studentArrangementContext) state.studentArrangementHistory = data;
  }
  function bind(root,state,{api,act},self = false) {
    const key = self ? 'studentArrangement' : 'examArrangements',base = `/api/exams/${self ? 'me/' : ''}`;
    root.querySelector('[data-arrangements-workspace]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state.arrangementsOpen = event.currentTarget.open;});
    const context = state.studentArrangementContext;
    const assign = (data) => {if (!self || context === state.studentArrangementContext) state[key] = data;};
    root.querySelectorAll('[data-arrangements-open],[data-arrangement-history-open]').forEach((button) => button.addEventListener('click',() => act(async () => {assign(await api('GET',`${base}sittings/${button.dataset.arrangementsOpen || button.dataset.sitting}/arrangements`));} )));
    root.querySelector('[data-arrangements-close]')?.addEventListener('click',() => act(async () => {state[key] = null;}));
    const historyKey = self ? 'studentArrangementHistory' : 'arrangementHistory',filtersKey = `${historyKey}Filters`,openKey = `${historyKey}Open`;
    root.querySelector('[data-arrangement-history-workspace]')?.addEventListener('toggle',(event) => {if (event.currentTarget.isConnected) state[openKey] = event.currentTarget.open;});
    const loadHistory = async () => {if (self) {if (context === state.studentArrangementContext) await loadStudent(state,api,state.studentArrangementProgrammeId);} else await load(state,api);};
    root.querySelector('[data-arrangement-history-filter]')?.addEventListener('submit',(event) => {
      event.preventDefault();const filters = Object.fromEntries(new FormData(event.currentTarget));act(async () => {state[filtersKey] = {...filters,limit:String(state[historyKey].limit),offset:'0'};await loadHistory();});
    });
    root.querySelectorAll('[data-arrangement-history-page]').forEach((button) => button.addEventListener('click',() => act(async () => {
      const data = state[historyKey];state[filtersKey] = {q:data.q,status:data.status,limit:String(data.limit),offset:String(data.offset+Number(button.dataset.arrangementHistoryPage)*data.limit)};await loadHistory();
    })));
    const refresh = async () => {if (!self) {state.examManifest = null;state.examSeating = null;state.examSeatingHistory = null;await load(state,api);if (state.examTimetable) state.examTimetable = await api('GET',`/api/exams/periods/${state.examTimetable.period.id}`);}};
    root.querySelectorAll('[data-arrangement-request],[data-arrangement-review],[data-arrangement-close]').forEach((form) => form.addEventListener('submit',(event) => {
      event.preventDefault();const data = new FormData(form),input = Object.fromEntries(data);if (form.dataset.revision) input.revision = Number(form.dataset.revision);
      act(async () => {
        if (form.hasAttribute('data-arrangement-request')) {input.extraMinutes = Number(input.extraMinutes);input.separateRoom = data.has('separateRoom');assign(await api('POST',`${base}sittings/${state[key].sitting.id}/arrangements`,input));state.notice = self ? {text:'Arrangement requested.',tone:'success'} : 'Arrangement requested.';}
        else if (form.dataset.arrangementReview) {assign(await api('POST',`${base}arrangements/${form.dataset.arrangementReview}/review`,input));state.notice = 'Arrangement reviewed.';}
        else {assign(await api('POST',`${base}arrangements/${form.dataset.arrangementClose}/close`,input));state.notice = self ? {text:'Arrangement request withdrawn.',tone:'success'} : 'Arrangement closed.';}
        await refresh();
      });
    }));
  }
  window.registryExamArrangementsUI = {render,bind,load,clearStudent,loadStudent,studentView:(state) => `${historyView(state.studentArrangementHistory,state.studentArrangementHistoryOpen,true)}${panel(state.studentArrangement,true)}`,studentBind:(root,state,{api,act}) => bind(root,state,{api,act},true)};
})();
