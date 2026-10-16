# Stage 7 Assessment Plans and Mark Entry

## Delivered Slice

Each course offering can have a versioned, independently approved assessment plan made of weighted components. Allocated lecturers or examinations staff enter component marks with explicit absent, deferred, and exempt states. The lead lecturer or examinations staff submit a complete sheet. Someone else must approve it, and its calculated final marks then become a source for the period's official results batch.

This covers `EXM-02` (versioned assessment configuration), `EXM-06` (mark sheets built from confirmed registration and the plan), `EXM-08` (validated individual mark entry), `EXM-09` (batch mark upload with preview, rejection report, and idempotency), `EXM-10` (completion view of recorded and missing marks), and `EXM-13` (explicit exception states in place of silent defaults). It is a development pilot. Component structures and the absent/deferred/exempt rules need Academic Board approval.

## Behaviour

- **Plans** (`POST /api/assessment/offerings/{periodId}/{courseId}/plans`).
  - Drafted by the lead lecturer (an in-force `lead` allocation) or a scoped holder of `assessment.plan.manage`.
  - Each plan has 1-10 components. Each component has a unique upper-case code, a name, a whole-number weight, and a whole-number maximum mark. Weights must total 100.
  - Only one draft per offering at a time. Versions increase per offering.
  - A plan specifies `moderation`: `none` (existing plans and the API default), `internal`, or `internal_external`. Independent plan approval also approves this requirement. The drafting form retains the current plan's requirement when proposing a replacement.
  - Approval (`assessment.plan.approve`) must come from someone other than the drafter (a database check plus the separation guard). Approving a new version supersedes the current one. This is refused once marks under the current plan have been submitted, unless that submission was returned.
- **Mark entry** (`PUT .../marks`).
  - Allowed for lecturers with an in-force `lead`, `co_lecturer`, or `tutor` allocation on the offering, and for scoped examinations staff (`assessment.marks`). Marks can only be entered against the approved plan, for confirmed enrolments.
  - Each entry is one of:
    - a whole-number mark up to the component maximum;
    - `absent`, `deferred`, or `exempt`, each with a reason.
  - Every entry carries the revision it was based on. A stale revision returns `409`, so concurrent edits cannot silently overwrite each other.
  - Every change is copied to an append-only history table.
  - Entry is locked while a submission is live.
- **Final mark.**
  - Absent scores zero.
  - Exempt components are left out, and the remaining weights are rescaled.
  - Any deferral withholds the final mark.
  - A student exempt from every component has no final mark.
  - Marks round half up to a whole number.
- **Batch upload** (`POST .../imports`, same authority as mark entry).
  - **File format.** A CSV with `student_number`, `component`, `value`, and `reason` columns. `value` is a whole mark, or `ABSENT`, `DEFERRED`, or `EXEMPT` with a reason. Rows left out of the file keep their current marks. The panel offers a template prefilled with the class list and current values.
  - **Preview** (`mode: "preview"`) writes nothing. It returns a rejection report by row covering:
    - students not on the confirmed class list;
    - components not in the plan;
    - marks above the component maximum;
    - invalid values;
    - missing reasons;
    - student-component pairs repeated in the file (every copy is rejected).

    It also classifies each valid row as `new`, `changed`, or `unchanged`, and returns a baseline hash of the current marks.
  - **Apply** (`mode: "apply"`) needs the preview's baseline. It is refused if any row is rejected, or if any mark changed since the preview, so an upload never overwrites a newer entry. Only new and changed rows are written, each at the next revision and with history.
  - **Idempotency.** Each file reference (defaulting to the file name) applies once per plan. Replaying it returns the original outcome without writing, and reusing it for different content returns `409`. Applied files are kept in an append-only `assessment_mark_imports` table and audited as `assessment.marks.imported`.
  - **Locking.** Uploads are refused while a submission is live.
- **Submission** (`POST .../submit`).
  - Made by the lead lecturer or examinations staff.
  - Needs every enrolled student to have every component. The error lists the first missing entries.
  - Stores a hash of the marks and the calculated finals.
- **Review** (`POST /api/assessment/submissions/{id}/review`, `assessment.review`).
  - The outcome is `approved` or `returned`, with a reason.
  - The reviewer must be someone other than the submitter.
  - Approval re-checks the marks hash and enrolment count. Any change after submission must be returned and resubmitted.
  - Returning unlocks entry.
- **Moderation** (`POST /api/assessment/submissions/{id}/moderation`).
  - Where the approved plan requires moderation, approval is refused until all required stages are signed against the submission's marks hash. Returning for corrections remains available at any time.
  - Internal moderation requires scoped `assessment.moderate` (academic approvers); external sign-off requires scoped `assessment.external` (the new `external_examiner` role). Administrators have both permissions, but separation checks still apply.
  - Each decision supplies `stage`, `outcome` (`signed` or `changes_requested`), `evidenceRef`, and `reason`. Decisions are append-only and audited; there is one decision per stage per submission.
  - Neither the submitter nor anyone who has entered marks under this plan can moderate it. Internal and external reviewers must be different people. External review follows signed internal moderation.
  - A changes request blocks further sign-offs and approval. The sheet must be returned, corrected, and resubmitted. Earlier decisions remain visible, but cannot authorize a new submission.
  - Moderation and approval compare the actual confirmed registration IDs, marks hash, and completeness against the submission. Replacing one enrolment with another cannot pass merely because the count is unchanged.
  - Individual entry, upload, submission, and plan replacement take the plan row lock to serialize writes. An edit that wins the lock is included in the submission; an edit after submission receives `409`.
