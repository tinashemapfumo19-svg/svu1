import { createHash } from "node:crypto";
import { requestError, todayIso } from "../support.js";
import { hasPrerequisiteCredit } from "./credit-evidence.js";

export function validateExceptionParameters(kind, parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw requestError(400,"Exception parameters are required.");
  if (kind === "credit_limit" && Object.keys(parameters).length === 1 && typeof parameters.maxCredits === "number" && Number.isFinite(parameters.maxCredits)
    && parameters.maxCredits > 0 && parameters.maxCredits <= 480 && Number.isInteger(parameters.maxCredits * 2)) return {maxCredits:parameters.maxCredits};
  if (kind === "timetable_clash" && Object.keys(parameters).length === 1 && Array.isArray(parameters.courseIds) && parameters.courseIds.length === 2
    && parameters.courseIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200) && parameters.courseIds[0] !== parameters.courseIds[1]) return {courseIds:[...parameters.courseIds].sort()};
  if (kind === "prerequisite_waiver" && Object.keys(parameters).length === 1 && typeof parameters.courseId === "string" && parameters.courseId.length > 0 && parameters.courseId.length <= 200) return {courseId:parameters.courseId};
  throw requestError(400,"Choose a bounded credit limit, two distinct courses for a timetable-clash exception, or one course for a prerequisite waiver.");
}

export function exceptionKey(kind, parameters) {
  if (kind === "timetable_clash") return JSON.stringify([kind,[...parameters.courseIds].sort()]);
  if (kind === "prerequisite_waiver") return JSON.stringify([kind,parameters.courseId]);
  return kind;
}

export function registrationExceptionEvidence(context) {
  const {programme,period,offerings,registration,academic,existingCourses,priorCourses} = context;
  const source = {programmeId:programme.id,status:programme.status,curriculum:programme.programmeVersionId,period,
    registrationId:registration.id,revision:registration.revision,selectedCourses:[...registration.selectedCourses].sort(),
    offerings:offerings.map((row) => ({...row,prerequisites:[...row.prerequisites].sort(),meetings:[...row.meetings].sort((a,b) => a.day - b.day || a.start - b.start || a.end - b.end)})).sort((a,b) => a.courseId.localeCompare(b.courseId)),academicEvidenceHash:academic.evidenceHash,policy:academic.policy,
    existingCourses:[...existingCourses].sort(),priorCourses:[...priorCourses].sort()};
  return {source,hash:createHash("sha256").update(JSON.stringify(source)).digest("hex")};
}

export function applicableRegistrationException(exceptions,kind,parameters,revision,evidenceHash,today = todayIso()) {
  const key = exceptionKey(kind,parameters);
  const latest = exceptions.find((row) => exceptionKey(row.kind,row.parameters) === key);
  return latest?.status === "approved" && latest.registrationRevision === revision && latest.evidenceHash === evidenceHash && latest.expiresOn >= today ? latest : null;
}

export function exceptionHasTarget(context,kind,parameters) {
  const selected = context.offerings.filter((row) => context.registration.selectedCourses.includes(row.courseId));
  if (kind === "credit_limit") {
    const credits = selected.reduce((sum,row) => sum + Number(row.credits),0);
    return credits > context.period.creditLimit && credits <= parameters.maxCredits;
  }
  // A waiver must name a selected course whose prerequisites are not met by results or recognized credit.
  if (kind === "prerequisite_waiver") {
    const course = selected.find((row) => row.courseId === parameters.courseId);
    return Boolean(course?.prerequisites?.some((id) => !hasPrerequisiteCredit(context.academic,id)));
  }
  const pair = parameters.courseIds.map((id) => selected.find((row) => row.courseId === id));
  return pair.every(Boolean) && pair[0].meetings.some((a) => pair[1].meetings.some((b) => a.day === b.day && a.start < b.end && b.start < a.end));
}
