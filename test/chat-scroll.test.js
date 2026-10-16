import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/chat-scroll.js',import.meta.url),'utf8');
function fixture(){const window={};runInNewContext(source,{window});return window.chatScroll;}
function viewport(positions=['1','2'],extent=1000){
  const handlers=new Map();return {isConnected:true,hidden:false,clientHeight:300,scrollHeight:extent+300,scrollTop:0,
    rows:positions.map((position,index)=>({dataset:{chatPosition:position},getBoundingClientRect(){return {height:40+index*10};}})),
    closest(){return this.hidden?{}:null;},matches(){return true;},querySelectorAll(){return this.rows;},
    addEventListener(name,handler,options){handlers.set(name,{handler,options});},handlers};
}
const records=(...positions)=>positions.map(position=>({position,body:'Private body never cached'}));

test('history scroll starts at newest and captures exact pixels without bodies or keyboard interception',()=>{
  const ui=fixture(),context={},node=viewport();ui.bind(node,context,'latest',records('1','2'),()=>true);assert.equal(node.scrollTop,1000);node.scrollTop=123;node.handlers.get('scroll').handler();assert.equal(context.historyScroll.pages[0].top,123);assert.equal(context.historyScroll.pages[0].high,'2');assert.doesNotMatch(JSON.stringify(context),/Private body/);assert.deepEqual([...node.handlers.keys()],['scroll']);assert.equal(node.handlers.get('scroll').options.passive,true);
});

test('redraw restores pixels and advances only by newly rendered batch heights including notices and own messages',()=>{
  const ui=fixture(),context={},first=viewport();ui.bind(first,context,'latest',records('1','2'),()=>true);first.scrollTop=100;ui.capture(first);first.isConnected=false;
  const redraw=viewport(['1','2','3','4']);ui.bind(redraw,context,'latest',records('4','3','2','1'),()=>true);assert.equal(redraw.scrollTop,230);ui.restore(redraw);assert.equal(redraw.scrollTop,230);
  const replay=viewport(['1','2','3','4']);ui.bind(replay,context,'latest',records('1','2','3','4'),()=>true);assert.equal(replay.scrollTop,230);
});

test('moderation, formatting and old replay do not advance or regress the highest seen position',()=>{
  const ui=fixture(),context={},first=viewport(['10','11']);ui.bind(first,context,'latest',records('10','11'),()=>true);first.scrollTop=200;ui.capture(first);
  const old=viewport(['1','2']);ui.bind(old,context,'latest',records('1','2'),()=>true);assert.equal(old.scrollTop,200);assert.equal(context.historyScroll.pages[0].high,'11');const restored=viewport(['10','11']);ui.bind(restored,context,'latest',records('10','11'),()=>true);assert.equal(restored.scrollTop,200);
});

test('hidden thread/workspace delays new-row movement until visible exactly once',()=>{
  const ui=fixture(),context={},first=viewport();ui.bind(first,context,'latest',records('1','2'),()=>true);first.scrollTop=150;ui.capture(first);
  const hidden=viewport(['1','2','3']);hidden.hidden=true;hidden.clientHeight=0;ui.bind(hidden,context,'latest',records('1','2','3'),()=>true);ui.capture(hidden);ui.restore(hidden);assert.equal(context.historyScroll.pages[0].top,150);assert.equal(context.historyScroll.pages[0].high,'2');hidden.hidden=false;hidden.clientHeight=300;ui.restore(hidden);assert.equal(hidden.scrollTop,210);assert.equal(context.historyScroll.pages[0].high,'3');ui.restore(hidden);assert.equal(hidden.scrollTop,210);
});

test('background contexts retain independent offsets and deferred batches without sharing bodies',()=>{
  const ui=fixture(),a={},b={},first=viewport();ui.bind(first,a,'latest',records('1','2'),()=>true);first.scrollTop=111;ui.capture(first);const other=viewport();ui.bind(other,b,'latest',records('1','2'),()=>true);other.scrollTop=222;ui.capture(other);
  const returned=viewport(['1','2','3']);ui.bind(returned,a,'latest',records('1','2','3'),()=>true);assert.equal(returned.scrollTop,171);const unchanged=viewport();ui.bind(unchanged,b,'latest',records('1','2'),()=>true);assert.equal(unchanged.scrollTop,222);
});

