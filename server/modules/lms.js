import { createHash } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, insertAudit, requestError, todayIso, withTransaction } from "../support.js";
import { createResultsModule, resultsChecksum } from "./results.js";

const lmsRoles = {lead:"editingteacher",co_lecturer:"editingteacher",tutor:"teacher",moderator:"moderator",examiner:"examiner"};
const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;

export function outcomeChecksum(rows) {
  return createHash("sha256").update(JSON.stringify([...rows].map(({studentNumber,mark}) => [studentNumber,mark]).sort((a,b) => a[0].localeCompare(b[0])))).digest("hex");
}

export function offeringVersion(offering) {
  const stable = {...offering,teachers:[...offering.teachers].sort((a,b) => a.employeeNumber.localeCompare(b.employeeNumber) || a.role.localeCompare(b.role)),
    students:[...offering.students].sort((a,b) => a.studentNumber.localeCompare(b.studentNumber))};
  delete stable.version;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function validateOutcomes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["offeringKey","externalRef","rows","checksum"].includes(key))
    || !/^[^:]+:[^:]+$/.test(input.offeringKey ?? "") || !text(input.externalRef,200) || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 2000 || typeof input.checksum !== "string") {
    throw requestError(400,"Provide the offering key, external batch reference, 1-2000 outcome rows, and checksum.");
  }
  const seen = new Set();
  for (const row of input.rows) {
    if (!row || Object.keys(row).some((key) => !["studentNumber","mark"].includes(key)) || !/^S\d{8}$/.test(row.studentNumber ?? "") || !Number.isInteger(row.mark) || row.mark < 0 || row.mark > 100) {
      throw requestError(400,"Each outcome needs a student number and a whole-number mark from 0-100.");
    }
    if (seen.has(row.studentNumber)) throw requestError(400,`${row.studentNumber} appears more than once.`);
    seen.add(row.studentNumber);
  }
  if (outcomeChecksum(input.rows) !== input.checksum) throw requestError(409,"The outcome checksum does not match the rows.");
  const [periodId,courseId] = input.offeringKey.split(":");
  return {periodId,courseId};
}

// Teachers come from approved allocations in force today held by active staff; students from confirmed enrolments.
async function offeringManifest(db,period,offering,today) {
  const teachers = (await db.query(`select m.employee_number as "employeeNumber",m.email,coalesce(pe.legal_name,m.legal_name) as name,a.role
    from teaching_allocations a join staff_members m on m.id = a.staff_id left join accounts ac on ac.id = m.account_id left join people pe on pe.id = ac.person_id
    where a.period_id = $1 and a.course_id = $2 and a.status = 'active' and m.status = 'active' and a.effective_from <= $3::date and (a.effective_to is null or a.effective_to >= $3::date)
    order by m.employee_number,a.role`,[period.id,offering.courseId,today])).rows.map((row) => ({...row,lmsRole:lmsRoles[row.role]}));
  const students = (await db.query(`select s.student_number as "studentNumber",ac.email,pe.legal_name as name from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id
    join students s on s.id = ce.student_id join accounts ac on ac.id = s.account_id join people pe on pe.id = s.person_id
    where sr.period_id = $1 and ce.course_id = $2 and sr.status = 'confirmed' and ce.withdrawn_at is null order by s.student_number`,[period.id,offering.courseId])).rows;
  const entry = {offeringKey:`${period.id}:${offering.courseId}`,courseCode:offering.code,courseTitle:offering.title,programmeCode:period.programmeCode,intakeLabel:period.intakeLabel,
    periodName:period.name,startsOn:period.startsOn,endsOn:period.endsOn,registrationStatus:period.status,teachers,students};
  return {...entry,version:offeringVersion(entry)};
}

async function rosterFor(db,periodId,courseId = null) {
  return (await db.query(`select ce.registration_id as "registrationId",ce.course_id as "courseId",s.student_number as "studentNumber",sr.student_programme_id as "programmeId"
    from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join students s on s.id = ce.student_id
    where sr.period_id = $1 and sr.status = 'confirmed' and ce.withdrawn_at is null ${courseId ? "and ce.course_id = $2" : ""} order by s.student_number,ce.course_id`,courseId ? [periodId,courseId] : [periodId])).rows;
}

