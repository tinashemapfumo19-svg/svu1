import { randomUUID } from "node:crypto";
import { assertUploadIsAllowed, signedPath } from "./documents.js";
import { insertAudit, requestError, todayIso, withTransaction } from "../support.js";

const text = (value,max,min = 1) => typeof value === "string" && value.trim().length >= min && value.length <= max;
const classifications = ["public","internal","confidential","restricted"];
const accessTtlMs = 5 * 60 * 1000,uploadTtlMs = 15 * 60 * 1000;

export function validateCollection(input,roleCodes,{partial = false} = {}) {
  const out = {};
  // Name and classification are required on creation; the other fields keep their defaults when omitted.
  const has = (key) => ["name","classification"].includes(key) && !partial || input[key] !== undefined;
  if (!partial) {
    if (typeof input.code !== "string" || !/^[a-z0-9_]{3,40}$/.test(input.code)) throw requestError(400,"A collection code of 3-40 lower-case letters, digits, or underscores is required.");
    out.code = input.code;
  }
  if (has("name")) { if (!text(input.name,120,3)) throw requestError(400,"A collection name of 3-120 characters is required."); out.name = input.name.trim(); }
  if (has("description")) { if (typeof (input.description ?? "") !== "string" || (input.description ?? "").length > 1000) throw requestError(400,"Description must be at most 1000 characters."); out.description = (input.description ?? "").trim(); }
  if (has("classification")) { if (!classifications.includes(input.classification)) throw requestError(400,`Classification must be one of ${classifications.join(", ")}.`); out.classification = input.classification; }
  if (has("viewRoles")) {
    if (!Array.isArray(input.viewRoles) || input.viewRoles.length > 30 || input.viewRoles.some((code) => !roleCodes.includes(code))) throw requestError(400,"View roles must be existing role codes.");
    out.viewRoles = [...new Set(input.viewRoles)].sort();
  }
  if (has("studentAccess")) { if (typeof input.studentAccess !== "boolean") throw requestError(400,"studentAccess must be true or false."); out.studentAccess = input.studentAccess; }
  if (has("allowDownload")) { if (typeof input.allowDownload !== "boolean") throw requestError(400,"allowDownload must be true or false."); out.allowDownload = input.allowDownload; }
  if (has("retentionYears")) {
    if (input.retentionYears !== null && (!Number.isInteger(input.retentionYears) || input.retentionYears < 1 || input.retentionYears > 100)) throw requestError(400,"Retention must be 1-100 whole years, or null for no set period.");
    out.retentionYears = input.retentionYears;
  }
  return out;
}

export function normaliseKeywords(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((word) => typeof word !== "string" || !word.trim() || word.length > 40)) throw requestError(400,"Keywords must be up to 20 words or phrases of at most 40 characters.");
  return [...new Set(value.map((word) => word.trim().toLowerCase()))].sort();
}

export const resourceTypes = ["book","journal_article","thesis","past_paper","course_notes","video","dataset","other"];

// Optional library catalogue fields. Omitted fields are left out so updates change only what is sent; null clears.
export function validateCatalogue(input) {
  const out = {};
  if (input.author !== undefined) { if (input.author !== null && (typeof input.author !== "string" || !input.author.trim() || input.author.length > 200)) throw requestError(400,"Author must be 1-200 characters, or null."); out.author = input.author === null ? null : input.author.trim(); }
  if (input.publicationYear !== undefined) { if (input.publicationYear !== null && (!Number.isInteger(input.publicationYear) || input.publicationYear < 1000 || input.publicationYear > 2100)) throw requestError(400,"Publication year must be between 1000 and 2100, or null."); out.publicationYear = input.publicationYear; }
  if (input.resourceType !== undefined) { if (input.resourceType !== null && !resourceTypes.includes(input.resourceType)) throw requestError(400,`Resource type must be one of ${resourceTypes.join(", ")}.`); out.resourceType = input.resourceType; }
  if (input.programmeCodes !== undefined) {
    if (!Array.isArray(input.programmeCodes) || input.programmeCodes.length > 20 || input.programmeCodes.some((code) => typeof code !== "string" || !/^[A-Za-z0-9-]{2,60}$/.test(code))) throw requestError(400,"Programme codes must be up to 20 codes of 2-60 letters, digits, or hyphens.");
    out.programmeCodes = [...new Set(input.programmeCodes.map((code) => code.toUpperCase()))].sort();
  }
  return out;
}

