import {createHmac,randomUUID} from 'node:crypto';
import {insertAudit,requestError,withTransaction,todayIso} from '../support.js';
import {encryptSecret,decryptSecret} from '../security.js';
import {guidancePublicScopeSql} from './admissions-guidance.js';

export const enquiryConsentPolicy = 'portal-enquiry-v1';
export const enquiryStatuses = Object.freeze(['open','in_progress','waiting_applicant','resolved','withdrawn']);
const live = (row) => row.consentActive && !['resolved','withdrawn'].includes(row.status);
const bounded = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');
const keyValid = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(v);
function fields(input,allowed) {if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,'Unsupported enquiry fields.');}
export function enquiryCreate(input) {
  fields(input,['intakeId','guidanceVersionId','subject','body','consent','requestKey']);
  if (!bounded(input.intakeId,160) || !bounded(input.subject,180) || !bounded(input.body,4000) || input.consent !== true || !keyValid(input.requestKey) || input.guidanceVersionId != null && !bounded(input.guidanceVersionId,160)) throw requestError(400,'Choose an intake, enter bounded enquiry text and explicitly allow in-app replies.');
  return {intakeId:input.intakeId,guidanceVersionId:input.guidanceVersionId ?? null,subject:input.subject.trim(),body:input.body.trim(),consent:true,requestKey:input.requestKey};
}
export function enquiryAction(action,input,self = false) {
  if (!['comment','update','escalate','withdraw','reopen'].includes(action) || self && !['comment','withdraw','reopen'].includes(action) || !self && ['withdraw','reopen'].includes(action)) throw requestError(403,'This enquiry action is not available.');
  fields(input,action === 'comment' ? ['revision','body','visibility','requestKey'] : action === 'update' ? ['revision','status','assigneeId','resolveEscalation','reason'] : action === 'escalate' ? ['revision','assigneeId','reason'] : action === 'reopen' ? ['revision','consent','reason'] : ['revision','reason']);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw requestError(400,'A current enquiry revision is required.');
  if (action === 'comment') {
    const visibility = input.visibility ?? 'public';
    if (!bounded(input.body,4000) || !keyValid(input.requestKey) || !['public','internal'].includes(visibility) || self && visibility !== 'public') throw requestError(400,'Enter a bounded message with allowed visibility and a replay key.');
    return {revision:input.revision,body:input.body.trim(),visibility,requestKey:input.requestKey};
  }
  if (!bounded(input.reason,2000)) throw requestError(400,'An enquiry action reason is required.');
  if (action === 'update' && (!['open','in_progress','waiting_applicant','resolved'].includes(input.status) || input.assigneeId !== null && !bounded(input.assigneeId,160) || typeof input.resolveEscalation !== 'boolean')) throw requestError(400,'Choose an allowed status, assignee and explicit escalation resolution.');
  if (action === 'escalate' && !bounded(input.assigneeId,160) || action === 'reopen' && input.consent !== true) throw requestError(400,'Choose an escalation manager or explicitly renew in-app reply consent.');
  return {...input,reason:input.reason.trim()};
}
export function enquiryFilters(input = {},self = false) {
  fields(input,self ? ['status','intakeId','offset'] : ['status','intakeId','assignee','offset']);
  const result = {status:input.status || '',intakeId:input.intakeId || '',assignee:self ? '' : input.assignee || '',offset:Number(input.offset ?? 0),limit:25};
  if (result.status && !enquiryStatuses.includes(result.status) || !['','mine','unassigned'].includes(result.assignee) || typeof result.intakeId !== 'string' || result.intakeId.length > 160 || /[\r\n\0]/.test(result.intakeId) || !/^\d{1,7}$/.test(String(input.offset ?? 0)) || result.offset > 1000000) throw requestError(400,'Use allowed enquiry filters and bounded pagination.');
  return result;
}
export function enquiryCan(actor,row,permission = 'enquiries.manage') {
  return actor.permissions.includes(permission) && actor.roles.filter((r) => (r.permissions || []).includes(permission)).some((r) => {
    const scope = r.scope || {};
    return r.code === 'system_administrator' || !Object.keys(scope).length || (scope.programmeCodes || []).includes(row.programmeCode) && (!(scope.intakeIds || []).length || scope.intakeIds.includes(row.intakeId));
  });
}
export function enquiryNext(row,action,data,self = false,supervisor = false) {
  if (action === 'withdraw') return {...row,status:'withdrawn',consentActive:false,escalated:false};
  if (action === 'reopen') {
    if (row.status !== 'resolved') throw requestError(409,'Only a resolved enquiry can be reopened. Withdrawn consent is terminal.');
    return {...row,status:'open',consentActive:true,assigneeId:null,escalated:false};
  }
  if (!live(row)) throw requestError(409,'This enquiry is resolved or consent was withdrawn.');
  if (!self && row.escalated && !supervisor) throw requestError(403,'An escalation manager must handle this enquiry.');
  if (action === 'comment') return {...row,status:data.visibility === 'internal' ? row.status : self ? row.status === 'waiting_applicant' ? 'in_progress' : row.status : 'waiting_applicant'};
  if (action === 'escalate') return {...row,status:'in_progress',assigneeId:data.assigneeId,escalated:true,escalationLevel:row.escalationLevel+1};
  if (data.resolveEscalation && !supervisor) throw requestError(403,'Escalation resolution requires manager authority.');
  const next = {...row,status:data.status,assigneeId:data.assigneeId,escalated:data.resolveEscalation ? false : row.escalated,consentActive:data.status !== 'resolved'};
  if (['in_progress','waiting_applicant','resolved'].includes(next.status) && !next.assigneeId || next.escalated && !next.assigneeId) throw requestError(400,'Assign an authorized officer or manager before progressing the enquiry.');
  if (next.status === 'resolved' && next.escalated) throw requestError(409,'Explicitly resolve the escalation before completing this enquiry.');
  return next;
}
const select = `select e.id,e.owner_id as "ownerId",pe.preferred_name as "ownerName",e.programme_id as "programmeId",p.code as "programmeCode",p.name as "programmeName",e.intake_id as "intakeId",i.label as "intakeLabel",e.guidance_version_id as "guidanceVersionId",v.version as "guidanceVersion",
 e.subject_encrypted as "subjectEncrypted",e.channel,e.consent_policy as "consentPolicy",e.consented_at as "consentedAt",e.consent_active as "consentActive",e.status,e.assignee_id as "assigneeId",e.escalated,e.escalation_level as "escalationLevel",e.revision,e.created_at as "createdAt",e.updated_at as "updatedAt",e.resolved_at as "resolvedAt",e.withdrawn_at as "withdrawnAt"
 from prospective_enquiries e join programmes p on p.id = e.programme_id join intakes i on i.id = e.intake_id join accounts a on a.id = e.owner_id join people pe on pe.id = a.person_id left join guidance_versions v on v.id = e.guidance_version_id`;

