import { createHash } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, requestError, withTransaction } from "../support.js";

export function validateDuplicateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["candidateStudentId","survivor","proposal","evidenceHash","reason","evidenceRef"].includes(key))
    || typeof input.candidateStudentId !== "string" || !input.candidateStudentId || !["current","candidate"].includes(input.survivor) || !["merge","distinct"].includes(input.proposal)
    || typeof input.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(input.evidenceHash)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"Choose the candidate, surviving record, merge or distinct proposal, current evidence, reason, and evidence reference.");
}

export function validateDuplicateReview(input) {
  if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"Choose approve/reject and provide a review reason.");
}

// The pair hash binds both identities, profiles, and programme states independent of which record is viewed first.
export function duplicateEvidenceHash(a,b) {
  const canonical = (student) => ({id:student.id,mergedInto:student.mergedInto ?? null,identityRevision:student.identityRevision,profileRevision:student.profileRevision,
    programmes:[...student.programmes].map(({id,status,statusRevision}) => ({id,status,statusRevision})).sort((x,y) => x.id.localeCompare(y.id))});
  return createHash("sha256").update(JSON.stringify([a,b].map(canonical).sort((x,y) => x.id.localeCompare(y.id)))).digest("hex");
}

export function mergeConflicts(survivor,duplicate,{openIdentity = false,sharedEnrolments = 0} = {}) {
  const conflicts = [];
  if (survivor.mergedInto || duplicate.mergedInto) conflicts.push("A record in this pair has already been merged.");
  if (openIdentity) conflicts.push("Resolve the open identity correction on either record first.");
  const active = (student) => student.programmes.filter((row) => row.status !== "transferred").map((row) => row.intakeId);
  if (active(duplicate).some((intakeId) => active(survivor).includes(intakeId))) conflicts.push("Both records hold an active programme in the same intake. Withdraw or transfer one first.");
  if (sharedEnrolments) conflicts.push("Both records are enrolled on the same course in the same period.");
  return conflicts;
}

async function summary(db,studentId) {
  const row = (await db.query(`select s.id,s.student_number as "studentNumber",s.merged_into_student_id as "mergedInto",s.identity_revision as "identityRevision",
    pe.legal_name as "legalName",to_char(ap.date_of_birth,'YYYY-MM-DD') as "dateOfBirth",coalesce(sp.revision,0) as "profileRevision"
    from students s join people pe on pe.id = s.person_id left join applicant_profiles ap on ap.account_id = s.account_id left join student_profiles sp on sp.student_id = s.id where s.id = $1`,[studentId])).rows[0];
  if (!row) return null;
  row.programmes = (await db.query(`select sp.id,sp.status,sp.status_revision as "statusRevision",sp.intake_id as "intakeId",i.label as "intakeLabel",p.code as "programmeCode"
    from student_programmes sp join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.student_id = $1 order by sp.created_at`,[studentId])).rows;
  return row;
}

function canAccess(actor,permission,student) {
  const scoped = {...actor,authorizingPermission:permission};
  return Boolean(student?.programmes.length) && student.programmes.every((row) => actorCanAccessScope(scoped,{programmeCode:row.programmeCode,intakeId:row.intakeId}));
}

async function routedStudent(db,programmeId,actor) {
  const programme = (await db.query(`select sp.student_id as "studentId",sp.intake_id as "intakeId",p.code as "programmeCode" from student_programmes sp
    join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1`,[programmeId])).rows[0];
  if (!programme) throw requestError(404,"Student programme was not found.");
  assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
  return programme.studentId;
}

async function lockStudents(db,ids) {
  for (const id of [...ids].sort()) await db.query("select id from students where id = $1 for update",[id]);
}

async function conflictsFor(db,survivor,duplicate) {
  const openIdentity = (await db.query("select 1 from student_identity_requests where student_id = any($1) and status = 'requested'",[[survivor.id,duplicate.id]])).rowCount > 0;
  const sharedEnrolments = (await db.query(`select 1 from course_enrolments a join course_enrolments b on b.academic_period_id = a.academic_period_id and b.course_id = a.course_id
    where a.student_id = $1 and b.student_id = $2 limit 1`,[duplicate.id,survivor.id])).rowCount;
  return mergeConflicts(survivor,duplicate,{openIdentity,sharedEnrolments});
}

const caseSelect = `select c.id,c.survivor_student_id as "survivorStudentId",c.duplicate_student_id as "duplicateStudentId",c.proposal,c.evidence_hash as "evidenceHash",
  c.reason,c.evidence_ref as "evidenceRef",c.requested_by as "requestedBy",c.requested_at as "requestedAt",c.status,c.reviewed_by as "reviewedBy",c.reviewed_at as "reviewedAt",
  c.review_reason as "reviewReason",c.merge_result as "mergeResult",ss.student_number as "survivorNumber",ds.student_number as "duplicateNumber"
  from student_duplicate_cases c join students ss on ss.id = c.survivor_student_id join students ds on ds.id = c.duplicate_student_id`;

