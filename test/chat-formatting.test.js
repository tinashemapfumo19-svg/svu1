import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
const vendor=readFileSync(new URL('../src/bbob-parser-4.4.1.min.js',import.meta.url));
const source=readFileSync(new URL('../src/chat-formatting.js',import.meta.url),'utf8');
function fixture(parser=true){const context=createContext({URL});context.window=context;if(parser)runInContext(vendor.toString(),context,{timeout:1000});runInContext(source,context);return context.chatFormatting;}
const literal=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('chat parser browser artifact matches pinned upstream bytes and preserves its notice',()=>{
  assert.equal(vendor.length,8947);assert.equal(createHash('sha256').update(vendor).digest('hex'),'1f192e2ab1f661085d74c59129e1d2939d12e946edb07d3c55ffede36cf47734');
  assert.match(readFileSync(new URL('../src/vendor/BBob-LICENSE.txt',import.meta.url),'utf8'),/Copyright \(c\) 2018 Nikolay Kostyurin/);
});
test('chat display defaults to escaped literal text without changing the source',()=>{
  const ui=fixture(),body='[b]Original[/b]\n  <img src=x onerror="bad"> & words';
  assert.equal(ui.render(body),literal(body));assert.equal(ui.render(body,false),literal(body));assert.equal(body,'[b]Original[/b]\n  <img src=x onerror="bad"> & words');
  assert.equal(fixture(false).render(body,true),literal(body));
});
test('chat optional formatting supports bounded nested styles and palette colors',()=>{
  const ui=fixture();assert.equal(ui.render('[B]a [i]b[/i][/B] [u]c[/u] [s]d[/s]',true),'<strong>a <em>b</em></strong> <u>c</u> <s>d</s>');
  for(const color of ['black','gray','red','green','blue','teal','magenta'])assert.equal(ui.render(`[color=${color}]text[/color]`,true),`<span class="chat-color-${color}">text</span>`);
  assert.equal(ui.render('[color="#b4233b"]red[/color]',true),'<span class="chat-color-red">red</span>');
});
test('chat links allow only explicit HTTP(S) without credentials and escape attributes',()=>{
  const ui=fixture(),url='https://example.edu/a?x=1&y=2';
  assert.equal(ui.render(`[url=${url}][b]Label[/b][/url]`,true),`<a href="https://example.edu/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><strong>Label</strong></a>`);
  assert.match(ui.render('[url]https://example.edu[/url]',true),/href="https:\/\/example.edu\/"/);
  for(const value of ['javascript:alert(1)','data:text/html,bad','file:///c:/','//example.edu','/relative','mailto:a@example.edu','https://u:p@example.edu','https://example.edu\\@evil.test','https://example.edu/\nattack','https://example.edu/"x','https://example.edu/<x>','https://']){
    assert.equal(ui.link(value),null);const body=`[url=${value}]Label[/url]`;assert.equal(ui.render(body,true),literal(body));
  }
});
test('chat unsafe tags, malformed recovery and unsupported attributes stay wholly literal',()=>{
  const ui=fixture();for(const body of ['[b]x','[b]x[/i]','[b][i]x[/b][/i]','[url=https://example.edu][url=https://other.edu]x[/url][/url]','[img]https://example.edu/x.png[/img]','[color=red onclick=bad]x[/color]','[color=#ffffff]invisible[/color]','[b onclick=alert(1)]x[/b]','[url=javascript:alert(1)]x[/url]','[color=__proto__]x[/color]','[b __proto__=bad]x[/b]','[b]a[/b][/b]'])assert.equal(ui.render(body,true),literal(body),body);
  assert.equal(ui.render('[b]<script>alert(1)</script> & " \'[/b]',true),'<strong>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot; &#39;</strong>');
});
test('chat renderer enforces input, nesting and node limits with complete literal fallback',()=>{
  const ui=fixture();for(const body of ['[b]'+ 'x'.repeat(4001)+'[/b]','[b]'.repeat(14)+'x'+'[/b]'.repeat(14),'[b]'+' \n'.repeat(1000)+'[/b]'])assert.equal(ui.render(body,true),literal(body));
  assert.equal(ui.render('x'.repeat(4000),true),'x'.repeat(4000));
});
test('chat formatting escapes adversarial text in a deterministic bounded corpus',()=>{
  const ui=fixture(),parts=['[b]','[/b]','[color=red]','[/color]','[url=javascript:x]','[/url]','<img onerror=x>','" & \'','\n','[unknown]'];
  for(let i=0;i<250;i++){const body=Array.from({length:8},(_,j)=>parts[(i*7+j*j+3*j)%parts.length]).join('');const result=ui.render(body,true);assert.doesNotMatch(result,/<(?:script|img|iframe)|href="javascript:/);assert.ok(result.length<=32000);}
});
test('chat composer exposes explicit non-submit style, color and link controls',()=>{
  const ui=fixture(),html=ui.toolbar(true);assert.equal((html.match(/data-chat-wrap=/g)||[]).length,12);assert.equal((html.match(/type="button"/g)||[]).length,12);assert.equal((html.match(/ disabled/g)||[]).length,13);assert.match(html,/role="toolbar"/);assert.doesNotMatch(html,/name="body"|onclick=|style=/);
});
