import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";

export const identityFields = ["legalName","preferredName","dateOfBirth","nationalityCode"];
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validateIdentityRequest(input,current,today = todayIso()) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["revision","changes","reason","evidenceRef"].includes(key))
    || !Number.isInteger(input.revision) || input.revision < 0 || !input.changes || typeof input.changes !== "object" || Array.isArray(input.changes)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"Provide the identity revision, corrected fields, reason, and evidence reference.");
  if (Object.keys(input.changes).some((key) => !identityFields.includes(key))) throw requestError(400,"Only legal name, preferred name, date of birth, and nationality can be corrected.");
  const changes = {};
  for (const [field,value] of Object.entries(input.changes)) {
    if (typeof value !== "string") throw requestError(400,`${field} must be text.`);
    if (field === "dateOfBirth") {
      let valid = true;
      try { parseEffectiveDate(value); } catch { valid = false; }
      const age = valid ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / (365.25 * 86_400_000) : -1;
      if (!valid || age < 14 || age > 100) throw requestError(400,"dateOfBirth must be a real date for a student aged 14-100.");
      changes[field] = value;
    } else if (field === "nationalityCode") {
      if (!/^[A-Z]{2}$/.test(value)) throw requestError(400,"nationalityCode must be a two-letter country code.");
      changes[field] = value;
    } else {
      const name = value.trim().replace(/\s+/g," ");
      if (name.length < (field === "legalName" ? 2 : 1) || name.length > 200 || controlCharacters.test(name)) throw requestError(400,`${field} must be ${field === "legalName" ? 2 : 1}-200 printable characters.`);
      changes[field] = name;
    }
  }
  for (const field of Object.keys(changes)) if (current[field] === changes[field]) delete changes[field];
  if (!Object.keys(changes).length) throw requestError(400,"The correction does not change any identity field.");
  return changes;
}

export function validateIdentityReview(input) {
  if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"Choose approve/reject and provide a review reason.");
}

export function sameIdentity(a,b) {return identityFields.every((field) => (a[field] ?? null) === (b[field] ?? null));}

async function identityFor(db,studentId,lock = false) {
  if (lock) await db.query("select id from students where id = $1 for update",[studentId]);
  const row = (await db.query(`select s.id,s.student_number as "studentNumber",s.account_id as "accountId",s.person_id as "personId",s.identity_revision as revision,s.merged_into_student_id as "mergedInto",
    pe.legal_name as "legalName",pe.preferred_name as "preferredName",to_char(ap.date_of_birth,'YYYY-MM-DD') as "dateOfBirth",ap.nationality_code as "nationalityCode"
    from students s join people pe on pe.id = s.person_id left join applicant_profiles ap on ap.account_id = s.account_id where s.id = $1`,[studentId])).rows[0];
  if (!row) throw requestError(404,"Student record was not found.");
  return {...row,current:Object.fromEntries(identityFields.map((field) => [field,row[field] ?? null]))};
}

