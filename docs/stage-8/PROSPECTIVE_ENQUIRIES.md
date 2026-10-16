# Prospective Applicant Enquiries

Inventory: `COM-11`; Stage 8 human hand-off and consent-aware conversation foundation. Migration: `066_prospective_enquiries.sql`. This is a portal development workflow, not official WhatsApp/AI delivery, institutional policy approval or an admission decision service.

## Custody And Consent

Applicants sign into their verified portal account before creating an enquiry. No application, admission or student programme is required. Enquiries retain immutable originating account, programme, intake, optional approved guidance version, subject, request origin and consent-policy version. They are separate from student support cases; custody is not borrowed from a student record or account-merge inference. Public/current intake eligibility follows published programme/curriculum and intake sources at creation. Existing enquiries remain retained when that intake closes.

The form requires an initially unchecked affirmative permission: `Allow admissions to reply in this enquiry.` The retained development purpose version is `portal-enquiry-v1`, with original consent timestamp and per-revision consent/status history. It permits this in-app conversation only. It does not imply optional campaign, marketing, email, SMS or WhatsApp consent; existing group-message preferences remain unchanged. External phone numbers and anonymous/unverified channel identities are not collected or trusted.

Resolution ends active reply consent. Only the applicant may reopen a resolved enquiry, with fresh explicit consent; reopening removes the prior assignment and returns it to triage. Withdrawal is terminal for the enquiry and blocks new messages, assignment, escalation and reopening. A new enquiry requires a new affirmative consent. Existing conversation/history remains retained, not erased. Actions are revision-guarded; stale withdrawal or other state changes refuse with refresh/retry rather than silently overriding a newer snapshot. Repeated completed withdrawal is idempotent. Owner-approved privacy/contact rules, wording and retention/disposal remain D-33 gates.

## Human Hand-Off

`enquiries.self` grants own-account access to applicants/students. `enquiries.manage` grants intake/programme-scoped admissions triage to officers, managers and administrators; only roles granting that permission lend scope. `enquiries.escalate` grants manager authority within its own scope. Unrelated global audit authority cannot widen a private queue. Programme-wide admissions roles cover that programme's intakes; intake-scoped roles do not cross custody boundaries.

Staff select an active, currently authorized intake assignee and reasoned status. Replies and internal notes require the current assignee; eligible account status/effective role grants are re-read for writes, using the same database-date boundaries as session authority. Escalation assigns an eligible manager and advances the retained escalation level. Ordinary officers cannot reply or triage an escalated enquiry. A manager must explicitly resolve the escalation before completing it or handing it back. Resolution requires an authorized assignee; staff cannot renew the applicant's consent or reopen on their behalf.

Applicant replies return `waiting_applicant` enquiries to `in_progress`. Staff public replies set `waiting_applicant`; internal notes do not alter the waiting state. No email/WhatsApp notification worker or delivery outcome is fabricated. No admissions/application/student decision, fee, capacity or registration state is changed by an enquiry action.

## Guidance And Applications

Signed-in readers can use **Ask admissions** on a published guidance version. Creation rechecks that the referenced version is the currently effective, unexpired approved version for the selected intake; article/version source rows are locked through capture. Hidden drafts, withdrawn/expired/future advice and other-intake references are refused without decrypting them. If the reference becomes unavailable, the typed draft is retained on the guidance conflict and the applicant can remove its reference deliberately. Stored references identify captured versions; they do not redisplay withdrawn advice as current policy.

The portal can start an application from an enquiry's currently open intake or open the account's existing application. These use existing admissions routes and independently rechecked admissions permission/ownership. Application initiation is a separate explicit user command, not an automatic lead conversion or offer. No source account is converted to a student by hand-off.

## Privacy And Recovery

Subjects, message bodies and internal action reasons are encrypted. Conversation and consent/status histories are append-only; custody and withdrawn records are database-guarded. Wrong account or staff scope is rejected before message/history decryption. Own views omit internal notes, staff/assignee/actor identities and all private triage reasons. Queues decrypt only scoped subject metadata, not full conversation bodies. Audits retain actions, revisions, states and consent/escalation flags, never conversation text or reasons.

Creation keys are account-bound; message keys are author/enquiry-bound with keyed canonical digests. Identical/concurrent retries reuse saved records; changed-content key reuse conflicts. The enquiry row lock serializes replies with consent/state changes. A replay of an already recorded message does not create another message, even after consent withdrawal. New writes after withdrawal remain refused.

Private browser loaders check token, generation and selected enquiry between requests. Sign-out/revocation and wrong-scope actions clear private queues/detail/drafts/replay payloads. Interrupted creation/replies retain both typed text and their frozen original request payload across refresh. Editing creates a new intent; successful writes clear their replay state. Stale reply conflicts clear only the reply key/payload while retaining typed text. Own controls are disabled during a mutation. All APIs use `no-store`.

## API Boundary

- `GET/POST /api/enquiries/me/cases`: own queue or consented creation.
- `GET /api/enquiries/me/cases/:id`: owned public conversation and safe history.
- `POST /api/enquiries/me/cases/:id/comment`: own public reply with revision/replay key.
- `POST /api/enquiries/me/cases/:id/withdraw`: reasoned terminal consent withdrawal.
- `POST /api/enquiries/me/cases/:id/reopen`: resolved enquiry only, revision/reason/explicit renewed consent.
- `GET /api/enquiries/metadata`: authorized intake/status choices.
- `GET /api/enquiries/cases` and `/:id`: scoped staff queue/private detail.
- `POST /api/enquiries/cases/:id/comment`, `/update`, `/escalate`: assigned response/internal note, scoped reasoned triage or manager hand-off.

