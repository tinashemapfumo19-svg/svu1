(function () {
  const keys = ['svu.applicant.session','svu.registry.session'];
  const labels = ['Student / applicant','Staff registry'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const initial = () => ({data:null,private:null,mode:'notifications',view:'all',cursors:[null],notice:'',resetScroll:false});
  const state = initial();
  let selected = keys[0],bound = null,generation = 0,busy = false;
  let roomFocus=null;
  let privateFocus=null;
  let workspaceFocus=false;
  let historyFocus=null;
  let alertFocus=null;
  function sessions() {
    return keys.map((key,index) => {
      try {const value = JSON.parse(sessionStorage.getItem(key) || 'null');return value?.token ? {key,label:labels[index],token:value.token} : null;} catch {return null;}
    }).filter(Boolean).filter((row,index,rows) => rows.findIndex(other => other.token === row.token) === index); // One sign-in fills both keys; list each account once.
  }
  function synchronize() {
    const available = sessions();
    if (!available.some(row => row.key === selected)) selected = available[0]?.key || keys[0];
    const token = available.find(row => row.key === selected)?.token || null;
    const identity = JSON.stringify([selected,token]);
    if (identity !== bound) {window.chatAlerts?.unmount();state.roomCommandHistory?.reset();state.roomTargetHistory?.reset();state.roomInvitationHistory?.reset();bound = identity;generation++;roomFocus=null;privateFocus=null;workspaceFocus=false;historyFocus=null;alertFocus=null;for(const key of Object.keys(state))delete state[key];Object.assign(state,initial());}
    return {key:selected,token,generation};
  }
  function current(binding) {
    const next = synchronize();
    return location.hash === '#messages' && binding.key === next.key && binding.token === next.token && binding.generation === next.generation;
  }
  async function api(binding,method,path,body,signal) {
    if (!current(binding)) throw new Error('The message session changed.');
    const response = await fetch(path,{method,signal,headers:{Authorization:`Bearer ${binding.token}`,'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
    const payload = await response.json().catch(() => ({}));
    if (!current(binding)) throw new Error('The message session changed.');
    if (!response.ok) {
      if(/\/invitation-command-context(?:\?|$)/.test(path))throw Object.assign(new Error(payload.error?.message || 'Invitation context is unavailable.'),{statusCode:response.status});
      if(!/\/activity(?:\?|$)/.test(path) || [401,403].includes(response.status)){
        state.data = null;state.private = null;if(path.startsWith('/api/message-rooms'))state.rooms=null;
      }
      if([401,403].includes(response.status)){
        for(const key of Object.keys(state))if(key.startsWith('private'))delete state[key];
        window.messageRoomsUI.clearAccess(state,response.status===403 && path.startsWith('/api/message-rooms'));
      }
      if (response.status === 401) {sessionStorage.removeItem(binding.key);synchronize();}
      throw Object.assign(new Error(payload.error?.message || 'Messages are unavailable.'),{statusCode:response.status});
    }
    return payload.data;
  }
  async function loadIdentity(binding) {
    state.ownName='';
    const profile=await api(binding,'GET','/api/identity/me'),id=profile?.account?.id;
    if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || state.presentationBoundId && state.presentationBoundId!==id){
      state.presentationAccountId=null;state.ownName='';state.data=null;
      for(const key of Object.keys(state))if(key.startsWith('private'))delete state[key];
      window.messageRoomsUI.clearAccess(state);
      throw new Error('Message identity requires a fresh sign-in.');
    }
    if(!state.presentationBoundId){state.presentationBoundId=id;state.workspaceMinimized=window.messagePresentation.read(id);}
    state.presentationAccountId=id;state.ownName=window.chatNameEmphasis?.accountName(profile) || '';
  }
  async function load(binding) {
    await loadIdentity(binding);
    if(state.mode==='rooms'){await window.messageRoomsUI.load(state,api,binding);return;}
    if(state.mode==='private'){await window.privateMessagesUI.load(state,api,binding);return;}
    state.data = null;
    const query = new URLSearchParams({view:state.view,limit:'20'}),cursor = state.cursors.at(-1);
    if (cursor) query.set('cursor',cursor);
    const data = await api(binding,'GET',`/api/notifications/me?${query}`);
    if (current(binding)) {state.data = data;state.resetScroll = true;}
  }
  async function act(work) {
    if (busy) return;
    const binding = synchronize();
    if (!binding.token) {draw();return;}
    busy = true;state.notice = '';draw();
    try {await work(binding);} catch (error) {if (current(binding)) {state.data = null;state.notice = error.message;}}
    finally {
      busy = false;
      const same = current(binding);
      if (location.hash === '#messages') {
        draw();
        if (!same && synchronize().token) act(load);
      }
    }
  }
  function draw() {
    if (location.hash !== '#messages') return;
    const binding = synchronize(),available = sessions(),data = state.data;
    const root = document.querySelector('#app');
    window.chatScroll?.capture(root);
    const detailKey=node=>node.dataset.roomDetailKey || (node.classList.contains('room-definition') ? 'definition' : node.classList.contains('room-members') ? 'members' : node.querySelector('[data-private-report]')?.dataset.privateReport || node.querySelector('[data-message]')?.dataset.message);
    const openDetails=['rooms','private'].includes(state.mode) ? new Set([...root.querySelectorAll('details[open]')].map(detailKey).filter(Boolean)) : new Set();
    const active=document.activeElement,form=active?.closest?.('[data-room-form]');
    if(root.contains(active) && (['window','sound','own'].includes(active?.dataset?.chatAlertSetting) || active?.hasAttribute?.('data-chat-alert-test')))alertFocus={account:state.presentationAccountId,setting:active.dataset.chatAlertSetting};
    if(root.contains(active) && active?.matches?.('[data-chat-scroll]')){
      const id=state.mode==='private' ? state.private?.selected?.id : state.rooms?.selected?.id;
      historyFocus={mode:state.mode,id,context:state.mode==='private' ? state.privateContexts?.[id] : state.roomContexts?.[id]};
    }
    if(root.contains(active) && active?.matches?.('[data-message-minimize]'))workspaceFocus=true;
    if(state.mode==='rooms' && form && root.contains(active) && active.matches('input,textarea,select'))roomFocus={form:form.dataset.roomForm,message:form.dataset.message,member:form.dataset.member,report:form.dataset.report,name:active.name,start:active.selectionStart,end:active.selectionEnd};
    const privateForm=active?.closest?.('[data-private-compose],[data-private-invite],[data-private-report]');
    if(state.mode==='private' && privateForm && root.contains(active) && active.matches('input,textarea'))privateFocus={conversation:state.privateSelected,selector:privateForm.hasAttribute('data-private-compose')?'[data-private-compose]':privateForm.hasAttribute('data-private-invite')?'[data-private-invite]':`[data-private-report="${privateForm.dataset.privateReport}"]`,name:active.name,start:active.selectionStart,end:active.selectionEnd};
    root.innerHTML = `<section class="messages-page" aria-busy="${busy}">
      <header class="section-header"><h1 class="page-title">Messages</h1>${binding.token && state.presentationAccountId ? `<button class="icon-button" type="button" data-message-minimize aria-controls="message-workspace-content" aria-expanded="${!state.workspaceMinimized}" aria-label="${state.workspaceMinimized ? 'Restore' : 'Minimize'} message workspace" title="${state.workspaceMinimized ? 'Restore' : 'Minimize'} message workspace" ${busy ? 'disabled' : ''}>${state.workspaceMinimized ? '&#43;' : '&#8722;'}</button>` : ''}</header>
      ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ''}
      ${!binding.token ? '<p><a href="#apply">Student sign in</a> <a href="#registry">Staff sign in</a></p>' : `
      ${available.length > 1 ? `<label class="field"><span>Account</span><select class="input" data-message-account ${busy ? 'disabled' : ''}>${available.map(row => `<option value="${esc(row.key)}" ${row.key === selected ? 'selected' : ''}>${esc(row.label)}</option>`).join('')}</select></label>` : ''}
      ${window.chatAlerts?.controls(state.presentationAccountId) || ''}
      <div id="message-workspace-content" data-message-content ${state.workspaceMinimized ? 'hidden' : ''}>
      <div class="message-modes" role="tablist" aria-label="Message views"><button type="button" role="tab" data-message-mode="notifications" aria-selected="${state.mode==='notifications'}" ${busy ? 'disabled' : ''}>Notifications</button><button type="button" role="tab" data-message-mode="private" aria-selected="${state.mode==='private'}" ${busy ? 'disabled' : ''}>Private conversations</button><button type="button" role="tab" data-message-mode="rooms" aria-selected="${state.mode==='rooms'}" ${busy ? 'disabled' : ''}>Institutional rooms</button></div>
      ${state.mode==='rooms' ? window.messageRoomsUI.view(state,busy) : state.mode==='private' ? window.privateMessagesUI.view(state,busy) : `
      <fieldset class="message-controls" ${busy ? 'disabled' : ''}>
        <label class="field"><span>Messages</span><select class="input" data-message-view>${[['all','All'],['unread','Unread'],['read','Read']].map(([value,label]) => `<option value="${value}" ${state.view === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button class="icon-button" type="button" data-message-refresh aria-label="Refresh messages" title="Refresh messages">&#8635;</button>
        ${data ? `<p class="message-count">${data.unread} unread / ${data.total} total</p>` : ''}
      </fieldset>
      ${busy && !data ? '<p role="status">Loading...</p>' : data ? `
        <ul class="message-list">${data.items.map(row => `<li data-message="${esc(row.id)}" ${row.readAt ? '' : 'class="message-unread"'}>
          <header><h2>${esc(row.subject)}</h2><time datetime="${esc(row.createdAt)}">${esc(new Date(row.createdAt).toLocaleString())}</time></header>
          <p class="message-body">${esc(row.body)}</p>
          ${row.link && /^#[A-Za-z0-9_/?=&.%-]{1,200}$/.test(row.link) ? `<a class="ui-link message-open" href="${esc(row.link)}" data-message-link>Open</a>` : ''}
          <footer><span>${row.readAt ? 'Read' : 'Unread'}</span>${row.readAt ? '' : `<button class="icon-button" type="button" data-message-read="${esc(row.id)}" ${busy ? 'disabled' : ''} title="Mark as read" aria-label="Mark ${esc(row.subject)} as read">&#10003;</button>`}</footer>
        </li>`).join('')}</ul>
        ${!data.items.length ? `<p>${state.view === 'unread' ? 'No unread messages.' : state.view === 'read' ? 'No read messages.' : 'No messages.'}</p>` : ''}
        <nav class="message-pagination" aria-label="Message pages"><button class="icon-button" type="button" data-message-previous ${busy || state.cursors.length < 2 ? 'disabled' : ''} title="Newer messages" aria-label="Newer messages">&#8592;</button><span>Page ${state.cursors.length}</span><button class="icon-button" type="button" data-message-next ${busy || !data.nextCursor ? 'disabled' : ''} title="Older messages" aria-label="Older messages">&#8594;</button></nav>` : ''}`}</div>`}
      </section>`;
    if (state.resetScroll) {window.scrollTo(0,0);state.resetScroll = false;}
    root.querySelector('[data-message-minimize]')?.addEventListener('click',event=>{
      const button=event.currentTarget;if(!button.isConnected || busy || !current(binding) || !state.presentationAccountId)return;
      state.workspaceMinimized=!state.workspaceMinimized;
      window.chatScroll?.capture(root);
      if(!window.messagePresentation.write(state.presentationAccountId,state.workspaceMinimized)){
        state.notice='Display preference could not be saved.';draw();root.querySelector('[data-message-minimize]')?.focus({preventScroll:true});return;
      }
      root.querySelector('[data-message-content]').hidden=state.workspaceMinimized;
      if(!state.workspaceMinimized)window.chatScroll?.restore(root);
      const label=`${state.workspaceMinimized ? 'Restore' : 'Minimize'} message workspace`;
      button.setAttribute('aria-expanded',String(!state.workspaceMinimized));button.setAttribute('aria-label',label);button.title=label;button.textContent=state.workspaceMinimized ? '+' : '\u2212';button.focus({preventScroll:true});
    });
    root.querySelectorAll('[data-message-mode]').forEach(button=>button.addEventListener('click',()=>act(async binding=>{state.mode=button.dataset.messageMode;await load(binding);} )));
    if(state.mode==='private')window.privateMessagesUI.bind(root,state,{act,api,identity:loadIdentity,current:()=>current(binding)});
    if(state.mode==='private')root.querySelectorAll('details').forEach(node=>{if(openDetails.has(detailKey(node)))node.open=true;});
    if(state.mode==='private' && !busy && privateFocus){
      const saved=privateFocus;privateFocus=null;
      const field=saved.conversation===state.privateSelected && root.querySelector(saved.selector)?.querySelector(`[name="${saved.name}"]`);
      if(field && !field.disabled && !field.closest('[hidden]')){field.focus({preventScroll:true});if(saved.start!==null && saved.start!==undefined && field.setSelectionRange)field.setSelectionRange(saved.start,saved.end);}
    }
    if(state.mode==='rooms')window.messageRoomsUI.bind(root,state,{act,api,identity:loadIdentity,commandAuthority:()=>api(binding,'GET','/api/chat-command-context'),commandTarget:(roomId,targetType,targetId)=>api(binding,'GET',`/api/message-rooms/${encodeURIComponent(roomId)}/command-context?${new URLSearchParams({targetType,targetId})}`),
      invitationContext:(roomId,email)=>api(binding,'POST',`/api/message-rooms/${encodeURIComponent(roomId)}/invitation-command-context`,{email}),
      onInvitationError:error=>{
        if(!current(binding))return;
        if([401,403].includes(error.statusCode)){state.data=null;for(const key of Object.keys(state))if(key.startsWith('private'))delete state[key];window.messageRoomsUI.clearAccess(state,error.statusCode===403);}
        if(error.statusCode===401){sessionStorage.removeItem(binding.key);synchronize();if(synchronize().token)act(load);else draw();return;}
        act(async()=>{throw error;});
      },current:()=>current(binding)});
    if(state.mode==='rooms') {
      root.querySelectorAll('details').forEach(node=>{if(openDetails.has(detailKey(node)))node.open=true;});
      if(!busy && roomFocus) {
        const saved=roomFocus;roomFocus=null;
        const target=[...root.querySelectorAll('[data-room-form]')].find(node=>node.dataset.roomForm===saved.form && node.dataset.message===saved.message && node.dataset.member===saved.member && node.dataset.report===saved.report);
        const field=target && [...target.elements].find(node=>node.name===saved.name);
        if(field && !field.disabled && !field.closest('[hidden]')){field.focus({preventScroll:true});if(saved.start!==null && saved.start!==undefined && field.setSelectionRange)field.setSelectionRange(saved.start,saved.end);}
      }
    }
    root.querySelector('[data-message-account]')?.addEventListener('change',event => {
      selected = event.target.value;synchronize();act(load);
    });
    root.querySelector('[data-message-view]')?.addEventListener('change',event => {
      const view = event.target.value;act(async binding => {state.view = view;state.cursors = [null];await load(binding);});
    });
    root.querySelector('[data-message-refresh]')?.addEventListener('click',() => act(async binding => {state.cursors = [null];await load(binding);}));
    root.querySelector('[data-message-next]')?.addEventListener('click',() => {const cursor = state.data?.nextCursor;if (cursor) act(async binding => {state.cursors.push(cursor);await load(binding);});});
    root.querySelector('[data-message-previous]')?.addEventListener('click',() => act(async binding => {if (state.cursors.length > 1) state.cursors.pop();await load(binding);}));
    root.querySelectorAll('[data-message-read]').forEach(button => button.addEventListener('click',() => act(async binding => {
      await api(binding,'POST',`/api/notifications/me/${encodeURIComponent(button.dataset.messageRead)}/read`,{});
      state.cursors = [null];await load(binding);
    })));
    if(!busy && workspaceFocus){workspaceFocus=false;root.querySelector('[data-message-minimize]')?.focus({preventScroll:true});}
    if(!busy && historyFocus){
      const saved=historyFocus;historyFocus=null;
      const context=state.mode==='private' ? state.privateContexts?.[saved.id] : state.roomContexts?.[saved.id];
      const id=state.mode==='private' ? state.private?.selected?.id : state.rooms?.selected?.id;
      const pane=root.querySelector('[data-chat-scroll]');
      if(saved.mode===state.mode && saved.id===id && saved.context===context && pane && !pane.closest('[hidden]'))pane.focus({preventScroll:true});
    }
    const alertAccount=state.presentationAccountId;
    window.chatAlerts?.mount({root,id:alertAccount,key:JSON.stringify([binding.key,binding.token,binding.generation]),current:()=>current(binding) && state.presentationAccountId===alertAccount,busy:()=>busy,
      entries:()=>[...(state.privateTabs || []).map(tab=>({kind:'private',id:tab.id,context:state.privateContexts?.[tab.id]})),...(state.roomTabs || []).map(tab=>({kind:'room',id:tab.id,context:state.roomContexts?.[tab.id]}))],
      shown:entry=>!state.workspaceMinimized && !entry.context.minimized && (entry.kind==='private' ? state.mode==='private' && state.private?.selected?.id===entry.id : state.mode==='rooms' && state.rooms?.selected?.id===entry.id),
      request:(path,signal)=>api(binding,'GET',path,undefined,signal),
      refused:(entry,error)=>{
        if(!current(binding))return;
        if(error.identityChanged){window.chatAlerts.unmount();state.presentationAccountId=null;state.ownName='';for(const key of Object.keys(state))if(key.startsWith('private'))delete state[key];window.messageRoomsUI.clearAccess(state);state.notice=error.message;draw();return;}
        if(error.statusCode===404){if(entry.kind==='private')window.privateMessagesUI.forgetConversation(state,entry.id);else window.messageRoomsUI.forgetRoom(state,entry.id);}
        if([404,409].includes(error.statusCode)){
          if(entry.kind==='private' && state.privateSelected===entry.id)state.private=null;
          if(entry.kind==='room' && state.roomSelected===entry.id)state.rooms=null;
        }
        if([401,403,404,409].includes(error.statusCode)){draw();if(window.chatAlerts.attentive() && !busy && synchronize().token)act(load);}
      }
    });
    if(!busy && alertFocus){const saved=alertFocus;alertFocus=null;const node=saved.account===state.presentationAccountId && root.querySelector(saved.setting?`[data-chat-alert-setting="${saved.setting}"]`:'[data-chat-alert-test]');if(node && !node.disabled)node.focus({preventScroll:true});}
  }
  window.renderMessages = function () {
    const binding = synchronize();draw();
    if (binding.token && !(state.mode==='rooms' ? state.rooms : state.mode==='private' ? state.private : state.data) && !busy) act(load);
  };
  window.svuSession.onChange(()=>{
    const binding=synchronize();
    if(location.hash==='#messages'){draw();if(binding.token && !busy)act(load);}
  });
  window.addEventListener('hashchange',() => {
    if (location.hash !== '#messages') {window.chatAlerts?.unmount();state.roomCommandHistory?.reset();state.roomTargetHistory?.reset();state.roomInvitationHistory?.reset();generation++;roomFocus=null;privateFocus=null;workspaceFocus=false;historyFocus=null;alertFocus=null;for(const key of Object.keys(state))delete state[key];Object.assign(state,initial());}
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && document.hasFocus() && !busy && location.hash==='#messages' && ['private','rooms'].includes(state.mode) && synchronize().token)act(load);
  });
  let polling=false;
  setInterval(async()=>{
    if(polling || busy || document.hidden || window.chatAlerts?.attentive()===false || location.hash!=='#messages' || !['private','rooms'].includes(state.mode))return;
    const mode=state.mode,binding=synchronize();if(!binding.token)return;polling=true;
    try {
      const changes=await api(binding,'GET',mode==='rooms' ? '/api/message-rooms/changes' : '/api/private-messages/changes');
      const changed=mode==='rooms' ? changes.stamp!==state.roomStamp : JSON.stringify(changes)!==state.privateStamp;
      if(current(binding) && state.mode===mode && !busy && changed)act(load);
    }catch(error){
      if(current(binding) && state.mode===mode){if(mode==='rooms')state.rooms=null;else state.private=null;state.notice=error.message;}
      if(location.hash==='#messages')draw();
    }
    finally{polling=false;}
  },5000);
})();