- **Into official results.** Approved submissions feed `POST /api/lms/periods/{periodId}/transfer` (see `docs/stage-6/LMS_INTEGRATION.md`).
  - For each course, native assessment marks take priority over LMS outcomes.
  - A course with any deferred student is not ready, and the transfer names it.
  - On transfer, the submission becomes `transferred` and is linked to the result batch. That batch still needs independent results review and calendar-gated publication.
  - If the batch is rejected at review, its submissions return to `approved` and its LMS batches to `accepted`. A later transfer creates a new batch under a fresh source reference.
- **Visibility.** Callers with no standing on an offering (no allocation and no scoped view, marks, or review permission) get `404` on reads and writes alike. Callers who can see the offering but lack the specific authority get `403`.
- **Deferred completion.** [Deferred sittings and completion review](DEFERRED_ASSESSMENT.md) resolve deferred component marks after a published sitting ends. Approved completion supersedes the live source sheet while preserving its original finals and decisions; a fresh submission requires all configured sign-offs and independent review again. Older accepted LMS outcomes cannot bypass that review.

## API

| Endpoint | Authority | Behaviour |
| --- | --- | --- |
| `GET /api/assessment/offerings/{periodId}/{courseId}` | Allocation or scoped view | Offering, plans, approved plan, mark sheet, missing marks, submissions, and capabilities. |
| `POST /api/assessment/offerings/{periodId}/{courseId}/plans` | Lead lecturer or `assessment.plan.manage` | `components`, `reason`, optional `moderation`. |
| `POST /api/assessment/plans/{planId}/approve` | `assessment.plan.approve` | `reason`. |
| `PUT /api/assessment/offerings/{periodId}/{courseId}/marks` | Teaching allocation or `assessment.marks` | `planId`, `entries[]` of `registrationId`, `componentCode`, `state`, `mark`, `reason`, `revision`. |
| `POST /api/assessment/offerings/{periodId}/{courseId}/imports` | Teaching allocation or `assessment.marks` | `mode` `preview`/`apply`, `planId`, `sourceRef`, `rows[]` of `studentNumber`, `componentCode`, `value`, `reason`; `baseline` to apply. |
| `POST /api/assessment/offerings/{periodId}/{courseId}/submit` | Lead lecturer or `assessment.marks` | `planId`, `reason`. |
| `POST /api/assessment/submissions/{id}/review` | `assessment.review` | `outcome` `approved`/`returned`, `reason`. |
| `POST /api/assessment/submissions/{id}/moderation` | Scoped internal/external authority | `stage`, `outcome`, `evidenceRef`, `reason`. |

Permissions:
- `academic_registrar` drafts plans.
- `academic_approver` approves plans and reviews marks.
- `examinations_officer` enters, submits, and reviews marks.
- `system_administrator` holds all four.

## Interface

Lecturers open an offering from **My teaching** in `#registry`. The assessment panel shows:

- the approved plan and any draft awaiting approval;
- a plan drafting form;
- the mark grid, with a state, mark, and reason for each component and a live final mark per student;
- an **Upload marks file** section with the template, a preview with its rejection report, and an apply button once a preview is clean;
- a count of missing marks with the submission status;
- submit and review forms where the caller has authority.

## Verification

Migration `051_assessment_moderation.sql` adds the sign-off gate. Unit tests cover configured stages, stale hashes, changes requests, and replacement enrolments with unchanged roster counts. The desktop/mobile assessment journey additionally covers scoped moderator/external-examiner authority, privileged submitter denial, internal-before-external ordering, distinct reviewers, immutable decisions, fresh moderation after return/resubmission, evidence references, and a concurrent mark save versus submission. Exam-order verification is recorded in [EXAM_ORDERS.md](EXAM_ORDERS.md).

Migrations `045_assessment_marks.sql` and `046_assessment_mark_imports.sql`. Unit tests in `test/assessment.test.js` cover component validation, final-mark rules, the marks hash, and upload validation (rejections by row, duplicates, and change classification). The desktop and mobile journey is in `e2e/assessment-marks.spec.js`. It covers:

- UI plan drafting, approval denied without plan-approval authority, and outsider `404`s;
- UI mark entry with a deferral, then stale-revision, over-maximum, and missing-reason refusals;
- UI submission with entry locked afterwards, review denied to the submitting lecturer, return, correction (deferral to absence), and approval;
- mixed assessment and LMS sources transferring once, with a retry refused;
- a rejected official batch releasing both sources, and the re-transfer creating a new batch and source reference;
- independent review and publication, and the student seeing the published marks;
- (`e2e/assessment-mark-upload.spec.js`) the template download, a rejected file reported by row with nothing saved, a quoted reason containing a comma, apply refused after another user's edit, re-preview and apply, replay and reused-reference refusal, an unchanged re-upload writing nothing, outsider `404`, and uploads locked after submission;
- audit events and layout without horizontal overflow.

## Remaining Work

- Academic Board approval of component structures, rounding, and the absent/deferred/exempt rules.
- Mandatory exam-order policy and retake attempt linkage (`EXM-07`). Exam orders (`EXM-01`) and the timetable (`EXM-03` to `EXM-05`) have development-pilot implementations in [EXAM_ORDERS.md](EXAM_ORDERS.md) and [EXAM_TIMETABLE.md](EXAM_TIMETABLE.md).
- Deferred-assessment completion: a sitting that resolves deferrals so a period with deferred students can reach official results.
- Academic Board agreement on mandatory moderation by programme, required sampling, and external-examiner authority (D-16). Per-plan internal and external sign-off is implemented by migration `051_assessment_moderation.sql`; sampling is currently recorded by evidence reference and reason, rather than a computed sample.
