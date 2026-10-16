import { createHash, randomUUID } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { onboardingReadiness } from "./registry.js";

const transitions = {onboarded:["suspended","interrupted","withdrawn"],suspended:["onboarded","withdrawn"],interrupted:["onboarded","withdrawn"],withdrawn:["onboarded"]};
export function lifecycleTargets(status) {return transitions[status] || [];}
export function validateLifecycleRequest(input,status,today = todayIso()) {
  if (!input || Object.keys(input).some((key) => !["toStatus","revision","evidenceHash","reason","evidenceRef","expiresOn","reviewOn"].includes(key))
    || !Number.isInteger(input.revision) || input.revision < 0 || typeof input.evidenceHash !== "string"
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300 || !input.expiresOn) throw requestError(400,"Provide current status revision/evidence, reason, evidence reference, and request expiry.");
  if (!lifecycleTargets(status).includes(input.toStatus)) throw requestError(409,"This programme lifecycle transition is not allowed.");
  const expiresOn = parseEffectiveDate(input.expiresOn);
  if (expiresOn < today) throw requestError(400,"A lifecycle request cannot already be expired.");
  let reviewOn = null;
  if (["suspended","interrupted"].includes(input.toStatus)) {
    if (!input.reviewOn) throw requestError(400,"Suspension/interruption requires a follow-up review date.");
    reviewOn = parseEffectiveDate(input.reviewOn);
    if (reviewOn < today) throw requestError(400,"The follow-up review date cannot be in the past.");
  } else if (input.reviewOn != null && input.reviewOn !== "") throw requestError(400,"Only suspension/interruption specifies a follow-up date.");
  return {expiresOn,reviewOn};
}

export function lifecycleEvidenceHash(source) {
  return createHash("sha256").update(JSON.stringify({...source,registrations:[...source.registrations].sort((a,b) => a.id.localeCompare(b.id))})).digest("hex");
}
export function validateLifecycleReview(input) {
  if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"Choose approve/reject and provide a review reason.");
}

