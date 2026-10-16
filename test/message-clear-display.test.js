import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function fixture(kind) {
  const window={};runInNewContext(readFileSync(new URL(`../src/${kind==='private'?'private-messages':'message-rooms'}.js`,import.meta.url),'utf8'),{window});
  const ui=kind==='private'?window.privateMessagesUI:window.messageRoomsUI,prefix=kind==='private'?'private':'room';
  const prefs={enabled:true,revision:1},row={id:'a',status:kind==='private'?'accepted':'active',revision:2,blockRevision:0,peerName:'Peer',unread:3,membershipId:'m',membershipStatus:'accepted',consentRevision:1,role:'member',createdBy:'other'};
  const state={[`${prefix}Selected`]:'a'},requests=[],rows=[row];
  const item=(id,position)=>({id,position,body:`BODY_${id}`,createdAt:'2026-10-10T10:00:00Z',authorId:'other',authorName:'Peer',kind:'text'});
  let items=[item('old','9007199254740995')],nextBefore='9007199254740995';
  const api=async(binding,method,path,body)=>{
    requests.push({method,path,body});
    if(method!=='GET')return {};
    if(path.endsWith('/changes'))return {stamp:'change'};
    if(path.endsWith('/preferences'))return prefs;
    if(path.includes('/messages'))return {items,nextBefore,status:row.status,revision:row.revision};
    if(kind==='private')return {items:rows,offset:0,total:rows.length};
    return {items:rows,preferences:prefs,capabilities:{manage:false},accountId:'me',offset:0,total:rows.length};
  };
  async function click(action,detached=false) {
    let handler,pending;
    const button={isConnected:!detached,addEventListener(event,fn){handler=fn;}};
    const root={querySelector(selector){return selector===`[data-${prefix}-${action}]`?button:null;},querySelectorAll(){return [];}};
    ui.bind(root,state,{api,act(work){pending=work({});}});handler({});await pending;
  }
  return {ui,state,row,rows,prefs,requests,item,click,setItems(value){items=value;},load:()=>ui.load(state,api,{}),html:()=>ui.view(state,false),display:()=>state[`${prefix}Displays`]?.a};
}

for(const kind of ['private','room']) {
  test(`${kind} display clear hides only observed IDs, preserves drafts and exposes late lower-position commits`,async()=>{
    const f=fixture(kind);await f.load();f.state[kind==='private'?'privateDraft':'roomDrafts']=kind==='private'?'UNSENT':{body:'UNSENT',reportReason_old:'REASON'};
    await f.click('clear');assert.doesNotMatch(f.html(),/BODY_old/);assert.match(f.html(),/UNSENT/);assert.equal(f.display().ids.length,1);
    if(kind==='private')assert.doesNotMatch(f.html(),/data-private-read/);
    await f.load();assert.doesNotMatch(f.html(),/BODY_old/);
    f.setItems([f.item('new','9007199254740996'),f.item('old','9007199254740995'),f.item('late','9007199254740993')]);await f.load();
    assert.match(f.html(),/BODY_new/);assert.match(f.html(),/BODY_late/);assert.doesNotMatch(f.html(),/BODY_old/);
    assert.ok(f.requests.every(request=>request.method==='GET'));
    await f.click('restore');assert.match(f.html(),/BODY_old/);assert.equal(f.display().ids.length,0);
    if(kind==='private'){await f.click('clear');f.setItems([f.item('old','9007199254740995'),f.item('later','9007199254740991')]);await f.load();await f.click('read');assert.equal(f.requests.findLast(request=>request.method==='POST').body.through,'9007199254740991');}
  });
  test(`${kind} display filters retain temporarily absent IDs, bound repeated clears and reset on exact cursor navigation`,async()=>{
    const f=fixture(kind);await f.load();await f.click('clear');
    for(let i=0;i<40;i++){f.setItems([f.item(`next${i}`,String(9000+i))]);await f.load();await f.click('clear');assert.equal(f.display().ids.length,i+2);}
    f.setItems([f.item('old','9007199254740995')]);await f.load();assert.doesNotMatch(f.html(),/BODY_old/);
    f.display().ids=Array.from({length:4096},(_,i)=>`hidden${i}`);assert.match(f.html(),new RegExp(`data-${kind==='private'?'private':'room'}-clear disabled`));await assert.rejects(f.click('clear'),/Restore the display/);assert.equal(f.display().ids.length,4096);
    f.setItems([f.item('next39','9039')]);await f.load();
    await f.click('older');assert.equal(f.display().ids.length,0);assert.match(f.html(),/BODY_next39/);
    assert.match(f.requests.findLast(request=>request.path.includes('/messages')).path,/before=9007199254740995$/);
    await f.click('clear');await f.click('newest');assert.equal(f.display().ids.length,0);
  });
  test(`${kind} clear and restore stay local to their tab`,async()=>{
    const f=fixture(kind);f.rows.push({...f.row,id:'b',membershipId:'mb'});await f.load();await f.click('clear');
    const select=id=>kind==='private'?f.ui.switchConversation(f.state,id):f.ui.switchRoom(f.state,id);
    select('b');await f.load();assert.match(f.html(),/BODY_old/);await f.click('clear');
    select('a');await f.load();assert.doesNotMatch(f.html(),/BODY_old/);await f.click('restore');assert.match(f.html(),/BODY_old/);
    select('b');await f.load();assert.doesNotMatch(f.html(),/BODY_old/);
  });
  test(`${kind} display filters do not survive authority replacement or detached controls`,async()=>{
    const f=fixture(kind);await f.load();await f.click('clear',true);assert.equal(f.display().ids.length,0);
    await f.click('clear');if(kind==='private')f.prefs.revision++;else f.row.membershipId='replacement';
    await f.load();assert.equal(f.display().ids.length,0);assert.match(f.html(),/BODY_old/);
    await f.click('clear');if(kind==='private'){f.row.status='closed';f.row.revision++;}else f.row.membershipStatus='banned';
    await f.load();if(kind==='private'){assert.match(f.html(),/BODY_old/);await f.click('clear');assert.doesNotMatch(f.html(),/BODY_old/);await f.click('restore');assert.match(f.html(),/BODY_old/);}else assert.equal(f.display(),undefined);
  });
}
