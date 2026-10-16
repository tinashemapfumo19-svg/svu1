(function () {
  const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const epoch=value=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const actions={member:['remove','ban','unban','promote','demote'],message:['hide','restore']};
  function create() {
    const history=window.chatCommandHistory.create(),cache=new Map(),bindings=new WeakMap();let authority=null,generation=0;
    const key=descriptor=>`room:${descriptor.roomId}:${descriptor.type}:${descriptor.targetId}${descriptor.type==='message'?`:${descriptor.operation}`:''}`;
    function reset(){generation++;history.reset();cache.clear();authority=null;}
    function forgetRoom(id){generation++;for(const [resource,entry] of cache)if(entry.roomId===id){history.forgetResource(resource);cache.delete(resource);}}
    function validate(data,descriptor) {
      if(!data || Object.keys(data).sort().join(',')!=='accountId,authorityEpoch,epoch,operations,revision,targetId,targetType'
        || data.accountId!==descriptor.accountId || data.targetId!==descriptor.targetId || data.targetType!==descriptor.type || !epoch(data.authorityEpoch) || !epoch(data.epoch)
        || !Number.isSafeInteger(data.revision) || data.revision<(descriptor.type==='member'?1:0) || data.revision>2147483646
        || !Array.isArray(data.operations) || !data.operations.length || data.operations.length>3 || new Set(data.operations).size!==data.operations.length
        || data.operations.some(operation=>!actions[descriptor.type].includes(operation))){
          const error=new Error('Room command context requires secure reconciliation.');error.invalidContext=true;throw error;
        }
      return data;
    }
    function options(form,descriptor,meta,busy=false) {
      if(!meta || !authority || meta.accountId!==authority.accountId || meta.authorityEpoch!==authority.epoch || Number(form.dataset.revision)!==meta.revision)return null;
      const reason=`reason_${descriptor.targetId}`,schema=[{name:reason,type:'text',max:2000}];
      if(descriptor.type==='member'){
        const select=form.querySelector('[name="operation"]'),choices=[...select.options].filter(option=>!option.disabled && meta.operations.includes(option.value)).map(option=>option.value);
        if(!choices.length)return null;schema.unshift({name:'operation',type:'choice',choices});
      }else if(!meta.operations.includes(descriptor.operation))return null;
      return {authority:{...authority},resource:{key:key(descriptor),epoch:meta.epoch},schema,eligible:true,busy};
    }
    function controls(descriptor) {
      const entry=cache.get(key(descriptor));
      const form={dataset:{revision:descriptor.revision},querySelector(){return {options:(descriptor.operations || []).map(value=>({value,disabled:false}))};}};
      return history.controls(options(form,descriptor,entry?.meta));
    }
    function bindForm(form,{descriptor,current,request,send,onError,onInvalidate=()=>{}}) {
      if(!form || !identifier(descriptor?.roomId) || !identifier(descriptor.accountId) || !identifier(descriptor.targetId) || !actions[descriptor.type]
        || descriptor.type==='message' && !actions.message.includes(descriptor.operation) || typeof current!=='function' || typeof request!=='function' || typeof send!=='function')return;
      const resource=key(descriptor);let meta=cache.get(resource)?.meta || null,preparing=false,submitting=false,adapter=null;
      const active=()=>form.isConnected && current()===true;
      const context=()=>active()?options(form,descriptor,meta,preparing || submitting):null;
      const input=()=>Object.fromEntries([...(descriptor.type==='member'?['operation']:[]),`reason_${descriptor.targetId}`].map(name=>[name,form.querySelector(`[name="${name}"]`).value]));
      function sync(){adapter?.sync();if(!adapter)for(const button of form.elements){if(button.type==='submit')button.disabled=preparing || submitting;else if(button.dataset?.commandHistory)button.disabled=true;}}
      function bind(){if(adapter)return;adapter=history.bindForm(form,{context,refresh:prepare,current:active,onError,resetOnError:false});}
      function clearDraft(all=false){onInvalidate(descriptor,all);const field=form.querySelector(`[name="reason_${descriptor.targetId}"]`);if(field){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));}}
      async function prepare() {
        if(!active() || preparing || submitting)return null;
        const started=generation;preparing=true;sync();
        try{
          const fresh=await request(descriptor);if(!active() || started!==generation)return null;validate(fresh,descriptor);
          const authorityChanged=authority && (authority.accountId!==fresh.accountId || authority.epoch!==fresh.authorityEpoch);
          const localChanged=meta && (meta.epoch!==fresh.epoch || meta.authorityEpoch!==fresh.authorityEpoch);
          if(authorityChanged){generation++;history.reset();cache.clear();}
          authority={accountId:fresh.accountId,epoch:fresh.authorityEpoch};
          if(authorityChanged || localChanged){history.forgetResource(resource);clearDraft(!!authorityChanged);}
          meta=fresh;cache.delete(resource);cache.set(resource,{roomId:descriptor.roomId,meta});
          while(cache.size>32){const oldest=cache.keys().next().value;history.forgetResource(oldest);cache.delete(oldest);}
          if(descriptor.type==='member')for(const option of form.querySelector('[name="operation"]').options)option.disabled=!fresh.operations.includes(option.value);
          preparing=false;bind();const result=context();
          if(!result)throw new Error('Room command changed. Refresh the room before continuing.');
          return result;
        }catch(error){
          if(!active() || started!==generation)return null;
          if(error.invalidContext || [401,403].includes(error.statusCode)){reset();meta=null;clearDraft(true);}
          else if([404,409].includes(error.statusCode)){history.forgetResource(resource);cache.delete(resource);meta=null;clearDraft();}
          throw error;
        }
        finally{preparing=false;if(active())sync();}
      }
      async function submit() {
        if(!active() || preparing || submitting)return;
        const before=input(),previous=meta;
        try{
          const fresh=await prepare();if(!fresh || !active() || JSON.stringify(before)!==JSON.stringify(input()))return;
          if(previous && (previous.epoch!==meta.epoch || previous.authorityEpoch!==meta.authorityEpoch))return;
          const operation=descriptor.type==='member'?before.operation:descriptor.operation;
          if(!meta.operations.includes(operation))throw new Error('That room command is no longer available.');
          const requestKey=`room_${crypto.randomUUID()}`;
          if(!history.record({...fresh,requestKey,values:before}))throw new Error('Room command intent requires secure reconciliation.');
          submitting=true;sync();
          await send({requestKey,revision:meta.revision,operation,reason:before[`reason_${descriptor.targetId}`]});
        }catch(error){if(active())onError(error);}
        finally{submitting=false;if(active())sync();}
      }
      bindings.set(form,{submit});
      form.addEventListener('submit',event=>{if(preparing || submitting){event.preventDefault();event.stopImmediatePropagation();}},true);
      form.addEventListener('focusin',event=>{if(!active() || preparing || submitting || !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;prepare().catch(error=>{if(active())onError(error);});});
      if(meta)bind();
      sync();
    }
    function submit(form){return bindings.get(form)?.submit();}
    return {controls,bindForm,submit,reset,forgetRoom};
  }
  window.roomCommandHistoryUI={create};
})();
