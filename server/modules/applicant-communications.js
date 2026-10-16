import {createHmac,randomUUID} from 'node:crypto';
import {actorCanAccessScope,insertAudit,requestError,withTransaction} from '../support.js';
import {encryptSecret,decryptSecret} from '../security.js';
import {canonicalNotificationDestination} from '../notification-queue.js';

const permission = 'admissions.communicate';
const text = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');
const fields = (input,allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,'Unsupported communication fields.');
};
export function communicationFilters(input) {
  fields(input,['intakeId','status','workflowState']);
  const result = {intakeId:input.intakeId,status:input.status ?? 'submitted',workflowState:input.workflowState ?? ''};
  if (!text(result.intakeId,160) || !['draft','submitted','withdrawn'].includes(result.status)
    || typeof result.workflowState !== 'string' || result.workflowState.length > 100 || /[\r\n\0]/.test(result.workflowState)
    || result.status !== 'submitted' && result.workflowState) throw requestError(400,'Select an intake and a valid application status/state.');
  return result;
}
export function validateCommunicationPreview(input) {
  fields(input,['filters','subject','body','channels','reason','requestKey']);
  if (!text(input.subject,160) || /[\r\n]/.test(input.subject) || !text(input.body,4000) || !text(input.reason,2000)
    || !Array.isArray(input.channels) || !input.channels.length || input.channels.length > 2
    || input.channels.some((channel) => !['in_app','email'].includes(channel)) || new Set(input.channels).size !== input.channels.length
    || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey)) throw requestError(400,'Enter a bounded subject, message and reason, choose channels, and provide a request key.');
  return {filters:communicationFilters(input.filters),subject:input.subject.trim(),body:input.body.trim(),reason:input.reason.trim(),channels:[...input.channels].sort(),requestKey:input.requestKey};
}
export function validateCommunicationPreferences(input) {
  fields(input,['revision','inApp','email']);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.inApp !== 'boolean' || typeof input.email !== 'boolean') throw requestError(400,'Provide current preference revision and explicit channel choices.');
  return input;
}
export function communicationsCan(actor,row) {
  return actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId});
}
export function communicationAudience(rows,input) {
  const matched = rows.filter((row) => row.status === input.filters.status && (!input.filters.workflowState || row.workflowState === input.filters.workflowState));
  const accounts = new Map();
  for (const row of matched) if (!accounts.has(row.accountId)) accounts.set(row.accountId,row);
  const recipients = [];
  for (const row of [...accounts.values()].sort((a,b) => a.accountId.localeCompare(b.accountId))) {
    if (row.accountStatus !== 'active') continue;
    const email = canonicalNotificationDestination(row.email);
    for (const channel of input.channels) {
      if (channel === 'in_app' ? row.inApp !== true : row.emailConsent !== true || !email) continue;
      recipients.push({accountId:row.accountId,name:row.name,channel,preferenceRevision:row.preferenceRevision,email:channel === 'email' ? email : null});
    }
  }
  if (recipients.length > 500) throw requestError(413,'This group exceeds 500 recipient/channel records. Choose a narrower audience.');
  const count = (channel) => recipients.filter((row) => row.channel === channel).length;
  return {recipients,counts:{applications:matched.length,accounts:accounts.size,recipientChannels:recipients.length,
    inApp:count('in_app'),email:count('email'),excludedInApp:input.channels.includes('in_app') ? accounts.size-count('in_app') : 0,
    excludedEmail:input.channels.includes('email') ? accounts.size-count('email') : 0}};
}

const campaignSelect = `select c.id,c.intake_id as "intakeId",p.code as "programmeCode",i.label as "intakeLabel",c.created_by as "createdBy",
 c.request_hash as "requestHash",c.subject_encrypted as "subjectEncrypted",c.body_encrypted as "bodyEncrypted",c.reason_encrypted as "reasonEncrypted",
 c.audience_encrypted as "audienceEncrypted",c.audience_hash as "audienceHash",c.filters,c.channels,c.counts,c.status,
 c.created_at as "createdAt",c.expires_at as "expiresAt",c.published_at as "publishedAt",c.expires_at <= now() as expired,
 coalesce((select jsonb_object_agg(states.status,states.total) from
   (select r.status,count(*)::int as total from applicant_communication_recipients r where r.campaign_id=c.id and r.channel='email' group by r.status) states),'{}'::jsonb) as "emailDelivery"
 from applicant_communication_campaigns c join intakes i on i.id = c.intake_id join programmes p on p.id = i.programme_id`;
