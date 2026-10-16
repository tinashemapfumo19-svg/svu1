import { createHash, randomUUID } from "node:crypto";
import { loadCurriculum } from "./curriculum.js";
import { calculateGpa } from "./grading.js";
import { loadCreditRecognitions } from "./credit-evidence.js";
import { queueNotification } from "../notification-queue.js";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, requestError, withTransaction } from "../support.js";

const text = (value,max) => typeof value === "string" && value.trim() && value.length <= max;
// Date parsing rolls impossible dates forward (2026-02-30 becomes 2 March), so the value must survive a round trip.
export const isCalendarDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
const halfCredits =(value) => Number.isFinite(value) && value >= 0 && value <= 1000 && value * 2 === Math.round(value * 2);

export function validateCompletionRules(rules) {
  if (!rules || typeof rules !== "object" || Object.keys(rules).some((key) => !["minCredits","minElectiveCredits","minCumulativeGpa","awardTitle"].includes(key))
    || !halfCredits(rules.minCredits) || !halfCredits(rules.minElectiveCredits) || rules.minElectiveCredits > rules.minCredits
    || !Number.isFinite(rules.minCumulativeGpa) || rules.minCumulativeGpa < 0 || rules.minCumulativeGpa > 10 || !text(rules.awardTitle,200) || rules.awardTitle.trim().length < 3) {
    throw requestError(400,"Completion rules need minimum credits, minimum elective credits (not above the total), a minimum cumulative GPA from 0-10, and an award title.");
  }
  return {minCredits:rules.minCredits,minElectiveCredits:rules.minElectiveCredits,minCumulativeGpa:rules.minCumulativeGpa,awardTitle:rules.awardTitle.trim()};
}

// Checks the official record against published completion rules. A course is satisfied by a passing latest attempt, or by
// approved recognized credit when it was never attempted here (credit cannot replace a failed or missing result). Only
// curriculum courses count toward credits; the cumulative GPA covers every official attempt under the rules' GPA policy,
// with attempts numbered per course so its retake rule applies.
export function graduationAudit({status,curriculum,attempts,recognitions,rules,policy}) {
  const ordered = [...attempts].sort((a,b) => a.endsOn.localeCompare(b.endsOn) || a.periodId.localeCompare(b.periodId) || a.courseId.localeCompare(b.courseId));
  const latest = new Map(),numbers = new Map(),graded = [];
  for (const row of ordered) {
    latest.set(row.courseId,row);
    const attempt = (numbers.get(row.courseId) || 0) + 1;
    numbers.set(row.courseId,attempt);
    graded.push({courseCode:row.code,credits:Number(row.credits),mark:row.mark,attempt});
  }
  const recognised = new Map(recognitions.filter((row) => !numbers.has(row.courseId)).map((row) => [row.courseId,row]));
  const courses = [...curriculum].sort((a,b) => a.yearOfStudy - b.yearOfStudy || a.code.localeCompare(b.code)).map((entry) => {
    const last = latest.get(entry.courseId),passed = Boolean(last?.passing),credit = recognised.has(entry.courseId);
    return {courseId:entry.courseId,code:entry.code,title:entry.title,credits:Number(entry.credits),requirementType:entry.requirementType,yearOfStudy:entry.yearOfStudy,
      outcome:passed ? "passed" : credit ? "recognised" : last ? "not passed" : "not attempted",mark:last?.mark ?? null,attempts:numbers.get(entry.courseId) || 0,satisfied:passed || credit};
  });
  const sum = (rows) => rows.reduce((total,row) => total + row.credits,0);
  const creditsEarned = sum(courses.filter((row) => row.satisfied)),electiveCredits = sum(courses.filter((row) => row.satisfied && row.requirementType === "elective"));
  const outstandingCore = courses.filter((row) => row.requirementType === "core" && !row.satisfied).map((row) => row.code);
  const gpa = graded.length ? calculateGpa(graded,policy.rule.rules,policy.scheme) : {gpa:null,classification:null};
  const checks = [
    {code:"status",met:status === "onboarded",detail:status === "onboarded" ? "Programme is active." : `Programme status is ${status}.`},
    {code:"core",met:!outstandingCore.length,detail:outstandingCore.length ? `Outstanding core courses: ${outstandingCore.join(", ")}.` : "Every core course is satisfied."},
    {code:"credits",met:creditsEarned >= rules.minCredits,detail:`${creditsEarned} of ${rules.minCredits} credits earned.`},
    {code:"electives",met:electiveCredits >= rules.minElectiveCredits,detail:`${electiveCredits} of ${rules.minElectiveCredits} elective credits earned.`},
    {code:"gpa",met:gpa.gpa !== null && gpa.gpa >= rules.minCumulativeGpa,detail:gpa.gpa === null ? "No graded results yet." : `Cumulative GPA ${gpa.gpa} against a minimum of ${rules.minCumulativeGpa}.`}
  ];
  return {eligible:checks.every((row) => row.met),checks,courses,creditsEarned,electiveCredits,cumulativeGpa:gpa.gpa,classification:gpa.classification,awardTitle:rules.awardTitle};
}

