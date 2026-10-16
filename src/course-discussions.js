(function () {
  const esc=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=v=>window.svuUI.dateTime(v);
  window.bindCourseDiscussions=function(root,base){
    const token=window.svuSession.get()?.token;
    let data=null,id=null,loadedId=null,pages=[null],listPages=[null],busy=false,notice='';
    const active=()=>root.isConnected && token===window.svuSession.get()?.token;
    async function api(method,path,body){
      const response=await fetch(`${base}/discussions${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined ? undefined : JSON.stringify(body)});
      const value=await response.json();
      if(!active())throw new Error('Your course session changed.');
      if(!response.ok)throw new Error(value.error?.message || 'Discussion is unavailable.');
      return value.data;
    }
    async function load(){
      const before=(id ? pages : listPages).at(-1);
      if(id!==loadedId)data=null;
      data=await api('GET',`${id ? `/${id}` : ''}${before ? `?before=${encodeURIComponent(before)}` : ''}`);loadedId=id;
    }
    async function act(work){
      if(busy)return;busy=true;notice='';
      const drafts=Array.from(root.querySelectorAll('form')).map(form=>({action:form.dataset.discussionAction || 'compose',key:form.dataset.requestKey,values:Array.from(form.querySelectorAll('input,textarea')).map(el=>[el.name,el.value])}));
      root.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
      root.setAttribute('aria-busy','true');
      try{await work();}catch(error){if(active())notice=error.message;}
      finally{busy=false;if(active()){paint();if(notice)for(const draft of drafts){const form=Array.from(root.querySelectorAll('form')).find(f=>(f.dataset.discussionAction || 'compose')===draft.action);if(form){if(draft.key)form.dataset.requestKey=draft.key;draft.values.forEach(([name,value])=>{if(form.elements[name])form.elements[name].value=value;});}}}}
    }
    const reasonForm=(action,label)=>`<form data-discussion-action="${action}"><label class="field"><span>Reason</span><input class="input" name="reason" maxlength="2000" required></label><button class="button button-secondary" type="submit">${label}</button></form>`;
    function paint(){
      root.setAttribute('aria-busy','false');
      const thread=data?.thread;
      root.innerHTML=`<header><h3>Course discussions</h3><button class="icon-button" type="button" data-discussion-refresh title="Refresh discussions" aria-label="Refresh discussions">${window.svuShell?.glyphs?.refresh || '&#8635;'}</button></header>
        ${notice ? `<p class="notice" role="alert">${esc(notice)}</p>` : ''}
        ${!data ? '<button class="button button-secondary" data-discussion-refresh>Load discussions</button>' : thread ? `
          <button class="button button-secondary" data-discussion-back>All discussions</button><h4>${esc(thread.title)}</h4><p class="ui-meta">${thread.locked ? 'Locked' : 'Open'}</p>
          ${data.canManage ? reasonForm('lock',thread.locked ? 'Unlock discussion' : 'Lock discussion') : ''}
          <ol class="course-discussion-posts">${data.items.slice().reverse().map(post=>`<li data-discussion-post="${esc(post.id)}"><header><strong>${esc(post.authorName)}</strong><time datetime="${esc(post.createdAt)}">${esc(time(post.createdAt))}</time></header><p class="course-resource-description">${post.hidden ? 'Message hidden by lecturer.' : esc(post.body)}</p>
            ${data.canManage ? `${(post.reports || []).map(report=>`<p class="notice">Reported: ${esc(report.reason)}</p>`).join('')}<details><summary>Moderate message</summary>${reasonForm(`moderate:${post.id}`,post.hidden ? 'Restore message' : 'Hide message')}</details>` : post.reported ? '<p class="ui-meta">Reported</p>' : `<details><summary>Report message</summary>${reasonForm(`report:${post.id}`,'Submit report')}</details>`}</li>`).join('')}</ol>
          ${thread.locked ? '' : `<form data-discussion-compose><label class="field"><span>Reply</span><textarea class="input" name="body" rows="3" maxlength="4000" required></textarea></label><button class="button button-primary" type="submit">Post reply</button></form>`}` : `
          <ul class="course-discussion-list">${data.items.map(row=>`<li><button class="button button-secondary" data-discussion-open="${esc(row.id)}">${esc(row.title)}</button><span class="ui-meta">${row.locked ? 'Locked' : 'Open'} / ${esc(time(row.createdAt))}</span></li>`).join('')}</ul>${data.items.length ? '' : '<p class="ui-meta">No discussions yet.</p>'}
          <form data-discussion-compose><label class="field"><span>Discussion title</span><input class="input" name="title" maxlength="200" required></label><label class="field"><span>Message</span><textarea class="input" name="body" rows="3" maxlength="4000" required></textarea></label><button class="button button-primary" type="submit">Start discussion</button></form>`}
        ${data ? `<nav class="message-pagination" aria-label="Discussion pages"><button class="icon-button" data-discussion-newer ${(id ? pages : listPages).length<2 ? 'disabled' : ''} aria-label="Newer discussions or messages" title="Newer">&#8592;</button><span>Page ${(id ? pages : listPages).length}</span><button class="icon-button" data-discussion-older ${data.nextCursor ? '' : 'disabled'} aria-label="Older discussions or messages" title="Older">&#8594;</button></nav>` : ''}`;
      root.querySelectorAll('[data-discussion-refresh]').forEach(b=>b.onclick=()=>act(load));
      root.querySelector('[data-discussion-back]')?.addEventListener('click',()=>act(async()=>{id=null;await load();}));
      root.querySelectorAll('[data-discussion-open]').forEach(b=>b.onclick=()=>act(async()=>{id=b.dataset.discussionOpen;pages=[null];await load();}));
      root.querySelector('[data-discussion-newer]')?.addEventListener('click',()=>act(async()=>{(id ? pages : listPages).pop();await load();}));
      root.querySelector('[data-discussion-older]')?.addEventListener('click',()=>act(async()=>{(id ? pages : listPages).push(data.nextCursor);await load();}));
      root.querySelector('[data-discussion-compose]')?.addEventListener('submit',event=>{
        event.preventDefault();const form=event.target;
        const body={body:form.elements.body.value,requestKey:form.dataset.requestKey || (form.dataset.requestKey=crypto.randomUUID())};
        if(!id)body.title=form.elements.title.value;
        act(async()=>{const row=await api('POST',id ? `/${id}/reply` : '',body);id=row.id;pages=[null];await load();});
      });
      root.querySelector('[data-discussion-compose]')?.addEventListener('input',event=>{delete event.currentTarget.dataset.requestKey;});
      root.querySelectorAll('[data-discussion-action]').forEach(form=>form.addEventListener('submit',event=>{
        event.preventDefault();const [action,postId]=form.dataset.discussionAction.split(':');
        const value={reason:form.elements.reason.value};
        if(action==='lock'){value.locked=!thread.locked;value.revision=thread.revision;}
        if(action==='moderate'){const post=data.items.find(p=>p.id===postId);value.hidden=!post.hidden;value.revision=post.revision;}
        act(async()=>{await api('POST',`/${id}/${postId ? `posts/${postId}/${action}` : action}`,value);await load();});
      }));
      const history=root.querySelector('.course-discussion-posts');if(history)history.scrollTop=history.scrollHeight;
    }
    paint();act(load);
  };
})();
