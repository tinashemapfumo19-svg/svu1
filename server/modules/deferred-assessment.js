import { requestError } from '../support.js';

export function validateDeferredEntries(component,candidates,marks,entries) {
  if (!component) throw requestError(409,'The sitting component is no longer in the assessment plan.');
  if (!Array.isArray(entries) || !entries.length || entries.length !== candidates.length || entries.length > 5000) throw requestError(400,'Record one outcome for every assigned deferred candidate.');
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || Object.keys(entry).some((key) => !['registrationId','state','mark','reason','revision'].includes(key))
      || seen.has(entry.registrationId) || !candidates.some((row) => row.registrationId === entry.registrationId)
      || !Number.isInteger(entry.revision) || !['mark','absent'].includes(entry.state)
      || (entry.state === 'mark' ? !Number.isInteger(entry.mark) || entry.mark < 0 || entry.mark > component.maxMark || Boolean(entry.reason)
        : entry.mark !== undefined && entry.mark !== null || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 500)) throw requestError(400,'Each candidate needs a whole mark within the component maximum, or an absence with a reason.');
    const candidate = candidates.find((row) => row.registrationId === entry.registrationId);
    const current = marks.find((row) => row.registrationId === entry.registrationId && row.componentCode === component.code);
    if (!current || current.state !== 'deferred' || current.revision !== candidate.markRevision || entry.revision !== current.revision) throw requestError(409,'A candidate is no longer deferred at the assigned revision. Cancel and rebook the sitting.');
    seen.add(entry.registrationId);
  }
  return entries.map((entry) => ({...entry,componentCode:component.code}));
}

export function assertDeferredSittingReady(sitting,snapshot,now = Date.now()) {
  if (sitting.status !== 'scheduled' || !sitting.planId) throw requestError(409,'A scheduled deferred sitting is required.');
  const published = snapshot?.sittings?.find((row) => row.id === sitting.id);
  if (!published || published.revision !== sitting.revision) throw requestError(409,'Publish the current sitting revision before recording completion.');
  const extra = Math.max(0,...(published.arrangements || []).map((row) => row.extraMinutes));
  if (new Date(sitting.startsAt).getTime() + (sitting.durationMinutes + extra) * 60000 > now) throw requestError(409,'Completion can only be recorded after the sitting ends.');
}

export const deferredCompletionSelect = `select id::int,sitting_id as "sittingId",sitting_revision as "sittingRevision",plan_id as "planId",marks_hash as "marksHash",
  source_submission_id::int as "sourceSubmissionId",entries,evidence_ref as "evidenceRef",reason,status,submitted_by as "submittedBy",submitted_at as "submittedAt",
  reviewed_by as "reviewedBy",review_reason as "reviewReason" from assessment_deferred_completions`;

export async function deferredCandidatesFor(db,sittingId) {
  return (await db.query(`select dc.registration_id as "registrationId",dc.mark_revision as "markRevision",s.student_number as "studentNumber",s.account_id as "accountId",p.legal_name as "legalName"
    from exam_deferred_candidates dc join student_registrations sr on sr.id = dc.registration_id join student_programmes sp on sp.id = sr.student_programme_id join students s on s.id = sp.student_id join people p on p.id = s.person_id
    where dc.sitting_id = $1 order by s.student_number`,[sittingId])).rows;
}
