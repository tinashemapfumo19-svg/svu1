import { createHmac, randomUUID } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { decryptSecret, encryptSecret } from '../security.js';

export const supportCategories = Object.freeze(['academic','registration','finance','learning','feedback','other']);
export const supportPriorities = Object.freeze(['low','normal','high','urgent']);
export const supportStatuses = Object.freeze(['open','in_progress','waiting_student','resolved','closed']);
const terminal = (status) => ['resolved','closed'].includes(status);
const validText = (value,max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000]/.test(value);
const keyValid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
function fields(input,allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,'Unsupported support case fields.');
}
export function validateSupportCreate(input) {
  fields(input,['programmeId','subject','category','body','requestKey']);
  if (!validText(input.programmeId,160) || !validText(input.subject,160) || !validText(input.body,4000) || !supportCategories.includes(input.category) || !keyValid(input.requestKey)) throw requestError(400,'Select a programme and category, enter a subject and message, and provide a request key.');
  return {...input,subject:input.subject.trim(),body:input.body.trim()};
}
export function validateSupportAction(action,input,self = false) {
  const allowed = action === 'comment' ? ['revision','body','visibility','requestKey'] : action === 'update' ? ['revision','category','priority','status','assigneeId','reason'] : action === 'escalate' ? ['revision','assigneeId','reason'] : ['revision','reason'];
  fields(input,allowed);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw requestError(400,'A current case revision is required.');
  if (!['comment','update','escalate','reopen','close'].includes(action) || self && !['comment','reopen','close'].includes(action)) throw requestError(403,'This case action is not available.');
  if (action === 'comment') {
    const visibility = input.visibility === undefined ? 'public' : input.visibility;
    if (!validText(input.body,4000) || !keyValid(input.requestKey) || !['public','internal'].includes(visibility) || self && visibility === 'internal') throw requestError(400,'Enter a message with an allowed visibility and request key.');
    return {...input,body:input.body.trim(),visibility};
  }
  if (!validText(input.reason,2000)) throw requestError(400,'A reason is required.');
  if (action === 'update' && (!supportCategories.includes(input.category) || !supportPriorities.includes(input.priority) || !supportStatuses.includes(input.status) || input.assigneeId !== null && !validText(input.assigneeId,160))) throw requestError(400,'Select a category, priority, status and assignee.');
  if (action === 'escalate' && !validText(input.assigneeId,160)) throw requestError(400,'Select an escalation manager.');
  return {...input,reason:input.reason.trim()};
}
export function supportListFilters(input = {}) {
  fields(input,['status','category','priority','intakeId','programmeId','assignee','limit','offset']);
  const number = (value,def,max) => {
    if (value === undefined || value === null || value === '') return def;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw requestError(400,'Invalid support pagination.');
    return Number(value);
  };
  const filters = {status:input.status || '',category:input.category || '',priority:input.priority || '',intakeId:input.intakeId || '',programmeId:input.programmeId || '',assignee:input.assignee || '',limit:number(input.limit,25,100),offset:number(input.offset,0,1000000)};
  if (!filters.limit || filters.status && !supportStatuses.includes(filters.status) || filters.category && !supportCategories.includes(filters.category) || filters.priority && !supportPriorities.includes(filters.priority) || !['','mine','unassigned'].includes(filters.assignee)
    || [filters.intakeId,filters.programmeId].some((value) => typeof value !== 'string' || value.length > 160 || /[\r\n\u0000]/.test(value))) throw requestError(400,'Invalid support case filter.');
  return filters;
}
export function supportCan(actor,row,permission) {
  return actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},{programmeCode:row.programmeCode,intakeId:row.intakeId});
}
export function supportNextStatus(row,action,input,self = false,supervisor = false) {
  if (action === 'comment') {
    if (terminal(row.status)) throw requestError(409,'Reopen this case before adding a message.');
    return self && row.status === 'waiting_student' ? 'in_progress' : row.status;
  }
  if (action === 'reopen') {
    if (!terminal(row.status)) throw requestError(409,'Only resolved or closed cases can be reopened.');
    return 'open';
  }
  if (action === 'close') {
    if (row.status !== 'resolved') throw requestError(409,'Only a resolved case can be closed.');
    return 'closed';
  }
  if (action === 'escalate') {
    if (terminal(row.status)) throw requestError(409,'Reopen this case before escalation.');
    return 'in_progress';
  }
  if (terminal(row.status) && input.status !== row.status) throw requestError(409,'Use the reopen or close action for a resolved case.');
  if (input.status === 'closed' && row.status !== 'closed') throw requestError(409,'Resolve this case before closing it.');
  if (row.escalated && !supervisor) throw requestError(403,'An escalation manager must triage or resolve an escalated case.');
  if (['in_progress','waiting_student','resolved'].includes(input.status) && !input.assigneeId) throw requestError(400,'Assign the case before progressing or resolving it.');
  return input.status;
}

