import { createHash } from "node:crypto";
import { parseEffectiveDate, requestError, todayIso } from "../support.js";

export function validateCreditSource(kind,source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw requestError(400,"A structured credit source is required.");
  if (kind === "internal_transfer") {
    if (Object.keys(source).some((key) => !["registrationId","courseId"].includes(key)) || [source.registrationId,source.courseId].some((value) => typeof value !== "string" || !value || value.length > 200)) throw requestError(400,"Internal transfer requires source registration and course identifiers.");
    return {registrationId:source.registrationId,courseId:source.courseId};
  }
  if (!["external_transfer","exemption"].includes(kind) || Object.keys(source).some((key) => !["institution","course","reference","credits","completedOn"].includes(key))
    || [source.institution,source.course,source.reference].some((value) => typeof value !== "string" || !value.trim() || value.length > 300)
    || typeof source.credits !== "number" || !Number.isFinite(source.credits) || source.credits <= 0 || source.credits > 480 || !Number.isInteger(source.credits * 2) || !source.completedOn) throw requestError(400,"External credit requires institution, source course, unique evidence reference, credits and completion date; marks/grades are not accepted.");
  const completedOn = parseEffectiveDate(source.completedOn);
  if (completedOn > todayIso()) throw requestError(400,"External credit evidence cannot claim future completion.");
  return {institution:source.institution.trim(),course:source.course.trim(),reference:source.reference.trim(),credits:source.credits,completedOn};
}

export function creditEvidenceHash(snapshot) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key,canonical(value[key])])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
}
export function applicableCreditRecognitions(context) {
  if (context.policy?.rules.recognisedCredits !== true) return [];
  return (context.recognitions || []).filter((row) => row.status === "approved" && row.programmeVersionId === context.period.programmeVersionId && row.completedOn < context.period.startsOn
    && context.curriculum.some((entry) => entry.courseId === row.courseId && Number(entry.credits) === row.credits)
    && !context.attempts.some((attempt) => attempt.courseId === row.courseId));
}
export function hasPrerequisiteCredit(context,courseId) {
  return Boolean(context?.latestResults?.find((row) => row.courseId === courseId)?.result?.passing || context && applicableCreditRecognitions(context).some((row) => row.courseId === courseId));
}
export function usedCreditRecognitions(context,offerings,selectedCourses) {
  return applicableCreditRecognitions(context).filter((row) => offerings.some((course) => course.courseId === row.courseId && course.requirementType === "core" && !selectedCourses.includes(row.courseId))
    || offerings.some((course) => selectedCourses.includes(course.courseId) && course.prerequisites.includes(row.courseId))
    || context.period.yearOfStudy > 1 && context.curriculum.some((entry) => entry.courseId === row.courseId && entry.yearOfStudy === context.period.yearOfStudy - 1));
}
export async function loadCreditRecognitions(db,programmeId) {
  return (await db.query(`select id,programme_version_id as "programmeVersionId",course_id as "courseId",policy_id as "policyId",kind,credits::float as credits,
    to_char(completed_on,'YYYY-MM-DD') as "completedOn",status,source,reason,evidence_ref as "evidenceRef",requested_by as "requestedBy",
    reviewed_by as "reviewedBy",review_reason as "reviewReason",revoke_reason as "revokeReason",evidence_hash as "evidenceHash",to_char(expires_on,'YYYY-MM-DD') as "expiresOn"
    from credit_recognitions where student_programme_id = $1 order by id desc`,[programmeId])).rows;
}
