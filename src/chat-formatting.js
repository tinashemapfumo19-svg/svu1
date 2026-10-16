(function () {
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const colors={black:'#20282f',gray:'#526176',red:'#b4233b',green:'#237148',blue:'#245da8',teal:'#176a70',magenta:'#943776'};
  const tags={b:'strong',i:'em',u:'u',s:'s'};
  function link(value) {
    if(typeof value!=='string' || value.length>2000 || !/^https?:\/\//i.test(value) || /[\s\\<>"'\u0000-\u001f\u007f]/.test(value))return null;
    try{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;}catch{return null;}
  }
  function render(value,enabled=false,smileys=false,ownName='') {
    const source=String(value ?? ''),literal=esc(source);
    if(source.length>4000)return literal;
    try{
      const plainText=window.chatSmileys?.createTextRenderer(smileys) || esc;
      const text=window.chatNameEmphasis?.createTextRenderer(plainText,ownName) || plainText;
      if(!enabled)return text(source);
      if(!window.BbobParser?.parse)return literal;
      let nodes=0,failed=false;
      const tree=window.BbobParser.parse(source,{caseFreeTags:true,enableEscapeTags:false,onError:()=>{failed=true;}});
      function walk(list,depth=0,inLink=false) {
        if(!Array.isArray(list) || depth>12)throw new Error('tree limit');
        let raw='',html='',buffer='';
        const flush=()=>{if(buffer){raw+=buffer;html+=text(buffer,!inLink);buffer='';if(html.length>32000)throw new Error('output limit');}};
        for(const node of list){
          if(++nodes>1024)throw new Error('node limit');
          if(typeof node==='string'){buffer+=node;continue;}
          flush();
          const tag=node?.tag?.toLowerCase();
          if(!Object.hasOwn(tags,tag) && !['color','url'].includes(tag))throw new Error('unsupported tag');
          const {start,end,attrs}=node;
          if(!start || !end || ![start.from,start.to,end.from,end.to].every(Number.isInteger) || start.from<0 || start.to<=start.from || end.from<start.to || end.to>source.length)throw new Error('tag range');
          const open=source.slice(start.from,start.to),close=source.slice(end.from,end.to);
          if(close.toLowerCase()!==`[/${tag}]`)throw new Error('mismatched close');
          const entries=Object.entries(attrs || {}),child=walk(node.content,depth+1,inLink || tag==='url');
          let attribute=null;
          if(entries.length){
            if(entries.length!==1 || entries[0][0]!==entries[0][1] || typeof entries[0][1]!=='string')throw new Error('attributes');
            attribute=entries[0][1];
          }
          // Verify against original slices: parser recovery must never rewrite malformed input.
          const expected=attribute===null ? `[${tag}]` : `[${tag}=${attribute}]`,quoted=attribute===null ? expected : `[${tag}="${attribute}"]`;
          if(open.toLowerCase()!==expected.toLowerCase() && open.toLowerCase()!==quoted.toLowerCase())throw new Error('opening tag');
          raw+=open+child.raw+close;
          if(Object.hasOwn(tags,tag)){
            if(attribute!==null)throw new Error('style attributes');
            html+=`<${tags[tag]}>${child.html}</${tags[tag]}>`;
          }else if(tag==='color'){
            const color=Object.keys(colors).find(name=>name===attribute?.toLowerCase() || colors[name]===attribute?.toLowerCase());
            if(!color)throw new Error('color');
            html+=`<span class="chat-color-${color}">${child.html}</span>`;
          }else{
            const href=link(attribute ?? child.raw);
            if(inLink || !href)throw new Error('link');
            html+=`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${child.html}</a>`;
          }
          if(html.length>32000)throw new Error('output limit');
        }
        flush();return {raw,html};
      }
      const result=walk(tree);
      return !failed && result.raw===source && result.html.length<=32000 ? result.html : literal;
    }catch{return literal;}
  }
  function toolbar(disabled=false,context={},id='',historyDisabled=disabled) {
    const off=disabled?'disabled':'';
    return `<div class="chat-toolbar" role="toolbar" aria-label="Message formatting">${Object.entries({b:'Bold',i:'Italic',u:'Underline',s:'Strikethrough'}).map(([tag,label])=>`<button type="button" class="icon-button" data-chat-wrap="${tag}" title="${label}" aria-label="${label}" ${off}><${tags[tag]}>${tag.toUpperCase()}</${tags[tag]}></button>`).join('')}<div class="chat-swatches" role="group" aria-label="Text color">${Object.keys(colors).map(color=>`<button type="button" class="icon-button chat-swatch chat-color-${color}" data-chat-wrap="color" data-chat-color="${color}" title="${color[0].toUpperCase()+color.slice(1)} text" aria-label="${color[0].toUpperCase()+color.slice(1)} text" ${off}><span aria-hidden="true">&#9632;</span></button>`).join('')}</div>${window.chatHistory?.controls(context,historyDisabled) || ''}<details class="chat-link" data-room-detail-key="chat-link-${esc(id)}"><summary title="Insert link" aria-label="Insert link">&#8599;</summary><div><input class="input" data-chat-url name="formatLink" value="${esc(context.linkUrl || '')}" inputmode="url" maxlength="2000" aria-label="Link URL" placeholder="https://" ${off}><button type="button" class="icon-button" data-chat-wrap="url" title="Apply link" aria-label="Apply link" ${off}>&#10003;</button></div></details>${window.chatSmileys?.picker(disabled,id) || ''}<span class="chat-format-status" role="status"></span></div>`;
  }
  function bindComposer(form,current,context={}) {
    const field=form?.querySelector('textarea[name="body"]'),status=form?.querySelector('.chat-format-status');
    if(!field)return;
    const url=form.querySelector('[data-chat-url]');
    const selection=context.formatSelection;
    if(selection && Number.isInteger(selection.start) && Number.isInteger(selection.end))field.setSelectionRange(Math.max(0,Math.min(field.value.length,selection.start)),Math.max(0,Math.min(field.value.length,selection.end)));
    const remember=()=>{if(form.isConnected && current())context.formatSelection={start:field.selectionStart,end:field.selectionEnd};};
    for(const event of ['select','blur','input'])field.addEventListener(event,remember);
    field.addEventListener('input',()=>{if(form.isConnected && current() && status)status.textContent='';});
    url?.addEventListener('input',()=>{if(form.isConnected && current() && !url.matches(':disabled'))context.linkUrl=url.value;});
    window.chatSmileys?.bindComposer(form,current);
    function insert(button) {
      if(!form.isConnected || !current() || button.matches(':disabled') || field.matches(':disabled'))return;
      const tag=button.dataset.chatWrap,start=field.selectionStart,end=field.selectionEnd,selected=field.value.slice(start,end);
      let opening=`[${tag}]`,content=selected;
      if(tag==='color'){
        if(!Object.hasOwn(colors,button.dataset.chatColor))return;
        opening=`[color=${colors[button.dataset.chatColor]}]`;
      }else if(tag==='url'){
        const url=form.querySelector('[data-chat-url]')?.value,href=link(url);
        if(!href){status.textContent='Enter a valid HTTP(S) URL.';return;}
        opening=`[url=${href}]`;content=selected || href;
      }else if(!Object.hasOwn(tags,tag))return;
      const closing=`[/${tag}]`,replacement=opening+content+closing;
      if(field.value.length-(end-start)+replacement.length>4000){status.textContent='Message exceeds 4000 characters.';return;}
      field.setRangeText(replacement,start,end,'select');field.setSelectionRange(start+opening.length,start+opening.length+content.length);
      field.dispatchEvent(new Event('input',{bubbles:true}));status.textContent='';field.focus({preventScroll:true});
    }
    form.querySelectorAll('[data-chat-wrap]').forEach(button=>button.addEventListener('click',()=>insert(button)));
    form.querySelector('[data-chat-url]')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();insert(form.querySelector('[data-chat-wrap="url"]'));}});
  }
  function bindDisplay(root,checkbox,context,messages,current,smileyCheckbox,nameCheckbox,ownName='') {
    if(!context)return;
    const items=new Map((messages || []).map(message=>[message.id,message]));
    for(const [control,key] of [[checkbox,'formatted'],[smileyCheckbox,'smileys'],[nameCheckbox,'emphasizeName']])control?.addEventListener('change',()=>{
      if(!control.isConnected || !current() || control.matches(':disabled'))return;
      context[key]=control.checked;
      root.querySelectorAll('[data-chat-body]').forEach(node=>{
        const message=items.get(node.dataset.chatBody);
        if(message)node.innerHTML=message.hidden ? 'Hidden by moderation' : render(message.body,context.formatted,context.smileys,context.emphasizeName?ownName:'');
      });
    });
  }
  window.chatFormatting={render,toolbar,bindComposer,bindDisplay,link};
})();
