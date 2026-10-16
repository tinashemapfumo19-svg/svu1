import { randomUUID } from "node:crypto";
import { actorCanAccessScope, assertActorCanAccessScope, assertSeparateApprover, insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from "../support.js";
import { assessAcademicDecision, loadAcademicContext, validateAcademicRules } from "./academic-evidence.js";

async function programmeFor(db,id,actor,own = false,lock = false) {
  const row = (await db.query(`select sp.id,sp.student_id as "studentId",sp.status_revision as "statusRevision",sp.intake_id as "intakeId",sp.programme_version_id as "programmeVersionId",s.account_id as "accountId",p.code as "programmeCode"
    from student_programmes sp join students s on s.id = sp.student_id join intakes i on i.id = sp.intake_id join programmes p on p.id = i.programme_id
    where sp.id = $1 ${lock ? "for update of sp" : ""}`,[id])).rows[0];
  if (!row || own && row.accountId !== actor.accountId) throw requestError(404,"Student programme was not found.");
  if (!own) assertActorCanAccessScope(actor,{programmeCode:row.programmeCode,intakeId:row.intakeId});
  return row;
}
async function periodFor(db,id,programme,lock = false) {
  const row = (await db.query(`select rp.id,rp.intake_id as "intakeId",rp.programme_version_id as "programmeVersionId",rp.year_of_study as "yearOfStudy",rp.term,rp.status,
    rp.academic_policy_id as "academicPolicyId",ap.name,ap.windows,to_char(ap.starts_on,'YYYY-MM-DD') as "startsOn"
    from registration_periods rp join academic_periods ap on ap.id = rp.academic_period_id where rp.id = $1 ${lock ? "for update of rp for share of ap" : ""}`,[id])).rows[0];
  if (!row || row.intakeId !== programme.intakeId || row.programmeVersionId !== programme.programmeVersionId) throw requestError(404,"Academic period was not found for this curriculum/intake.");
  return row;
}
function reason(input) {
  if (typeof input?.reason !== "string" || !input.reason.trim() || input.reason.length > 2000) throw requestError(400,"A reason of 1-2000 characters is required.");
}
function evidence(input) {
  if (typeof input.evidenceRef !== "string" || !input.evidenceRef.trim() || input.evidenceRef.length > 300) throw requestError(400,"An evidence reference of 1-300 characters is required.");
}
const policySelect = `select id,code,version,name,programme_version_id as "programmeVersionId",gpa_rule_set_id as "gpaRuleSetId",rules,status,created_by as "createdBy",
  to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(effective_to,'YYYY-MM-DD') as "effectiveTo" from academic_policies`;

async function assertMutableTarget(db,programme,period) {
  if (period.status === "closed" || (await db.query("select 1 from student_registrations where student_programme_id = $1 and period_id = $2 and status = 'confirmed'",[programme.id,period.id])).rowCount)
    throw requestError(409,"Academic decisions require an unconfirmed, non-closed target period.");
}

export function createAcademicProgressModule(pool) {
  return {
    async listAcademicContext(id,actor,own = false) {
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,own);
        const periods = (await db.query("select id from registration_periods where intake_id = $1 and programme_version_id = $2 order by id",[programme.intakeId,programme.programmeVersionId])).rows;
        const contexts = [];
        for (const {id:periodId} of periods) {
          const period = await periodFor(db,periodId,programme);
          const context = await loadAcademicContext(db,programme,period);
          const registration = (await db.query("select revision,status,selected_courses as \"selectedCourses\" from student_registrations where student_programme_id = $1 and period_id = $2",[id,periodId])).rows[0];
          contexts.push({period,evidenceHash:context.evidenceHash,policy:context.policy,decisions:context.decisions,registration,
            repeatCandidates:context.curriculum.filter((row) => row.yearOfStudy <= period.yearOfStudy),
            repeatCourseIds:(await db.query("select course_id from registration_offerings where period_id = $1 and offering_type = 'repeat'",[periodId])).rows.map((row) => row.course_id),
            progression:period.yearOfStudy > 1 ? assessAcademicDecision(context,"progression") : null,
            repeats:context.latestResults.map((row) => ({courseId:row.courseId,code:row.courseSnapshot.code,...assessAcademicDecision(context,"repeat",row.courseId)}))});
        }
        const capabilities = Object.fromEntries(["request","approve","policy.manage","policy.publish"].map((action) => [action,!own && actor.permissions.includes(`academic.${action}`)
          && actorCanAccessScope({...actor,authorizingPermission:`academic.${action}`},{programmeCode:programme.programmeCode,intakeId:programme.intakeId})]));
        return {contexts,capabilities,accountId:actor.accountId,
          policies:own ? [] : (await db.query(`${policySelect} where programme_version_id = $1 order by code,version desc`,[programme.programmeVersionId])).rows,
          gpaPolicies:own ? [] : (await db.query("select id,name from gpa_rule_sets where status = 'published' order by code,version desc")).rows};
      });
    },

    async createAcademicPolicy(id,input,actor) {
      reason(input); validateAcademicRules(input.rules);
      if (!/^[a-z0-9_]{3,40}$/.test(input.code || "") || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200) throw requestError(400,"Provide a policy code and name.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor);
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`academic-policy:${input.code}`]);
        if ((await db.query("select 1 from academic_policies where code = $1 and programme_version_id <> $2",[input.code,programme.programmeVersionId])).rowCount) throw requestError(409,"A policy code belongs to one pinned curriculum version.");
        const rule = (await db.query("select * from gpa_rule_sets where id = $1 and status = 'published' for share",[input.gpaRuleSetId])).rows[0];
        const scheme = rule ? (await db.query("select * from grading_schemes where id = $1 and status = 'published' for share",[rule.grading_scheme_id])).rows[0] : null;
        if (!rule || !scheme) throw requestError(409,"Academic policies need published grading and GPA rules.");
        if (input.rules.minGpa > Math.max(...scheme.bands.map((band) => band.points))) throw requestError(400,"The GPA threshold exceeds this grading scheme's maximum points.");
        const version = (await db.query("select coalesce(max(version),0) + 1 as version from academic_policies where code = $1",[input.code])).rows[0].version;
        const policyId = `acp_${randomUUID()}`;
        await db.query(`insert into academic_policies (id,code,version,name,programme_version_id,gpa_rule_set_id,gpa_snapshot,rules,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[policyId,input.code,version,input.name.trim(),programme.programmeVersionId,rule.id,JSON.stringify({rule,scheme}),JSON.stringify(input.rules),actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"academic.policy.drafted",subjectType:"AcademicPolicy",subjectId:policyId,reason:input.reason,metadata:{programmeVersionId:programme.programmeVersionId,version,rules:input.rules}});
        return (await db.query(`${policySelect} where id = $1`,[policyId])).rows[0];
      });
    },

    async publishAcademicPolicy(id,policyId,input,actor) {
      reason(input); evidence(input);
      if (!input.effectiveFrom) throw requestError(400,"An effective date is required.");
      const from = parseEffectiveDate(input.effectiveFrom);
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor);
        const before = (await db.query(`${policySelect} where id = $1 and programme_version_id = $2`,[policyId,programme.programmeVersionId])).rows[0];
        if (!before) throw requestError(404,"Academic policy was not found in this curriculum.");
        await db.query("select pg_advisory_xact_lock(hashtext($1))",[`academic-policy:${before.code}`]);
        const policy = (await db.query(`${policySelect} where id = $1 for update`,[policyId])).rows[0];
        if (policy.status !== "draft") throw requestError(409,"Only draft academic policies can be published.");
        assertSeparateApprover(policy.createdBy,actor);
        const gpa = (await db.query("select grading_scheme_id from gpa_rule_sets where id = $1 and status = 'published' and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date) for share",[policy.gpaRuleSetId,from])).rows[0];
        if (!gpa || !(await db.query("select 1 from grading_schemes where id = $1 and status = 'published' and effective_from <= $2::date and (effective_to is null or effective_to >= $2::date) for share",[gpa.grading_scheme_id,from])).rowCount) throw requestError(409,"Publish against grading/GPA policies effective on the academic policy's start date.");
        if ((await db.query("select 1 from academic_policies where code = $1 and status = 'published' and effective_from >= $2::date",[policy.code,from])).rowCount) throw requestError(409,"Policy dates must follow prior published versions.");
        await db.query("update academic_policies set effective_to = $2::date - 1 where code = $1 and status = 'published' and (effective_to is null or effective_to >= $2::date)",[policy.code,from]);
        await db.query("update academic_policies set status = 'published',effective_from = $2,published_by = $3,published_at = now() where id = $1",[policyId,from,actor.accountId]);
        await insertAudit(db,{actorId:actor.accountId,action:"academic.policy.published",subjectType:"AcademicPolicy",subjectId:policyId,reason:input.reason,metadata:{effectiveFrom:from,evidenceRef:input.evidenceRef}});
        return (await db.query(`${policySelect} where id = $1`,[policyId])).rows[0];
      });
    },

    async requestAcademicDecision(id,periodId,input,actor) {
      reason(input); evidence(input);
      if (!["progression","repeat"].includes(input.kind) || !input.expiresOn || typeof input.evidenceHash !== "string") throw requestError(400,"Provide decision kind, evidence hash, and expiry.");
      if (input.kind === "repeat" && (typeof input.courseId !== "string" || !input.courseId) || input.kind === "progression" && input.courseId != null) throw requestError(400,"Only repeat decisions specify a course.");
      const expiresOn = parseEffectiveDate(input.expiresOn);
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const period = await periodFor(db,periodId,programme,true);
        await assertMutableTarget(db,programme,period);
        if (expiresOn < todayIso() || period.windows?.registration && expiresOn > period.windows.registration[1]) throw requestError(400,"Decision expiry must be current and within the target registration window.");
        const context = await loadAcademicContext(db,programme,period);
        const assessment = assessAcademicDecision(context,input.kind,input.courseId);
        if (!context.policy || context.policy.status !== "published") throw requestError(409,"A published attached academic policy is required.");
        if (context.evidenceHash !== input.evidenceHash) throw requestError(409,"Academic evidence changed. Reload before requesting a decision.");
        let revision = null;
        if (input.kind === "repeat") {
          const registration = (await db.query("select revision,selected_courses from student_registrations where student_programme_id = $1 and period_id = $2 and status = 'draft'",[id,periodId])).rows[0];
          if (!registration || registration.revision !== input.revision || !registration.selected_courses.includes(input.courseId)) throw requestError(409,"A repeat request must reference the current saved selection revision and selected course.");
          revision = registration.revision;
        }
        const previous = context.decisions.find((row) => row.kind === input.kind && (row.courseId || null) === (input.courseId || null));
        if (previous?.status === "requested" && previous.evidenceHash === context.evidenceHash && previous.registrationRevision === revision) throw requestError(409,"This academic decision is already awaiting independent review.");
        const decision = (await db.query(`insert into academic_decisions (student_programme_id,period_id,policy_id,kind,course_id,registration_revision,evidence_hash,source_snapshot,assessment,reason,evidence_ref,expires_on,requested_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,[id,periodId,context.policy.id,input.kind,input.kind === "repeat" ? input.courseId : null,revision,context.evidenceHash,
          JSON.stringify({policy:context.policy,attempts:context.attempts,curriculum:context.curriculum,recognitions:context.recognitions}),JSON.stringify(assessment),input.reason.trim(),input.evidenceRef.trim(),expiresOn,actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:"academic.decision.requested",subjectType:"AcademicDecision",subjectId:String(decision.id),reason:input.reason,metadata:{periodId,kind:input.kind,evidenceHash:context.evidenceHash}});
        return decision;
      });
    },

    async reviewAcademicDecision(id,periodId,decisionId,input,actor) {
      reason(input);
      if (!["approved","rejected"].includes(input.outcome)) throw requestError(400,"Choose approved or rejected.");
      return withTransaction(pool,async (db) => {
        const programme = await programmeFor(db,id,actor,false,true);
        const period = await periodFor(db,periodId,programme,true);
        await assertMutableTarget(db,programme,period);
        const decision = (await db.query("select *,to_char(expires_on,'YYYY-MM-DD') as \"expiresOn\" from academic_decisions where id = $1 and student_programme_id = $2 and period_id = $3 for update",[decisionId,id,periodId])).rows[0];
        if (!decision) throw requestError(404,"Academic decision was not found.");
        if (decision.status !== "requested") throw requestError(409,"Reviewed academic decisions are immutable.");
        assertSeparateApprover(decision.requested_by,actor);
        if (input.outcome === "approved") {
          const context = await loadAcademicContext(db,programme,period);
          const assessment = assessAcademicDecision(context,decision.kind,decision.course_id);
          if (context.evidenceHash !== decision.evidence_hash || decision.expiresOn < todayIso() || !assessment.ready) throw requestError(409,"Academic evidence is stale, expired, or not eligible. Reconcile blockers before approval.");
          if (decision.kind === "repeat") {
            const registration = (await db.query("select revision,selected_courses from student_registrations where student_programme_id = $1 and period_id = $2 and status = 'draft'",[id,periodId])).rows[0];
            if (!registration || registration.revision !== decision.registration_revision || !registration.selected_courses.includes(decision.course_id)) throw requestError(409,"Selection changed. Request a new repeat decision.");
          }
        }
        await db.query("update academic_decisions set status = $2,reviewed_by = $3,reviewed_at = now(),review_reason = $4 where id = $1",[decisionId,input.outcome,actor.accountId,input.reason.trim()]);
        await insertAudit(db,{actorId:actor.accountId,action:`academic.decision.${input.outcome}`,subjectType:"AcademicDecision",subjectId:String(decisionId),reason:input.reason,metadata:{evidenceHash:decision.evidence_hash}});
        return {id:decisionId,status:input.outcome};
      });
    }
  };
}
