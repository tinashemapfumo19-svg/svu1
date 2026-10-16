import { createHash, randomBytes, randomUUID } from "node:crypto";
import { calculateGpa } from "./grading.js";
import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, requestError, withTransaction } from "../support.js";
import { defaultTemplates, publishedTemplate } from "./document-templates.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// 16 characters from a 32-symbol alphabet (no 0/O or 1/I) give 80 random bits; 256 is a multiple of 32, so there is no bias.
export function verificationCode(bytes = randomBytes(16)) {
  const chars = [...bytes].map((byte) => alphabet[byte % 32]).join("");
  return chars.match(/.{4}/g).join("-");
}

export function normaliseVerificationCode(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g,"");
  return compact.length === 16 && [...compact].every((char) => alphabet.includes(char)) ? compact.match(/.{4}/g).join("-") : null;
}

export function transcriptHash(content) {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

const policyRef = (policy) => ({ruleSetId:policy.rule.id,ruleSetVersion:policy.rule.version,gradingSchemeId:policy.scheme.id,gradingSchemeVersion:policy.scheme.version});

// Builds the transcript content from the official record. Terms are chronological; each term's GPA uses the policy its
// results were published under, and the cumulative GPA uses the latest term's policy with attempts numbered per course so
// its retake rule applies. Recognized credit is listed and counted as earned but never enters a GPA. The content carries no
// dates of its own making, so the same record always produces the same hash.
export function buildTranscript({student,programme,terms,recognitions,award = null}) {
  const ordered = [...terms].sort((a,b) => a.endsOn.localeCompare(b.endsOn) || a.startsOn.localeCompare(b.startsOn) || a.periodId.localeCompare(b.periodId));
  const attempts = new Map(),all = [];
  const termRows = ordered.map((term) => {
    const results = [...term.results].sort((a,b) => a.code.localeCompare(b.code)).map((row) => ({code:row.code,title:row.title,credits:Number(row.credits),mark:row.mark,grade:row.grade,points:row.points,passing:row.passing,amended:row.revision > 0}));
    for (const row of results) {
      const attempt = (attempts.get(row.code) || 0) + 1;
      attempts.set(row.code,attempt);
      all.push({courseCode:row.code,credits:row.credits,mark:row.mark,attempt});
    }
    const gpa = calculateGpa(results.map((row) => ({courseCode:row.code,credits:row.credits,mark:row.mark})),term.policy.rule.rules,term.policy.scheme);
    return {periodId:term.periodId,name:term.name,yearOfStudy:term.yearOfStudy,term:term.term,startsOn:term.startsOn,endsOn:term.endsOn,results,
      gpa:gpa.gpa,classification:gpa.classification,creditsAttempted:results.reduce((sum,row) => sum + row.credits,0),
      creditsPassed:results.filter((row) => row.passing).reduce((sum,row) => sum + row.credits,0),policy:policyRef(term.policy)};
  });
  const latest = ordered.at(-1)?.policy;
  const cumulative = latest ? calculateGpa(all,latest.rule.rules,latest.scheme) : null;
  const passed = new Map();
  for (const term of termRows) for (const row of term.results) if (row.passing) passed.set(row.code,row.credits);
  const recognised = [...recognitions].sort((a,b) => a.code.localeCompare(b.code)).map(({code,title,credits,kind,completedOn}) => ({code,title,credits:Number(credits),kind,completedOn}))
    .filter((row) => !passed.has(row.code));
  const content = {schemaVersion:1,kind:"progressive",student:{studentNumber:student.studentNumber,legalName:student.legalName},
    programme:{code:programme.code,name:programme.name,versionLabel:programme.versionLabel,intakeLabel:programme.intakeLabel,status:programme.status},
    terms:termRows,recognitions:recognised,
    summary:{creditsPassed:[...passed.values()].reduce((sum,value) => sum + value,0),creditsRecognised:recognised.reduce((sum,row) => sum + row.credits,0),
      cumulativeGpa:cumulative?.gpa ?? null,classification:cumulative?.classification ?? null,policy:latest ? policyRef(latest) : null}};
  // Present only once an award is conferred, so earlier content (and its hash) is unchanged.
  if (award) content.award = {title:award.awardTitle,classification:award.classification,conferredOn:award.conferredOn};
  return content;
}

// A certificate states only the holder, the programme, and the conferred award.
export function buildCertificate({student,programme,award}) {
  return {schemaVersion:1,kind:"certificate",student:{studentNumber:student.studentNumber,legalName:student.legalName},programme:{code:programme.code,name:programme.name},
    award:{title:award.awardTitle,classification:award.classification,conferredOn:award.conferredOn}};
}

const transcriptSelect = `select id,student_programme_id as "programmeId",kind,content,content_hash as "contentHash",verification_code as "verificationCode",status,reason,
  issued_by as "issuedBy",issued_at as "issuedAt",superseded_by as "supersededBy",superseded_at as "supersededAt",revoked_by as "revokedBy",revoked_at as "revokedAt",revoke_reason as "revokeReason",reference_number as "referenceNumber",
  (select jsonb_build_object('id',dt.id,'version',dt.version,'content',dt.content) from document_templates dt where dt.id = transcripts.template_id) as template from transcripts`;

async function programmeFor(db,id,actor,own) {
  const row = (await db.query(`select sp.id,sp.status,sp.intake_id as "intakeId",s.account_id as "accountId",s.student_number as "studentNumber",pe.legal_name as "legalName",
    p.code,p.name,pv.version_label as "versionLabel",i.label as "intakeLabel"
    from student_programmes sp join students s on s.id = sp.student_id join people pe on pe.id = s.person_id join intakes i on i.id = sp.intake_id
    join programmes p on p.id = i.programme_id left join programme_versions pv on pv.id = sp.programme_version_id where sp.id = $1`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.code,intakeId:row.intakeId});
  return row;
}

async function currentContent(db,programme) {
  const batches = (await db.query(`select rb.id,rb.policy_snapshot as policy,rp.id as "periodId",rp.year_of_study as "yearOfStudy",rp.term,ap.name,
    to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn"
    from result_batches rb join registration_periods rp on rp.id = rb.period_id join academic_periods ap on ap.id = rp.academic_period_id
    where rb.status = 'published' and exists (select 1 from student_registrations sr where sr.period_id = rb.period_id and sr.student_programme_id = $1)`,[programme.id])).rows;
  const results = (await db.query(`select ar.batch_id as "batchId",ar.result_snapshot as snapshot,ar.revision from academic_results ar join student_registrations sr on sr.id = ar.registration_id
    where sr.student_programme_id = $1 and ar.batch_id = any($2)`,[programme.id,batches.map((row) => row.id)])).rows;
  const terms = batches.map((batch) => ({...batch,results:results.filter((row) => row.batchId === batch.id).map((row) => ({...row.snapshot,revision:row.revision}))})).filter((term) => term.results.length);
  const recognitions = (await db.query(`select c.code,c.title,cr.credits::float as credits,cr.kind,to_char(cr.completed_on,'YYYY-MM-DD') as "completedOn"
    from credit_recognitions cr join courses c on c.id = cr.course_id where cr.student_programme_id = $1 and cr.status = 'approved'`,[programme.id])).rows;
  const award = (await db.query(`select award_title as "awardTitle",classification,to_char(conferred_on,'YYYY-MM-DD') as "conferredOn" from award_requests where student_programme_id = $1 and status = 'approved'`,[programme.id])).rows[0];
  const content = buildTranscript({student:programme,programme,terms,recognitions,award});
  const certificate = award ? buildCertificate({student:programme,programme,award}) : null;
  return {content,contentHash:transcriptHash(content),certificate:certificate && {content:certificate,contentHash:transcriptHash(certificate)}};
}

export function createTranscriptsModule(pool) {
  return {
    async listTranscripts(id,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,own);
        const current = await currentContent(db,programme);
        const issued = (await db.query(`${transcriptSelect} where student_programme_id = $1 order by issued_at desc,id`,[id])).rows
          .map((row) => ({...row,template:row.template || {id:null,version:null,content:defaultTemplates[row.kind]},outdated:row.status === "issued" && row.contentHash !== (row.kind === "certificate" ? current.certificate?.contentHash : current.contentHash)}));
        if (own) return {transcripts:issued.map(({revokedBy,issuedBy,...row}) => row)};
        const can = actor.permissions.includes("registry.transcript.issue") && actorCanAccessScope({...actor,authorizingPermission:"registry.transcript.issue"},{programmeCode:programme.code,intakeId:programme.intakeId});
        // Previews use the template that an issue would apply now.
        const templates = {};
        for (const kind of ["progressive","certificate"]) {const row = await publishedTemplate(db,kind); templates[kind] = row ? {id:row.id,version:row.version,content:row.content} : {id:null,version:null,content:defaultTemplates[kind]};}
        return {current,transcripts:issued,templates,capabilities:{issue:can}};
      });
    },
    // The issuer confirms the hash of the record they reviewed; a change in between (an amendment, a newly published batch,
    // a credit decision) refuses the issue instead of certifying something unseen.
    async issueTranscript(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["expectedHash","reason","kind"].includes(key)) || !text(input.expectedHash,64) || !text(input.reason,2000)
        || ![undefined,"progressive","certificate"].includes(input.kind)) throw requestError(400,"Provide the reviewed record hash, a reason, and optionally the document kind.");
      const kind = input.kind || "progressive";
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`transcript:${id}`]);
        const record = await currentContent(db,programme),current = kind === "certificate" ? record.certificate : record;
        if (kind === "certificate" && !current) throw requestError(409,"A certificate can only be issued after an award is conferred.");
        if (kind === "progressive" && !current.content.terms.length && !current.content.recognitions.length && !current.content.award) throw requestError(409,"There are no published results or recognized credit to certify.");
        if (current.contentHash !== input.expectedHash) throw requestError(409,"The academic record changed after you reviewed it. Review the current record before issuing.");
        const previous = (await db.query(`${transcriptSelect} where student_programme_id = $1 and kind = $2 and status = 'issued' for update`,[id,kind])).rows[0];
        const transcriptId = `tr_${randomUUID()}`;
        let code;
        for (let tries = 0;;tries++) {
          code = verificationCode();
          if (!(await db.query("select 1 from transcripts where verification_code = $1",[code])).rowCount) break;
          if (tries > 5) throw requestError(500,"Could not allocate a verification code.");
        }
        // The previous transcript stops being current before the new one is inserted (one current per programme); the
        // deferred foreign key lets it reference the new row, which exists by commit.
        if (previous) await db.query("update transcripts set status = 'superseded',superseded_by = $2,superseded_at = now() where id = $1",[previous.id,transcriptId]);
        // The approved template in force is recorded with the document; a unique reference number is allocated too.
        const template = await publishedTemplate(db,kind);
        const sequence = (await db.query("select nextval('document_reference_seq') as value")).rows[0].value;
        const referenceNumber = `SVU-${kind === "certificate" ? "CT" : "TR"}-${new Date().getUTCFullYear()}-${String(sequence).padStart(6,"0")}`;
        await db.query(`insert into transcripts (id,student_programme_id,kind,content,content_hash,verification_code,reason,issued_by,template_id,reference_number) values ($1,$2,$8,$3,$4,$5,$6,$7,$9,$10)`,
          [transcriptId,id,JSON.stringify(current.content),current.contentHash,code,input.reason.trim(),actor.accountId,kind,template?.id || null,referenceNumber]);
        await insertAudit(db,{actorId:actor.accountId,action:kind === "certificate" ? "registry.certificate.issued" : "registry.transcript.issued",subjectType:"Transcript",subjectId:transcriptId,reason:input.reason,
          metadata:{programmeId:id,kind,contentHash:current.contentHash,supersedes:previous?.id || null}});
        return (await db.query(`${transcriptSelect} where id = $1`,[transcriptId])).rows[0];
      });
    },
    async revokeTranscript(id,transcriptId,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A revocation reason is required.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,id,actor,false);
        const row = (await db.query(`${transcriptSelect} where id = $1 and student_programme_id = $2 for update`,[transcriptId,id])).rows[0];
        if (!row) throw requestError(404,"Transcript was not found.");
        if (row.status !== "issued") throw requestError(409,"Only the current transcript can be revoked.");
        await db.query("update transcripts set status = 'revoked',revoked_by = $2,revoked_at = now(),revoke_reason = $3 where id = $1",[transcriptId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"registry.transcript.revoked",subjectType:"Transcript",subjectId:transcriptId,reason:input.reason,metadata:{programmeId:id}});
        return (await db.query(`${transcriptSelect} where id = $1`,[transcriptId])).rows[0];
      });
    },
    // Public: the code alone identifies one transcript. The answer is enough to compare against the paper copy (holder,
    // programme, summary, hash) without exposing course-level marks or internal identifiers.
    async verifyTranscript(code) {
      const normal = normaliseVerificationCode(code);
      if (!normal) throw requestError(404,"No document matches this verification code.");
      const row = (await pool.query(`${transcriptSelect} where verification_code = $1`,[normal])).rows[0];
      if (!row) throw requestError(404,"No document matches this verification code.");
      return {verificationCode:row.verificationCode,status:row.status,kind:row.kind,issuedAt:row.issuedAt,supersededAt:row.supersededAt,revokedAt:row.revokedAt,
        student:row.content.student,programme:{code:row.content.programme.code,name:row.content.programme.name},summary:row.content.summary ?? null,award:row.content.award ?? null,
        terms:(row.content.terms || []).map(({name,gpa,creditsAttempted,creditsPassed}) => ({name,gpa,creditsAttempted,creditsPassed})),contentHash:row.contentHash,
        referenceNumber:row.referenceNumber,templateVersion:row.template?.version ?? null};
    }
  };
}
