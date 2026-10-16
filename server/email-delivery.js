import { createHmac } from 'node:crypto';
import { encryptSecret, decryptSecret } from './security.js';
import { readNotificationDeliveryContent, canonicalNotificationDestination } from './notification-queue.js';
import { deliveryRecipientMatches } from './delivery-recipient.js';
import { enrollCampaignEmails, campaignEmailGate, syncCampaignEmail } from './campaign-email.js';
import { emailRequest, resendAdapter, verifyEmailWebhook } from './email-provider.js';
import { insertAudit, isGlobalScope, requestError, withTransaction } from './support.js';
import { backoffDelayMs } from './modules/integrations.js';

export const emailRetryWindowMs=23*60*60*1000;
const statuses=['pending','accepted','delivered','bounced','complained','failed','dead','cancelled'];
const priority={pending:0,accepted:1,failed:2,delivered:3,bounced:4,complained:5};
const eventStatus={'email.sent':'accepted','email.delivered':'delivered','email.bounced':'bounced','email.complained':'complained','email.failed':'failed','email.delivery_delayed':'accepted'};
const secretCodes=['identity.password_recovery','admissions.registration_activation','staff.invitation','student.sharing_invitation'];
const columns=`d.notification_id as id,d.status,d.attempts,d.revision,d.next_attempt_at as "nextAttemptAt",d.last_error as "lastError",d.accepted_at as "acceptedAt",d.updated_at as "updatedAt",d.provider_message_id as "providerMessageId",
  coalesce(t.code,case when exists(select 1 from applicant_communication_email_links l where l.notification_id=d.notification_id) then 'applicant.campaign' end) as "templateCode",
  (d.status='dead' and d.request_envelope is not null and d.provider_message_id is null and d.first_attempt_at>now()-interval '23 hours' and d.attempts<20
    and not exists(select 1 from applicant_communication_email_links l join applicant_communication_recipients r on r.id=l.recipient_id
      left join applicant_communication_preferences p on p.account_id=r.account_id where l.notification_id=d.notification_id and (r.status='cancelled' or not coalesce(p.email,false)))) as "canRetry"`;
function authority(actor,permission) {
  if (!actor?.roles?.some(role=>role.permissions?.includes(permission) && isGlobalScope(role.scope))) throw requestError(403,'Institution-wide email delivery authority is required.');
}
export function emailEventOutcome(current,eventType) {
  const next=eventStatus[eventType];
  return next && priority[next]>(priority[current] ?? 0) ? next : current;
}
function fields(input,allowed) {if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw requestError(400,'Unsupported email delivery input.');}

