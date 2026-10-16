(function () {
  const kinds=['text','action','notice'];
  const valid=value=>value && typeof value.body==='string' && value.body.length<=4000 && kinds.includes(value.kind);
  const state=context=>context?.composerHistory;
  function record(context,key,value) {
    if(!context || typeof key!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(key) || !valid(value))return false;
    const history=context.composerHistory ||= {entries:[],position:null,tail:null,lastKey:null};
    if(history.lastKey===key)return false;
    history.entries.push({key,body:value.body,kind:value.kind});
    if(history.entries.length>25)history.entries.shift();
    history.position=null;history.tail=null;history.lastKey=key;return true;
  }
  function position(context) {
    const history=state(context),length=history?.entries.length || 0,index=history?.position ?? null;
    return {length,index,previous:length>0 && (index===null || index>0),next:index!==null};
  }
  function navigate(context,direction,draft,allowed=kinds) {
    const history=state(context);if(!history || !history.entries.length || !['previous','next'].includes(direction) || !valid(draft))return null;
    const index=history.position;
    if(direction==='next' && index===null || direction==='previous' && index===0)return null;
    const target=direction==='previous' ? index===null ? history.entries.length-1 : index-1 : index+1;
    const value=target>=history.entries.length ? history.tail : history.entries[target];
    if(!valid(value) || !allowed.includes(value.kind))return null;
    if(index===null){
      const start=Number.isInteger(draft.start)?Math.max(0,Math.min(draft.body.length,draft.start)):draft.body.length;
      const end=Number.isInteger(draft.end)?Math.max(start,Math.min(draft.body.length,draft.end)):start;
      history.tail={body:draft.body,kind:draft.kind,start,end};
    }
    if(target>=history.entries.length){history.position=null;history.tail=null;return {...value};}
    history.position=target;return {body:value.body,kind:value.kind,start:value.body.length,end:value.body.length};
  }
  function clear(context) {
    if(!state(context))return;
    context.composerHistory={entries:[],position:null,tail:null,lastKey:null};
  }
  function controls(context,disabled=false) {
    const status=position(context),off=condition=>disabled || condition?'disabled':'';
    return `<div class="chat-history-controls" role="group" aria-label="Composer history"><button type="button" class="icon-button" data-chat-history="previous" aria-label="Previous submitted message" title="Previous submitted message" ${off(!status.previous)}>&#8592;</button><span class="chat-history-position" data-chat-history-position aria-label="Composer history position" title="${status.index===null?'Draft':'Submitted message'}">${status.index===null?0:status.index+1}/${status.length}</span><button type="button" class="icon-button" data-chat-history="next" aria-label="Next submitted message" title="Next submitted message" ${off(!status.next)}>&#8594;</button><button type="button" class="icon-button" data-chat-history="clear" aria-label="Clear composer history" title="Clear composer history" ${off(!status.length)}>&#9003;</button></div>`;
  }
  function bindComposer(form,context,current) {
    const field=form?.querySelector('textarea[name="body"]'),kind=form?.querySelector('select[name="kind"]');
    if(!field || !context)return;
    const ready=()=>form.isConnected && current() && !field.matches(':disabled') && !kind?.matches(':disabled');
    function draw() {
      const status=position(context),disabled=!ready(),counter=form.querySelector('[data-chat-history-position]');
      if(counter){counter.textContent=`${status.index===null?0:status.index+1}/${status.length}`;counter.title=status.index===null?'Draft':'Submitted message';}
      for(const button of form.querySelectorAll('[data-chat-history]'))button.disabled=disabled || (button.dataset.chatHistory==='previous'?!status.previous:button.dataset.chatHistory==='next'?!status.next:!status.length);
    }
    field.addEventListener('input',draw);kind?.addEventListener('input',draw);
    for(const button of form.querySelectorAll('[data-chat-history]'))button.addEventListener('click',()=>{
      if(!ready() || button.matches(':disabled'))return;
      const operation=button.dataset.chatHistory;
      if(operation==='clear'){clear(context);draw();field.focus({preventScroll:true});return;}
      const value=navigate(context,operation,{body:field.value,kind:kind?.value || 'text',start:field.selectionStart,end:field.selectionEnd},kind?[...kind.options].map(option=>option.value):['text']);
      if(!value)return;
      field.value=value.body;field.setSelectionRange(value.start,value.end);
      field.dispatchEvent(new Event('input',{bubbles:true}));
      if(kind && kind.value!==value.kind){kind.value=value.kind;kind.dispatchEvent(new Event('input',{bubbles:true}));}
      draw();field.focus({preventScroll:true});
    });
    draw();
  }
  window.chatHistory={record,position,navigate,clear,controls,bindComposer};
})();
