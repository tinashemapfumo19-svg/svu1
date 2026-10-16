# Deferred Assessment Completion

Development pilot for deferred sittings and exception-mark completion (EXM-03 to EXM-05, EXM-08, EXM-13). This implements the current D-01 policy: a deferral withholds the student's final mark and blocks the complete period results batch until resolved. It does not introduce incomplete grades or supplementary result batches. Institutional approval remains open.

## Workflow

1. Examinations staff schedule a sitting against an approved assessment plan and component, selecting confirmed enrolled candidates whose component is currently deferred. Each assignment retains the mark revision. Ordinary sittings still cover the full course roster.
2. A different colleague publishes the timetable. Deferred capacity and clashes use assigned candidates, not the entire class. Students see only their own assigned deferred sittings; peer candidate lists are omitted. Notifications reach only those assigned.
3. After the published sitting ends, an allocated mark editor or scoped examinations officer records one whole-number mark or reasoned absence per assigned candidate, with an evidence reference and reason.
4. A different scoped assessment reviewer approves or returns the completion. Approval rechecks the sitting revision, published snapshot, full marks hash, exact candidate revisions and enrolments, current plan, and source submission. Stale work must be returned and resubmitted or the sitting rebooked.
5. Approved outcomes update the component marks with append-only history tied to the completion and its submitter. Any live source assessment submission becomes `superseded`; its original finals, hash, review, and moderation decisions remain unchanged, with a separate append-only supersession record.
6. The lecturer submits the updated complete sheet. All configured moderation and external stages and independent assessment review are required again. Accepted older LMS marks cannot bypass this fresh approval. Only then can official results be transferred, independently reviewed, and published through the existing results window.

## Controls

- Maker-checker separation, permission-specific programme/intake scope, and offering allocation apply to completion entry and review.
- No candidate can be assigned to two unfinished active deferred sittings for the same component. Completed sittings remain history and do not prevent a later independently recorded deferral from being booked again.
- Changing or cancelling a sitting is refused while its completion awaits review or is approved. Return pending completion first; approved completion evidence is immutable.
- Pending completions prevent replacement of the approved plan. Mark edits after completion submission invalidate its evidence hash rather than silently overwriting the newer sheet.
- An existing non-rejected official results batch blocks completion. Transferred/published results use the existing official amendment workflow, not this endpoint.
- Timetable changes use a period advisory lock; completion additionally locks the plan, results period, and live submission. Concurrent review cannot apply the same outcome twice.
- Candidate assignments and supersessions are append-only. Completion evidence is frozen at submission; only its first independent review can change review fields.

## API

| Endpoint | Payload |
| --- | --- |
| `POST /api/exams/periods/{periodId}/sittings` | Existing sitting fields plus `deferred: {planId, componentCode, registrationIds}`. Optional approved `orderId` follows the existing order matching rules. |
| `POST /api/assessment/deferred-sittings/{sittingId}/completions` | `entries` of `{registrationId, revision, state: "mark", mark}` or `{registrationId, revision, state: "absent", reason}`, plus `evidenceRef` and `reason`. |
| `POST /api/assessment/deferred-completions/{id}/review` | `outcome: "approved"` or `"returned"`, plus `reason`. |

Staff timetable context includes `deferredGroups`, assigned candidates, completion flags, and publication blockers. Assessment context includes `deferredSittings` with candidate revisions, readiness, and retained completion history. The timetable offers candidate selection; the assessment panel provides completion entry and review. Examinations staff can open marks directly from timetable offerings.

## Verification

`test/deferred-assessment.test.js` covers candidate coverage, revisions, marks, absence reasons, publication/timing, and subset clash/capacity calculations. The assessment browser journey covers approved deferred sheets, candidate-only visibility and notifications, unauthorized and stale entry, return/resubmission, concurrent review, independent completion approval, source preservation, fresh moderation, LMS fallback refusal, and official result transfer/review/publication on desktop and mobile.

Affected-workflow isolated regression passed 142 unit tests, six assessment/timetable/LMS browser journeys, and all 22 smoke checks. Final expanded-panel visual reruns passed on desktop and mobile, with no page overflow; narrow completion grids retain full candidate numbers and readable outcome labels inside their scrollable wrapper. Evidence is under `data/build-deferred-verified` and `data/build-deferred-mobile-layout-verification`. All temporary databases and test servers were torn down. This verifies the development slice, not every remaining rebuild workflow or production policy gate.
