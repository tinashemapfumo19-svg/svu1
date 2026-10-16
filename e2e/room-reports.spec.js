import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {createMessageRoomsModule} from '../server/modules/message-rooms.js';
import {loadConfig} from '../server/config.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Reports require an isolated database.');
test.use({actionTimeout:15000});
test('explicit room reports retain disclosed evidence and independently owned safety case history',async({page,browser,request},info)=>{
  test.setTimeout(360000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),path='/api/message-rooms',stamp=`${info.project.name}.${Date.now()}`,errors=[];
  page.on('pageerror',error=>errors.push(error.message));let reviewContext;
  try{
    const owner=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const ownerId=(await api('GET',path,undefined,owner.token)).accountId;
    const reporter=await account('reporter'),author=await account('author'),approver=await account('approver'),reviewer=await account('safety'),peer=await account('peer');
    await appoint(approver,'room_approver');const appointment=await appoint(reviewer,'room_safety_reviewer');await appoint(peer,'room_safety_reviewer');
    for(const session of [owner,reporter,author]){const pref=(await api('GET',path,undefined,session.token)).preferences;await api('PUT',`${path}/preferences`,{revision:pref.revision,enabled:true,requestKey:key()},session.token);}
    const room=await api('POST',path,{title:`Report room ${stamp}`,purpose:'Isolated abuse reporting fixture',policyReference:'TEST-ROOM-POLICY',retentionRule:'Isolated verification evidence only',requestKey:key()},owner.token),base=`${path}/${room.id}`;
    await api('POST',`${base}/activate`,{revision:1,requestKey:key()},approver.token);await api('POST',`${base}/join`,{requestKey:key()},owner.token);
    const old=await send(owner,'Before the reporter accepted');let membership;
    for(const session of [reporter,author]){const invite=await api('POST',`${base}/members`,{email:session.email,requestKey:key()},owner.token);const accepted=await api('POST',`${base}/members/${invite.id}/accept`,{revision:1,requestKey:key()},session.token);if(session===reporter)membership=accepted;}
    const message=await send(author,'DISCLOSED <img src=x onerror="window.reportLeak=1"> evidence'),self=await send(reporter,'Own message'),hidden=await send(owner,'HIDDEN NOT DISCLOSED');
    await api('POST',`${base}/messages/${hidden.id}/moderate`,{revision:0,hidden:true,reason:'Isolated hidden content',requestKey:key()},owner.token);
    const reportInput={category:'privacy',reason:'REPORT REASON <script>not executable</script>',disclose:true,requestKey:key()};
    for(const id of [old.id,self.id,hidden.id,'nonexistent'])await api('POST',`${base}/messages/${id}/report`,{...reportInput,requestKey:key()},reporter.token,404);
    await api('POST',`${base}/messages/${message.id}/report`,{...reportInput,disclose:false},reporter.token,400);
    await api('POST',`${base}/messages/${message.id}/report`,{...reportInput,body:'Forged message'},reporter.token,400);
    await api('GET',`${path}/reports?offset=0&offset=1`,undefined,reporter.token,400);
    await api('GET',`${path}/reports?view=triage`,undefined,approver.token,403);
    const originalStamp=await api('GET',`${path}/changes`,undefined,reviewer.token);
    await open(page,reporter);await page.locator(`[data-room-select="${room.id}"]`).click();await ready(page);
    const reportForm=page.locator(`[data-room-form="report"][data-message="${message.id}"]`);await reportForm.locator('..').locator('summary').click();
    await reportForm.locator(`[name="reportCategory_${message.id}"]`).selectOption('privacy');await reportForm.locator('textarea').fill(reportInput.reason);await reportForm.locator('input[type="checkbox"]').check();
    let reportId,committed=false;const url=`${base}/messages/${message.id}/report`;
    await page.route(`**${url}`,async route=>{const response=await route.fetch();expect(response.status()).toBe(200);reportId=(await response.json()).data.id;committed=true;await route.abort('failed');});
    await reportForm.getByRole('button',{name:'Submit report'}).click();await expect.poll(()=>committed).toBe(true);await expect(page.locator('[data-room-retry]')).toBeEnabled();
    await page.unroute(`**${url}`);await page.locator('[data-room-retry]').click();await expect(page.locator('[data-room-retry]')).toHaveCount(0);await ready(page);
    await expect(page.locator(`[data-room-report-detail="${reportId}"]`)).toContainText('DISCLOSED <img');expect(await page.evaluate(()=>window.reportLeak)).toBeUndefined();
    const retained=(await pool.query('select envelope from room_abuse_reports where id=$1',[reportId])).rows[0].envelope;expect(retained).not.toContain('DISCLOSED');expect(retained).not.toContain('REPORT REASON');
    expect((await pool.query('select count(*)::int as total from room_abuse_reports where message_id=$1 and reporter_id=$2',[message.id,reporter.accountId])).rows[0].total).toBe(1);
    expect(await api('GET',`${path}/changes`,undefined,reviewer.token)).not.toEqual(originalStamp);
    await api('GET',`${path}/reports/${reportId}`,undefined,author.token,404);await api('GET',`${path}/reports/${reportId}?view=triage`,undefined,owner.token,403);
    await appoint(author,'room_safety_reviewer');await appoint(reporter,'room_safety_reviewer');
    for(const session of [author,reporter])await api('GET',`${path}/reports/${reportId}?view=triage`,undefined,session.token,403);
    await api('GET',`${base}/messages`,undefined,reviewer.token,404);await api('GET',`${base}/members`,undefined,reviewer.token,404);
    await api('POST',`${path}/reports/${reportId}/triage`,decision(0,'resolve'),reviewer.token,409);
    reviewContext=await browser.newContext({baseURL:process.env.SVU_BASE_URL});const review=await reviewContext.newPage();review.on('pageerror',error=>errors.push(error.message));await open(review,reviewer);
    await review.locator('[data-room-report-view="triage"]').click();await ready(review);await review.locator(`[data-room-report-select="${reportId}"]`).click();await ready(review);
    const details='STAFF REVIEW PRIVATE <img src=x>';
    await reviewCommand('claim',details);expect((await api('GET',`${path}/reports/${reportId}`,undefined,reporter.token)).events.items[0]).not.toHaveProperty('details');
    await api('POST',`${path}/reports/${reportId}/triage`,decision(1,'resolve'),peer.token,409);
    for(const operation of ['release','claim','dismiss','reopen','claim','resolve'])await reviewCommand(operation,details);
    let state=await api('GET',`${path}/reports/${reportId}?view=triage`,undefined,reviewer.token);expect(state).toMatchObject({status:'resolved',revision:7});expect(JSON.stringify(await api('GET',`${path}/reports/${reportId}`,undefined,reporter.token))).not.toContain('STAFF REVIEW PRIVATE');
    const second=await send(author,'SECOND REPORT'),secondInput={...reportInput,requestKey:key()},secondReport=await api('POST',`${base}/messages/${second.id}/report`,secondInput,reporter.token);
    expect(await api('POST',`${base}/messages/${second.id}/report`,secondInput,reporter.token)).toEqual(secondReport);
    await api('POST',`${base}/messages/${message.id}/report`,secondInput,reporter.token,409);
    await api('POST',`${base}/messages/${second.id}/report`,{...secondInput,reason:'Changed reuse'},reporter.token,409);
    const claims=await Promise.all([reviewer,peer].map(session=>request.post(`${path}/reports/${secondReport.id}/triage`,{data:decision(0,'claim'),headers:{Authorization:`Bearer ${session.token}`}})));expect(claims.map(row=>row.status()).sort()).toEqual([200,409]);
    const winner=claims[0].status()===200?reviewer:peer;await api('POST',`${path}/reports/${secondReport.id}/triage`,decision(1,'release'),winner.token);
    const faultMessage=await send(author,'FAULT INTAKE'),actor={accountId:reporter.accountId,roles:[{scope:{},permissions:['rooms.self']}]},safetyActor={accountId:reviewer.accountId,roles:[{scope:{},permissions:['rooms.triage']}]};
    const faultReport={...reportInput,requestKey:key()},faultDecision=decision(7,'reopen');
    for(const [method,args,who] of [['reportRoomMessage',[room.id,faultMessage.id,faultReport],actor],['triageRoomReport',[reportId,faultDecision],safetyActor],['triageRoomReport',[secondReport.id,decision(2,'claim')],safetyActor]])await rollbackPositions(method,args,who);
    await api('POST',`${path}/reports/${secondReport.id}/triage`,decision(2,'claim'),reviewer.token);
    for(const operation of ['release','resolve','dismiss'])await rollbackPositions('triageRoomReport',[secondReport.id,decision(3,operation)],safetyActor);
    await api('POST',`${path}/reports/${secondReport.id}/triage`,decision(3,'release'),reviewer.token);
    const lockedInput=decision(4,'claim'),beforeClaim=await counts();
    const lockedClaim=await revokeDuring('triageRoomReport',[secondReport.id,lockedInput],safetyActor,sql=>sql.startsWith('insert into room_abuse_events'));
    expect(lockedClaim).toMatchObject({id:secondReport.id,revision:5,status:'reviewing'});
    const afterClaim=await counts();expect(afterClaim).toEqual({...beforeClaim,room_abuse_events:beforeClaim.room_abuse_events+1,room_message_receipts:beforeClaim.room_message_receipts+1,audit:beforeClaim.audit+1});
    const beforeReplay=await counts();expect(await revokeDuring('triageRoomReport',[secondReport.id,lockedInput],safetyActor,sql=>sql.startsWith('select input_hash,result from room_message_receipts'))).toEqual(lockedClaim);expect(await counts()).toEqual(beforeReplay);
    const beforeRead=await counts();const lockedDetail=await revokeDuring('roomReportDetail',[reportId,{view:'triage'}],safetyActor,sql=>sql.startsWith('select revision,operation,status,assignee_id'));
    expect(lockedDetail).toMatchObject({id:reportId,revision:7,status:'resolved'});expect(lockedDetail.body).toContain('DISCLOSED');expect(await counts()).toEqual(beforeRead);
    await api('POST',`${path}/reports/${secondReport.id}/triage`,decision(5,'release'),reviewer.token);
    await api('POST',`${base}/messages/${message.id}/moderate`,{revision:0,hidden:true,reason:'After explicit disclosure',requestKey:key()},owner.token);
    expect((await api('GET',`${path}/reports/${reportId}?view=triage`,undefined,reviewer.token)).body).toContain('DISCLOSED');
    await api('POST',`${base}/members/${membership.id}/leave`,{revision:membership.revision,requestKey:key()},reporter.token);await api('GET',`${base}/messages`,undefined,reporter.token,404);
    await api('PUT',`${path}/preferences`,{revision:1,enabled:false,requestKey:key()},reporter.token);expect((await api('GET',`${path}/reports/${reportId}`,undefined,reporter.token)).status).toBe('resolved');
    await api('POST',`${base}/messages/${second.id}/report`,secondInput,reporter.token,404);
    // Case-history pages retain older events; terminal review never erases the intake.
    await api('POST',`${path}/reports/${reportId}/triage`,decision(7,'reopen'),reviewer.token);for(let i=0;i<13;i++){await api('POST',`${path}/reports/${reportId}/triage`,decision(8+i*2,'claim'),reviewer.token);await api('POST',`${path}/reports/${reportId}/triage`,decision(9+i*2,'release'),reviewer.token);}
    expect((await api('GET',`${path}/reports/${reportId}?view=triage&offset=25`,undefined,reviewer.token)).events.items.length).toBeGreaterThan(0);
    // The isolated author has at most 29 posts; a fresh reporter stays below the daily intake limit.
    const paging=await account('paging');await api('PUT',`${path}/preferences`,{revision:0,enabled:true,requestKey:key()},paging.token);const invited=await api('POST',`${base}/members`,{email:paging.email,requestKey:key()},owner.token);await api('POST',`${base}/members/${invited.id}/accept`,{revision:1,requestKey:key()},paging.token);
    for(let i=0;i<26;i++){const msg=await send(author,`PAGING ${i}`);await api('POST',`${base}/messages/${msg.id}/report`,{...reportInput,requestKey:key()},paging.token);}
    const queue=await api('GET',`${path}/reports?view=triage&offset=25`,undefined,reviewer.token);expect(queue.items.length).toBeGreaterThan(0);expect(JSON.stringify(queue)).not.toContain('REPORT REASON');
    const closedMessage=await send(author,'VISIBLE AFTER CLOSURE');
    for(const session of [author,paging])await api('PUT','/api/private-messages/preferences',{revision:0,enabled:true},session.token);
    const contact=await api('POST','/api/private-messages/conversations',{email:author.email,requestKey:key()},paging.token);
    await api('POST',`/api/private-messages/conversations/${contact.id}/block`,{revision:0,blocked:true},paging.token);
    await api('POST',`${base}/messages/${closedMessage.id}/report`,{...reportInput,requestKey:key()},paging.token,404);
    await api('POST',`/api/private-messages/conversations/${contact.id}/block`,{revision:1,blocked:false},paging.token);
    await api('POST',`${base}/close`,{revision:2,requestKey:key()},approver.token);
    await api('POST',`${base}/messages/${closedMessage.id}/report`,{...reportInput,requestKey:key()},paging.token);
    await review.locator('[data-room-refresh]').click();await ready(review);await review.locator('[data-room-report-page="events"][data-offset="25"]').click();await ready(review);
    await expect(review.locator('[data-room-report-detail]')).toContainText('STAFF REVIEW PRIVATE');await review.locator('[data-room-report-page="queue"][data-offset="25"]').click();await ready(review);
    expect(await review.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await review.locator('[data-room-report-detail] > header').scrollIntoViewIfNeeded();await review.screenshot({path:info.outputPath('room-report-triage.png')});
    await expect(review.locator('[data-room-form="triage"]')).toHaveCount(1);
    await review.evaluate(()=>{window.staleReportForm=document.querySelector('[data-room-form="triage"]');window.staleReportField=window.staleReportForm.querySelector('textarea');});
    for(const table of ['room_abuse_reports','room_abuse_events'])for(const operation of ['update','delete'])await expect(pool.query(operation==='update'?`update ${table} set envelope='erased'`:`delete from ${table}`)).rejects.toThrow(/append.only/i);
    const last=decision(34,'claim');await api('POST',`${path}/reports/${reportId}/triage`,last,reviewer.token);expect(await api('POST',`${path}/reports/${reportId}/triage`,last,reviewer.token)).toMatchObject({revision:35});
    await api('POST',`/api/access/role-assignments/${appointment.id}/end`,{reason:'End isolated safety appointment'},owner.token);
    await api('POST',`${path}/reports/${reportId}/triage`,last,reviewer.token,403);await api('GET',`${path}/reports/${reportId}?view=triage`,undefined,reviewer.token,403);
    await api('POST',`${path}/reports/${secondReport.id}/triage`,lockedInput,reviewer.token,403);
    await expect(createMessageRoomsModule(pool,{dataEncryptionKey:loadConfig().dataEncryptionKey}).triageRoomReport(secondReport.id,lockedInput,safetyActor)).rejects.toMatchObject({statusCode:403});
    await expect(createMessageRoomsModule(pool,{dataEncryptionKey:loadConfig().dataEncryptionKey}).triageRoomReport(reportId,last,safetyActor)).rejects.toMatchObject({statusCode:403});
    await review.locator('[data-room-refresh]').click();await ready(review);await expect(review.locator('[data-room-report-detail]')).toHaveCount(0);await expect(review.locator('[data-room-report-view="triage"]')).toHaveCount(0);expect(errors).toEqual([]);
    let staleRequests=0;review.on('request',req=>{if(req.method()==='POST' && req.url().includes('/triage'))staleRequests++;});
    expect(await review.evaluate(()=>window.staleReportForm.isConnected)).toBe(false);
    await review.evaluate(()=>{window.staleReportField.value='OLD PRIVATE REVIEW';window.staleReportField.dispatchEvent(new Event('input',{bubbles:true}));window.staleReportForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(staleRequests).toBe(0);expect(await review.locator('.messages-page').textContent()).not.toContain('OLD PRIVATE REVIEW');
    async function send(session,body){return api('POST',`${base}/messages`,{body,requestKey:key()},session.token);}
    async function appoint(session,roleCode){return api('POST','/api/access/role-assignments',{accountId:session.accountId,roleCode,scope:{},reason:'Isolated report verification'},owner.token,201);}
    async function reviewCommand(operation,details){const form=review.locator('[data-room-form="triage"]');await form.locator('select').selectOption(operation);await form.locator('textarea').fill(details);await form.getByRole('button',{name:'Record review'}).click();await ready(review);await expect(review.locator('[data-room-report-detail]')).toContainText(operation==='claim'?'reviewing':operation==='resolve'?'resolved':operation==='dismiss'?'dismissed':'open');}
    async function rollbackPositions(method,args,who){
      for(const target of ['audit_events','room_message_receipts']){
        const before=await counts();let injected=false;const failing={async connect(){const db=await pool.connect();return {release:()=>db.release(),async query(sql,params){if(sql.toLowerCase().includes(`insert into ${target}`)){injected=true;return db.query('select 1/0');}return db.query(sql,params);}};}};
        await expect(createMessageRoomsModule(failing,{dataEncryptionKey:loadConfig().dataEncryptionKey})[method](...args,who)).rejects.toThrow(/division by zero/);expect(injected,`${method}/${args.at(-1).operation || 'intake'}/${target}`).toBe(true);expect(await counts()).toEqual(before);
      }
    }
    async function revokeDuring(method,args,who,pauseAt){
      let resume,entered=false,operationPid;const paused=new Promise(resolve=>{resume=resolve;});
      const pausedPool={async connect(){const db=await pool.connect();try{operationPid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;}catch(error){db.release();throw error;}return {release:()=>db.release(),async query(sql,params){const result=await db.query(sql,params);if(pauseAt(sql)){entered=true;await paused;}return result;}};}};
      const ending=new pg.Client({connectionString:process.env.DATABASE_URL});await ending.connect();let operation,roleEnd;
      try{
        operation=createMessageRoomsModule(pausedPool,{dataEncryptionKey:loadConfig().dataEncryptionKey})[method](...args,who).then(result=>({result}),error=>({error}));
        await expect.poll(()=>entered,{timeout:15000}).toBe(true);
        await ending.query('begin');await ending.query("set local lock_timeout='15s'");const pid=(await ending.query('select pg_backend_pid() as pid')).rows[0].pid;
        roleEnd=ending.query('update role_assignments set ended_at=clock_timestamp(),effective_to=current_date-1,ended_by=$2,end_reason=$3 where id=$1',[appointment.id,ownerId,'Controlled safety role-lock verification']).then(result=>({ended:result.rowCount}),error=>({error}));
        let waiting=false;for(let attempt=0;attempt<100;attempt++){waiting=(await pool.query('select $2::int=any(pg_blocking_pids($1)) as waiting',[pid,operationPid])).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}
        expect(waiting,`${method} must hold the current safety assignment`).toBe(true);resume();const completed=await operation;if(completed.error)throw completed.error;expect(await roleEnd).toEqual({ended:1});return completed.result;
      }finally{
        resume();try{if(operation)await operation;if(roleEnd)await roleEnd;await ending.query('rollback');}finally{await ending.end();}
      }
    }
  }finally{try{await reviewContext?.close();}finally{await pool.end();}}
  function key(){return randomUUID();}
  function decision(revision,operation){return {revision,operation,details:'TEST SAFETY REVIEW EVIDENCE',requestKey:key()};}
  async function api(method,url,data,token,status=200){const response=await request.fetch(url,{method,data,headers:token?{Authorization:`Bearer ${token}`}:{}});expect(response.status(),`${method} ${url}`).toBe(status);if(response.ok() && url.startsWith(path))expect(response.headers()['cache-control']).toContain('no-store');return (await response.json()).data;}
  async function account(name){const email=`reports.${name}.${stamp}@example.edu`,password='Room-Report-Verification-2026!';await api('POST','/api/admissions/registrations',{email,preferredName:name,legalName:`Reports ${name}`},null,202);let activation;for(const file of await readdir(process.env.SVU_DEV_OUTBOX)){const item=JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,file),'utf8'));if(item.recipientEmail===email && item.variables?.activationToken)activation=item.variables.activationToken;}expect(activation).toBeTruthy();await api('POST','/api/identity/activations',{token:activation,password,preferredName:name,legalName:`Reports ${name}`});const session=await api('POST','/api/identity/sessions',{email,password},null,201),me=await api('GET','/api/identity/me',undefined,session.token);return {...session,email,accountId:me.account.id};}
  async function ready(target){await expect(target.locator('.messages-page')).toHaveAttribute('aria-busy','false');}
  async function open(target,session){await target.goto('/');await target.evaluate(value=>window.svuSession.set(value),session);await target.goto('/#messages');await target.locator('[data-message-mode="rooms"]').click();await ready(target);await expect(target.locator('[data-room-workspace]')).toBeVisible();}
  async function counts(){const result={};for(const table of ['room_message_preferences','room_message_preference_history','message_rooms','message_room_memberships','message_room_membership_history','room_messages','room_message_moderation','room_message_receipts','room_abuse_reports','room_abuse_events'])result[table]=(await pool.query(`select count(*)::int as total from ${table}`)).rows[0].total;result.audit=(await pool.query("select count(*)::int as total from audit_events where action like 'message_room.%' and action not like '%.read'")).rows[0].total;return result;}
});
