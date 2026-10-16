import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ui=(extensions={})=>{const window={...extensions};runInNewContext(readFileSync(new URL('../src/message-rooms.js',import.meta.url),'utf8'),{window,Event:class{constructor(type){this.type=type;}}});return window.messageRoomsUI;};
const room={id:'r',membershipId:'m',membershipStatus:'accepted',consentRevision:1,createdBy:'other',role:'member'};
const workspace={items:[room],preferences:{enabled:true,revision:1},capabilities:{manage:false},accountId:'a',offset:0,total:1};
test('first room load with no previous workspace or selection renders metadata without history',async()=>{
  const module=ui(),state={},calls=[];
  const api=async(binding,method,path)=>{calls.push(path);return path.endsWith('/changes') ? {stamp:'first'} : workspace;};
  await module.load(state,api,{});assert.equal(state.rooms.selected,null);assert.equal(state.rooms.messages,null);assert.equal(calls.length,2);assert.equal(state.roomStamp,'first');
});
test('room refresh captures the change token before history and preserves drafts and checkbox choice',async()=>{
  const module=ui(),state={roomSelected:'r',roomDrafts:{body:'UNSENT'},roomPreferenceChoice:false},calls=[];let stamp='before';
  const api=async(binding,method,path)=>{calls.push(path);if(path.endsWith('/changes'))return {stamp};if(path.includes('?offset='))return workspace;if(path.endsWith('/messages')){stamp='after';return {items:[]};}throw new Error('Unexpected room request');};
  await module.load(state,api,{});assert.equal(calls[0],'/api/message-rooms/changes');assert.equal(state.roomStamp,'before');assert.equal(state.roomDrafts.body,'UNSENT');
  assert.match(module.view(state,false),/name="enabled" >Accept room invitations/);
});
test('loss of accepted room consent clears history drafts, pending commands and old cursors',async()=>{
  const module=ui(),state={roomSelected:'r',rooms:{...workspace,selected:room},roomDrafts:{body:'SECRET'},roomPending:{body:'SECRET'},roomBefore:'1'};
  const api=async(binding,method,path)=>path.endsWith('/changes') ? {stamp:'new'} : {...workspace,items:[{...room,membershipStatus:'banned'}]};
  await module.load(state,api,{});assert.equal(state.rooms.messages,null);assert.equal(state.roomPending,null);assert.equal(state.roomBefore,null);assert.equal(state.roomDrafts.body,undefined);assert.doesNotMatch(module.view(state,false),/SECRET/);
});
test('replacement membership clears an old draft even when the browser missed the intervening ban',async()=>{
  const module=ui(),state={roomSelected:'r',rooms:{...workspace,selected:room},roomDrafts:{body:'OLD'},roomPending:{body:'OLD'},roomBefore:'1'};
  const api=async(binding,method,path)=>path.endsWith('/changes') ? {stamp:'new'} : path.includes('?offset=') ? {...workspace,items:[{...room,membershipId:'new'}]} : {items:[]};
  await module.load(state,api,{});assert.equal(state.roomDrafts.body,undefined);assert.equal(state.roomPending,null);assert.equal(state.roomBefore,null);assert.equal(state.roomParticipation.membershipId,'new');
});
test('a denied history read does not lose the previous participation binding for the next refresh',async()=>{
  const module=ui(),state={roomSelected:'r',rooms:{...workspace,selected:room},roomDrafts:{body:'OLD'}};
  const denied=async(binding,method,path)=>{if(path.endsWith('/changes'))return {stamp:'new'};if(path.includes('?offset='))return workspace;state.rooms=null;throw new Error('Participation ended during read');};
  await assert.rejects(module.load(state,denied,{}));assert.equal(state.roomParticipation.membershipId,'m');
  const ended=async(binding,method,path)=>path.endsWith('/changes') ? {stamp:'ended'} : {...workspace,items:[{...room,membershipStatus:'removed'}]};
  await module.load(state,ended,{});assert.equal(state.roomDrafts.body,undefined);assert.equal(state.roomParticipation,null);
});
test('pending retry and discard controls are disabled during an in-flight refresh',()=>{
  const module=ui(),state={roomPending:{body:'OLD'}};
  assert.match(module.view(state,true),/data-room-retry disabled/);assert.match(module.view(state,true),/data-room-discard disabled/);
  assert.doesNotMatch(module.view(state,false),/data-room-retry disabled/);
});
test('reports render explicit disclosure, escaped evidence and independently restricted triage controls',()=>{
  const module=ui(),data={...workspace,capabilities:{report:true,triage:false},selected:room,messages:{items:[{id:'msg',authorId:'other',body:'<script>HOSTILE</script>',authorName:'Other',kind:'text',createdAt:'2026-10-10T10:00:00Z',hidden:false}]}};
  const state={rooms:data,roomReports:{items:[],total:0,offset:0,view:'own',status:'all'},roomReportDetail:{id:'q',title:'<img>',category:'privacy',status:'open',revision:0,body:'<script>DISCLOSED</script>',reason:'REASON',events:{items:[],total:0,offset:0}}};
  const html=module.view(state,false);assert.match(html,/Share this message and report with safety reviewers/);assert.match(html,/name="reportDisclose_msg".*required/);assert.match(html,/&lt;script&gt;DISCLOSED/);assert.doesNotMatch(html,/<script>|data-room-form="triage"|Safety review/);
  const safety=module.view({...state,rooms:{...data,capabilities:{report:true,triage:true}},roomReports:{...state.roomReports,view:'triage'},roomReportDetail:{...state.roomReportDetail,view:'triage'}},false);assert.match(safety,/data-room-form="triage"/);assert.match(safety,/>claim<\/option>/);
});
test('disconnected room forms and stale workspace buttons cannot restore drafts or initiate actions',()=>{
  const module=ui(),state={rooms:workspace},handlers={},field={name:'secret',value:'OLD',type:'text',isConnected:true,addEventListener(event,handler){handlers[event]=handler;}},form={dataset:{roomForm:'send'},isConnected:true,querySelectorAll(){return [field];},addEventListener(event,handler){handlers.submit=handler;}},button={isConnected:true,addEventListener(event,handler){handlers.click=handler;}};
  const root={querySelector(selector){return selector==='[data-room-refresh]'?button:null;},querySelectorAll(selector){return selector==='[data-room-form]'?[form]:[];}};let actions=0;
  module.bind(root,state,{act(){actions++;},api(){throw new Error('No request expected');}});
  state.rooms={...workspace};handlers.input();handlers.click();handlers.submit({preventDefault(){}});assert.equal(actions,0);assert.equal(state.roomDrafts,undefined);
  state.rooms=workspace;field.isConnected=false;form.isConnected=false;button.isConnected=false;handlers.input();handlers.click();handlers.submit({preventDefault(){}});assert.equal(actions,0);assert.equal(state.roomPending,undefined);
});
test('room switches isolate drafts and exact history cursors without loading background content',async()=>{
  const module=ui(),second={...room,id:'s',membershipId:'ms'},data={...workspace,items:[room,second]},state={roomSelected:'r',roomDrafts:{body:'FIRST'},roomBefore:'9007199254740993'};
  const calls=[],api=async(binding,method,path)=>{calls.push(path);return path.endsWith('/changes')?{stamp:'new'}:path.includes('?offset=')?data:{items:[]};};
  await module.load(state,api,{});module.switchRoom(state,'s');await module.load(state,api,{});assert.equal(state.roomDrafts.body,undefined);state.roomDrafts.body='SECOND';module.switchRoom(state,'r');await module.load(state,api,{});
  assert.equal(state.roomDrafts.body,'FIRST');assert.equal(state.roomBefore,'9007199254740993');assert.equal(state.roomContexts.s.drafts.body,'SECOND');assert.equal(state.roomTabs.length,2);assert.equal(calls.filter(path=>path.includes('/s/messages')).length,1);
});
test('off-page background participation loss clears only that room and its pending command',async()=>{
  const module=ui(),second={...room,id:'s',membershipId:'ms'},data={...workspace,items:[room,second]},state={roomSelected:'r'};
  const old=async(binding,method,path)=>path.endsWith('/changes')?{stamp:'old'}:path.includes('?offset=')?data:{items:[]};await module.load(state,old,{});module.switchRoom(state,'s');await module.load(state,old,{});state.roomDrafts.body='BACKGROUND SECRET';module.switchRoom(state,'r');state.roomDrafts.body='ACTIVE DRAFT';
  state.roomPending={suffix:'/s/messages',body:{body:'BACKGROUND SECRET'}};const calls=[];
  const next=async(binding,method,path)=>{calls.push(path);if(path.endsWith('/changes'))return {stamp:'new'};if(path.includes('?offset='))return {...data,items:[],capabilities:{summary:true}};if(path.endsWith('/r'))return {room,preferences:data.preferences,capabilities:data.capabilities};if(path.endsWith('/s'))return {room:{...second,membershipStatus:'banned'},preferences:data.preferences,capabilities:data.capabilities};return {items:[]};};
  await module.load(state,next,{});assert.equal(state.roomContexts.s,undefined);assert.equal(state.roomTabs.length,1);assert.equal(state.roomDrafts.body,'ACTIVE DRAFT');assert.equal(state.roomPending,null);assert.equal(state.rooms.selected.id,'r');assert.equal(calls.includes('/api/message-rooms/s/messages'),false);
});
test('missed background reacceptance cannot revive an old membership draft',async()=>{
  const module=ui(),state={roomSelected:'r',roomTabs:[{id:'s',title:'Second'}],roomContexts:{s:{membershipId:'old',consentRevision:1,role:'member',moderates:false,drafts:{body:'OLD'},before:'99'}},roomDrafts:{body:'ACTIVE'}};
  const api=async(binding,method,path)=>path.endsWith('/changes')?{stamp:'new'}:path.includes('?offset=')?{...workspace,capabilities:{summary:true}}:path.endsWith('/s')?{room:{...room,id:'s',membershipId:'new'},preferences:workspace.preferences,capabilities:workspace.capabilities}:path.endsWith('/r')?{room,preferences:workspace.preferences,capabilities:workspace.capabilities}:{items:[]};
  await module.load(state,api,{});assert.equal(state.roomContexts.s,undefined);assert.equal(state.roomTabs.some(tab=>tab.id==='s'),false);assert.equal(state.roomDrafts.body,'ACTIVE');
});
test('room authority denial preserves at most an opaque selection hint, never private contexts or retry',()=>{
  const module=ui(),state={mode:'rooms',roomSelected:'r',roomTabs:[{id:'r',title:'PRIVATE TITLE'}],roomContexts:{r:{drafts:{body:'PRIVATE BODY'}}},roomPending:{body:'PRIVATE RETRY'},roomCaseDrafts:{details:'PRIVATE REVIEW'},roomDefinitionDrafts:{purpose:'PRIVATE PURPOSE'}};
  module.clearAccess(state,true);assert.deepEqual(state,{mode:'rooms',roomSelected:'r'});
  module.clearAccess(state);assert.deepEqual(state,{mode:'rooms'});
});

