import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/chat-command-history.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){const window={};runInNewContext(source,{window,Event:class {constructor(type,options){this.type=type;this.bubbles=options.bubbles;}}});return window.chatCommandHistory.create();}
const authority={accountId:'account_a',epoch:'a'.repeat(43)},resource={key:'room:r1:member:m1',epoch:'b'.repeat(43)};
const schema=[{name:'operation',type:'choice',choices:['ban','remove']},{name:'reason',type:'text',max:2000}];
const base=()=>({authority:{...authority},resource:{...resource},schema:structuredClone(schema),eligible:true,busy:false});
const values=(reason='Written reason',operation='ban')=>({operation,reason});
const draft=(reason='Unfinished draft',start=2,end=5)=>({values:values(reason,'remove'),focus:'reason',start,end});

test('structured recall retains exact attempted fields, excludes replay metadata and deduplicates frozen retries',()=>{
  const ui=fixture(),options=base(),input=values('  /ban literal\n[b]reason[/b]  ');
  assert.equal(ui.record({...options,requestKey:'old',values:input}),true);input.reason='mutated';
  assert.equal(ui.record({...options,requestKey:'new',values:values('Second')}),true);
  assert.equal(ui.record({...options,requestKey:'old',values:values('Retry incorrectly edited')}),false);
  assert.equal(ui.position(options).length,2);
  const recalled=ui.navigate({...options,direction:'previous',draft:draft()});
  assert.deepEqual(Object.keys(recalled).sort(),['end','focus','start','values']);
  assert.deepEqual(plain(recalled.values),values('Second'));
  assert.deepEqual(plain(ui.navigate({...options,direction:'previous',draft:draft()}).values),values('  /ban literal\n[b]reason[/b]  '));
});

test('navigation restores the complete unfinished draft and selection, and recalled edits do not rewrite history',()=>{
  const ui=fixture(),options=base(),tail=draft();ui.record({...options,requestKey:'first',values:values('First')});ui.record({...options,requestKey:'second',values:values('Second')});
  assert.equal(ui.navigate({...options,direction:'next',draft:tail}),null);
  const recent=ui.navigate({...options,direction:'previous',draft:tail});assert.deepEqual(plain(recent),{values:values('Second'),focus:'reason',start:6,end:6});
  recent.values.reason='Edit recalled';
  assert.deepEqual(plain(ui.navigate({...options,direction:'previous',draft:draft('Edit recalled')})).values,values('First'));
  assert.equal(ui.navigate({...options,direction:'previous',draft:tail}),null);
  assert.deepEqual(plain(ui.navigate({...options,direction:'next',draft:tail}).values),values('Second'));
  assert.deepEqual(plain(ui.navigate({...options,direction:'next',draft:tail})),tail);
  assert.deepEqual(plain(ui.position(options)),{length:2,index:null,previous:true,next:false});
});

test('authority and target epochs drop histories across account, session, permission and retained target lifetimes',()=>{
  for(const change of [o=>o.authority.accountId='account_b',o=>o.authority.epoch='c'.repeat(43),o=>o.resource.epoch='d'.repeat(43)]){
    const ui=fixture(),options=base();ui.record({...options,requestKey:'first',values:values()});ui.navigate({...options,direction:'previous',draft:draft()});
    const other=base();change(other);assert.equal(ui.position(other).length,0);assert.equal(ui.position(options).length,0);
  }
  const ui=fixture(),options=base();ui.record({...options,requestKey:'first',values:values()});
  assert.equal(ui.navigate({...options,resource:{...resource,key:'room:r2:member:m1'},direction:'previous',draft:draft()}),null);
  assert.equal(ui.position(options).length,1);
  assert.equal(ui.position({...options,eligible:false}).length,0);assert.equal(ui.position(options).length,0);
  ui.record({...options,requestKey:'new',values:values()});assert.equal(ui.reconcile({accountId:'account_a',epoch:'invalid'}),false);assert.equal(ui.position(options).length,0);
});

test('busy or frozen commands refuse navigation, recording and clearing without erasing current history',()=>{
  const ui=fixture(),options=base();ui.record({...options,requestKey:'first',values:values()});const locked={...options,busy:true};
  assert.equal(ui.navigate({...locked,direction:'previous',draft:draft()}),null);assert.equal(ui.record({...locked,requestKey:'new',values:values()}),false);assert.equal(ui.clear(locked),false);
  assert.equal(ui.position(options).length,1);assert.equal(ui.position({...options,busy:undefined}).length,0);assert.equal(ui.position(options).length,1);
});

