import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const sources=['chat-command-history','room-command-history'].map(name=>readFileSync(new URL(`../src/${name}.js`,import.meta.url),'utf8'));
function fixture() {
  const window={};let serial=0;
  for(const source of sources)runInNewContext(source,{window,crypto:{randomUUID:()=>`new_${++serial}`},Event:class{constructor(type){this.type=type;}}});
  const ui=window.roomCommandHistoryUI.create();
  function form({type='member',targetId='member_1',revision=1,operation='hide',roomId='room_1'}={}) {
    const ownerDocument={activeElement:null},counter={},sent=[],errors=[],invalidations=[];
    function element(properties){return {...properties,listeners:new Map(),addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);},dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);},matches(){return this.disabled===true;}};}
    const reason=element({name:`reason_${targetId}`,type:'textarea',tagName:'TEXTAREA',value:'  Written reason\n  ',selectionStart:2,selectionEnd:5,disabled:false,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},focus(){ownerDocument.activeElement=this;}});
    const select=element({name:'operation',type:'select-one',tagName:'SELECT',value:'ban',options:['remove','ban','unban','promote','demote'].map(value=>({value,disabled:false}))});
    const buttons=['previous','next','clear'].map(commandHistory=>element({type:'button',dataset:{commandHistory},disabled:true}));
    const submit=element({type:'submit',disabled:false});
    const node=element({isConnected:true,dataset:{revision:String(revision)},ownerDocument,elements:[...(type==='member'?[select]:[]),reason,...buttons,submit],querySelector(selector){return selector==='[name="operation"]'?select:selector==='[data-command-history-position]'?counter:reason;},querySelectorAll(){return buttons;}});
    ownerDocument.activeElement=reason;
    const descriptor={roomId,accountId:'account_1',type,targetId,revision,operation,operations:['remove','ban','promote']};
    let metadata={accountId:'account_1',authorityEpoch:'a'.repeat(43),epoch:'b'.repeat(43),targetType:type,targetId,revision,operations:type==='member'?['remove','ban','promote']:[operation]},reads=0,reader=async()=>metadata,sender=async()=>{},current=true;
    ui.bindForm(node,{descriptor,current:()=>current,request:async()=>{reads++;return reader();},send:async command=>{sent.push(command);await sender(command);},onError:error=>errors.push(error),onInvalidate:(descriptor,all)=>invalidations.push({targetId:descriptor.targetId,all})});
    return {node,descriptor,reason,select,buttons,submit,counter,sent,errors,invalidations,get reads(){return reads;},set metadata(value){metadata=value;},get metadata(){return metadata;},set reader(value){reader=value;},set sender(value){sender=value;},set current(value){current=value;},async send(){await ui.submit(node);},async click(index){for(const fn of buttons[index].listeners.get('click')||[])await fn();}};
  }
  return {ui,form};
}
const plain=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('target controls stay disabled until checked; each deliberate submission gets a fresh key and exact intent',async()=>{
  const {ui,form}=fixture(),f=form();assert.equal(f.reads,0);assert.ok(f.buttons.every(button=>button.disabled));assert.equal(f.submit.disabled,false);
  await f.send();assert.equal(f.reads,1);assert.deepEqual(plain(f.sent[0]),{requestKey:'room_new_1',revision:1,operation:'ban',reason:'  Written reason\n  '});
  assert.equal(f.buttons[0].disabled,false);assert.match(ui.controls(f.descriptor),/>0\/1</);
  await f.send();assert.equal(f.reads,2);assert.equal(f.sent[1].requestKey,'room_new_2');assert.match(ui.controls(f.descriptor),/>0\/2</);
});

test('recall refreshes metadata, restores only declared fields and returns the unfinished tail without sending',async()=>{
  const {form}=fixture(),f=form();await f.send();f.reason.value='Unfinished';f.select.value='remove';
  await f.click(0);assert.equal(f.reason.value,'  Written reason\n  ');assert.equal(f.select.value,'ban');assert.equal(f.sent.length,1);assert.equal(f.reads,2);
  await f.click(1);assert.equal(f.reason.value,'Unfinished');assert.equal(f.select.value,'remove');assert.equal(f.sent.length,1);assert.equal(f.reads,3);
});

test('reset, room removal and detached forms cannot be repopulated by in-flight metadata',async()=>{
  for(const stop of ['reset','forget','detach','current']){
    const {ui,form}=fixture(),f=form(),pending=deferred();f.reader=()=>pending.promise;const sending=f.send();
    assert.equal(f.submit.disabled,true);
    if(stop==='reset')ui.reset();else if(stop==='forget')ui.forgetRoom('room_1');else if(stop==='detach')f.node.isConnected=false;else f.current=false;
    pending.resolve(f.metadata);await sending;assert.equal(f.sent.length,0);assert.match(ui.controls(f.descriptor),/>0\/0</);assert.equal(f.errors.length,0);
  }
});