async function contextFor(db,id,actor,own = false,lock = false) {
  const programme = (await db.query(`select sp.id,sp.student_id as "studentId",sp.status,sp.status_revision as revision,sp.intake_id as "intakeId",sp.programme_version_id as "programmeVersionId",
    s.account_id as "accountId",p.code as "programmeCode" from student_programmes sp join students s on s.id = sp.student_id
    join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!programme || own && programme.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:programme.programmeCode,intakeId:programme.intakeId});
  if (lock) await db.query("select id from students where id = $1 for update",[programme.studentId]);
  const profile = (await db.query("select revision,phone,address,next_of_kin as \"nextOfKin\" from student_profiles where student_id = $1",[programme.studentId])).rows[0];
  const readiness = onboardingReadiness(profile);
  const registrations = (await db.query(`select id,period_id as "periodId",status,revision,selected_courses as "selectedCourses",reference_number as "referenceNumber"
    from student_registrations where student_programme_id = $1 order by id`,[id])).rows;
  const source = {programmeId:id,status:programme.status,revision:programme.revision,intakeId:programme.intakeId,programmeVersionId:programme.programmeVersionId,
    profileRevision:profile?.revision || 0,profileComplete:readiness.complete,registrations};
  return {programme,source,readiness,evidenceHash:lifecycleEvidenceHash(source)};
}
const requestSelect = `select id,from_status as "fromStatus",to_status as "toStatus",status_revision as revision,evidence_hash as "evidenceHash",status,
  reason,evidence_ref as "evidenceRef",requested_by as "requestedBy",reviewed_by as "reviewedBy",review_reason as "reviewReason",requested_at as "requestedAt",reviewed_at as "reviewedAt",
  to_char(expires_on,'YYYY-MM-DD') as "expiresOn",to_char(review_on,'YYYY-MM-DD') as "reviewOn" from programme_lifecycle_requests`;

export function createProgrammeLifecycleModule(pool) {
  return {
    async getProgrammeLifecycle(id,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const context = await contextFor(db,id,actor,own);
        const requests = (await db.query(`${requestSelect} where student_programme_id = $1 order by id desc`,[id])).rows;
        const history = (await db.query(`select from_status as "fromStatus",to_status as "toStatus",reason,effective_at as "effectiveAt",lifecycle_request_id as "requestId"
          from student_programme_history where student_programme_id = $1 order by effective_at,id`,[id])).rows;
        const capabilities = Object.fromEntries(["request","approve"].map((action) => [action,!own && actor.permissions.includes(`registry.lifecycle.${action}`)
          && actorCanAccessScope({...actor,authorizingPermission:`registry.lifecycle.${action}`},{programmeCode:context.programme.programmeCode,intakeId:context.programme.intakeId})]));
        return {programmeId:id,status:context.programme.status,revision:context.programme.revision,evidenceHash:context.evidenceHash,readiness:context.readiness,
          targets:lifecycleTargets(context.programme.status),requests,history,capabilities,accountId:actor.accountId};
      });
    },
    async requestProgrammeLifecycle(id,input,actor) {
      return withTransaction(pool,async (db) => {
        const context = await contextFor(db,id,actor,false,true);
        const {expiresOn,reviewOn} = validateLifecycleRequest(input,context.programme.status);
        if (input.revision !== context.programme.revision || input.evidenceHash !== context.evidenceHash) throw requestError(409,"Programme evidence changed. Reload before requesting a lifecycle change.");
        if (input.toStatus === "onboarded" && !context.readiness.complete) throw requestError(409,"Re-entry requires a complete student profile.");
        if ((await db.query("select 1 from programme_lifecycle_requests where student_programme_id = $1 and status = 'requested' and evidence_hash = $2 and expires_on >= $3::date",[id,context.evidenceHash,todayIso()])).rowCount) throw requestError(409,"A current lifecycle request is already awaiting independent review.");
        const request = (await db.query(`insert into programme_lifecycle_requests (student_programme_id,from_status,to_status,status_revision,evidence_hash,source_snapshot,reason,evidence_ref,expires_on,review_on,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,[id,context.programme.status,input.toStatus,input.revision,input.evidenceHash,JSON.stringify(context.source),input.reason.trim(),input.evidenceRef.trim(),expiresOn,reviewOn,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"registry.lifecycle.requested",subjectType:"ProgrammeLifecycleRequest",subjectId:String(request.id),reason:input.reason,metadata:{programmeId:id,fromStatus:context.programme.status,toStatus:input.toStatus,revision:input.revision,evidenceHash:input.evidenceHash}});
        return request;
      });
    },
    async reviewProgrammeLifecycle(id,requestId,input,actor) {
      validateLifecycleReview(input);
      return withTransaction(pool,async (db) => {
        const context = await contextFor(db,id,actor,false,true);
        const request = (await db.query(`${requestSelect} where id = $1 and student_programme_id = $2 for update`,[requestId,id])).rows[0];
        if (!request) throw requestError(404,"Lifecycle request was not found.");
        if (request.status !== "requested") throw requestError(409,"Reviewed lifecycle requests are immutable.");
        assertSeparateApprover(request.requestedBy,actor);
        if (input.outcome === "approved") {
          if (request.revision !== context.programme.revision || request.evidenceHash !== context.evidenceHash || request.expiresOn < todayIso()
            || request.reviewOn && request.reviewOn < todayIso() || !lifecycleTargets(context.programme.status).includes(request.toStatus)) throw requestError(409,"Lifecycle evidence is stale, expired, or no longer eligible. Request a fresh review.");
          if (request.toStatus === "onboarded" && !context.readiness.complete) throw requestError(409,"Re-entry requires a complete student profile.");
          await db.query("update student_programmes set status = $2,status_revision = status_revision + 1 where id = $1",[id,request.toStatus]);
          await db.query("update student_registrations set revision = revision + 1 where student_programme_id = $1 and status = 'draft'",[id]);
          await db.query(`insert into student_programme_history (id,student_programme_id,from_status,to_status,reason,actor_id,lifecycle_request_id) values ($1,$2,$3,$4,$5,$6,$7)`,
            [`sph_${randomUUID()}`,id,request.fromStatus,request.toStatus,input.reason.trim(),actor.accountId,request.id]);
        }
        await db.query("update programme_lifecycle_requests set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[request.id,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`registry.lifecycle.${input.outcome}`,subjectType:"ProgrammeLifecycleRequest",subjectId:String(request.id),reason:input.reason,metadata:{programmeId:id,fromStatus:request.fromStatus,toStatus:request.toStatus,evidenceHash:request.evidenceHash}});
        return {id:request.id,status:input.outcome,programmeStatus:input.outcome === "approved" ? request.toStatus : context.programme.status};
      });
    }
  };
}
