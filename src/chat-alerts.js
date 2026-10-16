(function () {
  const validId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const maximum=9223372036854775807n;
  const count=value=>typeof value==='string' && /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value)<=maximum;
  const label=value=>value>999n?'999+':String(value);
  const defaults=()=>Object.fromEntries(['window','sound','own'].map(name=>{const value=document.querySelector(`meta[name="svu-chat-${name}-alerts-default"]`)?.content;return [name,name==='sound'?value==='true':value!=='false'];}));
  let active=null;
  function cursorIdentity(cursor,id,entry) {
    try{const value=JSON.parse(atob(cursor.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));
      if(!value || value.v!==1 || value.a!==id || value.s!==JSON.stringify([entry.kind,entry.id]) || !count(value.p))throw new Error();
    }catch{throw Object.assign(new Error('Chat identity requires a fresh sign-in.'),{identityChanged:true});}
  }
  function preferences(id) {
    const fallback=defaults();if(!validId(id))return fallback;
    try{const raw=localStorage.getItem(`svu.messages.alerts.v1:${id}`);if(!raw || raw.length>128)return fallback;const value=JSON.parse(raw);
      if(value && !Array.isArray(value) && Object.keys(value).sort().join(',')==='own,sound,window' && Object.values(value).every(v=>typeof v==='boolean'))return value;
    }catch{}return fallback;
  }
  function save(id,value) {try{localStorage.setItem(`svu.messages.alerts.v1:${id}`,JSON.stringify(value));return true;}catch{return false;}}
  function consume(record,payload,options) {
    if(!payload || Object.keys(payload).sort().join(',')!=='cursor,others,own,reset' || typeof payload.cursor!=='string' || payload.cursor.length>1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(payload.cursor) || typeof payload.reset!=='boolean' || !count(payload.own) || !count(payload.others) || BigInt(payload.own)+BigInt(payload.others)>maximum)throw new Error('Invalid chat activity.');
    if(record.cursor===payload.cursor)return 0n;
    const initial=record.cursor===null;record.cursor=payload.cursor;
    if(initial || payload.reset){record.tab=0n;record.window=0n;return 0n;}
    const delta=BigInt(payload.others)+(options.own?BigInt(payload.own):0n);
    if(!options.shown)record.tab=record.tab+delta>maximum?maximum:record.tab+delta;
    if(options.inactive && options.window)record.window=record.window+delta>maximum?maximum:record.window+delta;
    return options.inactive && options.window?delta:0n;
  }
  function controls(id) {
    if(!validId(id))return '';
    const prefs=active?.id===id?active.prefs:preferences(id);
    return `<fieldset class="chat-alert-settings" aria-label="Chat alerts">${[['window','Window alerts'],['sound','Sound'],['own','Own messages']].map(([name,text])=>`<label class="check-option"><input type="checkbox" data-chat-alert-setting="${name}" ${prefs[name]?'checked':''}>${text}</label>`).join('')}<button type="button" class="icon-button" data-chat-alert-test aria-label="Test alert sound" title="Test alert sound">&#9834;</button><span data-chat-alert-audio role="status"></span><span data-chat-alert-status role="status" aria-live="polite"></span></fieldset>`;
  }
  function create(options) {
    const records=new Map(),listeners=[],oscillators=new Set(),requests=new Set(),prefs=preferences(options.id);
    let root=options.root,settings=options,disposed=false,polling=false,baselineNeeded=false,preferenceError=false,inactive=!document.hasFocus(),audio=null,audioState='Not ready',lastSound=0,lastTitle=null;
    const originalTitle=document.title;
    const current=()=>!disposed && settings.current();
    const listen=(target,event,callback)=>{target.addEventListener(event,callback);listeners.push([target,event,callback]);};
    const stopSound=()=>{for(const node of oscillators){try{node.stop();node.disconnect();}catch{}}oscillators.clear();};
    const closeSound=()=>{stopSound();const old=audio;audio=null;if(old)try{Promise.resolve(old.close()).catch(()=>{});}catch{}};
    function clearWindow(){for(const record of records.values())record.window=0n;paint();}
    function paint() {
      if(!current())return;
      let total=0n,pending=0n;const modes={private:0n,room:0n};
      for(const record of records.values()){total+=record.window;pending+=record.window>record.tab?record.window:record.tab;modes[record.kind]+=record.tab;}
      if(prefs.window && total){lastTitle=`(${label(total)}) South Valley University`;document.title=lastTitle;}
      else if(lastTitle && document.title===lastTitle){document.title=originalTitle;lastTitle=null;}
      for(const button of root.querySelectorAll('[data-private-tab-select],[data-room-tab-select],[data-message-mode]')){
        const mode=button.dataset.messageMode;
        const record=records.get(JSON.stringify([button.dataset.privateTabSelect?'private':'room',button.dataset.privateTabSelect || button.dataset.roomTabSelect]));
        const value=mode?(mode==='private'?modes.private:mode==='rooms'?modes.room:0n):record?.tab || 0n;
        let badge=button.querySelector('[data-chat-alert-badge]');
        if(!value && mode==='notifications'){badge?.remove();continue;}
        if(!badge){badge=document.createElement('span');badge.dataset.chatAlertBadge='';badge.className='chat-alert-badge';badge.setAttribute('aria-hidden','true');button.append(badge);}
        badge.dataset.empty=value?'false':'true';badge.textContent=label(value);badge.title=value?`${label(value)} new messages`:'';
        if(value)button.setAttribute('aria-description',badge.title);else button.removeAttribute('aria-description');
      }
      const status=root.querySelector('[data-chat-alert-status]');if(status)status.textContent=pending?`${label(pending)} new messages`:'';
      const sound=root.querySelector('[data-chat-alert-audio]');if(sound)sound.textContent=preferenceError?'Preference not saved':prefs.sound?audioState:'Muted';
      const test=root.querySelector('[data-chat-alert-test]');if(test)test.disabled=!prefs.sound || !prefs.window || audioState==='Unavailable';
    }
    async function unlock() {
      if(!current() || !prefs.sound || !prefs.window)return false;
      try{const Constructor=window.AudioContext || window.webkitAudioContext;if(!Constructor)throw new Error();
        const candidate=audio ||= new Constructor();await candidate.resume();
        if(!current() || audio!==candidate || !prefs.sound || !prefs.window)return false;
        audioState=candidate.state==='running'?'Ready':'Not ready';paint();return audioState==='Ready';
      }catch{if(current()){audioState='Unavailable';paint();}return false;}
    }
    function beep(force=false) {
      if(!current() || !prefs.sound || !prefs.window || audio?.state!=='running' || (!force && Date.now()-lastSound<1000))return;
      try{lastSound=Date.now();const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
        oscillator.frequency.value=660;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.06,now+.015);gain.gain.linearRampToValueAtTime(0,now+.12);
        oscillator.connect(gain);gain.connect(audio.destination);oscillators.add(oscillator);
        oscillator.onended=()=>{oscillators.delete(oscillator);oscillator.disconnect();gain.disconnect();};oscillator.start(now);oscillator.stop(now+.13);
      }catch{audioState='Unavailable';stopSound();paint();}
    }
    function sync() {
      if(!current()){dispose();return;}
      const entries=settings.entries().filter(entry=>validId(entry.id) && entry.context && typeof entry.context==='object' && ['private','room'].includes(entry.kind)).slice(0,16),keys=new Set();
      for(const entry of entries){const key=JSON.stringify([entry.kind,entry.id]);keys.add(key);let record=records.get(key);
        if(record?.ref!==entry.context){if(record)stopSound();record={kind:entry.kind,id:entry.id,ref:entry.context,cursor:null,version:0,tab:0n,window:0n};records.set(key,record);baselineNeeded=true;}
        if(settings.shown(entry)){record.tab=0n;if(!inactive && !document.hidden)record.window=0n;}
      }
      for(const key of records.keys())if(!keys.has(key)){records.delete(key);stopSound();}
      paint();return entries;
    }
    async function poll() {
      if(polling || !current() || settings.busy())return;
      const entries=sync();if(!entries)return;baselineNeeded=false;polling=true;
      try{for(const entry of entries){if(!current())break;const key=JSON.stringify([entry.kind,entry.id]),record=records.get(key),sent=record.cursor,version=record.version;
        const abort=new AbortController();requests.add(abort);
        try{const path=entry.kind==='private'?`/api/private-messages/conversations/${entry.id}/activity`:`/api/message-rooms/${entry.id}/activity`;
          const payload=await settings.request(`${path}${sent?`?cursor=${encodeURIComponent(sent)}`:''}`,abort.signal);
          if(!current() || records.get(key)!==record || record.cursor!==sent || record.version!==version || !settings.entries().some(row=>row.kind===entry.kind && row.id===entry.id && row.context===record.ref))continue;
          cursorIdentity(payload?.cursor,options.id,entry);
          const audible=consume(record,payload,{...prefs,shown:settings.shown(entry),inactive:inactive || document.hidden || !document.hasFocus()});record.errorStatus=null;if(audible)beep();
        }catch(error){if(!current())break;if(records.get(key)===record){record.cursor=null;record.version++;record.tab=0n;record.window=0n;stopSound();
          const status=error.identityChanged?'identity':error.statusCode || 'network';if(record.errorStatus!==status){record.errorStatus=status;settings.refused(entry,error);}
        }}
        finally{requests.delete(abort);}
      }}finally{polling=false;if(current())sync();else dispose();}
    }
    function bind() {
      for(const node of root.querySelectorAll('[data-chat-alert-setting]'))node.addEventListener('change',event=>{
        if(!node.isConnected || !current())return;const name=node.dataset.chatAlertSetting;if(!Object.hasOwn(prefs,name))return;
        if(name==='sound' && node.checked && !event.isTrusted){node.checked=prefs.sound;return;}prefs[name]=node.checked;
        if(name==='own'){stopSound();for(const record of records.values()){record.cursor=null;record.version++;record.tab=0n;record.window=0n;}}
        if(name==='window' && !prefs.window)for(const record of records.values())record.window=0n;
        if(!prefs.sound || !prefs.window)closeSound();else if(event.isTrusted)unlock();
        preferenceError=!save(options.id,prefs);paint();
      });
      root.querySelector('[data-chat-alert-test]')?.addEventListener('click',async event=>{if(!event.currentTarget.isConnected || !event.isTrusted || !current())return;if(await unlock())beep(true);});
    }
    function interaction(event){if(!current())return;if(!document.hidden){inactive=false;clearWindow();sync();}if(event.isTrusted)unlock();}
    listen(window,'focus',()=>{inactive=document.hidden;if(!inactive){clearWindow();sync();}});listen(window,'blur',()=>{inactive=true;});
    listen(document,'visibilitychange',()=>{inactive=document.hidden || !document.hasFocus();if(!inactive){clearWindow();sync();}poll();});
    listen(document,'pointerdown',interaction);listen(document,'keydown',interaction);listen(window,'hashchange',()=>{if(!current())dispose();});
    const timer=setInterval(poll,5000);
    function dispose(){if(disposed)return;disposed=true;clearInterval(timer);for(const request of requests)request.abort();requests.clear();for(const [target,event,callback] of listeners)target.removeEventListener(event,callback);closeSound();records.clear();
      root.querySelectorAll('[data-chat-alert-badge]').forEach(node=>node.remove());
      root.querySelectorAll('[data-private-tab-select],[data-room-tab-select],[data-message-mode]').forEach(node=>node.removeAttribute('aria-description'));
      root.querySelectorAll('[data-chat-alert-setting],[data-chat-alert-test]').forEach(node=>{node.disabled=true;});
      for(const name of ['status','audio']){const node=root.querySelector(`[data-chat-alert-${name}]`);if(node)node.textContent='';}
      if(lastTitle && document.title===lastTitle)document.title=originalTitle;
    }
    const scheduleBaseline=()=>{if(baselineNeeded && !settings.busy())Promise.resolve().then(poll);};
    const controller={id:options.id,key:options.key,prefs,dispose,poll,alive:()=>!disposed,attentive:()=>current() && !inactive && !document.hidden && document.hasFocus(),update(next){settings=next;root=next.root;bind();sync();scheduleBaseline();}};
    bind();sync();scheduleBaseline();return controller;
  }
  function unmount(){active?.dispose();active=null;}
  function mount(options){if(!validId(options.id) || !options.current()){unmount();return;}if(!active || !active.alive() || active.key!==options.key){unmount();active=create(options);}else active.update(options);}
  window.chatAlerts={mount,unmount,controls,preferences,consume,label,attentive:()=>active?.attentive() || false};
})();
