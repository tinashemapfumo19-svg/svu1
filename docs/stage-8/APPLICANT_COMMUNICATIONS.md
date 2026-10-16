# Applicant Group Communications

Inventory: `COM-03`; roadmap Stage 8 communications, completing the deferred group-communication part of Stage 2. Migration: `063_applicant_communications.sql`. This is a delivered development slice, not institutional approval or provider-delivery acceptance.

## Scope And Consent

Optional applicant updates are separate from existing required admissions notices. Account contact details, registration, acceptance and student conversion do not imply optional-update consent. New preferences default off independently for in-app and email. Applicants/students can change only their own preferences with `communications.self`; each recorded change advances the revision and retains append-only history. An explicit initial refusal is recorded, not silently equated to an absent preference row.

Opt-out blocks later optional campaigns. Email opt-out also cancels the account's queued, unsent campaign-email records. Already available in-app messages remain retained history; opt-out does not erase a prior publication. Existing activation, information-request, decision and other service notices are unchanged.

`admissions.communicate` is granted explicitly to admissions officers, managers and administrators. Only roles granting that permission lend their programme/intake scope. Unrelated global auditor/notification authority cannot widen an audience. Staff choose an authorized intake, application status and optional current workflow state. Draft, submitted and withdrawn records are distinct; the current workflow binding is used rather than historical decisions. Invalid or missing source scope bindings refuse the audience without partial publication.

## Preview And Publication

Preview persists encrypted subject, message, internal reason and recipient manifest; request hashes and source digests use keyed HMAC. The preview is bound to its initiating staff account, current source facts and per-account consent revisions. It expires after 15 minutes. Recipient accounts are deduplicated separately per channel; application-record counts remain separate from recipient/account counts. Excluded recipients are counted, not added to the manifest. Email addresses are encrypted and omitted from preview responses/UI.

Publication rechecks current permission/scope, account eligibility, application/workflow bindings and consent. Changed source or consent requires a new preview. Intake/source identity, workflow and consent locks prevent publication from racing those changes; no admissions status is modified by communication. Concurrent publishes serialize on the campaign. Identical preview retries reuse the existing campaign; changed-content key reuse conflicts. Published campaigns and recipient origins are immutable, and recipient/channel uniqueness prevents duplicates. Corrupt private text must not produce partial recipients.

Development bounds are 500 recipient/channel records per campaign and 10,000 intake application records. Oversized groups fail explicitly instead of silently truncating a reviewed audience. These limits are not approved institutional volume policy.

## Channels And Privacy

Publication makes in-app messages available to the exact recipient account. The own-account inbox is paged, escapes markup, excludes internal reasons/manifests and supports idempotent mark-read. Email records are encrypted and `queued`, never reported as delivered. No provider worker, mail-catcher delivery, SMS or WhatsApp integration is inferred. A future email dispatcher must recheck consent under the same account lock before external delivery and record provider outcomes/retries.

Audits retain workflow actions, revisions and counts, not subject, message, internal reason or recipient addresses. Collection/detail routes require authentication and use `no-store`. Wrong ownership/scope is denied before decrypting private text. Staff draft previews are visible only to their initiating account; published campaign history is available only within current communication scope.

Browser loaders reject departed sessions and superseded generations; logout clears private state. Failed preview requests retain their replay key and typed content. Successful previews permit an explicit new preview with a new key. Stale preview refusal clears publish controls/key without discarding typed content. An interrupted publication retains the same campaign for an idempotent retry; unauthorized/stale reads do not keep a private audience visible.

## Verification

Eleven focused tests and all 251 final-source unit tests pass (`data/build-applicant-communications-unit-final.log`). Earlier unit checkpoints remain recorded separately.

Initial isolated integration passed migration/seed, units, four desktop/mobile communications checks and all 22 smokes (`data/build-applicant-communications.log`). Server stopped and database `svu_rebuild_it_1791200202618` was dropped. Subsequent UI preview-key recovery, coarse malformed-audience refusal and stronger source/concurrent-publication checks mean that run is diagnostic, not final-source acceptance.

The broader checkpoint (`data/build-applicant-communications-checkpoint.log`) remains failed at 19 of 20 browser checks. All desktop/mobile admissions, support, duplicate-merge and transfer checks passed, as did units and all 22 smokes. Mobile communications correctly refused the fixture's reused administrator preview key: desktop had already used the same key for different intake content. Its server stopped and database `svu_rebuild_it_1791200627110` was dropped. The selector was independently listed as 20 checks across five files. Source was refined near the end of this known-red run; its passing cases are not final communications-UI acceptance.

The fixture now uses a viewport/run-specific administrator key. The source-status check starts with an eligible recipient and asserts the exact changed-audience refusal. History links use restrained table-link styling. Loaders check departed sessions before a second private read; refused staff actions clear cached metadata/history/drafts as well as previews while retaining an error-only refresh surface. The final fresh isolated checkpoint (`data/build-applicant-communications-final.log`) passed migration/seed, units, all four selected desktop/mobile communications checks and all 22 smokes. Its selector was independently listed as exactly four tests; browser last-run metadata reports passed with no failed tests. Server stopped, database `svu_rebuild_it_1791201970237` dropped, and port 4197 released. The broader failed run is not relabeled; this is affected-workflow coverage, not a full-browser-suite claim.

Accepted desktop/mobile coverage includes actual preference/composer/inbox UI, default-off consent, scope isolation, exact changed-consent/source refusal, overlapping publish requests, email opt-out cancellation, own-message privacy, encrypted persistence, private-safe audits, immutable campaign storage, responsive fit and actual session revocation. Loader checks prove only one request after a departed session and generic refresh recovery without old private history/drafts on refused authority. Final desktop/mobile campaign and inbox viewport screenshots were inspected; width assertions passed. No forced clicks or relaxed checks were used.

## Local Runtime

Additive migration 063 applied without a reseed; 001-062 were skipped. Known development PID 19960 stopped and launcher session 10580 ended. Matching backend is healthy at `http://127.0.0.1:4177/#admissions`, PID 13152, launcher session 27306, logs `data/dev-applicant-communications.log` and `.err.log`. Error log is empty. Health returns 200; metadata, own preferences and own inbox anonymously return 401/no-store. Post-verification read-only counts retain 188 accounts, 114 applications, 28 programme records and zero registrations/enrolments/support cases; new preferences/campaigns/recipients are all zero. All three completed own communication-test databases are confirmed absent. No local applicant/student/case/registration or consent mutation. Other agents' work and unrelated databases were preserved.

## Remaining Gates

Consent purpose/wording, institutional sending authority and independent approval thresholds, external channels/providers, delivery outcomes/retries/bounces, suppression lists, schedules/rate limits, retention/legal hold/disposal, larger groups, approved contact/source migrations and owner acceptance remain open. This development workflow does not settle required-notice versus marketing rules or claim production delivery/acceptance. See D-32 and D-06.