test('foreign or malformed metadata wipes retained authority and refuses submission',async()=>{
  for(const change of [m=>({...m,accountId:'foreign'}),m=>({...m,targetId:'foreign'}),m=>({...m,revision:NaN}),m=>({...m,operations:['ban','ban']}),m=>({...m,body:'private'}),m=>({...m,epoch:'bad'})]){
    const {ui,form}=fixture(),f=form();await f.send();f.metadata=change(f.metadata);await f.send();
    assert.equal(f.sent.length,1);assert.equal(f.errors.length,1);assert.equal(f.reason.value,'');assert.equal(f.invalidations.at(-1).all,true);assert.match(ui.controls(f.descriptor),/>0\/0</);
  }
});

test('rendered revision mismatch and unavailable message operation refuse writes without replaying old revision',async()=>{
  const {form}=fixture(),f=form({type:'message',targetId:'message_1',revision:0});await f.send();
  f.metadata={...f.metadata,revision:1,operations:['restore']};await f.send();assert.equal(f.sent.length,1);assert.equal(f.errors.length,1);
  f.node.dataset.revision='1';await f.send();assert.equal(f.sent.length,1);assert.equal(f.errors.length,2);
});

test('authority and target lifetime changes invalidate draft and require another deliberate submission',async()=>{
  for(const field of ['epoch','authorityEpoch']){
    const {ui,form}=fixture(),f=form();await f.send();f.metadata={...f.metadata,[field]:'c'.repeat(43)};await f.send();
    assert.equal(f.sent.length,1);assert.equal(f.reason.value,'');assert.match(ui.controls(f.descriptor),/>0\/0</);
    assert.equal(f.invalidations.at(-1).all,field==='authorityEpoch');
  }
});

test('concurrent edits and stale failures do not submit or erase a replacement session draft',async()=>{
  const {ui,form}=fixture(),f=form();await f.send();const pending=deferred();f.reader=()=>pending.promise;const sending=f.send();f.reason.value='New edit';pending.resolve(f.metadata);await sending;assert.equal(f.sent.length,1);assert.equal(f.reason.value,'New edit');
  const failed=deferred();f.reader=()=>failed.promise;const obsolete=f.send();ui.reset();f.reason.value='New session draft';failed.reject(Object.assign(new Error('old denial'),{statusCode:403}));await obsolete;assert.equal(f.reason.value,'New session draft');assert.equal(f.errors.length,0);
});

test('target denial clears its history without erasing an independent target',async()=>{
  const {ui,form}=fixture(),a=form(),b=form({targetId:'member_2'});await a.send();await b.send();a.reader=async()=>{throw Object.assign(new Error('gone'),{statusCode:404});};await a.send();
  assert.match(ui.controls(a.descriptor),/>0\/0</);assert.match(ui.controls(b.descriptor),/>0\/1</);assert.equal(a.reason.value,'');assert.equal(b.reason.value,'  Written reason\n  ');
});

test('an unresolved send blocks a second submission and recall until the first settles',async()=>{
  const {form}=fixture(),f=form(),pending=deferred(),started=deferred();f.sender=()=>{started.resolve();return pending.promise;};
  const sending=f.send();await started.promise;assert.equal(f.submit.disabled,true);assert.ok(f.buttons.every(button=>button.disabled));
  await f.send();await f.click(0);assert.equal(f.sent.length,1);assert.equal(f.reads,1);
  let prevented=0;f.node.dispatchEvent({type:'submit',preventDefault(){prevented++;},stopImmediatePropagation(){}});assert.ok(prevented>0);
  pending.reject(new Error('Command failed'));await sending;assert.equal(f.errors.length,1);assert.equal(f.submit.disabled,false);assert.equal(f.buttons[0].disabled,false);
});

test('a delayed older target response cannot roll back authority detected by another form',async()=>{
  const {ui,form}=fixture(),a=form(),b=form({targetId:'member_2'});await a.send();await b.send();
  const pending=deferred(),old=a.metadata;a.reader=()=>pending.promise;const obsolete=a.send();
  b.metadata={...b.metadata,authorityEpoch:'c'.repeat(43),epoch:'d'.repeat(43)};await b.send();
  pending.resolve(old);await obsolete;assert.equal(a.sent.length,1);assert.equal(b.sent.length,1);
  assert.match(ui.controls(a.descriptor),/>0\/0</);assert.match(ui.controls(b.descriptor),/>0\/0</);assert.equal(a.errors.length,0);
  b.reason.value='New epoch intent';await b.send();assert.equal(b.sent.length,2);assert.equal(b.sent[1].reason,'New epoch intent');
});

test('reconciling a second stale form after authority changes requests only local draft invalidation',async()=>{
  const {form}=fixture(),a=form(),b=form({targetId:'member_2'});await a.send();await b.send();
  b.metadata={...b.metadata,authorityEpoch:'c'.repeat(43),epoch:'d'.repeat(43)};await b.send();assert.equal(b.invalidations.at(-1).all,true);
  b.reason.value='Fresh authority draft';a.metadata={...a.metadata,authorityEpoch:'c'.repeat(43),epoch:'e'.repeat(43)};await a.send();
  assert.equal(a.invalidations.at(-1).all,false);assert.equal(b.reason.value,'Fresh authority draft');
});
