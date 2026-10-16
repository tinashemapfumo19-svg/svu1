(function () {
  const path='/api/message-rooms',esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const participates=(room,data)=>room?.membershipStatus==='accepted' && data.preferences.enabled && room.consentRevision===data.preferences.revision;
  const moderates=(room,data)=>participates(room,data) && (room.role==='moderator' || room.createdBy===data.accountId && data.capabilities.manage);
  const displayed=state=>(state.rooms?.messages?.items || []).filter(message=>!state.roomDisplays?.[state.rooms.selected?.id]?.ids.includes(message.id));
  const clearIds=state=>[...new Set([...(state.roomDisplays?.[state.rooms.selected?.id]?.ids || []),...(state.rooms?.messages?.items || []).map(message=>message.id)])];
  const definitionSchema=[{name:'title',type:'text',max:200},{name:'purpose',type:'text',max:2000},{name:'policyReference',type:'text',max:300},{name:'retentionRule',type:'text',max:2000}];
  function definitionHistory(state,busy=false) {
    const authority=state.roomCommandAuthority;
    return {authority,resource:{key:'room:create',epoch:authority?.epoch},schema:definitionSchema,eligible:state.rooms?.capabilities.manage===true,busy:busy || !!state.roomPending};
  }
  function installAuthority(state,authority,accountId) {
    if(!authority || Object.keys(authority).sort().join(',')!=='accountId,epoch' || authority.accountId!==accountId || !/^[A-Za-z0-9_-]{43}$/.test(authority.epoch)){
      state.roomCommandHistory?.reset();state.roomCommandAuthority=null;state.roomDefinitionDrafts={};throw new Error('Room command identity requires a refresh.');
    }
    if(state.roomCommandAuthority && (state.roomCommandAuthority.accountId!==authority.accountId || state.roomCommandAuthority.epoch!==authority.epoch))state.roomDefinitionDrafts={};
    state.roomCommandHistory ||= window.chatCommandHistory?.create();state.roomCommandHistory?.reconcile(authority);state.roomCommandAuthority=authority;
  }
  function saveContext(state) {
    const id=state.roomParticipation?.roomId,context=state.roomContexts?.[id];
    if(context){context.drafts=state.roomDrafts || {};context.before=state.roomBefore;context.memberOffset=state.roomMemberOffset || 0;}
  }
  function switchRoom(state,id) {
    saveContext(state);state.roomSelected=id;state.roomParticipation=null;
    const context=state.roomContexts?.[id];state.roomDrafts=context?.drafts || {};state.roomBefore=context?.before || null;state.roomMemberOffset=context?.memberOffset || 0;
  }
  function forgetRoom(state,id) {
    state.roomTargetHistory?.forgetRoom(id);
    state.roomInvitationHistory?.forgetRoom(id);
    if(state.roomDisplays)delete state.roomDisplays[id];
    state.roomTabs=(state.roomTabs || []).filter(tab=>tab.id!==id);if(state.roomContexts)delete state.roomContexts[id];
    if(state.roomPending?.suffix?.startsWith(`/${id}/`))state.roomPending=null;
    if(state.roomSelected===id){state.roomDrafts={};state.roomBefore=null;state.roomMemberOffset=0;state.roomParticipation=null;}
  }
  const draftStore=(state,name)=>/^(title|purpose|policyReference|retentionRule)$/.test(name) ? (state.roomDefinitionDrafts ||= {}) : name==='reportOperation' || name.startsWith('reviewDetails_') ? (state.roomCaseDrafts ||= {}) : (state.roomDrafts ||= {});
  function clearAccess(state,preserveSelection=false) {
    const selected=preserveSelection ? state.roomSelected : null;
    state.roomCommandHistory?.reset();
    state.roomTargetHistory?.reset();
    state.roomInvitationHistory?.reset();
    for(const key of Object.keys(state))if(key.startsWith('room'))delete state[key];
    if(selected)state.roomSelected=selected;
  }
  async function load(state,api,binding) {
    saveContext(state);
    const previous=state.roomParticipation || (state.rooms?.selected && participates(state.rooms.selected,state.rooms) ? {roomId:state.rooms.selected.id,membershipId:state.rooms.selected.membershipId} : null);
    // Capture before content: a later commit must cause another refresh.
    const changes=await api(binding,'GET',`${path}/changes`);
    const data=await api(binding,'GET',`${path}?offset=${state.roomOffset || 0}`);
    let selected=data.items.find(row=>row.id===state.roomSelected) || null;
    state.roomTabs ||= [];state.roomContexts ||= {};
    const summaries=new Map();
    if(data.capabilities.summary)for(const id of new Set([...state.roomTabs.map(tab=>tab.id),...(state.roomSelected?[state.roomSelected]:[])])){
      const summary=await api(binding,'GET',`${path}/${encodeURIComponent(id)}`);
      summaries.set(id,summary);if(id===state.roomSelected){selected=summary.room;data.preferences=summary.preferences;Object.assign(data.capabilities,summary.capabilities);}
    }
    for(const tab of [...state.roomTabs]){
      const summary=summaries.get(tab.id),row=summary?.room || data.items.find(row=>row.id===tab.id),authority=summary ? {...data,preferences:summary.preferences,capabilities:{...data.capabilities,...summary.capabilities}} : data,context=state.roomContexts[tab.id];
      if(!participates(row,authority) || context && (context.membershipId!==row.membershipId || context.consentRevision!==row.consentRevision || context.role!==row.role || context.moderates!==moderates(row,authority)))forgetRoom(state,tab.id);
      else {tab.title=row.title;if(!context)state.roomContexts[tab.id]={membershipId:row.membershipId,consentRevision:row.consentRevision,role:row.role,moderates:moderates(row,authority),drafts:{},before:null,memberOffset:0};}
    }
    const eligible=participates(selected,data);
    if(previous?.roomId===state.roomSelected && previous && (!eligible || previous.membershipId!==selected.membershipId)) {
      state.roomDrafts={};state.roomPending=null;state.roomBefore=null;
      forgetRoom(state,state.roomSelected);
    }
    // Retain the binding even if a later history request loses authority mid-refresh.
    state.roomParticipation=eligible ? {roomId:selected.id,membershipId:selected.membershipId} : null;
    if(eligible){
      let context=state.roomContexts[selected.id];
      if(!context){context={membershipId:selected.membershipId,consentRevision:selected.consentRevision,role:selected.role,moderates:moderates(selected,data),drafts:state.roomDrafts || {},before:state.roomBefore || null,memberOffset:state.roomMemberOffset || 0};state.roomContexts[selected.id]=context;}
      if(!state.roomTabs.some(tab=>tab.id===selected.id)){
        if(state.roomTabs.length>=8)throw new Error('Room tab limit reached.');state.roomTabs.push({id:selected.id,title:selected.title});
      }
      state.roomDrafts=context.drafts;state.roomBefore=context.before;state.roomMemberOffset=context.memberOffset;
    }
    const before=state.roomBefore;
    const messages=participates(selected,data) ? await api(binding,'GET',`${path}/${selected.id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`) : null;
    state.roomDisplays ||= {};
    for(const id of Object.keys(state.roomDisplays))if(!state.roomTabs.some(tab=>tab.id===id))delete state.roomDisplays[id];
    if(messages){
      const key=JSON.stringify([selected.membershipId,selected.consentRevision,selected.role,moderates(selected,data),before || null]);
      const display=state.roomDisplays[selected.id];
      if(display?.key!==key)state.roomDisplays[selected.id]={key,ids:[]};
    }
    const members=moderates(selected,data) ? await api(binding,'GET',`${path}/${selected.id}/members?offset=${state.roomMemberOffset || 0}`) : null;
    if(data.capabilities.manage)installAuthority(state,await api(binding,'GET','/api/chat-command-context'),data.accountId);
    else {state.roomDefinitionDrafts={};state.roomCommandHistory?.reset();state.roomCommandAuthority=null;}
    if(!data.capabilities.triage)state.roomCaseDrafts={};
    if(state.roomReportView==='triage' && !data.capabilities.triage){state.roomReportView='own';state.roomReportSelected=null;state.roomReportDetail=null;}
    if(data.capabilities.report){
      const reportView=state.roomReportView || 'own';
      state.roomReportDetail=null;
      const reports=await api(binding,'GET',`${path}/reports?view=${reportView}&status=${state.roomReportStatus || 'all'}&offset=${state.roomReportOffset || 0}`);
      const detail=state.roomReportSelected ? await api(binding,'GET',`${path}/reports/${encodeURIComponent(state.roomReportSelected)}?view=${reportView}&offset=${state.roomReportEventOffset || 0}`) : null;
      state.roomReports=reports;state.roomReportDetail=detail;
    }
    state.rooms={...data,selected,messages,members};state.roomStamp=changes.stamp;
  }
  const input=(state,name,label,max=200,area=false)=>`<label class="field"><span>${label}</span>${area ? `<textarea class="input" name="${name}" maxlength="${max}" required>${esc(draftStore(state,name)[name] || '')}</textarea>` : `<input class="input" name="${name}" maxlength="${max}" value="${esc(draftStore(state,name)[name] || '')}" required>`}</label>`;
  function reportsView(state,disabled) {
    const queue=state.roomReports,detail=state.roomReportDetail;if(!queue)return '';
    const triage=queue.view==='triage';
    const pager=(key,offset,total,label)=>`<nav class="message-pagination" aria-label="${label}"><button class="icon-button" data-room-report-page="${key}" data-offset="${Math.max(0,offset-25)}" ${disabled || !offset?'disabled':''} title="Previous ${label}" aria-label="Previous ${label}">&#8592;</button><span>${total ? offset+1 : 0}-${Math.min(total,offset+25)} of ${total}</span><button class="icon-button" data-room-report-page="${key}" data-offset="${offset+25}" ${disabled || offset+25>=total?'disabled':''} title="Next ${label}" aria-label="Next ${label}">&#8594;</button></nav>`;
    const actions=!triage || !detail ? [] : detail.status==='open'?['claim']:detail.status==='reviewing'?(detail.assignedToMe?['release','resolve','dismiss']:[]):['reopen'];
    return `<section class="room-reports"><header class="section-header"><h2>Abuse reports</h2></header>
      <fieldset class="private-actions" ${disabled?'disabled':''}><div class="message-modes" role="tablist" aria-label="Report views"><button type="button" role="tab" data-room-report-view="own" aria-selected="${!triage}">My reports</button>${state.rooms.capabilities.triage?`<button type="button" role="tab" data-room-report-view="triage" aria-selected="${triage}">Safety review</button>`:''}</div><label class="field"><span>Case status</span><select class="input" data-room-report-status>${['all','open','reviewing','resolved','dismissed'].map(status=>`<option value="${status}" ${queue.status===status?'selected':''}>${status}</option>`).join('')}</select></label></fieldset>
      <ul class="message-list">${queue.items.map(row=>`<li><header><h3>${esc(row.title)}</h3><time>${esc(new Date(row.createdAt).toLocaleString())}</time></header><p>${esc(row.category)} / ${esc(row.status)}${row.assignedToMe?' / Assigned to me':''}</p><button class="button button-secondary" data-room-report-select="${esc(row.id)}" ${disabled || triage && !row.eligible?'disabled':''}>${triage && !row.eligible?'Independent reviewer required':'Open report'}</button></li>`).join('')}</ul>${!queue.items.length?'<p>No reports.</p>':''}${pager('queue',queue.offset,queue.total,'report pages')}
      ${detail?`<section class="room-report-detail" data-room-report-detail="${esc(detail.id)}"><header class="section-header"><h2>${esc(detail.title)} / Report</h2><button class="icon-button" data-room-report-close ${disabled?'disabled':''} title="Close report" aria-label="Close report">&#215;</button></header><p>${esc(detail.category)} / ${esc(detail.status)} / Revision ${detail.revision}</p><h3>Disclosed message</h3><p class="message-body">${esc(detail.body)}</p><h3>Report reason</h3><p class="message-body">${esc(detail.reason)}</p>
        ${actions.length?`<form data-room-form="triage" data-report="${esc(detail.id)}" data-revision="${detail.revision}"><fieldset ${disabled?'disabled':''}><label class="field"><span>Review action</span><select class="input" name="reportOperation">${actions.map(op=>`<option value="${op}" ${state.roomCaseDrafts?.reportOperation===op?'selected':''}>${op}</option>`).join('')}</select></label>${input(state,`reviewDetails_${detail.id}`,'Review evidence',2000,true)}<button class="button button-primary">Record review</button></fieldset></form>`:''}
        <h3>Case history</h3><ul class="message-list">${detail.events.items.map(event=>`<li><header><strong>${event.revision} / ${esc(event.operation)} / ${esc(event.status)}</strong><time>${esc(new Date(event.recordedAt).toLocaleString())}</time></header>${triage?`<p class="message-body">${esc(event.details)}</p>`:''}</li>`).join('')}</ul>${!detail.events.total?'<p>No review decisions.</p>':''}${pager('events',detail.events.offset,detail.events.total,'case history pages')}</section>`:''}
    </section>`;
  }
  function view(state,busy) {
    const pending=state.roomPending ? `<div class="notice" role="status">Room command pending.<button class="button button-secondary" data-room-retry ${busy ? 'disabled' : ''}>Retry</button><button class="button button-secondary" data-room-discard ${busy ? 'disabled' : ''}>Discard pending command</button></div>` : '';
    const data=state.rooms;if(!data)return `${pending}<button class="icon-button" data-room-refresh title="Refresh rooms" aria-label="Refresh rooms" ${busy ? 'disabled' : ''}>&#8635;</button>`;
    const {selected,preferences,capabilities,messages,members}=data,disabled=busy || !!state.roomPending;
    const context=state.roomContexts?.[selected?.id],minimized=!!context?.minimized;
    const button=(action,label)=>`<button class="button button-secondary" type="button" data-room-action="${action}">${label}</button>`;
    return `<section class="room-workspace" data-room-workspace>
      ${pending}
      <fieldset class="private-controls" ${disabled ? 'disabled' : ''}><form data-room-form="preferences"><label class="check-option"><input type="checkbox" name="enabled" ${(state.roomPreferenceChoice ?? preferences.enabled) ? 'checked' : ''}>Accept room invitations</label><button class="icon-button" title="Save room preferences" aria-label="Save room preferences">&#10003;</button></form><button class="icon-button" type="button" data-room-refresh title="Refresh rooms" aria-label="Refresh rooms">&#8635;</button></fieldset>
      ${state.roomTabs?.length ? `<nav class="room-tabs" role="tablist" aria-label="Open room tabs">${state.roomTabs.map(tab=>`<div class="room-tab" role="presentation"><button type="button" role="tab" data-room-tab-select="${esc(tab.id)}" aria-selected="${tab.id===selected?.id}" ${disabled?'disabled':''}>${esc(tab.title)}</button><button type="button" class="icon-button" data-room-tab-close="${esc(tab.id)}" title="Close ${esc(tab.title)} tab" aria-label="Close ${esc(tab.title)} tab" ${disabled?'disabled':''}>&#215;</button></div>`).join('')}</nav>` : ''}
      ${capabilities.manage ? `<details class="room-definition"><summary>New room</summary><form data-room-form="create"><fieldset ${disabled ? 'disabled' : ''}>${input(state,'title','Room title')}${input(state,'purpose','Purpose',2000,true)}${input(state,'policyReference','Policy reference',300)}${input(state,'retentionRule','Retention rule',2000,true)}${state.roomCommandHistory?.controls(definitionHistory(state,disabled)) || ''}<button class="button button-primary">Create draft</button></fieldset></form></details>` : ''}
      <div class="private-layout"><aside class="private-contacts" aria-label="Institutional rooms"><h2>Rooms</h2><ul>${data.items.map(row=>{const open=state.roomTabs?.some(tab=>tab.id===row.id),full=state.roomTabs?.length>=8 && !open;return `<li><button class="private-contact ${row.id===selected?.id ? 'selected' : ''}" data-room-select="${esc(row.id)}" ${disabled || full ? 'disabled' : ''}><strong>${esc(row.title)}</strong><span>${esc(row.status)}${row.membershipStatus ? ` / ${esc(row.membershipStatus)}` : ''}</span></button>${participates(row,data) && !open ? `<button type="button" class="icon-button" data-room-background="${esc(row.id)}" title="Open ${esc(row.title)} in background" aria-label="Open ${esc(row.title)} in background" ${disabled || full?'disabled':''}>&#43;</button>`:''}</li>`;}).join('')}</ul>${!data.items.length ? '<p>No rooms.</p>' : ''}
      <nav class="message-pagination" aria-label="Room pages"><button class="icon-button" data-room-page="${Math.max(0,data.offset-25)}" ${disabled || !data.offset ? 'disabled' : ''} title="Previous rooms" aria-label="Previous rooms">&#8592;</button><span>Page ${Math.floor(data.offset/25)+1}</span><button class="icon-button" data-room-page="${data.offset+25}" ${disabled || data.offset+25>=data.total ? 'disabled' : ''} title="Next rooms" aria-label="Next rooms">&#8594;</button></nav></aside>
      <section class="private-thread" aria-label="Room history">${selected ? `<header class="section-header"><h2>${esc(selected.title)}</h2><span>${esc(selected.status)}</span>${messages && context ? `<button class="icon-button" type="button" data-room-minimize aria-controls="room-thread-content" aria-expanded="${!minimized}" title="${minimized ? 'Restore' : 'Minimize'} room" aria-label="${minimized ? 'Restore' : 'Minimize'} room" ${disabled ? 'disabled' : ''}>${minimized ? '&#43;' : '&#8722;'}</button>` : ''}</header><div id="room-thread-content" data-room-content ${minimized ? 'hidden' : ''}><p>${esc(selected.purpose)}</p><dl class="room-policy"><dt>Policy</dt><dd>${esc(selected.policyReference)}</dd><dt>Retention</dt><dd>${esc(selected.retentionRule)}</dd></dl>
        <fieldset class="private-actions" ${disabled ? 'disabled' : ''}>
          ${selected.status==='draft' && capabilities.approve && selected.createdBy!==data.accountId ? button('activate','Activate room') : ''}
          ${selected.status!=='closed' && capabilities.approve ? button('close','Close room') : ''}
          ${selected.status==='active' && selected.createdBy===data.accountId && capabilities.manage && !['accepted','pending','banned'].includes(selected.membershipStatus) && preferences.enabled ? button('join','Join room') : ''}
          ${selected.status==='active' && selected.membershipStatus==='pending' ? (preferences.enabled ? button('accept','Accept invitation') : '')+button('decline','Decline invitation') : ''}
          ${selected.status==='active' && selected.membershipStatus==='accepted' ? button('leave','Leave room') : ''}
        </fieldset>
        ${messages && state.roomContexts?.[selected.id] ? `<label class="check-option"><input type="checkbox" data-room-timestamps ${state.roomContexts[selected.id].timestampsHidden ? '' : 'checked'} ${disabled ? 'disabled' : ''}>Show timestamps</label>` : ''}
        ${moderates(selected,data) && selected.status==='active' ? `<form class="private-invite" data-room-form="invite"><fieldset ${disabled ? 'disabled' : ''}>${input(state,'email','Contact email',254)}<button class="icon-button" aria-label="Invite room contact" title="Invite room contact">&#43;</button></fieldset></form>` : ''}
        ${members ? `<details class="room-members"><summary>Memberships</summary><ul>${members.items.map(member=>`<li><strong>${esc(member.name)}</strong> <span>${esc(member.status)} / ${esc(member.role)}</span>${selected.status==='active' && member.accountId!==data.accountId && member.accountId!==selected.createdBy ? `<form data-room-form="member" data-member="${esc(member.id)}" data-revision="${member.revision}"><fieldset ${disabled ? 'disabled' : ''}><label class="field"><span>Action</span><select class="input" name="operation">${(member.status==='banned' ? ['unban'] : [...(member.role==='member' || selected.createdBy===data.accountId ? ['remove','ban'] : []),...(member.status==='accepted' && capabilities.manage && selected.createdBy===data.accountId ? [member.role==='moderator' ? 'demote' : 'promote'] : [])]).map(op=>`<option value="${op}">${esc(op)}</option>`).join('')}</select></label>${input(state,`reason_${member.id}`,'Reason',2000,true)}<button class="button button-secondary">Apply</button></fieldset></form>` : ''}</li>`).join('')}</ul><nav class="message-pagination" aria-label="Membership pages"><button class="icon-button" data-room-member-page="${Math.max(0,members.offset-25)}" ${disabled || !members.offset ? 'disabled' : ''} title="Previous memberships" aria-label="Previous memberships">&#8592;</button><button class="icon-button" data-room-member-page="${members.offset+25}" ${disabled || members.offset+25>=members.total ? 'disabled' : ''} title="Next memberships" aria-label="Next memberships">&#8594;</button></nav></details>` : ''}
        ${messages && context ? `<div class="chat-display-options"><label class="check-option"><input type="checkbox" data-room-formatted ${context.formatted ? 'checked' : ''} ${disabled ? 'disabled' : ''}>Show formatting</label><label class="check-option"><input type="checkbox" data-room-smileys ${context.smileys ? 'checked' : ''} ${disabled ? 'disabled' : ''}>Show smileys</label><label class="check-option"><input type="checkbox" data-room-name-emphasis ${context.emphasizeName ? 'checked' : ''} ${disabled || !state.ownName ? 'disabled' : ''}>Emphasize my name</label></div>` : ''}
        ${messages ? `<ol class="private-history">${[...displayed(state)].reverse().map(message=>`<li data-room-message="${esc(message.id)}" class="room-${message.kind}"><header><strong>${esc(message.authorName)}</strong><span>${esc(message.kind)}</span><time>${esc(new Date(message.createdAt).toLocaleString())}</time></header><p data-chat-body="${esc(message.id)}">${message.hidden ? 'Hidden by moderation' : window.chatFormatting?.render(message.body,!!context?.formatted,!!context?.smileys,context?.emphasizeName?state.ownName:'') ?? esc(message.body)}</p>${!message.hidden && message.authorId!==data.accountId && capabilities.report ? `<details data-room-detail-key="report_${esc(message.id)}"><summary>Report message</summary><form data-room-form="report" data-message="${esc(message.id)}"><fieldset ${disabled?'disabled':''}><label class="field"><span>Category</span><select class="input" name="reportCategory_${esc(message.id)}">${['harassment','threat','spam','privacy','other'].map(c=>`<option value="${c}" ${state.roomDrafts?.[`reportCategory_${message.id}`]===c?'selected':''}>${c}</option>`).join('')}</select></label>${input(state,`reportReason_${message.id}`,'Report reason',2000,true)}<label class="check-option"><input type="checkbox" name="reportDisclose_${esc(message.id)}" ${state.roomDrafts?.[`reportDisclose_${message.id}`]===true?'checked':''} required>Share this message and report with safety reviewers</label><button class="button button-secondary">Submit report</button></fieldset></form></details>`:''}${moderates(selected,data) && selected.status==='active' ? `<details><summary>${message.hidden ? 'Restore' : 'Hide'}</summary><form data-room-form="moderate" data-message="${esc(message.id)}" data-revision="${message.moderationRevision}" data-hidden="${!message.hidden}"><fieldset ${disabled ? 'disabled' : ''}>${input(state,`reason_${message.id}`,'Reason',2000,true)}<button class="button button-secondary">${message.hidden ? 'Restore message' : 'Hide message'}</button></fieldset></form></details>` : ''}</li>`).join('')}</ol>${!displayed(state).length ? '<p>No messages.</p>' : ''}<nav class="message-pagination" aria-label="Room message pages"><button class="icon-button" data-room-clear ${disabled || !displayed(state).length || clearIds(state).length>4096 ? 'disabled' : ''} title="Clear room display" aria-label="Clear room display">&#9003;</button><button class="icon-button" data-room-restore ${disabled || !state.roomDisplays?.[selected.id]?.ids.length ? 'disabled' : ''} title="Restore room display" aria-label="Restore room display">&#8634;</button><button class="icon-button" data-room-newest ${disabled || !state.roomBefore ? 'disabled' : ''} title="Newest room messages" aria-label="Newest room messages">&#8594;</button><button class="icon-button" data-room-older ${disabled || !messages.nextBefore ? 'disabled' : ''} title="Older room messages" aria-label="Older room messages">&#8592;</button></nav>
        ${selected.status==='active' ? `<form class="private-compose" data-room-form="send"><fieldset ${disabled ? 'disabled' : ''}><label class="field"><span>Kind</span><select class="input" name="kind">${['text','action',...(moderates(selected,data) ? ['notice'] : [])].map(kind=>`<option ${state.roomDrafts?.kind===kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>${input(state,'body','Message',4000,true)}${window.chatFormatting?.toolbar(disabled,context,selected.id) || ''}<button class="icon-button" title="Send room message" aria-label="Send room message">&#8593;</button></fieldset></form>` : ''}` : '<p>No current room history access.</p>'}</div>` : '<p>Select a room.</p>'}</section></div>${reportsView(state,disabled)}</section>`;
  }
  function bind(root,state,{act,api,identity,commandAuthority,commandTarget,invitationContext,onInvitationError,current:sessionCurrent=()=>true}) {
    const boundRooms=state.rooms;
    const listen=(node,event,handler)=>node?.addEventListener(event,e=>{if(node.isConnected && state.rooms===boundRooms)handler(e);});
    const current=()=>state.rooms===boundRooms && !state.roomPending && root.querySelector('.messages-page')?.getAttribute('aria-busy')!=='true';
    window.chatFormatting?.bindDisplay(root,root.querySelector('[data-room-formatted]'),state.roomContexts?.[boundRooms?.selected?.id],boundRooms?.messages?.items,current,root.querySelector('[data-room-smileys]'),root.querySelector('[data-room-name-emphasis]'),state.ownName);
    window.chatFormatting?.bindComposer(root.querySelector('[data-room-form="send"]'),current,state.roomContexts?.[boundRooms?.selected?.id]);
    const refresh=async binding=>{await identity?.(binding);await load(state,api,binding);};
    listen(root.querySelector('[data-room-minimize]'),'click',event=>{
      const context=state.roomContexts?.[boundRooms.selected?.id],content=root.querySelector('[data-room-content]');if(!context || !content)return;
      window.chatScroll?.capture(root);
      context.minimized=!context.minimized;content.hidden=context.minimized;
      if(!context.minimized)window.chatScroll?.restore(root);
      const button=event.currentTarget,label=`${context.minimized ? 'Restore' : 'Minimize'} room`;
      button.setAttribute('aria-expanded',String(!context.minimized));button.setAttribute('aria-label',label);button.title=label;button.textContent=context.minimized ? '+' : '\u2212';button.focus({preventScroll:true});
    });
    root.querySelectorAll('[data-room-message] time').forEach(time=>{time.hidden=!!state.roomContexts?.[boundRooms?.selected?.id]?.timestampsHidden;});
    listen(root.querySelector('[data-room-timestamps]'),'change',event=>{
      const context=state.roomContexts?.[boundRooms.selected?.id];if(!context)return;
      context.timestampsHidden=!event.target.checked;
      root.querySelectorAll('[data-room-message] time').forEach(time=>{time.hidden=context.timestampsHidden;});
    });
    async function execute(binding) {
      const pending=state.roomPending;if(!pending)return;
      const result=await api(binding,pending.method,`${path}${pending.suffix}`,pending.body);
      if(pending.suffix==='/preferences')delete state.roomPreferenceChoice;
      state.roomPending=null;
      if(pending.suffix==='')state.roomDefinitionDrafts={};else if(pending.suffix.includes('/triage'))state.roomCaseDrafts={};else if(pending.suffix!=='/preferences'){state.roomDrafts={};state.roomBefore=null;saveContext(state);}
      if(pending.suffix==='')state.roomSelected=result.id;
      if(pending.reportResult){state.roomReportSelected=result.id;state.roomReportView='own';state.roomReportEventOffset=0;}
      await refresh(binding);
    }
    function command(suffix,body,method='POST',reportResult=false,requestKey=`room_${crypto.randomUUID()}`) {if(state.roomPending)return;state.roomPending={suffix,method,reportResult,body:{...body,requestKey}};if(method==='POST' && suffix==='')state.roomCommandHistory?.record({...definitionHistory(state),busy:false,requestKey:state.roomPending.body.requestKey,values:body});if(method==='POST' && suffix===`/${state.rooms?.selected?.id}/messages`)window.chatHistory?.record(state.roomContexts?.[state.rooms.selected.id],state.roomPending.body.requestKey,{body:body.body,kind:body.kind ?? 'text'});return act(execute);}

    window.chatHistory?.bindComposer(root.querySelector('[data-room-form="send"]'),state.roomContexts?.[boundRooms?.selected?.id],current);
    listen(root.querySelector('[data-room-retry]'),'click',()=>act(execute));
    listen(root.querySelector('[data-room-discard]'),'click',()=>act(async binding=>{state.roomPending=null;await refresh(binding);}));
    listen(root.querySelector('[data-room-refresh]'),'click',()=>act(refresh));
    listen(root.querySelector('[data-room-clear]'),'click',()=>act(async binding=>{const ids=clearIds(state);if(ids.length>4096)throw new Error('Restore the display before clearing more messages.');state.roomDisplays[state.rooms.selected.id].ids=ids;await refresh(binding);}));
    listen(root.querySelector('[data-room-restore]'),'click',()=>act(async binding=>{state.roomDisplays[state.rooms.selected.id].ids=[];await refresh(binding);}));
    root.querySelectorAll('[data-room-select],[data-room-tab-select]').forEach(button=>listen(button,'click',()=>act(async binding=>{const id=button.dataset.roomSelect || button.dataset.roomTabSelect;if(state.roomTabs?.length>=8 && !state.roomTabs.some(tab=>tab.id===id))throw new Error('Room tab limit reached.');switchRoom(state,id);await refresh(binding);} )));
    root.querySelectorAll('[data-room-background]').forEach(button=>listen(button,'click',()=>act(async binding=>{const row=state.rooms.items.find(row=>row.id===button.dataset.roomBackground);if(!row || !participates(row,state.rooms))return;state.roomTabs ||= [];if(state.roomTabs.some(tab=>tab.id===row.id))return;if(state.roomTabs.length>=8)throw new Error('Room tab limit reached.');state.roomTabs.push({id:row.id,title:row.title});state.roomContexts ||= {};state.roomContexts[row.id]={membershipId:row.membershipId,consentRevision:row.consentRevision,role:row.role,moderates:moderates(row,state.rooms),drafts:{},before:null,memberOffset:0};await refresh(binding);} )));
    root.querySelectorAll('[data-room-tab-close]').forEach(button=>listen(button,'click',()=>act(async binding=>{const id=button.dataset.roomTabClose;if(Object.values(state.roomContexts?.[id]?.drafts || {}).some(Boolean) && !confirm('Close this tab and discard its unsent draft?'))return;saveContext(state);forgetRoom(state,id);if(state.roomSelected===id)switchRoom(state,state.roomTabs[0]?.id || null);await refresh(binding);} )));
    for(const [selector,key] of [['[data-room-page]','roomOffset'],['[data-room-member-page]','roomMemberOffset']])root.querySelectorAll(selector).forEach(button=>listen(button,'click',()=>act(async binding=>{state[key]=Number(button.dataset[key==='roomOffset' ? 'roomPage' : 'roomMemberPage']);await refresh(binding);} )));
    root.querySelectorAll('[data-room-action]').forEach(button=>listen(button,'click',()=>{
      const selected=state.rooms.selected,operation=button.dataset.roomAction;
      if(operation==='close' && !confirm('Close this room permanently?'))return;
      if(['accept','decline','leave'].includes(operation))command(`/${selected.id}/members/${selected.membershipId}/${operation}`,{revision:selected.membershipRevision});
      else command(`/${selected.id}/${operation}`,operation==='join' ? {} : {revision:selected.revision});
    }));
    listen(root.querySelector('[data-room-older]'),'click',()=>act(async binding=>{state.roomBefore=state.rooms.messages.nextBefore;await refresh(binding);}));
    listen(root.querySelector('[data-room-newest]'),'click',()=>act(async binding=>{state.roomBefore=null;await refresh(binding);}));
    root.querySelectorAll('[data-room-report-view]').forEach(button=>listen(button,'click',()=>act(async binding=>{state.roomReportView=button.dataset.roomReportView;state.roomReportSelected=null;state.roomReportDetail=null;state.roomReportOffset=0;state.roomReportEventOffset=0;await refresh(binding);} )));
    listen(root.querySelector('[data-room-report-status]'),'change',event=>act(async binding=>{state.roomReportStatus=event.target.value;state.roomReportOffset=0;await refresh(binding);}));
    root.querySelectorAll('[data-room-report-select]').forEach(button=>listen(button,'click',()=>act(async binding=>{state.roomReportSelected=button.dataset.roomReportSelect;state.roomReportEventOffset=0;await refresh(binding);} )));
    listen(root.querySelector('[data-room-report-close]'),'click',()=>act(async binding=>{state.roomReportSelected=null;state.roomReportDetail=null;await refresh(binding);}));
    root.querySelectorAll('[data-room-report-page]').forEach(button=>listen(button,'click',()=>act(async binding=>{state[button.dataset.roomReportPage==='events'?'roomReportEventOffset':'roomReportOffset']=Number(button.dataset.offset);await refresh(binding);} )));
    root.querySelectorAll('[data-room-form]').forEach(form=>{
      if(form.dataset.roomForm==='member' && !form.querySelector('[name="operation"]').options.length){form.remove();return;}
      if(form.dataset.roomForm==='preferences')listen(form.querySelector('[name="enabled"]'),'change',event=>{state.roomPreferenceChoice=event.target.checked;});
      const memberOperation=form.dataset.roomForm==='member'?`memberOperation_${form.dataset.member}`:null;
      if(memberOperation){const select=form.querySelector('[name="operation"]'),saved=state.roomDrafts?.[memberOperation];if([...select.options].some(option=>option.value===saved))select.value=saved;}
      form.querySelectorAll('input:not([data-chat-url]),textarea,select').forEach(field=>listen(field,'input',()=>{const name=field.name==='operation' && memberOperation?memberOperation:field.name;draftStore(state,name)[name]=field.type==='checkbox'?field.checked:field.value;}));
      if(form.dataset.roomForm==='invite' && boundRooms.capabilities.invitationContext===true){
        state.roomInvitationHistory ||= window.roomInvitationHistory && window.roomInvitationHistoryUI?.create();
        const invitations=state.roomInvitationHistory,roomId=boundRooms.selected.id;
        if(invitations){
          const descriptor={roomId,accountId:boundRooms.accountId};form.querySelector('button').insertAdjacentHTML('beforebegin',invitations.render(descriptor));
          invitations.bindForm(form,{descriptor,current:()=>current() && sessionCurrent(),
            request:email=>{if(typeof invitationContext!=='function')throw new Error('Invitation context is unavailable.');return invitationContext(roomId,email);},
            send:({email,requestKey})=>command(`/${roomId}/members`,{email},'POST',false,requestKey),
            onError:error=>typeof onInvitationError==='function'?onInvitationError(error):act(async()=>{throw error;})});
        }
      }
      if(['member','moderate'].includes(form.dataset.roomForm)){
        state.roomTargetHistory ||= window.roomCommandHistoryUI?.create();
        const target=state.roomTargetHistory,type=form.dataset.roomForm==='member'?'member':'message',roomId=boundRooms.selected.id;
        if(target){
          const descriptor={roomId,accountId:boundRooms.accountId,type,targetId:type==='member'?form.dataset.member:form.dataset.message,revision:Number(form.dataset.revision),operation:form.dataset.hidden==='true'?'hide':'restore',operations:type==='member'?[...form.querySelector('[name="operation"]').options].map(option=>option.value):undefined};
          form.querySelector('button').insertAdjacentHTML('beforebegin',target.controls(descriptor));
          target.bindForm(form,{
            descriptor,current:()=>current() && sessionCurrent(),
            request:()=>{if(typeof commandTarget!=='function')throw new Error('Room command context is unavailable.');return commandTarget(roomId,type,descriptor.targetId);},
            send:({requestKey,revision,operation,reason})=>type==='member'
              ? command(`/${roomId}/members/${descriptor.targetId}/${operation}`,{revision,reason},'POST',false,requestKey)
              : command(`/${roomId}/messages/${descriptor.targetId}/moderate`,{revision,hidden:operation==='hide',reason},'POST',false,requestKey),
            onError:error=>act(async()=>{throw error;}),
            onInvalidate:(descriptor,all)=>{
              const stores=new Set([state.roomDrafts,...Object.values(state.roomContexts || {}).map(context=>context.drafts)]);
              for(const store of stores)if(store)for(const name of Object.keys(store))if(all?/^(reason_|memberOperation_)/.test(name):name===`reason_${descriptor.targetId}` || name===`memberOperation_${descriptor.targetId}`)delete store[name];
              if(all)root.querySelectorAll('[data-room-form="member"],[data-room-form="moderate"]').forEach(targetForm=>{
                targetForm.querySelectorAll('textarea,select').forEach(field=>{if(field.name.startsWith('reason_') || field.name==='operation'){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));}});
                targetForm.querySelectorAll('[data-command-history]').forEach(button=>{button.disabled=true;});
              });
            }
          });
        }
      }
      form.addEventListener('submit',event=>{
        event.preventDefault();if(!form.isConnected || !current() || !sessionCurrent())return;
        const values=Object.fromEntries(new FormData(form)),selected=state.rooms.selected,id=selected?.id;
        switch(form.dataset.roomForm) {
          case 'preferences':command('/preferences',{revision:state.rooms.preferences.revision,enabled:new FormData(form).has('enabled')},'PUT');break;
          case 'create':command('',values);break;
          case 'invite':if(boundRooms.capabilities.invitationContext===true){if(!state.roomInvitationHistory)act(async()=>{throw new Error('Invitation context is unavailable.');});else state.roomInvitationHistory.submit(form);}else command(`/${id}/members`,{email:values.email});break;
          case 'send':command(`/${id}/messages`,{body:values.body,kind:values.kind});break;
          case 'member':case 'moderate':if(!state.roomTargetHistory)act(async()=>{throw new Error('Room command context is unavailable.');});else state.roomTargetHistory.submit(form);break;
          case 'report':command(`/${id}/messages/${form.dataset.message}/report`,{category:values[`reportCategory_${form.dataset.message}`],reason:values[`reportReason_${form.dataset.message}`],disclose:new FormData(form).has(`reportDisclose_${form.dataset.message}`)},'POST',true);break;
          case 'triage':command(`/reports/${form.dataset.report}/triage`,{revision:Number(form.dataset.revision),operation:values.reportOperation,details:values[`reviewDetails_${form.dataset.report}`]});break;
        }
      });
    });
    state.roomCommandHistory?.bindForm(root.querySelector('[data-room-form="create"]'),{
      context:()=>definitionHistory(state,root.querySelector('.messages-page')?.getAttribute('aria-busy')==='true'),
      current:()=>current() && sessionCurrent(),
      refresh:async()=>{if(typeof commandAuthority!=='function')throw new Error('Room command authority is unavailable.');installAuthority(state,await commandAuthority(),boundRooms.accountId);return definitionHistory(state);},
      onError:error=>{state.roomCommandHistory?.reset();act(async()=>{throw error;});}
    });
    const id=boundRooms?.selected?.id,context=state.roomContexts?.[id],history=root.querySelector('.private-history');
    if(context && history){
      history.setAttribute('data-chat-scroll','');history.setAttribute('tabindex','0');history.setAttribute('aria-label','Room messages');
      const positions=new Map((boundRooms.messages?.items || []).map(row=>[row.id,row.position]));
      history.querySelectorAll('[data-room-message]').forEach(row=>{row.dataset.chatPosition=positions.get(row.dataset.roomMessage);});
      window.chatScroll?.bind(history,context,state.roomBefore || 'latest',boundRooms.messages?.items || [],()=>sessionCurrent() && state.roomContexts?.[id]===context);
    }
  }
  window.messageRoomsUI={load,view,bind,switchRoom,clearAccess,forgetRoom};
})();
