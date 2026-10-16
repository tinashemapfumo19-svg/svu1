(function () {
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function accountName(profile) {
    const id=profile?.account?.id,value=profile?.person?.preferredName;
    return typeof id==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) && typeof value==='string' && value.length<=200 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
  }
  function createTextRenderer(renderText,name) {
    if(typeof name!=='string' || !name || name.length>200 || /[\u0000-\u001f\u007f]/.test(name))return renderText;
    const literal=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('(https?:\\/\\/\\S+|<[^>]*>)|(^|[\\s,:;])('+literal+')(?=$|[\\s,:;])','giu');
    let mentions=0;
    return function text(value,allowed=true) {
      if(!allowed)return renderText(value,false);
      let html='',cursor=0;pattern.lastIndex=0;
      for(const match of value.matchAll(pattern)){
        html+=renderText(value.slice(cursor,match.index));
        if(match[1])html+=renderText(match[1],false);
        else{
          if(++mentions>128)throw new Error('name emphasis limit');
          // Account-name text remains literal inside the marker, never interpreted as an image or HTML.
          html+=renderText(match[2])+`<strong class="chat-own-name">${esc(match[3])}</strong>`;
        }
        cursor=match.index+match[0].length;
        if(html.length>32000)throw new Error('output limit');
      }
      html+=renderText(value.slice(cursor));if(html.length>32000)throw new Error('output limit');return html;
    };
  }
  window.chatNameEmphasis={accountName,createTextRenderer};
})();
