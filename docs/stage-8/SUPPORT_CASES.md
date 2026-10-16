# Stage 8 Student Support Cases

Development implementation of `COM-06` and the roadmap's student support-case workflow. Feedback/contact is handled as retained student-programme cases, not anonymous mail or untracked outbound messages. Stage 8 and institutional production exit gates remain open.

## Access And Custody

`support.self` is granted to the student role; applicant/admissions authority alone does not grant access. A student can create a case only for a programme record currently owned by the account. Pending onboarding, inactive and retained transfer records remain eligible for support without bypassing onboarding or registration eligibility. The current student-programme owner controls subsequent self-service access, including after independently approved duplicate merges. Case origin and intake are immutable; a programme transfer does not reroute the original case into another intake.

Staff roles are explicit: `support_officer` grants `support.view` and `support.manage`; `support_manager` additionally grants `support.escalate`. Administrators receive these permissions, but registrars, finance, teaching and auditors do not gain support access implicitly. Only roles granting the requested support permission lend their programme/intake scope. An unrelated global role cannot widen case access or assignee eligibility.

Scoped intake metadata is selected before queue source SQL. Filters, totals and SQL pagination operate only within authorized sources. Detail/mutation requests deny wrong ownership or scope before decrypting messages. Missing/inaccessible cases return 404. Replies, routing, status changes and history are not public endpoints; responses use `no-store`.

## Workflow

- Categories: academic, registration, finance, learning, feedback and other. These are development routing values, not approved institutional taxonomy.
- Priority: low, normal, high and urgent; students create at normal priority, staff triage. No response deadline or emergency-service guarantee is inferred.
- Status: open, in progress, waiting student, resolved and closed.
- Assignment: active accounts with current effective support-management authority for the case's intake. Assignment does not grant extra scope or hide a case from other authorized support staff.
- Escalation: a scoped officer can reasonedly route a live case to an active, scope-authorized support manager. The escalation count/history is retained. Only manager authority can triage/resolve an escalated case; ordinary officers may still comment. Terminal resolution clears the live escalation flag, not the historical count.
- Comments: student messages are always public to the case's current owner and authorized support team. Staff can choose public replies or staff-only notes. Staff-only notes and routing reasons are excluded from student views. Student-visible status history redacts internal reasons/actions.
- Resolution: assignment is required before progression/waiting/resolution. A resolution reason is student-visible. A resolved case can be explicitly closed by its owner or scoped support staff. A resolved/closed case can be explicitly reopened with a reason; timestamps clear while retained history remains.
- Revisions: a row lock and expected revision protect every mutation. Competing updates do not silently overwrite each other. Case creation and comments also carry bounded, author-bound request keys and keyed normalized payload digests; identical retries return the existing result and changed-key reuse fails. Unkeyed private-message hashes are not stored for offline plaintext guesses.

No case deletion or comment editing is exposed. Origin fields are database-immutable. Comments/history are append-only, and every workflow change has one retained revision event. Subject, messages and reasons are authenticated-encrypted with the existing `SVU_DATA_KEY` envelope; production key requirements are unchanged. Generic audit records include action/revision/status/category/priority/escalation/visibility, never subject, message or private routing text. Read access is also audited.

Malformed encrypted text fails with a coarse reconciliation error, never an envelope/private-text echo or partial view. Student-visible status changes derived from internal history do not decrypt or expose internal reasons.

## Workspace

The student portal provides case creation for the selected programme, a paged queue across all programme records currently owned by the account, public conversation, status history, replies and reasoned reopen/close. The queue identifies programme/intake and preserves discoverability after reviewed duplicate merges. The staff workspace provides an independent support queue even without registry-read authority, scoped filters, assignment/triage, public/internal replies, manager routing and case history. Queues scroll horizontally on compact viewports; forms and long messages wrap within their workspace.

Existing staff reset clears all support state on logout and bound session expiry. Student support caches clear on logout, expiry and application/programme change. Loaders capture initiating session/context and reject late success/failure restoration; the applicant API now also refuses departed session-bound responses before they can start downstream private loads.

Failed create/reply requests preserve the user's typed draft and replay key within the same context. In-flight student controls disable until completion. Opening another case suppresses the previous conversation before the new read; failed reads do not retain an old private body. Previously authorized staff queues can recover through an error-only refresh surface without stale rows/intake metadata. Support-only roles receive a support heading and no misleading zero-registry search/results surface.

## Verification

