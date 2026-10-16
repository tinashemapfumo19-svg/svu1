import {createHmac,randomUUID} from 'node:crypto';
import {insertAudit,requestError,withTransaction,assertSeparateApprover,todayIso} from '../support.js';
import {encryptSecret,decryptSecret} from '../security.js';

const permissions = ['guidance.manage','guidance.publish'];
const text = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');
function fields(input,allowed) {if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,'Unsupported guidance fields.');}
function day(value) {return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;}
export function guidanceContent(input,create = false) {
  fields(input,create ? ['programmeId','intakeId','title','body','sourceRef','effectiveFrom','validUntil','reason','requestKey'] : ['revision','title','body','sourceRef','effectiveFrom','validUntil','reason','requestKey']);
  if (!text(input.title,180) || !text(input.body,6000) || !text(input.sourceRef,500) || !text(input.reason,2000)
    || !day(input.effectiveFrom) || input.validUntil !== null && (!day(input.validUntil) || input.validUntil < input.effectiveFrom)
    || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey)) throw requestError(400,'Enter bounded guidance, a public source reference, valid dates, reason and request key.');
  const result = {title:input.title.trim(),body:input.body.trim(),sourceRef:input.sourceRef.trim(),effectiveFrom:input.effectiveFrom,validUntil:input.validUntil,reason:input.reason.trim(),requestKey:input.requestKey};
  if (create) {
    if (input.programmeId !== null && !text(input.programmeId,160) || input.intakeId !== null && !text(input.intakeId,160) || input.intakeId && !input.programmeId) throw requestError(400,'Choose institutional, programme or matching intake scope.');
    return {programmeId:input.programmeId,intakeId:input.intakeId,...result};
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw requestError(400,'A current article revision is required.');
  return {revision:input.revision,...result};
}
export function guidanceCan(actor,row,permission) {
  if (!actor.permissions.includes(permission)) return false;
  return actor.roles.filter((role) => (role.permissions || []).includes(permission)).some((role) => {
    const scope = role.scope || {};
    if (role.code === 'system_administrator' || !Object.keys(scope).length) return true;
    if (!row.programmeCode || !(scope.programmeCodes || []).includes(row.programmeCode)) return false;
    return row.intakeId ? !(scope.intakeIds || []).length || scope.intakeIds.includes(row.intakeId) : !(scope.intakeIds || []).length;
  });
}
export function guidanceFilters(input = {},staff = false) {
  fields(input,staff ? ['offset'] : ['q','programmeId','intakeId','offset']);
  const result = {q:input.q ?? '',programmeId:input.programmeId ?? '',intakeId:input.intakeId ?? '',offset:Number(input.offset ?? 0),limit:25};
  if ([result.q,result.programmeId,result.intakeId].some((v) => typeof v !== 'string' || v.length > 160 || /[\r\n\0]/.test(v)) || !/^\d{1,7}$/.test(String(input.offset ?? 0)) || result.offset > 1000000) throw requestError(400,'Use bounded guidance search and pagination.');
  return result;
}
export function guidanceLiveVersion(versions,asOf) {
  const started = versions.filter((v) => v.status === 'published' && v.effectiveFrom <= asOf).sort((a,b) => b.version-a.version)[0];
  return started && (!started.validUntil || started.validUntil >= asOf) ? started : null;
}
const articleSelect = `select g.id,g.programme_id as "programmeId",g.intake_id as "intakeId",p.code as "programmeCode",p.name as "programmeName",i.label as "intakeLabel",g.status,g.revision,g.created_by as "createdBy",g.created_at as "createdAt"
 from guidance_articles g left join programmes p on p.id = g.programme_id left join intakes i on i.id = g.intake_id`;
const versionSelect = `select id,article_id as "articleId",version,status,title_encrypted as "titleEncrypted",body_encrypted as "bodyEncrypted",source_ref_encrypted as "sourceEncrypted",reason_encrypted as "reasonEncrypted",
 to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(valid_until,'YYYY-MM-DD') as "validUntil",created_by as "createdBy",published_by as "publishedBy",published_at as "publishedAt" from guidance_versions`;
export const guidancePublicScopeSql = `g.status = 'active' and (g.programme_id is null or p.status = 'published' and exists(select 1 from programme_versions pv where pv.programme_id = p.id and pv.status in ('published','retired')
 and pv.effective_from <= coalesce(i.starts_on,(now() at time zone 'UTC')::date) and (pv.effective_to is null or pv.effective_to >= coalesce(i.starts_on,(now() at time zone 'UTC')::date))))
 and (g.intake_id is null or i.status = 'published' and i.application_closes_at >= now())`;
