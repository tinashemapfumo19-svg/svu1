(function () {
  const path='/api/private-messages',esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const eligible=(row,preferences)=>row?.status==='accepted' && !row.blocked && preferences.enabled;
  const displayed=state=>(state.private?.messages?.items || []).filter(message=>!state.privateDisplays?.[state.private.selected?.id]?.ids.includes(message.id));
  const clearIds=state=>[...new Set([...(state.privateDisplays?.[state.private.selected?.id]?.ids || []),...(state.private?.messages?.items || []).map(message=>message.id)])];
  function saveContext(state) {
    const context=state.privateContexts?.[state.privateParticipation];
    if(context)Object.assign(context,{draft:state.privateDraft || '',kind:state.privateKind || 'text',sendKey:state.privateSendKey,pages:state.privatePages || [null],reports:state.privateReports || {}});
  }
  function switchConversation(state,id) {
    saveContext(state);state.privateSelected=id;state.privateParticipation=null;
    const context=state.privateContexts?.[id];state.privateDraft=context?.draft || '';state.privateKind=context?.kind || 'text';state.privateSendKey=context?.sendKey || null;state.privatePages=context?.pages || [null];state.privateReports=context?.reports || {};
  }
  function forgetConversation(state,id) {
    if(state.privateDisplays)delete state.privateDisplays[id];
    state.privateTabs=(state.privateTabs || []).filter(tab=>tab.id!==id);if(state.privateContexts)delete state.privateContexts[id];
    if(state.privateSelected===id){state.privateDraft='';state.privateKind='text';state.privateSendKey=null;state.privatePages=[null];state.privateReports={};state.privateParticipation=null;}
  }
  const newContext=(row,preferences)=>({revision:row.revision,preferenceRevision:preferences.revision,blockRevision:row.blockRevision,draft:'',kind:'text',sendKey:null,pages:[null],reports:{}});
  async function load(state,api,binding) {
    saveContext(state);
    // A commit after this counter must trigger another refresh, even if it races a content read.
    const changes=await api(binding,'GET',`${path}/changes`);
    let preferences=await api(binding,'GET',`${path}/preferences`);
    const conversations=await api(binding,'GET',`${path}/conversations?offset=${state.privateOffset || 0}`);
    let selected=conversations.items.find(row=>row.id===state.privateSelected) || null;
    state.privateTabs ||= [];state.privateContexts ||= {};
    const summaries=new Map();
    if(conversations.summary)for(const id of new Set([...state.privateTabs.map(tab=>tab.id),...(state.privateSelected?[state.privateSelected]:[])])){
      const summary=await api(binding,'GET',`${path}/conversations/${encodeURIComponent(id)}`);summaries.set(id,summary);
      if(id===state.privateSelected){selected=summary.conversation;preferences=summary.preferences;}
    }
    for(const tab of [...state.privateTabs]){
      const summary=summaries.get(tab.id),row=summary?.conversation || conversations.items.find(row=>row.id===tab.id),prefs=summary?.preferences || preferences,context=state.privateContexts[tab.id];
      if(!eligible(row,prefs) || context && (context.revision!==row.revision || context.preferenceRevision!==prefs.revision || context.blockRevision!==row.blockRevision))forgetConversation(state,tab.id);
      else tab.name=row.peerName;
    }
    if(eligible(selected,preferences) && state.privateTabs.length>=8 && !state.privateTabs.some(tab=>tab.id===selected.id)){
      switchConversation(state,state.privateTabs[0].id);const summary=summaries.get(state.privateSelected);
      selected=summary?.conversation || conversations.items.find(row=>row.id===state.privateSelected);preferences=summary?.preferences || preferences;
    }
    if(eligible(selected,preferences)){
      const context=state.privateContexts[selected.id] ||= newContext(selected,preferences);
      if(!state.privateTabs.some(tab=>tab.id===selected.id)){if(state.privateTabs.length>=8)throw new Error('Conversation tab limit reached.');state.privateTabs.push({id:selected.id,name:selected.peerName});}
      state.privateDraft=context.draft;state.privateKind=context.kind || 'text';state.privateSendKey=context.sendKey;state.privatePages=context.pages;state.privateReports=context.reports;state.privateParticipation=selected.id;
    }else if(state.privateParticipation || state.privateContexts[state.privateSelected])forgetConversation(state,state.privateSelected);
    const before=state.privatePages?.at(-1),query=before ? `?before=${encodeURIComponent(before)}` : '';
    const messages=selected ? await api(binding,'GET',`${path}/conversations/${selected.id}/messages${query}`) : null;
    state.privateDisplays ||= {};
    for(const id of Object.keys(state.privateDisplays))if(id!==selected?.id && !state.privateTabs.some(tab=>tab.id===id))delete state.privateDisplays[id];
    if(selected){
      const key=JSON.stringify([selected.revision,preferences.revision,selected.blockRevision,before || null]);
      const display=state.privateDisplays[selected.id];
      if(display?.key!==key)state.privateDisplays[selected.id]={key,ids:[]};
    }
    state.private={preferences,conversations,selected,messages};state.privateStamp=JSON.stringify(changes);
  }
  function view(state,busy) {
    const data=state.private;if(!data)return busy ? '<p role="status">Loading...</p>' : '<button class="icon-button" data-private-refresh title="Refresh conversations" aria-label="Refresh conversations">&#8635;</button>';
    const {preferences,conversations,selected,messages}=data;
    const visible=displayed(state),cleared=state.privateDisplays?.[selected?.id]?.ids.length;
    const context=state.privateContexts?.[selected?.id],minimized=!!context?.minimized;
    return `<section class="private-workspace" data-private-workspace>
      <fieldset class="private-controls" ${busy ? 'disabled' : ''}><form data-private-preferences><label class="check-option"><input type="checkbox" name="enabled" ${(state.privatePreferenceChoice ?? preferences.enabled) ? 'checked' : ''}>Accept private contact requests</label><button class="icon-button" type="submit" aria-label="Save private preferences" title="Save private preferences">&#10003;</button></form>
      ${preferences.enabled ? `<form class="private-invite" data-private-invite><label class="field"><span>Contact email</span><input class="input" type="email" name="email" maxlength="254" value="${esc(state.privateInvite || '')}" required></label><button class="icon-button" type="submit" title="Request private contact" aria-label="Request private contact">&#43;</button></form>` : ''}
      <button class="icon-button" type="button" data-private-refresh title="Refresh conversations" aria-label="Refresh conversations">&#8635;</button></fieldset>
      ${state.privateTabs?.length ? `<nav class="room-tabs" role="tablist" aria-label="Open conversation tabs">${state.privateTabs.map(tab=>`<div class="room-tab" role="presentation"><button type="button" role="tab" data-private-tab-select="${esc(tab.id)}" aria-selected="${tab.id===selected?.id}" ${busy?'disabled':''}>${esc(tab.name)}</button><button type="button" class="icon-button" data-private-tab-close="${esc(tab.id)}" title="Close ${esc(tab.name)} tab" aria-label="Close ${esc(tab.name)} tab" ${busy?'disabled':''}>&#215;</button></div>`).join('')}</nav>` : ''}
      <div class="private-layout"><aside class="private-contacts" aria-label="Private conversations"><h2>Conversations</h2>
        ${conversations.items.length ? `<ul>${conversations.items.map(row=>{const open=state.privateTabs?.some(tab=>tab.id===row.id),full=state.privateTabs?.length>=8 && !open && eligible(row,preferences);return `<li><button type="button" class="private-contact ${selected?.id===row.id ? 'selected' : ''}" data-private-contact="${esc(row.id)}" ${busy || full ? 'disabled' : ''}><strong>${esc(row.peerName)}</strong><span>${esc(row.status)}${row.status==='pending' ? row.outgoing ? ' - Sent request' : ' - Incoming request' : ''}${row.unread ? ` - ${row.unread} unread` : ''}</span></button>${eligible(row,preferences) && !open ? `<button type="button" class="icon-button" data-private-background="${esc(row.id)}" title="Open ${esc(row.peerName)} in background" aria-label="Open ${esc(row.peerName)} in background" ${busy || full?'disabled':''}>&#43;</button>`:''}</li>`;}).join('')}</ul>` : '<p>No conversations.</p>'}
        <nav class="message-pagination" aria-label="Conversation pages"><button class="icon-button" type="button" data-private-page="${Math.max(0,conversations.offset-25)}" ${busy || !conversations.offset ? 'disabled' : ''} title="Previous conversations" aria-label="Previous conversations">&#8592;</button><span>Page ${Math.floor(conversations.offset/25)+1}</span><button class="icon-button" type="button" data-private-page="${conversations.offset+25}" ${busy || conversations.offset+25>=conversations.total ? 'disabled' : ''} title="Next conversations" aria-label="Next conversations">&#8594;</button></nav>
      </aside><section class="private-thread" aria-label="Private message history">${selected ? `<header class="section-header"><h2>${esc(selected.peerName)}</h2><span>${esc(messages.status)}</span>${context ? `<button class="icon-button" type="button" data-private-minimize aria-controls="private-thread-content" aria-expanded="${!minimized}" title="${minimized ? 'Restore' : 'Minimize'} conversation" aria-label="${minimized ? 'Restore' : 'Minimize'} conversation" ${busy ? 'disabled' : ''}>${minimized ? '&#43;' : '&#8722;'}</button>` : ''}</header>
        <div id="private-thread-content" data-private-content ${minimized ? 'hidden' : ''}>
        <fieldset class="private-actions" ${busy ? 'disabled' : ''}>
          ${messages.status==='pending' && !selected.outgoing ? '<button class="button button-primary" data-private-action="accept">Accept</button><button class="button button-secondary" data-private-action="decline">Decline</button>' : ''}
          ${['pending','accepted'].includes(messages.status) ? '<button class="button button-secondary" data-private-action="close">Close conversation</button>' : ''}
          <button class="button button-secondary" data-private-block>${selected.blocked ? 'Unblock contact' : 'Block contact'}</button>
          ${selected.unread && visible.length ? '<button class="icon-button" data-private-read title="Mark displayed messages read" aria-label="Mark displayed messages read">&#10003;</button>' : ''}
          <button class="icon-button" data-private-clear ${!visible.length || clearIds(state).length>4096 ? 'disabled' : ''} title="Clear conversation display" aria-label="Clear conversation display">&#9003;</button>
          <button class="icon-button" data-private-restore ${!cleared ? 'disabled' : ''} title="Restore conversation display" aria-label="Restore conversation display">&#8634;</button>
        </fieldset>
        ${state.privateContexts?.[selected.id] ? `<label class="check-option"><input type="checkbox" data-private-timestamps ${state.privateContexts[selected.id].timestampsHidden ? '' : 'checked'} ${busy ? 'disabled' : ''}>Show timestamps</label>` : ''}
        ${context ? `<div class="chat-display-options"><label class="check-option"><input type="checkbox" data-private-formatted ${context.formatted ? 'checked' : ''} ${busy ? 'disabled' : ''}>Show formatting</label><label class="check-option"><input type="checkbox" data-private-smileys ${context.smileys ? 'checked' : ''} ${busy ? 'disabled' : ''}>Show smileys</label><label class="check-option"><input type="checkbox" data-private-name-emphasis ${context.emphasizeName ? 'checked' : ''} ${busy || !state.ownName ? 'disabled' : ''}>Emphasize my name</label></div>` : ''}
        <ol class="private-history">${[...visible].reverse().map(message=>`<li class="${message.own ? 'private-own' : ''} ${message.kind==='action' ? 'room-action' : ''}" data-private-message="${esc(message.id)}" data-private-kind="${message.kind==='action' ? 'action' : 'text'}"><header><span>${message.own ? 'You' : esc(selected.peerName)}</span>${message.kind==='action' ? '<span>Action</span>' : ''}<time datetime="${esc(message.createdAt)}" ${state.privateContexts?.[selected.id]?.timestampsHidden ? 'hidden' : ''}>${esc(new Date(message.createdAt).toLocaleString())}</time></header><p data-chat-body="${esc(message.id)}">${window.chatFormatting?.render(message.body,!!context?.formatted,!!context?.smileys,context?.emphasizeName?state.ownName:'') ?? esc(message.body)}</p><footer>${message.own ? `<span>${message.readByPeer ? 'Read' : 'Sent'}</span>` : message.reported ? '<span>Reported</span>' : `<details><summary>Report</summary><form data-private-report="${esc(message.id)}"><label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="2000" required>${esc(state.privateReports?.[message.id] || '')}</textarea></label><button class="button button-secondary" ${busy ? 'disabled' : ''}>Report message</button></form></details>`}</footer></li>`).join('')}</ol>
        ${!visible.length ? '<p>No messages.</p>' : ''}
        <nav class="message-pagination" aria-label="Private message pages"><button class="icon-button" data-private-newest ${busy || !state.privatePages?.at(-1) ? 'disabled' : ''} title="Newest messages" aria-label="Newest messages">&#8594;</button><button class="icon-button" data-private-older ${busy || !messages.nextBefore ? 'disabled' : ''} title="Older messages" aria-label="Older messages">&#8592;</button></nav>
        ${messages.status==='accepted' && preferences.enabled && !selected.blocked ? `<form class="private-compose" data-private-compose><div class="chat-compose-field"><label class="field"><span>Kind</span><select class="input" name="kind" ${busy ? 'disabled' : ''}><option value="text" ${state.privateKind!=='action' ? 'selected' : ''}>Text</option><option value="action" ${state.privateKind==='action' ? 'selected' : ''}>Action</option></select></label><label class="field"><span>Message</span><textarea class="input" name="body" maxlength="4000" required ${busy ? 'disabled' : ''}>${esc(state.privateDraft || '')}</textarea></label>${window.chatFormatting?.toolbar(busy,context,selected.id,busy || !!state.privateSendKey) || ''}</div><button class="icon-button" type="submit" ${busy ? 'disabled' : ''} title="Send private message" aria-label="Send private message">&#8593;</button></form>` : ''}</div>` : '<p>Select a conversation.</p>'}</section></div></section>`;
  }
  function bind(root,state,{act,api,identity,current=()=>true}) {
    const boundPrivate=state.private;
    const listen=(node,event,handler)=>node?.addEventListener(event,e=>{if(node.isConnected && state.private===boundPrivate)handler(e);});
    window.chatFormatting?.bindDisplay(root,root.querySelector('[data-private-formatted]'),state.privateContexts?.[boundPrivate?.selected?.id],boundPrivate?.messages?.items,()=>state.private===boundPrivate && root.querySelector('.messages-page')?.getAttribute('aria-busy')!=='true',root.querySelector('[data-private-smileys]'),root.querySelector('[data-private-name-emphasis]'),state.ownName);
    const refresh=async binding=>{await identity?.(binding);await load(state,api,binding);},command=(method,suffix,body)=>act(async binding=>{await api(binding,method,`${path}${suffix}`,body);if(suffix==='/preferences')delete state.privatePreferenceChoice;await refresh(binding);});
    listen(root.querySelector('[data-private-preferences] [name="enabled"]'),'change',event=>{state.privatePreferenceChoice=event.target.checked;});
    listen(root.querySelector('[data-private-preferences]'),'submit',event=>{event.preventDefault();command('PUT','/preferences',{revision:state.private.preferences.revision,enabled:new FormData(event.currentTarget).has('enabled')});});
    const invite=root.querySelector('[data-private-invite]');
    listen(invite?.querySelector('input'),'input',event=>{state.privateInvite=event.target.value;state.privateInviteKey=null;});
    listen(invite,'submit',event=>{event.preventDefault();const email=new FormData(event.currentTarget).get('email'),requestKey=state.privateInviteKey ||= `invite_${crypto.randomUUID()}`;act(async binding=>{const result=await api(binding,'POST',`${path}/conversations`,{email,requestKey});switchConversation(state,result.id);state.privateOffset=0;state.privateInvite='';state.privateInviteKey=null;await refresh(binding);});});
    listen(root.querySelector('[data-private-refresh]'),'click',()=>act(refresh));
    listen(root.querySelector('[data-private-minimize]'),'click',event=>{
      const context=state.privateContexts?.[boundPrivate.selected?.id],content=root.querySelector('[data-private-content]');if(!context || !content)return;
      window.chatScroll?.capture(root);
      context.minimized=!context.minimized;content.hidden=context.minimized;
      if(!context.minimized)window.chatScroll?.restore(root);
      const button=event.currentTarget,label=`${context.minimized ? 'Restore' : 'Minimize'} conversation`;
      button.setAttribute('aria-expanded',String(!context.minimized));button.setAttribute('aria-label',label);button.title=label;button.textContent=context.minimized ? '+' : '\u2212';button.focus({preventScroll:true});
    });
    listen(root.querySelector('[data-private-timestamps]'),'change',event=>{
      const context=state.privateContexts?.[boundPrivate.selected?.id];if(!context)return;
      context.timestampsHidden=!event.target.checked;
      root.querySelectorAll('[data-private-message] time').forEach(time=>{time.hidden=context.timestampsHidden;});
    });
    root.querySelectorAll('[data-private-contact],[data-private-tab-select]').forEach(button=>listen(button,'click',()=>act(async binding=>{const id=button.dataset.privateContact || button.dataset.privateTabSelect,row=state.private.conversations.items.find(row=>row.id===id);if(state.privateTabs?.length>=8 && !state.privateTabs.some(tab=>tab.id===id) && eligible(row,state.private.preferences))throw new Error('Conversation tab limit reached.');switchConversation(state,id);await refresh(binding);} )));
    root.querySelectorAll('[data-private-background]').forEach(button=>listen(button,'click',()=>act(async binding=>{const row=state.private.conversations.items.find(row=>row.id===button.dataset.privateBackground);if(!eligible(row,state.private.preferences) || state.privateTabs.some(tab=>tab.id===row.id))return;if(state.privateTabs.length>=8)throw new Error('Conversation tab limit reached.');state.privateTabs.push({id:row.id,name:row.peerName});state.privateContexts[row.id]=newContext(row,state.private.preferences);await refresh(binding);} )));
    root.querySelectorAll('[data-private-tab-close]').forEach(button=>listen(button,'click',()=>act(async binding=>{saveContext(state);const id=button.dataset.privateTabClose,context=state.privateContexts?.[id];if((context?.draft || Object.values(context?.reports || {}).some(Boolean)) && !confirm('Close this tab and discard its unsent draft?'))return;forgetConversation(state,id);if(state.privateSelected===id)switchConversation(state,state.privateTabs[0]?.id || null);await refresh(binding);} )));
    root.querySelectorAll('[data-private-page]').forEach(button=>listen(button,'click',()=>act(async binding=>{state.privateOffset=Number(button.dataset.privatePage);await refresh(binding);} )));
    root.querySelectorAll('[data-private-action]').forEach(button=>listen(button,'click',()=>command('POST',`/conversations/${state.private.selected.id}/${button.dataset.privateAction}`,{revision:state.private.messages.revision})));
    listen(root.querySelector('[data-private-block]'),'click',()=>command('POST',`/conversations/${state.private.selected.id}/block`,{revision:state.private.selected.blockRevision,blocked:!state.private.selected.blocked}));
    listen(root.querySelector('[data-private-read]'),'click',()=>{const latest=displayed(state)[0];if(latest)command('POST',`/conversations/${state.private.selected.id}/read`,{through:latest.position});});
    listen(root.querySelector('[data-private-clear]'),'click',()=>act(async binding=>{const ids=clearIds(state);if(ids.length>4096)throw new Error('Restore the display before clearing more messages.');state.privateDisplays[state.private.selected.id].ids=ids;await refresh(binding);}));
    listen(root.querySelector('[data-private-restore]'),'click',()=>act(async binding=>{state.privateDisplays[state.private.selected.id].ids=[];await refresh(binding);}));
    const compose=root.querySelector('[data-private-compose]');
    window.chatFormatting?.bindComposer(compose,()=>state.private===boundPrivate && root.querySelector('.messages-page')?.getAttribute('aria-busy')!=='true',state.privateContexts?.[boundPrivate?.selected?.id]);
    listen(compose?.querySelector('textarea'),'input',event=>{state.privateDraft=event.target.value;state.privateSendKey=null;});
    listen(compose?.querySelector('select[name="kind"]'),'input',event=>{state.privateKind=event.target.value;state.privateSendKey=null;});
    window.chatHistory?.bindComposer(compose,state.privateContexts?.[boundPrivate?.selected?.id],()=>state.private===boundPrivate && !state.privateSendKey && root.querySelector('.messages-page')?.getAttribute('aria-busy')!=='true');
    listen(compose,'submit',event=>{event.preventDefault();const id=state.private.selected.id,values=new FormData(event.currentTarget),body=values.get('body'),kind=values.get('kind') || 'text',requestKey=state.privateSendKey ||= `message_${crypto.randomUUID()}`;act(async binding=>{window.chatHistory?.record(state.privateContexts?.[id],requestKey,{body,kind});await api(binding,'POST',`${path}/conversations/${id}/messages`,{body,kind,requestKey});state.privateDraft='';state.privateSendKey=null;state.privatePages=[null];await refresh(binding);});});
    listen(root.querySelector('[data-private-older]'),'click',()=>act(async binding=>{state.privatePages ||= [null];state.privatePages.push(state.private.messages.nextBefore);await refresh(binding);}));
    listen(root.querySelector('[data-private-newest]'),'click',()=>act(async binding=>{state.privatePages=[null];await refresh(binding);}));
    root.querySelectorAll('[data-private-report]').forEach(form=>{
      listen(form.querySelector('textarea'),'input',event=>{state.privateReports ||= {};state.privateReports[form.dataset.privateReport]=event.target.value;});
      listen(form,'submit',event=>{event.preventDefault();command('POST',`/conversations/${state.private.selected.id}/messages/${form.dataset.privateReport}/report`,{reason:new FormData(form).get('reason')});});
    });
    const id=boundPrivate?.selected?.id,context=state.privateContexts?.[id],history=root.querySelector('.private-history');
    if(context && history){
      history.setAttribute('data-chat-scroll','');history.setAttribute('tabindex','0');history.setAttribute('aria-label','Conversation messages');
      const positions=new Map((boundPrivate.messages?.items || []).map(row=>[row.id,row.position]));
      history.querySelectorAll('[data-private-message]').forEach(row=>{row.dataset.chatPosition=positions.get(row.dataset.privateMessage);});
      window.chatScroll?.bind(history,context,state.privatePages?.at(-1) || 'latest',boundPrivate.messages?.items || [],()=>current() && state.privateContexts?.[id]===context);
    }
  }
  window.privateMessagesUI={load,view,bind,switchConversation,forgetConversation};
})();