export function createDuplicateResolutionModule(pool) {
  return {
    async getDuplicateContext(programmeId,filters,actor) {
      return withTransaction(pool,async (db) => {
        const current = await summary(db,await routedStudent(db,programmeId,actor));
        const lookup = typeof filters.studentNumber === "string" ? filters.studentNumber.trim() : "";
        const matches = (await db.query(`select s.id,
            (lower(pe.legal_name) = lower($2) and ap.date_of_birth is not null and ap.date_of_birth = $3::date) as "nameAndBirthDate",
            (coalesce(nullif(sp.phone,''),ap.phone) is not null and coalesce(nullif(sp.phone,''),ap.phone) in ($4,$5)) as phone,
            (s.student_number = $6) as "studentNumber"
          from students s join people pe on pe.id = s.person_id left join applicant_profiles ap on ap.account_id = s.account_id left join student_profiles sp on sp.student_id = s.id
          where s.id <> $1 and s.merged_into_student_id is null and (
            (lower(pe.legal_name) = lower($2) and ap.date_of_birth is not null and ap.date_of_birth = $3::date)
            or (coalesce(nullif(sp.phone,''),ap.phone) is not null and coalesce(nullif(sp.phone,''),ap.phone) in ($4,$5))
            or s.student_number = $6) order by s.student_number limit 25`,
          [current.id,current.legalName,current.dateOfBirth,...await currentPhones(db,current.id),lookup || null])).rows;
        const distinct = new Set((await db.query(`select survivor_student_id as a,duplicate_student_id as b from student_duplicate_cases where status = 'approved' and proposal = 'distinct'
          and $1 in (survivor_student_id,duplicate_student_id)`,[current.id])).rows.map((row) => row.a === current.id ? row.b : row.a));
        const candidates = [];
        for (const match of matches) {
          const candidate = await summary(db,match.id);
          if (!canAccess(actor,actor.authorizingPermission,candidate)) continue;
          if (distinct.has(candidate.id) && !match.studentNumber) continue;
          candidates.push({id:candidate.id,studentNumber:candidate.studentNumber,legalName:candidate.legalName,dateOfBirth:candidate.dateOfBirth,
            programmes:candidate.programmes.map(({programmeCode,intakeLabel,status}) => ({programmeCode,intakeLabel,status})),
            reasons:["nameAndBirthDate","phone","studentNumber"].filter((reason) => match[reason]),distinct:distinct.has(candidate.id),evidenceHash:duplicateEvidenceHash(current,candidate)});
        }
        const cases = (await db.query(`${caseSelect} where $1 in (c.survivor_student_id,c.duplicate_student_id) order by c.id desc`,[current.id])).rows;
        const capabilities = Object.fromEntries(["request","approve"].map((action) => [action,actor.permissions.includes(`registry.duplicate.${action}`) && canAccess(actor,`registry.duplicate.${action}`,current)]));
        return {studentId:current.id,studentNumber:current.studentNumber,candidates,cases,capabilities,accountId:actor.accountId};
      });
    },
    async requestDuplicateResolution(programmeId,input,actor) {
      validateDuplicateRequest(input);
      return withTransaction(pool,async (db) => {
        const currentId = await routedStudent(db,programmeId,actor);
        if (input.candidateStudentId === currentId) throw requestError(400,"A record cannot duplicate itself.");
        await lockStudents(db,[currentId,input.candidateStudentId]);
        const current = await summary(db,currentId),candidate = await summary(db,input.candidateStudentId);
        if (!canAccess(actor,"registry.duplicate.request",current)) throw requestError(403,"Your duplicate-resolution scope does not cover every programme of this student.");
        if (!candidate || candidate.mergedInto || !canAccess(actor,"registry.duplicate.request",candidate)) throw requestError(404,"Candidate student was not found.");
        if (current.mergedInto) throw requestError(409,"This student record has already been merged.");
        if (input.evidenceHash !== duplicateEvidenceHash(current,candidate)) throw requestError(409,"Student records changed. Reload before requesting duplicate resolution.");
        if ((await db.query("select 1 from student_duplicate_cases where status = 'requested' and (survivor_student_id = any($1) or duplicate_student_id = any($1))",[[current.id,candidate.id]])).rowCount) throw requestError(409,"A duplicate case for one of these records is already awaiting independent review.");
        const [survivor,duplicate] = input.survivor === "current" ? [current,candidate] : [candidate,current];
        if (input.proposal === "distinct" && (await db.query("select 1 from student_duplicate_cases where status = 'approved' and proposal = 'distinct' and least(survivor_student_id,duplicate_student_id) = least($1,$2) and greatest(survivor_student_id,duplicate_student_id) = greatest($1,$2)",[survivor.id,duplicate.id])).rowCount) throw requestError(409,"These records are already confirmed as distinct people.");
        if (input.proposal === "merge") {
          const conflicts = await conflictsFor(db,survivor,duplicate);
          if (conflicts.length) throw requestError(409,conflicts.join(" "));
        }
        const row = (await db.query(`insert into student_duplicate_cases (survivor_student_id,duplicate_student_id,proposal,evidence_hash,source_snapshot,reason,evidence_ref,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[survivor.id,duplicate.id,input.proposal,input.evidenceHash,JSON.stringify({survivor,duplicate}),input.reason.trim(),input.evidenceRef.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"registry.duplicate.requested",subjectType:"StudentDuplicateCase",subjectId:String(row.id),reason:input.reason,
          metadata:{proposal:input.proposal,survivorStudentId:survivor.id,duplicateStudentId:duplicate.id,evidenceHash:input.evidenceHash}});
        return {id:row.id,status:"requested",proposal:input.proposal};
      });
    },
    async reviewDuplicateResolution(programmeId,caseId,input,actor) {
      validateDuplicateReview(input);
      return withTransaction(pool,async (db) => {
        const currentId = await routedStudent(db,programmeId,actor);
        const found = (await db.query("select survivor_student_id as s,duplicate_student_id as d from student_duplicate_cases where id = $1 and $2 in (survivor_student_id,duplicate_student_id)",[caseId,currentId])).rows[0];
        if (!found) throw requestError(404,"Duplicate case was not found.");
        await lockStudents(db,[found.s,found.d]);
        const row = (await db.query(`${caseSelect} where c.id = $1 for update of c`,[caseId])).rows[0];
        if (row.status !== "requested") throw requestError(409,"Reviewed duplicate cases are immutable.");
        assertSeparateApprover(row.requestedBy,actor);
        const survivor = await summary(db,row.survivorStudentId),duplicate = await summary(db,row.duplicateStudentId);
        if (![survivor,duplicate].every((student) => canAccess(actor,"registry.duplicate.approve",student))) throw requestError(403,"Your duplicate-resolution scope does not cover every programme of both students.");
        let mergeResult = null;
        if (input.outcome === "approved") {
          if (duplicateEvidenceHash(survivor,duplicate) !== row.evidenceHash) throw requestError(409,"Student records changed after this request. Reject it and request a fresh review.");
          if (row.proposal === "merge") {
            const conflicts = await conflictsFor(db,survivor,duplicate);
            if (conflicts.length) throw requestError(409,conflicts.join(" "));
            const enrolments = await db.query("update course_enrolments set student_id = $2 where student_id = $1",[duplicate.id,survivor.id]);
            await db.query("update student_programmes set student_id = $2 where student_id = $1",[duplicate.id,survivor.id]);
            const programmeIds = duplicate.programmes.map((programme) => programme.id);
            await db.query("update student_registrations set revision = revision + 1 where student_programme_id = any($1) and status = 'draft'",[programmeIds]);
            await db.query("update students set merged_into_student_id = $2 where merged_into_student_id = $1",[duplicate.id,survivor.id]);
            await db.query("update students set merged_into_student_id = $2,merged_at = now() where id = $1",[duplicate.id,survivor.id]);
            mergeResult = {programmeIds,enrolments:enrolments.rowCount};
          }
        }
        await db.query("update student_duplicate_cases set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4,merge_result = $5 where id = $1",
          [row.id,input.outcome,actor.accountId,input.reason.trim(),mergeResult && JSON.stringify(mergeResult)]);
        await insertAudit(db,{actorId:actor.accountId,action:`registry.duplicate.${input.outcome}`,subjectType:"StudentDuplicateCase",subjectId:String(row.id),reason:input.reason,
          metadata:{proposal:row.proposal,survivorStudentId:survivor.id,duplicateStudentId:duplicate.id,evidenceHash:row.evidenceHash,...(mergeResult || {})}});
        return {id:row.id,status:input.outcome,proposal:row.proposal,mergeResult};
      });
    }
  };
}

async function currentPhones(db,studentId) {
  const row = (await db.query(`select nullif(sp.phone,'') as profile,ap.phone as applicant from students s left join student_profiles sp on sp.student_id = s.id
    left join applicant_profiles ap on ap.account_id = s.account_id where s.id = $1`,[studentId])).rows[0];
  return [row?.profile || row?.applicant || null,row?.applicant || row?.profile || null];
}
