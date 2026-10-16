(function(){
  let generation=0;
  window.addEventListener('hashchange',()=>{generation++;});window.svuSession.onChange(()=>{generation++;});
  const base='/api/fleet',kinds={vehicles:'Vehicles',drivers:'Drivers',trips:'Trips',fuel:'Fuel',service:'Service',incidents:'Incidents'};
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const label=value=>String(value ?? '').replaceAll('_',' '),date=value=>value ? window.svuUI.dateTime(value) : '';
  const localTime=(offset=0)=>new Date(Date.now()+offset-new Date().getTimezoneOffset()*60000).toISOString().slice(0,23);
  const today=()=>new Date().toISOString().slice(0,10);
  const field=(name,title,value='',attrs='')=>`<label class="field"><span>${esc(title)}</span><input class="input" name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const select=(name,title,rows,value='')=>`<label class="field"><span>${esc(title)}</span><select class="input" name="${name}" required><option value="">Select</option>${rows.map(row=>`<option value="${esc(row.id ?? row.code)}" ${(row.id ?? row.code)===value?'selected':''}>${esc(row.name ?? row.label)}</option>`).join('')}</select></label>`;
  const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${esc(value)}">`;
  const evidence=()=>field('evidenceReference','Evidence reference','','maxlength="200" required');
  const timestamp=(name,title,value=localTime())=>field(name,title,value,'type="datetime-local" step="0.001" required');
  const quantity=(name,title,value='')=>field(name,title,value,'inputmode="numeric" pattern="(?:0|[1-9][0-9]*)" maxlength="10" required');
  const details=()=>'<label class="field fleet-wide"><span>Restricted details</span><textarea class="input" name="details" maxlength="2000" required></textarea></label>';
  const choices=rows=>rows.map(row=>({id:row.id,name:row.registration}));
  function clear(state){for(const key of Object.keys(state))if(key.startsWith('fleet'))delete state[key];}
  function clearForRoute(state,event){let destination;try{destination=event?.newURL ? new URL(event.newURL).hash : location.hash;}catch{destination='';}
    if(!/^#registry\/fleet(?:\?|$)/.test(destination)){clear(state);return true;}return false;
  }
  function bound(state,rawApi){const current=generation,token=state.session?.token;
    const valid=()=>current===generation && token===state.session?.token && token===window.svuSession.get()?.token && /^#registry\/fleet(?:\?|$)/.test(location.hash);
    return {valid,async request(...args){if(!valid())throw new Error('Fleet context changed.');try{const result=await rawApi(...args);if(!valid())throw new Error('Fleet context changed.');return result;}catch(error){if(valid() && [401,403].includes(error.status))clear(state);throw error;}}};
  }
  function decimal(value,scale,max){
    if(typeof value!=='string' || !new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${scale}})?$`).test(value))throw new Error('Enter an exact non-negative decimal quantity.');
    const [whole,fraction='']=value.split('.'),result=BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0'));if(result>max)throw new Error('Quantity is too large.');return result.toString();
  }
  function body(action,raw){const result={...raw};for(const name of ['revision','readingRevision','meterRevision','targetMeterRevision'])if(result[name]!==undefined)result[name]=Number(result[name]);
    for(const name of ['lastEventId','targetEventId'])if(result[name]==='')result[name]=null;
    for(const name of ['validFrom','validUntil','plannedStart','plannedEnd','occurredAt'])if(result[name]!==undefined){const value=new Date(result[name]);if(!result[name] || !Number.isFinite(value.getTime()))throw new Error('Enter a valid date and time.');result[name]=value.toISOString();}
    if(action==='fuel'){result.volumeMillilitres=decimal(result.volumeLitres,3,1000000000n);result.paidMinor=decimal(result.paid,2,10000000000n);delete result.volumeLitres;delete result.paid;}
    if(action==='incident' && !result.tripId)result.tripId=null;return result;
  }
  const amount=(minor,scale=2)=>{const value=BigInt(minor ?? 0),factor=10n**BigInt(scale);return `${value/factor}.${String(value%factor).padStart(scale,'0')}`;};
  function page(target,data,offset=data?.offset || 0){const total=data?.total,more=total===undefined ? (data?.items?.length || 0)>=25 : offset+25<total;
    return `<div class="fleet-pages"><button class="icon-button" type="button" data-fleet-page="${target}" data-direction="-1" aria-label="Previous ${target} page" title="Previous ${target} page" ${!offset?'disabled':''}>&larr;</button><span>${total===undefined?`Page ${Math.floor(offset/25)+1}`:`${total?offset+1:0}-${Math.min(offset+25,total)} of ${total}`}</span><button class="icon-button" type="button" data-fleet-page="${target}" data-direction="1" aria-label="Next ${target} page" title="Next ${target} page" ${!more?'disabled':''}>&rarr;</button></div>`;
  }
  function panel(state,key,title,action,path,content){
    return `<details class="fleet-command" data-fleet-panel="${esc(key)}" ${state.fleetOpen?.[key]?'open':''}><summary>${esc(title)}</summary><form class="form form-grid" data-fleet-command="${action}" data-fleet-path="${esc(path)}" data-fleet-key="${esc(key)}"><fieldset class="fleet-command-fields" ${state.fleetPending?'disabled':''}>${content}<div><button class="button button-primary" type="submit">${esc(title)}</button></div></fieldset></form></details>`;
  }
  function picker(state,target,title,rows,filters){return `<details class="fleet-picker" data-fleet-panel="picker-${target}" ${state.fleetOpen?.[`picker-${target}`]?'open':''}><summary>${esc(title)}</summary><form class="form fleet-search" data-fleet-search="${target}">${field('q',title,filters?.q,'maxlength="200"')}<button class="icon-button" type="submit" title="Search ${esc(title)}" aria-label="Search ${esc(title)}">&#8981;</button></form>${page(target,rows,Number(filters?.offset || 0))}</details>`;}
  function createForm(state,d){const can=d.workspace.capabilities,kind=d.kind,vehicles=choices(d.vehicles?.items || []);if(!can.manage && kind!=='incidents' && !(kind==='service' && can.approve))return '';
    if(kind==='vehicles')return panel(state,'vehicle','Register vehicle','vehicle',`${base}/vehicles`,`${select('assetId','Institution asset',(d.references?.assets || []).map(row=>({id:row.id,name:`${row.assetTag} / ${row.name}`})))}${field('registration','Registration','','maxlength="40" required')}${field('description','Description','','maxlength="200" required')}${select('distanceUnit','Distance unit',[{id:'km',name:'Kilometres'},{id:'mi',name:'Miles'}])}${quantity('openingOdometer','Opening odometer')}${evidence()}`);
    if(kind==='drivers')return panel(state,'driver','Request driver authorisation','driver',`${base}/drivers`,`${select('staffId','Staff driver',(d.references?.staff || []).map(row=>({id:row.id,name:`${row.staffName} / ${row.employeeNumber}`})))}${timestamp('validFrom','Valid from')}${timestamp('validUntil','Valid until','')}${evidence()}`);
    if(kind==='trips')return panel(state,'trip','Request trip','trip',`${base}/trips`,`${select('vehicleId','Vehicle',vehicles)}${select('driverAuthorisationId','Approved driver',(d.drivers?.items || []).filter(row=>row.status==='approved' && !row.revoked && row.staffStatus==='active' && new Date(row.validUntil)>new Date()).map(row=>({id:row.authorisationId,name:`${row.staffName} / until ${date(row.validUntil)}`})))}${field('purpose','Purpose','','maxlength="500" required')}${field('destination','Destination','','maxlength="200" required')}${timestamp('plannedStart','Planned departure')}${timestamp('plannedEnd','Planned return','')}`);
    if(kind==='fuel')return panel(state,'fuel','Record fuel receipt','fuel',`${base}/fuel`,`${select('vehicleId','Vehicle',vehicles)}${field('receiptReference','Receipt reference','','maxlength="200" required')}${field('purchasedOn','Purchased on',today(),`type="date" min="1900-01-01" max="${today()}" required`)}${field('volumeLitres','Litres','','type="number" step="0.001" min="0.001" max="1000000" required')}${field('paid','Paid','','type="number" step="0.01" min="0" max="100000000" required')}${select('currency','Currency',d.references?.currencies || [])}${field('accountingReference','Accounting reference','','maxlength="200"')}`);
    if(kind==='service'){
      const vehicle=(d.vehicles?.items || []).find(row=>row.id===state.fleetServiceVehicleId),options=[];
      if(can.manage)options.push({id:'hold',name:'Safety hold'},{id:'service',name:'Service completed'});
      if(can.approve && vehicle?.serviceState==='hold' && vehicle.serviceHeldBy!==d.workspace.accountId)options.push({id:'release',name:'Release safety hold'});
      return panel(state,'service','Record service event','service',`${base}/vehicles/${vehicle?.id || ''}/service`,`${select('vehicleId','Vehicle',vehicles,state.fleetServiceVehicleId)}${select('kind','Event',options)}${hidden('revision',vehicle?.serviceRevision || 0)}${evidence()}`);
    }
    if(kind==='incidents' && can.incidents)return panel(state,'incident','Record incident','incident',`${base}/incidents`,`${select('vehicleId','Vehicle',vehicles)}<label class="field"><span>Trip</span><select class="input" name="tripId"><option value="">No trip</option>${(d.trips?.items || []).map(row=>`<option value="${esc(row.id)}" data-vehicle="${esc(row.vehicleId)}">${esc(row.registration)} / ${esc(row.purpose)}</option>`).join('')}</select></label>${timestamp('occurredAt','Occurred at')}${evidence()}${field('policyReference','Policy reference','','maxlength="200" required')}${field('retentionRule','Retention rule','','maxlength="500" required')}${details()}`);
    return '';
  }
  function rowCommands(state,d,row){const can=d.workspace.capabilities,actor=d.workspace.accountId,kind=d.kind;
    if(kind==='vehicles')return `${can.manage?panel(state,`vehicle-correction:${row.id}`,'Propose vehicle correction','vehicle-correction',`${base}/vehicles/${row.id}/corrections`,`${hidden('revision',row.definitionRevision)}${field('registration','Registration',row.registration,'maxlength="40" required')}${field('description','Description',row.description,'maxlength="200" required')}${evidence()}`):''}<button class="button button-secondary" type="button" data-fleet-corrections="${esc(row.id)}">Definition history</button><button class="button button-secondary" type="button" data-fleet-meters="${esc(row.id)}">Meter history</button>`;
    if(kind==='drivers')return `${row.status==='requested' && can.approve && ![row.requestedBy,row.driverAccountId].includes(actor) ? panel(state,`driver-decision:${row.id}`,'Decide driver request','driver-decision',`${base}/drivers/${row.id}/decision`,`${hidden('revision',row.revision)}${select('outcome','Decision',[{id:'approved',name:'Approve'},{id:'rejected',name:'Reject'}])}${evidence()}`):''}${row.status==='approved' && !row.revoked && can.approve ? panel(state,`revoke:${row.id}`,'Revoke driver authorisation','revoke',`${base}/authorisations/${row.authorisationId}/revoke`,evidence()):''}`;
    if(kind==='trips'){
      let result='';const event=(name,kind,reading=false)=>panel(state,`${kind}:${row.id}`,name,'trip-event',`${base}/trips/${row.id}/events`,`${hidden('revision',row.revision)}${hidden('kind',kind)}${reading?`${hidden('meterRevision',row.meterRevision ?? 0)}${quantity('odometer','Odometer')}${timestamp('occurredAt',kind==='dispatched'?'Departure time':'Return time')}`:''}${evidence()}`);
      if(row.status==='requested' && can.approve && ![row.requestedBy,row.driverAccountId].includes(actor))result+=panel(state,`decision:${row.id}`,'Decide trip','trip-event',`${base}/trips/${row.id}/events`,`${hidden('revision',row.revision)}${select('kind','Decision',[{id:'approved',name:'Approve'},{id:'rejected',name:'Reject'}])}${evidence()}`);
      if(can.manage && ['requested','approved'].includes(row.status))result+=event('Cancel trip','cancelled');
      if(can.manage && row.status==='approved')result+=event('Dispatch vehicle','dispatched',true);
      if(can.manage && row.status==='dispatched')result+=event('Record vehicle return','returned',true);
      return `${result}<button class="button button-secondary" type="button" data-fleet-history="${esc(row.id)}">Trip history</button>`;
    }
    if(kind==='fuel' && can.approve && !row.reversed && row.recordedBy!==actor)return panel(state,`reverse:${row.id}`,'Reverse fuel receipt','reverse',`${base}/fuel/${row.id}/reverse`,evidence());
    if(kind==='incidents')return `<button class="button button-secondary" type="button" data-fleet-incident="${esc(row.id)}">Open incident</button>`;
    return '';
  }
  function rowView(d,row){switch(d.kind){
    case 'vehicles':return `<strong>${esc(row.registration)} / ${esc(row.description)}</strong><span>${esc(row.assetTag)} / ${esc(label(row.assetStatus))} / ${esc(row.assetCondition)}</span><span>Meter ${esc(row.odometer)} ${esc(row.distanceUnit)} / Cumulative ${esc(row.cumulativeOdometer ?? row.odometer)} ${esc(row.distanceUnit)} / ${row.serviceState==='hold'?'Safety hold':'No safety hold'}${row.meterPending?' / Meter review pending':''}</span>`;
    case 'drivers':return `<strong>${esc(row.staffName)} / ${row.revoked?'Revoked':esc(label(row.status))}</strong><span>${esc(date(row.validFrom))} to ${esc(date(row.validUntil))}</span><span>${esc(row.evidenceReference)} / ${esc(row.staffStatus)}</span>`;
    case 'trips':return `<strong>${esc(row.registration)} / ${esc(row.purpose)}</strong><span>${esc(row.driverName)} / ${esc(row.destination)} / ${esc(label(row.status))}</span><span>${esc(date(row.plannedStart))} to ${esc(date(row.plannedEnd))}</span>`;
    case 'fuel':return `<strong>${esc(row.registration)} / ${esc(row.receiptReference)}${row.reversed?' / Reversed':''}</strong><span>${esc(row.purchasedOn)} / ${esc(amount(row.volumeMillilitres,3))} L / ${esc(row.currency)} ${esc(amount(row.paidMinor))}</span><span>${esc(row.accountingReference || '')}</span>`;
    case 'service':return `<strong>${esc(row.registration)} / ${esc(label(row.kind))}</strong><span>${esc(date(row.recordedAt))} / ${esc(row.evidenceReference)} / ${row.revision}</span>`;
    case 'incidents':return `<strong>${esc(row.registration)} / ${row.revision?'Resolved':'Open'}</strong><span>${esc(date(row.occurredAt))}</span>`;
  }}
  function meterView(state,d){const data=state.fleetMeters;if(!data || d.kind!=='vehicles')return '';const m=data.state,can=d.workspace.capabilities;
    const snapshot=`${hidden('lastEventId',m.lastEventId || '')}`,decision=(row,type)=>can.approve && row.status==='requested' && row.requestedBy!==d.workspace.accountId?panel(state,`${type}-decision:${row.id}`,'Decide meter record',`${type}-decision`,`${base}/${type==='meter'?'meter-changes':'reading-corrections'}/${row.id}/decision`,`${hidden('revision',row.revision)}${select('outcome','Decision',[{id:'approved',name:'Approve'},{id:'rejected',name:'Reject'}])}${evidence()}`):'';
    return `<section class="fleet-history fleet-meters"><header class="section-header"><h3>${esc(m.registration)} / Meter history</h3><button class="icon-button" type="button" data-fleet-close-meters aria-label="Close meter history" title="Close meter history">&times;</button></header><p>Period ${esc(m.meterRevision)} / Meter ${esc(m.odometer)} ${esc(m.distanceUnit)} / Cumulative ${esc(m.cumulativeOdometer)} ${esc(m.distanceUnit)}${m.pending?' / Review pending':''}</p>
      ${can.manage?panel(state,`meter-change:${data.vehicleId}`,'Propose meter change','meter-change',`${base}/vehicles/${data.vehicleId}/meters`,`${hidden('revision',m.meterRevision)}${hidden('readingRevision',m.readingRevision)}${snapshot}${select('kind','Operation',[{id:'replacement',name:'Replacement'},{id:'reset',name:'Reset'}])}${quantity('closingOdometer','Old meter closing reading',m.odometer)}${quantity('openingOdometer','New meter opening reading','0')}${field('meterReference','Meter reference','','maxlength="200" required')}${timestamp('occurredAt','Change time')}${evidence()}`):''}
      <h3>Meter changes</h3><ul class="fleet-list">${data.changes.items.map(row=>`<li data-fleet-meter-change="${esc(row.id)}"><strong>${esc(label(row.kind))} / ${esc(row.meterReference)} / ${esc(label(row.status))}</strong><span>Period ${esc(row.expectedRevision)} / Closing ${esc(row.closingOdometer)} / Opening ${esc(row.openingOdometer)} / ${esc(date(row.occurredAt))}</span><span>${esc(row.evidenceReference)}${row.decisionEvidence?` / ${esc(row.decisionEvidence)}`:''}</span>${decision(row,'meter')}</li>`).join('') || '<li>No meter changes.</li>'}</ul>${page('meterchanges',data.changes)}
      <h3>Retained readings</h3><ul class="fleet-list">${data.readings.items.map(row=>`<li data-fleet-reading="${esc(row.id)}"><strong>Period ${esc(row.targetMeterRevision)} / ${esc(label(row.targetKind))}${row.targetEventId?` / Event ${esc(row.targetEventId)}`:''}</strong><span>Original ${esc(row.originalOdometer)} / Effective ${esc(row.odometer)} ${esc(m.distanceUnit)}</span>${can.manage?panel(state,`reading-correction:${row.id}`,'Propose reading correction','reading-correction',`${base}/vehicles/${data.vehicleId}/readings`,`${hidden('revision',m.readingRevision)}${hidden('meterRevision',m.meterRevision)}${snapshot}${hidden('targetMeterRevision',row.targetMeterRevision)}${hidden('targetKind',row.targetKind)}${hidden('targetEventId',row.targetEventId || '')}${quantity('odometer','Correct reading',row.odometer)}${evidence()}`):''}</li>`).join('')}</ul>${page('readingtargets',data.readings)}
      <h3>Reading corrections</h3><ul class="fleet-list">${data.corrections.items.map(row=>`<li data-fleet-reading-correction="${esc(row.id)}"><strong>Period ${esc(row.targetMeterRevision)} / ${esc(row.targetKind)}${row.targetEventId?` / Event ${esc(row.targetEventId)}`:''} / ${esc(row.odometer)} / ${esc(label(row.status))}</strong><span>${esc(row.evidenceReference)}${row.decisionEvidence?` / ${esc(row.decisionEvidence)}`:''}</span>${decision(row,'reading')}</li>`).join('') || '<li>No reading corrections.</li>'}</ul>${page('readingcorrections',data.corrections)}</section>`;
  }
  function render(state){const d=state.fleet,pending=state.fleetPending;
    const toolbar='<button class="icon-button" type="button" data-fleet-refresh aria-label="Refresh fleet" title="Refresh fleet">&#8635;</button>';
    if(!d)return toolbar;
    const can=d.workspace.capabilities,kind=d.kind,filters=state.fleetFilters || {},incident=state.fleetIncident,history=state.fleetHistory,corrections=state.fleetCorrections;
    return `<section class="fleet-workspace"><div class="fleet-toolbar"><nav class="fleet-tabs" aria-label="Fleet records">${Object.entries(kinds).filter(([id])=>id!=='incidents' || can.incidents).map(([id,title])=>`<button type="button" class="fleet-tab ${kind===id?'is-active':''}" data-fleet-tab="${id}" aria-pressed="${kind===id}">${title}</button>`).join('')}</nav>${toolbar}</div>
      ${pending?`<div class="notice fleet-pending" role="status"><span>${esc(pending.label)}: response unavailable.</span><button class="button button-secondary" type="button" data-fleet-retry>Retry</button><button class="icon-button" type="button" data-fleet-discard aria-label="Discard pending fleet command" title="Discard pending command">&times;</button></div>`:''}
      <form class="form fleet-search" data-fleet-search="list">${field('q','Search records',filters.q || '','maxlength="200"')}<button class="icon-button" type="submit" title="Search fleet records" aria-label="Search fleet records">&#8981;</button></form>
      ${can.manage && ['vehicles','drivers'].includes(kind)?picker(state,'references',kind==='vehicles'?'Find institution asset':'Find staff driver',{items:kind==='vehicles'?d.references?.assets:d.references?.staff},state.fleetReferenceFilters):''}
      ${(can.manage || can.incidents || kind==='service' && can.approve) && ['trips','fuel','service','incidents'].includes(kind)?picker(state,'vehicles','Find vehicle',d.vehicles,state.fleetVehicleFilters):''}
      ${can.manage && kind==='trips'?picker(state,'drivers','Find approved driver',d.drivers,state.fleetDriverFilters):''}
      ${can.incidents && kind==='incidents'?picker(state,'trips','Find trip',d.trips,state.fleetTripFilters):''}
      ${createForm(state,d)}<header class="fleet-list-heading"><h2>${kinds[kind]}</h2><span>${d.list.total} records</span></header><ul class="fleet-list">${d.list.items.map(row=>`<li data-fleet-row="${esc(row.id)}">${rowView(d,row)}${rowCommands(state,d,row)}</li>`).join('') || '<li>No matching records.</li>'}</ul>${page('list',d.list)}
      ${history?`<section class="fleet-history"><header class="section-header"><h3>Trip history</h3><button class="icon-button" type="button" data-fleet-close-history aria-label="Close trip history" title="Close trip history">&times;</button></header><ol>${history.items.map(row=>`<li><strong>${esc(label(row.kind))}</strong><span>${esc(date(row.occurredAt || row.recordedAt))}${row.odometer!==null?` / Original ${esc(row.odometer)} / Effective ${esc(row.effectiveOdometer ?? row.odometer)} / Cumulative ${esc(row.cumulativeOdometer ?? row.odometer)} / Period ${esc(row.meterRevision ?? 0)}`:''} / ${esc(row.evidenceReference)}</span></li>`).join('') || '<li>No events.</li>'}</ol>${page('history',history)}</section>`:''}
      ${meterView(state,d)}
      ${corrections?`<section class="fleet-history fleet-corrections"><header class="section-header"><h3>Vehicle definition history</h3><button class="icon-button" type="button" data-fleet-close-corrections aria-label="Close definition history" title="Close definition history">&times;</button></header><p>Original / ${esc(corrections.original.registration)} / ${esc(corrections.original.description)} / ${esc(corrections.original.evidenceReference)}</p><ul class="fleet-list">${corrections.items.map(row=>`<li data-fleet-correction="${esc(row.id)}"><strong>${esc(row.registration)} / ${esc(row.description)} / ${esc(label(row.status))}</strong><span>Revision ${esc(row.expectedRevision)}${row.appliedRevision?` to ${esc(row.appliedRevision)}`:''} / ${esc(date(row.recordedAt))} / ${esc(row.evidenceReference)}</span>${row.decisionEvidence?`<span>${esc(date(row.decidedAt))} / ${esc(row.decisionEvidence)}</span>`:''}${can.approve && row.status==='requested' && row.requestedBy!==d.workspace.accountId?panel(state,`vehicle-correction-decision:${row.id}`,'Decide vehicle correction','vehicle-correction-decision',`${base}/vehicle-corrections/${row.id}/decision`,`${hidden('revision',row.revision)}${select('outcome','Decision',[{id:'approved',name:'Approve'},{id:'rejected',name:'Reject'}])}${evidence()}`):''}</li>`).join('') || '<li>No corrections.</li>'}</ul>${page('corrections',corrections)}</section>`:''}
      ${incident && can.incidents?`<section class="fleet-incident" data-fleet-incident-record="${esc(incident.id)}"><header class="section-header"><h3>Incident / ${incident.revision?'Resolved':'Open'}</h3><button class="icon-button" type="button" data-fleet-close-incident aria-label="Close incident" title="Close incident">&times;</button></header><p>${esc(date(incident.occurredAt))} / ${esc(incident.evidenceReference)}</p><p class="fleet-private-text">${esc(incident.details)}</p><dl><dt>Policy reference</dt><dd>${esc(incident.policyReference)}</dd><dt>Retention rule</dt><dd>${esc(incident.retentionRule)}</dd></dl>${incident.resolution?`<h4>Resolution</h4><p class="fleet-private-text">${esc(incident.resolution.details)}</p><p>${esc(incident.resolution.evidenceReference)}</p>`:panel(state,`resolve:${incident.id}`,'Resolve incident','resolve',`${base}/incidents/${incident.id}/resolve`,`${hidden('revision',incident.revision)}${details()}${evidence()}`)}</section>`:''}</section>`;
  }
  async function load(state,rawApi){const context=bound(state,rawApi),api=context.request;
    try{
      const workspace=await api('GET',base),can=workspace.capabilities,previous=state.fleet?.workspace.capabilities;
      if(previous && Object.keys(can).some(key=>previous[key] && !can[key])){delete state.fleetDrafts;delete state.fleetPending;delete state.fleetIncident;delete state.fleetIncidentId;delete state.fleetOpen;}
      const kind=state.fleetKind==='incidents' && !can.incidents?'vehicles':kinds[state.fleetKind]?state.fleetKind:'vehicles';
      const list=await api('GET',`${base}/${kind}?${new URLSearchParams(state.fleetFilters || {})}`),data={workspace,kind,list};
      if(can.manage && ['vehicles','drivers','fuel'].includes(kind))data.references=await api('GET',`${base}/references?${new URLSearchParams(state.fleetReferenceFilters || {})}`);
      if((can.manage || can.approve || can.incidents) && ['trips','fuel','service','incidents'].includes(kind))data.vehicles=await api('GET',`${base}/vehicles?${new URLSearchParams(state.fleetVehicleFilters || {})}`);
      if(can.manage && kind==='trips')data.drivers=await api('GET',`${base}/drivers?${new URLSearchParams(state.fleetDriverFilters || {})}`);
      if(can.incidents && kind==='incidents')data.trips=await api('GET',`${base}/trips?${new URLSearchParams(state.fleetTripFilters || {})}`);
      const history=kind==='trips' && state.fleetHistoryId ? await api('GET',`${base}/trips/${state.fleetHistoryId}/events?offset=${state.fleetHistoryOffset || 0}`):null;
      const incident=kind==='incidents' && can.incidents && state.fleetIncidentId ? await api('GET',`${base}/incidents/${state.fleetIncidentId}`):null;
      const corrections=kind==='vehicles' && state.fleetCorrectionsId?await api('GET',`${base}/vehicles/${state.fleetCorrectionsId}/corrections?offset=${state.fleetCorrectionsOffset || 0}`):null;
      const meters=kind==='vehicles' && state.fleetMetersId?await api('GET',`${base}/vehicles/${state.fleetMetersId}/meters?${new URLSearchParams(state.fleetMeterOffsets || {})}`):null;
      if(!context.valid())throw new Error('Fleet context changed.');state.fleet=data;state.fleetKind=kind;state.fleetHistory=history;state.fleetIncident=incident;state.fleetCorrections=corrections;state.fleetMeters=meters;
    }catch(error){if(context.valid()){delete state.fleet;delete state.fleetHistory;delete state.fleetIncident;delete state.fleetCorrections;delete state.fleetMeters;if([401,403].includes(error.status))clear(state);}throw error;}
  }
  function bind(root,state,{api:rawApi,act}){const context=bound(state,rawApi),api=context.request,refresh=()=>load(state,rawApi);
    const filters={list:'fleetFilters',references:'fleetReferenceFilters',vehicles:'fleetVehicleFilters',drivers:'fleetDriverFilters',trips:'fleetTripFilters'};
    root.querySelector('[data-fleet-refresh]')?.addEventListener('click',()=>act(refresh));
    root.querySelectorAll('[data-fleet-tab]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.fleetKind=button.dataset.fleetTab;state.fleetFilters={};delete state.fleetHistoryId;delete state.fleetIncidentId;delete state.fleetIncident;await refresh();})));
    root.querySelectorAll('[data-fleet-search]').forEach(form=>form.addEventListener('submit',event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));act(async()=>{state[filters[form.dataset.fleetSearch]]={...values,offset:'0'};await refresh();});}));
    root.querySelectorAll('[data-fleet-page]').forEach(button=>button.addEventListener('click',()=>act(async()=>{
      const target=button.dataset.fleetPage,direction=Number(button.dataset.direction);
      if(target==='history')state.fleetHistoryOffset=(state.fleetHistory?.offset || 0)+25*direction;
      else if(target==='corrections')state.fleetCorrectionsOffset=(state.fleetCorrections?.offset || 0)+25*direction;
      else if(['meterchanges','readingtargets','readingcorrections'].includes(target)){const key={meterchanges:'offset',readingtargets:'readingOffset',readingcorrections:'correctionOffset'}[target];state.fleetMeterOffsets={...state.fleetMeterOffsets,[key]:String(Number(state.fleetMeterOffsets?.[key] || 0)+25*direction)};}
      else{const key=filters[target];state[key]={...state[key],offset:String(Number(state[key]?.offset || 0)+25*direction)};}await refresh();
    })));
    root.querySelectorAll('[data-fleet-history]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.fleetHistoryId=button.dataset.fleetHistory;state.fleetHistoryOffset=0;await refresh();})));
    root.querySelector('[data-fleet-close-history]')?.addEventListener('click',()=>act(async()=>{delete state.fleetHistoryId;delete state.fleetHistory;await refresh();}));
    root.querySelectorAll('[data-fleet-corrections]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.fleetCorrectionsId=button.dataset.fleetCorrections;state.fleetCorrectionsOffset=0;await refresh();})));
    root.querySelector('[data-fleet-close-corrections]')?.addEventListener('click',()=>act(async()=>{delete state.fleetCorrectionsId;delete state.fleetCorrections;await refresh();}));
    root.querySelectorAll('[data-fleet-meters]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.fleetMetersId=button.dataset.fleetMeters;state.fleetMeterOffsets={};await refresh();})));
    root.querySelector('[data-fleet-close-meters]')?.addEventListener('click',()=>act(async()=>{delete state.fleetMetersId;delete state.fleetMeters;await refresh();}));
    root.querySelectorAll('[data-fleet-incident]').forEach(button=>button.addEventListener('click',()=>act(async()=>{state.fleetIncidentId=button.dataset.fleetIncident;await refresh();})));
    root.querySelector('[data-fleet-close-incident]')?.addEventListener('click',()=>act(async()=>{delete state.fleetIncidentId;delete state.fleetIncident;await refresh();}));
    root.querySelectorAll('[data-fleet-panel]').forEach(panel=>{
      const capture=()=>{if(panel.isConnected && context.valid()){state.fleetOpen ||= {};state.fleetOpen[panel.dataset.fleetPanel]=panel.open;}};
      // Capture disclosure intent before a repaint can replace its queued toggle event.
      panel.querySelector('summary')?.addEventListener('click',event=>{if(!panel.isConnected || !context.valid())return;event.preventDefault();panel.open=!panel.open;capture();});
      panel.addEventListener('toggle',capture);
    });
    async function send(pending){try{
      await api('POST',pending.path,pending.body);if(!context.valid())return;delete state.fleetPending;delete state.fleetDrafts?.[pending.formKey];await refresh();state.notice='Fleet command recorded.';
    }catch(error){if(context.valid() && error.status && error.status<500)delete state.fleetPending;throw error;}}
    root.querySelector('[data-fleet-retry]')?.addEventListener('click',()=>act(()=>send(state.fleetPending)));
    root.querySelector('[data-fleet-discard]')?.addEventListener('click',()=>act(async()=>{const pending=state.fleetPending;delete state.fleetPending;if(pending)delete state.fleetDrafts?.[pending.formKey];await refresh();state.notice='Pending fleet command discarded.';}));
    root.querySelectorAll('[data-fleet-command]').forEach(form=>{
      const key=form.dataset.fleetKey,draft=state.fleetDrafts?.[key];if(draft)for(const [name,value] of Object.entries(draft))if(form.elements[name] && form.elements[name].type!=='hidden')form.elements[name].value=value;
      const current=()=>form.isConnected && context.valid();
      const capture=()=>{if(!current())return;state.fleetDrafts ||= {};state.fleetDrafts[key]=Object.fromEntries(new FormData(form));};form.addEventListener('input',capture);form.addEventListener('change',capture);
      if(form.dataset.fleetCommand==='service')form.elements.vehicleId.addEventListener('change',()=>{if(current())act(async()=>{state.fleetServiceVehicleId=form.elements.vehicleId.value;await refresh();});});
      if(form.dataset.fleetCommand==='incident')form.elements.vehicleId.addEventListener('change',()=>{if(!current())return;for(const option of form.elements.tripId.options)if(option.value)option.disabled=option.dataset.vehicle!==form.elements.vehicleId.value;if(form.elements.tripId.selectedOptions[0]?.disabled)form.elements.tripId.value='';capture();});
      form.addEventListener('submit',event=>{event.preventDefault();if(!current() || state.busy || state.fleetPending)return;capture();let value,path=form.dataset.fleetPath;
        try{value=body(form.dataset.fleetCommand,state.fleetDrafts[key]);if(form.dataset.fleetCommand==='service'){const vehicle=state.fleet.vehicles.items.find(row=>row.id===value.vehicleId);if(!vehicle)throw new Error('Choose a current vehicle.');value.revision=vehicle.serviceRevision;path=`${base}/vehicles/${value.vehicleId}/service`;delete value.vehicleId;}value.requestKey=crypto.randomUUID();}
        catch(error){act(async()=>{throw error;});return;}
        state.fleetPending={path,body:value,formKey:key,label:form.querySelector('button[type="submit"]').textContent};act(()=>send(state.fleetPending));
      });
    });
  }
  window.fleetUI={load,render,bind,clear,clearForRoute,body,decimal};
})();
