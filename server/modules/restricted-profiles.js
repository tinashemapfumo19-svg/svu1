import { createHmac, randomUUID } from 'node:crypto';
import { actorCanAccessScope, insertAudit, requestError, withTransaction } from '../support.js';
import { decryptSecret, encryptSecret } from '../security.js';

export const restrictedGroups = Object.freeze({
  religion: Object.freeze({religion:120}),
  disability: Object.freeze({disability:500}),
  medical: Object.freeze({chronicConditions:1000,provider:160,providerAddress:500,medicalAidNumber:100,physicianContact:300})
});
const text = (v,n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n && !/[\u0000-\u001f\u007f]/.test(v);
const object = (v,keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw requestError(400,'Unsupported restricted profile fields.');
};
const key = v => text(v,100) && /^[A-Za-z0-9_-]{16,100}$/.test(v);
export function validateRestrictedPolicy(input) {
  object(input,['group','purposeCode','title','purpose','owner','policyReference','retentionRule','consentDays','requestKey']);
  if (typeof input.group !== 'string' || !Object.hasOwn(restrictedGroups,input.group) || !text(input.purposeCode,60) || !/^[A-Z][A-Z0-9_]{2,59}$/.test(input.purposeCode)
    || !text(input.title,160) || !text(input.purpose,2000) || !text(input.owner,160) || !text(input.policyReference,500) || !text(input.retentionRule,2000)
    || !Number.isSafeInteger(input.consentDays) || input.consentDays < 1 || input.consentDays > 366 || !key(input.requestKey)) throw requestError(400,'Provide an explicit category, purpose, policy owner, reference, retention rule and bounded consent duration.');
  return Object.fromEntries(['group','purposeCode','title','purpose','owner','policyReference','retentionRule','consentDays','requestKey'].map(k => [k,typeof input[k] === 'string' ? input[k].trim() : input[k]]));
}
export function validateRestrictedSubmission(group,input) {
  if (typeof group !== 'string' || !Object.hasOwn(restrictedGroups,group)) throw requestError(400,'Unknown restricted profile category.');
  object(input,['revision','policyId','consent','values','requestKey']);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !text(input.policyId,160) || input.consent !== true || !key(input.requestKey)) throw requestError(400,'Current revision, explicit consent, policy and request key are required.');
  object(input.values,Object.keys(restrictedGroups[group]));
  const values = {};
  for (const [field,max] of Object.entries(restrictedGroups[group])) {
    const value = Object.hasOwn(input.values,field) ? input.values[field] : '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw requestError(400,'Restricted profile values must be bounded text.');
    values[field] = value.trim();
  }
  if (!Object.values(values).some(Boolean)) throw requestError(400,'Provide at least one value, or withdraw existing consent.');
  return {revision:input.revision,policyId:input.policyId,consent:true,values,requestKey:input.requestKey};
}
export function restrictedAuthority(actor,group,target) {
  const permission = `restricted.${group}.read`;
  return Object.hasOwn(restrictedGroups,group) && actor.permissions.includes(permission)
    && actorCanAccessScope({...actor,authorizingPermission:permission},target);
}
export function restrictedConsentActive(profile,policy,now = new Date()) {
  return !!profile && profile.status === 'consented' && profile.policyId === policy.id && policy.status === 'published'
    && new Date(profile.expiresAt).getTime() > now.getTime();
}
export function restrictedGlobalAuthority(actor,permission) {
  return actor.permissions.includes(permission) && actor.roles.some(r => (r.permissions || []).includes(permission) && Object.keys(r.scope || {}).length === 0);
}
const policySelect = `select id,category as "group",purpose_code as "purposeCode",title,purpose,owner,policy_reference as "policyReference",
 retention_rule as "retentionRule",consent_days as "consentDays",status,revision,created_by as "createdBy",reviewed_by as "reviewedBy",created_at as "createdAt" from restricted_profile_policies`;
const currentSelect = `select category as "group",revision,policy_id as "policyId",status,expires_at as "expiresAt",changed_at as "changedAt",values_encrypted as "encrypted" from restricted_student_profiles`;