export function createEmailDelivery(pool,{email={provider:'disabled'},dataEncryptionKey,adapter,verify=verifyEmailWebhook}={}) {
  const send=adapter || (email.provider==='resend' ? resendAdapter(email) : null);
  async function governance(db) {
    return (await db.query(`select id,timeout_ms as "timeoutMs",max_attempts as "maxAttempts",rate_limit_per_minute as "rateLimit" from integration_connections
      where code='email_provider' and status='active' and direction in ('outbound','both') and classification='restricted' and agreement_ref is not null for share`)).rows[0];
  }
  async function applyEvents(db,id,messageId) {
    const row=(await db.query('select status from email_deliveries where notification_id=$1 for update',[id])).rows[0];
    if (!row || row.status==='cancelled')return;
    const events=(await db.query('select event_type from email_delivery_events where provider_message_id=$1',[messageId])).rows;
    const status=events.reduce((result,event)=>emailEventOutcome(result,event.event_type),row.status);
    if(status!==row.status) {
      await db.query('update email_deliveries set status=$2,revision=revision+1,updated_at=now() where notification_id=$1',[id,status]);
      await db.query('update notifications set status=$2 where id=$1',[id,status]);
      await syncCampaignEmail(db,id,status);
    }
  }
  async function closeDead(db,id,code) {
    await db.query("update email_deliveries set status='dead',last_error=$2,revision=revision+1,updated_at=now() where notification_id=$1",[id,code]);
    await db.query("update notifications set status='failed' where id=$1",[id]);
    await syncCampaignEmail(db,id,'dead');
  }
  async function prepare(id) {
    return withTransaction(pool,async db=>{
      if(!await governance(db))return false;
      const row=(await db.query(`select d.*,n.recipient_account_id,n.payload,t.code from email_deliveries d join notifications n on n.id=d.notification_id
        left join notification_templates t on t.id=n.template_id where d.notification_id=$1 and d.status='pending' and d.next_attempt_at<=now() for update of d skip locked`,[id])).rows[0];
      if(!row)return false;
      if(await campaignEmailGate(db,id)==='cancelled') {
        await db.query("update email_deliveries set status='cancelled',revision=revision+1,updated_at=now() where notification_id=$1",[id]);
        await db.query("update notifications set status='cancelled' where id=$1",[id]);return false;
      }
      if(row.request_envelope)return true;
      try {
        let content=await readNotificationDeliveryContent(db,id,dataEncryptionKey);
        if(!content) {
          if(row.payload.sensitive || secretCodes.includes(row.code))throw new Error('Missing secret source');
          const destination=row.payload.recipientEmail || canonicalNotificationDestination((await db.query("select email from accounts where id=$1 and status='active'",[row.recipient_account_id])).rows[0]?.email);
          content={recipientEmail:destination,subject:row.payload.subject,body:row.payload.body};
        }
        const request=emailRequest(content,email);
        // Commit the exact request and start of the bounded idempotency window before any external effect.
        await db.query('update email_deliveries set request_envelope=$2,first_attempt_at=now(),revision=revision+1,updated_at=now() where notification_id=$1',[id,encryptSecret(JSON.stringify({notificationId:id,request}),dataEncryptionKey)]);
        return true;
      } catch {await closeDead(db,id,'SOURCE_RECONCILIATION_REQUIRED');return false;}
    });
  }
  async function attempt(id) {
    return withTransaction(pool,async db=>{
      const lock=(await db.query("select pg_try_advisory_xact_lock(hashtext('svu.email_delivery_worker')) as locked")).rows[0];
      if(!lock.locked)return null;
      const connection=await governance(db);if(!connection)return null;
      const row=(await db.query("select *,first_attempt_at < now()-interval '23 hours' as expired from email_deliveries where notification_id=$1 and status='pending' and next_attempt_at<=now() for update skip locked",[id])).rows[0];
      if(!row)return null;
      const budget=Math.min(connection.maxAttempts+row.extra_attempts,20);
      if(row.expired || row.attempts>=budget){await closeDead(db,id,row.expired ? 'IDEMPOTENCY_WINDOW_EXPIRED' : 'RETRY_BUDGET_EXHAUSTED');return {id,outcome:'dead'};}
      const recent=(await db.query("select count(*)::int as total from email_delivery_attempts where attempted_at>now()-interval '1 minute'")).rows[0].total;
      if(connection.rateLimit && recent>=connection.rateLimit)return null;
      let request;
      try {
        const decoded=JSON.parse(decryptSecret(row.request_envelope,dataEncryptionKey));
        if(decoded.notificationId!==id || !decoded.request)throw new Error();
        request=decoded.request;
      } catch {await closeDead(db,id,'SOURCE_RECONCILIATION_REQUIRED');return {id,outcome:'dead'};}
      const campaignGate=await campaignEmailGate(db,id);
      if(campaignGate==='cancelled') {
        await db.query("update email_deliveries set status='cancelled',revision=revision+1,updated_at=now() where notification_id=$1",[id]);
        await db.query("update notifications set status='cancelled' where id=$1",[id]);return {id,outcome:'cancelled'};
      }
      if(campaignGate==='reconcile'){await closeDead(db,id,'SOURCE_RECONCILIATION_REQUIRED');return {id,outcome:'dead'};}
      const notification=(await db.query('select recipient_account_id,status from notifications where id=$1 for update',[id])).rows[0];
      if(notification.status==='cancelled') {
        await db.query("update email_deliveries set status='cancelled',revision=revision+1,updated_at=now() where notification_id=$1",[id]);
        await syncCampaignEmail(db,id,'cancelled');return {id,outcome:'cancelled'};
      }
      if(notification.status!=='queued'){await closeDead(db,id,'SOURCE_RECONCILIATION_REQUIRED');return {id,outcome:'dead'};}
      if(notification.recipient_account_id) {
        const account=(await db.query('select status,email from accounts where id=$1 for share',[notification.recipient_account_id])).rows[0];
        if(!Array.isArray(request.to) || request.to.length!==1 || !await deliveryRecipientMatches(db,notification.recipient_account_id,account,request.to[0])){await closeDead(db,id,'RECIPIENT_RECONCILIATION_REQUIRED');return {id,outcome:'dead'};}
      }
      let outcome='accepted',code=null,receipt;
      const controller=new AbortController();let timer;
      try {
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Provider timeout'),{mailCode:'PROVIDER_TIMEOUT',retryable:true}));},Math.min(connection.timeoutMs,30000));});
        receipt=await Promise.race([send(request,{idempotencyKey:`svu/${id}`,signal:controller.signal}),timeout]);
        if(!receipt || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.messageId || ''))throw Object.assign(new Error('Invalid receipt'),{mailCode:'INVALID_RESPONSE',retryable:true});
      } catch(error) {
        code=/^(PROVIDER_(?:HTTP_\d{3}|TIMEOUT|UNAVAILABLE)|INVALID_RESPONSE)$/.test(error.mailCode || '') ? error.mailCode : 'PROVIDER_FAILURE';
        outcome=error.retryable && row.attempts+1<budget ? 'retry' : 'dead';
      } finally {clearTimeout(timer);}
      const attempts=row.attempts+1;
      await db.query('insert into email_delivery_attempts(notification_id,attempt,outcome,error_code) values($1,$2,$3,$4)',[id,attempts,outcome,code]);
      if(outcome==='accepted') {
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`email_event/${receipt.messageId}`]);
        await db.query("update email_deliveries set status='accepted',attempts=$2,provider_message_id=$3,accepted_at=now(),last_error=null,revision=revision+1,updated_at=now() where notification_id=$1",[id,attempts,receipt.messageId]);
        await db.query("update notifications set status='accepted' where id=$1",[id]);
        await syncCampaignEmail(db,id,'accepted');
        await applyEvents(db,id,receipt.messageId);
      } else {
        await db.query('update email_deliveries set status=$2,attempts=$3,last_error=$4,next_attempt_at=now()+make_interval(secs=>$5),revision=revision+1,updated_at=now() where notification_id=$1',[id,outcome==='retry' ? 'pending' : 'dead',attempts,code,backoffDelayMs(attempts)/1000]);
        if(outcome==='dead') {
          await db.query("update notifications set status='failed' where id=$1",[id]);
          await syncCampaignEmail(db,id,'dead');
        }
      }
      return {id,outcome,attempts};
    });
  }
  return {
    async listEmailDeliveries(input={},actor) {
      authority(actor,'integrations.view');fields(input,['status','offset']);
      const status=input.status || 'all',offset=input.offset || '0';
      if(!['all',...statuses].includes(status) || !/^\d{1,7}$/.test(offset))throw requestError(400,'Choose a bounded email delivery page.');
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const gate=await governance(db);
        const base="from email_deliveries d join notifications n on n.id=d.notification_id left join notification_templates t on t.id=n.template_id where ($1='all' or d.status=$1)";
        const total=(await db.query(`select count(*)::int as total ${base}`,[status])).rows[0].total;
        const items=(await db.query(`select ${columns} ${base} order by n.created_at desc,d.notification_id limit 25 offset $2`,[status,Number(offset)])).rows;
        return {provider:email.provider,enabled:email.provider!=='disabled' && !!gate,total,offset:Number(offset),items,canManage:actor.roles.some(role=>role.permissions?.includes('integrations.manage') && isGlobalScope(role.scope))};
      });
    },
    async processEmailDeliveries(input={},actor=null) {
      if(actor)authority(actor,'integrations.manage');fields(input,['limit']);
      const limit=input.limit ?? 10;if(!Number.isInteger(limit) || limit<1 || limit>25)throw requestError(400,'Email batch limit must be 1-25.');
      if(!send)return {configured:false,processed:0,results:[]};
      await enrollCampaignEmails(pool,{email,dataEncryptionKey,governance});
      const ready=await withTransaction(pool,async db=>{
        if(!await governance(db))return false;
        await db.query(`insert into email_deliveries(notification_id,provider) select n.id,$1 from notifications n where n.channel='email' and n.status='queued'
          and n.created_at >= $2::timestamptz and not exists(select 1 from email_deliveries d where d.notification_id=n.id)
          order by n.created_at,n.id limit 100 on conflict do nothing`,[email.provider,email.enabledAfter]);return true;
      });
      if(!ready)return {configured:false,processed:0,results:[]};
      const due=(await pool.query("select notification_id as id from email_deliveries where status='pending' and next_attempt_at<=now() order by next_attempt_at,notification_id limit $1",[limit])).rows;
      const results=[];
      for(const {id} of due)if(await prepare(id)){const result=await attempt(id);if(result)results.push(result);}
      if(actor)await insertAudit(pool,{actorId:actor.accountId,action:'email.worker.processed',subjectType:'EmailQueue',subjectId:'resend',reason:'Operator delivery pass',metadata:{processed:results.length}});
      return {configured:true,processed:results.length,results};
    },
    async changeEmailDelivery(id,operation,input,actor) {
      authority(actor,'integrations.manage');fields(input,['revision','reason']);
      if(!['retry','cancel'].includes(operation) || !Number.isInteger(input.revision) || typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>2000)throw requestError(400,'Provide a revision and action reason.');
      return withTransaction(pool,async db=>{
        const row=(await db.query("select *,first_attempt_at < now()-interval '23 hours' as expired from email_deliveries where notification_id=$1 for update",[id])).rows[0];
        if(!row)throw requestError(404,'Email delivery not found.');
        if(row.revision!==input.revision)throw requestError(409,'Email delivery changed; refresh before acting.');
        if(operation==='retry' && (row.status!=='dead' || row.expired || row.provider_message_id || !row.request_envelope))throw requestError(409,'This email requires reconciliation or a new business invitation, not a retry.');
        if(operation==='cancel' && !['dead','pending'].includes(row.status))throw requestError(409,'Accepted email cannot be recalled.');
        // History and attempt numbers never reset. A reviewed retry extends only the operator budget, not the provider window.
        if(operation==='retry' && row.attempts>=20)throw requestError(409,'Maximum retained attempt budget reached.');
        const connection=operation==='retry' ? await governance(db) : null;
        if(operation==='retry' && !connection)throw requestError(409,'Activate the reviewed email connection before retrying.');
        const campaignGate=await campaignEmailGate(db,id);
        if(operation==='retry' && campaignGate && campaignGate!=='eligible')throw requestError(409,'Campaign consent or source changed; this recipient cannot be retried.');
        await db.query('update email_deliveries set status=$2,extra_attempts=$3,next_attempt_at=now(),last_error=null,revision=revision+1,updated_at=now() where notification_id=$1',[id,operation==='retry' ? 'pending' : 'cancelled',operation==='retry' ? Math.min(20,row.extra_attempts+connection.maxAttempts) : row.extra_attempts]);
        await db.query('update notifications set status=$2 where id=$1',[id,operation==='retry' ? 'queued' : 'cancelled']);
        await syncCampaignEmail(db,id,operation==='retry' ? 'pending' : 'cancelled');
        await insertAudit(db,{actorId:actor.accountId,action:`email.delivery.${operation}`,subjectType:'Notification',subjectId:id,reason:input.reason,metadata:{revision:input.revision}});
        return {id,status:operation==='retry' ? 'pending' : 'cancelled'};
      });
    },
    async receiveEmailWebhook(raw,headers) {
      if(email.provider!=='resend')throw requestError(503,'Email webhook is not configured.');
      let event;
      try {event=verify(raw,headers,email);}catch{throw requestError(400,'Invalid email webhook signature.');}
      const id=headers['svix-id'],messageId=event?.data?.email_id,time=event?.created_at;
      if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || typeof messageId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)
        || typeof time!=='string' || !Number.isFinite(Date.parse(time)) || Date.parse(time)>Date.now()+300000)throw requestError(400,'Invalid email event metadata.');
      if(!Object.hasOwn(eventStatus,event.type))return {ignored:true};
      const digest=createHmac('sha256',dataEncryptionKey).update(raw).digest('hex');
      return withTransaction(pool,async db=>{
        // Serializes acceptance with early callbacks and orders competing callbacks for the same provider message.
        await db.query('select pg_advisory_xact_lock(hashtext($1))',[`email_event/${messageId}`]);
        const prior=(await db.query('select payload_digest from email_delivery_events where event_id=$1',[id])).rows[0];
        if(prior){if(prior.payload_digest!==digest)throw requestError(409,'Email event identity conflict.');return {replayed:true};}
        await db.query('insert into email_delivery_events(event_id,provider_message_id,event_type,occurred_at,payload_digest) values($1,$2,$3,$4,$5)',[id,messageId,event.type,time,digest]);
        const row=(await db.query('select notification_id as id from email_deliveries where provider_message_id=$1',[messageId])).rows[0];
        if(row)await applyEvents(db,row.id,messageId);
        return {recorded:true};
      });
    }
  };
}

export function startEmailDeliveryWorker({repository,logger,intervalMs=30000}) {
  let stopped=false,inFlight=null;
  const tick=()=>{if(stopped || inFlight)return;inFlight=repository.processEmailDeliveries({limit:10}).catch(()=>logger.error('email_worker_failed',{code:'EMAIL_WORKER_UNAVAILABLE'})).finally(()=>{inFlight=null;});};
  const timer=setInterval(tick,intervalMs);timer.unref?.();tick();
  return {async stop(){stopped=true;clearInterval(timer);await inFlight;}};
}