Queues accept bounded status/intake/offset filters; staff additionally have mine/unassigned filtering. Pages contain at most 25 records. Caller-supplied owner, channel, actor, permission or custody overrides are refused.

## Verification

Twelve focused tests and all 273 then-current units passed at `data/build-prospective-enquiries-unit-final.log`: canonical bounded consent/actions, exact scopes, lifecycle, pre-decryption ownership, self redaction, malformed ciphertext, SQL ownership/pagination, keyed digests/source locks, fresh-assignee write refusal and database guard declarations. Later isolated checkpoints also run the complete unit suite; their recorded outcomes are below.

Initial isolated `data/build-prospective-enquiries.log` passed migration/seed, units and all 22 smokes, but failed both main desktop/mobile cases at withdrawal: the fixture used the applicant's pre-reassignment revision after the manager changed it. The real revision guard correctly refused. Both loader checks passed. Server stopped and database `svu_rebuild_it_1791207220174` was dropped. The fixture now explicitly checks stale withdrawal refusal, refreshes, and waits for exact rendered revision after each mutation. Frozen create/reply form tests were added. Subsequent checkpoints are recorded separately below; this failed run is not final acceptance.

Corrected `data/build-prospective-enquiries-final.log` passed migration/seed, units, all 14 selected desktop/mobile guidance/communications/enquiry browser checks and all 22 smokes. Its selector was independently listed as exactly 14 checks and last-run metadata reports passed without failures. Server stopped and database `svu_rebuild_it_1791207456530` was dropped. Both completed own enquiry-test databases were independently confirmed absent. Fresh role date boundaries were aligned to session authority during that run, so it is not final-source acceptance.

The subsequent 26-browser admissions/support/guidance/communications/enquiry checkpoint (`data/build-prospective-enquiries-checkpoint-browser`) finished at 23 passed/3 failed, with units and all 22 smokes passing. Its database was `svu_rebuild_it_1791207862619`; teardown and database absence are independently confirmed. Mobile admissions/support sign-in exceeded the ten-second screen expectation while their API requests succeeded. Mobile enquiry refresh exposed an active button silently ignoring clicks during an existing own action. Refresh now disables with the other own controls, with a browser regression assertion; independent own and staff admissions panels load concurrently. Support sign-in's screen expectation is explicitly bounded at thirty seconds because the student portal also loads its registry sections.

Recovery `data/build-prospective-enquiries-recovery.log` finished at 23/26 browsers, with all six enquiry checks passing on desktop/mobile, units and all 22 smokes passing. The three remaining failures were desktop admissions registration rendering, desktop support response rendering, and a mobile support-form fixture overwritten by a pending initial portal render. The completed driver's database `svu_rebuild_it_1791210317924` is independently confirmed absent and launcher 56218 ended exit 1. Both applicant/staff screenshots on both viewports were inspected: messages fit, escaped markup stays literal, and internal notes are absent from the applicant view. All four own enquiry-test databases are absent. This broader run remains failed, not full-suite acceptance.

Follow-up `data/build-student-portal-concurrent.log` passed migrations/seed, the complete unit suite, all SIX selected admissions/support desktop/mobile checks and all 22 smokes. Its selector was independently listed as six; last-run metadata reports passed without failed tests. Independent programme reads now start together, preserving existing per-route authorization and response/session/context checks. The admissions request barrier proves registrations/results/academic reads start before any completes; the support form fixture waits for the real sign-in screen before replacing its root. Mobile support and draft-recovery screenshots were inspected. Launcher 87672 ended exit 0; its server stopped and database `svu_rebuild_it_1791212369555` was dropped and independently confirmed absent. All five owned databases are absent, and 4197 has no listener. This follow-up was implemented after the enquiry recovery checkpoint: the six enquiry passes and six corrective passes are separate checkpoints, not a rerun or relabeling of the failed 26-browser run. No full-suite acceptance is claimed.

## Local Runtime

This delivery runtime is now superseded by the matching [enquiry reporting runtime](ENQUIRY_REPORTING.md#local-runtime). Reporting adds scoped status/consent/reply measures, non-additive account totals, separately authorized application associations and elapsed-time samples without reading conversation text; it does not establish approved conversion attribution or response SLAs.

Migrations 066 and concurrently authored additive 067/068 applied without reseeding. Previous PID 20836/launcher 26685 stopped; intermediate PID 19780/launcher 15975 was replaced after the fresh-role date alignment. Subsequent PID 25676/launcher 56905 ended; the current matching-source backend is PID 13348/launcher 33725, `http://127.0.0.1:4177/#apply`, logs `data/dev-prospective-enquiries-recovery.log` and `.err.log`. Health is 200 and anonymous enquiry metadata/own routes are 401, all `no-store`; error log empty. Earlier runtime logs remain retained. Read-only counts independently retain 188 accounts, 114 applications, 28 student programme records, zero registrations/enrolments/support cases, and zero prospective enquiries/messages/history. Previously checked guidance articles and communication preferences/campaigns were also zero. No local operational applicant/student, enquiry or consent state was fabricated.

## Remaining Gates

The official WhatsApp number/provider, signed channel webhooks and account binding, AI-assisted answers, approved source corpus and citations/abstention evaluation, outbound retries/failures/consent rechecks, response targets/after-hours handling, wider context-help placement, lead/conversion metrics, attachments, retention/legal hold/disposal, accessibility/owner acceptance and production source migration remain open. No emergency response or admissions eligibility/offer promise is made. See D-33, D-06, D-21, D-22, D-23 and D-24.
