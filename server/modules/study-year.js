import { todayIso } from "../support.js";

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

export function studyYearState(registrations, status, asOf = todayIso()) {
  if (!validDay(asOf)) throw new TypeError("Study-year projection requires an ISO calendar date.");
  const history = [], unresolved = [];
  for (const row of registrations) {
    const progression = row.progression;
    if (!row.registrationId || !row.referenceNumber || !validDay(row.startsOn) || !validDay(row.endsOn) || row.endsOn < row.startsOn
      || !Number.isInteger(row.yearOfStudy) || row.yearOfStudy < 1 || row.yearOfStudy > 8
      || !["S1","S2","S3"].includes(row.term) || !row.academicPeriodId || !row.programmeVersionId
      || typeof row.confirmedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(row.confirmedAt) || !Number.isFinite(Date.parse(row.confirmedAt))
      || row.yearOfStudy > 1 && (!progression || progression.kind !== "progression" || progression.status !== "approved"
        || !Number.isSafeInteger(Number(progression.id)) || Number(progression.id) < 1 || !progression.policyId
        || !/^[a-f0-9]{64}$/.test(progression.evidenceHash || ""))) {
      unresolved.push(row.registrationId);
      continue;
    }
    history.push({registrationId:row.registrationId,referenceNumber:row.referenceNumber,academicPeriodId:row.academicPeriodId,
      programmeVersionId:row.programmeVersionId,periodName:row.periodName,yearOfStudy:row.yearOfStudy,term:row.term,
      startsOn:row.startsOn,endsOn:row.endsOn,confirmedAt:row.confirmedAt,progressionDecisionId:progression?.id || null});
  }
  history.sort((a,b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn) || a.registrationId.localeCompare(b.registrationId));
  const recorded = history.filter((row) => row.confirmedAt.slice(0,10) <= asOf);
  const effective = recorded.filter((row) => row.startsOn <= asOf);
  // Lower-year repeat enrolments cannot undo a previously confirmed higher level.
  const source = [...effective].sort((a,b) => b.yearOfStudy-a.yearOfStudy || b.startsOn.localeCompare(a.startsOn) || b.registrationId.localeCompare(a.registrationId))[0] || null;
  return {asOf,state:unresolved.length ? "reconciliation_required" : source ? "recorded" : recorded.length ? "scheduled" : "not_registered",
    yearOfStudy:unresolved.length ? null : source?.yearOfStudy || null,source:unresolved.length ? null : source,
    active:status === "onboarded",currentPeriods:status === "onboarded" ? effective.filter((row) => row.endsOn >= asOf) : [],
    upcoming:recorded.filter((row) => row.startsOn > asOf),history,unresolvedRegistrationIds:unresolved};
}

// Only immutable receipt fields enter the projection; no live calendar or intake arithmetic.
export const studyYearSelect = `coalesce((select jsonb_agg(jsonb_build_object(
  'registrationId',sr.id,'referenceNumber',sr.reference_number,
  'academicPeriodId',sr.confirmation->'academicPeriodId','programmeVersionId',sr.confirmation->'programmeVersionId',
  'periodName',sr.confirmation->'periodName','startsOn',sr.confirmation->'startsOn','endsOn',sr.confirmation->'endsOn',
  'yearOfStudy',sr.confirmation->'yearOfStudy','term',sr.confirmation->'term','confirmedAt',sr.confirmation->'confirmedAt',
  'progression',sr.confirmation->'academicEvidence'->'progression'))
  from student_registrations sr where sr.student_programme_id = sp.id and sr.status = 'confirmed'),'[]'::jsonb) as "studyYearRegistrations"`;

export function withStudyYear(row) {
  const {studyYearRegistrations,...programme} = row;
  const registrations = studyYearRegistrations.map((row) => row.programmeVersionId === programme.programmeVersionId ? row : {...row,programmeVersionId:null});
  return {...programme,studyYear:studyYearState(registrations,programme.status)};
}