const publicScope = guidancePublicScopeSql;

export function createAdmissionsGuidanceModule(pool,{dataEncryptionKey} = {}) {
  const encode = (v) => encryptSecret(v,dataEncryptionKey),hash = (v) => createHmac('sha256',dataEncryptionKey).update(JSON.stringify(v)).digest('hex');
  const decode = (v) => {try {return decryptSecret(v,dataEncryptionKey);} catch {throw requestError(409,'Guidance text requires reconciliation.');}};
  const authority = (actor,permission = null) => {if (!(permission ? actor.permissions.includes(permission) : permissions.some((p) => actor.permissions.includes(p)))) throw requestError(403,'Guidance authority is required.');};
  const audit = (db,actor,action,id,metadata = {}) => insertAudit(db,{actorId:actor?.accountId || 'anonymous',action:`guidance.${action}`,subjectType:'GuidanceArticle',subjectId:id,reason:'Governed public guidance workflow',metadata});
  function scopeSql(actor,values) {
    const roles = actor.roles.filter((r) => (r.permissions || []).some((p) => permissions.includes(p))),clauses = [];
    for (const role of roles) {
      const scope = role.scope || {};
      if (role.code === 'system_administrator' || !Object.keys(scope).length) return 'true';
      if (!(scope.programmeCodes || []).length) continue;
      values.push(scope.programmeCodes);let clause = `p.code = any($${values.length}::text[])`;
      if ((scope.intakeIds || []).length) {values.push(scope.intakeIds);clause += ` and g.intake_id = any($${values.length}::text[])`;}
      clauses.push(`(${clause})`);
    }
    return clauses.length ? `(${clauses.join(' or ')})` : 'false';
  }
  async function resource(db,id,actor,permission = null,lock = false) {
    authority(actor,permission);const row = (await db.query(`${articleSelect} where g.id = $1${lock ? ' for update of g' : ''}`,[id])).rows[0];
    if (!row || !(permission ? guidanceCan(actor,row,permission) : permissions.some((p) => guidanceCan(actor,row,p)))) throw requestError(404,'Guidance article was not found.');
    return row;
  }
  async function origin(db,data,actor) {
    let row = {programmeId:null,intakeId:null,programmeCode:null};
    if (data.programmeId) {
      row = (await db.query('select id as "programmeId",code as "programmeCode",null::text as "intakeId" from programmes where id = $1',[data.programmeId])).rows[0];
      if (!row) throw requestError(404,'Guidance scope was not found.');
      if (data.intakeId) {
        const i = (await db.query('select id as "intakeId" from intakes where id = $1 and programme_id = $2',[data.intakeId,data.programmeId])).rows[0];
        if (!i) throw requestError(404,'Guidance scope was not found.');row = {...row,...i};
      }
    }
    if (!guidanceCan(actor,row,'guidance.manage')) throw requestError(404,'Guidance scope was not found.');return row;
  }
  const content = (v) => ({id:v.id,version:v.version,status:v.status,title:decode(v.titleEncrypted),body:decode(v.bodyEncrypted),sourceRef:decode(v.sourceEncrypted),effectiveFrom:v.effectiveFrom,validUntil:v.validUntil,publishedAt:v.publishedAt});
  async function detail(db,row,actor) {
    const versions = (await db.query(`${versionSelect} where article_id = $1 order by version desc`,[row.id])).rows.map((v) => ({...content(v),createdBy:v.createdBy,reason:decode(v.reasonEncrypted),canPublish:row.status === 'active' && v.status === 'draft' && v.createdBy !== actor.accountId && guidanceCan(actor,row,'guidance.publish')}));
    const history = (await db.query('select revision,action,version,actor_id as "actorId",reason_encrypted as "reasonEncrypted",recorded_at as "recordedAt" from guidance_history where article_id = $1 order by revision desc',[row.id])).rows.map(({reasonEncrypted,...entry}) => ({...entry,reason:decode(reasonEncrypted)}));
    return {...row,versions,history,canDraft:row.status === 'active' && guidanceCan(actor,row,'guidance.manage'),canWithdraw:row.status === 'active' && guidanceCan(actor,row,'guidance.publish')};
  }
  async function record(db,row,actor,action,reason,version = null) {
    await db.query('insert into guidance_history (article_id,revision,action,version,actor_id,reason_encrypted) values ($1,$2,$3,$4,$5,$6)',[row.id,row.revision,action,version,actor.accountId,encode(reason)]);
    await audit(db,actor,action,row.id,{revision:row.revision,version});
  }
  async function insertVersion(db,id,version,data,actor) {
    await db.query(`insert into guidance_versions (id,article_id,version,title_encrypted,body_encrypted,source_ref_encrypted,reason_encrypted,effective_from,valid_until,created_by,request_key,request_hash)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[`gv_${randomUUID()}`,id,version,encode(data.title),encode(data.body),encode(data.sourceRef),encode(data.reason),data.effectiveFrom,data.validUntil,actor.accountId,data.requestKey,hash(data)]);
  }
  return {
    async listPublicGuidance(input) {
      const filters = guidanceFilters(input);
      return withTransaction(pool,async (db) => {
        const asOf = todayIso();
        // Select the latest started publication BEFORE checking expiry: expired replacements never revive old advice.
        const rows = (await db.query(`select g.id,g.programme_id as "programmeId",g.intake_id as "intakeId",p.code as "programmeCode",p.name as "programmeName",i.label as "intakeLabel",v.id as "versionId",v.version,v.title_encrypted as "titleEncrypted",v.body_encrypted as "bodyEncrypted",v.source_ref_encrypted as "sourceEncrypted",to_char(v.effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(v.valid_until,'YYYY-MM-DD') as "validUntil",v.published_at as "publishedAt"
          from guidance_articles g left join programmes p on p.id = g.programme_id left join intakes i on i.id = g.intake_id
          join lateral(select * from guidance_versions where article_id = g.id and status = 'published' and effective_from <= $1::date order by version desc limit 1) v on true
          where ${publicScope} and (v.valid_until is null or v.valid_until >= $1::date)
          and ($2 = '' or g.programme_id = $2 or g.programme_id is null) and ($3 = '' or g.intake_id = $3 or g.intake_id is null)
          and ($4 = '' or v.search_document @@ websearch_to_tsquery('english',$4)) order by v.published_at desc,g.id limit 25 offset $5`,[asOf,filters.programmeId,filters.intakeId,filters.q,filters.offset])).rows;
        const items = rows.map(({titleEncrypted,bodyEncrypted,sourceEncrypted,...row}) => ({...row,title:decode(titleEncrypted),body:decode(bodyEncrypted),sourceRef:decode(sourceEncrypted)}));
        await audit(db,null,'public.read','public',{count:items.length});return {items,asOf,filters,limit:25,offset:filters.offset};
      });
    },
    async guidanceMetadata(actor) {
      authority(actor);
      return withTransaction(pool,async (db) => {
        const programmes = (await db.query('select id,code as "programmeCode",name from programmes order by code')).rows;
        const intakes = (await db.query('select i.id as "intakeId",i.programme_id as "programmeId",i.label,p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.starts_on desc')).rows;
        const allowed = intakes.filter((row) => permissions.some((p) => guidanceCan(actor,row,p)));
        await audit(db,actor,'metadata.read','metadata',{programmes:programmes.length,intakes:allowed.length});
        return {institutional:guidanceCan(actor,{programmeCode:null,intakeId:null},'guidance.manage'),programmes:programmes.filter((row) => permissions.some((p) => guidanceCan(actor,{...row,intakeId:null},p)) || allowed.some((i) => i.programmeId === row.id)).map((row) => ({...row,canDraft:guidanceCan(actor,{...row,intakeId:null},'guidance.manage')})),intakes:allowed.map((row) => ({...row,canDraft:guidanceCan(actor,row,'guidance.manage')}))};
      });
    },
    async listStaffGuidance(input,actor) {
      authority(actor);const filters = guidanceFilters(input,true);
      return withTransaction(pool,async (db) => {
        const values = [],where = scopeSql(actor,values);values.push(filters.offset);
        const rows = (await db.query(`${articleSelect} where ${where} order by g.updated_at desc,g.id limit 25 offset $${values.length}`,values)).rows;
        const items = [];
        for (const row of rows) {const v = (await db.query(`${versionSelect} where article_id = $1 order by version desc limit 1`,[row.id])).rows[0];if (!v) throw requestError(409,'Guidance text requires reconciliation.');items.push({...row,title:decode(v.titleEncrypted),latestVersion:v.version});}
        await audit(db,actor,'queue.read','queue',{count:items.length});return {items,offset:filters.offset,limit:25};
      });
    },
    async getStaffGuidance(id,actor) {return withTransaction(pool,async (db) => {const row = await resource(db,id,actor);await audit(db,actor,'detail.read',id);return detail(db,row,actor);});},
    async createGuidance(input,actor) {
      authority(actor,'guidance.manage');const data = guidanceContent(input,true);
      return withTransaction(pool,async (db) => {
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`guidance:${actor.accountId}:${data.requestKey}`]);
        const old = (await db.query('select id,request_hash as "requestHash" from guidance_articles where created_by = $1 and request_key = $2',[actor.accountId,data.requestKey])).rows[0];
        if (old) {const row = await resource(db,old.id,actor,'guidance.manage');if (old.requestHash !== hash(data)) throw requestError(409,'This guidance key was used for different content.');return detail(db,row,actor);}
        await origin(db,data,actor);const id = `ga_${randomUUID()}`;
        await db.query('insert into guidance_articles (id,programme_id,intake_id,created_by,request_key,request_hash) values ($1,$2,$3,$4,$5,$6)',[id,data.programmeId,data.intakeId,actor.accountId,data.requestKey,hash(data)]);
        await insertVersion(db,id,1,data,actor);const row = await resource(db,id,actor,'guidance.manage');await record(db,row,actor,'drafted',data.reason,1);return detail(db,row,actor);
      });
    },
    async draftGuidanceVersion(id,input,actor) {
      const data = guidanceContent(input);
      return withTransaction(pool,async (db) => {
        const row = await resource(db,id,actor,'guidance.manage',true);
        const old = (await db.query('select request_hash as "requestHash" from guidance_versions where article_id = $1 and created_by = $2 and request_key = $3',[id,actor.accountId,data.requestKey])).rows[0];
        if (old) {if (old.requestHash !== hash(data)) throw requestError(409,'This guidance key was used for different content.');return detail(db,row,actor);}
        if (row.status !== 'active' || row.revision !== data.revision) throw requestError(409,'This article changed or was withdrawn. Refresh before drafting.');
        const version = (await db.query('select coalesce(max(version),0)+1 as version from guidance_versions where article_id = $1',[id])).rows[0].version;
        await insertVersion(db,id,version,data,actor);await db.query('update guidance_articles set revision = revision + 1,updated_at = now() where id = $1',[id]);
        const next = {...row,revision:row.revision+1};await record(db,next,actor,'drafted',data.reason,version);return detail(db,next,actor);
      });
    },
    async publishGuidance(id,versionId,input,actor) {
      fields(input,['revision','reason']);if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !text(input.reason,2000)) throw requestError(400,'Current article revision and review reason are required.');
      return withTransaction(pool,async (db) => {
        const row = await resource(db,id,actor,'guidance.publish',true),versions = (await db.query(`${versionSelect} where article_id = $1 order by version desc`,[id])).rows,v = versions.find((v) => v.id === versionId);
        if (!v) throw requestError(404,'Guidance version was not found.');
        assertSeparateApprover(v.createdBy,actor);
        if (v.status === 'published' && row.status === 'active') return detail(db,row,actor);
        if (row.status !== 'active' || row.revision !== input.revision || v.id !== versions[0].id) throw requestError(409,'This article changed or was withdrawn. Review the latest draft.');
        if (!(await db.query(`${articleSelect} where g.id = $1 and ${publicScope}`,[id])).rows.length) throw requestError(409,'The guidance source programme/intake is not public and current.');
        const safe = content(v);
        await db.query(`update guidance_versions set status = 'published',published_by = $2,published_at = now(),review_reason_encrypted = $3,search_document = to_tsvector('english',$4) where id = $1`,[v.id,actor.accountId,encode(input.reason),`${safe.title}\n${safe.body}\n${safe.sourceRef}`]);
        await db.query('update guidance_articles set revision = revision + 1,updated_at = now() where id = $1',[id]);const next = {...row,revision:row.revision+1};await record(db,next,actor,'published',input.reason,v.version);return detail(db,next,actor);
      });
    },
    async withdrawGuidance(id,input,actor) {
      fields(input,['revision','reason']);if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !text(input.reason,2000)) throw requestError(400,'Current article revision and withdrawal reason are required.');
      return withTransaction(pool,async (db) => {
        const row = await resource(db,id,actor,'guidance.publish',true);if (row.status === 'withdrawn') return detail(db,row,actor);
        if (row.revision !== input.revision) throw requestError(409,'This article changed. Refresh before withdrawal.');
        await db.query("update guidance_articles set status = 'withdrawn',revision = revision + 1,updated_at = now() where id = $1",[id]);const next = {...row,status:'withdrawn',revision:row.revision+1};await record(db,next,actor,'withdrawn',input.reason);return detail(db,next,actor);
      });
    }
  };
}
