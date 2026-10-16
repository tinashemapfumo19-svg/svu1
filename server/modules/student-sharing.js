import { createHmac, randomUUID } from 'node:crypto';
import { createSecret, digestToken, hashSecret, normalizeEmail, passwordProblems } from '../security.js';
import { lockAccountMailbox, requireNewAccountMailbox } from '../account-mailbox.js';
import { queueNotification } from '../notification-queue.js';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { financialStatus } from './student-finance.js';
import { publishedStudentResultRows } from './results.js';

export const shareCategories=Object.freeze(['programme_status','confirmed_registration','published_results','fee_summary']);
const text=(v,max) => typeof v==='string' && v.trim().length>0 && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v);
const fields=(v,keys) => {if(!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))throw requestError(400,'Unsupported sharing fields.');};
const key=v => typeof v==='string' && /^[A-Za-z0-9_-]{16,100}$/.test(v);
export function validateShareInvitation(raw) {
  fields(raw,['email','categories','days','requestKey']);
  if (!text(raw.email,254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email) || !Array.isArray(raw.categories) || !raw.categories.length || raw.categories.length>4
    || raw.categories.some(c => typeof c!=='string' || !shareCategories.includes(c)) || new Set(raw.categories).size!==raw.categories.length
    || !Number.isSafeInteger(raw.days) || raw.days<1 || raw.days>366 || !key(raw.requestKey))throw requestError(400,'Choose an email, permitted record categories, 1-366 access days and a request key.');
  return {email:normalizeEmail(raw.email),categories:[...raw.categories].sort(),days:raw.days,requestKey:raw.requestKey};
}
export function validateShareAction(raw) {
  fields(raw,['revision','requestKey']);
  if (!Number.isSafeInteger(raw.revision) || raw.revision<1 || !key(raw.requestKey))throw requestError(400,'A current share revision and request key are required.');
  return {revision:raw.revision,requestKey:raw.requestKey};
}
export function shareUsable(row,actor,category,now=new Date()) {
  return row.status==='accepted' && row.recipientId===actor.accountId && new Date(row.expiresAt)>now && row.categories.includes(category);
}
export function sharingAuthority(actor,scope) {
  return actor.permissions.includes('sharing.read') && actorCanAccessScope({...actor,authorizingPermission:'sharing.read'},scope);
}
const select=`select g.id,g.student_programme_id as "programmeId",g.owner_id as "ownerId",g.recipient_email as email,g.recipient_id as "recipientId",g.categories,
 g.student_label as student,g.status,g.revision,g.expires_at as "expiresAt",g.challenge_expires_at as "challengeExpiresAt",g.invitation_count as "invitationCount",g.created_at as "createdAt",g.accepted_at as "acceptedAt",g.closed_at as "closedAt" from student_record_shares g`;
const projection=r => ({id:r.id,programmeId:r.programmeId,email:r.email,student:r.student,categories:r.categories,status:r.status,revision:r.revision,expiresAt:r.expiresAt,challengeExpiresAt:r.challengeExpiresAt,invitationCount:r.invitationCount,createdAt:r.createdAt,acceptedAt:r.acceptedAt,closedAt:r.closedAt});

