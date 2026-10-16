import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('late cashbook reads cannot restore departed or newer-account private state',async()=>{
  const source=await readFile(new URL('../src/cashbook.js',import.meta.url),'utf8');
  for(const departure of ['route','session']) {
    const listeners={},sessionListeners=[],state={session:{token:'old'}},location={hash:'#registry/cashbook'};
    const window={addEventListener:(name,listener)=>{listeners[name]=listener;},svuSession:{get:()=>state.session,onChange:listener=>sessionListeners.push(listener)}};
    vm.runInNewContext(source,{window,location,URLSearchParams});
    let release;const work=window.cashbookUI.load(state,()=>new Promise(resolve=>{release=resolve;}));
    if(departure==='route'){location.hash='#home';listeners.hashchange();}else {state.session={token:'new'};sessionListeners[0]();}
    state.cashbook={marker:'new-context'};release({marker:'old-private-read'});
    await assert.rejects(work,/context changed/);assert.equal(state.cashbook.marker,'new-context');
  }
});
test('denied selected-book reads discard all retained financial state and command drafts',async()=>{
  const source=await readFile(new URL('../src/cashbook.js',import.meta.url),'utf8');
  const state={session:{token:'current'},cashbook:{books:[]},cashbookBook:{id:'old'},cashbookPeriod:{snapshot:'private'},cashbookDrafts:{reason:'private draft'}};
  let select;
  const button={dataset:{cbBook:'old'},addEventListener:(_name,listener)=>{select=listener;}};
  const root={querySelector:()=>null,querySelectorAll:selector=>selector==='[data-cb-book]' ? [button] : []};
  const window={addEventListener(){},svuSession:{get:()=>state.session,onChange(){}}};
  vm.runInNewContext(source,{window,location:{hash:'#registry/cashbook'},URLSearchParams});
  window.cashbookUI.bind(root,state,{api:async()=>{const error=new Error('Denied');error.status=403;throw error;},act:async work=>{await assert.rejects(work,/Denied/);}});
  await select();assert.deepEqual(Object.keys(state),['session']);
});
