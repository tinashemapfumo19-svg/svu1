(function () {
  const key=accountId=>typeof accountId==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(accountId) ? `svu.messages.presentation.v1:${accountId}` : null;
  const initial=()=>document.querySelector('meta[name="svu-messages-start-minimized"]')?.content==='true';
  function read(accountId) {
    const name=key(accountId);if(!name)return initial();
    try {
      const raw=localStorage.getItem(name);if(raw && raw.length>64)return initial();
      const value=JSON.parse(raw || 'null');
      if(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===1 && typeof value.minimized==='boolean')return value.minimized;
    }catch { /* Display preferences must not prevent access when storage is unavailable. */ }
    return initial();
  }
  function write(accountId,minimized) {
    const name=key(accountId);if(!name || typeof minimized!=='boolean')return false;
    try {localStorage.setItem(name,JSON.stringify({minimized}));return true;}catch{return false;}
  }
  window.messagePresentation={read,write};
})();
