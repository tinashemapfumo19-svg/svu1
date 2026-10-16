import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {isPublicPath} from '../server/router.js';
const root=new URL('../src/assets/chat-smileys/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('catalogue.json',root),'utf8'));
const esc=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(){const context=createContext({URL,Event:class {constructor(type,options){this.type=type;this.bubbles=options.bubbles;}}});context.window=context;for(const name of ['bbob-parser-4.4.1.min.js','chat-smileys.js','chat-formatting.js'])runInContext(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),context,{timeout:1000});return context;}

test('native smiley catalogue preserves all 19 unchanged PNGs and 55 supplied aliases',()=>{
  const {chatSmileys}=fixture();assert.equal(chatSmileys.catalogue.length,19);assert.equal(chatSmileys.catalogue.reduce((n,item)=>n+item.aliases.length,0),55);assert.ok(Object.isFrozen(chatSmileys.catalogue));
  assert.deepEqual(readdirSync(root).filter(name=>name.endsWith('.png')).sort(),manifest.icons.map(item=>item.file).sort());
  assert.equal(createHash('sha256').update(readFileSync(new URL('theme.txt',root))).digest('hex'),manifest.mappingSha256);
  for(const item of manifest.icons){const bytes=readFileSync(new URL(item.file,root)),native=chatSmileys.catalogue.find(row=>row.file===item.file);assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),16);assert.equal(bytes.readUInt32BE(20),16);assert.deepEqual([...native.aliases],item.aliases);assert.ok(Object.isFrozen(native));assert.ok(Object.isFrozen(native.aliases));}
});
test('smiley display is independent and default-off without changing any written token',()=>{
  const {chatFormatting:ui}=fixture(),body='[b]Words[/b] :) :""": <img src=x onerror=bad>';
  assert.equal(ui.render(body),esc(body));assert.equal(ui.render(body,false,false),esc(body));
  const shown=ui.render(body,false,true);assert.match(shown,/data-chat-smiley="emoticon_smile"/);assert.match(shown,/data-chat-smiley="weather_clouds"/);assert.match(shown,/\[b\]Words\[\/b\]/);assert.match(shown,/&lt;img src=x onerror=bad&gt;/);assert.equal(body,'[b]Words[/b] :) :""": <img src=x onerror=bad>');
});
test('every supplied alias displays one fixed local image with an escaped original alt token',()=>{
  const {chatFormatting:ui}=fixture();for(const item of manifest.icons)for(const token of item.aliases){const output=ui.render(token,false,true);assert.equal((output.match(/<img /g)||[]).length,1,token);assert.match(output,new RegExp(`src="/src/assets/chat-smileys/${item.file.replace('.', '\\.') }"`));assert.ok(output.includes(`alt="${esc(token)}"`),token);assert.match(output,/width="16" height="16"/);}
});
test('longest-first smileys never reprocess generated image markup or URL attributes and labels',()=>{
  const {chatFormatting:ui}=fixture();for(const token of ['<--','-->','<<<','>>>',':-}',':-p'])assert.equal((ui.render(token,false,true).match(/<img /g)||[]).length,1);
  const body='[b]Hello :)[/b] [url=https://example.edu/path:)]Reference :)[/url]',output=ui.render(body,true,true);assert.match(output,/<strong>Hello <img/);assert.equal((output.match(/<img /g)||[]).length,1);assert.match(output,/href="https:\/\/example.edu\/path:\)"/);assert.match(output,/>Reference :\)<\/a>/);
  const urls='https://example.edu/path:)?next=--> http://example.edu/:clouds:';assert.equal(ui.render(urls,false,true),esc(urls));
});
test('unsafe or recovered BBCode remains entirely literal even with smileys enabled',()=>{
  const {chatFormatting:ui}=fixture();for(const body of ['[url=javascript:bad]:)[/url]','[img]https://example.edu/image.png[/img] :)','[b]:)[/i]','[color=white]:)[/color]','[b][i]:)[/b][/i]'])assert.equal(ui.render(body,true,true),esc(body));
});
test('smiley input, image, parser and output limits refuse partial presentation',()=>{
  const {chatFormatting:ui}=fixture();assert.equal((ui.render(':)'.repeat(128),false,true).match(/<img /g)||[]).length,128);
  for(const body of [':)'.repeat(129),':)'.repeat(2001)])assert.equal(ui.render(body,false,true),esc(body));
  const nested='[b]'.repeat(14)+':)'+'[/b]'.repeat(14);assert.equal(ui.render(nested,true,true),esc(nested));
});
test('static paths expose only the enumerated smiley PNGs and public credit notice',()=>{
  for(const item of manifest.icons)assert.equal(isPublicPath('/src/assets/chat-smileys/'+item.file),true);
  assert.equal(isPublicPath('/src/assets/chat-smileys/ATTRIBUTION.txt'),true);
  for(const path of ['/src/assets/chat-smileys/secret.png','/src/assets/chat-smileys/emoticon_smile.gif','/src/assets/chat-smileys/catalogue.json','/src/assets/chat-smileys/theme.txt','/src/assets/chat-smileys/emoticon_smile.png/../secret.png','/src/assets/chat-smileys/nested/emoticon_smile.png','/src/assets/chat-smileys/config.php','/_legacy_php_system/chat/themes/default/smileys/emoticon_smile.png','/src/assets/private.png','/src/assets/chat-smileys/private.txt'])assert.equal(isPublicPath(path),false,path);
});
test('smiley picker retains visible creators/license credits and non-submit bounded controls',()=>{
  const {chatSmileys}=fixture(),picker=chatSmileys.picker(true,'id"><script>');assert.equal((picker.match(/data-chat-insert-smiley=/g)||[]).length,19);assert.equal((picker.match(/type="button"/g)||[]).length,19);assert.equal((picker.match(/ disabled/g)||[]).length,19);assert.match(picker,/Mark James/);assert.match(picker,/Robin Monks/);assert.match(picker,/creativecommons.org\/licenses\/by\/2.5\//);assert.match(picker,/ATTRIBUTION.txt/);assert.doesNotMatch(picker,/<script>|onclick=|src="https?:/);
});
test('smiley selection insertion retains draft bounds and rejects disabled, stale and unknown controls',()=>{
  const context=fixture(),handlers=new Map(),events=[],field={value:'Draft words',selectionStart:6,selectionEnd:11,disabled:false,matches(){return this.disabled;},setRangeText(token,start,end){this.value=this.value.slice(0,start)+token+this.value.slice(end);this.selectionStart=this.selectionEnd=start+token.length;},dispatchEvent(event){events.push(event.type);},focus(){this.focused=true;}},status={},button={dataset:{chatInsertSmiley:'emoticon_smile'},disabled:false,matches(){return this.disabled;},addEventListener(name,fn){handlers.set(name,fn);}},form={isConnected:true,querySelector(selector){return selector.startsWith('textarea')?field:status;},querySelectorAll(){return [button];}};
  let current=true;context.chatSmileys.bindComposer(form,()=>current);handlers.get('click')();assert.equal(field.value,'Draft :)');assert.deepEqual(events,['input']);assert.equal(field.focused,true);assert.equal(field.selectionStart,8);assert.equal(field.selectionEnd,8);
  for(const cause of ['busy','detached','button-disabled','field-disabled','unknown']){current=cause!=='busy';form.isConnected=cause!=='detached';button.disabled=cause==='button-disabled';field.disabled=cause==='field-disabled';button.dataset.chatInsertSmiley=cause==='unknown'?'../../evil':'emoticon_smile';const before=field.value;handlers.get('click')();assert.equal(field.value,before);}
  current=true;form.isConnected=true;button.disabled=field.disabled=false;button.dataset.chatInsertSmiley='emoticon_smile';field.value='x'.repeat(4000);field.selectionStart=field.selectionEnd=4000;handlers.get('click')();assert.equal(field.value,'x'.repeat(4000));assert.equal(status.textContent,'Message exceeds 4000 characters.');
});