async function studentForProgramme(db,programmeId,actor) {
  const programme = (await db.query(`select sp.student_id as "studentId",sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp
    join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[programmeId])).rows[0];
  if (!programme) throw requestError(404,"Student programme was not found.");
  assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
  return programme;
}

async function ownStudentId(db,actor) {
  const row = (await db.query("select id from students where account_id = $1",[actor.accountId])).rows[0];
  if (!row) throw requestError(404,"No student record is linked to this account.");
  return row.id;
}

// Fails closed when a proposed identity matches another student: merging or separating records is duplicate resolution, not a correction.
async function assertNoDuplicate(db,identity,proposed) {
  if (!proposed.dateOfBirth) return;
  const match = await db.query(`select 1 from students s join people pe on pe.id = s.person_id join applicant_profiles ap on ap.account_id = s.account_id
    where s.id <> $1 and s.merged_into_student_id is null and lower(pe.legal_name) = lower($2) and ap.date_of_birth = $3::date limit 1`,[identity.id,proposed.legalName,proposed.dateOfBirth]);
  if (match.rowCount) throw requestError(409,"The corrected identity matches another student record. Refer it for duplicate resolution instead.");
}

async function assertActiveCountry(db,code) {
  const country = await db.query("select 1 from reference_values where list_code = 'country' and value_code = $1 and status = 'active' and (effective_from is null or effective_from <= current_date) and (effective_to is null or effective_to >= current_date)",[code]);
  if (!country.rowCount) throw requestError(400,"Select an active nationality.");
}

const requestSelect = `select id,identity_revision as revision,current_snapshot as "currentSnapshot",changes,reason,evidence_ref as "evidenceRef",channel,status,
  requested_by as "requestedBy",requested_at as "requestedAt",reviewed_by as "reviewedBy",reviewed_at as "reviewedAt",review_reason as "reviewReason" from student_identity_requests`;

export function createIdentityCorrectionsModule(pool) {
  async function view(db,studentId,actor,scope) {
    const identity = await identityFor(db,studentId);
    const requests = (await db.query(`${requestSelect} where student_id = $1 order by id desc`,[studentId])).rows;
    const capabilities = Object.fromEntries(["request","approve"].map((action) => [action,Boolean(scope) && actor.permissions.includes(`registry.identity.${action}`)
      && actorCanAccessScope({...actor,authorizingPermission:`registry.identity.${action}`},scope)]));
    if (!scope) capabilities.request = true;
    return {studentId,studentNumber:identity.studentNumber,revision:identity.revision,identity:identity.current,requests,capabilities,accountId:actor.accountId};
  }
  async function request(db,studentId,input,actor,channel) {
    const identity = await identityFor(db,studentId,true);
    if (identity.mergedInto) throw requestError(409,"This student record was merged into another record. Correct the surviving record instead.");
    const changes = validateIdentityRequest(input,identity.current);
    if (input.revision !== identity.revision) throw requestError(409,"Identity changed. Reload before requesting a correction.");
    if (changes.nationalityCode) await assertActiveCountry(db,changes.nationalityCode);
    if ((await db.query("select 1 from student_identity_requests where student_id = $1 and status = 'requested'",[studentId])).rowCount) throw requestError(409,"An identity correction is already awaiting independent review.");
    await assertNoDuplicate(db,identity,{...identity.current,...changes});
    const row = (await db.query(`insert into student_identity_requests (student_id,identity_revision,current_snapshot,changes,reason,evidence_ref,channel,requested_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[studentId,identity.revision,JSON.stringify(identity.current),JSON.stringify(changes),input.reason.trim(),input.evidenceRef.trim(),channel,actor.accountId])).rows[0];
    await insertAudit(db,{actorId:actor.accountId,action:"registry.identity.requested",subjectType:"StudentIdentityRequest",subjectId:String(row.id),reason:input.reason,metadata:{studentId,channel,revision:identity.revision,fields:Object.keys(changes)}});
    return {id:row.id,status:"requested",fields:Object.keys(changes)};
  }
  return {
    async getStudentIdentity(programmeId,actor) {
      return withTransaction(pool,async (db) => {
        const programme = await studentForProgramme(db,programmeId,actor);
        return view(db,programme.studentId,actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
      });
    },
    async getOwnIdentity(actor) {
      return withTransaction(pool,async (db) => view(db,await ownStudentId(db,actor),actor,null));
    },
    async requestStudentIdentityCorrection(programmeId,input,actor) {
      return withTransaction(pool,async (db) => request(db,(await studentForProgramme(db,programmeId,actor)).studentId,input,actor,"staff"));
    },
    async requestOwnIdentityCorrection(input,actor) {
      return withTransaction(pool,async (db) => request(db,await ownStudentId(db,actor),input,actor,"self"));
    },
    async reviewStudentIdentityCorrection(programmeId,requestId,input,actor) {
      validateIdentityReview(input);
      return withTransaction(pool,async (db) => {
        const {studentId} = await studentForProgramme(db,programmeId,actor);
        const identity = await identityFor(db,studentId,true);
        const row = (await db.query(`${requestSelect} where id = $1 and student_id = $2 for update`,[requestId,studentId])).rows[0];
        if (!row) throw requestError(404,"Identity correction was not found.");
        if (row.status !== "requested") throw requestError(409,"Reviewed identity corrections are immutable.");
        assertSeparateApprover(row.requestedBy,actor);
        if (input.outcome === "approved") {
          if (row.revision !== identity.revision || !sameIdentity(row.currentSnapshot,identity.current)) throw requestError(409,"Identity changed after this request. Reject it and request a fresh correction.");
          const next = {...identity.current,...row.changes};
          if (row.changes.nationalityCode) await assertActiveCountry(db,next.nationalityCode);
          await assertNoDuplicate(db,identity,next);
          await db.query("update people set legal_name = $2,preferred_name = $3,updated_at = now() where id = $1",[identity.personId,next.legalName,next.preferredName]);
          await db.query(`insert into applicant_profiles (account_id,date_of_birth,nationality_code,updated_at) values ($1,$2,$3,now())
            on conflict (account_id) do update set date_of_birth = excluded.date_of_birth,nationality_code = excluded.nationality_code,updated_at = now()`,[identity.accountId,next.dateOfBirth,next.nationalityCode]);
          await db.query("update students set identity_revision = identity_revision + 1 where id = $1",[studentId]);
        }
        await db.query("update student_identity_requests set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[row.id,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`registry.identity.${input.outcome}`,subjectType:"StudentIdentityRequest",subjectId:String(row.id),reason:input.reason,metadata:{studentId,channel:row.channel,revision:row.revision,fields:Object.keys(row.changes)}});
        return {id:row.id,status:input.outcome,revision:identity.revision + (input.outcome === "approved" ? 1 : 0)};
      });
    }
  };
}