test('native pagination restores independent page offsets with at most eight LRU snapshots',()=>{
  const ui=fixture(),context={},latest=viewport();ui.bind(latest,context,'latest',records('40','41'),()=>true);latest.scrollTop=125;ui.capture(latest);const older=viewport(['10','11']);ui.bind(older,context,'40',records('10','11'),()=>true);assert.equal(older.scrollTop,1000);older.scrollTop=375;ui.capture(older);const returned=viewport();ui.bind(returned,context,'latest',records('40','41'),()=>true);assert.equal(returned.scrollTop,125);
  for(let i=1;i<=9;i++)ui.bind(viewport(),context,String(i),records('1','2'),()=>true);assert.equal(context.historyScroll.pages.length,8);assert.equal(context.historyScroll.pages.some(page=>page.key==='latest'),false);assert.equal(context.historyScroll.pages[0].key,'2');
});

test('authority/session disposal and detached scroll events cannot mutate or restore old snapshots',()=>{
  const ui=fixture(),context={},node=viewport();let current=true;ui.bind(node,context,'latest',records('1','2'),()=>current);const before=JSON.stringify(context);current=false;node.scrollTop=99;node.handlers.get('scroll').handler();ui.capture(node);ui.restore(node);assert.equal(JSON.stringify(context),before);current=true;node.isConnected=false;node.handlers.get('scroll').handler();assert.equal(JSON.stringify(context),before);
});

test('large database positions compare exactly and unsafe positions/keys/oversized pages are refused',()=>{
  const ui=fixture(),context={},node=viewport(['9007199254740992']);ui.bind(node,context,'latest',records('9007199254740992'),()=>true);node.scrollTop=100;ui.capture(node);const next=viewport(['9007199254740992','9007199254740993']);ui.bind(next,context,'latest',records('9007199254740993'),()=>true);assert.equal(next.scrollTop,150);
  for(const key of ['0','-1','1e3','x'.repeat(20),'9223372036854775808']){const invalid={};ui.bind(viewport(),invalid,key,records('1'),()=>true);assert.deepEqual(invalid,{});}const oversized={};ui.bind(viewport(),oversized,'latest',Array.from({length:31},()=>({position:'1'})),()=>true);assert.deepEqual(oversized,{});
  const malformed={},raw=viewport(['9223372036854775808','1e3']);ui.bind(raw,malformed,'latest',records('9223372036854775808','1e3'),()=>true);assert.equal(malformed.historyScroll.pages[0].high,null);
});

test('scroll extent and cached pixels are bounded and clamp after local clearing/resizing',()=>{
  const ui=fixture(),context={},node=viewport();ui.bind(node,context,'latest',records('1','2'),()=>true);node.scrollTop=Infinity;ui.capture(node);assert.equal(context.historyScroll.pages[0].top,0);node.scrollTop=20000000;ui.capture(node);assert.equal(context.historyScroll.pages[0].top,10000000);const cleared=viewport([],0);ui.bind(cleared,context,'latest',records('1','2'),()=>true);assert.equal(cleared.scrollTop,0);const smaller=viewport(['1','2'],50);ui.bind(smaller,context,'latest',records('1','2'),()=>true);assert.equal(smaller.scrollTop,0);
});

test('root capture/restore visits only current scroll panes and a fresh context starts anew',()=>{
  const ui=fixture(),old={},first=viewport();ui.bind(first,old,'latest',records('1','2'),()=>true);first.scrollTop=55;const root={querySelectorAll(){return [first];}};ui.capture(root);assert.equal(old.historyScroll.pages[0].top,55);ui.restore(root);assert.equal(first.scrollTop,55);const fresh={},replacement=viewport();ui.bind(replacement,fresh,'latest',records('1','2'),()=>true);assert.equal(replacement.scrollTop,1000);
});

test('deployment pane height distinguishes the public default and empty fallback with bounded pixels only',()=>{
  const ui=fixture();assert.equal(ui.height(undefined),440);assert.equal(ui.height(''),300);
  for(const value of ['120','240','440','900'])assert.equal(ui.height(value),Number(value));
  for(const value of ['119','901','440px','50vh',' 440','440 ','0','440; color:red','4e2',160,{},null])assert.equal(ui.height(value),440);
});

test('pane binding applies only sanitized deployment dimensions before calculating actual scroll extent',()=>{
  const window={document:{querySelector(){return {content:'240'};}}};runInNewContext(source,{window});const node=viewport(),styles=[];node.style={setProperty(name,value){styles.push([name,value]);}};window.chatScroll.bind(node,{},'latest',records('1','2'),()=>true);assert.deepEqual(styles,[['--chat-history-height','240px']]);assert.equal(node.scrollTop,1000);
});
