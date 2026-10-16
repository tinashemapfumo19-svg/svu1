import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('private preference draft survives a background reload until a successful save',async()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const state={privatePreferenceChoice:false};
  const api=async(binding,method,url)=>url.endsWith('/changes') ? {} : url.endsWith('/preferences') ? {enabled:true,revision:1} : {items:[],offset:0,total:0};
  await window.privateMessagesUI.load(state,api,{});
  assert.match(window.privateMessagesUI.view(state,false),/name="enabled" >Accept private contact requests/);
  delete state.privatePreferenceChoice;
  assert.match(window.privateMessagesUI.view(state,false),/name="enabled" checked>Accept private contact requests/);
});

test('private refresh captures its change counter before content so a concurrent commit remains detectable',async()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const state={privateSelected:'c'},calls=[];let version='1';
  const api=async(binding,method,url)=>{
    calls.push(url);
    if(url.endsWith('/changes'))return {latestPosition:version,unread:Number(version)};
    if(url.endsWith('/preferences'))return {enabled:true,revision:1};
    if(url.includes('/conversations?'))return {items:[{id:'c'}]};
    if(url.endsWith('/messages')){version='2';return {items:[{id:'old',body:'Original snapshot'}]};}
    throw new Error('Unexpected private refresh request');
  };
  await window.privateMessagesUI.load(state,api,{});
  assert.equal(calls[0],'/api/private-messages/changes');
  assert.equal(JSON.parse(state.privateStamp).latestPosition,'1');
  assert.equal(state.private.messages.items[0].id,'old');
  assert.notEqual(JSON.stringify(await api({},'GET','/api/private-messages/changes')),state.privateStamp);
});

test('private tabs isolate exact cursors, drafts, report reasons and retry keys',()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const state={privateParticipation:'a',privateSelected:'a',privateDraft:'draft A',privateSendKey:'retry_A',privatePages:[null,'9007199254740993'],privateReports:{message:'reason A'},privateContexts:{a:{},b:{draft:'draft B',sendKey:'retry_B',pages:[null,'2'],reports:{}}}};
  window.privateMessagesUI.switchConversation(state,'b');assert.equal(state.privateDraft,'draft B');assert.equal(state.privateSendKey,'retry_B');assert.equal(state.privateContexts.a.pages[1],'9007199254740993');
  state.privateParticipation='b';state.privateDraft='edited B';window.privateMessagesUI.switchConversation(state,'a');
  assert.equal(state.privateDraft,'draft A');assert.equal(state.privateSendKey,'retry_A');assert.equal(state.privateReports.message,'reason A');assert.equal(state.privateContexts.b.draft,'edited B');
});

test('private tabs save and restore independent message kinds with default-text compatibility',()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const state={privateParticipation:'a',privateSelected:'a',privateDraft:'action draft',privateKind:'action',privateSendKey:'retry_A',privateContexts:{a:{},b:{draft:'text draft',kind:'text'}}};
  window.privateMessagesUI.switchConversation(state,'b');assert.equal(state.privateKind,'text');assert.equal(state.privateContexts.a.kind,'action');
  state.privateParticipation='b';window.privateMessagesUI.switchConversation(state,'a');assert.equal(state.privateKind,'action');assert.equal(state.privateSendKey,'retry_A');
  window.privateMessagesUI.switchConversation(state,'new');assert.equal(state.privateKind,'text');
});

test('private action display uses account labels, escaped literal bodies and only text/action options',()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const selected={id:'a',peerName:'Verified contact',status:'accepted',blocked:false},state={privateKind:'action',privateContexts:{a:{}},private:{preferences:{enabled:true},conversations:{items:[],offset:0,total:0},selected,messages:{status:'accepted',items:[{id:'m',body:'/me <img src=x>',kind:'action',createdAt:'2026-10-12T00:00:00Z'}]}}};
  const html=window.privateMessagesUI.view(state,false);assert.match(html,/data-private-kind="action"/);assert.match(html,/room-action/);assert.match(html,/Verified contact/);assert.match(html,/\/me &lt;img src=x&gt;/);assert.match(html,/value="action" selected/);assert.doesNotMatch(html,/value="notice"|<img src=x>/);
});

test('off-page private metadata discards a closed background context without fetching its bodies',async()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const prefs={enabled:true,revision:1},a={id:'a',status:'accepted',revision:2,blockRevision:0,peerName:'A'},b={...a,id:'b',status:'closed',revision:3};
  const context=()=>({revision:2,preferenceRevision:1,blockRevision:0,draft:'secret',sendKey:'retry',pages:[null,'9007199254740993'],reports:{}});
  const state={privateSelected:'a',privateParticipation:'a',privateDraft:'draft A',privatePages:[null,'9007199254740993'],privateTabs:[{id:'a'},{id:'b'}],privateContexts:{a:context(),b:context()}};const calls=[];
  await window.privateMessagesUI.load(state,async(binding,method,url)=>{calls.push(url);if(url.endsWith('/changes'))return {};if(url.endsWith('/preferences'))return prefs;if(url.includes('/conversations?'))return {items:[],summary:true};if(url.includes('/messages'))return {items:[]};return {conversation:url.endsWith('/a')?a:b,preferences:prefs};},{});
  assert.equal(state.private.selected.id,'a');assert.equal(state.privateDraft,'draft A');assert.equal(state.privateContexts.b,undefined);assert.equal(state.privateTabs.length,1);assert.equal(calls.some(url=>url.includes('/b/messages')),false);
});

test('renewed private consent drops old drafts and retries even if acceptance metadata was missed',async()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const row={id:'a',status:'accepted',revision:2,blockRevision:0},prefs={enabled:true,revision:3};const state={privateSelected:'a',privateParticipation:'a',privateDraft:'old',privateSendKey:'old_retry',privateTabs:[{id:'a'}],privateContexts:{a:{revision:2,preferenceRevision:1,blockRevision:0}}};
  await window.privateMessagesUI.load(state,async(binding,method,url)=>url.endsWith('/changes')?{}:url.endsWith('/preferences')?prefs:url.includes('/conversations?')?{items:[row],summary:true}:url.endsWith('/messages')?{items:[]}:{conversation:row,preferences:prefs},{});
  assert.equal(state.privateDraft,'');assert.equal(state.privateSendKey,null);assert.equal(state.privatePages.length,1);assert.equal(state.privateContexts.a.preferenceRevision,3);
});

test('an externally accepted pending conversation cannot open a ninth private tab',async()=>{
  const window={};runInNewContext(readFileSync(new URL('../src/private-messages.js',import.meta.url),'utf8'),{window});
  const prefs={enabled:true,revision:1},rows=Array.from({length:9},(_,i)=>({id:`c${i}`,status:'accepted',revision:2,blockRevision:0}));
  const state={privateSelected:'c8',privateTabs:rows.slice(0,8).map(row=>({id:row.id})),privateContexts:Object.fromEntries(rows.slice(0,8).map(row=>[row.id,{revision:2,preferenceRevision:1,blockRevision:0,draft:row.id,pages:[null],reports:{}}]))};
  await window.privateMessagesUI.load(state,async(binding,method,url)=>url.endsWith('/changes')?{}:url.endsWith('/preferences')?prefs:url.includes('/conversations?')?{items:rows,summary:true}:url.endsWith('/messages')?{items:[]}:{conversation:rows.find(row=>url.endsWith(`/${row.id}`)),preferences:prefs},{});
  assert.equal(state.privateTabs.length,8);assert.equal(state.privateSelected,'c0');assert.equal(state.privateDraft,'c0');assert.equal(state.privateContexts.c8,undefined);
});
