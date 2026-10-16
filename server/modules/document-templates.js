import { randomUUID } from "node:crypto";
import { insertAudit, requestError, withTransaction } from "../support.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

// Field limits per document kind. Certificates carry their own wording; transcripts carry an explanatory note.
const fields = {
  common:{institutionName:120,title:120,signatoryName:120,signatoryTitle:120,footerText:500},
  progressive:{notes:1000},
  certificate:{preamble:200,conferralText:300}
};

// Used until a template is approved, so documents issued before templates existed keep their familiar wording.
export const defaultTemplates = {
  progressive:{institutionName:"South Valley University",title:"Academic transcript",signatoryName:"",signatoryTitle:"Academic Registrar",
    footerText:"Verify this document with its verification code.",notes:"Grades follow the grading scheme in force when each result was published."},
  certificate:{institutionName:"South Valley University",title:"Award certificate",signatoryName:"",signatoryTitle:"Academic Registrar",
    footerText:"Verify this document with its verification code.",preamble:"This is to certify that",conferralText:"having completed the {{programme}} programme, has been awarded"}
};

export function validateTemplateContent(kind,content) {
  if (!["progressive","certificate"].includes(kind)) throw requestError(400,"Template kind must be progressive or certificate.");
  const limits = {...fields.common,...fields[kind]};
  if (!content || typeof content !== "object" || Array.isArray(content) || Object.keys(content).some((key) => !(key in limits))) throw requestError(400,`Template fields for ${kind} are ${Object.keys(limits).join(", ")}.`);
  const out = {};
  for (const [key,max] of Object.entries(limits)) {
    const value = content[key] ?? "";
    // The signatory name may be blank (a role-only signature line); every other field needs text.
    if (typeof value !== "string" || value.length > max || (key !== "signatoryName" && !value.trim())) throw requestError(400,`${key} must be ${key === "signatoryName" ? "" : "1-"}${max} characters.`);
    out[key] = value.trim();
  }
  if (kind === "certificate" && !out.conferralText.includes("{{programme}}")) throw requestError(400,"Certificate conferral text must include {{programme}}.");
  return out;
}

const templateSelect = `select id,kind,version,content,status,reason,created_by as "createdBy",created_at as "createdAt",published_by as "publishedBy",published_at as "publishedAt",
  publication_reason as "publicationReason" from document_templates`;

export async function publishedTemplate(db,kind) {
  return (await db.query(`${templateSelect} where kind = $1 and status = 'published'`,[kind])).rows[0] || null;
}

export function createDocumentTemplatesModule(pool) {
  return {
    async listDocumentTemplates(actor) {
      const rows = (await pool.query(`${templateSelect} order by kind,version desc`)).rows;
      return {templates:rows,defaults:defaultTemplates,accountId:actor.accountId,
        capabilities:{manage:actor.permissions.includes("documents.templates.manage"),approve:actor.permissions.includes("documents.templates.approve")}};
    },
    async draftDocumentTemplate(input,actor) {
      if (!input || Object.keys(input).some((key) => !["kind","content","reason"].includes(key)) || !text(input.reason,2000)) throw requestError(400,"Provide the kind, content, and a reason.");
      const content = validateTemplateContent(input.kind,input.content);
      return withTransaction(pool,async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`document-template:${input.kind}`]);
        if ((await db.query("select 1 from document_templates where kind = $1 and status = 'draft'",[input.kind])).rowCount) throw requestError(409,"A draft for this kind already awaits approval.");
        const version = (await db.query("select coalesce(max(version),0) + 1 as next from document_templates where kind = $1",[input.kind])).rows[0].next;
        const id = `dtpl_${randomUUID()}`;
        await db.query("insert into document_templates (id,kind,version,content,reason,created_by) values ($1,$2,$3,$4,$5,$6)",[id,input.kind,version,JSON.stringify(content),input.reason.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"documents.template.drafted",subjectType:"DocumentTemplate",subjectId:id,reason:input.reason,metadata:{kind:input.kind,version}});
        return (await db.query(`${templateSelect} where id = $1`,[id])).rows[0];
      });
    },
    async reviewDocumentTemplate(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["published","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose publish or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        const template = (await db.query(`${templateSelect} where id = $1 for update`,[id])).rows[0];
        if (!template) throw requestError(404,"Template was not found.");
        if (template.status !== "draft") throw requestError(409,"Only draft templates can be reviewed.");
        if (template.createdBy === actor.accountId) throw requestError(403,"A template must be approved by someone other than its author.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`document-template:${template.kind}`]);
        if (input.outcome === "published") {
          await db.query("update document_templates set status = 'superseded' where kind = $1 and status = 'published'",[template.kind]);
          await db.query("update document_templates set status = 'published',published_by = $2,published_at = now(),publication_reason = $3 where id = $1",[id,actor.accountId,input.reason.trim()]);
        } else {
          // A rejected draft is closed as superseded without ever having been published, freeing the kind for a new draft.
          await db.query("update document_templates set status = 'superseded',publication_reason = $2 where id = $1",[id,`Rejected: ${input.reason.trim()}`]);
        }
        await insertAudit(db,{actorId:actor.accountId,action:`documents.template.${input.outcome}`,subjectType:"DocumentTemplate",subjectId:id,reason:input.reason,metadata:{kind:template.kind,version:template.version}});
        return (await db.query(`${templateSelect} where id = $1`,[id])).rows[0];
      });
    }
  };
}
