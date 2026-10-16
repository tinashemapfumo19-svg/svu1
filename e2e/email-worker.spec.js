import { test,expect } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { createRepository } from '../server/repository.js';
import { createRouter } from '../server/router.js';
import { queueNotification } from '../server/notification-queue.js';
import { encryptSecret } from '../server/security.js';
import { enrollCampaignEmails } from '../server/campaign-email.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Email worker fixtures require an isolated database.');
test('email worker serializes sends, retains retries and verifies early/replayed delivery events',async({page,request},info)=>{
  test.setTimeout(180000);page.setDefaultTimeout(15000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),baseConfig=loadConfig(),key=baseConfig.dataEncryptionKey;
  const email={provider:'resend',apiKey:'TEST_ONLY_NOT_USED',from:'sender@example.edu',origin:'https://portal.example.edu',webhookSecret:`whsec_${Buffer.alloc(32,13).toString('base64')}`,enabledAfter:new Date(Date.now()-250).toISOString()};
  const modes=new Map(),calls=new Map(),logical=new Map(),requests=new Map();let base,server,studentAccount;
  const adapter=async(message,{idempotencyKey,signal})=>{
    const id=idempotencyKey.slice(4),count=(calls.get(id)||0)+1;calls.set(id,count);
    if(requests.has(id))expect(JSON.stringify(message)).toBe(requests.get(id));else requests.set(id,JSON.stringify(message));
    const mode=modes.get(id),messageId=`receipt-${id}`;
    if(mode==='timeout')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('PRIVATE_PROVIDER_ERROR'),{retryable:true,mailCode:'PROVIDER_TIMEOUT'})),{once:true}));
    if(mode==='reject')throw Object.assign(new Error('PRIVATE_PROVIDER_ERROR'),{retryable:false,mailCode:'PROVIDER_HTTP_400'});
    if(mode==='early' && count===1)await hook('email.delivered',messageId);
    logical.set(id,messageId);
    if(mode==='lost' && count===1)throw Object.assign(new Error('PRIVATE_PROVIDER_ERROR'),{retryable:true,mailCode:'PROVIDER_UNAVAILABLE'});
    return {messageId};
  };
  const repository=createRepository(pool,{email,dataEncryptionKey:key,adapter,mfaPolicy:baseConfig.mfaPolicy});
  try {
    server=createServer(createRouter({rootDir:process.cwd(),config:{...baseConfig,email},repository,logger:{info(){},error(){}}}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    const admin=await api('POST','/api/identity/sessions',{email:'admin@southvalley.test',password:'Phase1-Admin-Password-2026!'},null,201);
    const student=await api('POST','/api/identity/sessions',{email:'tinashe@example.edu',password:'Phase1-Student-Password-2026!'},null,201);
    await api('GET','/api/email-delivery',undefined,student.token,403);
    const catalogue=await api('GET','/api/integrations',undefined,admin.token);
    let connection=catalogue.connections.find(row=>row.code==='email_provider');
    connection=await api('POST',`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:'active',classification:'restricted',agreementRef:'SAMPLE-ISOLATED-MAIL',maxAttempts:2,timeoutMs:1000,rateLimitPerMinute:100000,reason:'Isolated provider verification'},admin.token);
    const accepted=await queue('accept'),lost=await queue('lost'),early=await queue('early'),dead=await queue('reject');
    await Promise.all([repository.processEmailDeliveries({limit:10}),repository.processEmailDeliveries({limit:10})]);
    await repository.processEmailDeliveries({limit:10});
    expect(calls.get(accepted)).toBe(1);expect(calls.get(early)).toBe(1);expect(calls.get(lost)).toBe(1);expect(calls.get(dead)).toBe(1);
    expect((await row(accepted)).status).toBe('accepted');expect((await row(early)).status).toBe('delivered');
    expect((await row(lost)).status).toBe('pending');expect((await row(dead)).status).toBe('dead');
    expect((await row(lost)).next_attempt_at.getTime()).toBeGreaterThan(Date.now()+20000);
    await repository.processEmailDeliveries({limit:10});expect(calls.get(lost)).toBe(1);
    await pool.query('update email_deliveries set next_attempt_at=now(),revision=revision+1 where notification_id=$1',[lost]);
    await api('POST','/api/email-delivery/process',{limit:10},admin.token);
    expect(calls.get(lost)).toBe(2);expect((await row(lost)).provider_message_id).toBe(logical.get(lost));
    const deadBefore=await row(dead),frozen=deadBefore.request_envelope;
    await api('POST',`/api/email-delivery/${dead}/retry`,{revision:deadBefore.revision-1,reason:'Stale fixture'},admin.token,409);
    modes.set(dead,'accept');await api('POST',`/api/email-delivery/${dead}/retry`,{revision:deadBefore.revision,reason:'Reviewed isolated retry'},admin.token);
    await api('POST','/api/email-delivery/process',{},admin.token);
    expect((await row(dead)).attempts).toBe(2);expect((await row(dead)).request_envelope).toBe(frozen);
    expect((await pool.query('select attempt from email_delivery_attempts where notification_id=$1 order by attempt',[dead])).rows.map(r=>r.attempt)).toEqual([1,2]);
    const delivered=await hook('email.delivered',logical.get(accepted));
    await hook('email.sent',logical.get(accepted));expect((await row(accepted)).status).toBe('delivered');
    expect((await signed(delivered.body,delivered.headers)).replayed).toBe(true);
    await signed(`${delivered.body} `,delivered.headers,400);
    const conflicting=JSON.stringify({...JSON.parse(delivered.body),type:'email.bounced'});
    await signed(conflicting,signature(conflicting,delivered.headers['svix-id']),409);
    await hook('email.bounced',logical.get(accepted));expect((await row(accepted)).status).toBe('bounced');
    await hook('email.complained',logical.get(accepted));await hook('email.delivered',logical.get(accepted));expect((await row(accepted)).status).toBe('complained');
    const timeout=await queue('timeout');await repository.processEmailDeliveries();expect((await row(timeout)).status).toBe('pending');
    await pool.query('update email_deliveries set next_attempt_at=now(),revision=revision+1 where notification_id=$1',[timeout]);
    await repository.processEmailDeliveries();expect((await row(timeout)).status).toBe('dead');expect((await row(timeout)).attempts).toBe(2);
    const cancelled=await queue('reject');await repository.processEmailDeliveries();const cancellation=await row(cancelled);
    await api('POST',`/api/email-delivery/${cancelled}/cancel`,{revision:cancellation.revision,reason:'Stop isolated future attempts'},admin.token);
    expect((await row(cancelled)).status).toBe('cancelled');
    const expired=await queue('accept');
    await pool.query("insert into email_deliveries(notification_id,provider,request_envelope,first_attempt_at) values($1,'resend',$2,now()-interval '24 hours')",[expired,encryptSecret(JSON.stringify({notificationId:expired,request:{}}),key)]);
    await repository.processEmailDeliveries();expect(calls.has(expired)).toBe(false);expect((await row(expired)).last_error).toBe('IDEMPOTENCY_WINDOW_EXPIRED');
    await api('POST',`/api/email-delivery/${expired}/retry`,{revision:(await row(expired)).revision,reason:'Unsafe late replay'},admin.token,409);
    studentAccount=(await pool.query("select id from accounts where email='tinashe@example.edu'")).rows[0].id;
    await pool.query('update accounts set email=$2 where id=$1',[studentAccount,' TINASHE@EXAMPLE.EDU ']);
    const ordinary=await queueNotification(pool,studentAccount,'course.resource',{courseCode:'SAMPLE',kind:'note',title:'Mailbox check'},{activeOnly:true});
    modes.set(ordinary,'accept');await repository.processEmailDeliveries();expect((await row(ordinary)).status).toBe('accepted');
    expect(JSON.parse(requests.get(ordinary)).to).toEqual(['tinashe@example.edu']);
    const sensitive=await queueNotification(pool,studentAccount,'identity.password_recovery',{recoveryToken:'SAMPLE_PRIVATE_TOKEN',expiresInMinutes:30},{sensitive:true,dataEncryptionKey:key});
    modes.set(sensitive,'accept');await repository.processEmailDeliveries();expect((await row(sensitive)).status).toBe('accepted');
    expect(JSON.parse(requests.get(sensitive)).to).toEqual(['tinashe@example.edu']);
    const equivalent=await queueNotification(pool,studentAccount,'course.resource',{courseCode:'SAMPLE',kind:'note',title:'Frozen equivalent mailbox'},{activeOnly:true});
    const equivalentRequest={from:email.from,to:['TINASHE@EXAMPLE.EDU'],subject:'Frozen subject',text:'Frozen text'};
    const equivalentEnvelope=encryptSecret(JSON.stringify({notificationId:equivalent,request:equivalentRequest}),key);
    await pool.query("insert into email_deliveries(notification_id,provider,request_envelope,first_attempt_at) values($1,'resend',$2,now())",[equivalent,equivalentEnvelope]);
    modes.set(equivalent,'accept');await repository.processEmailDeliveries();expect((await row(equivalent)).status).toBe('accepted');
    expect(JSON.parse(requests.get(equivalent))).toEqual(equivalentRequest);expect((await row(equivalent)).request_envelope).toBe(equivalentEnvelope);
    const duplicateEmail=`delivery.duplicate.${info.project.name}.${Date.now()}@example.edu`;
    const duplicateInvite=await api('POST','/api/identity/invitations',{email:duplicateEmail,roleCode:'applicant'},admin.token,201);
    const duplicate=await api('POST','/api/identity/activations',{token:duplicateInvite.activationToken,password:'Equivalent-Mail-Password-2026!',preferredName:'Duplicate fixture',legalName:'Isolated delivery duplicate'},null);
    await pool.query('drop index accounts_canonical_email_key');
    try {
      await pool.query('update accounts set email=$2 where id=$1',[duplicate.id,'TINASHE@EXAMPLE.EDU']);
      for(const inactive of [false,true]) {
        if(inactive)await api('POST',`/api/identity/accounts/${duplicate.id}/suspend`,{reason:'Isolated inactive delivery ambiguity'},admin.token);
        const ambiguous=await queueNotification(pool,studentAccount,'identity.password_recovery',{recoveryToken:'SAMPLE_PRIVATE_TOKEN',expiresInMinutes:30},{sensitive:true,dataEncryptionKey:key});
        await repository.processEmailDeliveries({limit:25});
        expect(calls.has(ambiguous)).toBe(false);expect((await row(ambiguous)).last_error).toBe('RECIPIENT_RECONCILIATION_REQUIRED');
        expect((await pool.query('select 1 from email_delivery_attempts where notification_id=$1',[ambiguous])).rowCount).toBe(0);
      }
    } finally {
      await pool.query('update accounts set email=$2 where id=$1',[duplicate.id,duplicateEmail]);
      await pool.query('create unique index accounts_canonical_email_key on accounts (lower(btrim(email)))');
    }
    const moved=await queueNotification(pool,studentAccount,'course.resource',{courseCode:'SAMPLE',kind:'note',title:'Prepared mailbox check'},{activeOnly:true});
    await pool.query("insert into email_deliveries(notification_id,provider,request_envelope,first_attempt_at) values($1,'resend',$2,now())",[moved,encryptSecret(JSON.stringify({notificationId:moved,request:{from:email.from,to:['tinashe@example.edu'],subject:'SAMPLE',text:'SAMPLE'}}),key)]);
    try {
      await pool.query('update accounts set email=$2 where id=$1',[studentAccount,`changed.${info.project.name}@example.edu`]);
      await repository.processEmailDeliveries();expect(calls.has(moved)).toBe(false);expect((await row(moved)).last_error).toBe('RECIPIENT_RECONCILIATION_REQUIRED');
    } finally {await pool.query("update accounts set email=' TINASHE@EXAMPLE.EDU ' where id=$1",[studentAccount]);}
    await campaignChecks(admin,studentAccount);
    expect((await pool.query('select email from accounts where id=$1',[studentAccount])).rows[0].email).toBe(' TINASHE@EXAMPLE.EDU ');
    connection=await api('POST',`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:'suspended',reason:'Isolated suspension'},admin.token);
    const paused=await queue('accept');expect((await repository.processEmailDeliveries()).configured).toBe(false);expect(calls.has(paused)).toBe(false);
    connection=await api('POST',`/api/integrations/connections/${connection.id}`,{revision:connection.revision,status:'active',rateLimitPerMinute:1,reason:'Isolated rate limit'},admin.token);
    await repository.processEmailDeliveries();expect(calls.has(paused)).toBe(false);
    const metadata=JSON.stringify(await api('GET','/api/email-delivery',undefined,admin.token));expect(metadata).not.toMatch(/PRIVATE_PROVIDER_ERROR|SAMPLE_PRIVATE_TOKEN|request_envelope/);
    expect(JSON.stringify((await pool.query('select * from email_delivery_events')).rows)).not.toContain('PRIVATE_WEBHOOK_FIELD');
    await expect(pool.query('delete from email_delivery_attempts')).rejects.toThrow();await expect(pool.query('delete from email_delivery_events')).rejects.toThrow();
    await expect(pool.query('update email_deliveries set request_envelope=$2,revision=revision+1 where notification_id=$1',[dead,encryptSecret('different',key)])).rejects.toThrow();
    await expect(pool.query("update email_deliveries set status='pending',revision=revision+1 where notification_id=$1",[ordinary])).rejects.toThrow();
    await page.goto(base);await page.evaluate(session=>window.svuSession.set(session),admin);await page.goto(`${base}/#registry/admin`);
    await expect(page.locator('[data-email-panel]')).toBeVisible();await page.locator('[data-email-panel] > summary').click();
    await expect(page.locator('[data-email-panel]')).toContainText('complained');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('[data-email-panel]').evaluate(node=>{document.activeElement?.blur();scrollTo({top:Math.max(0,scrollY+node.getBoundingClientRect().top-90),behavior:'instant'});});
    await page.screenshot({path:info.outputPath('email-delivery.png')});
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(studentAccount)await pool.query("update accounts set email='tinashe@example.edu' where id=$1",[studentAccount]);
    await pool.end();
  }
  async function api(method,path,data,token,status=200) {
    const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},...(data===undefined ? {} : {body:JSON.stringify(data)})});
    expect(response.status,`${method} ${path}`).toBe(status);return (await response.json()).data;
  }
  async function queue(mode) {
    const db=await pool.connect();try{await db.query('begin');const id=await queueNotification(db,null,'identity.password_recovery',{recoveryToken:'SAMPLE_PRIVATE_TOKEN',expiresInMinutes:30},{sensitive:true,recipientEmail:'fixture@example.edu',dataEncryptionKey:key});await db.query('commit');modes.set(id,mode);return id;}finally{db.release();}
  }
  async function row(id){return (await pool.query('select * from email_deliveries where notification_id=$1',[id])).rows[0];}
  async function campaignChecks(admin,accountId) {
    const stamp=`${info.project.name}_${Date.now()}`,own='/api/admissions/me/communications',campaignPath='/api/admissions/communications';
    await api('POST','/api/access/role-assignments',{accountId,roleCode:'applicant',scope:{},reason:'Isolated campaign applicant'},admin.token,201);
    const applicant=await api('POST','/api/identity/sessions',{email:'tinashe@example.edu',password:'Phase1-Student-Password-2026!'},null,201);
    const intake=await api('POST','/api/master-data/intakes',{programmeId:'prog_bsc_is',label:`Email consent ${stamp}`,capacity:10,startsOn:'2035-02-01',applicationOpensAt:new Date(Date.now()-86400000).toISOString(),applicationClosesAt:new Date(Date.now()+86400000*30).toISOString()},admin.token,201);
    await api('POST',`/api/master-data/intakes/${intake.id}/transitions`,{toStatus:'published',reason:'Isolated campaign intake'},admin.token);
    await api('POST','/api/admissions/applications',{intakeId:intake.id},applicant.token,201);
    let preferences=await api('GET',`${own}/preferences`,undefined,applicant.token);
    async function consent(value) {preferences=await api('PUT',`${own}/preferences`,{revision:preferences.revision,inApp:true,email:value},applicant.token);}
    await consent(true);
    const sourceGovernance=async db=>(await db.query("select id from integration_connections where code='email_provider' and status='active' for share")).rows[0];
    async function enroll(){await enrollCampaignEmails(pool,{email,dataEncryptionKey:key,governance:sourceGovernance});}
    async function campaign(label,publish=true) {
      const preview=await api('POST',`${campaignPath}/preview`,{filters:{intakeId:intake.id,status:'draft'},subject:`PRIVATE_CAMPAIGN_SUBJECT_${label}`,body:'PRIVATE_CAMPAIGN_BODY',reason:'PRIVATE_CAMPAIGN_REASON',channels:['email','in_app'],requestKey:`campaign_${stamp}_${label}`},admin.token);
      expect(preview.counts.email).toBe(1);
      if(publish)await api('POST',`${campaignPath}/campaigns/${preview.id}/publish`,{},admin.token);
      return preview.id;
    }
    async function link(campaignId) {return (await pool.query(`select l.notification_id as id,r.status from applicant_communication_recipients r left join applicant_communication_email_links l on l.recipient_id=r.id where r.campaign_id=$1 and r.channel='email'`,[campaignId])).rows[0];}
    const previewOnly=await campaign('preview',false);await enroll();expect(await link(previewOnly)).toBeUndefined();
    const deliveredCampaign=await campaign('delivered');await Promise.all([enroll(),enroll()]);
    const deliveredLink=await link(deliveredCampaign);expect(deliveredLink.id).toBeTruthy();
    expect((await pool.query('select count(*)::int as total from applicant_communication_email_links where notification_id=$1',[deliveredLink.id])).rows[0].total).toBe(1);
    const restricted=(await pool.query('select payload from notifications where id=$1',[deliveredLink.id])).rows[0].payload;
    expect(JSON.stringify(restricted)).not.toMatch(/PRIVATE_CAMPAIGN|tinashe@example/);
    modes.set(deliveredLink.id,'early');await repository.processEmailDeliveries({limit:25});expect((await link(deliveredCampaign)).status).toBe('delivered');
    await hook('email.bounced',logical.get(deliveredLink.id));await hook('email.sent',logical.get(deliveredLink.id));expect((await link(deliveredCampaign)).status).toBe('bounced');
    expect((await api('GET',`${campaignPath}/campaigns/${deliveredCampaign}`,undefined,admin.token)).emailDelivery).toEqual({bounced:1});
    const withdrawn=await campaign('withdrawn');await enroll();const withdrawnId=(await link(withdrawn)).id;
    await consent(false);await consent(true);await repository.processEmailDeliveries({limit:25});
    expect(calls.has(withdrawnId)).toBe(false);expect((await row(withdrawnId)).status).toBe('cancelled');expect((await link(withdrawn)).status).toBe('cancelled');
    const unlinkedWithdrawal=await campaign('unlinked');await consent(false);await consent(true);await enroll();
    expect((await link(unlinkedWithdrawal)).id).toBeNull();expect((await link(unlinkedWithdrawal)).status).toBe('cancelled');
    const failedCampaign=await campaign('failed');await enroll();const failedId=(await link(failedCampaign)).id;
    modes.set(failedId,'reject');await repository.processEmailDeliveries({limit:25});expect((await link(failedCampaign)).status).toBe('dead');
    const failedRow=await row(failedId);await consent(false);await consent(true);
    await api('POST',`/api/email-delivery/${failedId}/retry`,{revision:failedRow.revision,reason:'Cannot override withdrawn consent'},admin.token,409);
    expect((await api('GET','/api/email-delivery?status=dead',undefined,admin.token)).items.find(item=>item.id===failedId).canRetry).toBe(false);
    expect(calls.get(failedId)).toBe(1);expect((await link(failedCampaign)).status).toBe('cancelled');
    const retriedCampaign=await campaign('retry');await enroll();const retriedId=(await link(retriedCampaign)).id;
    modes.set(retriedId,'reject');await repository.processEmailDeliveries({limit:25});
    await api('POST',`/api/email-delivery/${retriedId}/retry`,{revision:(await row(retriedId)).revision,reason:'Consented bounded campaign retry'},admin.token);
    expect((await link(retriedCampaign)).status).toBe('queued');modes.set(retriedId,'accept');await repository.processEmailDeliveries({limit:25});
    expect((await link(retriedCampaign)).status).toBe('accepted');expect(calls.get(retriedId)).toBe(2);
    const oldCampaign=await campaign('cutoff'),cutoff=email.enabledAfter;email.enabledAfter=new Date(Date.now()+60000).toISOString();
    try {await enroll();expect((await link(oldCampaign)).id).toBeNull();} finally {email.enabledAfter=cutoff;}
    const cancelledCampaign=await campaign('operator');await enroll();const cancelledId=(await link(cancelledCampaign)).id;
    modes.set(cancelledId,'reject');await repository.processEmailDeliveries({limit:25});
    await api('POST',`/api/email-delivery/${cancelledId}/cancel`,{revision:(await row(cancelledId)).revision,reason:'Cancel campaign future attempts'},admin.token);
    expect((await link(cancelledCampaign)).status).toBe('cancelled');
    const lockedCampaign=await campaign('locked');await enroll();const lockedId=(await link(lockedCampaign)).id;
    const consentLock=await pool.connect();let pass;
    try {
      await consentLock.query('begin');
      const pid=(await consentLock.query('select pg_backend_pid() as id')).rows[0].id;
      await consentLock.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`applicant-communications:${accountId}`]);
      pass=repository.processEmailDeliveries({limit:25});
      let waiting=false;
      for(let tries=0;tries<100 && !waiting;tries++) {
        waiting=(await pool.query('select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as waiting',[pid])).rows[0].waiting;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,20));
      }
      expect(waiting).toBe(true);expect(calls.has(lockedId)).toBe(false);
      const revision=preferences.revision+1;
      await consentLock.query('update applicant_communication_preferences set email=false,revision=$2,updated_at=now() where account_id=$1',[accountId,revision]);
      await consentLock.query('insert into applicant_communication_preference_history(account_id,in_app,email,revision) values($1,true,false,$2)',[accountId,revision]);
      await consentLock.query("update applicant_communication_recipients set status='cancelled' where account_id=$1 and channel='email' and status in ('queued','dead')",[accountId]);
      await consentLock.query('commit');
    } finally {await consentLock.query('rollback');consentLock.release();if(pass)await pass;}
    expect(calls.has(lockedId)).toBe(false);expect((await row(lockedId)).status).toBe('cancelled');
    preferences=await api('GET',`${own}/preferences`,undefined,applicant.token);await consent(true);
    const sourceCampaign=await campaign('source');
    await enrollCampaignEmails(pool,{email,dataEncryptionKey:Buffer.alloc(32,99),governance:sourceGovernance});
    expect((await link(sourceCampaign)).status).toBe('dead');expect((await link(sourceCampaign)).id).toBeNull();
    const report=await api('GET',`/api/reports/communications?intakeId=${intake.id}`,undefined,admin.token);
    expect(Object.values(report.controls).every(Boolean)).toBe(true);expect(report.providerDeliveryEvidenceAvailable).toBe(true);
    expect(report.totals.emailBounced).toBe(1);expect(report.totals.emailDead).toBe(1);expect(report.totals.emailQueued).toBe(0);
    const csv=await api('GET',`/api/reports/communications?intakeId=${intake.id}&format=csv`,undefined,admin.token);
    expect(csv.csv).toMatch(/"emailBounced","messages","1"/);expect(csv.csv).not.toMatch(/PRIVATE_CAMPAIGN|tinashe@example/);
    await expect(pool.query('delete from applicant_communication_email_links where notification_id=$1',[deliveredLink.id])).rejects.toThrow();
    await expect(pool.query("update applicant_communication_recipients set status='queued' where campaign_id=$1 and channel='email'",[withdrawn])).rejects.toThrow();
    const metadata=JSON.stringify(await api('GET','/api/email-delivery',undefined,admin.token));expect(metadata).not.toMatch(/PRIVATE_CAMPAIGN|tinashe@example/);
    expect(metadata).toContain('applicant.campaign');
    await page.goto(base);await page.evaluate(session=>window.svuSession.set(session),admin);await page.goto(`${base}/#admissions`);
    await page.locator('[data-admissions-tab=communication]').click();
    await page.locator('[data-communication-staff] > summary').click();
    await page.locator(`[data-communication-open="${deliveredCampaign}"]`).click();
    await expect(page.locator('[data-campaign-email-status]')).toContainText('bounced');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.locator('[data-campaign-email-status]').evaluate(node=>scrollTo({top:Math.max(0,scrollY+node.getBoundingClientRect().top-100),behavior:'instant'}));
    await page.screenshot({path:info.outputPath('campaign-email.png')});
    await consent(false);
  }
  function signature(body,id=`evt_${randomUUID()}`){const time=new Date();return {'svix-id':id,'svix-timestamp':String(Math.floor(time.getTime()/1000)),'svix-signature':new Webhook(email.webhookSecret).sign(id,time,body)};}
  async function signed(body,headers,status=200){const response=await fetch(`${base}/api/email-delivery/webhooks/resend`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body});expect(response.status).toBe(status);return (await response.json()).data;}
  async function hook(type,emailId){const body=JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:emailId,extra:'PRIVATE_WEBHOOK_FIELD'}}),headers=signature(body);await signed(body,headers);return {body,headers};}
});
