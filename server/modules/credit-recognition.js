import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { loadCurriculum } from "./curriculum.js";
import { creditEvidenceHash, loadCreditRecognitions, validateCreditSource } from "./credit-evidence.js";

async function programmeFor(db,id,actor,own = false,lock = false) {
  const row = (await db.query(`select sp.id,sp.student_id as "studentId",sp.programme_version_id as "programmeVersionId",sp.intake_id as "intakeId",sp.status_revision as revision,
    s.account_id as "accountId",p.code as "programmeCode" from student_programmes sp join students s on s.id = sp.student_id
    join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}
function reason(input) {
  if (!input || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"A reason of 1-2000 characters is required.");
}
async function evidenceFor(db,programme,input,actor) {
  if (!(await db.query("select 1 from programme_versions where id = $1 and status in ('published','retired') for share",[programme.programmeVersionId])).rowCount) throw requestError(409,"Recognition requires a published pinned curriculum.");
  await db.query("select id from courses where id = $1 for share",[input.courseId]);
  const course = (await loadCurriculum(db,programme.programmeVersionId)).find((row) => row.courseId === input.courseId);
  if (!course) throw requestError(400,"The target course must belong to the pinned curriculum.");
  const policy = (await db.query(`select id,programme_version_id as "programmeVersionId",status,rules,to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",
    to_char(effective_to,'YYYY-MM-DD') as "effectiveTo" from academic_policies where id = $1 for share`,[input.policyId])).rows[0];
  if (!policy || policy.programmeVersionId !== programme.programmeVersionId || policy.status !== "published" || policy.rules.recognisedCredits !== true || !policy.effectiveFrom || policy.effectiveFrom > todayIso() || policy.effectiveTo && policy.effectiveTo < todayIso()) throw requestError(409,"Use a published curriculum policy that explicitly permits recognized credit and is currently effective.");
  if ((await db.query(`select 1 from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id where sr.student_programme_id = $1 and ce.course_id = $2 and ce.withdrawn_at is null`,[programme.id,input.courseId])).rowCount) throw requestError(409,"Attempted courses require a formal result/credit correction, not new recognition.");
  let source = input.source;
  if (input.kind === "internal_transfer") {
    const row = (await db.query(`select sr.student_programme_id as "programmeId",sp.student_id as "studentId",sp.intake_id as "intakeId",p.code as "programmeCode",ar.result_snapshot as result,rb.id as "batchId",
      coalesce(sr.confirmation->>'endsOn',to_char(ap.ends_on,'YYYY-MM-DD')) as "completedOn" from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id
      join student_programmes sp on sp.id = sr.student_programme_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
      join registration_periods rp on rp.id = sr.period_id join academic_periods ap on ap.id = rp.academic_period_id
      join academic_results ar on ar.registration_id = ce.registration_id and ar.course_id = ce.course_id join result_batches rb on rb.id = ar.batch_id and rb.status = 'published'
      where ce.registration_id = $1 and ce.course_id = $2`,[source.registrationId,source.courseId])).rows[0];
    if (!row || row.studentId !== programme.studentId || row.programmeId === programme.id) throw requestError(404,"A published source from another programme of this student was not found.");
    assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
    if (!row.result.passing || row.completedOn > todayIso()) throw requestError(409,"Internal transfer requires a published passing result from a completed source period.");
    source = {...source,...row,credits:row.result.credits};
  }
  if (source.credits < Number(course.credits)) throw requestError(409,"Source credits cannot be smaller than the target course's pinned credits.");
  const snapshot = {programmeId:programme.id,programmeVersionId:programme.programmeVersionId,statusRevision:programme.revision,course,policy,kind:input.kind,source};
  return {snapshot,evidenceHash:creditEvidenceHash(snapshot),credits:Number(course.credits),completedOn:source.completedOn};
}
export function createCreditRecognitionModule(pool) {
  return {
    async getCreditRecognitionContext(id,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,own);
        const sources = own ? [] : (await db.query(`select ce.registration_id as "registrationId",ce.course_id as "courseId",ar.result_snapshot->>'code' as code,(ar.result_snapshot->>'credits')::float as credits,
          p.code as "programmeCode",sp.intake_id as "intakeId",coalesce(sr.confirmation->>'endsOn',to_char(ap.ends_on,'YYYY-MM-DD')) as "completedOn"
          from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join student_programmes sp on sp.id = sr.student_programme_id
          join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id join registration_periods rp on rp.id = sr.period_id join academic_periods ap on ap.id = rp.academic_period_id
          join academic_results ar on ar.registration_id = ce.registration_id and ar.course_id = ce.course_id join result_batches rb on rb.id = ar.batch_id
          where sp.student_id = $1 and sp.id <> $2 and rb.status = 'published' and ar.result_snapshot->>'passing' = 'true' order by ce.registration_id,ce.course_id`,[programme.studentId,id])).rows
          .filter((row) => row.completedOn <= todayIso() && ["request","approve"].some((action) => actor.permissions.includes(`registry.credit.${action}`)
            && actorCanAccessScope({...actor,authorizingPermission:`registry.credit.${action}`},{programmeCode:row.programmeCode,intakeId:row.intakeId})));
        return {programmeId:id,accountId:actor.accountId,curriculum:await loadCurriculum(db,programme.programmeVersionId),recognitions:await loadCreditRecognitions(db,id),
          sources,
          policies:own ? [] : (await db.query("select id,name,version from academic_policies where programme_version_id = $1 and status = 'published' and rules->>'recognisedCredits' = 'true' order by code,version desc",[programme.programmeVersionId])).rows,
          capabilities:Object.fromEntries(["request","approve"].map((action) => [action,!own && actor.permissions.includes(`registry.credit.${action}`)
            && actorCanAccessScope({...actor,authorizingPermission:`registry.credit.${action}`},{programmeCode:programme.programmeCode,intakeId:programme.intakeId})]))};
      });
    },
    async requestCreditRecognition(id,input,actor) {
      reason(input);
      if (Object.keys(input).some((key) => !["courseId","policyId","kind","source","reason","evidenceRef","expiresOn"].includes(key)) || !input.courseId || !input.policyId
        || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300 || !input.expiresOn) throw requestError(400,"Provide target course, policy, source evidence, and request expiry.");
      const source = validateCreditSource(input.kind,input.source),expiresOn = parseEffectiveDate(input.expiresOn);
      if (expiresOn < todayIso()) throw requestError(400,"Recognition request cannot already be expired.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const evidence = await evidenceFor(db,programme,{...input,source},actor);
        const requests = await loadCreditRecognitions(db,id);
        if (requests.some((row) => ["requested","approved"].includes(row.status) && (row.courseId === input.courseId || input.kind === "internal_transfer" && row.source.registrationId === source.registrationId && row.source.courseId === source.courseId || input.kind !== "internal_transfer" && row.kind !== "internal_transfer" && row.source.reference === source.reference))) throw requestError(409,"This course or source credit already has an active recognition request/approval.");
        const result = (await db.query(`insert into credit_recognitions (student_programme_id,programme_version_id,course_id,policy_id,kind,source_registration_id,source_course_id,source,credits,completed_on,evidence_hash,source_snapshot,reason,evidence_ref,expires_on,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,[id,programme.programmeVersionId,input.courseId,input.policyId,input.kind,input.kind === "internal_transfer" ? source.registrationId : null,input.kind === "internal_transfer" ? source.courseId : null,
          JSON.stringify(source),evidence.credits,evidence.completedOn,evidence.evidenceHash,JSON.stringify(evidence.snapshot),input.reason.trim(),input.evidenceRef.trim(),expiresOn,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"registry.credit.requested",subjectType:"CreditRecognition",subjectId:String(result.id),reason:input.reason,metadata:{programmeId:id,courseId:input.courseId,kind:input.kind,credits:evidence.credits,evidenceHash:evidence.evidenceHash}});
        return result;
      });
    },
    async reviewCreditRecognition(id,recognitionId,input,actor) {
      reason(input);
      if (Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected","revoked"].includes(input.outcome)) throw requestError(400,"Choose approve, reject, or revoke.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const row = (await loadCreditRecognitions(db,id)).find((entry) => String(entry.id) === String(recognitionId));
        if (!row) throw requestError(404,"Credit recognition was not found.");
        assertSeparateApprover(row.requestedBy,actor);
        if (input.outcome === "revoked") {
          if (row.status !== "approved") throw requestError(409,"Only approved credit may be revoked.");
          if ((await db.query(`select 1 from student_registrations sr,jsonb_array_elements(coalesce(sr.confirmation->'academicEvidence'->'recognitions','[]'::jsonb)) r
            where sr.student_programme_id = $1 and r->>'id' = $2`,[id,String(row.id)])).rowCount) throw requestError(409,"Credit used by confirmed registration requires formal correction, not revocation.");
          await db.query("update credit_recognitions set status = 'revoked',revoked_by = $2,revoked_at = now(),revoke_reason = $3 where id = $1",[row.id,actor.accountId,input.reason.trim()]);
        } else {
          if (row.status !== "requested") throw requestError(409,"Reviewed recognitions cannot be rewritten.");
          if (input.outcome === "approved") {
            const evidence = await evidenceFor(db,programme,{courseId:row.courseId,policyId:row.policyId,kind:row.kind,source:row.source},actor);
            if (row.expiresOn < todayIso() || evidence.evidenceHash !== row.evidenceHash) throw requestError(409,"Recognition evidence is stale or expired. Request a fresh review.");
          }
          await db.query("update credit_recognitions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[row.id,input.outcome,actor.accountId,input.reason.trim()]);
        }
        await insertAudit(db,{actorId:actor.accountId,action:`registry.credit.${input.outcome}`,subjectType:"CreditRecognition",subjectId:String(row.id),reason:input.reason,metadata:{programmeId:id,courseId:row.courseId,credits:row.credits,evidenceHash:row.evidenceHash}});
        return {id:row.id,status:input.outcome};
      });
    }
  };
}
