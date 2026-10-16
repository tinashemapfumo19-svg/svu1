# Stage 7 Candidate Arrangements

Optional development capability extending `EXM-19`, the examination timetable and D-26. Migrations: `057_exam_arrangements.sql` and `058_exam_arrangement_encryption.sql`. This does not establish automatic extra-time entitlements, mandatory staffing ratios or institutional medical policy.

## Workflow

1. A confirmed candidate requests an arrangement against their current published sitting, or a scoped arrangements officer prepares a request for a confirmed candidate. Requests record extra minutes, separate-room choice, a private note and a reference to evidence held under restricted custody elsewhere. There is no clinical-document upload in this slice.
2. A different authorized officer approves or returns the request. Approval requires a short operational instruction. Separate-room approval selects a different active managed venue and an active invigilator already allocated to the sitting.
3. Approval pins a hash of the base sitting facts. Roster revisions and other candidates' approvals do not invalidate the request; changing its base time, duration, venue, capacity or assessment source does. Stale requests must be returned and recreated; stale approvals must be revoked and independently replaced.
4. Approval and revocation increment the sitting/timetable revisions and return the timetable to draft. A different timetable publisher reviews the resulting operational bookings. Pending requests, stale approvals, absent dedicated staff, concurrent room duties, venue changes, capacity problems and clashes block publication.
5. Publication freezes personalized arrangements. Candidates see only their own extended time, room and operational instruction, including their calendar end time. Invigilators see only their assigned room's candidates and instructions. Unpublished changes do not silently replace these published views.
6. A candidate can withdraw a pending request. An authorized officer can withdraw a request or revoke an approval with a private reason. Historical requests, decisions and operational instructions are immutable; correction creates a new request.

Extra time is technically bounded to 0-240 minutes in 15-minute steps, and the total exam duration cannot exceed the existing 480-minute scheduler limit. These are validation limits, not an entitlement policy. Zero extra minutes without a separate room permits an independently reviewed assistive instruction.

## Privacy And Authority

- New high-risk role `exam_arrangements_officer` grants `exams.arrangements.manage` and `exams.arrangements.review`. These permissions are also granted to system administrators, but not ordinary examination officers, registrars, lecturers or invigilators by default. Programme/intake scope is enforced on private reads and mutations; wrong-scope requests return `404`.
- `registry.self` provides only the student's own cases. A new request requires current confirmed candidacy; retained case access does not. Students cannot select someone else's registration, view private staff history or revoke an approved decision.
- New private request notes, evidence references, review notes and closure notes use the existing AES-256-GCM envelope and `SVU_DATA_KEY`. Stored history retains ciphertext. Decryption happens only after case authorization; operational timetable/resource code never decrypts these fields.
- Migration 058 preserves readability of any earlier plaintext development-pilot records using an immutable encryption marker. It does not silently rewrite previously immutable evidence. Any installation with such records needs a separately governed encryption/backfill and retention decision before production. New requests are encrypted, and corrupted envelopes or an incorrect key fail closed.
- Generic audits and notifications contain only the action and sitting/case identifiers, not private notes, evidence references or review reasons. Operational views use explicit field filters. A reviewer must write a non-clinical operational instruction; the system cannot reliably detect sensitive content mistakenly entered in that shared field.
- Evidence remains a reference, not a copied medical record. Production evidence custody, health-data handling, access review, retention, key rotation and recovery require institutional approval.

## Operational Effects

Main-room candidates exclude those assigned to alternative rooms. Each occupied room has its own capacity count, dedicated roster and booking duration extended by the greatest extra time in that room. Student clashes use each individual's duration, not the room maximum for every student. Separate rooms aggregate candidates sharing the same managed venue.

Cross-period room and invigilator checks include these extended bookings and the last published resource segments. Revoking an arrangement does not release a published commitment until the changed timetable is republished. Resource mutations use the existing global resource lock before the period lock, serializing concurrent reviews and scheduling changes.

Deferred completion cannot be submitted until the latest published candidate end time. Paper package release windows end by the recipient's own published room end, rather than the unadjusted sitting end; an arrangement revision invalidates older packages through the existing sitting/publication checks.