// Who may see a collection: managers see everything; others need one of its view roles, or the student role when the
// collection is open to students. Archived collections are visible to managers only.
export function canSeeCollection(collection,actor) {
  if (actor.permissions.includes("repository.manage")) return true;
  if (collection.status !== "active") return false;
  const roles = actor.roles.map((role) => role.code);
  return collection.viewRoles.some((code) => roles.includes(code)) || (collection.studentAccess && roles.includes("student"));
}

// Plain-text search: whole words through the full-text index, plus a literal title match for partial words.
export function searchPattern(query) {
  return `%${query.replace(/[\\%_]/g,(char) => `\\${char}`)}%`;
}

const collectionSelect = `select id,code,name,description,classification,view_roles as "viewRoles",student_access as "studentAccess",allow_download as "allowDownload",
  retention_years as "retentionYears",status,revision,updated_at as "updatedAt" from repository_collections`;
const itemSelect = `select i.id,i.collection_id as "collectionId",i.title,i.description,i.summary,i.keywords,i.status,i.current_version as "currentVersion",
  to_char(i.retention_until,'YYYY-MM-DD') as "retentionUntil",i.legal_hold as "legalHold",i.revision,i.author,i.publication_year as "publicationYear",i.resource_type as "resourceType",i.programme_codes as "programmeCodes",i.created_by as "createdBy",i.created_at as "createdAt",i.updated_at as "updatedAt"
  from repository_items i`;
const versionSelect = `select v.id,v.item_id as "itemId",v.version,v.document_id as "documentId",v.change_note as "changeNote",v.status,v.uploaded_by as "uploadedBy",v.uploaded_at as "uploadedAt",
  v.published_by as "publishedBy",v.published_at as "publishedAt",v.publication_reason as "publicationReason",d.file_name as "fileName",d.content_type as "contentType",
  d.size_bytes::int as "sizeBytes",d.checksum,d.lifecycle,d.malware_scan_status as "scanStatus" from repository_versions v join documents d on d.id = v.document_id`;