export function createRestrictedProfilesModule(pool,{dataEncryptionKey} = {}) {
  const encode = v => encryptSecret(JSON.stringify(v),dataEncryptionKey);
  const decode = v => {try {return JSON.parse(decryptSecret(v,dataEncryptionKey));} catch {throw requestError(409,'Restricted profile requires secure reconciliation.');}};
  const digest = v => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(v)).digest('hex');
  const global = (actor,p) => {
    if (!restrictedGlobalAuthority(actor,p)) throw requestError(403,'Institution-wide restricted profile governance permission is required.');
  };
  const audit = (db,actor,action,id,metadata) => insertAudit(db,{actorId:actor.accountId,action,subjectType:'restricted_profile',subjectId:id,reason:'Restricted profile governance or access',metadata});
  async function programme(db,id,actor,self,group) {
    if (self && !actor.permissions.includes('registry.self')) throw requestError(403,'Student self-service permission is required.');
    if (!self && (!Object.hasOwn(restrictedGroups,group) || !actor.permissions.includes(`restricted.${group}.read`))) throw requestError(403,'Explicit category permission is required.');
    const row = (await db.query(`select sp.id,s.account_id as "ownerId",sp.intake_id as "intakeId",p.code as "programmeCode"
      from student_programmes sp join students s on s.id=sp.student_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id
      where sp.id=$1 for update of sp`,[id])).rows[0];
    if (!row || (self ? row.ownerId !== actor.accountId : !restrictedAuthority(actor,group,row))) throw requestError(404,'Student programme was not found.');
    return row;
  }
  async function policy(db,id,group) {
    const row = (await db.query(`${policySelect} where id=$1 for share`,[id])).rows[0];
    if (!row || row.group !== group || row.status !== 'published') throw requestError(409,'An approved active policy for this category is required.');
    return row;
  }
  async function receipt(db,actor,requestKey,payload) {
    const row=(await db.query(`select input_hash as hash,result from restricted_profile_commands where actor_id=$1 and request_key=$2`,[actor.accountId,requestKey])).rows[0];
    if (row && row.hash !== digest(payload)) throw requestError(409,'Request key was already used for a different command.');
    return row?.result;
  }
  async function recordReceipt(db,actor,requestKey,payload,result) {
    await db.query(`insert into restricted_profile_commands(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)`,[actor.accountId,requestKey,digest(payload),result]);
  }
  return {
    async restrictedCareWorkspace(input,actor) {
      object(input,['group','q','offset']);
      const group=input.group,q=input.q || '',offset=input.offset === undefined ? 0 : Number(input.offset);
      if (!Object.hasOwn(restrictedGroups,group) || typeof group !== 'string' || typeof q !== 'string' || q.length>160 || /[\u0000-\u001f]/.test(q)
        || !Number.isSafeInteger(offset) || offset<0 || offset>100000)throw requestError(400,'Invalid restricted profile search.');
      if (!actor.permissions.includes(`restricted.${group}.read`))throw requestError(403,'Explicit category permission is required.');
      return withTransaction(pool,async db => {
        await db.query('set transaction isolation level repeatable read read only');
        const scopes=(await db.query(`select i.id as "intakeId",p.code as "programmeCode" from intakes i join programmes p on p.id=i.programme_id`)).rows.filter(r => restrictedAuthority(actor,group,r)).map(r => r.intakeId);
        const from=`from student_programmes sp join students s on s.id=sp.student_id join people pe on pe.id=s.person_id join intakes i on i.id=sp.intake_id join programmes p on p.id=i.programme_id
          where sp.intake_id=any($1::text[]) and ($2='' or s.student_number ilike '%'||$2||'%' or pe.legal_name ilike '%'||$2||'%')`;
        return {group,q,offset,limit:25,total:(await db.query(`select count(*)::int as n ${from}`,[scopes,q])).rows[0].n,
          students:(await db.query(`select sp.id,s.student_number as "studentNumber",pe.legal_name as "legalName",i.label as "intakeLabel",p.code as "programmeCode" ${from} order by s.student_number,sp.id limit 25 offset $3`,[scopes,q,offset])).rows,
          policies:(await db.query(`${policySelect} where category=$1 and status='published' order by created_at desc,id`,[group])).rows};
      });
    },
    async restrictedPolicyWorkspace(actor,input={}) {
      object(input,['offset']);const offset=input.offset === undefined ? 0 : Number(input.offset);
      if (!Number.isSafeInteger(offset) || offset<0 || offset>100000)throw requestError(400,'Invalid policy pagination.');
      const capabilities={manage:restrictedGlobalAuthority(actor,'restricted.policy.manage'),approve:restrictedGlobalAuthority(actor,'restricted.policy.approve')};
      global(actor,capabilities.manage ? 'restricted.policy.manage' : 'restricted.policy.approve');
      return withTransaction(pool,async db => {
        await db.query('set transaction isolation level repeatable read read only');
        return {policies:(await db.query(`${policySelect} order by created_at desc,id limit 25 offset $1`,[offset])).rows,
          total:(await db.query('select count(*)::int as n from restricted_profile_policies')).rows[0].n,offset,limit:25,capabilities};
      });
    },
    async createRestrictedPolicy(raw,actor) {
      global(actor,'restricted.policy.manage');const input=validateRestrictedPolicy(raw);
      return withTransaction(pool,async db => {
        await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`restricted-command:${actor.accountId}:${input.requestKey}`]);
        const payload={action:'policy.create',...input},old=await receipt(db,actor,input.requestKey,payload);if(old)return old;
        const id=`rp_${randomUUID()}`;
        await db.query(`insert into restricted_profile_policies(id,category,purpose_code,title,purpose,owner,policy_reference,retention_rule,consent_days,created_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,input.group,input.purposeCode,input.title,input.purpose,input.owner,input.policyReference,input.retentionRule,input.consentDays,actor.accountId]);
        await audit(db,actor,'restricted.policy.create',id,{group:input.group,purposeCode:input.purposeCode});
        const result=(await db.query(`${policySelect} where id=$1`,[id])).rows[0];
        await recordReceipt(db,actor,input.requestKey,payload,result);return result;
      });
    },
    async decideRestrictedPolicy(id,input,actor) {
      object(input,['revision','action']);
      if (!['publish','retire'].includes(input.action) || !Number.isSafeInteger(input.revision) || input.revision < 1) throw requestError(400,'Select a policy action and current revision.');
      global(actor,input.action === 'publish' ? 'restricted.policy.approve' : 'restricted.policy.manage');
      return withTransaction(pool,async db => {
        const row=(await db.query(`${policySelect} where id=$1 for update`,[id])).rows[0];
        if (!row)throw requestError(404,'Policy was not found.');
        if (row.revision !== input.revision)throw requestError(409,'Policy changed; refresh before deciding.');
        if (input.action === 'publish' && (row.status !== 'draft' || row.createdBy === actor.accountId)) throw requestError(409,'A draft policy requires approval by an independent account.');
        if (input.action === 'retire' && row.status !== 'published')throw requestError(409,'Only published policies can be retired.');
        await db.query(`update restricted_profile_policies set status=$2,revision=revision+1,reviewed_by=case when $2='published' then $3 else reviewed_by end where id=$1`,[id,input.action === 'publish' ? 'published' : 'retired',actor.accountId]);
        await audit(db,actor,`restricted.policy.${input.action}`,id,{group:row.group,revision:row.revision+1});
        return (await db.query(`${policySelect} where id=$1`,[id])).rows[0];
      });
    },
    async ownRestrictedProfile(id,actor) {
      return withTransaction(pool,async db => {
        await programme(db,id,actor,true);
        const profiles=(await db.query(`${currentSelect} where student_programme_id=$1 order by category`,[id])).rows;
        const policies=(await db.query(`${policySelect} where status='published' order by category,purpose_code,created_at desc,id`)).rows;
        const result=profiles.map(({encrypted,...row}) => ({...row,values:decode(encrypted)}));
        await audit(db,actor,'restricted.self.read',id,{groups:profiles.map(r => r.group)});
        return {programmeId:id,policies,profiles:result};
      });
    },
    async saveRestrictedProfile(id,group,raw,actor) {
      const input=validateRestrictedSubmission(group,raw);
      return withTransaction(pool,async db => {
        await programme(db,id,actor,true);
        await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`restricted-command:${actor.accountId}:${input.requestKey}`]);
        const payload={action:'profile.save',programmeId:id,group,...input},old=await receipt(db,actor,input.requestKey,payload);if(old)return old;
        const approved=await policy(db,input.policyId,group);
        const previous=(await db.query(`${currentSelect} where student_programme_id=$1 and category=$2`,[id,group])).rows[0];
        if ((previous?.revision || 0) !== input.revision)throw requestError(409,'Restricted profile changed; refresh before saving.');
        const encrypted=encode(input.values),revision=input.revision+1;
        const row=(await db.query(`insert into restricted_student_profiles(student_programme_id,category,revision,policy_id,status,values_encrypted,expires_at)
          values($1,$2,$3,$4,'consented',$5,now()+$6*interval '1 day') on conflict(student_programme_id,category) do update
          set revision=excluded.revision,policy_id=excluded.policy_id,status=excluded.status,values_encrypted=excluded.values_encrypted,expires_at=excluded.expires_at,changed_at=now()
          returning revision,policy_id as "policyId",status,expires_at as "expiresAt"`,[id,group,revision,approved.id,encrypted,approved.consentDays])).rows[0];
        await db.query(`insert into restricted_profile_history(student_programme_id,category,revision,policy_id,status,values_encrypted,expires_at,actor_id)
          values($1,$2,$3,$4,'consented',$5,$6,$7)`,[id,group,revision,approved.id,encrypted,row.expiresAt,actor.accountId]);
        await audit(db,actor,'restricted.self.save',id,{group,revision,policyId:approved.id});
        const result={group,...row};await recordReceipt(db,actor,input.requestKey,payload,result);return result;
      });
    },
    async withdrawRestrictedConsent(id,group,input,actor) {
      object(input,['revision','requestKey']);
      if (!Object.hasOwn(restrictedGroups,group) || !Number.isSafeInteger(input.revision) || input.revision < 1 || !key(input.requestKey))throw requestError(400,'Category, current revision and request key are required.');
      return withTransaction(pool,async db => {
        await programme(db,id,actor,true);
        await db.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`,[`restricted-command:${actor.accountId}:${input.requestKey}`]);
        const payload={action:'profile.withdraw',programmeId:id,group,revision:input.revision,requestKey:input.requestKey},old=await receipt(db,actor,input.requestKey,payload);if(old)return old;
        const previous=(await db.query(`${currentSelect} where student_programme_id=$1 and category=$2`,[id,group])).rows[0];
        if (!previous || previous.revision !== input.revision || previous.status !== 'consented')throw requestError(409,'Consent changed; refresh before withdrawing.');
        const row=(await db.query(`update restricted_student_profiles set status='withdrawn',revision=revision+1,changed_at=now()
          where student_programme_id=$1 and category=$2 returning revision,policy_id as "policyId",status,expires_at as "expiresAt"`,[id,group])).rows[0];
        await db.query(`insert into restricted_profile_history(student_programme_id,category,revision,policy_id,status,values_encrypted,expires_at,actor_id)
          values($1,$2,$3,$4,'withdrawn',$5,$6,$7)`,[id,group,row.revision,previous.policyId,previous.encrypted,previous.expiresAt,actor.accountId]);
        await audit(db,actor,'restricted.self.withdraw',id,{group,revision:row.revision});
        const result={group,...row};await recordReceipt(db,actor,input.requestKey,payload,result);return result;
      });
    },
    async readRestrictedProfile(id,group,input,actor) {
      object(input,['policyId','purposeCode']);
      if (!text(input.policyId,160) || !text(input.purposeCode,60))throw requestError(400,'Explicit approved policy and purpose are required.');
      return withTransaction(pool,async db => {
        await programme(db,id,actor,false,group);
        const approved=await policy(db,input.policyId,group);
        if (approved.purposeCode !== input.purposeCode)throw requestError(403,'Purpose does not match the approved policy.');
        const profile=(await db.query(`${currentSelect} where student_programme_id=$1 and category=$2`,[id,group])).rows[0];
        const clock=(await db.query(`select clock_timestamp() as now`)).rows[0].now;
        if (!restrictedConsentActive(profile,approved,clock))throw requestError(403,'Current consent for the approved purpose is required.');
        const {encrypted,...row}=profile,values=decode(encrypted);
        await db.query(`insert into restricted_profile_access(student_programme_id,category,revision,policy_id,purpose_code,actor_id) values($1,$2,$3,$4,$5,$6)`,[id,group,profile.revision,approved.id,approved.purposeCode,actor.accountId]);
        await audit(db,actor,'restricted.staff.read',id,{group,revision:profile.revision,policyId:approved.id,purposeCode:approved.purposeCode});
        return {...row,values};
      });
    }
  };
}