## API And Interface

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/exams/arrangements/sittings` | Scoped future-sitting coordinator queue |
| `GET /api/exams/arrangements/history` | Scoped metadata-only case search and pagination |
| `GET /api/registry/me/programmes/{id}/exam-arrangements` | Own retained case search and pagination |
| `GET /api/exams/sittings/{id}/arrangements` | Authorized private cases, history and preparation choices |
| `POST /api/exams/sittings/{id}/arrangements` | Staff request for a confirmed candidate |
| `POST /api/exams/arrangements/{id}/review` | Revision-bound independent approve/return |
| `POST /api/exams/arrangements/{id}/close` | Revision-bound withdrawal/revocation |
| `GET /api/exams/me/sittings/{id}/arrangements` | Own case view only |
| `POST /api/exams/me/sittings/{id}/arrangements` | Own request against the current published revision |
| `POST /api/exams/me/arrangements/{id}/close` | Own pending withdrawal only |

The Registry coordinator queue identifies course, paper, intake and time. Authorized timetable staff can open the same private case workspace. The student timetable provides an own-request command and personalized published instructions.

## Historical Access

Separate case indexes retain discovery after cancellation, the sitting date, removal from confirmed candidacy or disappearance from the current timetable. Students must own the programme and case; staff need the private arrangement permission within programme/intake scope. Authorization precedes private-note decryption. Historical ownership does not authorize a new request.

Indexes expose only selected case/sitting metadata, not notes, evidence, account identifiers or scopes. Literal case-insensitive search covers course, paper, intake and student number; own output omits the student number. Status filters, bounded page sizes (1-100, default 25) and offsets apply after staff scope filtering, including the total count. This follows the existing in-memory scoped-list pattern, not a claim of production-scale SQL pagination. Responses are not cached.

Cancelled or stale cases cannot be approved, and new requests are unavailable outside their existing current/future scheduling rules. Pending retained cases can still be independently returned or withdrawn by their owner. Approved historical cases remain readable without an inappropriate revoke command. No history or encrypted evidence is rewritten.

Private student indexes and panels clear on logout, session expiry and programme/application switch; generation guards discard late responses from departed contexts. Registry authentication loss resets all workspace caches before another user signs in, and responses from departed authenticated sessions cannot restore their data. Detached examination-panel toggle events no longer restore old open-state preferences.

## Verification

`test/exam-arrangements.test.js` covers authenticated encryption/readback, request bounds, source hashing, candidate/roster room splitting, individual clashes, private output filtering, published extended commitments, recipient-specific paper windows, deferred completion timing and seed permission parity.

The desktop/mobile examination journey exercises private request/review controls, scope refusals, reviewer separation, changed-source return, concurrent review, pending-publication refusal, multiple approvals, personalized room/time/calendar output, room-specific duties, paper delivery bounds, published commitments through revocation, own withdrawal, generic audit/notification privacy, encrypted database/history storage and direct immutable-evidence mutation refusal. Database probes are restricted to isolated integration databases and rolled back.

2026-10-05 verification: all 166 unit tests pass. The isolated encrypted-workflow regression (`data/build-arrangements-verified`) passed migration/seed, its unit phase, all six examination/assessment/LMS desktop/mobile journeys and all 22 smoke checks, including encrypted database/history assertions and immutable-evidence mutation probes. The final shared-room-duty run (`data/build-arrangements-final`) passed migration/seed, all unit tests, all six examination/staff-record/teaching-allocation desktop/mobile journeys and all 22 smoke checks. The final UI-only run (`data/build-arrangements-layout-final`) passed both examination viewports after replacing a vertically overflowing long queue label with a wrapped two-line label, with explicit text-within-button bounds checks and inspected screenshots. All isolated databases and test servers were torn down. This is scoped verification, not a full-suite rerun.

Historical-access checkpoint, 2026-10-05: all 171 unit tests pass, including bounded metadata searches, scoped counts, former-candidate access, private field whitelists and stale student-context reads. The first archive regression (`data/build-arrangement-history-verified`) passed four examination/assessment journeys and all 22 smokes. The subsequent backend regression (`data/build-arrangement-history-final`) passed six examination/student-finance/programme-transfer journeys and all 22 smokes. Those runs preceded the final session-cache correction.

The latest isolated regression (`data/build-arrangement-history-session-verified`) passed migration/seed, all unit tests, ten desktop/mobile examination/MFA/component-layout checks and all 22 smokes. Examination journeys cover cancelled-sitting discovery with an empty exam timetable, own-only metadata and details, scope/permission refusals, pagination/status search, historical return/withdrawal, refusal of cancelled approval/new requests, and authentication loss followed by another student or lower-privilege staff sign-in without retained private data. Session-expiry UI checks inject an HTTP 401; real session revocation is covered separately by foundation smokes. Long-title component checks use synthetic metadata and real module markup, distinct from the real isolated database workflows. Screenshots were inspected. Database `svu_rebuild_it_1791167119706` was dropped and its test server stopped.

The preceding session regression (`data/build-arrangement-history-session-final`) remains failed: its examination journey toggled an already open panel after sign-in. The correction ignores detached old-panel toggle events and explicitly opens a closed panel in the test. Its result is not relabelled as passed. Verification is scoped, not a full browser-suite rerun.

The subsequent [candidate manifest slice](EXAM_MANIFESTS.md) pins newly published ordinary candidacy as well as deferred cohorts. Self-request capability and validation now require membership in that published cohort; a later confirmed student must wait for republication. Retained historical-case access is unchanged. Its latest isolated examination journeys also cover these arrangement changes on both viewports.

Local migrations and the canonical notification template remain applied without reseeding; these slices needed no new migration. The latest development app is healthy at `http://127.0.0.1:4177/#registry` (PID 13552, launcher session 19376, logs `data/dev-exam-manifests-cohort-lock.log` and `.err.log`). Production acceptance, seating, mandatory rules, evidence custody and encryption/retention governance remain open.
