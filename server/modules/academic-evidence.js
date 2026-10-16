import { createHash } from "node:crypto";
import { loadCurriculum } from "./curriculum.js";
import { calculateGpa } from "./grading.js";
import { applicableCreditRecognitions, loadCreditRecognitions } from "./credit-evidence.js";
import { requestError, todayIso } from "../support.js";

export function validateAcademicRules(rules) {
  if (!rules || Object.keys(rules).some((key) => !["minGpa","minPassedCredits","maxFailedCredits","maxOutstandingCoreCourses","maxAttempts","allowPassedRetake","recognisedCredits"].includes(key))
    || !Number.isFinite(rules.minGpa) || rules.minGpa < 0 || rules.minGpa > 10
    || [rules.minPassedCredits,rules.maxFailedCredits].some((value) => !Number.isFinite(value) || value < 0 || value > 480 || value * 2 !== Math.round(value * 2))
    || !Number.isInteger(rules.maxOutstandingCoreCourses) || rules.maxOutstandingCoreCourses < 0 || rules.maxOutstandingCoreCourses > 100
    || !Number.isInteger(rules.maxAttempts) || rules.maxAttempts < 1 || rules.maxAttempts > 10 || typeof rules.allowPassedRetake !== "boolean" || rules.recognisedCredits !== undefined && typeof rules.recognisedCredits !== "boolean")
    throw requestError(400,"Academic rules require GPA/credit thresholds, an outstanding-core limit, maximum attempts, and an explicit passed-retake policy.");
}

export function latestAcademicAttempts(attempts,startsOn) {
  const ordered = attempts.filter((row) => row.endsOn < startsOn).sort((a,b) => b.endsOn.localeCompare(a.endsOn) || b.startsOn.localeCompare(a.startsOn) || b.registrationId.localeCompare(a.registrationId));
  const latest = new Map();
  for (const row of ordered) if (!latest.has(row.courseId)) latest.set(row.courseId,row);
  return [...latest.values()];
}

export function academicEvidenceHash(context) {
  const attempts = context.attempts.map((row) => ({registrationId:row.registrationId,courseId:row.courseId,startsOn:row.startsOn,endsOn:row.endsOn,yearOfStudy:row.yearOfStudy,batchId:row.batchId,gradingSchemeId:row.gradingSchemeId,result:row.result}))
    .sort((a,b) => a.registrationId.localeCompare(b.registrationId) || a.courseId.localeCompare(b.courseId));
  const curriculum = context.curriculum.map(({courseId,yearOfStudy,term,requirementType,credits}) => ({courseId,yearOfStudy,term,requirementType,credits})).sort((a,b) => a.courseId.localeCompare(b.courseId));
  const recognitions = (context.recognitions || []).filter((row) => ["approved","revoked"].includes(row.status)).map(({id,courseId,credits,completedOn,programmeVersionId,policyId,status}) => ({id,courseId,credits,completedOn,programmeVersionId,policyId,status})).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  // Revision zero preserves evidence hashes from before lifecycle governance.
  return createHash("sha256").update(JSON.stringify({statusRevision:context.statusRevision || undefined,recognitions:recognitions.length ? recognitions : undefined,policyId:context.policy?.id,periodId:context.period.id,startsOn:context.period.startsOn,yearOfStudy:context.period.yearOfStudy,attempts,curriculum})).digest("hex");
}

