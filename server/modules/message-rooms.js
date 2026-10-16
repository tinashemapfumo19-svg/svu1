import {createHmac,randomUUID} from 'node:crypto';
import {decryptSecret,encryptSecret,normalizeEmail} from '../security.js';
import {validNotificationDestination} from '../notification-queue.js';
import {insertAudit,isGlobalScope,requestError,withTransaction} from '../support.js';
import {privatePairKey,privatePosition} from './private-messages.js';
import {activityAfter,activityCursor,activityEpoch,activityGrants,activityResult} from './chat-activity.js';
import {readCommandAuthority} from './chat-command-context.js';

const fields=(input,allowed)=>{if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw requestError(400,'Unsupported room fields.');};
const bounded=(value,max)=>{if(typeof value!=='string' || !value.trim() || value.length>max || value.includes('\0'))throw requestError(400,'Provide bounded room text.');return value.trim();};
const messageBody=value=>{bounded(value,4000);return value;};
const revision=(value,min=1)=>{if(!Number.isSafeInteger(value) || value<min || value>2147483646)throw requestError(400,'Provide the current room revision.');return value;};
const canonical=value=>Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export function roomAuthority(actor,permission) {
  return !!actor?.accountId && !!actor.roles?.some(role=>role.permissions?.includes(permission) && (permission==='rooms.self' || isGlobalScope(role.scope)));
}
export function roomPage(input={},history=false) {
  fields(input,history ? ['before'] : ['offset']);
  if(history)return {before:privatePosition(input.before)};
  const offset=input.offset ?? '0';
  if(typeof offset!=='string' || !/^(?:0|[1-9]\d{0,5})$/.test(offset) || Number(offset)>100000)throw requestError(400,'Invalid room page.');return {offset:Number(offset)};
}
const blockedSql=`not exists(select 1 from private_contact_blocks b where b.active and ((b.account_id=$2 and b.peer_id=m.author_id) or (b.peer_id=$2 and b.account_id=m.author_id)))`;
const roomSelection=`select r.id,r.title,r.purpose,r.policy_reference as "policyReference",r.retention_rule as "retentionRule",r.status,r.revision,r.created_by as "createdBy",r.reviewed_by as "reviewedBy",
  own.id as "membershipId",own.status as "membershipStatus",own.role,own.revision as "membershipRevision",own.consent_revision as "consentRevision"
  from message_rooms r left join lateral(select * from message_room_memberships m where m.room_id=r.id and m.account_id=$1 order by m.invited_at desc,m.id desc limit 1) own on true`;