const caseSelect = `select c.id,c.student_programme_id as "programmeId",c.intake_id as "intakeId",p.code as "programmeCode",i.label as "intakeLabel",
 c.subject_encrypted as "subjectEncrypted",c.category,c.priority,c.status,c.assignee_id as "assigneeId",c.escalated,c.escalation_level as "escalationLevel",c.revision,
 c.created_at as "createdAt",c.updated_at as "updatedAt",c.resolved_at as "resolvedAt",c.closed_at as "closedAt",s.account_id as "ownerId",s.student_number as "studentNumber"
 from support_cases c join student_programmes sp on sp.id = c.student_programme_id join students s on s.id = sp.student_id
 join intakes i on i.id = c.intake_id join programmes p on p.id = i.programme_id`;

export function createSupportCasesModule(pool,{dataEncryptionKey} = {}) {
  const encode = (value) => encryptSecret(value,dataEncryptionKey);
  const hash = (data) => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(data)).digest('hex');
  const decode = (value) => {
    try {return decryptSecret(value,dataEncryptionKey);} catch {throw requestError(409,'Support case text requires reconciliation.');}
  };
  const require = (actor,permission) => {if (!actor.permissions.includes(permission)) throw requestError(403,'Support permission is required.');};
  async function intakes(db,actor) {
    require(actor,'support.view');
    return (await db.query(`select i.id as "intakeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.starts_on,i.id`)).rows.filter((row) => supportCan(actor,row,'support.view'));
  }
  async function ownProgramme(db,id,actor,lock = false) {
    require(actor,'support.self');
    const row = (await db.query(`select sp.id,sp.intake_id as "intakeId" from student_programmes sp join students s on s.id = sp.student_id where sp.id = $1 and s.account_id = $2${lock ? ' for update of sp' : ''}`,[id,actor.accountId])).rows[0];
    if (!row) throw requestError(404,'Student programme was not found.');
    return row;
  }
  async function caseFor(db,id,actor,self,permission = 'support.view',lock = false) {
    require(actor,self ? 'support.self' : permission);
    const row = (await db.query(`${caseSelect} where c.id = $1${lock ? ' for update of c' : ''}`,[id])).rows[0];
    if (!row || (self ? row.ownerId !== actor.accountId : !supportCan(actor,row,permission))) throw requestError(404,'Support case was not found.');
    return row;
  }
  async function assignees(db,row) {
    const roles = (await db.query(`select a.id,pe.preferred_name as name,ra.role_code as code,ra.scope,array_agg(rp.permission_code) as permissions
      from accounts a join people pe on pe.id = a.person_id join role_assignments ra on ra.account_id = a.id join role_permissions rp on rp.role_code = ra.role_code
      where a.status = 'active' and ra.effective_from <= current_date and (ra.effective_to is null or ra.effective_to >= current_date)
      and rp.permission_code in ('support.manage','support.escalate') group by a.id,pe.preferred_name,ra.id,ra.role_code,ra.scope order by pe.preferred_name,a.id`)).rows;
    const accounts = new Map();
    for (const role of roles) {
      const actor = {permissions:role.permissions,roles:[{code:role.code,scope:role.scope,permissions:role.permissions}]};
      const manage = supportCan(actor,row,'support.manage'),supervisor = supportCan(actor,row,'support.escalate');
      const existing = accounts.get(role.id) || {id:role.id,name:role.name,canManage:false,canEscalate:false};
      if (manage || supervisor) accounts.set(role.id,{...existing,canManage:existing.canManage || manage,canEscalate:existing.canEscalate || supervisor});
    }
    return [...accounts.values()].filter((entry) => entry.canManage);
  }
  async function view(db,row,actor,self) {
    const {subjectEncrypted,ownerId,...base} = row;
    const comments = (await db.query(`select id,revision,author_kind as "authorKind",visibility,body_encrypted as "bodyEncrypted",created_at as "createdAt" from support_case_comments where case_id = $1 and ($2::boolean = false or visibility = 'public') order by revision,id`,[row.id,self])).rows;
    const history = (await db.query(`select revision,action,from_status as "fromStatus",to_status as "toStatus",visibility,reason_encrypted as "reasonEncrypted",recorded_at as "recordedAt" from support_case_history where case_id = $1 and ($2::boolean = false or visibility = 'public' or (to_status <> from_status and action <> 'comment')) order by revision`,[row.id,self])).rows;
    if (self) delete base.assigneeId;
    return {...base,subject:decode(subjectEncrypted),comments:comments.map(({bodyEncrypted,...comment}) => ({...comment,body:decode(bodyEncrypted)})),history:history.map(({reasonEncrypted,...event}) => self && event.visibility === 'internal' ? {...event,visibility:'public',action:'status_changed',reason:null} : {...event,reason:reasonEncrypted ? decode(reasonEncrypted) : null}),
      assignees:self ? [] : await assignees(db,row),canManage:!self && supportCan(actor,row,'support.manage'),canSupervise:!self && supportCan(actor,row,'support.escalate')};
  }
  async function record(db,row,actor,action,fromStatus,reason = null,visibility = 'public') {
    await db.query(`insert into support_case_history (case_id,revision,action,from_status,to_status,category,priority,assignee_id,escalated,escalation_level,actor_id,visibility,reason_encrypted)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[row.id,row.revision,action,fromStatus,row.status,row.category,row.priority,row.assigneeId,row.escalated,row.escalationLevel,actor.accountId,visibility,reason ? encode(reason) : null]);
    await insertAudit(db,{actorId:actor.accountId,action:`support.case.${action}`,subjectType:'SupportCase',subjectId:row.id,reason:'Support case workflow recorded',metadata:{revision:row.revision,status:row.status,category:row.category,priority:row.priority,escalated:row.escalated,escalationLevel:row.escalationLevel,visibility}});
  }
  return {
    async listSupportCases(input,actor,self = false) {
      const f = supportListFilters(input);
      require(actor,self ? 'support.self' : 'support.view');
      if (self && (f.intakeId || f.assignee || f.priority)) throw requestError(400,'This filter is staff-only.');
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        if (self && f.programmeId) await ownProgramme(db,f.programmeId,actor);
        const availableIntakes = self ? [] : await intakes(db,actor);
        if (!self && f.intakeId && !availableIntakes.some((row) => row.intakeId === f.intakeId)) throw requestError(404,'Support intake was not found.');
        const ids = availableIntakes.filter((row) => !f.intakeId || row.intakeId === f.intakeId).map((row) => row.intakeId);
        const values = [self ? actor.accountId : null,ids,f.programmeId || null,f.status || null,f.category || null,f.priority || null,f.assignee,actor.accountId];
        const where = ` where ($1::text is not null and s.account_id = $1 or $1::text is null and c.intake_id = any($2::text[]))
          and ($3::text is null or c.student_programme_id = $3) and ($4::text is null or c.status = $4) and ($5::text is null or c.category = $5) and ($6::text is null or c.priority = $6)
          and ($7::text = '' or $7 = 'mine' and c.assignee_id = $8 or $7 = 'unassigned' and c.assignee_id is null)`;
        const counts = (await db.query(`select c.status,count(*)::integer as count from support_cases c join student_programmes sp on sp.id = c.student_programme_id join students s on s.id = sp.student_id${where} group by c.status`,values)).rows;
        const rows = (await db.query(`${caseSelect}${where} order by c.updated_at desc,c.id limit $9 offset $10`,[...values,f.limit,f.offset])).rows;
        const items = rows.map(({subjectEncrypted,ownerId,...row}) => {if (self) delete row.assigneeId;return {...row,subject:decode(subjectEncrypted)};});
        await insertAudit(db,{actorId:actor.accountId,action:'support.cases.accessed',subjectType:'SupportCases',subjectId:self ? 'own' : 'scoped',reason:'Support case queue accessed',metadata:{self,count:items.length}});
        return {...f,items,total:counts.reduce((n,row) => n+row.count,0),counts:Object.fromEntries(supportStatuses.map((status) => [status,counts.find((row) => row.status === status)?.count || 0])),availableIntakes,categories:supportCategories,priorities:supportPriorities,statuses:supportStatuses};
      });
    },
    async getSupportCase(id,actor,self = false) {
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const row = await caseFor(db,id,actor,self),result = await view(db,row,actor,self);
        await insertAudit(db,{actorId:actor.accountId,action:'support.case.accessed',subjectType:'SupportCase',subjectId:id,reason:'Support case accessed',metadata:{self,revision:row.revision}});
        return result;
      });
    },
    async createSupportCase(input,actor) {
      const data = validateSupportCreate(input),requestHash = hash([data.subject,data.category,data.body]);
      return withTransaction(pool,async (db) => {
        const programme = await ownProgramme(db,data.programmeId,actor,true);
        const previous = (await db.query('select id,request_hash as "requestHash" from support_cases where student_programme_id = $1 and requested_by = $2 and request_key = $3',[programme.id,actor.accountId,data.requestKey])).rows[0];
        if (previous) {
          if (previous.requestHash !== requestHash) throw requestError(409,'This request key was already used for a different case.');
          return view(db,await caseFor(db,previous.id,actor,true),actor,true);
        }
        const id = `sc_${randomUUID()}`;
        await db.query(`insert into support_cases (id,student_programme_id,intake_id,requested_by,request_key,request_hash,subject_encrypted,category) values ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,programme.id,programme.intakeId,actor.accountId,data.requestKey,requestHash,encode(data.subject),data.category]);
        await db.query(`insert into support_case_comments (id,case_id,revision,author_id,author_kind,visibility,body_encrypted,request_key,request_hash) values ($1,$2,1,$3,'student','public',$4,$5,$6)`,[`scc_${randomUUID()}`,id,actor.accountId,encode(data.body),data.requestKey,hash([data.body,'public'])]);
        const row = await caseFor(db,id,actor,true);await record(db,row,actor,'created',null);
        return view(db,row,actor,true);
      });
    },
    async actOnSupportCase(id,action,input,actor,self = false) {
      const data = validateSupportAction(action,input,self);
      return withTransaction(pool,async (db) => {
        const row = await caseFor(db,id,actor,self,'support.manage',true),requestHash = action === 'comment' ? hash([data.body,data.visibility]) : null;
        if (action === 'comment') {
          const previous = (await db.query('select request_hash as "requestHash" from support_case_comments where case_id = $1 and author_id = $2 and request_key = $3',[id,actor.accountId,data.requestKey])).rows[0];
          if (previous) {
            if (previous.requestHash !== requestHash) throw requestError(409,'This request key was already used for a different message.');
            return view(db,row,actor,self);
          }
        }
        if (row.revision !== data.revision) throw requestError(409,'This case changed. Refresh before trying again.');
        const supervisor = !self && supportCan(actor,row,'support.escalate');
        const status = supportNextStatus(row,action,data,self,supervisor);
        const next = {...row,status,revision:row.revision+1};
        if (action === 'update') Object.assign(next,{category:data.category,priority:data.priority,assigneeId:data.assigneeId});
        if (action === 'escalate') Object.assign(next,{assigneeId:data.assigneeId,escalated:true,escalationLevel:row.escalationLevel+1});
        if (terminal(status) || action === 'reopen') next.escalated = false;
        if (['update','escalate'].includes(action) && next.assigneeId) {
          const target = (await assignees(db,row)).find((entry) => entry.id === next.assigneeId);
          if (!target || next.escalated && !target.canEscalate) throw requestError(400,'The assignee is not an active authorized support officer or escalation manager for this intake.');
        }
        if (action === 'update' && next.escalated && !next.assigneeId) throw requestError(400,'An escalated case must retain a manager.');
        await db.query(`update support_cases set category = $2,priority = $3,status = $4,assignee_id = $5,escalated = $6,escalation_level = $7,revision = $8,updated_at = now(),
          resolved_at = case when $4 in ('resolved','closed') then coalesce(resolved_at,now()) else null end,closed_at = case when $4 = 'closed' then now() else null end where id = $1`,[id,next.category,next.priority,status,next.assigneeId,next.escalated,next.escalationLevel,next.revision]);
        if (action === 'comment') await db.query(`insert into support_case_comments (id,case_id,revision,author_id,author_kind,visibility,body_encrypted,request_key,request_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[`scc_${randomUUID()}`,id,next.revision,actor.accountId,self ? 'student' : 'staff',data.visibility,encode(data.body),data.requestKey,requestHash]);
        const visibility = action === 'comment' ? data.visibility : action === 'update' && !terminal(status) ? 'internal' : 'public';
        // Escalation routing reasons are staff-only; students still receive the current status.
        await record(db,next,actor,action,row.status,data.reason || null,action === 'escalate' ? 'internal' : visibility);
        return view(db,await caseFor(db,id,actor,self,self ? 'support.self' : 'support.manage'),actor,self);
      });
    }
  };
}
