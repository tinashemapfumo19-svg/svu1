(function () {
  const bindings=new WeakMap(),maximum=10000000;
  const position=value=>typeof value==='string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value)<=9223372036854775807n ? BigInt(value) : null;
  const bounded=value=>Number.isFinite(value) ? Math.min(maximum,Math.max(0,value)) : 0;
  function height(value) {
    if(value==='')return 300;
    return typeof value==='string' && /^\d{3}$/.test(value) && Number(value)>=120 && Number(value)<=900 ? Number(value) : 440;
  }
  function visible(node,binding) {
    return node.isConnected && binding.current() && !node.closest('[hidden]') && node.clientHeight>0;
  }
  function save(node) {
    const binding=bindings.get(node);if(!binding || !visible(node,binding))return;
    binding.page.top=bounded(node.scrollTop);
  }
  function apply(node) {
    const binding=bindings.get(node);if(!binding || !visible(node,binding))return;
    const {page,high}=binding;
    let increment=0;
    if(page.high!==null)for(const row of node.querySelectorAll('[data-chat-position]')){
      const next=position(row.dataset.chatPosition);
      if(next!==null && next>BigInt(page.high))increment+=bounded(row.getBoundingClientRect().height);
    }
    const end=bounded(node.scrollHeight-node.clientHeight);
    node.scrollTop=page.top===null ? end : Math.min(end,bounded(page.top+increment));
    page.top=bounded(node.scrollTop);
    if(high!==null && (page.high===null || high>BigInt(page.high)))page.high=String(high);
  }
  function visit(root,work) {
    if(root?.matches?.('[data-chat-scroll]'))work(root);
    else root?.querySelectorAll?.('[data-chat-scroll]').forEach(work);
  }
  function bind(node,context,key,rows,current) {
    if(!node || !context || typeof current!=='function' || typeof key!=='string' || key.length>19 || key!=='latest' && position(key)===null || !Array.isArray(rows) || rows.length>30)return;
    const pages=(context.historyScroll ||= {pages:[]}).pages;
    let page=pages.find(item=>item.key===key);
    if(page){pages.splice(pages.indexOf(page),1);pages.push(page);}
    else{page={key,top:null,high:null};pages.push(page);if(pages.length>8)pages.shift();}
    let high=null;for(const row of rows){const next=position(row.position);if(next!==null && (high===null || next>high))high=next;}
    bindings.set(node,{page,high,current});
    node.style?.setProperty('--chat-history-height',`${height(window.document?.querySelector('meta[name="svu-chat-history-height"]')?.content)}px`);
    apply(node);
    node.addEventListener('scroll',()=>save(node),{passive:true});
  }
  window.chatScroll={height,bind,capture:root=>visit(root,save),restore:root=>visit(root,apply)};
})();