export function auditHash(ruleId,statusRevision,audit) {
  return createHash("sha256").update(JSON.stringify({ruleId,statusRevision,audit})).digest("hex");
}

const ruleSelect = `select id,programme_version_id as "programmeVersionId",version,rules,gpa_rule_set_id as "gpaRuleSetId",status,reason,created_by as "createdBy",created_at as "createdAt",
  published_by as "publishedBy",published_at as "publishedAt",publication_reason as "publicationReason" from completion_rules`;
const requestSelect = `select id::int,completion_rule_id as "ruleId",evidence_hash as "evidenceHash",audit,award_title as "awardTitle",classification,to_char(conferred_on,'YYYY-MM-DD') as "conferredOn",
  status,reason,requested_by as "requestedBy",requested_at as "requestedAt",reviewed_by as "reviewedBy",reviewed_at as "reviewedAt",review_reason as "reviewReason" from award_requests`;

async function programmeFor(db,id,actor,own,lock = false) {
  const row = (await db.query(`select sp.id,sp.status,sp.status_revision as "statusRevision",sp.programme_version_id as "programmeVersionId",sp.intake_id as "intakeId",
    s.account_id as "accountId",s.student_number as "studentNumber",p.code as "programmeCode",p.name as "programmeName"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}

async function policyFor(db,gpaRuleSetId) {
  const rule = (await db.query("select id,version,rules,grading_scheme_id as \"gradingSchemeId\" from gpa_rule_sets where id = $1 and status = 'published'",[gpaRuleSetId])).rows[0];
  const scheme = rule && (await db.query("select id,version,bands,classifications from grading_schemes where id = $1 and status = 'published'",[rule.gradingSchemeId])).rows[0];
  if (!rule || !scheme) throw requestError(409,"Completion rules need a published GPA rule set and grading scheme.");
  return {rule,scheme};
}

async function auditFor(db,programme,rule) {
  const attempts = (await db.query(`select ar.course_id as "courseId",ar.result_snapshot->>'code' as code,(ar.result_snapshot->>'credits')::float as credits,(ar.result_snapshot->>'mark')::int as mark,
    (ar.result_snapshot->>'passing')::boolean as passing,rp.id as "periodId",to_char(ap.ends_on,'YYYY-MM-DD') as "endsOn"
    from academic_results ar join result_batches rb on rb.id = ar.batch_id and rb.status = 'published' join student_registrations sr on sr.id = ar.registration_id
    join registration_periods rp on rp.id = sr.period_id join academic_periods ap on ap.id = rp.academic_period_id where sr.student_programme_id = $1`,[programme.id])).rows;
  const recognitions = (await loadCreditRecognitions(db,programme.id)).filter((row) => row.status === "approved" && row.programmeVersionId === programme.programmeVersionId);
  const audit = graduationAudit({status:programme.status,curriculum:await loadCurriculum(db,programme.programmeVersionId),attempts,recognitions,rules:rule.rules,policy:await policyFor(db,rule.gpaRuleSetId)});
  return {...audit,evidenceHash:auditHash(rule.id,programme.statusRevision,audit)};
}

export function createAwardsModule(pool) {
  async function context(db,programme,actor,own) {
    const rules = (await db.query(`${ruleSelect} where programme_version_id = $1 order by version desc`,[programme.programmeVersionId])).rows;
    const published = rules.find((row) => row.status === "published") || null;
    const audit = published ? await auditFor(db,programme,published) : null;
    const requests = (await db.query(`${requestSelect} where student_programme_id = $1 order by id desc`,[programme.id])).rows;
    const award = requests.find((row) => row.status === "approved") || null;
    if (own) return {audit:audit && {eligible:audit.eligible,checks:audit.checks,courses:audit.courses,creditsEarned:audit.creditsEarned,cumulativeGpa:audit.cumulativeGpa,classification:audit.classification,awardTitle:audit.awardTitle},
      award:award && {awardTitle:award.awardTitle,classification:award.classification,conferredOn:award.conferredOn},status:programme.status};
    const scope = {programmeCode:programme.programmeCode,intakeId:programme.intakeId};
    const can = (permission) => actor.permissions.includes(permission) && actorCanAccessScope({...actor,authorizingPermission:permission},scope);
    return {rules,published,draft:rules.find((row) => row.status === "draft") || null,audit,requests,award,status:programme.status,accountId:actor.accountId,
      capabilities:{manageRules:can("academic.policy.manage"),publishRules:can("academic.policy.publish"),request:can("registry.award.request"),approve:can("registry.award.approve")}};
  }
  return {
    async getAward(id,actor,own = false) {
      return withTransaction(pool,async (db) => context(db,await programmeFor(db,id,actor,own),actor,own));
    },
    async draftCompletionRules(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["rules","gpaRuleSetId","reason"].includes(key)) || !text(input.gpaRuleSetId,100) || !text(input.reason,2000)) throw requestError(400,"Provide rules, a GPA rule set, and a reason.");
      const rules = validateCompletionRules(input.rules);
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false);
        const policy = await policyFor(db,input.gpaRuleSetId);
        if (rules.minCumulativeGpa > Math.max(...policy.scheme.bands.map((band) => band.points))) throw requestError(400,"The GPA minimum exceeds this grading scheme's maximum points.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`completion-rules:${programme.programmeVersionId}`]);
        if ((await db.query("select 1 from completion_rules where programme_version_id = $1 and status = 'draft'",[programme.programmeVersionId])).rowCount) throw requestError(409,"Draft completion rules already await publication.");
        const version = (await db.query("select coalesce(max(version),0) + 1 as next from completion_rules where programme_version_id = $1",[programme.programmeVersionId])).rows[0].next;
        const ruleId = `cmp_${randomUUID()}`;
        await db.query("insert into completion_rules (id,programme_version_id,version,rules,gpa_rule_set_id,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7)",
          [ruleId,programme.programmeVersionId,version,JSON.stringify(rules),input.gpaRuleSetId,input.reason.trim(),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"award.rules.drafted",subjectType:"CompletionRules",subjectId:ruleId,reason:input.reason,metadata:{programmeVersionId:programme.programmeVersionId,version,rules}});
        return context(db,programme,actor,false);
      });
    },
    async publishCompletionRules(id,ruleId,input,actor) {
      if (!input || Object.keys(input).some((key) => key !== "reason") || !text(input.reason,2000)) throw requestError(400,"A publication reason is required.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`completion-rules:${programme.programmeVersionId}`]);
        const rule = (await db.query(`${ruleSelect} where id = $1 and programme_version_id = $2 for update`,[ruleId,programme.programmeVersionId])).rows[0];
        if (!rule) throw requestError(404,"Completion rules were not found for this curriculum.");
        if (rule.status !== "draft") throw requestError(409,"Only draft completion rules can be published.");
        assertSeparateApprover(rule.createdBy,actor);
        await policyFor(db,rule.gpaRuleSetId);
        await db.query("update completion_rules set status = 'superseded' where programme_version_id = $1 and status = 'published'",[programme.programmeVersionId]);
        await db.query("update completion_rules set status = 'published',published_by = $2,published_at = now(),publication_reason = $3 where id = $1",[ruleId,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:"award.rules.published",subjectType:"CompletionRules",subjectId:ruleId,reason:input.reason,metadata:{programmeVersionId:programme.programmeVersionId,version:rule.version}});
        return context(db,programme,actor,false);
      });
    },
    // The requester confirms the audit they reviewed by its hash; any change to the record, rules, or status since then
    // refuses the request.
    async requestAward(id,input,actor) {
      if (!input || Object.keys(input).some((key) => !["evidenceHash","conferredOn","reason"].includes(key)) || !text(input.evidenceHash,64) || !text(input.reason,2000)
        || !isCalendarDate(input.conferredOn)) {
        throw requestError(400,"Provide the reviewed audit hash, a conferral date (YYYY-MM-DD), and a reason.");
      }
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const rule = (await db.query(`${ruleSelect} where programme_version_id = $1 and status = 'published'`,[programme.programmeVersionId])).rows[0];
        if (!rule) throw requestError(409,"Publish completion rules for this curriculum first.");
        if ((await db.query("select 1 from award_requests where student_programme_id = $1 and status in ('requested','approved')",[id])).rowCount) throw requestError(409,"An award is already requested or conferred for this programme.");
        const audit = await auditFor(db,programme,rule);
        if (audit.evidenceHash !== input.evidenceHash) throw requestError(409,"The graduation audit changed after you reviewed it. Review the current audit first.");
        if (!audit.eligible) throw requestError(409,`The graduation audit is not met: ${audit.checks.filter((row) => !row.met).map((row) => row.detail).join(" ")}`);
        const row = (await db.query(`insert into award_requests (student_programme_id,completion_rule_id,evidence_hash,audit,award_title,classification,conferred_on,reason,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id::int`,[id,rule.id,audit.evidenceHash,JSON.stringify(audit),audit.awardTitle,audit.classification,input.conferredOn,input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"award.requested",subjectType:"AwardRequest",subjectId:String(row.id),reason:input.reason,
          metadata:{programmeId:id,ruleId:rule.id,evidenceHash:audit.evidenceHash,classification:audit.classification,conferredOn:input.conferredOn}});
        return context(db,programme,actor,false);
      });
    },
    // Conferral re-runs the audit: the rules must still be the published version and the evidence unchanged. Approval
    // completes the programme with retained history and tells the student.
    async reviewAward(id,requestId,input,actor) {
      if (!input || Object.keys(input).some((key) => !["outcome","reason"].includes(key)) || !["approved","rejected"].includes(input.outcome) || !text(input.reason,2000)) throw requestError(400,"Choose approve or reject and give a reason.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const request = (await db.query(`${requestSelect} where id = $1 and student_programme_id = $2 for update`,[requestId,id])).rows[0];
        if (!request) throw requestError(404,"Award request was not found.");
        if (request.status !== "requested") throw requestError(409,"Only open award requests can be reviewed.");
        assertSeparateApprover(request.requestedBy,actor);
        if (input.outcome === "approved") {
          const rule = (await db.query(`${ruleSelect} where id = $1`,[request.ruleId])).rows[0];
          if (rule.status !== "published") throw requestError(409,"The completion rules changed after this request. Reject it and request again under the current rules.");
          const audit = await auditFor(db,programme,rule);
          if (audit.evidenceHash !== request.evidenceHash || !audit.eligible) throw requestError(409,"The record changed after this request. Reject it and request again from the current audit.");
        }
        await db.query("update award_requests set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[requestId,input.outcome,actor.accountId,input.reason.trim()]);
        if (input.outcome === "approved") {
          await db.query("update student_programmes set status = 'completed',status_revision = status_revision + 1 where id = $1",[id]);
          await db.query("insert into student_programme_history (id,student_programme_id,from_status,to_status,reason,actor_id,award_request_id) values ($1,$2,$3,'completed',$4,$5,$6)",
            [`sph_${randomUUID()}`,id,programme.status,`Award conferred: ${request.awardTitle}`,actor.accountId,requestId]);
          await queueNotification(db,programme.accountId,"registry.award",{studentNumber:programme.studentNumber,awardTitle:request.awardTitle,classification:request.classification || "not classified",conferredOn:request.conferredOn},{link:'#study/results'});
        }
        await insertAudit(db,{actorId:actor.accountId,action:`award.${input.outcome}`,subjectType:"AwardRequest",subjectId:String(requestId),reason:input.reason,metadata:{programmeId:id}});
        return context(db,await programmeFor(db,id,actor,false),actor,false);
      });
    }
  };
}