test('global target authority invalidation clears visible administrative drafts but preserves composer and report data',()=>{
  const callbacks=[],target={controls:()=>'',bindForm(form,options){callbacks.push(options);}},module=ui({roomCommandHistoryUI:{create:()=>target}});
  const drafts={body:'COMPOSER',kind:'action',email:'INVITATION',reason_m1:'MEMBER',reason_msg1:'MODERATION',memberOperation_m1:'ban',reportReason_msg1:'REPORT',reportDisclose_msg1:true};
  const background={body:'BACKGROUND',reason_m2:'OLD',memberOperation_m2:'remove'},state={rooms:{...workspace,selected:room},roomDrafts:drafts,roomContexts:{s:{drafts:background}}};
  function field(name,value,options){return {name,value,type:options?'select-one':'textarea',options,isConnected:true,events:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},dispatchEvent(event){this.events.push(event.type);this.handlers[event.type]?.(event);}};}
  const operation=field('operation','ban',[{value:'remove'},{value:'ban'}]),memberReason=field('reason_m1','MEMBER'),moderationReason=field('reason_msg1','MODERATION'),buttons=[];
  function form(dataset,fields){const button={disabled:false,insertAdjacentHTML(){}};buttons.push(button);return {dataset,isConnected:true,querySelector(selector){return selector==='button'?button:operation;},querySelectorAll(selector){return selector==='[data-command-history]'?[button]:fields;},addEventListener(){}};}
  const forms=[form({roomForm:'member',member:'m1',revision:'1'},[operation,memberReason]),form({roomForm:'moderate',message:'msg1',revision:'0',hidden:'true'},[moderationReason])];
  const root={querySelector:()=>null,querySelectorAll(selector){return selector==='[data-room-form]' || selector==='[data-room-form="member"],[data-room-form="moderate"]'?forms:[];}};
  let actions=0;module.bind(root,state,{act(){actions++;},api(){throw new Error('No request expected');}});assert.equal(callbacks.length,2);
  callbacks[0].onInvalidate(callbacks[0].descriptor,true);
  assert.equal(memberReason.value,'');assert.equal(moderationReason.value,'');assert.equal(operation.value,'');assert.ok(buttons.every(button=>button.disabled));
  assert.equal(drafts.body,'COMPOSER');assert.equal(drafts.kind,'action');assert.equal(drafts.email,'INVITATION');assert.equal(drafts.reportReason_msg1,'REPORT');assert.equal(drafts.reportDisclose_msg1,true);assert.equal(background.body,'BACKGROUND');assert.equal(background.reason_m2,undefined);assert.equal(background.memberOperation_m2,undefined);assert.equal(actions,0);
});

