import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const esc=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(){const context=createContext({URL});context.window=context;for(const name of ['bbob-parser-4.4.1.min.js','chat-smileys.js','chat-name-emphasis.js','chat-formatting.js'])runInContext(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),context,{timeout:1000});return context;}

test('own-name source accepts only a bounded authenticated preferred name, not session, legal-name or email guesses',()=>{
  const {chatNameEmphasis:ui}=fixture();assert.equal(ui.accountName({account:{id:'acct_a',email:'guess@example.edu'},person:{preferredName:' Ann Mae ',legalName:'Other Name'},preferredName:'Spoofed'}),'Ann Mae');
  for(const preferredName of [undefined,null,1,{},[], '', ' '.repeat(4),'x'.repeat(201),'Ann\nMae','Ann\0Mae'])assert.equal(ui.accountName({account:{id:'acct_a'},person:{preferredName,legalName:'Fallback'}}),'');
  for(const id of [undefined,1,'','../../a','bad id'])assert.equal(ui.accountName({account:{id},person:{preferredName:'Ann'}}),'');assert.equal(ui.accountName({account:{id:'acct_a',preferredName:'Spoof'},person:{legalName:'Fallback'}}),'');
});
test('own-name emphasis is default-off and retains each original occurrence spelling and case',()=>{
  const {chatFormatting:ui}=fixture(),body='Ann ANN ann, Ann; ANN: ann';assert.equal(ui.render(body),body);const shown=ui.render(body,false,false,'Ann');assert.equal((shown.match(/class="chat-own-name"/g)||[]).length,6);assert.equal(shown.replace(/<\/?strong[^>]*>/g,''),body);assert.match(shown,/>ANN<\/strong>/);assert.match(shown,/>ann<\/strong>/);
});
test('own-name matching supports multiword Unicode names and native whitespace without matching substrings',()=>{
  const {chatFormatting:ui}=fixture(),body='Hi JOSÉ MAE, José Mae\njosé mae; NotJosé Mae José Maely';const output=ui.render(body,false,false,'José Mae');assert.equal((output.match(/class="chat-own-name"/g)||[]).length,3);assert.match(output,/NotJosé Mae José Maely$/);assert.equal(output.replace(/<\/?strong[^>]*>/g,''),body);
  const formatted=ui.render('[b]Hi JOSÉ MAE[/b]\nJosé Mae',true,false,'José Mae');assert.equal((formatted.match(/class="chat-own-name"/g)||[]).length,2);assert.match(formatted,/<strong>Hi <strong class="chat-own-name">JOSÉ MAE<\/strong><\/strong>/);
});
test('own-name regex punctuation is treated literally and cannot inject patterns or HTML',()=>{
  const {chatFormatting:ui}=fixture();for(const name of ['A.*+?^${}()|[]\\','O\'Neil & <B>','(Ann)+ [Mae].?']){const body=`Hello ${name}, ${name}`;const output=ui.render(body,false,false,name);assert.equal((output.match(/class="chat-own-name"/g)||[]).length,2,name);assert.equal(output.replace(/<\/?strong[^>]*>/g,''),esc(body));assert.doesNotMatch(output,/<B>|<script|onerror="/);}
  assert.equal(ui.render('Ann Ann',false,false,'.*'), 'Ann Ann');
});
test('own-name emphasis leaves URL chunks, generated links, attributes and literal tag syntax alone',()=>{
  const {chatFormatting:ui}=fixture();const raw='https://example.edu/Ann Ann <span title="Hi Ann there"> Ann </span>';const output=ui.render(raw,false,false,'Ann');assert.equal((output.match(/class="chat-own-name"/g)||[]).length,2);assert.match(output,/https:\/\/example.edu\/Ann /);assert.match(output,/&lt;span title=&quot;Hi Ann there&quot;&gt;/);
  const linked=ui.render('[url=https://example.edu/?name=Ann]Ann Ann[/url] Ann',true,false,'Ann');assert.equal((linked.match(/class="chat-own-name"/g)||[]).length,1);assert.match(linked,/href="https:\/\/example.edu\/\?name=Ann"/);assert.match(linked,/>Ann Ann<\/a>/);
});
test('own-name and smiley presentation cooperate without reprocessing image markup or changing name text',()=>{
  const {chatFormatting:ui}=fixture();const output=ui.render('Ann :) Ann',false,true,'Ann');assert.equal((output.match(/class="chat-own-name"/g)||[]).length,2);assert.equal((output.match(/<img /g)||[]).length,1);assert.match(output,/alt=":\)"/);
  const literalName=ui.render('Hi Ann :), :)',false,true,'Ann :)');assert.match(literalName,/<strong class="chat-own-name">Ann :\)<\/strong>/);assert.equal((literalName.match(/<img /g)||[]).length,1);
});
test('own-name presentation retains complete literal fallback for unsafe recovery and every limit',()=>{
  const {chatFormatting:ui}=fixture();for(const body of ['[b]Ann[/i]','[url=javascript:bad]Ann[/url]','[color=white]Ann[/color]','[b]'.repeat(14)+'Ann'+'[/b]'.repeat(14),'Ann '.repeat(129),'x'.repeat(4001)+' Ann'])assert.equal(ui.render(body,true,true,'Ann'),esc(body));
  assert.equal((ui.render('Ann '.repeat(128),false,false,'Ann').match(/class="chat-own-name"/g)||[]).length,128);
});
test('missing or malformed own names cannot retain another identity name in a renderer',()=>{
  const {chatFormatting:ui}=fixture();for(const name of [undefined,null,{},[],1,'','x'.repeat(201),'Ann\0'])assert.equal(ui.render('Ann Ann',false,false,name),'Ann Ann');assert.match(ui.render('Ann',false,false,'Ann'),/chat-own-name/);assert.equal(ui.render('Ann',false,false,'Mae'),'Ann');
});
