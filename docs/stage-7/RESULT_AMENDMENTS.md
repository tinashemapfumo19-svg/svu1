# Stage 7 Result Amendments

## Delivered Slice

Published results can now be corrected only through an evidenced request and an independent approval. The original publication and every revised value are kept. This covers `EXM-15` (controlled amendment that preserves original values) and the roadmap exit gate "Amendments preserve original and revised values with authority and reason". It is a development pilot; the amendment policy itself needs Academic Board approval.

## Behaviour

- **Request** (`results.amend.request`, scoped).
  - Applies to one published result: an enrolled course result in a published batch for the period.
  - Needs the result's current revision, a whole-number mark from 0 to 100 that differs from the current mark, a category, a reason, and an evidence reference.
  - Categories are `marking_error`, `transcription_error`, `moderation`, `appeal`, and `academic_misconduct`.
  - One open amendment per result.
  - The amended snapshot keeps the original result's details and regrades the new mark under the grading policy captured when the batch was published.
- **Approval** (`results.amend.approve`, scoped).
  - Must come from someone other than the requester, enforced by a database check and the separation guard.
  - Re-checks the result revision; a stale request must be rejected and resubmitted.
  - Refused while the result supports approved recognized credit and the amendment would turn a pass into a fail. That credit must be revoked first.
  - On approval, `academic_results` (the official record) is updated with a revision bump and `amended_at`. Prerequisite, progression, credit, and academic-evidence checks therefore all see the new mark.
  - Approved progression and repeat decisions are bound to evidence hashes, so they stop counting for new registrations. The approval response lists affected recognized-credit and academic-decision IDs for follow-up.
- **History.** The published batch keeps the originally published rows. Each amendment keeps `from` and `to` snapshots and is immutable once reviewed (a database trigger enforces this, and deletes are blocked).
- **Students** see the amended mark with "(amended; published N)", and their GPA is recalculated. They receive a `results.amended` email.
- **Staff** see the current mark as "72 (amended from 38)", with amendment history and request and review forms on published batches.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/programmes/{id}/results/{periodId}/amendments` | `results.view` | Amendments, categories, and capabilities. |
| `POST /api/registry/programmes/{id}/results/{periodId}/amendments` | `results.amend.request` | `registrationId`, `courseId`, `revision`, `mark`, `category`, `reason`, `evidenceRef`. |
| `POST /api/registry/programmes/{id}/results/{periodId}/amendments/{amendmentId}/review` | `results.amend.approve` | `outcome` `approved`/`rejected` with `reason`. |

Permissions:
- `academic_registrar` requests.
- `examinations_officer` requests and approves.
- `academic_approver` approves.
- `system_administrator` holds both.

## Verification

Migration `044_result_amendments.sql`. Unit tests are in `test/result-amendments.test.js`. The desktop and mobile journey is in `e2e/result-amendments.spec.js`. It covers:

- a UI request, then self-review denial, a duplicate open request, an unchanged mark, and student denial;
- independent approval, after which the record is immutable and a stale revision is refused;
- a rejected moderation amendment leaving the result unchanged;
- the student seeing the amended mark, the originally published mark, and the recalculated GPA;
- the original batch rows kept;
- the notification and audit trail;
- staff and student UI rendering without horizontal overflow.

## Remaining Work

- Academic Board approval of amendment categories and authority levels. Some institutions require faculty or board approval for grade changes across a pass/fail boundary.
- Certificates issued against an amended result, once award issuance exists. Transcripts are handled: an amendment makes an issued transcript outdated, and staff reissue it (`docs/stage-7/TRANSCRIPTS.md`).
- A combined exam-board approval step before first publication (the results workflow's department and faculty review stages).