Eleven focused support tests and all 240 current unit tests pass (`data/build-support-cases-unit-checkpoint.log`). Coverage includes bounded input/filters, exact permission scopes, lifecycle/manager gates, encrypted persistence, keyed retry digests, coarse malformed-text refusal, revision conflicts, ownership checks before decryption, scoped source SQL/pagination, all currently owned programme records and private-note/history exclusion. Earlier ten-focused/234-unit and four direct desktop/mobile loader/draft/layout passes remain recorded in `data/build-support-cases-unit-final.log` and `data/build-support-cases-layout.log`.

Initial isolated full `data/build-support-cases` remains failed: migration/seed, startup units and 22 smokes passed, but only 9 of 14 browser checks passed. New duplicate assertions used dotted request keys on both viewports. The unstyled table wrapper caused mobile width expansion and pointer interception, including the admissions profile-save timeout, transfer-width failure and support timeout. A read-only check confirmed the failed admissions profile stayed at revision 0, pending onboarding with no registrations; no save or confirmation was retried. Trace payload metadata confirms the collected duplicate request still had the original period even after the file correction. Its server stopped and database `svu_rebuild_it_1791192482543` was dropped; terminal summary is `data/build-support-cases.log`. Source was updated near the end of this known-red diagnostic run; its passing cases are not final-source acceptance.

The second diagnostic run (`data/build-support-cases-final.log`) passed 14 of 16 browser checks and all 22 smokes, but failed both support journeys because a note assertion read before the UI's asynchronous POST completed. The harness now awaits the specific POST response and rendered note before rereading. Its server stopped and database `svu_rebuild_it_1791195523582` was dropped. Later ownership-index and merged-portal changes mean this run is not final-source acceptance either.

The final-source broad checkpoint (`data/build-support-cases-checkpoint.log`, dedicated port 4197) remains failed at 15 of 16 browser checks: mobile admissions received `ECONNRESET` on a results-import denial request. The same test-server process remained healthy, and later journeys completed. All six support checks and desktop/mobile duplicate-merge and programme-transfer checks passed, as did migration/seed, units and all 22 smokes. Server stopped and database `svu_rebuild_it_1791196953393` was dropped. No uncertain write was replayed against that database.

A separate fresh isolated admissions recheck (`data/build-support-cases-admissions-recheck.log`, same now-free dedicated port) passed migration/seed, units, both desktop/mobile admissions journeys and all 22 smokes without source changes or request retries. Its server stopped and database `svu_rebuild_it_1791198306127` was dropped. The test selector was independently listed as exactly two checks. This restores coverage of the failed journey; it does not relabel the broad checkpoint as green or claim a full-browser-suite pass.

Accepted support coverage includes actual student/officer/manager UI, unrelated global-role isolation, hidden cases/assignees, concurrent create/reply requests, staff-note privacy, escalation, resolution/close/reopen, encryption and immutable storage, isolated malformed-comment refusal, responsive layout and actual session revocation. Duplicate coverage opens the retained case in the survivor's portal after a reviewed merge. Final actual desktop/mobile student, merged-case and mobile draft-recovery screenshots were inspected; width and navigation-clearance assertions passed. Failed create/reply drafts retain their request keys, and late or pre-load departed contexts cannot restore private state.

## Local Runtime

The delivery-runtime details below are historical. The subsequent [applicant communications slice](APPLICANT_COMMUNICATIONS.md) replaced PID 19960 with matching backend PID 13152, launcher session 27306, on the same port 4177. Current runtime coordination is in `docs/CODEX_CLAUDE_WORKSPACE.md`; local student/support records were preserved.

Healthy development app `http://127.0.0.1:4177/#registry`, PID 19960, launcher 10580, logs `data/dev-support-cases.log` and `data/dev-support-cases.err.log`; previous PID 24528 stopped. The standard migration runner applied additive 061 and the newly present Claude-owned `062_document_repository.sql`; its repository work was inspected and preserved, not claimed accepted by this slice. No local reseed or student/application/registration/case mutation. Read-only counts after verification remain 188 accounts, 114 applications, 28 programme records and zero registrations/enrolments/support cases. Health is 200; both support collection routes deny anonymous access with 401/no-store; the runtime error log is empty. Own completed test databases are absent; unrelated integration databases were not modified. Document-repository delivery and acceptance remain independently owned.

## Remaining Gates

Support ownership, approved category/priority taxonomy, routing across offices, response/resolution targets and business calendars, escalation levels/after-hours handling, sensitive-case segregation, attachment scanning/evidence access, notification delivery/consent, retention/legal hold/disposal, institutional performance definitions, production-volume tests and approved legacy feedback migration remain open. This provides case history in-app; it does not claim email/SMS/WhatsApp delivery, approved service-level measurements or production acceptance.
