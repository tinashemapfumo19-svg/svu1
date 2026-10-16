import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function setup(state={session:{token:'current'}},globals={}){const listeners={},sessionListeners=[],location={hash:'#registry/fleet'},window={addEventListener:(name,fn)=>listeners[name]=fn,svuSession:{get:()=>state.session,onChange:fn=>sessionListeners.push(fn)}};
  vm.runInNewContext(readFileSync(new URL('../src/fleet.js',import.meta.url),'utf8'),{window,location,URLSearchParams,URL,...globals});return {ui:window.fleetUI,listeners,sessionListeners,location,state};}
const workspace={accountId:'a',capabilities:{manage:false,approve:false,incidents:false}},list={items:[],total:0,offset:0,limit:25};
test('fleet UI exact decimal conversion preserves millilitres and minor units',()=>{
  const {ui}=setup();assert.equal(ui.decimal('12.345',3,1000000000n),'12345');assert.equal(ui.decimal('78.90',2,10000000000n),'7890');
  for(const value of ['1e3','1.2345','-1','01.0',''])assert.throws(()=>ui.decimal(value,3,1000000000n));
  const body=ui.body('fuel',{volumeLitres:'0.001',paid:'0.01',currency:'USD'});assert.equal(body.volumeMillilitres,'1');assert.equal(body.paidMinor,'1');assert.equal(body.volumeLitres,undefined);
});
test('late fleet reads cannot restore another route or account state',async()=>{
  for(const departure of ['route','session']){const {ui,listeners,sessionListeners,location,state}=setup();let release;
    const work=ui.load(state,()=>new Promise(resolve=>{release=resolve;}));
    if(departure==='route'){location.hash='#home';listeners.hashchange();}else{state.session={token:'new'};sessionListeners[0]();}
    state.fleet={marker:'new context'};release(workspace);await assert.rejects(work,/context changed/);assert.equal(state.fleet.marker,'new context');
  }
});
test('denied fleet reads clear incident data, drafts, pending commands and all fleet caches',async()=>{
  const {ui,state}=setup();Object.assign(state,{fleetIncident:{details:'PRIVATE'},fleetDrafts:{details:'PRIVATE'},fleetPending:{body:'PRIVATE'}});
  await assert.rejects(ui.load(state,async()=>{throw Object.assign(new Error('Denied'),{status:403});}),/Denied/);
  assert.deepEqual(Object.keys(state),['session']);
});
test('lost incident capability drops restricted drafts and pending context before fallback collection',async()=>{
  const {ui,state}=setup();Object.assign(state,{fleetKind:'incidents',fleet:{workspace:{capabilities:{incidents:true}}},fleetIncidentId:'i',fleetIncident:{details:'PRIVATE'},fleetDrafts:{details:'PRIVATE'},fleetPending:{body:'PRIVATE'}});
  const calls=[];await ui.load(state,async(method,path)=>{calls.push(path);return path==='/api/fleet'?workspace:list;});
  assert.equal(state.fleetKind,'vehicles');assert.equal(state.fleetDrafts,undefined);assert.equal(state.fleetPending,undefined);assert.equal(calls.some(path=>path.includes('/incidents')),false);assert.doesNotMatch(ui.render(state),/PRIVATE/);
});
test('review-only fleet UI exposes independent service release without operational commands',()=>{
  const {ui,state}=setup();state.fleetServiceVehicleId='v';state.fleet={kind:'service',workspace:{accountId:'reviewer',capabilities:{manage:false,approve:true,incidents:false}},list,vehicles:{items:[{id:'v',registration:'TEST',serviceState:'hold',serviceHeldBy:'other',serviceRevision:2}]}};
  const html=ui.render(state);assert.match(html,/Release safety hold/);assert.doesNotMatch(html,/Safety hold<\/option>/);assert.doesNotMatch(html,/Service completed/);
});
test('fleet rendered data is escaped and current pending commands freeze editable forms',()=>{
  const {ui,state}=setup();state.fleetPending={label:'<pending>'};state.fleet={kind:'vehicles',workspace:{capabilities:{manage:true}},list:{...list,items:[{id:'v',registration:'<img onerror="bad">',description:'<private>',odometer:'1',serviceState:'hold'}]},references:{assets:[]}};
  const html=ui.render(state);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img onerror/);assert.match(html,/fleet-command-fields" disabled/);assert.match(html,/data-fleet-retry/);
});
test('observed fleet departure clears drafts even when the browser already returned to Fleet',()=>{
  const {ui,state,location}=setup();Object.assign(state,{fleetDrafts:{details:'PRIVATE'},fleetPending:{body:'PRIVATE'},fleetIncident:{details:'PRIVATE'}});
  assert.equal(location.hash,'#registry/fleet');assert.equal(ui.clearForRoute(state,{newURL:'http://localhost/#home'}),true);assert.deepEqual(Object.keys(state),['session']);
  state.fleet={marker:'current'};assert.equal(ui.clearForRoute(state,{newURL:'http://localhost/#registry/fleet'}),false);assert.equal(state.fleet.marker,'current');
});
test('delayed old-form events cannot restore cleared fleet drafts or submit commands',()=>{
  for(const departure of ['route','session','detached']){
    const {ui,state,listeners,sessionListeners}=setup(undefined,{FormData:class{*[Symbol.iterator](){yield ['accountingReference','PRIVATE OLD DRAFT'];}}});
    const events={},form={dataset:{fleetKey:'fuel',fleetCommand:'fuel'},elements:{},isConnected:true,addEventListener:(name,fn)=>events[name]=fn};
    const root={querySelector:()=>null,querySelectorAll:selector=>selector==='[data-fleet-command]'?[form]:[]};let actions=0;
    ui.bind(root,state,{api:()=>{},act:()=>{actions++;}});events.input();assert.equal(state.fleetDrafts.fuel.accountingReference,'PRIVATE OLD DRAFT');
    ui.clear(state);if(departure==='route')listeners.hashchange();else if(departure==='session'){state.session={token:'replacement'};sessionListeners[0]();}else form.isConnected=false;
    events.change();events.input();events.submit({preventDefault(){}});assert.equal(state.fleetDrafts,undefined);assert.equal(state.fleetPending,undefined);assert.equal(actions,0);
  }
});
test('fleet disclosure activation retains open state synchronously and ignores obsolete toggles',()=>{
  const {ui,state,listeners}=setup(),events={},summary={addEventListener:(name,fn)=>events[name]=fn};
  const panel={dataset:{fleetPanel:'vehicle-correction:v'},isConnected:true,open:false,querySelector:()=>summary,addEventListener:(name,fn)=>events[name]=fn};
  const root={querySelector:()=>null,querySelectorAll:selector=>selector==='[data-fleet-panel]'?[panel]:[]};
  ui.bind(root,state,{api:()=>{},act:()=>{}});let prevented=false;events.click({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(panel.open,true);assert.equal(state.fleetOpen['vehicle-correction:v'],true);
  assert.match(ui.render({...state,fleet:{kind:'vehicles',workspace:{capabilities:{manage:true}},list:{...list,items:[{id:'v',registration:'TEST',description:'Vehicle',definitionRevision:0}]},references:{assets:[]}}}),/data-fleet-panel="vehicle-correction:v" open/);
  ui.clear(state);listeners.hashchange();events.toggle();assert.equal(state.fleetOpen,undefined);
});
test('meter UI preserves bigint identities and shows physical, cumulative and retained readings separately',()=>{
  const {ui,state}=setup();const body=ui.body('reading-correction',{revision:'3',meterRevision:'2',targetMeterRevision:'0',lastEventId:'9223372036854775807',targetEventId:'',targetKind:'opening',odometer:'900'});
  assert.equal(body.revision,3);assert.equal(body.meterRevision,2);assert.equal(body.lastEventId,'9223372036854775807');assert.equal(body.targetEventId,null);
  state.fleet={kind:'vehicles',workspace:{accountId:'a',capabilities:{manage:true,approve:true}},list,references:{assets:[]}};
  state.fleetMeters={vehicleId:'v',state:{registration:'<meter>',distanceUnit:'km',meterRevision:1,readingRevision:3,odometer:'25',cumulativeOdometer:'1125',lastEventId:'9'},changes:{...list,items:[{id:'m',kind:'replacement',meterReference:'<reference>',status:'requested',requestedBy:'a',revision:0}]},readings:{...list,items:[{id:'trip:9',targetKind:'trip',targetMeterRevision:1,targetEventId:'9',originalOdometer:'30',odometer:'25'}]},corrections:list};
  const html=ui.render(state);assert.match(html,/Meter 25 km \/ Cumulative 1125 km/);assert.match(html,/Original 30 \/ Effective 25 km/);assert.match(html,/&lt;reference&gt;/);assert.doesNotMatch(html,/data-fleet-panel="meter-decision:m"/);
});