export function createMessageRoomsModule(pool,{dataEncryptionKey}={}) {
  const requireLocal=(actor,permission)=>{if(!roomAuthority(actor,permission))throw requestError(403,'Room authority is required.');};
  const secureKey=()=>{if(!Buffer.isBuffer(dataEncryptionKey) || dataEncryptionKey.length!==32)throw requestError(503,'Room encryption key is unavailable.');};
  async function fresh(db,actor,permission) {
    requireLocal(actor,permission);
    const found=await db.query(`select a.id from accounts a join role_assignments ra on ra.account_id=a.id
      join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
      where a.id=$1 and a.status='active' and ra.ended_at is null and ra.effective_from<=current_date
      and (ra.effective_to is null or ra.effective_to>=current_date) and rp.permission_code=$2 and ($2='rooms.self' or ra.scope='{}'::jsonb) for share of a,ra,r,rp`,[actor.accountId,permission]);
    if(!found.rowCount)throw requestError(403,'Current room authority is required.');
  }
  const audit=(db,actor,id,action,metadata={})=>insertAudit(db,{actorId:actor.accountId,action:`message_room.${action}`,subjectType:'MessageRoom',subjectId:id,reason:'Authorized institutional room action',metadata});
  const preference=async(db,id,lock=false)=>(await db.query(`select enabled,revision from room_message_preferences where account_id=$1${lock ? ' for share' : ''}`,[id])).rows[0] || {enabled:false,revision:0};
  async function room(db,id) {
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`message-room:${id}`]);
    const row=(await db.query('select * from message_rooms where id=$1',[id])).rows[0];if(!row)throw requestError(404,'Room was not found.');return row;
  }
  async function participant(db,id,actor) {
    const row=(await db.query(`select m.*,p.enabled,p.revision as preference_revision from message_room_memberships m join room_message_preferences p on p.account_id=m.account_id
      where m.room_id=$1 and m.account_id=$2 and m.status='accepted' for share of p`,[id,actor.accountId])).rows[0];
    if(!row || !row.enabled || row.consent_revision!==row.preference_revision)throw requestError(404,'Current room participation was not found.');return row;
  }
  async function moderator(db,definition,actor) {
    const row=await participant(db,definition.id,actor);
    if(row.role!=='moderator') {
      if(definition.created_by!==actor.accountId)throw requestError(403,'Current room moderator authority is required.');
      await fresh(db,actor,'rooms.manage');
    }
    return row;
  }
  async function history(db,row,actor,reason) {
    await db.query('insert into message_room_membership_history(membership_id,revision,status,role,actor_id,reason_encrypted) values($1,$2,$3,$4,$5,$6)',
      [row.id,row.revision,row.status,row.role,actor.accountId,encryptSecret(JSON.stringify({membershipId:row.id,roomId:row.room_id,revision:row.revision,actorId:actor.accountId,reason}),dataEncryptionKey)]);
  }
  async function command(action,id,input,actor,permission,work,gate,reportCommand=false) {
    requireLocal(actor,permission);secureKey();
    if(typeof input.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))throw requestError(400,'Provide a room request key.');
    const hash=createHmac('sha256',dataEncryptionKey).update(JSON.stringify(canonical({action,id,input}))).digest('hex');
    try {return await withTransaction(pool,async db=>{
      await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`room-command:${actor.accountId}`]);
      // Room locks precede account/preference locks; preference changes never lock rooms.
      let roomId=id;
      if(reportCommand){roomId=(await db.query('select room_id from room_abuse_reports where id=$1',[id])).rows[0]?.room_id;if(!roomId)throw requestError(404,'Report was not found.');}
      const definition=roomId ? await room(db,roomId) : null;await fresh(db,actor,permission);if(gate)await gate(db,definition);
      const previous=(await db.query('select input_hash,result from room_message_receipts where actor_id=$1 and request_key=$2',[actor.accountId,input.requestKey])).rows[0];
      if(previous){if(previous.input_hash!==hash)throw requestError(409,'Request key belongs to a different room command.');return previous.result;}
      const result=await work(db,definition);await audit(db,actor,id || result.id,action,{revision:result.revision ?? null});
      await db.query('insert into room_message_receipts(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)',[actor.accountId,input.requestKey,hash,JSON.stringify(result)]);return result;
    });}catch(error){if(['23503','23505','23514','P0001','40001','40P01'].includes(error.code))throw requestError(409,'Room records changed or conflict. Refresh before acting.');throw error;}
  }
  const active=definition=>{if(definition.status!=='active')throw requestError(409,'Room is not active.');};
  async function reportRecord(db,id) {
    const row=(await db.query(`select q.*,m.author_id,r.created_by,r.title,coalesce(e.revision,0) as revision,coalesce(e.status,'open') as status,e.assignee_id
      from room_abuse_reports q join room_messages m on m.id=q.message_id join message_rooms r on r.id=q.room_id
      left join lateral(select revision,status,assignee_id from room_abuse_events where report_id=q.id order by revision desc limit 1) e on true where q.id=$1`,[id])).rows[0];
    if(!row)throw requestError(404,'Report was not found.');return row;
  }
  const uninvolved=(row,actor)=>{if([row.reporter_id,row.author_id,row.created_by].includes(actor.accountId))throw requestError(403,'An uninvolved safety reviewer is required.');};
  function reportContent(row) {
    try{const c=JSON.parse(decryptSecret(row.envelope,dataEncryptionKey));
      if(c.id!==row.id || c.roomId!==row.room_id || c.messageId!==row.message_id || c.reporterId!==row.reporter_id || c.membershipId!==row.membership_id || c.authorId!==row.author_id || c.category!==row.category
        || bounded(c.reason,2000)!==c.reason || messageBody(c.body)!==c.body || !['text','action','notice'].includes(c.kind))throw new Error();return c;
    }catch{throw requestError(409,'Report evidence requires secure reconciliation.');}
  }
  return {
    async roomInvitationCommandContext(id,input,actor) {
      fields(input,['email']);requireLocal(actor,'rooms.self');secureKey();
      const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
      const version=value=>typeof value==='string' && /^(?:0|[1-9]\d{0,9})$/.test(value) && BigInt(value)<=4294967295n;
      if(!identifier(id) || !validNotificationDestination(input.email))throw requestError(400,'Provide one known contact mailbox.');
      const email=normalizeEmail(input.email),unavailable=()=>requestError(404,'An available room contact was not found.');
      try{return await withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const definition=await room(db,id);await fresh(db,actor,'rooms.self');active(definition);
        const own=await moderator(db,definition,actor),authority=await readCommandAuthority(db,actor,dataEncryptionKey);
        const matches=(await db.query('select id from accounts where lower(btrim(email))=$1 limit 2',[email])).rows;
        if(matches.length!==1 || !identifier(matches[0].id) || matches[0].id===actor.accountId)throw unavailable();
        const peer=matches[0].id;
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[privatePairKey(actor.accountId,peer)]);
        const grants=(await db.query(`select a.id,a.xmin::text as account_version,p.enabled,p.revision,p.xmin::text as preference_version,
          ra.id as assignment_id,ra.xmin::text as assignment_version,r.code as role_code,r.xmin::text as role_version,rp.xmin::text as permission_version
          from accounts a join room_message_preferences p on p.account_id=a.id
          join role_assignments ra on ra.account_id=a.id join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
          where lower(btrim(a.email))=$1 and a.id=$3 and a.status='active' and p.enabled and a.id<>$2 and ra.ended_at is null and ra.effective_from<=current_date
          and not exists(select 1 from accounts other where other.id<>a.id and lower(btrim(other.email))=$1)
          and (ra.effective_to is null or ra.effective_to>=current_date) and rp.permission_code='rooms.self'
          and not exists(select 1 from private_contact_blocks b where b.active and ((b.account_id=$2 and b.peer_id=a.id) or (b.peer_id=$2 and b.account_id=a.id)))
          order by a.id,ra.id,r.code,rp.permission_code limit 4097 for share of a,p,ra,r,rp`,[email,actor.accountId,peer])).rows;
        if(!grants.length)throw unavailable();
        const consent=(await db.query(`select enabled,xmin::text as version from room_message_preference_history where account_id=$1 and revision=$2 for share`,[peer,grants[0].revision])).rows[0];
        const latest=(await db.query(`select id,status,role,revision,xmin::text as version from message_room_memberships
          where room_id=$1 and account_id=$2 order by invited_at desc,id desc limit 1 for share`,[id,peer])).rows[0] || null;
        if(latest && ['pending','accepted','banned'].includes(latest.status))throw unavailable();
        const roomVersion=(await db.query('select xmin::text as version from message_rooms where id=$1 for share',[id])).rows[0]?.version;
        const ownVersions=(await db.query(`select m.xmin::text as membership,p.xmin::text as preference from message_room_memberships m join room_message_preferences p on p.account_id=m.account_id
          where m.id=$1 and m.room_id=$2 and m.account_id=$3 and m.status='accepted' and p.enabled and m.consent_revision=p.revision for share of m,p`,[own.id,id,actor.accountId])).rows[0];
        const blocks=(await db.query(`select account_id,peer_id,active,revision::text,xmin::text as version from private_contact_blocks
          where (account_id=$1 and peer_id=$2) or (peer_id=$1 and account_id=$2) order by account_id,peer_id for share`,[actor.accountId,peer])).rows;
        if(!identifier(own.id) || !['member','moderator'].includes(own.role) || ![roomVersion,ownVersions?.membership,ownVersions?.preference].every(version)
          || grants.length>4096 || new Set(grants.map(row=>`${row.assignment_id}:${row.role_code}`)).size!==grants.length
          || grants.some(row=>row.id!==peer || row.enabled!==true || !Number.isSafeInteger(row.revision) || row.revision<1 || row.revision>2147483646
            || !identifier(row.assignment_id) || !identifier(row.role_code) || ![row.account_version,row.preference_version,row.assignment_version,row.role_version,row.permission_version].every(version)
            || row.account_version!==grants[0].account_version || row.preference_version!==grants[0].preference_version || row.revision!==grants[0].revision)
          || consent?.enabled!==true || !version(consent?.version)
          || latest && (!identifier(latest.id) || !['declined','left','removed'].includes(latest.status) || !['member','moderator'].includes(latest.role) || !Number.isSafeInteger(latest.revision) || latest.revision<1 || latest.revision>2147483646 || !version(latest.version))
          || blocks.length>2 || blocks.some(row=>!((row.account_id===actor.accountId && row.peer_id===peer) || (row.account_id===peer && row.peer_id===actor.accountId)) || typeof row.active!=='boolean' || !version(row.revision) || !version(row.version)))throw requestError(409,'Room invitation requires secure reconciliation.');
        if(blocks.some(row=>row.active))throw unavailable();
        const count=(await db.query("select count(*)::int as total from message_room_memberships where invited_by=$1 and invited_at>clock_timestamp()-interval '1 day'",[actor.accountId])).rows[0]?.total;
        if(!Number.isSafeInteger(count) || count<0)throw requestError(409,'Room invitation requires secure reconciliation.');
        if(count>=50)throw requestError(429,'Daily room invitation limit reached.');
        const targetId=createHmac('sha256',dataEncryptionKey).update('room-invitation-recipient\0').update(JSON.stringify({v:1,room:id,peer,email})).digest('base64url');
        const epoch=createHmac('sha256',dataEncryptionKey).update('room-invitation-context\0').update(JSON.stringify({v:1,authority:authority.epoch,room:id,roomVersion,
          own:own.id,ownVersions,targetId,grants,consent,latest,blocks})).digest('base64url');
        return {accountId:authority.accountId,authorityEpoch:authority.epoch,epoch,targetType:'invitation',targetId,operations:['invite']};
      });}catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Room invitation authority changed. Refresh before recalling.');throw error;}
    },
    async roomCommandContext(id,input,actor) {
      fields(input,['targetType','targetId']);requireLocal(actor,'rooms.self');secureKey();
      const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
      if(!identifier(id) || !identifier(input.targetId) || !['member','message'].includes(input.targetType))throw requestError(400,'Provide a current room command target.');
      try{return await withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const definition=await room(db,id);await fresh(db,actor,'rooms.self');active(definition);
        const own=await moderator(db,definition,actor),authority=await readCommandAuthority(db,actor,dataEncryptionKey);
        const roomVersion=(await db.query('select xmin::text as version from message_rooms where id=$1 for share',[id])).rows[0]?.version;
        const ownVersions=(await db.query(`select m.xmin::text as membership,p.xmin::text as preference from message_room_memberships m join room_message_preferences p on p.account_id=m.account_id
          where m.id=$1 and m.room_id=$2 and m.account_id=$3 and m.status='accepted' and p.enabled and m.consent_revision=p.revision for share of m,p`,[own.id,id,actor.accountId])).rows[0];
        const peerPreference=async accountId=>(await db.query(`select p.enabled,p.revision,p.xmin::text as version,h.enabled as history_enabled,h.xmin::text as history_version
          from room_message_preferences p join room_message_preference_history h on h.account_id=p.account_id and h.revision=p.revision
          where p.account_id=$1 for share of p,h`,[accountId])).rows[0] || null;
        let target,operations,currentRevision,peerConsent;
        if(input.targetType==='member'){
          target=(await db.query(`select m.id,m.account_id,m.status,m.role,m.revision,m.consent_revision,m.xmin::text as command_version,a.xmin::text as account_version,a.status as account_status
            from message_room_memberships m join accounts a on a.id=m.account_id where m.room_id=$1 and m.id=$2 for share of m,a`,[id,input.targetId])).rows[0];
          if(!target || !['pending','accepted','banned'].includes(target.status))throw requestError(404,'Current room membership was not found.');
          if(!['member','moderator'].includes(target.role))throw requestError(409,'Room membership requires secure reconciliation.');
          if(target.account_id===actor.accountId || target.account_id===definition.created_by)throw requestError(403,'That membership has no permitted operator action.');
          peerConsent=await peerPreference(target.account_id);
          operations=target.status==='banned'?['unban']:(target.role==='member' || definition.created_by===actor.accountId?['remove','ban']:[]);
          if(target.status==='accepted' && target.account_status==='active' && peerConsent?.enabled && peerConsent.history_enabled && peerConsent.revision===target.consent_revision
            && definition.created_by===actor.accountId && roomAuthority(actor,'rooms.manage')){
            await fresh(db,actor,'rooms.manage');operations.push(target.role==='moderator'?'demote':'promote');
          }
          if(!operations.length)throw requestError(403,'That membership has no permitted operator action.');
          currentRevision=target.revision;
        }else{
          target=(await db.query(`select m.id,m.author_id as account_id,m.xmin::text as command_version,a.xmin::text as account_version
            from room_messages m join accounts a on a.id=m.author_id where m.room_id=$1 and m.id=$3
            and m.created_at>=(select accepted_at from message_room_memberships where id=$4) and ${blockedSql} for share of m,a`,[id,actor.accountId,input.targetId,own.id])).rows[0];
          if(!target)throw requestError(404,'Current room message was not found.');
          peerConsent=await peerPreference(target.account_id);
          const moderation=(await db.query('select revision,hidden from room_message_moderation where room_id=$1 and message_id=$2 order by revision desc limit 1',[id,input.targetId])).rows[0];
          if(moderation && typeof moderation.hidden!=='boolean')throw requestError(409,'Room moderation requires secure reconciliation.');
          currentRevision=moderation?.revision ?? 0;operations=[moderation?.hidden?'restore':'hide'];
        }
        const blocks=(await db.query(`select account_id,peer_id,active,revision::text,xmin::text as command_version from private_contact_blocks
          where (account_id=$1 and peer_id=$2) or (peer_id=$1 and account_id=$2) order by account_id,peer_id for share`,[actor.accountId,target.account_id])).rows;
        const version=value=>typeof value==='string' && /^(?:0|[1-9]\d{0,9})$/.test(value) && BigInt(value)<=4294967295n;
        if(!identifier(own.id) || !['member','moderator'].includes(own.role) || !identifier(target.account_id) || !Number.isSafeInteger(currentRevision) || currentRevision<(input.targetType==='member'?1:0) || currentRevision>2147483646
          || ![roomVersion,ownVersions?.membership,ownVersions?.preference,target.command_version,target.account_version].every(version)
          || peerConsent && (!version(peerConsent.version) || !version(peerConsent.history_version) || !Number.isSafeInteger(peerConsent.revision) || peerConsent.revision<1 || peerConsent.revision>2147483646 || typeof peerConsent.enabled!=='boolean' || typeof peerConsent.history_enabled!=='boolean')
          || blocks.length>2 || blocks.some(row=>!identifier(row.account_id) || !identifier(row.peer_id) || typeof row.active!=='boolean' || !version(row.revision) || !version(row.command_version)))throw requestError(409,'Room command target requires secure reconciliation.');
        const epoch=createHmac('sha256',dataEncryptionKey).update('room-command-target\0').update(JSON.stringify({v:1,authority:authority.epoch,room:id,roomVersion,
          membership:own.id,membershipVersion:ownVersions.membership,preferenceVersion:ownVersions.preference,type:input.targetType,target:input.targetId,targetVersion:target.command_version,peer:target.account_id,peerVersion:target.account_version,peerConsent,blocks})).digest('base64url');
        return {accountId:authority.accountId,authorityEpoch:authority.epoch,epoch,targetType:input.targetType,targetId:input.targetId,revision:currentRevision,operations};
      });}catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Room command authority changed. Refresh before recalling.');throw error;}
    },
    async roomMessageActivity(id,input,actor) {
      requireLocal(actor,'rooms.self');secureKey();const scope=JSON.stringify(['room',id]),previous=activityCursor(input,actor,scope,dataEncryptionKey);
      try{return await withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');const definition=await room(db,id);await fresh(db,actor,'rooms.self');
        const member=await participant(db,id,actor);active(definition);
        const blocks=(await db.query('select coalesce(sum(revision),0)::text as revision from private_contact_blocks where account_id=$1 or peer_id=$1',[actor.accountId])).rows[0].revision;
        const epoch=activityEpoch({membership:member.id,consent:member.consent_revision,blocks,grants:await activityGrants(db,[actor.accountId],'rooms.self')},dataEncryptionKey),after=activityAfter(previous,epoch);
        const snapshot=(await db.query(`with visible as (
          select m.position,m.author_id,m.kind,coalesce(md.hidden,false) as hidden from room_messages m
          left join lateral(select hidden from room_message_moderation where message_id=m.id order by revision desc limit 1) md on true
          where m.room_id=$1 and m.created_at>=(select accepted_at from message_room_memberships where id=$4) and ${blockedSql}
        ) select coalesce(max(position),0)::text as latest,
          count(*) filter(where $3::bigint is not null and position>$3::bigint and kind in ('text','action') and not hidden and author_id=$2)::text as own,
          count(*) filter(where $3::bigint is not null and position>$3::bigint and kind in ('text','action') and not hidden and author_id<>$2)::text as others from visible`,[id,actor.accountId,after,member.id])).rows[0];
        return activityResult(snapshot,after,epoch,actor,scope,dataEncryptionKey);
      });}catch(error){if(['40001','40P01'].includes(error.code))throw requestError(409,'Room authority changed. Refresh before continuing.');throw error;}
    },
    async reportRoomMessage(id,messageId,input,actor) {
      fields(input,['category','reason','disclose','requestKey']);const reason=bounded(input.reason,2000);
      if(!['harassment','threat','spam','privacy','other'].includes(input.category) || input.disclose!==true)throw requestError(400,'Choose a report category and explicit evidence disclosure.');
      return command('report.created',id,{...input,messageId},actor,'rooms.self',async(db,definition)=>{
        const member=await participant(db,id,actor);
        const message=(await db.query(`select m.*,coalesce(md.hidden,false) as hidden from room_messages m
          left join lateral(select hidden from room_message_moderation where message_id=m.id order by revision desc limit 1) md on true
          where m.id=$1 and m.room_id=$2 and m.author_id<>$3 and m.created_at>=(select accepted_at from message_room_memberships where id=$4)
          and not exists(select 1 from private_contact_blocks b where b.active and ((b.account_id=$3 and b.peer_id=m.author_id) or (b.peer_id=$3 and b.account_id=m.author_id)))`,[messageId,id,actor.accountId,member.id])).rows[0];
        if(!message || message.hidden)throw requestError(404,'A reportable message was not found.');
        let content;try{content=JSON.parse(decryptSecret(message.envelope,dataEncryptionKey));if(content.id!==message.id || content.roomId!==id || content.authorId!==message.author_id || content.membershipId!==message.membership_id || content.kind!==message.kind || messageBody(content.body)!==content.body)throw new Error();}catch{throw requestError(409,'Room content requires secure reconciliation.');}
        const count=(await db.query("select count(*)::int as total from room_abuse_reports where reporter_id=$1 and created_at>clock_timestamp()-interval '1 day'",[actor.accountId])).rows[0].total;if(count>=50)throw requestError(429,'Daily report limit reached.');
        const reportId=`rab_${randomUUID()}`,snapshot={id:reportId,roomId:id,messageId,reporterId:actor.accountId,membershipId:member.id,authorId:message.author_id,category:input.category,reason,body:content.body,kind:message.kind,position:String(message.position),messageCreatedAt:message.created_at.toISOString(),roomTitle:definition.title};
        await db.query('insert into room_abuse_reports(id,room_id,message_id,reporter_id,membership_id,category,disclosed,envelope) values($1,$2,$3,$4,$5,$6,true,$7)',[reportId,id,messageId,actor.accountId,member.id,input.category,encryptSecret(JSON.stringify(snapshot),dataEncryptionKey)]);
        return {id:reportId,revision:0,status:'open'};
      },async db=>{await participant(db,id,actor);});
    },
    async listRoomReports(input,actor) {
      fields(input,['offset','view','status']);const {offset}=roomPage({offset:input.offset}),view=input.view ?? 'own',status=input.status ?? 'all';
      if(!['own','triage'].includes(view) || !['all','open','reviewing','resolved','dismissed'].includes(status))throw requestError(400,'Invalid report filter.');
      const permission=view==='triage'?'rooms.triage':'rooms.self';requireLocal(actor,permission);
      return withTransaction(pool,async db=>{await db.query('set transaction isolation level repeatable read');await fresh(db,actor,permission);
        const scope=`($2::boolean or q.reporter_id=$1) and ($3='all' or coalesce(e.status,'open')=$3)`;
        const from=`from room_abuse_reports q join message_rooms r on r.id=q.room_id join room_messages m on m.id=q.message_id left join lateral(select revision,status,assignee_id from room_abuse_events where report_id=q.id order by revision desc limit 1) e on true`;
        const items=(await db.query(`select q.id,q.room_id as "roomId",r.title,q.category,q.created_at as "createdAt",coalesce(e.status,'open') as status,coalesce(e.revision,0) as revision,
          e.assignee_id=$1 as "assignedToMe",not(q.reporter_id=$1 or m.author_id=$1 or r.created_by=$1) as eligible ${from} where ${scope} order by q.created_at desc,q.id desc limit 25 offset $4`,[actor.accountId,view==='triage',status,offset])).rows;
        const total=(await db.query(`select count(*)::int as total ${from} where ${scope}`,[actor.accountId,view==='triage',status])).rows[0].total;
        await audit(db,actor,'reports','reports.read',{count:items.length,offset,view});return {items,total,offset,limit:25,view,status};
      });
    },
    async roomReportDetail(id,input,actor) {
      fields(input,['view','offset']);const {offset}=roomPage({offset:input.offset}),view=input.view ?? 'own';if(!['own','triage'].includes(view))throw requestError(400,'Invalid report view.');
      const permission=view==='triage'?'rooms.triage':'rooms.self';requireLocal(actor,permission);secureKey();
      return withTransaction(pool,async db=>{
        const initial=await reportRecord(db,id);await room(db,initial.room_id);await fresh(db,actor,permission);const row=await reportRecord(db,id);
        if(view==='own'){if(row.reporter_id!==actor.accountId)throw requestError(404,'Report was not found.');}else uninvolved(row,actor);
        const content=reportContent(row),events=(await db.query('select revision,operation,status,assignee_id as "assigneeId",actor_id as "actorId",recorded_at as "recordedAt",envelope from room_abuse_events where report_id=$1 order by revision desc limit 25 offset $2',[id,offset])).rows;
        const items=events.map(({envelope,...e})=>{if(view==='own')return {revision:e.revision,operation:e.operation,status:e.status,recordedAt:e.recordedAt};
          try{const c=JSON.parse(decryptSecret(envelope,dataEncryptionKey));if(c.reportId!==id || c.revision!==e.revision || c.actorId!==e.actorId || c.operation!==e.operation || c.status!==e.status || c.assigneeId!==e.assigneeId || bounded(c.details,2000)!==c.details)throw new Error();return {...e,details:c.details};}catch{throw requestError(409,'Report review evidence requires secure reconciliation.');}});
        await audit(db,actor,id,'report.read',{view,offset,count:items.length});
        return {id,roomId:row.room_id,title:content.roomTitle,category:row.category,status:row.status,revision:row.revision,createdAt:row.created_at,body:content.body,reason:content.reason,kind:content.kind,messageCreatedAt:content.messageCreatedAt,assignedToMe:row.assignee_id===actor.accountId,view,events:{items,total:row.revision,offset,limit:25}};
      });
    },
    async triageRoomReport(id,input,actor) {
      fields(input,['revision','operation','details','requestKey']);revision(input.revision,0);const details=bounded(input.details,2000);
      if(!['claim','release','resolve','dismiss','reopen'].includes(input.operation))throw requestError(400,'Choose a report review action.');
      return command('report.triaged',id,input,actor,'rooms.triage',async db=>{
        const row=await reportRecord(db,id);if(row.revision!==input.revision)throw requestError(409,'Report review changed.');
        const status={claim:'reviewing',release:'open',resolve:'resolved',dismiss:'dismissed',reopen:'open'}[input.operation],assigneeId=input.operation==='claim'?actor.accountId:null,next=row.revision+1;
        const content={reportId:id,revision:next,operation:input.operation,status,assigneeId,actorId:actor.accountId,details};
        await db.query('insert into room_abuse_events(report_id,revision,operation,status,assignee_id,actor_id,envelope) values($1,$2,$3,$4,$5,$6,$7)',[id,next,input.operation,status,assigneeId,actor.accountId,encryptSecret(JSON.stringify(content),dataEncryptionKey)]);return {id,revision:next,status};
      },async db=>{uninvolved(await reportRecord(db,id),actor);},true);
    },
    async roomChanges(input,actor) {
      fields(input,[]);requireLocal(actor,'rooms.self');secureKey();
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');await fresh(db,actor,'rooms.self');
        const manages=roomAuthority(actor,'rooms.manage'),approves=roomAuthority(actor,'rooms.approve'),triages=roomAuthority(actor,'rooms.triage');
        if(manages)await fresh(db,actor,'rooms.manage');if(approves)await fresh(db,actor,'rooms.approve');if(triages)await fresh(db,actor,'rooms.triage');
        const result=(await db.query(`with own as (
          select m.*,r.created_by from message_room_memberships m join message_rooms r on r.id=m.room_id
          join room_message_preferences p on p.account_id=m.account_id where m.account_id=$1 and m.status='accepted' and p.enabled and p.revision=m.consent_revision
        ), visible as (
          select m.id,m.position from room_messages m join own o on o.room_id=m.room_id where m.created_at>=o.accepted_at
          and not exists(select 1 from private_contact_blocks b where b.active and ((b.account_id=$1 and b.peer_id=m.author_id) or (b.peer_id=$1 and b.account_id=m.author_id)))
        ) select
          (select count(*)::text from message_rooms r where $2::boolean or exists(select 1 from message_room_memberships m where m.room_id=r.id and m.account_id=$1) or r.created_by=$1) as rooms,
          (select coalesce(sum(r.revision),0)::text from message_rooms r where $2::boolean or exists(select 1 from message_room_memberships m where m.room_id=r.id and m.account_id=$1) or r.created_by=$1) as room_revisions,
          (select count(*)::text from message_room_memberships where account_id=$1) as memberships,
          (select coalesce(sum(revision),0)::text from message_room_memberships where account_id=$1) as membership_revisions,
          (select count(*)::text from message_room_memberships m where exists(select 1 from own o where o.room_id=m.room_id and (o.role='moderator' or o.created_by=$1 and $3::boolean))) as roster_count,
          (select coalesce(sum(m.revision),0)::text from message_room_memberships m where exists(select 1 from own o where o.room_id=m.room_id and (o.role='moderator' or o.created_by=$1 and $3::boolean))) as roster_revisions,
          (select count(*)::text from visible) as messages,
          (select coalesce(sum(position),0)::text from visible) as message_positions,
          (select count(*)::text from room_message_moderation md join visible v on v.id=md.message_id) as moderations,
          (select coalesce(sum(md.revision),0)::text from room_message_moderation md join visible v on v.id=md.message_id) as moderation_revisions,
          (select coalesce(sum(revision),0)::text from private_contact_blocks where account_id=$1 or peer_id=$1) as block_revisions,
          (select count(*)::text from room_abuse_reports where $4::boolean or reporter_id=$1) as reports,
          (select coalesce(sum(e.revision),0)::text from room_abuse_events e join room_abuse_reports q on q.id=e.report_id where $4::boolean or q.reporter_id=$1) as report_revisions`,[actor.accountId,manages || approves,manages,triages])).rows[0];
        const stamp=createHmac('sha256',dataEncryptionKey).update(JSON.stringify(canonical({actorId:actor.accountId,roles:actor.roles,preferences:await preference(db,actor.accountId),result}))).digest('hex');
        return {stamp};
      });
    },
    async roomWorkspace(input,actor) {
      requireLocal(actor,'rooms.self');const {offset}=roomPage(input);
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');await fresh(db,actor,'rooms.self');
        const manages=roomAuthority(actor,'rooms.manage'),approves=roomAuthority(actor,'rooms.approve'),triages=roomAuthority(actor,'rooms.triage');if(manages)await fresh(db,actor,'rooms.manage');if(approves)await fresh(db,actor,'rooms.approve');if(triages)await fresh(db,actor,'rooms.triage');
        const scope=`($2::boolean or exists(select 1 from message_room_memberships m where m.room_id=r.id and m.account_id=$1) or r.created_by=$1)`;
        const items=(await db.query(`${roomSelection} where ${scope} order by r.created_at desc,r.id desc limit 25 offset $3`,[actor.accountId,manages || approves,offset])).rows;
        const total=(await db.query(`select count(*)::int as total from message_rooms r where ${scope}`,[actor.accountId,manages || approves])).rows[0].total;
        await audit(db,actor,'workspace','workspace.read',{offset,count:items.length});return {items,total,offset,limit:25,preferences:await preference(db,actor.accountId),accountId:actor.accountId,capabilities:{manage:manages,approve:approves,report:true,triage:triages,summary:true,invitationContext:true}};
      });
    },
    async roomSummary(id,input,actor) {
      fields(input,[]);requireLocal(actor,'rooms.self');
      try{return await withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');await fresh(db,actor,'rooms.self');
        const manages=roomAuthority(actor,'rooms.manage'),approves=roomAuthority(actor,'rooms.approve');
        if(manages)await fresh(db,actor,'rooms.manage');if(approves)await fresh(db,actor,'rooms.approve');
        const row=(await db.query(`${roomSelection} where r.id=$3 and ($2::boolean or own.id is not null or r.created_by=$1)`,[actor.accountId,manages || approves,id])).rows[0];
        if(!row)throw requestError(404,'Room was not found.');
        await audit(db,actor,id,'summary.read');return {room:row,preferences:await preference(db,actor.accountId),capabilities:{manage:manages,approve:approves}};
      });}catch(error){if(error.code==='40001')throw requestError(409,'Room authority changed. Refresh before continuing.');throw error;}
    },
    async setRoomPreferences(input,actor) {
      fields(input,['revision','enabled','requestKey']);revision(input.revision,0);if(typeof input.enabled!=='boolean')throw requestError(400,'Provide an explicit room choice.');
      return command('preferences.changed',null,input,actor,'rooms.self',async db=>{
        await db.query('select id from accounts where id=$1 for update',[actor.accountId]);const old=await preference(db,actor.accountId);if(old.revision!==input.revision)throw requestError(409,'Room preferences changed.');
        const next=old.revision+1;
        await db.query('insert into room_message_preferences(account_id,enabled,revision) values($1,$2,$3) on conflict(account_id) do update set enabled=excluded.enabled,revision=excluded.revision,updated_at=clock_timestamp()',[actor.accountId,input.enabled,next]);
        await db.query('insert into room_message_preference_history(account_id,revision,enabled) values($1,$2,$3)',[actor.accountId,next,input.enabled]);return {id:actor.accountId,enabled:input.enabled,revision:next};
      });
    },
    async createMessageRoom(input,actor) {
      fields(input,['title','purpose','policyReference','retentionRule','requestKey']);const data=[bounded(input.title,200),bounded(input.purpose,2000),bounded(input.policyReference,300),bounded(input.retentionRule,2000)];
      return command('created',null,input,actor,'rooms.manage',async db=>{const id=`room_${randomUUID()}`;await db.query('insert into message_rooms(id,title,purpose,policy_reference,retention_rule,created_by) values($1,$2,$3,$4,$5,$6)',[id,...data,actor.accountId]);return {id,revision:1,status:'draft'};});
    },
    async changeMessageRoom(id,operation,input,actor) {
      fields(input,['revision','requestKey']);revision(input.revision);if(!['activate','close'].includes(operation))throw requestError(400,'Invalid room lifecycle action.');
      return command(operation,id,input,actor,'rooms.approve',async(db,row)=>{
        if(row.revision!==input.revision || row.status==='closed' || operation==='activate' && row.status!=='draft')throw requestError(409,'Room lifecycle changed.');
        if(operation==='activate' && row.created_by===actor.accountId)throw requestError(403,'Room activation requires an independent reviewer.');
        await db.query(`update message_rooms set status=$2,revision=revision+1,reviewed_by=case when $2='active' then $3 else reviewed_by end,activated_at=case when $2='active' then clock_timestamp() else activated_at end,closed_at=case when $2='closed' then clock_timestamp() else null end where id=$1`,[id,operation==='activate' ? 'active' : 'closed',actor.accountId]);return {id,status:operation==='activate' ? 'active' : 'closed',revision:row.revision+1};
      });
    },
    async joinOwnMessageRoom(id,input,actor) {
      fields(input,['requestKey']);return command('owner.joined',id,input,actor,'rooms.manage',async(db,row)=>{
        active(row);if(row.created_by!==actor.accountId)throw requestError(403,'Only the creator can explicitly join their approved room.');
        const pref=await preference(db,actor.accountId,true),membershipId=`rm_${randomUUID()}`;
        const member=(await db.query(`insert into message_room_memberships(id,room_id,account_id,invited_by,status,invited_at,accepted_at,accepted_by,consent_revision) values($1,$2,$3,$3,'accepted',clock_timestamp(),clock_timestamp(),$3,$4) returning *`,[membershipId,id,actor.accountId,pref.revision || null])).rows[0];
        await history(db,member,actor,'Creator explicitly accepted room participation');return {id:membershipId,revision:1,status:'accepted'};
      });
    },
    async inviteRoomMember(id,input,actor) {
      fields(input,['email','requestKey']);if(!validNotificationDestination(input.email))throw requestError(400,'Provide one known contact mailbox.');const email=normalizeEmail(input.email);
      return command('invited',id,input,actor,'rooms.self',async db=>{
        const matches=(await db.query('select id from accounts where lower(btrim(email))=$1 limit 2',[email])).rows;
        const target=matches.length===1 ? matches[0] : null;
        if(!target || target.id===actor.accountId)throw requestError(404,'An available room contact was not found.');
        // Share contact-block ordering, then recheck the resolved mailbox and authority.
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[privatePairKey(actor.accountId,target.id)]);
        const recipient=(await db.query(`select a.id from accounts a join room_message_preferences p on p.account_id=a.id
          join role_assignments ra on ra.account_id=a.id join roles r on r.code=ra.role_code and r.active join role_permissions rp on rp.role_code=r.code
          where lower(btrim(a.email))=$1 and a.id=$3 and a.status='active' and p.enabled and a.id<>$2 and ra.ended_at is null and ra.effective_from<=current_date
          and not exists(select 1 from accounts other where other.id<>a.id and lower(btrim(other.email))=$1)
          and (ra.effective_to is null or ra.effective_to>=current_date) and rp.permission_code='rooms.self'
          and not exists(select 1 from private_contact_blocks b where b.active and ((b.account_id=$2 and b.peer_id=a.id) or (b.peer_id=$2 and b.account_id=a.id)))
          order by a.id,ra.id,r.code,rp.permission_code for share of a,p,ra,r,rp`,[email,actor.accountId,target.id])).rows[0];
        if(!recipient)throw requestError(404,'An available room contact was not found.');
        const count=(await db.query("select count(*)::int as total from message_room_memberships where invited_by=$1 and invited_at>clock_timestamp()-interval '1 day'",[actor.accountId])).rows[0].total;if(count>=50)throw requestError(429,'Daily room invitation limit reached.');
        const member=(await db.query('insert into message_room_memberships(id,room_id,account_id,invited_by,invited_at) values($1,$2,$3,$4,clock_timestamp()) returning *',[`rm_${randomUUID()}`,id,recipient.id,actor.accountId])).rows[0];
        await history(db,member,actor,'Room participation invitation');return {id:member.id,revision:1,status:'pending'};
      },async(db,row)=>{active(row);await moderator(db,row,actor);});
    },
    async changeRoomMember(id,membershipId,operation,input,actor) {
      fields(input,['revision','reason','requestKey']);revision(input.revision);if(!['accept','decline','leave','remove','ban','unban','promote','demote'].includes(operation))throw requestError(400,'Invalid membership action.');
      const reason=['remove','ban','unban','promote','demote'].includes(operation) ? bounded(input.reason,2000) : operation,privileged=['promote','demote'].includes(operation);
      return command(`member.${operation}`,id,input,actor,privileged ? 'rooms.manage' : 'rooms.self',async(db,row)=>{
        active(row);const member=(await db.query('select * from message_room_memberships where id=$1 and room_id=$2',[membershipId,id])).rows[0];
        if(!member || ['accept','decline','leave'].includes(operation) && member.account_id!==actor.accountId)throw requestError(404,'Room membership was not found.');if(member.revision!==input.revision)throw requestError(409,'Membership changed.');
        if(privileged && row.created_by!==actor.accountId)throw requestError(403,'Only the room creator can appoint moderators.');
        if(privileged && member.account_id===row.created_by)throw requestError(403,'Creator moderation depends on current institutional stewardship, not self-appointment.');
        if(['remove','ban'].includes(operation) && (member.account_id===row.created_by || member.role==='moderator' && row.created_by!==actor.accountId))throw requestError(403,'Only the creator can remove another moderator; the creator cannot be removed.');
        const expected={accept:['pending'],decline:['pending'],leave:['accepted'],remove:['pending','accepted'],ban:['pending','accepted'],unban:['banned'],promote:['accepted'],demote:['accepted']}[operation];if(!expected.includes(member.status))throw requestError(409,'Membership cannot make this transition.');
        const status={accept:'accepted',decline:'declined',leave:'left',remove:'removed',ban:'banned',unban:'left',promote:'accepted',demote:'accepted'}[operation],pref=operation==='accept' ? await preference(db,actor.accountId,true) : null;
        const updated=(await db.query(`update message_room_memberships set status=$2,role=$3,revision=revision+1,accepted_at=case when $4 then clock_timestamp() else accepted_at end,
          accepted_by=case when $4 then account_id else accepted_by end,consent_revision=case when $4 then $5 else consent_revision end,
          ended_at=case when $2 in ('declined','left','removed','banned') then coalesce(ended_at,clock_timestamp()) else ended_at end where id=$1 returning *`,
          [member.id,status,operation==='promote' ? 'moderator' : operation==='demote' ? 'member' : member.role,operation==='accept',pref?.revision || null])).rows[0];
        await history(db,updated,actor,reason);return {id:member.id,status,role:updated.role,revision:updated.revision};
      },['remove','ban','unban','promote','demote'].includes(operation) ? async(db,row)=>{active(row);await moderator(db,row,actor);} : null);
    },
    async sendRoomMessage(id,input,actor) {
      fields(input,['body','kind','requestKey']);const body=messageBody(input.body),kind=input.kind ?? 'text';if(!['text','action','notice'].includes(kind))throw requestError(400,'Invalid room message kind.');
      return command('sent',id,input,actor,'rooms.self',async db=>{
        const count=(await db.query("select count(*)::int as total from room_messages where author_id=$1 and created_at>clock_timestamp()-interval '1 minute'",[actor.accountId])).rows[0].total;if(count>=30)throw requestError(429,'Room message sending limit reached.');
        const member=await participant(db,id,actor),messageId=`rmsg_${randomUUID()}`,envelope=encryptSecret(JSON.stringify({id:messageId,roomId:id,authorId:actor.accountId,membershipId:member.id,kind,body}),dataEncryptionKey);
        return (await db.query('insert into room_messages(id,room_id,author_id,membership_id,kind,envelope,created_at) values($1,$2,$3,$4,$5,$6,clock_timestamp()) returning id,position::text',[messageId,id,actor.accountId,member.id,kind,envelope])).rows[0];
      },async(db,row)=>{active(row);if(kind==='notice')await moderator(db,row,actor);else await participant(db,id,actor);});
    },
    async moderateRoomMessage(id,messageId,input,actor) {
      fields(input,['revision','hidden','reason','requestKey']);revision(input.revision,0);const reason=bounded(input.reason,2000);if(typeof input.hidden!=='boolean')throw requestError(400,'Provide an explicit moderation choice.');
      return command('moderated',id,input,actor,'rooms.self',async db=>{
        const member=await participant(db,id,actor);
        if(!(await db.query(`select m.id from room_messages m where m.room_id=$1 and m.id=$3 and m.created_at>=(select accepted_at from message_room_memberships where id=$4) and ${blockedSql}`,[id,actor.accountId,messageId,member.id])).rowCount)throw requestError(404,'Room message was not found.');
        const old=(await db.query('select coalesce(max(revision),0)::int as revision from room_message_moderation where message_id=$1',[messageId])).rows[0].revision;if(old!==input.revision)throw requestError(409,'Message moderation changed.');
        await db.query('insert into room_message_moderation(room_id,message_id,revision,hidden,actor_id,reason_encrypted) values($1,$2,$3,$4,$5,$6)',[id,messageId,old+1,input.hidden,actor.accountId,encryptSecret(JSON.stringify({roomId:id,messageId,revision:old+1,actorId:actor.accountId,reason}),dataEncryptionKey)]);return {id:messageId,revision:old+1,hidden:input.hidden};
      },async(db,row)=>{active(row);await moderator(db,row,actor);});
    },
    async listRoomMessages(id,input,actor) {
      requireLocal(actor,'rooms.self');secureKey();const {before}=roomPage(input,true);
      return withTransaction(pool,async db=>{
        await room(db,id);await fresh(db,actor,'rooms.self');const member=await participant(db,id,actor);
        const rows=(await db.query(`select m.id,m.position::text,m.author_id as "authorId",m.membership_id as "membershipId",m.kind,m.envelope,m.created_at as "createdAt",coalesce(p.preferred_name,'Participant') as "authorName",coalesce(md.hidden,false) as hidden,coalesce(md.revision,0) as "moderationRevision"
          from room_messages m join accounts a on a.id=m.author_id join people p on p.id=a.person_id left join lateral(select hidden,revision from room_message_moderation where message_id=m.id order by revision desc limit 1) md on true
          where m.room_id=$1 and m.created_at>=(select accepted_at from message_room_memberships where id=$3) and ($4::bigint is null or m.position<$4::bigint) and ${blockedSql} order by m.position desc limit 31`,[id,actor.accountId,member.id,before])).rows;
        const items=rows.slice(0,30).map(({envelope,...message})=>{
          if(message.hidden)return {...message,body:null};
          try {const content=JSON.parse(decryptSecret(envelope,dataEncryptionKey));if(content.id!==message.id || content.roomId!==id || content.authorId!==message.authorId || content.membershipId!==message.membershipId || content.kind!==message.kind || messageBody(content.body)!==content.body)throw new Error();return {...message,body:content.body};}
          catch{throw requestError(409,'Room content requires secure reconciliation.');}
        });await audit(db,actor,id,'history.read',{count:items.length});return {items,nextBefore:rows.length>30 ? items.at(-1).position : null};
      });
    },
    async listRoomMembers(id,input,actor) {
      requireLocal(actor,'rooms.self');const {offset}=roomPage(input);
      return withTransaction(pool,async db=>{
        const definition=await room(db,id);await fresh(db,actor,'rooms.self');await moderator(db,definition,actor);
        const items=(await db.query(`select m.id,m.account_id as "accountId",m.status,m.role,m.revision,coalesce(p.preferred_name,'Participant') as name from message_room_memberships m join accounts a on a.id=m.account_id join people p on p.id=a.person_id
          where m.room_id=$1 and m.status in ('pending','accepted','banned') order by m.invited_at,m.id limit 25 offset $2`,[id,offset])).rows;
        const total=(await db.query("select count(*)::int as total from message_room_memberships where room_id=$1 and status in ('pending','accepted','banned')",[id])).rows[0].total;
        await audit(db,actor,id,'members.read',{offset,count:items.length});return {items,total,offset,limit:25};
      });
    }
  };
}
