(function () {
  const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const epoch=value=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  const forbidden=/(?:requestkey|revision|token|password|credential|secret|authorization|cookie|disclos|consent)|^(?:url|method|suffix|enabled|epoch|accountId|sessionId|resourceId|targetId|membershipId|messageId|reportId|scope|permissions?)$/i;
  const exact=(value,keys)=>object(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
  function fields(schema) {
    if(!Array.isArray(schema) || !schema.length || schema.length>16)return null;
    const names=new Set();
    for(const field of schema){
      if(!object(field) || !identifier(field.name) || forbidden.test(field.name) || names.has(field.name))return null;
      names.add(field.name);
      if(field.type==='text'){
        if(!exact(field,['name','type','max']) || !Number.isInteger(field.max) || field.max<1 || field.max>4000)return null;
      }else if(field.type==='choice'){
        if(!exact(field,['name','type','choices']) || !Array.isArray(field.choices) || !field.choices.length || field.choices.length>16
          || field.choices.some(choice=>!identifier(choice)) || new Set(field.choices).size!==field.choices.length)return null;
      }else return null;
    }
    return schema;
  }
  function values(input,schema) {
    if(!exact(input,schema.map(field=>field.name)))return null;
    const result={};let size=0;
    for(const field of schema){
      const value=input[field.name];
      if(typeof value!=='string' || (field.type==='text'?value.length>field.max:!field.choices.includes(value)))return null;
      size+=value.length;if(size>8192)return null;
      Object.defineProperty(result,field.name,{value,enumerable:true,writable:true,configurable:true});
    }
    return result;
  }
  function draft(input,schema) {
    if(!exact(input,['values','focus','start','end']))return null;
    const copy=values(input.values,schema),field=schema.find(field=>field.name===input.focus);
    if(!copy || !field || !Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start<0 || input.end<input.start
      || input.end>copy[field.name].length || field.type==='choice' && (input.start!==0 || input.end!==0))return null;
    return {values:copy,focus:input.focus,start:input.start,end:input.end};
  }
  const copyDraft=value=>({values:{...value.values},focus:value.focus,start:value.start,end:value.end});
  const size=slot=>slot.entries.reduce((sum,row)=>sum+Object.values(row.values).reduce((n,value)=>n+value.length,0),0)
    +(slot.tail?Object.values(slot.tail.values).reduce((n,value)=>n+value.length,0):0);
  function create() {
    let owner=null;const slots=new Map();
    function reset(){slots.clear();owner=null;}
    function reconcile(authority) {
      if(!exact(authority,['accountId','epoch']) || !identifier(authority.accountId) || !epoch(authority.epoch)){reset();return false;}
      const key=JSON.stringify([authority.accountId,authority.epoch]);
      if(owner!==key){slots.clear();owner=key;}
      return true;
    }
    function get(options,make=false) {
      if(!object(options) || !reconcile(options.authority))return null;
      const resource=options.resource;
      if(!exact(resource,['key','epoch']) || typeof resource.key!=='string' || !/^[A-Za-z0-9_:-]{1,400}$/.test(resource.key) || !epoch(resource.epoch))return null;
      let slot=slots.get(resource.key);
      if(slot && slot.epoch!==resource.epoch){slots.delete(resource.key);slot=null;}
      if(options.eligible!==true){slots.delete(resource.key);return null;}
      if(options.busy!==false || !fields(options.schema))return null;
      if(!slot && make){slot={epoch:resource.epoch,entries:[],position:null,tail:null};slots.set(resource.key,slot);}
      if(slot){slots.delete(resource.key);slots.set(resource.key,slot);}
      return slot;
    }
    function bound(current) {
      while(slots.size>32)slots.delete(slots.keys().next().value);
      while([...slots.values()].reduce((sum,slot)=>sum+size(slot),0)>131072){
        const first=slots.keys().next().value,slot=slots.get(first);
        if(slot!==current || slot.entries.length<2)slots.delete(first);
        else {slot.entries.shift();if(slot.position!==null)slot.position=Math.max(0,slot.position-1);}
      }
    }
    function record(options) {
      if(!object(options) || !identifier(options.requestKey) || !fields(options.schema))return false;
      const input=values(options.values,options.schema);if(!input)return false;
      const slot=get(options,true);if(!slot || slot.entries.some(row=>row.key===options.requestKey))return false;
      slot.entries.push({key:options.requestKey,values:input});if(slot.entries.length>25)slot.entries.shift();
      slot.position=null;slot.tail=null;bound(slot);return true;
    }
    function position(options) {
      const slot=get(options),length=slot?.entries.length || 0,index=slot?.position ?? null;
      return {length,index,previous:length>0 && (index===null || index>0),next:index!==null};
    }
    function navigate(options) {
      if(!object(options) || !['previous','next'].includes(options.direction) || !fields(options.schema))return null;
      const currentDraft=draft(options.draft,options.schema);if(!currentDraft)return null;
      const slot=get(options);if(!slot || !slot.entries.length)return null;
      const index=slot.position;
      if(options.direction==='next' && index===null || options.direction==='previous' && index===0)return null;
      const target=options.direction==='previous'?(index===null?slot.entries.length-1:index-1):index+1;
      const tail=target>=slot.entries.length;
      const input=tail?draft(slot.tail,options.schema):values(slot.entries[target].values,options.schema);
      if(!input)return null;
      if(index===null)slot.tail=currentDraft;
      if(tail){slot.position=null;slot.tail=null;return copyDraft(input);}
      slot.position=target;
      const focus=options.schema.find(field=>field.type==='text')?.name || options.schema[0].name;
      const end=options.schema.find(field=>field.name===focus).type==='text'?input[focus].length:0;
      bound(slot);
      // Returned intent has no request identity, authority, transport, revision or consent.
      return {values:{...input},focus,start:end,end};
    }
    function clear(options){const slot=get(options);if(!slot)return false;slot.entries=[];slot.position=null;slot.tail=null;return true;}
    function forgetResource(key){if(typeof key!=='string')return false;return slots.delete(key);}
    function controls(options) {
      const status=options?position(options):{length:0,index:null,previous:false,next:false},off=condition=>condition?'disabled':'';
      return `<div class="chat-history-controls" role="group" aria-label="Command history"><button type="button" class="icon-button" data-command-history="previous" aria-label="Previous attempted command" title="Previous attempted command" ${off(!status.previous)}>&#8592;</button><span class="chat-history-position" data-command-history-position>${status.index===null?0:status.index+1}/${status.length}</span><button type="button" class="icon-button" data-command-history="next" aria-label="Next attempted command" title="Next attempted command" ${off(!status.next)}>&#8594;</button><button type="button" class="icon-button" data-command-history="clear" aria-label="Clear command history" title="Clear command history" ${off(!status.length)}>&#9003;</button></div>`;
    }
    function bindForm(form,{context,refresh,current,onError=()=>{},resetOnError=true}) {
      if(!form || typeof context!=='function' || typeof refresh!=='function' || typeof current!=='function')return;
      let checking=false,remembered=null;
      const fieldFor=name=>[...form.elements].find(field=>field.name===name);
      function remember(field=form.ownerDocument.activeElement) {
        const item=context()?.schema?.find(item=>item.name===field?.name);if(!item)return;
        remembered={name:item.name,start:Number.isInteger(field.selectionStart)?field.selectionStart:0,end:Number.isInteger(field.selectionEnd)?field.selectionEnd:0};
      }
      function ready(options) {
        return form.isConnected && current()===true && options?.busy===false && options?.eligible===true && fields(options.schema)
          && options.schema.every(item=>{const field=fieldFor(item.name);return field && !field.matches(':disabled') && (item.type==='text'
            ? ['text','email','textarea'].includes(field.type)
            : field.type==='select-one' && item.choices.every(choice=>[...field.options].some(option=>option.value===choice && !option.disabled)));});
      }
      function draw() {
        const options=context(),status=options?position(options):{length:0,index:null,previous:false,next:false},disabled=checking || !ready(options);
        const counter=form.querySelector('[data-command-history-position]');if(counter)counter.textContent=`${status.index===null?0:status.index+1}/${status.length}`;
        for(const button of form.querySelectorAll('[data-command-history]'))button.disabled=disabled || (button.dataset.commandHistory==='previous'?!status.previous:button.dataset.commandHistory==='next'?!status.next:!status.length);
        for(const button of form.elements)if(button.type==='submit')button.disabled=disabled;
      }
      form.addEventListener('submit',event=>{if(checking){event.preventDefault();event.stopImmediatePropagation();}},true);
      for(const field of form.elements){field.addEventListener('input',draw);for(const event of ['focus','blur','select','keyup','pointerup'])field.addEventListener(event,()=>remember(field));}
      remember();
      for(const button of form.querySelectorAll('[data-command-history]')){
        button.addEventListener('pointerdown',()=>remember());
        button.addEventListener('click',async()=>{
        const before=context();if(checking || button.matches(':disabled') || !ready(before))return;
        const direction=button.dataset.commandHistory;
        if(direction==='clear'){clear(before);draw();return;}
        if(!['previous','next'].includes(direction))return;
        const beforeValues=Object.fromEntries(before.schema.map(item=>[item.name,fieldFor(item.name).value]));
        remember();checking=true;draw();
        try {
          const options=await refresh();
          if(!ready(options) || options.authority?.accountId!==before.authority?.accountId || options.authority?.epoch!==before.authority?.epoch
            || options.resource?.key!==before.resource?.key || options.resource?.epoch!==before.resource?.epoch){
            if(options){reconcile(options.authority);get(options);}return;
          }
          remember();
          const focused=options.schema.find(item=>item.name===remembered?.name) || options.schema.find(item=>item.type==='text') || options.schema[0];
          const field=fieldFor(focused.name),input=Object.fromEntries(options.schema.map(item=>[item.name,fieldFor(item.name).value]));
          if(JSON.stringify(input)!==JSON.stringify(beforeValues))return;
          const start=focused.type==='text'?Math.min(field.value.length,remembered?.name===focused.name?remembered.start:0):0;
          const end=focused.type==='text'?Math.max(start,Math.min(field.value.length,remembered?.name===focused.name?remembered.end:start)):0;
          const value=navigate({...options,direction,draft:{values:input,focus:focused.name,start,end}});
          if(!value)return;
          for(const item of options.schema){const node=fieldFor(item.name);node.value=value.values[item.name];node.dispatchEvent(new Event('input',{bubbles:true}));}
          const target=fieldFor(value.focus);if(['text','textarea'].includes(target.type))target.setSelectionRange(value.start,value.end);target.focus({preventScroll:true});
        }catch(error){if(resetOnError)reset();if(form.isConnected && current()===true)onError(error);}
        finally{checking=false;if(form.isConnected && current()===true)draw();}
        });
      }
      draw();
      return {sync:draw};
    }
    return {record,position,navigate,clear,reconcile,reset,controls,bindForm,forgetResource};
  }
  window.chatCommandHistory={create};
})();