export function createDocumentRepositoryModule(pool,{storage = null,signingKey}) {
  const isManager = (actor) => actor.permissions.includes("repository.manage");
  async function collections(db) { return (await db.query(`${collectionSelect} order by name`)).rows; }
  async function collectionFor(db,id,actor,lock = false) {
    const row = (await db.query(`${collectionSelect} where id = $1 ${lock ? "for update" : ""}`,[id])).rows[0];
    if (!row || !canSeeCollection(row,actor)) throw requestError(404,"Collection was not found.");
    return row;
  }
  // Items are visible with their collection; drafts and pending work only to contributors and publishers, withdrawn
  // items only to managers.
  function canSeeItem(item,actor) {
    if (isManager(actor)) return true;
    if (item.status === "published") return true;
    if (item.status === "draft") return actor.permissions.includes("repository.contribute") || actor.permissions.includes("repository.publish");
    return false;
  }
  async function itemFor(db,id,actor,lock = false) {
    const item = (await db.query(`${itemSelect} where i.id = $1 ${lock ? "for update of i" : ""}`,[id])).rows[0];
    if (!item) throw requestError(404,"Item was not found.");
    const collection = await collectionFor(db,item.collectionId,actor);
    if (!canSeeItem(item,actor)) throw requestError(404,"Item was not found.");
    return {item,collection};
  }
  async function detail(db,item,collection,actor) {
    const staff = isManager(actor) || actor.permissions.includes("repository.contribute") || actor.permissions.includes("repository.publish");
    const versions = (await db.query(`${versionSelect} where v.item_id = $1 order by v.version desc`,[item.id])).rows
      .filter((row) => staff || (row.status === "published" && row.version === item.currentVersion));
    const access = isManager(actor) ? (await db.query(`select occurred_at as "occurredAt",actor_id as "actorId",action,reason,metadata from audit_events where subject_type = 'RepositoryItem' and subject_id = $1 order by occurred_at desc limit 50`,[item.id])).rows : null;
    const can = (permission) => actor.permissions.includes(permission);
    return {item,collection:{id:collection.id,name:collection.name,classification:collection.classification,allowDownload:collection.allowDownload},versions,access,accountId:actor.accountId,
      capabilities:{contribute:can("repository.contribute") && collection.status === "active",publish:can("repository.publish"),manage:isManager(actor),download:collection.allowDownload || isManager(actor)}};
  }
  return {
    async listRepository(actor,filters = {}) {
      return withTransaction(pool,async (db) => {
        const visible = (await collections(db)).filter((row) => canSeeCollection(row,actor));
        const ids = visible.map((row) => row.id);
        const q = typeof filters.q === "string" ? filters.q.trim().slice(0,200) : "";
        const keyword = typeof filters.keyword === "string" ? filters.keyword.trim().toLowerCase().slice(0,40) : "";
        const limit = Math.min(Math.max(Number(filters.limit) || 20,1),50),offset = Math.max(Number(filters.offset) || 0,0);
        const statuses = isManager(actor) ? ["draft","published","withdrawn"] : actor.permissions.includes("repository.contribute") || actor.permissions.includes("repository.publish") ? ["draft","published"] : ["published"];
        const values = [filters.collectionId && ids.includes(filters.collectionId) ? [filters.collectionId] : ids,statuses];
        const conditions = ["i.collection_id = any($1)","i.status = any($2)"];
        if (q) { values.push(q,searchPattern(q)); conditions.push(`(i.search @@ websearch_to_tsquery('simple',$${values.length - 1}) or i.title ilike $${values.length} escape '\\')`); }
        if (keyword) { values.push(keyword); conditions.push(`$${values.length} = any(i.keywords)`); }
        if (resourceTypes.includes(filters.resourceType)) { values.push(filters.resourceType); conditions.push(`i.resource_type = $${values.length}`); }
        if (typeof filters.programme === "string" && /^[A-Za-z0-9-]{2,60}$/.test(filters.programme)) { values.push(filters.programme.toUpperCase()); conditions.push(`$${values.length} = any(i.programme_codes)`); }
        const where = conditions.join(" and ");
        const total = (await db.query(`select count(*)::int as count from repository_items i where ${where}`,values)).rows[0].count;
        values.push(limit,offset);
        const order = q ? `ts_rank(i.search,websearch_to_tsquery('simple',$3)) desc,i.updated_at desc` : "i.updated_at desc";
        const items = (await db.query(`${itemSelect} where ${where} order by ${order},i.id limit $${values.length - 1} offset $${values.length}`,values)).rows;
        return {collections:visible,items,total,limit,offset,
          capabilities:{manage:isManager(actor),contribute:actor.permissions.includes("repository.contribute"),publish:actor.permissions.includes("repository.publish")}};
      });
    },
    async createCollection(input,actor) {
      if (!input || !text(input.reason,2000)) throw requestError(400,"A reason is required.");
      return withTransaction(pool,async (db) => {
        const roles = (await db.query("select code from roles")).rows.map((row) => row.code);
        const fields = validateCollection(input,roles);
        if (fields.studentAccess && !["public","internal"].includes(fields.classification)) throw requestError(400,"Only public or internal collections can be opened to students.");
        if ((await db.query("select 1 from repository_collections where code = $1",[fields.code])).rowCount) throw requestError(409,"That collection code is already used.");
        const id = `rcol_${randomUUID()}`;
        await db.query(`insert into repository_collections (id,code,name,description,classification,view_roles,student_access,allow_download,retention_years,created_by,updated_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,[id,fields.code,fields.name,fields.description || "",fields.classification,fields.viewRoles || [],fields.studentAccess ?? false,fields.allowDownload ?? true,fields.retentionYears ?? null,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.collection.created",subjectType:"RepositoryCollection",subjectId:id,reason:input.reason,metadata:fields});
        return (await db.query(`${collectionSelect} where id = $1`,[id])).rows[0];
      });
    },
    async updateCollection(id,input,actor) {
      if (!input || !Number.isInteger(input.revision) || !text(input.reason,2000) || (input.status !== undefined && !["active","archived"].includes(input.status))) throw requestError(400,"Provide the revision, the changes, and a reason.");
      return withTransaction(pool,async (db) => {
        const current = await collectionFor(db,id,actor,true);
        if (current.revision !== input.revision) throw requestError(409,"This collection changed since you loaded it.");
        const roles = (await db.query("select code from roles")).rows.map((row) => row.code);
        const {revision,reason,status,code,...rest} = input;
        if (code !== undefined) throw requestError(400,"A collection code cannot change.");
        const next = {...current,...validateCollection(rest,roles,{partial:true}),status:status || current.status};
        if (next.studentAccess && !["public","internal"].includes(next.classification)) throw requestError(400,"Only public or internal collections can be opened to students.");
        await db.query(`update repository_collections set name = $2,description = $3,classification = $4,view_roles = $5,student_access = $6,allow_download = $7,retention_years = $8,status = $9,
          revision = revision + 1,updated_by = $10,updated_at = now() where id = $1`,[id,next.name,next.description,next.classification,next.viewRoles,next.studentAccess,next.allowDownload,next.retentionYears,next.status,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.collection.updated",subjectType:"RepositoryCollection",subjectId:id,reason,metadata:{changes:Object.keys(rest).concat(status ? ["status"] : [])}});
        return (await db.query(`${collectionSelect} where id = $1`,[id])).rows[0];
      });
    },
    async createItem(input,actor) {
      if (!input || Object.keys(input).some((key) => !["collectionId","title","description","summary","keywords","reason","author","publicationYear","resourceType","programmeCodes"].includes(key)) || !text(input.collectionId,100) || !text(input.title,200,3)
        || [input.description,input.summary].some((value) => value !== undefined && (typeof value !== "string" || value.length > 4000)) || !text(input.reason,2000)) {
        throw requestError(400,"Provide the collection, a title of 3-200 characters, optional description and summary (up to 4000 characters), keywords, and a reason.");
      }
      const keywords = normaliseKeywords(input.keywords);
      const catalogue = validateCatalogue(input);
      return withTransaction(pool,async (db) => {
        const collection = await collectionFor(db,input.collectionId,actor);
        if (collection.status !== "active") throw requestError(409,"Archived collections take no new items.");
        const id = `ritem_${randomUUID()}`;
        await db.query(`insert into repository_items (id,collection_id,title,description,summary,keywords,keywords_text,created_by,author,publication_year,resource_type,programme_codes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id,collection.id,input.title.trim(),(input.description || "").trim(),(input.summary || "").trim(),keywords,keywords.join(" "),actor.accountId,catalogue.author ?? null,catalogue.publicationYear ?? null,catalogue.resourceType ?? null,catalogue.programmeCodes || []]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.item.created",subjectType:"RepositoryItem",subjectId:id,reason:input.reason,metadata:{collectionId:collection.id}});
        const {item} = await itemFor(db,id,actor);
        return detail(db,item,collection,actor);
      });
    },
    async updateItem(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["revision","title","description","summary","keywords","reason","author","publicationYear","resourceType","programmeCodes"].includes(key)) || !Number.isInteger(input.revision) || !text(input.reason,2000)
        || (input.title !== undefined && !text(input.title,200,3)) || [input.description,input.summary].some((value) => value !== undefined && (typeof value !== "string" || value.length > 4000))) {
        throw requestError(400,"Provide the revision, the metadata changes, and a reason.");
      }
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor,true);
        if (item.revision !== input.revision) throw requestError(409,"This item changed since you loaded it.");
        if (item.status === "withdrawn") throw requestError(409,"Withdrawn items cannot be edited.");
        const keywords = input.keywords === undefined ? item.keywords : normaliseKeywords(input.keywords);
        const catalogue = {author:item.author,publicationYear:item.publicationYear,resourceType:item.resourceType,programmeCodes:item.programmeCodes,...validateCatalogue(input)};
        await db.query(`update repository_items set title = $2,description = $3,summary = $4,keywords = $5,keywords_text = $6,author = $7,publication_year = $8,resource_type = $9,programme_codes = $10,revision = revision + 1,updated_at = now() where id = $1`,
          [id,input.title?.trim() ?? item.title,input.description?.trim() ?? item.description,input.summary?.trim() ?? item.summary,keywords,keywords.join(" "),catalogue.author,catalogue.publicationYear,catalogue.resourceType,catalogue.programmeCodes]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.item.updated",subjectType:"RepositoryItem",subjectId:id,reason:input.reason,metadata:{changes:Object.keys(input).filter((key) => !["revision","reason"].includes(key))}});
        return detail(db,(await itemFor(db,id,actor)).item,collection,actor);
      });
    },
    async getRepositoryItem(id,actor) {
      return withTransaction(pool,async (db) => {const {item,collection} = await itemFor(db,id,actor); return detail(db,item,collection,actor);});
    },
    // A version is a file in the document pipeline: signed upload, signature check, then the malware scan. It becomes
    // publishable only once the scan marks it available.
    async createVersion(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["fileName","contentType","sizeBytes","checksum","changeNote"].includes(key)) || !text(input.changeNote,1000)) throw requestError(400,"Provide the file details and a change note.");
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor,true);
        if (collection.status !== "active" || item.status === "withdrawn") throw requestError(409,"New versions need an active collection and an item that is not withdrawn.");
        assertUploadIsAllowed({...input,ownerType:"RepositoryVersion",ownerId:"pending",documentType:"repository_file",classification:collection.classification});
        if ((await db.query("select 1 from repository_versions where item_id = $1 and status = 'pending'",[id])).rowCount) throw requestError(409,"A version already awaits publication. Publish or reject it first.");
        const version = (await db.query("select coalesce(max(version),0) + 1 as next from repository_versions where item_id = $1",[id])).rows[0].next;
        const versionId = `rver_${randomUUID()}`,documentId = `doc_${randomUUID()}`;
        await db.query(`insert into documents (id,owner_type,owner_id,document_type,classification,storage_key,checksum,lifecycle,malware_scan_status,file_name,content_type,size_bytes,upload_expires_at)
          values ($1,'RepositoryVersion',$2,'repository_file',$3,$4,$5,'upload_requested','pending',$6,$7,$8,$9)`,
          [documentId,versionId,collection.classification,`private/repository/${randomUUID()}`,input.checksum ? String(input.checksum).toLowerCase() : "pending",input.fileName,input.contentType,Number(input.sizeBytes),new Date(Date.now() + uploadTtlMs).toISOString()]);
        // Institution-wide scope: only globally scoped scanners and administrators reach the file through the scan step.
        await db.query("insert into resource_scopes (id,resource_type,resource_id,programme_code,intake_id) values ($1,'RepositoryVersion',$2,null,null)",[`rs_${randomUUID()}`,versionId]);
        await db.query("insert into repository_versions (id,item_id,version,document_id,change_note,uploaded_by) values ($1,$2,$3,$4,$5,$6)",[versionId,id,version,documentId,input.changeNote.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.version.uploading",subjectType:"RepositoryItem",subjectId:id,reason:input.changeNote,metadata:{version,documentId,fileName:input.fileName}});
        const upload = storage ? {method:"PUT",...signedPath(signingKey,"upload",documentId,uploadTtlMs),headers:{"Content-Type":input.contentType}} : {method:"PUT",url:null,note:"No storage provider is configured (ADR-004)."};
        return {versionId,version,documentId,upload};
      });
    },
    async reviewVersion(id,versionNumber,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["published","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose publish or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor,true);
        const version = (await db.query(`${versionSelect} where v.item_id = $1 and v.version = $2 for update of v`,[id,versionNumber])).rows[0];
        if (!version) throw requestError(404,"Version was not found.");
        if (version.status !== "pending") throw requestError(409,"Only pending versions can be reviewed.");
        if (version.uploadedBy === actor.accountId) throw requestError(403,"A version must be published or rejected by someone other than its uploader.");
        if (input.outcome === "published") {
          if (version.lifecycle !== "available") throw requestError(409,`The file is ${version.lifecycle}; only scanned, clean files can be published.`);
          await db.query("update repository_versions set status = 'superseded' where item_id = $1 and status = 'published'",[id]);
          const until = collection.retentionYears ? (await db.query("select to_char(current_date + make_interval(years => $1),'YYYY-MM-DD') as d",[collection.retentionYears])).rows[0].d : null;
          await db.query("update repository_items set status = 'published',current_version = $2,retention_until = $3,updated_at = now() where id = $1",[id,versionNumber,until]);
        }
        await db.query("update repository_versions set status = $2,published_by = $3,published_at = now(),publication_reason = $4 where id = $1",[version.id,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`repository.version.${input.outcome}`,subjectType:"RepositoryItem",subjectId:id,reason:input.reason,metadata:{version:versionNumber,documentId:version.documentId,checksum:version.checksum}});
        return detail(db,(await itemFor(db,id,actor)).item,collection,actor);
      });
    },
    // Every view or download link is issued against a visible, published version and audited with its purpose.
    // Collections can forbid downloads; earlier versions are for managers only.
    async accessItem(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["mode","version","reason"].includes(key)) || !["view","download"].includes(input.mode)
        || (input.version !== undefined && !Number.isInteger(input.version)) || (input.reason !== undefined && !text(input.reason,500))) throw requestError(400,"Choose view or download, optionally a version and a purpose.");
      if (!storage) throw requestError(501,"No storage provider is configured (ADR-004).");
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor);
        const wanted = input.version ?? item.currentVersion;
        if (wanted !== item.currentVersion && !isManager(actor)) throw requestError(403,"Earlier versions are available to records managers only.");
        if (input.mode === "download" && !collection.allowDownload && !isManager(actor)) throw requestError(403,"This collection is view-only.");
        if (item.status !== "published" && !isManager(actor)) throw requestError(409,"Only published items can be opened.");
        const version = (await db.query(`${versionSelect} where v.item_id = $1 and v.version = $2`,[id,wanted])).rows[0];
        if (!version || !["published","superseded"].includes(version.status) || version.lifecycle !== "available") throw requestError(409,"That version is not available.");
        await insertAudit(db,{actorId:actor.accountId,action:input.mode === "view" ? "repository.item.viewed" : "repository.item.downloaded",subjectType:"RepositoryItem",subjectId:id,
          reason:input.reason?.trim() || (input.mode === "view" ? "Viewed" : "Downloaded"),metadata:{version:wanted,documentId:version.documentId,collectionId:collection.id}});
        return {mode:input.mode,version:wanted,fileName:version.fileName,...signedPath(signingKey,input.mode,version.documentId,accessTtlMs)};
      });
    },
    async withdrawItem(id,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A withdrawal reason is required.");
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor,true);
        if (item.status !== "published") throw requestError(409,"Only published items can be withdrawn.");
        await db.query("update repository_items set status = 'withdrawn',updated_at = now() where id = $1",[id]);
        await insertAudit(db,{actorId:actor.accountId,action:"repository.item.withdrawn",subjectType:"RepositoryItem",subjectId:id,reason:input.reason,metadata:{collectionId:collection.id}});
        return detail(db,(await itemFor(db,id,actor)).item,collection,actor);
      });
    },
    async setLegalHold(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["legalHold","reason"].includes(key)) || typeof input.legalHold !== "boolean" || !text(input.reason,2000)) throw requestError(400,"Set legalHold true or false with a reason.");
      return withTransaction(pool,async (db) => {
        const {item,collection} = await itemFor(db,id,actor,true);
        if (item.legalHold === input.legalHold) throw requestError(409,`The legal hold is already ${input.legalHold ? "on" : "off"}.`);
        await db.query("update repository_items set legal_hold = $2,updated_at = now() where id = $1",[id,input.legalHold]);
        await insertAudit(db,{actorId:actor.accountId,action:input.legalHold ? "repository.hold.placed" : "repository.hold.released",subjectType:"RepositoryItem",subjectId:id,reason:input.reason});
        return detail(db,(await itemFor(db,id,actor)).item,collection,actor);
      });
    },
    // Items past their retention date and not under legal hold, oldest first. Disposal itself awaits the retention
    // policy decision (ADR-011), so this is a review queue.
    async retentionQueue(actor) {
      return withTransaction(pool,async (db) => ({today:todayIso(),items:(await db.query(`${itemSelect} where i.retention_until is not null and i.retention_until < current_date and not i.legal_hold
        and i.status <> 'draft' order by i.retention_until,i.id limit 200`)).rows,heldCount:(await db.query("select count(*)::int as count from repository_items where legal_hold")).rows[0].count}));
    }
  };
}