export function assessAcademicDecision(context,kind,courseId) {
  const blockers = [];
  const add = (code,message) => blockers.push({code,message});
  const {policy,period,attempts,curriculum} = context;
  if (!policy || policy.status !== "published" || policy.programmeVersionId !== period.programmeVersionId || !policy.effectiveFrom || policy.effectiveFrom > period.startsOn || policy.effectiveTo && policy.effectiveTo < period.startsOn) {
    add("ACADEMIC_POLICY","Attach a published academic policy effective for this curriculum and period.");
    return {ready:false,blockers};
  }
  const latest = latestAcademicAttempts(attempts,period.startsOn);
  if (kind === "repeat") {
    const previous = latest.find((row) => row.courseId === courseId);
    const count = attempts.filter((row) => row.courseId === courseId).length;
    if (!previous?.result) add("REPEAT_RESULT","A repeat requires a published result for the latest completed prior attempt.");
    if (attempts.some((row) => row.courseId === courseId && row.endsOn >= period.startsOn)) add("REPEAT_CHRONOLOGY","A repeat cannot precede an existing attempt.");
    if (previous?.result?.passing && !policy.rules.allowPassedRetake) add("PASSED_RETAKE","This policy does not allow repeating a passed course.");
    if (count >= policy.rules.maxAttempts) add("ATTEMPT_LIMIT",`The ${policy.rules.maxAttempts}-attempt policy limit has been reached.`);
    return {ready:!blockers.length,blockers,courseId,priorAttempts:count,previousResult:previous?.result || null};
  }
  if (kind !== "progression" || period.yearOfStudy < 2) throw requestError(400,"Progression requires a target year of at least two.");
  const fromYear = period.yearOfStudy - 1;
  const entries = curriculum.filter((entry) => entry.yearOfStudy === fromYear);
  const recognised = applicableCreditRecognitions(context).filter((row) => entries.some((entry) => entry.courseId === row.courseId));
  if (!entries.length) add("SOURCE_YEAR","The pinned curriculum has no courses in the preceding year.");
  const sources = attempts.filter((row) => row.yearOfStudy === fromYear);
  if (!sources.length && !recognised.length) add("SOURCE_ENROLMENT","Confirmed preceding-year enrolment or approved recognized credit is required.");
  if (sources.some((row) => row.endsOn >= period.startsOn)) add("SOURCE_CHRONOLOGY","Complete preceding-year periods before progression.");
  for (const row of sources) if (!row.result) add("UNPUBLISHED_RESULT",`${row.courseSnapshot.code} has no published result.`);
  const relevant = latest.filter((row) => entries.some((entry) => entry.courseId === row.courseId));
  for (const entry of entries.filter((row) => row.requirementType === "core")) if (!relevant.find((row) => row.courseId === entry.courseId)?.result && !recognised.some((row) => row.courseId === entry.courseId)) add("MISSING_CORE_RESULT",`Required ${entry.code} needs a published result or approved recognized credit.`);
  const graded = relevant.filter((row) => row.result);
  if (graded.some((row) => row.gradingSchemeId !== policy.gpaSnapshot.scheme.id)) add("GRADING_POLICY","Result grading schemes differ from this progression policy; approved equivalence is required.");
  const recognisedCredits = recognised.reduce((sum,row) => sum + row.credits,0);
  const passedCredits = graded.filter((row) => row.result.passing).reduce((sum,row) => sum + row.result.credits,0) + recognisedCredits;
  const failedCredits = graded.filter((row) => !row.result.passing).reduce((sum,row) => sum + row.result.credits,0);
  const outstandingCoreCourses = entries.filter((entry) => entry.requirementType === "core" && !relevant.find((row) => row.courseId === entry.courseId)?.result?.passing && !recognised.some((row) => row.courseId === entry.courseId)).length;
  let gpa = null;
  if (graded.length && !blockers.some((row) => row.code === "GRADING_POLICY")) gpa = calculateGpa(graded.map((row) => ({courseCode:row.result.code,credits:row.result.credits,grade:row.result.grade})),policy.gpaSnapshot.rule.rules,policy.gpaSnapshot.scheme).gpa;
  if (gpa === null || gpa < policy.rules.minGpa) add("PROGRESSION_GPA",`GPA must meet ${policy.rules.minGpa}; current GPA is ${gpa ?? "unknown"}.`);
  if (passedCredits < policy.rules.minPassedCredits) add("PASSED_CREDITS",`${passedCredits} passed credits do not meet ${policy.rules.minPassedCredits}.`);
  if (failedCredits > policy.rules.maxFailedCredits) add("FAILED_CREDITS",`${failedCredits} failed credits exceed ${policy.rules.maxFailedCredits}.`);
  if (outstandingCoreCourses > policy.rules.maxOutstandingCoreCourses) add("OUTSTANDING_CORE",`${outstandingCoreCourses} outstanding core courses exceed ${policy.rules.maxOutstandingCoreCourses}.`);
  return {ready:!blockers.length,blockers,fromYear,toYear:period.yearOfStudy,gpa,passedCredits,recognisedCredits,failedCredits,outstandingCoreCourses};
}

export function currentAcademicDecision(context,kind,courseId,revision,today = todayIso()) {
  const latest = context.decisions.find((row) => row.kind === kind && (row.courseId || null) === (courseId || null));
  if (!latest || latest.status !== "approved" || latest.expiresOn < today || latest.evidenceHash !== context.evidenceHash || latest.policyId !== context.policy?.id
    || kind === "repeat" && latest.registrationRevision !== revision) return null;
  return latest;
}

export async function loadAcademicContext(db,programme,period) {
  const policy = period.academicPolicyId ? (await db.query(`select id,code,version,name,status,programme_version_id as "programmeVersionId",rules,gpa_snapshot as "gpaSnapshot",
    to_char(effective_from,'YYYY-MM-DD') as "effectiveFrom",to_char(effective_to,'YYYY-MM-DD') as "effectiveTo" from academic_policies where id = $1 for share`,[period.academicPolicyId])).rows[0] : null;
  const attempts = (await db.query(`select ce.registration_id as "registrationId",ce.course_id as "courseId",ce.course_snapshot as "courseSnapshot",rp.year_of_study as "yearOfStudy",
    coalesce(sr.confirmation->>'startsOn',to_char(ap.starts_on,'YYYY-MM-DD')) as "startsOn",coalesce(sr.confirmation->>'endsOn',to_char(ap.ends_on,'YYYY-MM-DD')) as "endsOn",case when rb.status = 'published' then ar.result_snapshot else null end as result,
    case when rb.status = 'published' then rb.id else null end as "batchId",case when rb.status = 'published' then rb.policy_snapshot->'scheme'->>'id' else null end as "gradingSchemeId"
    from course_enrolments ce join student_registrations sr on sr.id = ce.registration_id join registration_periods rp on rp.id = sr.period_id
    join academic_periods ap on ap.id = rp.academic_period_id left join academic_results ar on ar.registration_id = ce.registration_id and ar.course_id = ce.course_id
    left join result_batches rb on rb.id = ar.batch_id where sr.student_programme_id = $1 and sr.period_id <> $2 and ce.withdrawn_at is null order by ap.ends_on,ce.registration_id,ce.course_id`,[programme.id,period.id])).rows;
  const decisions = (await db.query(`select id,kind,course_id as "courseId",policy_id as "policyId",registration_revision as "registrationRevision",evidence_hash as "evidenceHash",status,
    reason,evidence_ref as "evidenceRef",assessment,review_reason as "reviewReason",requested_by as "requestedBy",to_char(expires_on,'YYYY-MM-DD') as "expiresOn"
    from academic_decisions where student_programme_id = $1 and period_id = $2 order by id desc`,[programme.id,period.id])).rows;
  const context = {policy,period,attempts,decisions,recognitions:await loadCreditRecognitions(db,programme.id),statusRevision:programme.statusRevision || 0,curriculum:await loadCurriculum(db,programme.programmeVersionId)};
  context.evidenceHash = academicEvidenceHash(context);
  context.latestResults = latestAcademicAttempts(attempts,period.startsOn);
  return context;
}