test('current field shape and choice eligibility are checked before changing navigation or cached tail',()=>{
  const ui=fixture(),options=base();ui.record({...options,requestKey:'first',values:values()});const narrowed={...options,schema:[{name:'operation',type:'choice',choices:['remove']},schema[1]]};
  assert.equal(ui.navigate({...narrowed,direction:'previous',draft:draft()}),null);assert.equal(ui.position(options).index,null);
  assert.equal(ui.navigate({...options,direction:'previous',draft:{...draft(),start:-1}}),null);
  ui.navigate({...options,direction:'previous',draft:draft()});
  const changed={...options,schema:[schema[0],{name:'reason',type:'text',max:2}]};assert.equal(ui.navigate({...changed,direction:'next',draft:draft('x',0,1)}),null);
  assert.equal(ui.position(options).index,0);assert.deepEqual(plain(ui.navigate({...options,direction:'next',draft:draft()})),draft());
});

test('unsafe fields, confirmation state, unknown values and malformed schemas cannot enter history',()=>{
  const ui=fixture(),options=base();
  for(const name of ['requestKey','revision','token','url','method','suffix','disclose','consent','enabled','reportDisclose_m1','accessToken','password','sessionId','epoch'])assert.equal(ui.record({...options,schema:[{name,type:'text',max:100}],requestKey:'test',values:{[name]:'unsafe'}}),false);
  for(const altered of [[],[{name:'reason',type:'checkbox'}],[schema[1],schema[1]],[{name:'reason',type:'text',max:4001}],[{name:'operation',type:'choice',choices:['ban','ban']}]])assert.equal(ui.record({...options,schema:altered,requestKey:'test',values:values()}),false);
  for(const value of [{...values(),revision:1},values('x'.repeat(2001)),values('reason','promote'),{operation:'ban',reason:true}])assert.equal(ui.record({...options,requestKey:'test',values:value}),false);
  assert.equal(ui.position(options).length,0);
});

test('entries, independent target slots and combined retained text have hard memory bounds',()=>{
  const ui=fixture(),options=base();for(let i=0;i<30;i++)ui.record({...options,requestKey:`key_${i}`,values:values(String(i))});assert.equal(ui.position(options).length,25);
  for(let i=0;i<25;i++)ui.navigate({...options,direction:'previous',draft:draft()});assert.equal(ui.navigate({...options,direction:'previous',draft:draft()}),null);
  for(let i=0;i<33;i++)ui.record({...options,resource:{...resource,key:`target:${i}`},requestKey:'first',values:values()});assert.equal(ui.position({...options,resource:{...resource,key:'target:0'}}).length,0);
  assert.equal(ui.position({...options,resource:{...resource,key:'target:32'}}).length,1);
  const big=fixture(),large=[{name:'reason',type:'text',max:4000}];for(let i=0;i<50;i++)big.record({...options,schema:large,resource:{...resource,key:`target:${i}`},requestKey:'first',values:{reason:'x'.repeat(4000)}});
  assert.equal(big.position({...options,schema:large,resource:{...resource,key:'target:0'}}).length,0);
  assert.equal(big.position({...options,schema:large,resource:{...resource,key:'target:49'}}).length,1);
});

test('clearing and route/session reset remove retained intents without storage, transport or draft mutation',()=>{
  const ui=fixture(),options=base(),tail=draft();ui.record({...options,requestKey:'first',values:values()});ui.navigate({...options,direction:'previous',draft:tail});assert.equal(ui.clear(options),true);assert.deepEqual(tail,draft());assert.equal(ui.position(options).length,0);
  ui.record({...options,requestKey:'second',values:values()});ui.reset();assert.equal(ui.position(options).length,0);
  assert.doesNotMatch(source,/\b(?:fetch|sessionStorage|localStorage|indexedDB|XMLHttpRequest|document|location)\b/);
});

test('tail preservation survives the combined memory boundary and controls expose no retained fields or keys',()=>{
  const ui=fixture(),options={...base(),schema:[{name:'reason',type:'text',max:4000},{name:'details',type:'text',max:4000}]};
  const value={reason:'x'.repeat(4000),details:'y'.repeat(4000)},tail={values:{reason:'a'.repeat(4000),details:'b'.repeat(4000)},focus:'details',start:2,end:5};
  for(let i=0;i<25;i++)ui.record({...options,requestKey:`entry_${i}`,values:value});
  assert.equal(ui.position(options).length,16);
  ui.navigate({...options,direction:'previous',draft:tail});assert.equal(ui.position(options).length,15);
  assert.deepEqual(plain(ui.navigate({...options,direction:'next',draft:tail})),tail);
  const html=ui.controls(options);assert.equal((html.match(/type="button"/g)||[]).length,3);assert.doesNotMatch(html,/entry_|xxxx|yyyy|aaaa|bbbb/);
});

