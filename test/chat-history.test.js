import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/chat-history.js',import.meta.url),'utf8');
function fixture(){const window={};runInNewContext(source,{window,Event:class {constructor(type,options){this.type=type;this.bubbles=options.bubbles;}}});return window.chatHistory;}
const plain=value=>JSON.parse(JSON.stringify(value));
const draft=(body='',kind='text',start=body.length,end=start)=>({body,kind,start,end});

test('composer history records bounded attempted input exactly without normalization or slash execution',()=>{
  const ui=fixture(),context={};const body='  /ban someone\n[b]written[/b] :)  ';assert.equal(ui.record(context,'attempt_1',{body,kind:'notice'}),true);assert.deepEqual(plain(context.composerHistory.entries),[{key:'attempt_1',body,kind:'notice'}]);assert.equal(context.composerHistory.position,null);
  assert.equal(ui.record(context,'attempt_2',{body:' ',kind:'text'}),true);assert.equal(context.composerHistory.entries[1].body,' ');
});
test('composer history deduplicates frozen request retries but retains distinct intentional submissions',()=>{
  const ui=fixture(),context={};assert.equal(ui.record(context,'same',{body:'First',kind:'text'}),true);assert.equal(ui.record(context,'same',{body:'Changed incorrectly',kind:'action'}),false);assert.equal(ui.record(context,'new',{body:'First',kind:'text'}),true);assert.equal(context.composerHistory.entries.length,2);assert.equal(context.composerHistory.entries[0].body,'First');
  for(const [key,value] of [[null,{body:'x',kind:'text'}],['bad key',{body:'x',kind:'text'}],['x'.repeat(201),{body:'x',kind:'text'}],['valid',{body:1,kind:'text'}],['valid',{body:'x'.repeat(4001),kind:'text'}],['valid',{body:'x',kind:'operator'}]])assert.equal(ui.record(context,key,value),false);assert.equal(context.composerHistory.entries.length,2);assert.equal(ui.record(null,'valid',{body:'x',kind:'text'}),false);
});
test('composer history retains only the newest 25 entries and cannot cross context boundaries',()=>{
  const ui=fixture(),a={},b={};for(let i=0;i<30;i++)ui.record(a,`key_${i}`,{body:`${i}`.padEnd(4000,'x'),kind:'text'});assert.equal(a.composerHistory.entries.length,25);assert.equal(a.composerHistory.entries[0].key,'key_5');assert.equal(a.composerHistory.entries.at(-1).key,'key_29');assert.equal(a.composerHistory.entries.reduce((sum,row)=>sum+row.body.length,0),100000);assert.deepEqual(plain(ui.position(b)),{length:0,index:null,previous:false,next:false});assert.equal(ui.navigate(b,'previous',draft('Other context')),null);
});
test('composer navigation stops at both ends and restores the unfinished draft, kind and selection',()=>{
  const ui=fixture(),context={};ui.record(context,'a',{body:'Oldest',kind:'text'});ui.record(context,'b',{body:'Newest',kind:'action'});const original=draft('Unfinished','notice',2,5);
  assert.equal(ui.navigate(context,'next',original),null);assert.deepEqual(plain(ui.navigate(context,'previous',original)),draft('Newest','action'));assert.deepEqual(plain(ui.navigate(context,'previous',draft('Newest','action'))),draft('Oldest'));assert.equal(ui.navigate(context,'previous',draft('Oldest')),null);assert.deepEqual(plain(ui.navigate(context,'next',draft('Oldest'))),draft('Newest','action'));assert.deepEqual(plain(ui.navigate(context,'next',draft('Newest','action'))),original);assert.equal(context.composerHistory.position,null);assert.equal(context.composerHistory.tail,null);assert.equal(ui.navigate(context,'next',original),null);
});
test('editing a recalled candidate does not rewrite submission history or lose the saved unfinished draft',()=>{
  const ui=fixture(),context={};ui.record(context,'a',{body:'Submitted',kind:'text'});ui.navigate(context,'previous',draft('Original unsent','text',3,7));assert.deepEqual(plain(ui.navigate(context,'next',draft('Edited recall'))),draft('Original unsent','text',3,7));assert.equal(context.composerHistory.entries[0].body,'Submitted');
});
test('composer navigation refuses unavailable kinds before changing its position or cached draft',()=>{
  const ui=fixture(),context={};ui.record(context,'notice',{body:'Restricted candidate',kind:'notice'});assert.equal(ui.navigate(context,'previous',draft('Original'),['text','action']),null);assert.equal(context.composerHistory.position,null);assert.equal(context.composerHistory.tail,null);assert.deepEqual(plain(ui.navigate(context,'previous',draft('Original'),['text','notice'])),draft('Restricted candidate','notice'));assert.equal(ui.navigate(context,'next',draft('Candidate','notice'),['notice']),null);assert.equal(context.composerHistory.position,0);assert.equal(context.composerHistory.tail.body,'Original');
});
test('explicit composer-history clearing drops retained bodies, keys and cached drafts without a server command',()=>{
  const ui=fixture(),context={};ui.record(context,'secret_key',{body:'Retained plaintext',kind:'text'});ui.navigate(context,'previous',draft('Saved unsent'));ui.clear(context);assert.deepEqual(plain(ui.position(context)),{length:0,index:null,previous:false,next:false});assert.doesNotMatch(JSON.stringify(context),/Retained plaintext|Saved unsent|secret_key/);ui.clear({});
});
test('composer-history controls expose only fixed commands and counts, never retained bodies or request keys',()=>{
  const ui=fixture(),context={};ui.record(context,'hidden_key',{body:'Hidden input',kind:'text'});const html=ui.controls(context,true);assert.equal((html.match(/type="button"/g)||[]).length,3);assert.equal((html.match(/ disabled/g)||[]).length,3);assert.match(html,/0\/1/);assert.doesNotMatch(html,/Hidden input|hidden_key|onclick=|onkeydown=/);assert.match(html,/Clear composer history/);
});
test('native history binding restores selection and kinds, and clearing leaves the current draft unchanged',()=>{
  const ui=fixture(),context={},listeners=new Map(),events=[],buttons=['previous','next','clear'].map(operation=>({dataset:{chatHistory:operation},disabled:false,matches(){return this.disabled;},addEventListener(name,fn){this.handler=fn;},focus(){this.focused=true;}})),counter={},field={value:'Current draft',selectionStart:2,selectionEnd:4,disabled:false,matches(){return this.disabled;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},addEventListener(name,fn){listeners.set(name,fn);},dispatchEvent(event){events.push(event.type);listeners.get(event.type)?.();},focus(){this.focused=true;}},kind={value:'text',options:[{value:'text'},{value:'action'}],matches(){return false;},addEventListener(){},dispatchEvent(event){events.push('kind:'+event.type);}},form={isConnected:true,querySelector(selector){return selector.startsWith('textarea')?field:selector.startsWith('select')?kind:counter;},querySelectorAll(){return buttons;}};
  ui.record(context,'attempt',{body:'Prior action',kind:'action'});ui.bindComposer(form,context,()=>true);buttons[0].handler();assert.equal(field.value,'Prior action');assert.equal(kind.value,'action');assert.equal(counter.textContent,'1/1');assert.equal(field.focused,true);buttons[1].handler();assert.equal(field.value,'Current draft');assert.equal(kind.value,'text');assert.deepEqual([field.selectionStart,field.selectionEnd],[2,4]);assert.deepEqual(events,['input','kind:input','input','kind:input']);buttons[2].handler();assert.equal(field.value,'Current draft');assert.equal(counter.textContent,'0/0');assert.equal(context.composerHistory.entries.length,0);assert.equal(listeners.has('keydown'),false);assert.equal(listeners.has('keyup'),false);
});
test('composer history refuses busy, detached, disabled and unavailable-kind controls without changing the field',()=>{
  const ui=fixture();for(const condition of ['busy','detached','disabled','kind']){const context={},button={dataset:{chatHistory:'previous'},matches(){return false;},addEventListener(_,fn){this.handler=fn;}},field={value:'Keep draft',disabled:condition==='disabled',matches(){return this.disabled;},addEventListener(){}},kind={value:'text',options:[{value:'text'}],matches(){return false;},addEventListener(){}},form={isConnected:condition!=='detached',querySelector(selector){return selector.startsWith('textarea')?field:selector.startsWith('select')?kind:null;},querySelectorAll(){return [button];}};ui.record(context,'a',{body:'Retained',kind:condition==='kind'?'notice':'text'});ui.bindComposer(form,context,()=>condition!=='busy');button.handler();assert.equal(field.value,'Keep draft');assert.equal(context.composerHistory.position,null);}
});