export function createProspectiveEnquiriesModule(pool,{dataEncryptionKey} = {}) {
  const encode = (v) => encryptSecret(v,dataEncryptionKey),hash = (v) => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(v)).digest('hex');
  const decode = (v) => {try {return decryptSecret(v,dataEncryptionKey);} catch {throw requestError(409,'Enquiry text requires reconciliation.');}};
  const require = (actor,permission) => {if (!actor.permissions.includes(permission)) throw requestError(403,'Enquiry authority is required.');};
  const audit = (db,actor,action,id,metadata = {}) => insertAudit(db,{actorId:actor.accountId,action:`enquiry.${action}`,subjectType:'ProspectiveEnquiry',subjectId:id,reason:'Consented enquiry workflow',metadata});
  function scopeSql(actor,values) {
    const clauses = [];
    for (const role of actor.roles.filter((r) => (r.permissions || []).includes('enquiries.manage'))) {
      const scope = role.scope || {};
      if (role.code === 'system_administrator' || !Object.keys(scope).length) return 'true';
      if (!(scope.programmeCodes || []).length) continue;
      values.push(scope.programmeCodes);let clause = `p.code = any($${values.length}::text[])`;
      if ((scope.intakeIds || []).length) {values.push(scope.intakeIds);clause += ` and e.intake_id = any($${values.length}::text[])`;}
      clauses.push(`(${clause})`);
    }
    return clauses.length ? `(${clauses.join(' or ')})` : 'false';
  }
  async function resource(db,id,actor,self,lock = false) {
    require(actor,self ? 'enquiries.self' : 'enquiries.manage');
    const row = (await db.query(`${select} where e.id = $1${lock ? ' for update of e' : ''}`,[id])).rows[0];
    if (!row || (self ? row.ownerId !== actor.accountId : !enquiryCan(actor,row))) throw requestError(404,'Enquiry was not found.');return row;
  }
  async function assignees(db,row) {
    const roles = (await db.query(`select a.id,pe.preferred_name as name,ra.role_code as code,ra.scope,array_agg(rp.permission_code) as permissions
      from accounts a join people pe on pe.id = a.person_id join role_assignments ra on ra.account_id = a.id join role_permissions rp on rp.role_code = ra.role_code
      where a.status = 'active' and ra.effective_from <= current_date and (ra.effective_to is null or ra.effective_to >= current_date)
      and rp.permission_code in ('enquiries.manage','enquiries.escalate') group by a.id,pe.preferred_name,ra.id,ra.role_code,ra.scope order by pe.preferred_name,a.id`)).rows;
    const accounts = new Map();
    for (const role of roles) {
      const actor = {permissions:role.permissions,roles:[role]},manage = enquiryCan(actor,row),manager = enquiryCan(actor,row,'enquiries.escalate'),old = accounts.get(role.id) || {id:role.id,name:role.name,canManage:false,canEscalate:false};
      if (manage || manager) accounts.set(role.id,{...old,canManage:old.canManage || manage,canEscalate:old.canEscalate || manager});
    }
    return [...accounts.values()].filter((r) => r.canManage);
  }
  async function view(db,row,actor,self) {
    const {subjectEncrypted,...base} = row;
    if (self) for (const key of ['ownerId','ownerName','assigneeId']) delete base[key];
    const messages = (await db.query('select id,revision,author_id as "authorId",author_kind as "authorKind",visibility,body_encrypted as "bodyEncrypted",created_at as "createdAt" from prospective_enquiry_messages where enquiry_id = $1 and ($2::boolean = false or visibility = \'public\') order by revision,id',[row.id,self])).rows.map(({bodyEncrypted,...message}) => {if (self) delete message.authorId;return {...message,body:decode(bodyEncrypted)};});
    const records = (await db.query('select revision,action,from_status as "fromStatus",to_status as "toStatus",consent_active as "consentActive",consent_policy as "consentPolicy",actor_id as "actorId",assignee_id as "assigneeId",escalated,escalation_level as "escalationLevel",reason_encrypted as "reasonEncrypted",recorded_at as "recordedAt" from prospective_enquiry_history where enquiry_id = $1 and ($2::boolean = false or action <> \'note\') order by revision',[row.id,self])).rows;
    const history = records.map(({reasonEncrypted,...h}) => self ? {revision:h.revision,action:['triaged','reply'].includes(h.action) ? 'status_changed' : h.action,fromStatus:h.fromStatus,toStatus:h.toStatus,consentActive:h.consentActive,consentPolicy:h.consentPolicy,recordedAt:h.recordedAt} : {...h,reason:reasonEncrypted ? decode(reasonEncrypted) : null});
    const staff = self ? [] : await assignees(db,row),supervisor = !self && enquiryCan(actor,row,'enquiries.escalate'),current = staff.find((r) => r.id === actor.accountId);
    return {...base,subject:decode(subjectEncrypted),messages,history,assignees:staff,canComment:Boolean(live(row) && (self || row.assigneeId === actor.accountId && current?.canManage && (!row.escalated || current.canEscalate))),canTriage:!self && live(row) && (!row.escalated || supervisor),canEscalate:!self && live(row) && (!row.escalated || supervisor),canSupervise:supervisor,canWithdraw:self && row.status !== 'withdrawn',canReopen:self && row.status === 'resolved'};
  }
  async function record(db,row,actor,action,fromStatus,reason = null) {
    await db.query(`insert into prospective_enquiry_history (enquiry_id,revision,action,from_status,to_status,consent_active,consent_policy,assignee_id,escalated,escalation_level,actor_id,reason_encrypted)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[row.id,row.revision,action,fromStatus,row.status,row.consentActive,row.consentPolicy,row.assigneeId,row.escalated,row.escalationLevel,actor.accountId,reason ? encode(reason) : null]);
    await audit(db,actor,action,row.id,{revision:row.revision,status:row.status,consentActive:row.consentActive,policy:row.consentPolicy,escalated:row.escalated,escalationLevel:row.escalationLevel});
  }
  async function message(db,row,actor,data,self,requestHash) {
    await db.query('insert into prospective_enquiry_messages (id,enquiry_id,revision,author_id,author_kind,visibility,body_encrypted,request_key,request_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[`em_${randomUUID()}`,row.id,row.revision,actor.accountId,self ? 'applicant' : 'staff',data.visibility,encode(data.body),data.requestKey,requestHash]);
  }
  return {
    async listProspectiveEnquiries(input,actor,self = false) {
      require(actor,self ? 'enquiries.self' : 'enquiries.manage');const f = enquiryFilters(input,self);
      return withTransaction(pool,async (db) => {
        const values = [],scope = self ? (values.push(actor.accountId),'e.owner_id = $1') : scopeSql(actor,values);
        values.push(f.status,f.intakeId,f.assignee,actor.accountId,f.offset);const n = values.length-4;
        const rows = (await db.query(`${select} where ${scope} and ($${n} = '' or e.status = $${n}) and ($${n+1} = '' or e.intake_id = $${n+1})
          and ($${n+2} = '' or $${n+2} = 'mine' and e.assignee_id = $${n+3} or $${n+2} = 'unassigned' and e.assignee_id is null) order by e.updated_at desc,e.id limit 25 offset $${n+4}`,values)).rows;
        const items = rows.map(({subjectEncrypted,...r}) => {if (self) for (const key of ['ownerId','ownerName','assigneeId']) delete r[key];return {...r,subject:decode(subjectEncrypted)};});
        await audit(db,actor,'queue.read',self ? 'own' : 'staff',{count:items.length,self});return {items,offset:f.offset,limit:25,filters:f};
      });
    },
    async prospectiveEnquiryMetadata(actor) {
      require(actor,'enquiries.manage');return withTransaction(pool,async (db) => {
        const intakes = (await db.query('select i.id as "intakeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by i.starts_on desc,p.code')).rows.filter((row) => enquiryCan(actor,row));
        await audit(db,actor,'metadata.read','metadata',{count:intakes.length});return {intakes,statuses:enquiryStatuses};
      });
    },
    async getProspectiveEnquiry(id,actor,self = false) {return withTransaction(pool,async (db) => {const row = await resource(db,id,actor,self);await audit(db,actor,'detail.read',id,{self});return view(db,row,actor,self);});},
    async createProspectiveEnquiry(input,actor) {
      require(actor,'enquiries.self');const data = enquiryCreate(input);
      return withTransaction(pool,async (db) => {
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`enquiry:${actor.accountId}:${data.requestKey}`]);
        const old = (await db.query('select id,request_hash as "requestHash" from prospective_enquiries where owner_id = $1 and request_key = $2',[actor.accountId,data.requestKey])).rows[0];
        if (old) {const row = await resource(db,old.id,actor,true);if (old.requestHash !== hash(data)) throw requestError(409,'This enquiry key was used for different content.');return view(db,row,actor,true);}
        const intake = (await db.query(`select i.programme_id as "programmeId" from intakes i join programmes p on p.id = i.programme_id where i.id = $1 and i.status = 'published' and i.application_closes_at >= now() and p.status = 'published'
          and exists(select 1 from programme_versions pv where pv.programme_id = p.id and pv.status in ('published','retired') and pv.effective_from <= i.starts_on and (pv.effective_to is null or pv.effective_to >= i.starts_on)) for share of i,p`,[data.intakeId])).rows[0];
        if (!intake) throw requestError(404,'A published current intake is required.');
        if (data.guidanceVersionId) {
          const source = (await db.query(`select v.id from guidance_versions v join guidance_articles g on g.id = v.article_id left join programmes p on p.id = g.programme_id left join intakes i on i.id = g.intake_id
            where v.id = $1 and ${guidancePublicScopeSql} and v.status = 'published' and v.effective_from <= $2::date and (v.valid_until is null or v.valid_until >= $2::date)
            and v.id = (select id from guidance_versions where article_id = g.id and status = 'published' and effective_from <= $2::date order by version desc limit 1)
            and (g.programme_id is null or g.programme_id = $3) and (g.intake_id is null or g.intake_id = $4) for share of g,v`,[data.guidanceVersionId,todayIso(),intake.programmeId,data.intakeId])).rows[0];
          if (!source) throw requestError(409,'Guidance context is not currently public for this intake.');
        }
        const id = `en_${randomUUID()}`;
        await db.query('insert into prospective_enquiries (id,owner_id,programme_id,intake_id,guidance_version_id,subject_encrypted,consent_policy,request_key,request_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,actor.accountId,intake.programmeId,data.intakeId,data.guidanceVersionId,encode(data.subject),enquiryConsentPolicy,data.requestKey,hash(data)]);
        const row = await resource(db,id,actor,true);await message(db,row,actor,{body:data.body,visibility:'public',requestKey:'initial'},true,hash({body:data.body,visibility:'public'}));await record(db,row,actor,'created',null);return view(db,row,actor,true);
      });
    },
    async actOnProspectiveEnquiry(id,action,input,actor,self = false) {
      const data = enquiryAction(action,input,self);
      return withTransaction(pool,async (db) => {
        const row = await resource(db,id,actor,self,true),requestHash = action === 'comment' ? hash({body:data.body,visibility:data.visibility}) : null;
        if (action === 'comment') {
          const old = (await db.query('select request_hash as "requestHash" from prospective_enquiry_messages where enquiry_id = $1 and author_id = $2 and request_key = $3',[id,actor.accountId,data.requestKey])).rows[0];
          if (old) {if (old.requestHash !== requestHash) throw requestError(409,'This message key was used for different content.');return view(db,row,actor,self);}
        }
        if (action === 'withdraw' && row.status === 'withdrawn') return view(db,row,actor,self);
        if (row.revision !== data.revision) throw requestError(409,'This enquiry changed. Refresh before continuing.');
        const supervisor = !self && enquiryCan(actor,row,'enquiries.escalate'),next = {...enquiryNext(row,action,data,self,supervisor),revision:row.revision+1};
        if (!self) {
          const staff = await assignees(db,row),current = staff.find((r) => r.id === actor.accountId);
          if (!current || row.escalated && !current.canEscalate || data.resolveEscalation && !current.canEscalate) throw requestError(403,'Current scoped enquiry authority is required.');
          if (action === 'comment' && row.assigneeId !== actor.accountId) throw requestError(403,'Only the assigned officer or manager may reply.');
          const target = next.assigneeId ? staff.find((r) => r.id === next.assigneeId) : null;
          if (next.assigneeId && (!target || next.escalated && !target.canEscalate)) throw requestError(400,'Choose an active authorized intake officer or escalation manager.');
        }
        await db.query(`update prospective_enquiries set status = $2,consent_active = $3,assignee_id = $4,escalated = $5,escalation_level = $6,revision = $7,updated_at = now(),resolved_at = case when $2 = 'resolved' then now() else null end,withdrawn_at = case when $2 = 'withdrawn' then now() else null end where id = $1`,[id,next.status,next.consentActive,next.assigneeId,next.escalated,next.escalationLevel,next.revision]);
        if (action === 'comment') await message(db,next,actor,data,self,requestHash);
        await record(db,next,actor,action === 'comment' ? data.visibility === 'internal' ? 'note' : 'reply' : action === 'update' ? 'triaged' : action === 'escalate' ? 'escalated' : action === 'reopen' ? 'reopened' : 'withdrawn',row.status,data.reason);
        return view(db,await resource(db,id,actor,self),actor,self);
      });
    }
  };
}
