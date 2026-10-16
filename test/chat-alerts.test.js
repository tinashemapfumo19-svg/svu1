import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../src/chat-alerts.js',import.meta.url),'utf8'),token=n=>`${n}.${'x'.repeat(43)}`;
const cursor=(p,a='a',kind='private',id='b')=>token(Buffer.from(JSON.stringify({v:1,a,s:JSON.stringify([kind,id]),p:String(p)})).toString('base64url'));
function target(){const events=new Map();return {events,addEventListener(name,fn){const list=events.get(name)||[];list.push(fn);events.set(name,list);},removeEventListener(name,fn){events.set(name,(events.get(name)||[]).filter(value=>value!==fn));},emit(name,event={}){for(const fn of [...(events.get(name)||[])])fn(event);}};}
function harness({stored=null,focus=true}={}){
  const window=target(),document=target(),storage=new Map(stored?[['svu.messages.alerts.v1:a',stored]]:[]),timers=new Map();let next=0;
  Object.assign(document,{title:'Original page',hidden:false,hasFocus:()=>focus,querySelector:()=>null,createElement:()=>({dataset:{},setAttribute(){},remove(){button.badge=null;}})});
  const button={dataset:{privateTabSelect:'b'},badge:null,querySelector(){return this.badge;},append(node){this.badge=node;},setAttribute(){},removeAttribute(){}};
  const root={querySelectorAll:selector=>selector.includes('data-private-tab-select')?[button]:selector==='[data-chat-alert-badge]'?[button.badge].filter(Boolean):[],querySelector:()=>null};
  runInNewContext(code,{window,document,localStorage:{getItem:name=>storage.get(name)||null,setItem:(name,value)=>storage.set(name,value)},atob,AbortController,Date,Promise,setInterval:fn=>{timers.set(++next,fn);return next;},clearInterval:id=>timers.delete(id)});
  return {window,document,root,button,storage,timers,api:window.chatAlerts};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('alerts start sound off, retain own messages and validate only bounded account-specific boolean preferences',()=>{
  const h=harness();assert.equal(h.api.preferences('a').sound,false);assert.equal(h.api.preferences('a').own,true);assert.equal(h.api.preferences('a').window,true);
  for(const stored of ['[]','null','invalid','x'.repeat(129),'{"window":true,"sound":"yes","own":true}','{"window":true,"sound":true,"own":true,"body":"private"}'])assert.equal(harness({stored}).api.preferences('a').sound,false);
  const saved=harness({stored:'{"window":false,"sound":true,"own":false}'});assert.equal(saved.api.preferences('a').sound,true);assert.equal(saved.api.preferences('b').sound,false);
  assert.equal(saved.api.controls('invalid id'),'');assert.match(saved.api.controls('a'),/Test alert sound/);
});
test('alerts consume initial/reset/replay silently and classify own, hidden-tab and inactive-window counts independently',()=>{
  const h=harness(),r={cursor:null,tab:0n,window:0n},options={own:true,shown:false,inactive:true,window:true};
  assert.equal(h.api.consume(r,{cursor:token('a'),reset:true,own:'2',others:'3'},options),0n);assert.equal(r.tab,0n);
  assert.equal(h.api.consume(r,{cursor:token('b'),reset:false,own:'1',others:'2'},options),3n);assert.equal(r.tab,3n);assert.equal(r.window,3n);
  assert.equal(h.api.consume(r,{cursor:token('b'),reset:false,own:'1',others:'2'},options),0n);assert.equal(r.tab,3n);
  h.api.consume(r,{cursor:token('c'),reset:false,own:'10',others:'2'},{...options,own:false,shown:true,inactive:false});assert.equal(r.tab,3n);assert.equal(r.window,3n);
  h.api.consume(r,{cursor:token('d'),reset:true,own:'0',others:'0'},options);assert.equal(r.tab,0n);assert.equal(r.window,0n);
});
test('alert counts reject malformed responses and saturate exact bigint state without unbounded labels',()=>{
  const h=harness(),options={own:true,shown:false,inactive:true,window:true};
  for(const payload of [null,{}, {cursor:token('a'),reset:0,own:'0',others:'0'},{cursor:token('a'),reset:false,own:1,others:'0'},{cursor:token('a'),reset:false,own:'01',others:'0'},{cursor:token('a'),reset:false,own:'0',others:'9223372036854775808'}])assert.throws(()=>h.api.consume({cursor:token('old'),tab:0n,window:0n},payload,options));
  const r={cursor:token('old'),tab:9223372036854775806n,window:0n};h.api.consume(r,{cursor:token('a'),reset:false,own:'2',others:'2'},options);assert.equal(r.tab,9223372036854775807n);assert.equal(h.api.label(r.tab),'999+');
});
test('mounted alerts use body-free activity URLs, paint generic counts and clear title/timers/listeners on departure',async()=>{
  const h=harness({focus:false}),context={},calls=[];let responses=[{cursor:cursor(0),reset:true,own:'0',others:'0'},{cursor:cursor(3),reset:false,own:'1',others:'2'}];
  const options={root:h.root,id:'a',key:'session',current:()=>true,busy:()=>false,entries:()=>[{kind:'private',id:'b',context}],shown:()=>false,request:async(path)=>{calls.push(path);return responses.shift();},refused:()=>assert.fail('Unexpected refusal')};
  h.api.mount(options);await flush();assert.equal(h.document.title,'Original page');await [...h.timers.values()][0]();assert.equal(h.document.title,'(3) South Valley University');assert.equal(h.button.badge.textContent,'3');assert.ok(calls.every(path=>path.includes('/activity')));assert.equal(calls.some(path=>path.endsWith('/messages')),false);
  h.window.emit('focus');assert.equal(h.document.title,'Original page');assert.equal(h.button.badge.textContent,'3');
  h.api.unmount();assert.equal(h.timers.size,0);assert.equal([...h.window.events.values(),...h.document.events.values()].flat().length,0);
});
test('mounted alerts reject rebound actors and scopes before painting counts',async()=>{
  for(const value of [cursor(3,'other'),cursor(3,'a','room'),cursor(3,'a','private','other')]){
    const h=harness({focus:false}),context={},errors=[];
    h.api.mount({root:h.root,id:'a',key:'session',current:()=>true,busy:()=>false,entries:()=>[{kind:'private',id:'b',context}],shown:()=>false,request:async()=>({cursor:value,reset:false,own:'1',others:'2'}),refused:(_,error)=>errors.push(error)});
    await flush();assert.equal(errors.length,1);assert.equal(errors[0].identityChanged,true);assert.equal(h.document.title,'Original page');assert.equal(h.button.badge.textContent,'0');h.api.unmount();
  }
});
test('repeated access errors notify once until recovery and attention follows window state',async()=>{
  const h=harness(),context={};let refusals=0;
  h.api.mount({root:h.root,id:'a',key:'session',current:()=>true,busy:()=>false,entries:()=>[{kind:'private',id:'b',context}],shown:()=>false,request:async()=>{throw Object.assign(new Error('Closed'),{statusCode:409});},refused:()=>refusals++});
  await flush();assert.equal(h.api.attentive(),true);await [...h.timers.values()][0]();assert.equal(refusals,1);h.window.emit('blur');assert.equal(h.api.attentive(),false);h.window.emit('focus');assert.equal(h.api.attentive(),true);h.api.unmount();
});
test('context disposal and identity departure abort requests and ignore late activity without old title or audio',async()=>{
  const h=harness({focus:false});let release,signal,live=true;
  h.api.mount({root:h.root,id:'a',key:'session',current:()=>live,busy:()=>false,entries:()=>[{kind:'private',id:'b',context:{}}],shown:()=>false,request:async(path,s)=>{signal=s;return new Promise(resolve=>{release=resolve;});},refused:()=>{}});
  await flush();assert.equal(signal.aborted,false);live=false;h.api.unmount();assert.equal(signal.aborted,true);release({cursor:token('late'),reset:false,own:'20',others:'30'});await flush();assert.equal(h.document.title,'Original page');assert.equal(h.button.badge,null);assert.equal(h.timers.size,0);
});
