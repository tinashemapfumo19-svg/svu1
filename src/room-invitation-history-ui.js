(function () {
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function create() {
    const history=window.roomInvitationHistory.create(),selected=new Map(),bindings=new WeakMap();
    function reset(){history.reset();selected.clear();}
    function forgetRoom(roomId){history.forgetRoom(roomId);selected.delete(roomId);}
    function choice(descriptor){
      const contacts=history.contacts(descriptor);let key=selected.get(descriptor.roomId);
      if(!contacts.some(row=>row.key===key))key=contacts[0]?.key || '';
      if(key){selected.delete(descriptor.roomId);selected.set(descriptor.roomId,key);while(selected.size>32)selected.delete(selected.keys().next().value);}else selected.delete(descriptor.roomId);
      return {key,contacts};
    }
    const options=(contacts,key)=>contacts.length?contacts.map(row=>`<option value="${esc(row.key)}" ${row.key===key?'selected':''}>${esc(row.email)}</option>`).join(''):'<option value="">No attempts</option>';
    function render(descriptor){const {key,contacts}=choice(descriptor);return `<label class="field invitation-history-contact"><span>Contact history</span><select class="input" data-invitation-contact ${contacts.length?'':'disabled'}>${options(contacts,key)}</select></label><div data-invitation-history-controls>${history.controls({...descriptor,key})}</div>`;}
    function bindForm(form,{descriptor,current,request,send,onError=()=>{}}){
      if(!form || typeof current!=='function' || typeof request!=='function' || typeof send!=='function')return;
      descriptor={roomId:descriptor?.roomId,accountId:descriptor?.accountId};
      const field=form.querySelector('[name="email"]'),picker=form.querySelector('[data-invitation-contact]'),controls=form.querySelector('[data-invitation-history-controls]');if(!field || !picker || !controls)return;
      let checking=false,sending=false;
      const active=()=>form.isConnected && current()===true;
      function sync(){
        const {key,contacts}=choice(descriptor),locked=checking || sending || !active();picker.innerHTML=options(contacts,key);picker.value=key;picker.disabled=locked || !contacts.length;
        controls.innerHTML=history.controls({...descriptor,key});
        for(const button of controls.querySelectorAll('[data-command-history]'))if(locked)button.disabled=true;
        for(const button of form.elements)if(button.type==='submit')button.disabled=locked;
      }
      function snapshot(){const value=field.value,start=Number.isInteger(field.selectionStart)?Math.min(value.length,field.selectionStart):0,end=Number.isInteger(field.selectionEnd)?Math.min(value.length,field.selectionEnd):start;
        return {values:{email:value},focus:'email',start,end:Math.max(start,end)};
      }
      async function submit(){
        if(!active() || checking || sending)return;
        if(!field.value || field.value.length>254 || /[\x00-\x20\x7f]/.test(field.value)){onError(new Error('Provide one known contact mailbox.'));return;}
        const email=field.value,key=picker.value,requestKey=`room_${crypto.randomUUID()}`;checking=true;sync();
        try{
          const recorded=await history.attempt({...descriptor,email,requestKey},{request,current:active,unchanged:()=>field.value===email && picker.value===key});
          if(!recorded){if(active() && field.value===email && picker.value===key)onError(new Error('Invitation history changed.'));return;}
          if(!active() || field.value!==email)return;
          const recent=history.contacts(descriptor)[0];if(recent)selected.set(descriptor.roomId,recent.key);
          checking=false;sending=true;sync();await send({email,requestKey});
        }catch(error){if(active())onError(error);}
        finally{checking=false;sending=false;if(active())sync();}
      }
      form.addEventListener('submit',event=>{if(checking || sending){event.preventDefault();event.stopImmediatePropagation();}},true);
      picker.addEventListener('change',()=>{if(!active() || checking || sending)return;const contacts=history.contacts(descriptor);if(contacts.some(row=>row.key===picker.value))selected.set(descriptor.roomId,picker.value);sync();});
      field.addEventListener('input',()=>{if(active())sync();});
      form.addEventListener('click',async event=>{
        const button=event.target.closest?.('[data-command-history]');if(!button || !controls.contains(button) || button.matches(':disabled') || !active() || checking || sending)return;
        const key=picker.value,direction=button.dataset.commandHistory;
        if(direction==='clear'){history.clear({...descriptor,key});sync();return;}
        if(!['previous','next'].includes(direction))return;
        const draft=snapshot(),email=field.value;checking=true;sync();
        try{
          const recalled=await history.navigate({...descriptor,key,direction,draft},{request,current:active,unchanged:()=>field.value===email && picker.value===key});
          if(!recalled || !active() || field.value!==email || picker.value!==key)return;
          field.value=recalled.values.email;field.dispatchEvent(new Event('input',{bubbles:true}));field.setSelectionRange(recalled.start,recalled.end);field.focus({preventScroll:true});
        }catch(error){if(active())onError(error);}
        finally{checking=false;if(active())sync();}
      });
      bindings.set(form,{submit});sync();
    }
    function submit(form){return bindings.get(form)?.submit();}
    return {render,bindForm,submit,reset,forgetRoom};
  }
  window.roomInvitationHistoryUI={create};
})();
