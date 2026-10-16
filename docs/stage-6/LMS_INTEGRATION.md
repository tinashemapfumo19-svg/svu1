# Stage 6 LMS Integration Boundary

## Decision

ADR-008 was accepted on 2026-10-04 by the project owner: SVU **integrates a dedicated LMS** (roadmap Option B) instead of building one.

- SVU remains the source of truth for users, course offerings, teaching allocations, enrolments, and official results.
- The LMS product (for example Moodle) has not been chosen yet, so this boundary is product-neutral.
- Course chatrooms and online classes are required SVU capabilities. They are expected to come from the chosen LMS or its video integration, and must be confirmed during product selection.

## Delivered Slice

1. **Provisioning manifest** (`GET /api/lms/v1/manifest`, `lms.sync`).
   - **Contents.** A versioned (`schemaVersion: 1`) snapshot of every registration period that is open or closed and whose official results are not yet published. Each course offering (`offeringKey` = `periodId:courseId`) lists:
     - course, programme, intake, period, and dates;
     - teachers: approved allocations in force today, held by active staff, with SVU role mapped to an LMS role (`lead`/`co_lecturer` to `editingteacher`, `tutor` to `teacher`, plus `moderator` and `examiner`);
     - students: confirmed enrolments;
     - a SHA-256 `version` that ignores ordering.
   - **Sync model.** The connector compares versions and applies only changed offerings. SVU sends no push events, so the manifest is always derived from authoritative records and can be re-read safely.
   - **Retirement.** Workspaces drop out of the manifest once the period's official results are published.
2. **Outcome return** (`POST /api/lms/v1/outcomes`, `lms.sync`).
   - **Rules.**
     - One batch per offering, with a unique external reference.
     - Whole-number marks from 0 to 100, unique student numbers, and an order-independent checksum.
     - The batch must cover exactly the confirmed class list; missing and unexpected students are named.
   - **Replays.** Replaying the same reference and checksum returns the original (`replayed: true`). Reusing a reference for different content, or sending a second live batch for the offering, returns `409`. Rejected batches can be resent under a new reference.
3. **Review** (`POST /api/lms/outcomes/{id}/review`, `lms.outcomes.review`, scoped).
   - Examinations staff, registrars, or administrators accept or reject each course's outcomes. The connector account can never review.
   - Accepting re-checks the roster.
4. **Transfer to official results** (`POST /api/lms/periods/{periodId}/transfer`, `lms.outcomes.review` plus `results.import`).
   - **Preconditions.** Every course with enrolments needs an approved native assessment sheet with complete numeric finals, or accepted LMS outcomes where no native submission governs the offering. Native submitted or superseded sheets block fallback to older LMS outcomes, including after deferred completion; the updated sheet needs fresh moderation and approval. Superseded native-only periods remain visible in the transfer workbench. Approved marks are assembled into one period batch and imported through the existing results module, which still needs closed registration, full-roster reconciliation, and a published GPA rule set.
   - **Exactly once.** The source reference is derived from the approved native submission IDs and accepted LMS batch IDs, with a rejected-batch revision. A retry after a partial failure finds the earlier import instead of creating a second one.
   - **After transfer.** The LMS batches are marked `transferred` with the result batch ID. The official batch then needs the usual independent results review and calendar-gated publication; the importer cannot review it.
   - **Rejected batch.** Rejecting the official batch at review returns its LMS batches to `accepted` and its assessment submissions to `approved`. The source-reference fingerprint includes the period's count of rejected batches, so the next transfer creates a new batch instead of finding the rejected one.
   - **Who does what.** Examinations officers (no `results.import`) cannot transfer, so registrars transfer and examinations officers review and publish.

`lms_connector` is a service role holding only `lms.sync`.

## Interface

`#registry` has an **LMS grade returns** panel. It shows each period's courses with the status of their live outcome batch, accept/reject review forms, and a transfer form (with a GPA rule set selector) once every course is accepted. Panel open states now reset on sign-out.

## Verification

Migration `043_lms_integration.sql`. Unit tests are in `test/lms.test.js`. The desktop and mobile journey is in `e2e/lms-integration.spec.js`. It covers:

- manifest teachers derived from an approved allocation, students from confirmed enrolments, an uncovered course with no teachers, and registrar denial;
- a partial class list refused, an idempotent replay, a tampered reuse of a reference refused, and a second live batch refused;
- connector self-review denial, rejection, and a corrected resend;
- UI acceptance;
- transfer refused while incomplete, without `results.import`, and while registration is open;
- UI transfer after closing the period, then a retry refused;
- importer self-review denial, then independent review and publication;
- the student seeing the LMS mark, and the period leaving the manifest;
- audit trail.

## Remaining Stage 6 Work

- LMS product selection and a connector for it, including service-account credentials, rotation, and MFA policy for non-interactive clients.
- Confirmation of chat, online classroom, recording and retention, and attendance capabilities in the chosen LMS (`LMS-*` required interaction capabilities).
- Library and repository scope (`LIB-01` to `LIB-06`).
- Migration of current learning materials, open assignments, and submissions, if owners require it.
