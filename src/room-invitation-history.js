(function () {
  const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const epoch=value=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const mailbox=value=>typeof value==='string' && value.length>0 && value.length<=254 && !/[\x00-\x20\x7f]/.test(value);
  const schema=[{name:'email',type:'text',max:254}];
  function create() {
    const history=window.chatCommandHistory.create(),contacts=new Map(),flights=new Map();let authority=null,generation=0;
    const key=(roomId,targetId)=>`room:${roomId}:invite:${targetId}`;
    function reset(){generation++;history.reset();contacts.clear();flights.clear();authority=null;}
    function erase(resource){history.forgetResource(resource);return contacts.delete(resource);}
    function forgetRoom(roomId){if(!identifier(roomId))return;generation++;for(const [resource,entry] of contacts)if(entry.roomId===roomId)erase(resource);for(const [id,flight] of flights)if(flight.roomId===roomId)flights.delete(id);}
    const owns=(entry,descriptor)=>entry && entry.roomId===descriptor.roomId && entry.meta.accountId===descriptor.accountId;
    function options(entry){return entry && authority?.accountId===entry.meta.accountId && authority.epoch===entry.meta.authorityEpoch
      ? {authority:{...authority},resource:{key:key(entry.roomId,entry.meta.targetId),epoch:entry.meta.epoch},schema,eligible:true,busy:false}:null;}
    function validate(meta,descriptor){
      if(!meta || Object.keys(meta).sort().join(',')!=='accountId,authorityEpoch,epoch,operations,targetId,targetType' || meta.accountId!==descriptor.accountId
        || !epoch(meta.authorityEpoch) || !epoch(meta.epoch) || !epoch(meta.targetId) || meta.targetType!=='invitation'
        || !Array.isArray(meta.operations) || meta.operations.length!==1 || meta.operations[0]!=='invite'){
        const error=new Error('Invitation history requires secure reconciliation.');error.invalidContext=true;throw error;
      }
      return {...meta,operations:['invite']};
    }
    function valid(descriptor,callbacks){return identifier(descriptor?.roomId) && identifier(descriptor.accountId) && typeof callbacks?.request==='function'
      && typeof callbacks.current==='function' && typeof callbacks.unchanged==='function';}
    async function run(descriptor,email,callbacks,work){
      if(!valid(descriptor,callbacks) || !mailbox(email) || callbacks.current()!==true)return null;
      const id=`${descriptor.accountId}:${descriptor.roomId}`;if(flights.has(id))return null;
      const flight={roomId:descriptor.roomId},started=generation;flights.set(id,flight);
      try{
        const response=await callbacks.request(email);
        if(started!==generation || callbacks.current()!==true)return null;
        const meta=validate(response,descriptor),authorityChanged=authority && (authority.accountId!==meta.accountId || authority.epoch!==meta.authorityEpoch);
        if(authorityChanged){generation++;history.reset();contacts.clear();authority={accountId:meta.accountId,epoch:meta.authorityEpoch};return null;}
        authority={accountId:meta.accountId,epoch:meta.authorityEpoch};
        const previous=[...contacts].find(([,entry])=>owns(entry,descriptor) && entry.email.toLowerCase()===email.toLowerCase());
        if(previous && (previous[1].meta.targetId!==meta.targetId || previous[1].meta.epoch!==meta.epoch)){erase(previous[0]);return null;}
        if(callbacks.unchanged()!==true)return null;
        return work(meta);
      }catch(error){
        if(started!==generation || callbacks.current()!==true)return null;
        if(error.invalidContext || [401,403].includes(error.statusCode))reset();
        else if([404,409].includes(error.statusCode))for(const [resource,entry] of contacts)if(owns(entry,descriptor) && entry.email.toLowerCase()===email.toLowerCase())erase(resource);
        throw error;
      }finally{if(flights.get(id)===flight)flights.delete(id);}
    }
    async function attempt(descriptor,callbacks){
      if(typeof descriptor?.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(descriptor.requestKey))return false;
      descriptor={roomId:descriptor.roomId,accountId:descriptor.accountId,email:descriptor.email,requestKey:descriptor.requestKey};
      const email=descriptor.email;
      return (await run(descriptor,email,callbacks,meta=>{
        const entry={roomId:descriptor.roomId,email,meta},resource=key(descriptor.roomId,meta.targetId);
        if(!history.record({...options(entry),requestKey:descriptor.requestKey,values:{email}}))return false;
        contacts.delete(resource);contacts.set(resource,entry);
        while(contacts.size>32)erase(contacts.keys().next().value);
        return true;
      }))===true;
    }
    async function navigate(descriptor,callbacks){
      descriptor={...descriptor};
      const entry=contacts.get(descriptor?.key);if(!owns(entry,descriptor) || !['previous','next'].includes(descriptor.direction))return null;
      const draft=descriptor.draft;
      if(!draft || Array.isArray(draft) || Object.keys(draft).sort().join(',')!=='end,focus,start,values' || !draft.values || Array.isArray(draft.values) || Object.keys(draft.values).join(',')!=='email'
        || typeof draft.values.email!=='string' || draft.values.email.length>254 || draft.focus!=='email' || !Number.isInteger(draft.start) || !Number.isInteger(draft.end)
        || draft.start<0 || draft.end<draft.start || draft.end>draft.values.email.length)return null;
      const snapshot=JSON.stringify(descriptor.draft);
      return run(descriptor,entry.email,callbacks,meta=>{
        if(contacts.get(descriptor.key)!==entry || meta.targetId!==entry.meta.targetId || JSON.stringify(descriptor.draft)!==snapshot)return null;
        return history.navigate({...options(entry),direction:descriptor.direction,draft:descriptor.draft});
      });
    }
    function list(descriptor){
      if(!identifier(descriptor?.roomId) || !identifier(descriptor.accountId))return [];
      const result=[];
      for(const [resource,entry] of contacts){if(!owns(entry,descriptor))continue;const context=options(entry);
        if(!context || !history.position(context).length){erase(resource);continue;}
        result.push({key:resource,email:entry.email});
      }
      return result.reverse();
    }
    function busy(descriptor){return identifier(descriptor?.roomId) && identifier(descriptor.accountId) && flights.has(`${descriptor.accountId}:${descriptor.roomId}`);}
    function controls(descriptor){const entry=contacts.get(descriptor?.key),context=owns(entry,descriptor)?options(entry):null;return history.controls(context?{...context,busy:busy(descriptor)}:null);}
    function clear(descriptor){const entry=contacts.get(descriptor?.key);return owns(entry,descriptor) && !busy(descriptor)?erase(descriptor.key):false;}
    return {attempt,navigate,contacts:list,controls,clear,busy,reset,forgetRoom};
  }
  window.roomInvitationHistory={create};
})();