export function reconcileOutcomeRoster(rows,roster) {
  const expected = new Set(roster.map((row) => row.studentNumber));
  const missing = [...expected].filter((number) => !rows.some((row) => row.studentNumber === number));
  const extra = rows.filter((row) => !expected.has(row.studentNumber)).map((row) => row.studentNumber);
  if (missing.length || extra.length) throw requestError(409,`Outcomes must cover the confirmed class list exactly once.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${extra.length ? ` Not enrolled: ${extra.join(", ")}.` : ""}`);
}

const periodSelect = `select rp.id,rp.intake_id as "intakeId",rp.status,ap.name,to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn",
  p.code as "programmeCode",i.label as "intakeLabel" from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id`;
const batchSelect = `select b.id::int,b.period_id as "periodId",b.course_id as "courseId",c.code,c.title,b.external_ref as "externalRef",b.checksum,b.row_count as "rowCount",b.rows,b.status,
  b.received_at as "receivedAt",b.reviewed_by as "reviewedBy",b.review_reason as "reviewReason",b.result_batch_id as "resultBatchId" from lms_outcome_batches b join courses c on c.id = b.course_id`;

export function createLmsModule(pool) {
  const results = createResultsModule(pool);
  async function periodStatus(db,period) {
    const offerings = (await db.query("select o.course_id as \"courseId\",c.code,c.title from registration_offerings o join courses c on c.id = o.course_id where o.period_id = $1 order by c.code",[period.id])).rows;
    const batches = (await db.query(`${batchSelect} where b.period_id = $1 order by b.id desc`,[period.id])).rows;
    const roster = await rosterFor(db,period.id);
    // A superseded native submission must receive fresh approval, not fall back to older LMS outcomes.
    const assessed = (await db.query(`select distinct on (p.course_id) s.id::int,p.course_id as "courseId",s.status,s.finals,s.result_batch_id as "resultBatchId" from assessment_submissions s
      join assessment_plans p on p.id = s.plan_id where p.period_id = $1 and p.status = 'approved' and s.status in ('submitted','approved','transferred','superseded') order by p.course_id,s.id desc`,[period.id])).rows;
    const courses = offerings.map((offering) => {
      const own = batches.filter((row) => row.courseId === offering.courseId);
      const enrolled = roster.filter((row) => row.courseId === offering.courseId).length;
      const assessment = assessed.find((row) => row.courseId === offering.courseId) || null;
      const live = own.find((row) => ["received","accepted","transferred"].includes(row.status)) || null;
      const deferred = assessment ? assessment.finals.filter((row) => row.state !== "final").length : 0;
      const source = assessment ? "assessment" : live ? "lms" : null;
      const ready = assessment ? assessment.status === "approved" && !deferred : live?.status === "accepted";
      const transferred = assessment ? assessment.status === "transferred" : live?.status === "transferred";
      return {...offering,enrolled,batches:own,live,assessment,source,deferred,ready,transferred};
    }).filter((row) => row.enrolled || row.batches.length || row.assessment);
    return {period,courses,readyToTransfer:courses.length > 0 && courses.every((row) => row.ready),transferred:courses.length > 0 && courses.every((row) => row.transferred)};
  }
  return {
    async lmsManifest(actor,filters = {}) {
      return withTransaction(pool,async (db) => {
        const today = todayIso();
        // Workspaces stay provisioned until the period's official results are published.
        const periods = (await db.query(`${periodSelect} where rp.status in ('open','closed') and not exists (select 1 from result_batches rb where rb.period_id = rp.id and rb.status = 'published')
          order by ap.starts_on,p.code`)).rows;
        const offerings = [];
        for (const period of periods) {
          for (const offering of (await db.query("select o.course_id as \"courseId\",c.code,c.title from registration_offerings o join courses c on c.id = o.course_id where o.period_id = $1 order by c.code",[period.id])).rows) {
            const entry = await offeringManifest(db,period,offering,today);
            if (!filters.offeringKey || filters.offeringKey === entry.offeringKey) offerings.push(entry);
          }
        }
        await insertAudit(db,{actorId:actor.accountId,action:"lms.manifest.read",subjectType:"LmsManifest",subjectId:today,reason:"LMS connector provisioning read",metadata:{offerings:offerings.length}});
        return {schemaVersion:1,generatedAt:new Date().toISOString(),offerings};
      });
    },
    async receiveLmsOutcomes(input,actor) {
      const {periodId,courseId} = validateOutcomes(input);
      return withTransaction(pool,async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`lms-outcome:${input.offeringKey}`]);
        const existing = (await db.query(`${batchSelect} where b.external_ref = $1`,[input.externalRef.trim()])).rows[0];
        if (existing) {
          if (existing.checksum !== input.checksum || `${existing.periodId}:${existing.courseId}` !== input.offeringKey) throw requestError(409,"This external batch reference was already used for different outcomes.");
          return {id:existing.id,status:existing.status,replayed:true};
        }
        if (!(await db.query("select 1 from registration_offerings where period_id = $1 and course_id = $2",[periodId,courseId])).rowCount) throw requestError(404,"Offering was not found.");
        if ((await db.query("select 1 from lms_outcome_batches where period_id = $1 and course_id = $2 and status in ('received','accepted','transferred')",[periodId,courseId])).rowCount) {
          throw requestError(409,"Outcomes for this offering are already awaiting review or accepted. Ask SVU to reject them before resending.");
        }
        reconcileOutcomeRoster(input.rows,await rosterFor(db,periodId,courseId));
        const row = (await db.query(`insert into lms_outcome_batches (period_id,course_id,external_ref,checksum,row_count,rows,received_by) values ($1,$2,$3,$4,$5,$6,$7) returning id::int`,
          [periodId,courseId,input.externalRef.trim(),input.checksum,input.rows.length,JSON.stringify(input.rows),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"lms.outcomes.received",subjectType:"LmsOutcomeBatch",subjectId:String(row.id),reason:"LMS course outcomes returned",
          metadata:{offeringKey:input.offeringKey,externalRef:input.externalRef.trim(),rowCount:input.rows.length,checksum:input.checksum}});
        return {id:row.id,status:"received",replayed:false};
      });
    },
    async listLmsOutcomes(actor) {
      return withTransaction(pool,async (db) => {
        const periods = (await db.query(`${periodSelect} where rp.id in (select period_id from lms_outcome_batches union select p.period_id from assessment_submissions s join assessment_plans p on p.id = s.plan_id where s.status in ('submitted','approved','transferred','superseded'))
          order by ap.starts_on desc`)).rows
          .filter((period) => actorCanAccessScope(actor,{programmeCode:period.programmeCode,intakeId:period.intakeId}));
        const statuses = [];
        for (const period of periods) statuses.push(await periodStatus(db,period));
        return {periods:statuses,accountId:actor.accountId};
      });
    },
    async reviewLmsOutcomes(batchId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["accepted","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose accept or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        const batch = (await db.query(`${batchSelect} where b.id = $1`,[batchId])).rows[0];
        if (!batch) throw requestError(404,"Outcome batch was not found.");
        const period = (await db.query(`${periodSelect} where rp.id = $1`,[batch.periodId])).rows[0];
        assertActorCanAccessScope(actor,{programmeCode:period.programmeCode,intakeId:period.intakeId});
        const current = (await db.query("select status,received_by as \"receivedBy\" from lms_outcome_batches where id = $1 for update",[batchId])).rows[0];
        if (current.status !== "received") throw requestError(409,"Only received outcomes can be reviewed.");
        if (current.receivedBy === actor.accountId) throw requestError(403,"The connector account cannot review its own outcomes.");
        if (input.outcome === "accepted") reconcileOutcomeRoster(batch.rows,await rosterFor(db,batch.periodId,batch.courseId));
        await db.query("update lms_outcome_batches set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[batchId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`lms.outcomes.${input.outcome}`,subjectType:"LmsOutcomeBatch",subjectId:String(batchId),reason:input.reason,metadata:{periodId:batch.periodId,courseId:batch.courseId,checksum:batch.checksum}});
        return {id:batch.id,status:input.outcome};
      });
    },
    // Assembles every accepted course outcome into one official period batch under a deterministic source reference, so a
    // retry after a partial failure finds the earlier import instead of creating a second one.
    async transferLmsOutcomes(periodId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["gpaRuleSetId","reason"].includes(key)) || !text(input.gpaRuleSetId,100) || !text(input.reason,2000)) throw requestError(400,"Provide the GPA rule set and a transfer reason.");
      if (!actor.permissions.includes("results.import")) throw requestError(403,"Transferring outcomes creates an official results import and needs results-import authority.");
      const plan = await withTransaction(pool,async (db) => {
        const period = (await db.query(`${periodSelect} where rp.id = $1`,[periodId])).rows[0];
        if (!period) throw requestError(404,"Registration period was not found.");
        assertActorCanAccessScope(actor,{programmeCode:period.programmeCode,intakeId:period.intakeId});
        const status = await periodStatus(db,period);
        if (!status.readyToTransfer) throw requestError(409,`Every course with enrolments needs approved marks or accepted LMS outcomes first: ${status.courses.filter((row) => !row.ready).map((row) => `${row.code}${row.deferred ? ` (${row.deferred} deferred)` : ""}`).join(", ") || "none"}.`);
        const roster = await rosterFor(db,periodId);
        const rows = status.courses.flatMap((course) => course.source === "assessment"
          ? course.assessment.finals.map((row) => {
            if (!roster.some((entry) => entry.registrationId === row.registrationId && entry.courseId === course.courseId)) throw requestError(409,`${row.studentNumber} is no longer enrolled on ${course.code}. Return those marks for resubmission.`);
            return {registrationId:row.registrationId,courseId:course.courseId,mark:row.mark};
          })
          : course.live.rows.map((row) => {
            const enrolled = roster.find((entry) => entry.courseId === course.courseId && entry.studentNumber === row.studentNumber);
            if (!enrolled) throw requestError(409,`${row.studentNumber} is no longer enrolled on ${course.code}. Reject and resend those outcomes.`);
            return {registrationId:enrolled.registrationId,courseId:course.courseId,mark:row.mark};
          }));
        const batchIds = status.courses.filter((row) => row.source === "lms").map((row) => row.live.id).sort((a,b) => a - b);
        const submissionIds = status.courses.filter((row) => row.source === "assessment").map((row) => row.assessment.id).sort((a,b) => a - b);
        // Each rejected assembly is a new attempt, so the retry gets a fresh source reference rather than finding the rejected batch.
        const attempt = (await db.query("select count(*)::int as count from result_batches where period_id = $1 and status = 'rejected'",[periodId])).rows[0].count;
        const fingerprint = createHash("sha256").update(`lms:${batchIds.join(",")}|assessment:${submissionIds.join(",")}|attempt:${attempt}`).digest("hex").slice(0,16);
        return {rows,batchIds,submissionIds,programmeId:roster[0].programmeId,sourceRef:`RESULTS:${periodId}:${fingerprint}`};
      });
      let resultBatch = (await pool.query("select id from result_batches where source_ref = $1",[plan.sourceRef])).rows[0];
      if (!resultBatch) resultBatch = await results.importResultBatch(plan.programmeId,periodId,{sourceRef:plan.sourceRef,rows:plan.rows,checksum:resultsChecksum(plan.rows),expectedRowCount:plan.rows.length,
        expectedMarkTotal:plan.rows.reduce((sum,row) => sum + row.mark,0),gpaRuleSetId:input.gpaRuleSetId,reason:input.reason},actor);
      return withTransaction(pool,async (db) => {
        await db.query("update lms_outcome_batches set status = 'transferred',result_batch_id = $2,transferred_at = now() where id = any($1) and status = 'accepted'",[plan.batchIds,resultBatch.id]);
        await db.query("update assessment_submissions set status = 'transferred',result_batch_id = $2 where id = any($1) and status = 'approved'",[plan.submissionIds,resultBatch.id]);
        await insertAudit(db,{actorId:actor.accountId,action:"lms.outcomes.transferred",subjectType:"ResultBatch",subjectId:resultBatch.id,reason:input.reason,metadata:{periodId,sourceRef:plan.sourceRef,lmsBatchIds:plan.batchIds,assessmentSubmissionIds:plan.submissionIds,rowCount:plan.rows.length}});
        return {resultBatchId:resultBatch.id,sourceRef:plan.sourceRef,lmsBatchIds:plan.batchIds,assessmentSubmissionIds:plan.submissionIds,rowCount:plan.rows.length};
      });
    }
  };
}