export function createApplicantCommunicationsModule(pool,{dataEncryptionKey} = {}) {
  const encode = (value) => encryptSecret(value,dataEncryptionKey);
  const decode = (value) => {try {return decryptSecret(value,dataEncryptionKey);} catch {throw requestError(409,'Communication text requires reconciliation.');}};
  const hash = (value) => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(value)).digest('hex');
  const authority = (actor,self = false) => {if (!actor.permissions.includes(self ? 'communications.self' : permission)) throw requestError(403,'Communication authority is required.');};
  const audit = (db,actor,action,id,metadata = {}) => insertAudit(db,{actorId:actor.accountId,action:`communications.${action}`,subjectType:'ApplicantCommunication',subjectId:id,reason:'Optional applicant communication workflow',metadata});
  const lockPreference = (db,id) => db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`applicant-communications:${id}`]);
  async function preferences(db,id) {
    return (await db.query(`select in_app as "inApp",email,revision,updated_at as "updatedAt" from applicant_communication_preferences where account_id = $1`,[id])).rows[0]
      || {inApp:false,email:false,revision:0,updatedAt:null};
  }
  async function campaign(db,id,actor,lock = false) {
    authority(actor);
    const row = (await db.query(`${campaignSelect} where c.id = $1${lock ? ' for update of c' : ''}`,[id])).rows[0];
    if (!row || !communicationsCan(actor,row) || row.status === 'preview' && row.createdBy !== actor.accountId) throw requestError(404,'Communication campaign was not found.');
    return row;
  }
  function display(row) {
    let recipients;
    try {
      recipients = JSON.parse(decode(row.audienceEncrypted));
      if (!Array.isArray(recipients) || recipients.length > 500 || recipients.some((entry) => !entry || typeof entry.accountId !== 'string' || !['in_app','email'].includes(entry.channel))) throw new Error('Invalid audience');
    } catch {throw requestError(409,'Communication text requires reconciliation.');}
    return {id:row.id,intakeId:row.intakeId,intakeLabel:row.intakeLabel,programmeCode:row.programmeCode,status:row.status,createdAt:row.createdAt,
      expiresAt:row.expiresAt,publishedAt:row.publishedAt,expired:row.expired,filters:row.filters,channels:row.channels,counts:row.counts,emailDelivery:row.emailDelivery,
      subject:decode(row.subjectEncrypted),body:decode(row.bodyEncrypted),reason:decode(row.reasonEncrypted),
      recipients:recipients.map(({email,preferenceRevision,...recipient}) => recipient)};
  }
  async function metadata(db,actor) {
    authority(actor);
    return (await db.query(`select i.id as "intakeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.starts_on desc,i.id`)).rows.filter((row) => communicationsCan(actor,row));
  }
  async function snapshot(db,input,actor) {
    authority(actor);
    const intake = (await db.query(`select i.id as "intakeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id where i.id = $1 for update of i for share of p`,[input.filters.intakeId])).rows[0];
    if (!intake || !communicationsCan(actor,intake)) throw requestError(404,'Communication intake was not found.');
    // Lock source identities before reading consent. New applications cannot enter through the locked intake FK.
    const sources = (await db.query(`select a.id,a.applicant_account_id as "accountId",a.workflow_instance_id as "workflowId"
      from applications a join accounts acc on acc.id = a.applicant_account_id where a.intake_id = $1 order by a.id limit 10001 for update of a,acc`,[intake.intakeId])).rows;
    if (sources.length > 10000) throw requestError(413,'This intake requires a production-volume communication adapter.');
    const workflowIds = [...new Set(sources.map((row) => row.workflowId).filter(Boolean))].sort();
    if (workflowIds.length) await db.query('select id from workflow_instances where id = any($1::text[]) order by id for update',[workflowIds]);
    for (const id of [...new Set(sources.map((row) => row.accountId))].sort()) await lockPreference(db,id);
    const rows = (await db.query(`select a.id,a.status,a.workflow_instance_id as "workflowId",w.state as "workflowState",w.status as "workflowStatus",
      a.applicant_account_id as "accountId",acc.status as "accountStatus",acc.email,pe.preferred_name as name,
      coalesce(cp.in_app,false) as "inApp",coalesce(cp.email,false) as "emailConsent",coalesce(cp.revision,0) as "preferenceRevision",
      rs.programme_code as "scopeProgrammeCode",rs.intake_id as "scopeIntakeId"
      from applications a join accounts acc on acc.id = a.applicant_account_id join people pe on pe.id = acc.person_id
      left join workflow_instances w on w.id = a.workflow_instance_id left join applicant_communication_preferences cp on cp.account_id = acc.id
      left join resource_scopes rs on rs.resource_type = 'Application' and rs.resource_id = a.id where a.intake_id = $1 order by a.id`,[intake.intakeId])).rows;
    if (rows.some((row) => row.scopeProgrammeCode !== intake.programmeCode || row.scopeIntakeId !== intake.intakeId
      || !['draft','submitted','withdrawn'].includes(row.status) || row.status === 'submitted' && !row.workflowState)) throw requestError(409,'Communication audience sources require reconciliation.');
    const audience = communicationAudience(rows,input);
    return {...audience,hash:hash(rows),intake};
  }
  return {
    async getCommunicationPreferences(actor) {
      authority(actor,true);
      return withTransaction(pool,async (db) => {const result = await preferences(db,actor.accountId);await audit(db,actor,'preferences.read',actor.accountId);return result;});
    },
    async setCommunicationPreferences(input,actor) {
      authority(actor,true);const data = validateCommunicationPreferences(input);
      return withTransaction(pool,async (db) => {
        await lockPreference(db,actor.accountId);const current = await preferences(db,actor.accountId);
        if (current.revision !== data.revision) throw requestError(409,'Preferences changed. Refresh before saving.');
        if (current.revision > 0 && current.inApp === data.inApp && current.email === data.email) return current;
        const revision = current.revision+1;
        await db.query(`insert into applicant_communication_preferences (account_id,in_app,email,revision) values ($1,$2,$3,$4)
          on conflict (account_id) do update set in_app = excluded.in_app,email = excluded.email,revision = excluded.revision,updated_at = now()`,[actor.accountId,data.inApp,data.email,revision]);
        await db.query(`insert into applicant_communication_preference_history (account_id,in_app,email,revision) values ($1,$2,$3,$4)`,[actor.accountId,data.inApp,data.email,revision]);
        if (!data.email) await db.query(`update applicant_communication_recipients set status = 'cancelled' where account_id = $1 and channel = 'email' and status in ('queued','dead')`,[actor.accountId]);
        await audit(db,actor,'preferences.changed',actor.accountId,{revision,inApp:data.inApp,email:data.email});
        return preferences(db,actor.accountId);
      });
    },
    async communicationMetadata(actor) {
      return withTransaction(pool,async (db) => {
        const intakes = await metadata(db,actor);
        const states = (await db.query(`select distinct w.state from applications a join workflow_instances w on w.id = a.workflow_instance_id where a.intake_id = any($1::text[]) order by w.state`,[intakes.map((row) => row.intakeId)])).rows.map((row) => row.state);
        await audit(db,actor,'intakes.read','audience',{count:intakes.length});return {intakes,states};
      });
    },
    async previewApplicantCommunication(input,actor) {
      authority(actor);const data = validateCommunicationPreview(input),requestHash = hash(data);
      return withTransaction(pool,async (db) => {
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`applicant-campaign:${actor.accountId}:${data.requestKey}`]);
        const previous = (await db.query('select id,request_hash as "requestHash" from applicant_communication_campaigns where created_by = $1 and request_key = $2',[actor.accountId,data.requestKey])).rows[0];
        if (previous) {
          const row = await campaign(db,previous.id,actor);
          if (previous.requestHash !== requestHash) throw requestError(409,'This preview key was already used for different content.');
          return display(row);
        }
        const audience = await snapshot(db,data,actor),id = `acm_${randomUUID()}`;
        await db.query(`insert into applicant_communication_campaigns (id,intake_id,created_by,request_key,request_hash,subject_encrypted,body_encrypted,reason_encrypted,filters,channels,audience_encrypted,audience_hash,counts)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,data.filters.intakeId,actor.accountId,data.requestKey,requestHash,encode(data.subject),encode(data.body),encode(data.reason),data.filters,JSON.stringify(data.channels),encode(JSON.stringify(audience.recipients)),audience.hash,audience.counts]);
        await audit(db,actor,'previewed',id,audience.counts);return display(await campaign(db,id,actor));
      });
    },
    async getApplicantCommunication(id,actor) {
      return withTransaction(pool,async (db) => {const row = await campaign(db,id,actor);await audit(db,actor,'campaign.read',id);return display(row);});
    },
    async listApplicantCommunications(input,actor) {
      authority(actor);fields(input,['offset']);const offset = input.offset ?? '0';
      if (!/^\d{1,7}$/.test(String(offset)) || Number(offset) > 1000000) throw requestError(400,'Invalid campaign pagination.');
      return withTransaction(pool,async (db) => {
        const ids = (await metadata(db,actor)).map((row) => row.intakeId);
        const rows = (await db.query(`${campaignSelect} where c.intake_id = any($1::text[]) and (c.status = 'published' or c.created_by = $2) order by c.created_at desc,c.id limit 25 offset $3`,[ids,actor.accountId,Number(offset)])).rows;
        const items = rows.map((row) => ({id:row.id,intakeId:row.intakeId,intakeLabel:row.intakeLabel,programmeCode:row.programmeCode,subject:decode(row.subjectEncrypted),status:row.status,counts:row.counts,emailDelivery:row.emailDelivery,createdAt:row.createdAt}));
        await audit(db,actor,'campaigns.read','campaigns',{count:items.length});return {items,offset:Number(offset),limit:25};
      });
    },
    async publishApplicantCommunication(id,input,actor) {
      fields(input,[]);
      return withTransaction(pool,async (db) => {
        const row = await campaign(db,id,actor,true);
        if (row.createdBy !== actor.accountId) throw requestError(404,'Communication campaign was not found.');
        if (row.status === 'published') return display(row);
        if (row.expired) throw requestError(409,'This preview expired. Create a new preview.');
        const audience = await snapshot(db,{filters:row.filters,channels:row.channels},actor);
        if (row.audienceHash !== audience.hash) throw requestError(409,'Audience or consent changed. Create a new preview.');
        if (!audience.recipients.length) throw requestError(409,'There are no eligible consented recipients.');
        // Decrypt before inserting recipients so corrupt content cannot create a partial campaign.
        display(row);
        for (const recipient of audience.recipients) await db.query(`insert into applicant_communication_recipients (id,campaign_id,account_id,channel,status,recipient_encrypted,preference_revision)
          values ($1,$2,$3,$4,$5,$6,$7)`,[`acr_${randomUUID()}`,id,recipient.accountId,recipient.channel,recipient.channel === 'in_app' ? 'available' : 'queued',recipient.email ? encode(recipient.email) : null,recipient.preferenceRevision]);
        await db.query("update applicant_communication_campaigns set status = 'published',published_at = now() where id = $1",[id]);
        await audit(db,actor,'published',id,audience.counts);return display(await campaign(db,id,actor));
      });
    },
    async listApplicantMessages(input,actor) {
      authority(actor,true);fields(input,['offset']);const offset = input.offset ?? '0';
      if (!/^\d{1,7}$/.test(String(offset)) || Number(offset) > 1000000) throw requestError(400,'Invalid inbox pagination.');
      return withTransaction(pool,async (db) => {
        const rows = (await db.query(`select r.id,c.subject_encrypted as "subjectEncrypted",c.body_encrypted as "bodyEncrypted",r.created_at as "createdAt",r.read_at as "readAt"
          from applicant_communication_recipients r join applicant_communication_campaigns c on c.id = r.campaign_id
          where r.account_id = $1 and r.channel = 'in_app' and r.status = 'available' and c.status = 'published' order by r.created_at desc,r.id limit 25 offset $2`,[actor.accountId,Number(offset)])).rows;
        const items = rows.map(({subjectEncrypted,bodyEncrypted,...row}) => ({...row,subject:decode(subjectEncrypted),body:decode(bodyEncrypted)}));
        await audit(db,actor,'inbox.read',actor.accountId,{count:items.length});return {items,offset:Number(offset),limit:25};
      });
    },
    async readApplicantMessage(id,actor) {
      authority(actor,true);
      return withTransaction(pool,async (db) => {
        const row = (await db.query(`select id,read_at as "readAt" from applicant_communication_recipients where id = $1 and account_id = $2 and channel = 'in_app' and status = 'available' for update`,[id,actor.accountId])).rows[0];
        if (!row) throw requestError(404,'Applicant message was not found.');
        if (!row.readAt) {await db.query('update applicant_communication_recipients set read_at = now() where id = $1',[id]);await audit(db,actor,'message.read',id);}
        return {id,read:true};
      });
    }
  };
}