function formFixture(){
  const ownerDocument={activeElement:null},listeners=new Map(),events=[],buttons=['previous','next','clear'].map(operation=>({dataset:{commandHistory:operation},disabled:false,matches(){return this.disabled;},addEventListener(_,fn){this.handler=fn;}})),counter={};
  const field=(name,type,value)=>({name,type,value,options:type==='select-one'?[{value:'ban'},{value:'remove'}]:undefined,selectionStart:type==='textarea'?2:null,selectionEnd:type==='textarea'?5:null,disabled:false,matches(){return this.disabled;},addEventListener(type,fn){listeners.set(`${name}:${type}`,fn);},dispatchEvent(event){events.push(`${name}:${event.type}`);listeners.get(`${name}:${event.type}`)?.();},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},focus(){ownerDocument.activeElement=this;listeners.get(`${name}:focus`)?.();}});
  const reason=field('reason','textarea','Unfinished draft'),operation=field('operation','select-one','remove'),disclose=field('disclose','checkbox','on');disclose.checked=true;ownerDocument.activeElement=reason;
  const submit={type:'submit',disabled:false,addEventListener(){}},form={isConnected:true,elements:[operation,reason,disclose,submit],ownerDocument,querySelector(){return counter;},querySelectorAll(){return buttons;},addEventListener(type,fn){listeners.set(`form:${type}`,fn);}};
  return {form,buttons,counter,reason,operation,disclose,events,listeners,submit};
}

test('native form adapter refreshes before recall, restores draft/caret and leaves disclosure and submission untouched',async()=>{
  const ui=fixture(),options=base(),f=formFixture();let reads=0;
  ui.record({...options,requestKey:'first',values:values('Old reason')});
  ui.bindForm(f.form,{context:()=>options,refresh:async()=>{reads++;return options;},current:()=>true});
  f.listeners.get('reason:blur')();f.form.ownerDocument.activeElement=f.buttons[0];
  await f.buttons[0].handler();assert.equal(reads,1);assert.equal(f.reason.value,'Old reason');assert.equal(f.operation.value,'ban');assert.equal(f.disclose.checked,true);assert.equal(f.counter.textContent,'1/1');
  await f.buttons[1].handler();assert.equal(reads,2);assert.equal(f.reason.value,'Unfinished draft');assert.equal(f.operation.value,'remove');assert.deepEqual([f.reason.selectionStart,f.reason.selectionEnd],[2,5]);
  await f.buttons[2].handler();assert.equal(reads,2);assert.equal(f.reason.value,'Unfinished draft');assert.equal(f.counter.textContent,'0/0');assert.deepEqual(f.events,['operation:input','reason:input','operation:input','reason:input']);
});

test('form adapter refuses stale session/form/target, disabled controls and failures after asynchronous refresh',async()=>{
  for(const condition of ['session','detached','target','authority','disabled','failure']){
    const ui=fixture(),options=base(),f=formFixture();let same=true,errors=0,release;
    ui.record({...options,requestKey:'first',values:values()});
    ui.bindForm(f.form,{context:()=>options,current:()=>same,onError:()=>errors++,refresh:()=>new Promise((resolve,reject)=>{release=()=>{if(condition==='session')same=false;if(condition==='detached')f.form.isConnected=false;if(condition==='disabled')f.reason.disabled=true;const next=base();if(condition==='target')next.resource.epoch='c'.repeat(43);if(condition==='authority')next.authority.epoch='d'.repeat(43);if(condition==='failure')reject(new Error('Denied'));else resolve(next);};})});
    const pending=f.buttons[0].handler();assert.equal(f.buttons[0].disabled,true);await f.buttons[0].handler();release();await pending;
    assert.equal(f.reason.value,'Unfinished draft');assert.equal(f.operation.value,'remove');assert.equal(f.events.length,0);assert.equal(errors,condition==='failure'?1:0);
  }
});

test('room access cleanup explicitly resets retained history even when detached controls still reference its store',()=>{
  const ui=fixture(),options=base();ui.record({...options,requestKey:'first',values:values()});ui.navigate({...options,direction:'previous',draft:draft()});
  const window={};runInNewContext(readFileSync(new URL('../src/message-rooms.js',import.meta.url),'utf8'),{window});
  const state={roomCommandHistory:ui,roomSelected:'room_a',roomDefinitionDrafts:{title:'Old title'},other:'unchanged'};
  window.messageRoomsUI.clearAccess(state,true);assert.deepEqual(state,{roomSelected:'room_a',other:'unchanged'});assert.equal(ui.position(options).length,0);
});

test('typing during a fresh authority check cancels restoration and capture-phase submission is blocked until settled',async()=>{
  const ui=fixture(),options=base(),f=formFixture();let release;
  ui.record({...options,requestKey:'first',values:values()});
  ui.bindForm(f.form,{context:()=>options,current:()=>true,refresh:()=>new Promise(resolve=>{release=()=>resolve(options);})});
  const pending=f.buttons[0].handler();assert.equal(f.submit.disabled,true);
  const event={preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};f.listeners.get('form:submit')(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
  f.reason.value='Typed while waiting';release();await pending;
  assert.equal(f.reason.value,'Typed while waiting');assert.equal(f.operation.value,'remove');assert.equal(f.events.length,0);assert.equal(ui.position(options).index,null);assert.equal(ui.position(options).length,1);assert.equal(f.submit.disabled,false);
});