test('advertised invitation context binds ordinary moderators and preserves the supplied frozen command key',async()=>{
  let captured;const invitations={render:()=>'<select data-invitation-contact></select>',bindForm(form,options){captured=options;},submit(){assert.fail('Only explicit form submission may call the adapter');}};
  const module=ui({roomInvitationHistory:{},roomInvitationHistoryUI:{create:()=>invitations}}),selected={...room,status:'active',role:'moderator'},data={...workspace,selected,capabilities:{manage:false,invitationContext:true}},state={rooms:data,roomSelected:'r'},actions=[],requests=[],errors=[],contextCalls=[];
  const field={name:'email',type:'text',value:'PEER@example.edu',isConnected:true,addEventListener(){}},button={insertAdjacentHTML(position,html){assert.equal(position,'beforebegin');assert.match(html,/data-invitation-contact/);}},form={dataset:{roomForm:'invite'},isConnected:true,querySelector(){return button;},querySelectorAll(){return [field];},addEventListener(){}};
  const root={querySelector:()=>null,querySelectorAll(selector){return selector==='[data-room-form]'?[form]:[];}};
  module.bind(root,state,{act(work){actions.push(work);},api:async(binding,method,path,body)=>{requests.push({method,path,body});throw new Error('Lost reply');},invitationContext:async(id,email)=>{contextCalls.push({id,email});return 'context';},onInvitationError:error=>errors.push(error)});
  assert.equal(captured.current(),true);assert.equal(await captured.request('PEER@example.edu'),'context');assert.deepEqual(contextCalls,[{id:'r',email:'PEER@example.edu'}]);
  const key='room_supplied_frozen_key_001';captured.send({email:'PEER@example.edu',requestKey:key});assert.equal(state.roomPending.suffix,'/r/members');assert.deepEqual(JSON.parse(JSON.stringify(state.roomPending.body)),{email:'PEER@example.edu',requestKey:key});
  for(let i=0;i<2;i++)await assert.rejects(actions[0]({}),/Lost reply/);assert.equal(requests.length,2);assert.equal(requests[0].body.requestKey,key);assert.equal(requests[1].body.requestKey,key);assert.equal(requests[1].body.email,'PEER@example.edu');
  const error=Object.assign(new Error('Unavailable contact'),{statusCode:404});captured.onError(error);assert.equal(errors[0],error);
});

test('room and access cleanup explicitly forget or reset invitation history',()=>{
  const calls=[],history={forgetRoom:id=>calls.push(['forget',id]),reset:()=>calls.push(['reset'])},module=ui(),state={roomInvitationHistory:history,roomSelected:'r',roomDrafts:{email:'PRIVATE'},roomContexts:{r:{drafts:{email:'PRIVATE'}}}};
  module.forgetRoom(state,'r');assert.deepEqual(calls,[['forget','r']]);assert.equal(state.roomDrafts.email,undefined);module.clearAccess(state);assert.deepEqual(calls,[['forget','r'],['reset']]);assert.equal(state.roomInvitationHistory,undefined);
});
