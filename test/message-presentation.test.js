import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/message-presentation.js',import.meta.url),'utf8');
function fixture(content='false',blocked=false){
  const values=new Map(),window={},localStorage={getItem(key){if(blocked)throw new Error('Denied');return values.get(key) || null;},setItem(key,value){if(blocked)throw new Error('Denied');values.set(key,value);}};
  runInNewContext(source,{window,localStorage,document:{querySelector:()=>({content})}});
  return {...window.messagePresentation,values};
}
test('message presentation defaults are explicit and account choices override either default',()=>{
  for(const content of ['true','false','TRUE','1',undefined]){
    const ui=fixture(content);assert.equal(ui.read('acct_a'),content==='true');
    for(const value of [true,false]){assert.equal(ui.write('acct_a',value),true);assert.equal(ui.read('acct_a'),value);}
  }
});
test('message presentation persists only one boolean per account, never another account choice',()=>{
  const ui=fixture();assert.equal(ui.write('acct_a',true),true);assert.equal(ui.read('acct_a'),true);assert.equal(ui.read('acct_b'),false);
  assert.deepEqual([...ui.values],[['svu.messages.presentation.v1:acct_a','{"minimized":true}']]);
});
test('malformed and oversized message presentation records fall back without coercion',()=>{
  const ui=fixture('true');
  for(const raw of ['not-json','null','[]','false','{"minimized":0}','{"minimized":"false"}','{"other":false}','{"minimized":false,"body":"PRIVATE"}',' '.repeat(65)]){
    ui.values.set('svu.messages.presentation.v1:acct_a',raw);assert.equal(ui.read('acct_a'),true);
  }
});
test('message presentation refuses invalid account keys and nonboolean writes',()=>{
  const ui=fixture();for(const id of [null,1,{},'','a@example.edu','../a','a'.repeat(201)])assert.equal(ui.write(id,true),false);
  for(const value of [null,'true',1,{}])assert.equal(ui.write('acct_a',value),false);assert.equal(ui.values.size,0);
});
test('unavailable message preference storage keeps access and defaults functional',()=>{
  for(const content of ['true','false']){const ui=fixture(content,true);assert.equal(ui.read('acct_a'),content==='true');assert.equal(ui.write('acct_a',true),false);}
});
