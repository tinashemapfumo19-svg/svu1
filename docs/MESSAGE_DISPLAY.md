# Message Display Clearing

## Source Boundary

Read-only review of `chat/src/commands/clear.class.php` finds a successful client response, not a storage deletion. `chat/data/public/js/pfcclient.js` handles that response by obtaining the selected tab's content container and emptying its HTML. Its separate `clearMessages()` function is commented out. No archived PHP was executed or historical correspondence opened.

SHA-256: handler `6cd03c769e97a8ae988b2fb33173ba75c984c973e0533b413b0c3f61989c5d81`; client `ee2d1b3d4344ef7844f582f3d490fe653c5e6119afa7675aa3888b609e4035bd`.

## Native Contract

Private and institutional room histories have icon controls for clearing and restoring the active display. This is local presentation, not deletion, moderation, retention execution, closing participation or marking messages read. Commands reload through the existing freshly authorized read endpoints; ordinary read audits still occur. There is no new write endpoint, permission, schema or retained correspondence copy.

The in-memory filter stores exact observed message IDs, never a numeric position watermark. A newly committed message remains visible even if it has a lower position than a previously observed message. Repeated clearing accumulates IDs; IDs temporarily absent due to filtering are not forgotten. Each display permits at most 4,096 IDs; an overflowing clear is disabled and refused without trimming older IDs. Restore releases the filter. History cursor changes also reset it. No filter or message body is persisted in browser storage.

Open tabs have independent filters. Closing a tab, participant/consent/role replacement, access denial, session replacement and route cleanup discard affected state using the existing privacy boundaries. Private retained closed history can also be cleared and restored by its authorized participant. Background tabs keep IDs only and do not load their history bodies. The private workspace retains at most eight open-tab filters plus its selected retained-history view; rooms retain at most eight accepted-tab filters.

Unsent message/report drafts and send retry keys are not erased by display clearing. A private mark-displayed-read control is absent when no messages are visible; an explicit read uses the newest actually visible message's exact position. Restoring room display does not restore a moderation-hidden body or expand access to report evidence; authorization and moderation projection still apply on the fresh read. Independent safety-case views are not display-cleared.

This is a native replacement for selected-tab display clearing, not literal slash-command/client-protocol compatibility or evidence of historical erasure. Rooms continue using account names without aliases or presence, as selected by the user.

## Verification Stage - 2026-10-10

All 559 unit checks pass without failures/skips (92320.1566 ms; `data/clear-display-unit-summary.log`). Twenty-six focused clear/private/room UI checks pass (2637.6875 ms), including exact positions above 2^53, lower-position new arrivals, temporarily absent IDs, repeated-clear bounds, cursor resets, tab isolation, consent/membership replacement, detached controls and authorized closed private history. The lower-position clear behavior is unit-tested, not yet a claimed native delayed-commit clear test.

The initial browser runner disappeared across a tool continuation without a final result or source/teardown summary. Its partial trace is not accepted as passing evidence. Read-only process inspection found no remaining integration runner/browser/server; localhost:4180 had no listener and stage `svu_rebuild_it_1791652167380` had no connections. Only that explicitly identified stage database was dropped and its resolved workspace scratch outbox removed; older unrelated databases and working data were untouched.

A fresh twelve-check desktop/mobile private-tab/room-tab/private-message/live-room/storage/safety-case selection is running as owned PID 20248/start milliseconds 1791653232725, with independent stdout/stderr files `data/clear-display-final-summary.log` and `data/clear-display-final-error.log`. Browser result, final source-integrity evidence, teardown, screenshots and working runtime checks remain pending. Code and unit success do not prove completed native verification.

The full legacy-coverage goal remains active. Broader command-specific authority/rollback proof, actual policy/retention/key operations, private investigation scope, HR policy, provider/deployment evidence and authoritative damaged-source migration remain independent requirements.

### Authority Audit Checkpoint

Read-only source review finds private `authority(actor)` checks the supplied permission projection; private list/summary/history repeatable-read transactions do not repeat and lock current account/role authority. The pair gate locks accounts/preferences and queries current assignment permissions, but does not share-lock the qualifying assignment/role/permission rows or join active roles. In contrast, room `fresh()` repeats current active-account/assignment/role/permission checks with shared locks. Existing private native coverage ends a peer assignment before a send and proves refusal, but does not hold an actor history read or command across concurrent authority revocation. This identifies the next verification/implementation target, not completed native in-flight proof or authorization to withdraw a working user's roles. Keep retained closed-history eligibility distinct from loss of the actor's actual messaging authority.

This records the source checkpoint before the subsequent guard implementation. Current implementation and verification stage are in `PRIVATE_MESSAGE_AUTHORITY.md`; do not treat this historical checkpoint as the current source contract or as completed native proof.

## Final Native Verification And Working Runtime

The final private-tab/room-tab/private-message/live-room/storage/safety-case selection passed across both desktop and mobile in `svu_rebuild_it_1791653234346`. Migration, isolated seed, server and browser steps passed; the runner reports database dropped. All 503 tracked sources were unchanged, SHA-256 `f4cbb0ec4517741dea9f0cd38cf449a7180bd0edd7a88cc9a620c4d0b972ad5a`. Saved summary `data/clear-display-final-summary.log`; `data/clear-display-final/.last-run.json` reports passed with no failed tests. The successful runner deliberately omits individual positive stdout/counts from its summary; the selected six single-test specs run under the two configured projects. This is selected workflow verification, not a claim that every legacy command is now covered.

Native added checks clear an older page, retain the draft and blank display through refresh, restore retained messages, and compare hashed private conversation/message/read/report rows or room/message/membership rows unchanged. Browser request-method witnesses confirm no private/room write request during that clear/refresh/restore sequence. Background tab clearing stays separate from the other tab's older history; real native new messages become visible while previously cleared bodies stay absent. Restoring re-reads authorized retained history. The existing native tab, commit-order, storage, report, role/fault and session-cleanup journeys remain in the combined selection. Exact-large-position/lower-commit display filtering, capacity limits and nonempty filter cleanup additionally have focused unit coverage; do not attribute a new delayed-commit clear or every access-change scenario to the native additions.

All four private/room clear-display desktop/mobile screenshots were inspected; controls fit and wrap, with existing native overflow/page-error assertions passing. Both explicitly identified stage databases are independently absent, localhost:4180 has no test listener and owned runner PID 20248 is gone; its launcher session exited zero. Older unrelated test databases were untouched. Final runner and working error logs are empty.

No migration, working reseed, server restart or new permission was required. Owned working PID 9228/start milliseconds 1791650840440 still serves localhost:4173. Health/database return 200/ok; both served UI files match current local bytes, and current source fingerprint matches the final proof. Anonymous private/room change reads return 401/no-store. All seven private-message tables, ten room/report tables and room-role appointments remain zero. Working checks were read-only; no correspondence, consent, case, appointment, approval, policy or import was fabricated. Existing disabled external-mail configuration was not changed. The full legacy-coverage goal remains active and incomplete, with the next authority audit and external requirements above still open.
