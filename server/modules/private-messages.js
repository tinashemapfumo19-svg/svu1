import { createHmac, randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret, normalizeEmail } from '../security.js';
import { validNotificationDestination } from '../notification-queue.js';
import { insertAudit, requestError, withTransaction } from '../support.js';
import {activityAfter,activityCursor,activityEpoch,activityGrants,activityResult} from './chat-activity.js';

const permission='messages.self';
export const privatePairKey=(a,b)=>`private-pair:${JSON.stringify([a,b].sort())}`;
const fields=(input,allowed)=>{if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw requestError(400,'Unsupported private message fields.');};
const text=(value,max)=>typeof value==='string' && !!value.trim() && value.length<=max && !value.includes('\0');
const key=value=>typeof value==='string' && /^[A-Za-z0-9_-]{8,100}$/.test(value);
export function privateMessageInput(input,operation) {
  const allowed={preferences:['revision','enabled'],invite:['email','requestKey'],send:['body','kind','requestKey'],accept:['revision'],decline:['revision'],close:['revision'],block:['revision','blocked'],read:['through'],report:['reason']}[operation];
  if(!allowed)throw requestError(400,'Unsupported private message action.');fields(input,allowed);
  if(['preferences','accept','decline','close','block'].includes(operation) && (!Number.isSafeInteger(input.revision) || input.revision<(['preferences','block'].includes(operation) ? 0 : 1)))throw requestError(400,'Provide the current private message revision.');
  if(operation==='preferences' && typeof input.enabled!=='boolean' || operation==='block' && typeof input.blocked!=='boolean')throw requestError(400,'Provide an explicit private message choice.');
  if(operation==='invite' && (!validNotificationDestination(input.email) || !key(input.requestKey)))throw requestError(400,'Provide one known mailbox and a request key.');
  if(operation==='send' && (!text(input.body,4000) || !key(input.requestKey)))throw requestError(400,'Enter a message up to 4000 characters and a request key.');
  if(operation==='send' && input.kind!==undefined && !['text','action'].includes(input.kind))throw requestError(400,'Invalid private message kind.');
  if(operation==='report' && !text(input.reason,2000))throw requestError(400,'Enter a report reason up to 2000 characters.');
  if(operation==='read')privatePosition(input.through,false);
  return input;
}
export function privatePosition(value,optional=true) {
  if(optional && (value===undefined || value===''))return null;
  if(typeof value!=='string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value)>9223372036854775807n)throw requestError(400,'Invalid private message position.');
  return value;
}
export function privateMessagePage(input={}) {
  fields(input,['offset','before']);
  const offset=input.offset ?? '0';if(typeof offset!=='string' || !/^\d{1,7}$/.test(offset) || Number(offset)>1000000)throw requestError(400,'Invalid conversation page.');
  return {offset:Number(offset),before:privatePosition(input.before)};
}
const peerSql='case when c.account_a=$1 then c.account_b else c.account_a end';
const memberSql='($1=c.account_a or $1=c.account_b)';
const conversationSelection=`select c.id,c.status,c.revision,c.created_at as "createdAt",c.accepted_at as "acceptedAt",c.closed_at as "closedAt",c.invited_by=$1 as "outgoing",${peerSql} as "peerId",
  coalesce(p.preferred_name,'Contact') as "peerName",coalesce(b.active,false) as "blocked",coalesce(b.revision,0) as "blockRevision",
  (select count(*)::int from private_messages m join private_message_reads r on r.conversation_id=c.id and r.account_id=$1 where m.conversation_id=c.id and m.author_id<>$1 and m.position>r.through_position) as unread,
  (select max(m.position)::text from private_messages m where m.conversation_id=c.id) as "latestPosition"
  from private_conversations c join accounts a on a.id=${peerSql} join people p on p.id=a.person_id
  left join private_contact_blocks b on b.account_id=$1 and b.peer_id=a.id`;
export function createPrivateMessagesModule(pool,{dataEncryptionKey}={}) {
  const digest=value=>createHmac('sha256',dataEncryptionKey).update(JSON.stringify(value)).digest('hex');
  const authority=actor=>{if(!actor?.accountId || !actor.permissions?.includes(permission))throw requestError(403,'Private message authority is required.');};
  async function authorityRows(db,ids) {
    return (await db.query(`select a.id from accounts a join role_assignments ra on ra.account_id=a.id
      join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
      where a.id=any($1::text[]) and a.status='active' and ra.ended_at is null and ra.effective_from<=current_date
      and (ra.effective_to is null or ra.effective_to>=current_date) and rp.permission_code=$2
      order by a.id,ra.id,r.code,rp.permission_code for share of a,ra,r,rp`,[ids,permission])).rows;
  }
  async function transact(actor,work,mode='write') {
    try {return await withTransaction(pool,async db=>{
      if(mode==='snapshot')await db.query('set transaction isolation level repeatable read');
      // Serialize an actor's writes before shared authority locks and pair/account upgrades.
      if(mode==='write')await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`private-command:${actor.accountId}`]);
      authority(actor);
      if(!(await authorityRows(db,[actor.accountId])).length)throw requestError(403,'Current private message authority is required.');
      return work(db);
    });}catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Private message authority or records changed. Refresh before continuing.');throw error;}
  }
  const audit=(db,actor,id,action,metadata={})=>insertAudit(db,{actorId:actor.accountId,action:`private_message.${action}`,subjectType:'PrivateConversation',subjectId:id,reason:'Participant private messaging action',metadata});
  async function preference(db,id) {return (await db.query('select enabled,revision,updated_at as "updatedAt" from private_message_preferences where account_id=$1',[id])).rows[0] || {enabled:false,revision:0,updatedAt:null};}
  async function conversation(db,id,actor,lock=false) {
    const row=(await db.query(`select c.* from private_conversations c where c.id=$2 and ${memberSql}${lock ? ' for update' : ''}`,[actor.accountId,id])).rows[0];
    if(!row)throw requestError(404,'Private conversation was not found.');return row;
  }
  async function pair(db,a,b) {
    const ids=[a,b].sort();
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[privatePairKey(a,b)]);
    const accounts=await authorityRows(db,ids);
    const preferences=(await db.query('select account_id,enabled from private_message_preferences where account_id=any($1::text[]) order by account_id for share',[ids])).rows;
    const blocked=(await db.query('select 1 from private_contact_blocks where active and ((account_id=$1 and peer_id=$2) or (account_id=$2 and peer_id=$1))',[a,b])).rowCount;
    return {ids,eligible:new Set(accounts.map(row=>row.id)).size===2 && preferences.length===2 && preferences.every(row=>row.enabled) && !blocked};
  }
  async function lockedConversation(db,id,actor,requireEligible=true) {
    const origin=await conversation(db,id,actor),gate=await pair(db,origin.account_a,origin.account_b);
    if(requireEligible && !gate.eligible)throw requestError(409,'Private messaging is unavailable for this contact.');
    return conversation(db,id,actor,true);
  }
  const peer=(row,id)=>row.account_a===id ? row.account_b : row.account_a;
  async function closeContacts(db,id) {
    const rows=(await db.query("select id from private_conversations where (account_a=$1 or account_b=$1) and status in ('pending','accepted') order by id for update",[id])).rows;
    for(const row of rows)await db.query("update private_conversations set status='closed',closed_at=now(),revision=revision+1 where id=$1",[row.id]);
    return rows.length;
  }
  return {
    async privateMessageActivity(id,input,actor) {
      authority(actor);const scope=JSON.stringify(['private',id]),previous=activityCursor(input,actor,scope,dataEncryptionKey);
      return transact(actor,async db=>{
        const origin=await conversation(db,id,actor),gate=await pair(db,origin.account_a,origin.account_b);
        const row=await conversation(db,id,actor);
        if(!gate.eligible || row.status!=='accepted')throw requestError(409,'Private messaging is unavailable for this contact.');
        const preferences=(await db.query('select account_id,revision from private_message_preferences where account_id=any($1::text[]) order by account_id',[gate.ids])).rows;
        const epoch=activityEpoch({revision:row.revision,preferences,grants:await activityGrants(db,gate.ids,permission)},dataEncryptionKey),after=activityAfter(previous,epoch);
        const snapshot=(await db.query(`select coalesce(max(position),0)::text as latest,
          count(*) filter(where $3::bigint is not null and position>$3::bigint and author_id=$2)::text as own,
          count(*) filter(where $3::bigint is not null and position>$3::bigint and author_id<>$2)::text as others
          from private_messages where conversation_id=$1`,[id,actor.accountId,after])).rows[0];
        return activityResult(snapshot,after,epoch,actor,scope,dataEncryptionKey);
      },'snapshot');
    },
    async getPrivateMessagePreferences(actor) {authority(actor);return transact(actor,db=>preference(db,actor.accountId),'read');},
    async setPrivateMessagePreferences(input,actor) {
      authority(actor);privateMessageInput(input,'preferences');
      return transact(actor,async db=>{
        await db.query('select id from accounts where id=$1 for update',[actor.accountId]);
        const current=await preference(db,actor.accountId);if(current.revision!==input.revision)throw requestError(409,'Private preferences changed; refresh before saving.');
        if(current.revision && current.enabled===input.enabled)return current;
        const revision=current.revision+1;
        await db.query('insert into private_message_preferences(account_id,enabled,revision) values($1,$2,$3) on conflict(account_id) do update set enabled=excluded.enabled,revision=excluded.revision,updated_at=now()',[actor.accountId,input.enabled,revision]);
        await db.query('insert into private_message_preference_history(account_id,revision,enabled) values($1,$2,$3)',[actor.accountId,revision,input.enabled]);
        const closed=input.enabled ? 0 : await closeContacts(db,actor.accountId);
        await audit(db,actor,actor.accountId,'preferences.changed',{revision,enabled:input.enabled,closed});return preference(db,actor.accountId);
      });
    },
    async invitePrivateContact(input,actor) {
      authority(actor);privateMessageInput(input,'invite');const email=normalizeEmail(input.email),hash=digest({email});
      return transact(actor,async db=>{
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`private-invite:${actor.accountId}`]);
        const previous=(await db.query('select id,request_digest from private_conversations where invited_by=$1 and request_key=$2',[actor.accountId,input.requestKey])).rows[0];
        if(previous){if(previous.request_digest!==hash)throw requestError(409,'This contact request key was already used.');return {id:previous.id};}
        const matches=(await db.query('select id from accounts where lower(btrim(email))=$1 limit 2',[email])).rows;
        const recipient=matches.length===1 ? matches[0] : null;
        if(!recipient || recipient.id===actor.accountId)throw requestError(404,'An opted-in contact was not found.');
        const gate=await pair(db,actor.accountId,recipient.id);if(!gate.eligible)throw requestError(404,'An opted-in contact was not found.');
        const current=(await db.query('select id from accounts where lower(btrim(email))=$1 limit 2',[email])).rows;
        if(current.length!==1 || current[0].id!==recipient.id)throw requestError(404,'An opted-in contact was not found.');
        const recent=(await db.query("select count(*)::int as total from private_conversations where invited_by=$1 and created_at>clock_timestamp()-interval '1 day'",[actor.accountId])).rows[0].total;
        if(recent>=20)throw requestError(429,'Daily private contact request limit reached.');
        const active=(await db.query("select id from private_conversations where account_a=$1 and account_b=$2 and status in ('pending','accepted')",gate.ids)).rows[0];
        if(active)throw requestError(409,'An active contact request or conversation already exists.');
        const id=`pc_${randomUUID()}`;
        await db.query('insert into private_conversations(id,account_a,account_b,invited_by,request_key,request_digest,created_at) values($1,$2,$3,$4,$5,$6,clock_timestamp())',[id,...gate.ids,actor.accountId,input.requestKey,hash]);
        await db.query('insert into private_message_reads(conversation_id,account_id) values($1,$2),($1,$3)',[id,...gate.ids]);
        await audit(db,actor,id,'invited');return {id};
      });
    },
    async listPrivateConversations(input,actor) {
      authority(actor);const {offset,before}=privateMessagePage(input);if(before)throw requestError(400,'Use conversation pagination, not a message position.');
      return transact(actor,async db=>{
        const total=(await db.query(`select count(*)::int as total from private_conversations c where ${memberSql}`,[actor.accountId])).rows[0].total;
        const items=(await db.query(`${conversationSelection} where ${memberSql} order by c.created_at desc,c.id desc limit 25 offset $2`,[actor.accountId,offset])).rows;
        return {items,total,offset,limit:25,summary:true};
      },'snapshot');
    },
    async privateConversationSummary(id,input,actor) {
      authority(actor);fields(input,[]);
      return transact(actor,async db=>{
        const row=(await db.query(`${conversationSelection} where ${memberSql} and c.id=$2`,[actor.accountId,id])).rows[0];
        if(!row)throw requestError(404,'Private conversation was not found.');
        await audit(db,actor,id,'summary.read');
        return {conversation:row,preferences:await preference(db,actor.accountId)};
      },'snapshot');
    },
    async changePrivateConversation(id,operation,input,actor) {
      authority(actor);privateMessageInput(input,operation);
      if(!['accept','decline','close'].includes(operation))throw requestError(400,'Unsupported conversation action.');
      return transact(actor,async db=>{
        const row=await lockedConversation(db,id,actor,operation==='accept');
        if(row.revision!==input.revision)throw requestError(409,'Conversation changed; refresh before acting.');
        if(['accept','decline'].includes(operation) && (row.status!=='pending' || row.invited_by===actor.accountId))throw requestError(409,'Only the invited contact can answer a pending request.');
        if(operation==='close' && !['pending','accepted'].includes(row.status))throw requestError(409,'This conversation is already closed.');
        const status={accept:'accepted',decline:'declined',close:'closed'}[operation];
        await db.query("update private_conversations set status=$2,accepted_at=case when $2='accepted' then now() else accepted_at end,closed_at=case when $2 in ('declined','closed') then now() else null end,revision=revision+1 where id=$1",[id,status]);
        await audit(db,actor,id,operation);return {id,status,revision:row.revision+1};
      });
    },
    async sendPrivateMessage(id,input,actor) {
      authority(actor);privateMessageInput(input,'send');const body=input.body,kind=input.kind ?? 'text',hash=`v3:${digest({id,body,kind})}`;
      return transact(actor,async db=>{
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`private-send:${actor.accountId}`]);
        const row=await lockedConversation(db,id,actor);if(row.status!=='accepted')throw requestError(409,'This contact has not accepted an active conversation.');
        const old=(await db.query('select id,position::text,request_digest from private_messages where author_id=$1 and request_key=$2',[actor.accountId,input.requestKey])).rows[0];
        // Historical receipts bind text only; they must never replay an action intent.
        if(old){const expected=old.request_digest.startsWith('v3:') ? hash : kind!=='text' ? null : old.request_digest.startsWith('v2:') ? `v2:${digest({id,body})}` : digest({id,body:body.trim()});if(old.request_digest!==expected)throw requestError(409,'This message request key was already used.');return {id:old.id,position:old.position};}
        const recent=(await db.query("select count(*)::int as total from private_messages where author_id=$1 and created_at>clock_timestamp()-interval '1 minute'",[actor.accountId])).rows[0].total;
        if(recent>=30)throw requestError(429,'Private message sending limit reached.');
        const messageId=`pm_${randomUUID()}`,envelope=encryptSecret(JSON.stringify({id:messageId,conversationId:id,authorId:actor.accountId,body,kind}),dataEncryptionKey);
        const result=(await db.query('insert into private_messages(id,conversation_id,author_id,envelope,request_key,request_digest,created_at) values($1,$2,$3,$4,$5,$6,clock_timestamp()) returning id,position::text',[messageId,id,actor.accountId,envelope,input.requestKey,hash])).rows[0];
        await audit(db,actor,id,'sent',{messageId});return result;
      });
    },
    async listPrivateMessages(id,input,actor) {
      authority(actor);const {before,offset}=privateMessagePage(input);if(offset)throw requestError(400,'Use a message position, not an offset.');
      return transact(actor,async db=>{
        const row=await conversation(db,id,actor);
        const rows=(await db.query(`select m.id,m.position::text,m.author_id as "authorId",m.envelope,m.created_at as "createdAt",
          m.author_id=$2 as own,m.position<=r.through_position as "readByPeer",exists(select 1 from private_message_reports pr where pr.message_id=m.id and pr.reporter_id=$2) as reported
          from private_messages m join private_message_reads r on r.conversation_id=m.conversation_id and r.account_id=$4
          where m.conversation_id=$1 and ($3::bigint is null or m.position<$3::bigint) order by m.position desc limit 31`,[id,actor.accountId,before,peer(row,actor.accountId)])).rows;
        const items=rows.slice(0,30).map(({envelope,authorId,...message})=>{
          try {
            const content=JSON.parse(decryptSecret(envelope,dataEncryptionKey));
            const kind=Object.hasOwn(content,'kind') ? content.kind : 'text';
            if(content.id!==message.id || content.conversationId!==id || content.authorId!==authorId || !text(content.body,4000) || !['text','action'].includes(kind))throw new Error();
            return {...message,body:content.body,kind};
          }catch{throw requestError(409,'Private message content requires secure reconciliation.');}
        });
        await audit(db,actor,id,'history.read',{count:items.length});return {items,nextBefore:rows.length>30 ? items.at(-1).position : null,status:row.status,revision:row.revision};
      },'snapshot');
    },
    async markPrivateMessagesRead(id,input,actor) {
      authority(actor);privateMessageInput(input,'read');
      return transact(actor,async db=>{
        await conversation(db,id,actor);
        if(!(await db.query('select 1 from private_messages where conversation_id=$1 and position=$2',[id,input.through])).rowCount)throw requestError(400,'Choose a message from this conversation.');
        const current=(await db.query('select through_position::text from private_message_reads where conversation_id=$1 and account_id=$2 for update',[id,actor.accountId])).rows[0];
        if(BigInt(current.through_position)>=BigInt(input.through))return {through:current.through_position};
        await db.query('update private_message_reads set through_position=$3,updated_at=now() where conversation_id=$1 and account_id=$2',[id,actor.accountId,input.through]);
        await audit(db,actor,id,'read',{through:input.through});return {through:input.through};
      });
    },
    async setPrivateContactBlock(id,input,actor) {
      authority(actor);privateMessageInput(input,'block');
      return transact(actor,async db=>{
        const row=await lockedConversation(db,id,actor,false),peerId=peer(row,actor.accountId);
        const current=(await db.query('select active,revision from private_contact_blocks where account_id=$1 and peer_id=$2 for update',[actor.accountId,peerId])).rows[0] || {active:false,revision:0};
        if(current.revision!==input.revision)throw requestError(409,'Contact block changed; refresh before acting.');
        if(current.revision && current.active===input.blocked)return {blocked:current.active,revision:current.revision};
        const revision=current.revision+1;
        await db.query('insert into private_contact_blocks(account_id,peer_id,active,revision) values($1,$2,$3,$4) on conflict(account_id,peer_id) do update set active=excluded.active,revision=excluded.revision,updated_at=now()',[actor.accountId,peerId,input.blocked,revision]);
        if(input.blocked)await db.query("update private_conversations set status='closed',closed_at=now(),revision=revision+1 where account_a=$1 and account_b=$2 and status in ('pending','accepted')",[row.account_a,row.account_b]);
        await audit(db,actor,id,input.blocked ? 'blocked' : 'unblocked',{revision});return {blocked:input.blocked,revision};
      });
    },
    async reportPrivateMessage(id,messageId,input,actor) {
      authority(actor);privateMessageInput(input,'report');
      return transact(actor,async db=>{
        await conversation(db,id,actor);
        if(!(await db.query('select 1 from private_messages where id=$1 and conversation_id=$2',[messageId,id])).rowCount)throw requestError(404,'Private message was not found.');
        const result=await db.query('insert into private_message_reports(message_id,reporter_id,reason_encrypted) values($1,$2,$3) on conflict do nothing',[messageId,actor.accountId,encryptSecret(JSON.stringify({messageId,reporterId:actor.accountId,reason:input.reason.trim()}),dataEncryptionKey)]);
        if(result.rowCount)await audit(db,actor,id,'reported',{messageId});return {reported:true};
      });
    },
    async privateMessageChanges(actor) {
      authority(actor);
      return transact(actor,async db=>{
        const changes=(await db.query(`select count(*) filter(where c.status='pending' and c.invited_by<>$1)::int as pending,
          coalesce(sum(c.revision),0)::text as "conversationRevision",
          (select count(*)::int from private_messages m join private_conversations own on own.id=m.conversation_id
            join private_message_reads r on r.conversation_id=own.id and r.account_id=$1 where ($1=own.account_a or $1=own.account_b) and m.author_id<>$1 and m.position>r.through_position) as unread,
          (select max(m.position)::text from private_messages m join private_conversations own on own.id=m.conversation_id where $1=own.account_a or $1=own.account_b) as "latestPosition",
          (select count(*)::text from private_messages m join private_conversations own on own.id=m.conversation_id where $1=own.account_a or $1=own.account_b) as "messageRevision",
          (select coalesce(sum(r.through_position),0)::text from private_message_reads r join private_conversations own on own.id=r.conversation_id where $1=own.account_a or $1=own.account_b) as "readRevision"
          from private_conversations c where ${memberSql}`,[actor.accountId])).rows[0];
        return {...changes,preferenceRevision:(await preference(db,actor.accountId)).revision};
      },'snapshot');
    }
  };
}
