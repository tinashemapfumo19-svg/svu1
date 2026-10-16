import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
const sources=['chat-command-history','room-invitation-history','room-invitation-history-ui'].map(name=>readFileSync(new URL(`../src/${name}.js`,import.meta.url),'utf8'));
const descriptor={roomId:'room_1',accountId:'account_1'},plain=value=>JSON.parse(JSON.stringify(value));
const metadata=email=>({accountId:'account_1',authorityEpoch:'a'.repeat(43),epoch:'b'.repeat(43),targetType:'invitation',targetId:createHash('sha256').update(email.toLowerCase()).digest('base64url'),operations:['invite']});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
  const window={};let serial=0;for(const source of sources)runInNewContext(source,{window,crypto:{randomUUID:()=>`00000000-0000-4000-9000-${String(++serial).padStart(12,'0')}`},Event:class{constructor(type){this.type=type;}}});
  const ui=window.roomInvitationHistoryUI.create(),reads=[],sent=[],errors=[],drafts={};let reader=async email=>metadata(email),sender=async()=>{},live=true;
  function element(properties){return {...properties,listeners:new Map(),addEventListener(type,handler){const list=this.listeners.get(type)||[];list.push(handler);this.listeners.set(type,list);},dispatchEvent(event){for(const handler of this.listeners.get(event.type)||[])handler(event);}};}
  const ownerDocument={activeElement:null},field=element({name:'email',type:'text',value:'PEER@example.edu',selectionStart:2,selectionEnd:6,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},focus(){ownerDocument.activeElement=this;}}),picker=element({value:'',disabled:true}),submit=element({type:'submit',disabled:false});
  field.addEventListener('input',()=>{drafts.email=field.value;});
  const controls={html:'',buttons:[],contains(button){return this.buttons.includes(button);},querySelectorAll(){return this.buttons;},set innerHTML(html){this.html=html;this.buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(match=>({dataset:{commandHistory:/data-command-history="([^"]+)"/.exec(match[1])[1]},disabled:/\bdisabled\b/.test(match[1]),matches(){return this.disabled;},closest(){return this;}}));},get innerHTML(){return this.html;}};
  const form=element({isConnected:true,ownerDocument,elements:[field,picker,submit],querySelector(selector){return selector==='[name="email"]'?field:selector==='[data-invitation-contact]'?picker:controls;}});ownerDocument.activeElement=field;
  ui.bindForm(form,{descriptor,current:()=>live,request:async email=>{reads.push(email);return reader(email);},send:async command=>{sent.push(command);await sender(command);},onError:error=>errors.push(error)});
  return {ui,form,field,picker,submit,controls,reads,sent,errors,drafts,set reader(value){reader=value;},set sender(value){sender=value;},set live(value){live=value;},async send(){await ui.submit(form);},async click(direction){const button=controls.buttons.find(button=>button.dataset.commandHistory===direction);for(const handler of form.listeners.get('click')||[])await handler({target:button});},input(value){field.value=value;field.dispatchEvent({type:'input'});},select(key){picker.value=key;picker.dispatchEvent({type:'change'});}};
}

test('initial controls are neutral and deliberate submission sends only exact email and a new key',async()=>{
  const f=fixture();assert.equal(f.reads.length,0);assert.equal(f.submit.disabled,false);assert.ok(f.controls.buttons.every(button=>button.disabled));await f.send();
  assert.deepEqual(Object.keys(f.sent[0]).sort(),['email','requestKey']);assert.equal(f.sent[0].email,'PEER@example.edu');assert.match(f.sent[0].requestKey,/^room_[A-Za-z0-9_-]{36}$/);assert.match(f.controls.html,/>0\/1</);
  await f.send();assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].requestKey,f.sent[1].requestKey);assert.equal(f.reads.length,2);
});

test('recall restores exact email and unfinished draft/caret, emitting only native email input changes',async()=>{
  const f=fixture();await f.send();f.input('unfinished@');f.field.setSelectionRange(2,6);await f.click('previous');assert.equal(f.field.value,'PEER@example.edu');assert.equal(f.drafts.email,'PEER@example.edu');assert.equal(f.sent.length,1);assert.equal(f.reads.at(-1),'PEER@example.edu');
  await f.click('next');assert.equal(f.field.value,'unfinished@');assert.deepEqual([f.field.selectionStart,f.field.selectionEnd],[2,6]);assert.equal(f.form.ownerDocument.activeElement,f.field);assert.equal(f.sent.length,1);
});

test('contact selection does not overwrite the draft and each recalled recipient uses its own fresh lookup',async()=>{
  const f=fixture();await f.send();const first=f.picker.value;f.input('other@example.edu');await f.send();const second=f.picker.value;assert.notEqual(first,second);f.input('partial@');f.select(first);assert.equal(f.field.value,'partial@');await f.click('previous');assert.equal(f.field.value,'PEER@example.edu');assert.equal(f.reads.at(-1),'PEER@example.edu');assert.equal(f.sent.length,2);
});

test('typing during metadata checks cancels restoration and capture-phase submission remains blocked',async()=>{
  const f=fixture();await f.send();f.input('draft@');const pending=deferred();f.reader=()=>pending.promise;const restoring=f.click('previous');assert.equal(f.submit.disabled,true);assert.equal(f.picker.disabled,true);assert.ok(f.controls.buttons.every(button=>button.disabled));
  f.input('edited@');let prevented=0;f.form.dispatchEvent({type:'submit',preventDefault(){prevented++;},stopImmediatePropagation(){}});assert.ok(prevented>0);await f.send();pending.resolve(metadata('PEER@example.edu'));await restoring;assert.equal(f.field.value,'edited@');assert.equal(f.sent.length,1);assert.equal(f.errors.length,0);assert.equal(f.submit.disabled,false);
});

test('an unresolved native send blocks another attempt and leaves its recorded intent available after failure',async()=>{
  const f=fixture(),pending=deferred(),entered=deferred();f.sender=()=>{entered.resolve();return pending.promise;};const sending=f.send();await entered.promise;assert.equal(f.submit.disabled,true);await f.send();await f.click('previous');assert.equal(f.sent.length,1);pending.reject(new Error('Native command failed'));await sending;assert.equal(f.errors.length,1);assert.equal(f.submit.disabled,false);assert.match(f.controls.html,/>0\/1</);
});

test('detached or replaced forms cannot submit, restore or report late metadata errors',async()=>{
  for(const failure of [false,true]){const f=fixture();await f.send();const pending=deferred();f.reader=()=>pending.promise;const restoring=f.click('previous');f.form.isConnected=false;if(failure)pending.reject(new Error('Old failure'));else pending.resolve(metadata('PEER@example.edu'));await restoring;assert.equal(f.sent.length,1);assert.equal(f.errors.length,0);}
});

test('clearing and room cleanup remove contact choices without changing the current mailbox draft',async()=>{
  const f=fixture();await f.send();f.input('unfinished@');await f.click('clear');assert.equal(f.field.value,'unfinished@');assert.ok(f.controls.buttons.every(button=>button.disabled));assert.match(f.picker.innerHTML,/No attempts/);
  f.input('PEER@example.edu');await f.send();f.ui.forgetRoom('room_1');assert.doesNotMatch(f.ui.render(descriptor),/PEER@example.edu/);f.ui.reset();assert.doesNotMatch(f.ui.render(descriptor),/PEER@example.edu/);
});

test('recipient lifetime changes and malformed metadata cannot silently send or restore old intent',async()=>{
  const f=fixture();await f.send();f.reader=async email=>({...metadata(email),epoch:'c'.repeat(43)});await f.send();assert.equal(f.sent.length,1);assert.equal(f.errors.length,1);assert.equal(f.field.value,'PEER@example.edu');await f.send();assert.equal(f.sent.length,2);
  f.reader=async email=>({...metadata(email),body:'private'});await f.click('previous');assert.equal(f.sent.length,2);assert.equal(f.errors.length,2);assert.ok(f.controls.buttons.every(button=>button.disabled));
});

test('picker labels escape exact own-attempt addresses and invalid mailboxes do not request metadata',async()=>{
  const f=fixture();f.input('local&tag@example.edu');await f.send();const html=f.ui.render(descriptor);assert.match(html,/local&amp;tag@example.edu/);assert.doesNotMatch(html,/name="(?:epoch|targetId|requestKey|invitationContact)"/);
  const reads=f.reads.length;f.input(' invalid@example.edu ');await f.send();assert.equal(f.reads.length,reads);assert.equal(f.errors.length,1);assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(plain(f.sent[0])).sort(),['email','requestKey']);
});