export function createStudentSharingModule(pool,{dataEncryptionKey,devOutboxDir=null}={}) {
  const hash=v => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(v)).digest('hex');
  const transact=async work => {try{return await withTransaction(pool,work);}catch(e){if(['40001','40P01','23505'].includes(e.code))throw requestError(409,'Sharing or account details changed; refresh before retrying.');throw e;}};
  async function ownProgramme(db,id,actor) {
    if (!actor.permissions.includes('registry.self'))throw requestError(403,'Student self-service permission is required.');
    const r=(await db.query(`select sp.id from student_programmes sp join students s on s.id=sp.student_id where sp.id=$1 and s.account_id=$2 for update of sp`,[id,actor.accountId])).rows[0];
    if(!r)throw requestError(404,'Student programme was not found.');return r;
  }
  async function lockGrant(db,id,actor=null) {
    const stub=(await db.query('select student_programme_id,owner_id,recipient_id from student_record_shares where id=$1',[id])).rows[0];
    if(!stub || actor && stub.owner_id!==actor.accountId && stub.recipient_id!==actor.accountId)throw requestError(404,'Share was not found.');
    await db.query('select id from student_programmes where id=$1 for update',[stub.student_programme_id]);
    return (await db.query(`${select} where g.id=$1 for update of g`,[id])).rows[0];
  }
  async function currentOwner(db,row) {
    return (await db.query(`select 1 from student_programmes sp join students s on s.id=sp.student_id where sp.id=$1 and s.account_id=$2`,[row.programmeId,row.ownerId])).rowCount>0;
  }
  async function event(db,row,actor,action) {
    await db.query(`insert into student_share_history(share_id,revision,action,actor_id) values($1,$2,$3,$4)`,[row.id,row.revision,action,actor.accountId]);
    await insertAudit(db,{actorId:actor.accountId,action:`sharing.${action}`,subjectType:'StudentShare',subjectId:row.id,reason:'Student-authorized record sharing',metadata:{revision:row.revision,categories:row.categories}});
  }
  async function command(db,actor,input,payload) {
    await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`sharing-command:${actor.accountId}:${input.requestKey}`]);
    const old=(await db.query(`select input_hash,share_id from student_share_commands where actor_id=$1 and request_key=$2`,[actor.accountId,input.requestKey])).rows[0];
    if(old && old.input_hash!==hash(payload))throw requestError(409,'Request key was used for a different sharing command.');
    return old ? projection((await db.query(`${select} where g.id=$1`,[old.share_id])).rows[0]) : null;
  }
  async function receipt(db,row,actor,input,payload) {await db.query(`insert into student_share_commands(actor_id,request_key,input_hash,share_id) values($1,$2,$3,$4)`,[actor.accountId,input.requestKey,hash(payload),row.id]);}
  async function invite(db,row,token) {
    await queueNotification(db,null,'student.sharing_invitation',{invitationLink:`/#shared/invitation?token=${token}`,challengeExpiresAt:row.challengeExpiresAt.toISOString(),expiresAt:row.expiresAt.toISOString()},
      {sensitive:true,devOutboxDir,recipientEmail:row.email,activeOnly:true,dataEncryptionKey});
  }
  async function accept(db,row,accountId,action='accept') {
    await db.query(`update student_record_shares set status=$2,recipient_id=$3,accepted_at=case when $2='accepted' then now() else null end,
      closed_at=case when $2='declined' then now() else null end,revision=revision+1 where id=$1`,[row.id,action==='accept' ? 'accepted' : 'declined',accountId]);
    // Only access administration may restore a previously assigned recipient role.
    if(action==='accept')await db.query(`insert into role_assignments(id,account_id,role_code,scope,effective_from,granted_by,reason)
      select $1,$2,'record_recipient','{}',current_date,$3,'Recipient accepted a student-authorized share'
      where not exists(select 1 from role_assignments where account_id=$2 and role_code='record_recipient')`,[`role_${randomUUID()}`,accountId,row.ownerId]);
    const current=(await db.query(`${select} where g.id=$1`,[row.id])).rows[0];
    await event(db,current,{accountId},action);return projection(current);
  }
  async function challenge(db,token) {
    if(typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token))throw requestError(400,'A valid email invitation token is required.');
    const stub=(await db.query('select id from student_record_shares where challenge_hash=$1',[digestToken(token)])).rows[0];
    if(!stub)throw requestError(404,'Invitation is unavailable.');
    const row=await lockGrant(db,stub.id);
    if(!await currentOwner(db,row))throw requestError(409,'Invitation is no longer available.');
    const checked=(await db.query(`select 1 from student_record_shares where id=$1 and challenge_hash=$2 and status='pending' and challenge_expires_at>clock_timestamp() and expires_at>clock_timestamp()`,[row.id,digestToken(token)])).rowCount;
    if(!checked)throw requestError(409,'Invitation is no longer available.');return row;
  }
  return {
    async ownStudentShares(id,input,actor) {
      fields(input,['offset']);const offset=Number(input.offset || 0);if(!Number.isSafeInteger(offset) || offset<0 || offset>100000)throw requestError(400,'Invalid sharing pagination.');
      return transact(async db => {
        await db.query('set transaction isolation level repeatable read');await ownProgramme(db,id,actor);
        const rows=(await db.query(`${select} where g.student_programme_id=$1 and g.owner_id=$2 order by g.created_at desc,g.id limit 25 offset $3`,[id,actor.accountId,offset])).rows;
        const ids=rows.map(r => r.id);
        return {programmeId:id,limit:25,offset,total:(await db.query('select count(*)::int as n from student_record_shares where student_programme_id=$1 and owner_id=$2',[id,actor.accountId])).rows[0].n,
          shares:rows.map(projection),access:(await db.query(`select share_id as "shareId",category,actor_id as "actorId",accessed_at as "accessedAt" from student_share_access where share_id=any($1::text[]) order by id desc limit 25`,[ids])).rows};
      });
    },
    async inviteStudentShare(id,raw,actor) {
      const input=validateShareInvitation(raw);
      return transact(async db => {
        await ownProgramme(db,id,actor);
        const payload={action:'invite',programmeId:id,...input},old=await command(db,actor,input,payload);if(old)return old;
        const owner=(await db.query('select email from accounts where id=$1',[actor.accountId])).rows[0];
        if(normalizeEmail(owner.email)===input.email)throw requestError(400,'Choose another recipient.');
        const live=(await db.query(`select recipient_email from student_record_shares where student_programme_id=$1 and status in ('pending','accepted') and expires_at>clock_timestamp()`,[id])).rows;
        if(live.length>=20 || live.some(r => normalizeEmail(r.recipient_email)===input.email))throw requestError(409,'A live share already exists for this recipient, or the programme has 20 live shares.');
        const token=createSecret(),shareId=`share_${randomUUID()}`;
        const label=(await db.query(`select pe.legal_name as "legalName",p.name as "programmeName" from student_programmes sp join students s on s.id=sp.student_id join people pe on pe.id=s.person_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id where sp.id=$1`,[id])).rows[0];
        await db.query(`insert into student_record_shares(id,student_programme_id,owner_id,recipient_email,categories,expires_at,challenge_hash,challenge_expires_at,student_label)
          values($1,$2,$3,$4,$5,now()+$6*interval '1 day',$7,now()+least($6*24,48)*interval '1 hour',$8)`,[shareId,id,actor.accountId,input.email,JSON.stringify(input.categories),input.days,digestToken(token),label]);
        const row=(await db.query(`${select} where g.id=$1`,[shareId])).rows[0];
        await event(db,row,actor,'invite');await invite(db,row,token);await receipt(db,row,actor,input,payload);return projection(row);
      });
    },
    async changeStudentShare(id,action,raw,actor) {
      const input=validateShareAction(raw);
      if(!['revoke','resend','decline'].includes(action))throw requestError(400,'Invalid sharing action.');
      return transact(async db => {
        const row=await lockGrant(db,id,actor);
        const allowed=action==='decline' ? row.recipientId===actor.accountId : row.ownerId===actor.accountId && actor.permissions.includes('registry.self');
        if(!allowed)throw requestError(404,'Share was not found.');
        const payload={action,id,...input},old=await command(db,actor,input,payload);if(old)return old;
        if(row.revision!==input.revision || !['pending','accepted'].includes(row.status))throw requestError(409,'Sharing changed; refresh before acting.');
        if(action==='resend') {
          if(!await currentOwner(db,row))throw requestError(409,'Student record ownership changed; this invitation cannot be resent.');
          if(row.status!=='pending' || row.invitationCount>=5 || (await db.query('select 1 from student_record_shares where id=$1 and expires_at>clock_timestamp()',[id])).rowCount===0)throw requestError(409,'Only an unexpired pending share can be resent, up to five invitations.');
          const token=createSecret();await db.query(`update student_record_shares set revision=revision+1,challenge_hash=$2,challenge_expires_at=least(expires_at,now()+interval '48 hours'),invitation_count=invitation_count+1 where id=$1`,[id,digestToken(token)]);
          const updated=(await db.query(`${select} where g.id=$1`,[id])).rows[0];await event(db,updated,actor,'resend');await invite(db,updated,token);await receipt(db,updated,actor,input,payload);return projection(updated);
        }
        await db.query(`update student_record_shares set revision=revision+1,status=$2,closed_at=now() where id=$1`,[id,action==='revoke' ? 'revoked' : 'declined']);
        const updated=(await db.query(`${select} where g.id=$1`,[id])).rows[0];await event(db,updated,actor,action);await receipt(db,updated,actor,input,payload);return projection(updated);
      });
    },
    async acceptStudentShare(raw,actor) {
      fields(raw,['token','accept']);if(typeof raw.accept!=='boolean')throw requestError(400,'An explicit acceptance decision is required.');
      return transact(async db => {
        const row=await challenge(db,raw.token),email=await lockAccountMailbox(db,row.email);
        await challenge(db,raw.token);
        const matches=(await db.query('select id,status from accounts where lower(btrim(email))=$1 limit 2 for share',[email])).rows;
        const account=matches.length===1 ? matches[0] : null;
        if(!account || account.id!==actor.accountId || account.status!=='active' || row.ownerId===actor.accountId)throw requestError(403,'Sign in to the invited email account.');
        return accept(db,row,actor.accountId,raw.accept ? 'accept' : 'decline');
      });
    },
    async registerShareRecipient(raw) {
      fields(raw,['token','legalName','preferredName','password','accept']);
      if(raw.accept!==true || !text(raw.legalName,160) || !text(raw.preferredName,80) || typeof raw.password!=='string')throw requestError(400,'Provide your name, a strong password and explicit acceptance.');
      return transact(async db => {
        const row=await challenge(db,raw.token);
        if(passwordProblems(raw.password,row.email).length)throw requestError(400,'Use a strong password of at least 12 characters, unrelated to your email.');
        const email=await lockAccountMailbox(db,row.email);
        // Waiting on another identity writer can outlive the sharing challenge.
        await challenge(db,raw.token);
        await requireNewAccountMailbox(db,email);
        const accountId=`acct_${randomUUID()}`,personId=`person_${randomUUID()}`,password=await hashSecret(raw.password);
        await db.query(`insert into people(id,legal_name,preferred_name,personas,status) values($1,$2,$3,'["record_recipient"]','active')`,[personId,raw.legalName.trim(),raw.preferredName.trim()]);
        await db.query(`insert into accounts(id,person_id,email,status,password_hash,password_salt,password_set_at) values($1,$2,$3,'active',$4,$5,now())`,[accountId,personId,email,password.hash,password.salt]);
        const result=await accept(db,row,accountId);return {email,share:result};
      });
    },
    async receivedStudentShares(input,actor) {
      fields(input,['offset']);const offset=Number(input.offset || 0);if(!Number.isSafeInteger(offset) || offset<0 || offset>100000)throw requestError(400,'Invalid sharing pagination.');
      return transact(async db => {
        await db.query('set transaction isolation level repeatable read read only');
        const rows=(await db.query(`${select} where g.recipient_id=$1 order by g.created_at desc,g.id limit 25 offset $2`,[actor.accountId,offset])).rows;
        return {shares:rows.map(projection),limit:25,offset,total:(await db.query('select count(*)::int as n from student_record_shares where recipient_id=$1',[actor.accountId])).rows[0].n};
      });
    },
    async readSharedStudentRecord(id,category,input,actor) {
      fields(input,['offset']);const offset=Number(input.offset || 0);if(!shareCategories.includes(category) || !Number.isSafeInteger(offset) || offset<0 || offset>100000)throw requestError(400,'Invalid shared record page.');
      if(!actor.permissions.includes('sharing.read'))throw requestError(403,'Active recipient permission is required.');
      return transact(async db => {
        await db.query('set transaction isolation level repeatable read');const row=await lockGrant(db,id,actor);
        const clock=(await db.query('select clock_timestamp() as now')).rows[0].now;
        if(row.recipientId!==actor.accountId)throw requestError(404,'Share was not found.');
        if(!shareUsable(row,actor,category,clock))throw requestError(403,'Current student permission for this record category is required.');
        if(!await currentOwner(db,row))throw requestError(403,'Student record ownership changed; renewed permission is required.');
        const scope=(await db.query(`select p.code as "programmeCode",sp.intake_id as "intakeId" from student_programmes sp join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id where sp.id=$1`,[row.programmeId])).rows[0];
        if(!sharingAuthority(actor,scope))throw requestError(404,'Share was not found in your authorized scope.');
        const student=(await db.query(`select s.student_number as "studentNumber",pe.legal_name as "legalName",p.name as "programmeName",i.label as "intakeLabel",sp.status
          from student_programmes sp join students s on s.id=sp.student_id join people pe on pe.id=s.person_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id where sp.id=$1`,[row.programmeId])).rows[0];
        let data;
        if(category==='programme_status')data={status:student.status};delete student.status;
        if(category==='fee_summary')data={currencies:(await financialStatus(db,row.programmeId)).currencies.map(c => Object.fromEntries(['currency','charged','paid','credited','balance','due','credit'].map(k => [k,c[k]])))};
        if(category==='confirmed_registration') {
          const from=`from student_registrations sr join registration_periods rp on rp.id=sr.period_id join academic_periods ap on ap.id=rp.academic_period_id where sr.student_programme_id=$1 and sr.status='confirmed'`;
          const records=(await db.query(`select sr.reference_number as reference,sr.confirmed_at as "confirmedAt",ap.name as period,rp.year_of_study as "yearOfStudy",rp.term,sr.confirmation ${from} order by ap.starts_on desc,sr.id limit 25 offset $2`,[row.programmeId,offset])).rows;
          data={total:(await db.query(`select count(*)::int as n ${from}`,[row.programmeId])).rows[0].n,offset,limit:25,records:records.map(({confirmation,...r}) => ({...r,credits:confirmation?.credits,courses:(confirmation?.courses || []).map(c => ({code:c.code,title:c.title,credits:c.credits}))}))};
        }
        if(category==='published_results') {
          const released=await publishedStudentResultRows(db,row.programmeId);
          const periods=(await db.query(`select rp.id,ap.name from registration_periods rp join academic_periods ap on ap.id=rp.academic_period_id where rp.id=any($1::text[])`,[released.map(r => r.batch.periodId)])).rows;
          const records=released.flatMap(({batch,rows}) => rows.map(snapshot => ({period:periods.find(p => p.id===batch.periodId)?.name,publishedAt:batch.publishedAt,
            ...Object.fromEntries(['code','title','credits','mark','grade','points','passing'].map(k => [k,snapshot[k]]))})));
          data={total:records.length,offset,limit:25,records:records.slice(offset,offset+25)};
        }
        await db.query(`insert into student_share_access(share_id,revision,category,actor_id) values($1,$2,$3,$4)`,[id,row.revision,category,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:'sharing.read',subjectType:'StudentShare',subjectId:id,reason:'Verified recipient read a student-authorized category',metadata:{revision:row.revision,category,offset}});
        return {shareId:id,category,expiresAt:row.expiresAt,student,data};
      });
    }
  };
}
