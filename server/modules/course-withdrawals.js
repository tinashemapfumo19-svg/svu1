import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, requestError, withTransaction } from "../support.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
const requestSelect = `select w.id::int,w.registration_id as "registrationId",w.course_id as "courseId",c.code,c.title,sr.period_id as "periodId",w.reason,w.evidence_ref as "evidenceRef",w.status,
  w.requested_by as "requestedBy",w.requested_at as "requestedAt",w.reviewed_by as "reviewedBy",w.reviewed_at as "reviewedAt",w.review_reason as "reviewReason"
  from course_withdrawal_requests w join courses c on c.id = w.course_id join student_registrations sr on sr.id = w.registration_id`;

// Any result evidence closes withdrawal: an official result, or the course in a result batch that is not rejected.
async function resultEvidence(db,registrationId,courseId) {
  const official = (await db.query("select 1 from academic_results where registration_id = $1 and course_id = $2",[registrationId,courseId])).rowCount;
  const batched = (await db.query(`select 1 from result_batches rb join student_registrations sr on sr.period_id = rb.period_id where sr.id = $1 and rb.status <> 'rejected'
    and exists (select 1 from jsonb_array_elements(rb.rows) r where r->>'registrationId' = $1 and r->>'courseId' = $2)`,[registrationId,courseId])).rowCount;
  return Boolean(official || batched);
}

export function createCourseWithdrawalsModule(pool) {
  async function programmeFor(db,id,actor,own) {
    const row = (await db.query(`select sp.id,sp.intake_id as "intakeId",p.code as "programmeCode",s.account_id as "accountId" from student_programmes sp join students s on s.id = sp.student_id
      join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 for update of sp`,[id])).rows[0];
    if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
    if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
    return row;
  }
  async function enrolmentFor(db,programmeId,periodId,courseId) {
    const row = (await db.query(`select ce.registration_id as "registrationId",ce.course_id as "courseId",ce.withdrawn_at as "withdrawnAt",sr.status as "registrationStatus"
      from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id where sr.student_programme_id = $1 and sr.period_id = $2 and ce.course_id = $3 for update of ce`,[programmeId,periodId,courseId])).rows[0];
    if (!row || row.registrationStatus !== "confirmed") throw requestError(404,"No confirmed enrolment in this course for the period.");
    return row;
  }
  return {
    async listCourseWithdrawals(programmeId,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,programmeId,actor,own);
        const requests = (await db.query(`${requestSelect} where w.student_programme_id = $1 order by w.id desc`,[programmeId])).rows;
        const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
        const can = (permission) => !own && actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
        return {requests,accountId:actor.accountId,capabilities:{request:own || can("registry.exception.request"),approve:can("registry.exception.approve")}};
      });
    },
    // Students request for themselves; scoped registry staff can request on their behalf.
    async requestCourseWithdrawal(programmeId,periodId,input,actor,own = false) {
      if (!input || Object.keys(input).some((key) => !["courseId","reason","evidenceRef"].includes(key)) || !text(input.courseId,200) || !text(input.reason,2000)
        || (input.evidenceRef !== undefined && input.evidenceRef !== null && !text(input.evidenceRef,300))) throw requestError(400,"Provide the course and a reason, with an optional evidence reference.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,own);
        const enrolment = await enrolmentFor(db,programmeId,periodId,input.courseId);
        if (enrolment.withdrawnAt) throw requestError(409,"This course has already been withdrawn.");
        if ((await db.query("select 1 from course_withdrawal_requests where registration_id = $1 and course_id = $2 and status = 'requested'",[enrolment.registrationId,input.courseId])).rowCount) throw requestError(409,"A withdrawal is already awaiting review for this course.");
        if (await resultEvidence(db,enrolment.registrationId,input.courseId)) throw requestError(409,"This course already has result evidence, so it cannot be withdrawn under current policy (D-18).");
        const row = (await db.query(`insert into course_withdrawal_requests (registration_id,course_id,student_programme_id,reason,evidence_ref,requested_by) values ($1,$2,$3,$4,$5,$6) returning id::int`,
          [enrolment.registrationId,input.courseId,programmeId,input.reason.trim(),input.evidenceRef?.trim() || null,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"registry.withdrawal.requested",subjectType:"CourseWithdrawal",subjectId:String(row.id),reason:input.reason,metadata:{programmeId,periodId,courseId:input.courseId,own}});
        return (await db.query(`${requestSelect} where w.id = $1`,[row.id])).rows[0];
      });
    },
    // Approval re-checks the evidence rule and marks the enrolment withdrawn; nothing else in the record changes.
    async reviewCourseWithdrawal(programmeId,requestId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        await programmeFor(db,programmeId,actor,false);
        const request = (await db.query(`${requestSelect} where w.id = $1 and w.student_programme_id = $2 for update of w`,[requestId,programmeId])).rows[0];
        if (!request) throw requestError(404,"Withdrawal request was not found.");
        if (request.status !== "requested") throw requestError(409,"Only requested withdrawals can be reviewed.");
        if (request.requestedBy === actor.accountId) throw requestError(403,"A withdrawal must be approved by someone other than its requester.");
        if (input.outcome === "approved") {
          const enrolment = await enrolmentFor(db,programmeId,request.periodId,request.courseId);
          if (enrolment.withdrawnAt) throw requestError(409,"This course has already been withdrawn.");
          if (await resultEvidence(db,request.registrationId,request.courseId)) throw requestError(409,"Result evidence now exists for this course; reject this request.");
          await db.query("update course_enrolments set withdrawn_at = now(),withdrawal_request_id = $3 where registration_id = $1 and course_id = $2",[request.registrationId,request.courseId,requestId]);
        }
        await db.query("update course_withdrawal_requests set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[requestId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`registry.withdrawal.${input.outcome}`,subjectType:"CourseWithdrawal",subjectId:String(requestId),reason:input.reason,metadata:{programmeId,courseId:request.courseId}});
        return (await db.query(`${requestSelect} where w.id = $1`,[requestId])).rows[0];
      });
    }
  };
}
