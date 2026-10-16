# Private Messages

Implemented in migration 092 and the Messages > Private conversations workspace. This is participant-only private correspondence, not an administrative content-search service.

## Authority and Consent

- Selected human institutional roles receive `messages.self`; connector, scheduler, auditor and shared-record recipient roles do not. Global administration does not authorize reading another pair's conversation.
- Preferences default off. Both accounts must be active, currently eligible and opted in. Invitations use an exact known email address, not a searchable account directory. Unavailable, blocked and non-opted-in destinations receive the same unavailable response.
- Only the invited participant can accept or decline a pending request. No message can be sent before acceptance. Either participant can close an active conversation.
- Opting out closes pending/accepted conversations. Blocking closes the pair's active conversation and refuses new invitations. Re-enabling or unblocking never revives a closed conversation; a fresh invitation and acceptance are required.
- Closing, blocking and opting out stop future contact, not access to already retained participant history. Ending the permission-bearing role denies further authorized access. Previously viewed information cannot be recalled.

## Storage and Commands

Message bodies and report reasons use identity-bound AES-256-GCM envelopes with the configured data key. This is encryption at rest, not end-to-end encryption. Development's publicly known fallback key is unsuitable for institutional data.

Metadata-only audit records do not include message bodies, report reasons or mailbox values. No private-message content is added to public notifications or external mail delivery. Reports retain an encrypted receipt; there is no third-party report-reader or investigator workflow yet, and a receipt is not evidence of investigation.

Pair/account locks, immutable history, optimistic revisions and actor-bound keyed replay receipts protect concurrent commands. New invitations are limited to 20 per rolling day and new messages to 30 per rolling minute. Message bodies are bounded to 4,000 characters; report reasons to 2,000. Conversation pages contain 25 items and history pages 30. History positions are exact decimal bigint strings, not JavaScript numeric cursors.

## API

All routes require an authenticated account with `messages.self` and return no-store responses under `/api/private-messages`:

- `GET/PUT /preferences`: own opt-in and revision.
- `GET /changes`: own scoped metadata counters, not message content.
- `GET/POST /conversations`: participant list or exact-address invitation.
- `GET /conversations/:id`: participant-only metadata and own preferences, without message bodies or report reasons.
- `GET/POST /conversations/:id/messages`: authorized history or accepted-conversation send.
- `POST /conversations/:id/accept`, `/decline`, `/close`, `/block`, `/read`: revision-bound contact commands and monotonic own read receipts.
- `POST /conversations/:id/messages/:messageId/report`: participant-only encrypted report receipt.

Unknown/non-participant conversations are denied before decryption. Wrong keys or envelope identity mismatches fail with a coarse reconciliation error and no partial plaintext response.

## Live View

The visible authenticated private view polls metadata every five seconds and refreshes on visibility resume. This is foreground polling, not WebSocket delivery or online-presence tracking. Refresh captures counters before content reads so commits during loading remain detectable. A scoped committed-message count detects lower-position late commits that leave maximum position and unread counts unchanged.

Drafts and private reads remain in memory, not browser storage. Account switches, route departure and denied/expired sessions clear obsolete state. Bodies render as escaped plaintext. Read receipts advance only for a position belonging to that conversation and cannot move backwards.

## Verification and Remaining Gates

All 480 unit tests pass. Eight selected desktop/mobile private-message and notification-inbox checks passed in isolated database `svu_rebuild_it_1791584687808`, subsequently dropped. The unchanged 459-file source SHA-256 was `cb18ff0aa0cb94e1cda805bc41350da72993c832b1b1ff335b7adb6d9ef902c8`. Screenshots inspected in `data/private-messages-final-verified-browser`.

Institutional abuse-review authority, report triage, retention/deletion/export rules, key rotation and production operations remain unapproved. An owner was requested without asking for credentials. Attachments, presence, legacy chat import and universal legacy-command parity are not claimed. The supplied damaged archive is not repaired or imported by this feature.

The 2026-10-10 source re-audit in `LEGACY_MESSAGING_REVIEW.md` records actual generic-room, forced-invitation, nickname/operator and online-presence behavior in the bundled package. Private blocking, read receipts and course moderation are not replacements for every room command. The user subsequently included moderated institution-wide rooms; their independently verified native implementation and safety-case review are documented in `MESSAGE_ROOMS.md`. This does not authorize third-party private-history investigation or certify literal legacy protocol.

## Private Background Tabs - 2026-10-10

Native private tabs implement the background presentation capability inventoried from `privmsg2`, not nickname/ID lookup or automatic mutual consent. Up to eight accepted, opted-in conversations retain independent in-memory body drafts, report reasons, exact history cursors and actor-bound send retry keys. Background opening does not change the active view or membership. Single-conversation metadata keeps tabs valid beyond the first list page; only the selected conversation fetches/decrypts history. Closing a tab confirms draft discard without closing the conversation. Contact closure/blocking, changed preference revision or conversation revision discards that context. Retained participant history remains explicitly available after closure/opt-out, but an old draft/key is never attached to a fresh invitation. Session/route/denial cleanup remains unconditional. Connected-node/workspace guards now cover private inputs, forms and commands, and composer caret/focus is restored only within the unchanged selected conversation.

New participant-only summary shares the existing list projection and repeatable-read snapshot boundary, requires the existing native authenticated `messages.self` route, rejects supplied/repeated filters and records metadata-only read audit. It grants no peer directory, online presence, investigator role or access to another pair. No new schema, authority appointment, working consent or institutional policy is created. This stage does not claim expanded controlled in-flight private-role revocation coverage or policy approval.

Twelve focused private backend/UI checks pass (456.3138 ms), covering separate exact cursors/drafts/report reasons/retry keys, metadata-only background closure cleanup, renewed consent clearing and strict summary inputs. Full units and six selected native private-tab/private-message/live-room desktop/mobile journeys are running in isolated data. Working restart and final source/teardown proof remain pending.

### Initial Verification And Fixture Correction

All 550 unit tests passed with no failures/skips (91480.0016 ms). Initial isolated run `svu_rebuild_it_1791648283430` passed the existing desktop live-room/private-message journeys, then the new desktop tab journey timed out at its final refresh selector: account replacement correctly reset the workspace to Notifications, but the fixture did not explicitly select Private conversations again. Earlier tab assertions reached the screenshot, including native off-page records, block/new acceptance, lost-response retry without duplicate messages, discard/close and tab bounds; that is not a completed journey result. Trace was read as structured events with only method/selector/timing diagnostics, not raw authentication headers or historical payloads.

After verifying its command, parent and creation identity, stopped only the isolated Playwright child tree (PID 14728, parent integration PID 22948), not the working server or integration runner. The surviving runner recorded failed browser verification, unchanged 502 sources with SHA-256 `9568aa3fc02802e7a4c1f3ee9efd54c4317439801e3b46cf9504d1765b536f05`, and successful database teardown. Saved summary `data/private-tabs-initial-summary.log`. This was a confirmed invalid selector after account replacement, not a restart caused solely by an observation timeout.

The fixture now explicitly opens Private conversations after replacement, imposes a fifteen-second action timeout and waits for an idle workspace before its screenshot. Added a tab-limit edge guard: if a selected pending conversation becomes accepted while eight tabs are open, select an existing tab instead of opening a ninth or entering repeated refresh errors. Report disclosures now survive private redraws. Thirteen focused checks pass (584.6284 ms), including this externally accepted ninth-tab scenario at unit scope. Expanded twelve-check native private/room/tab/storage/safety selection and refreshed full units are running; final deployment proof is pending.

### Expanded Proof And Focus Refinement

Expanded twelve-check native private-tab/private-message/live-room/room-tab/storage/safety-case desktop/mobile selection passed in dropped `svu_rebuild_it_1791648914353`; 502 sources unchanged, SHA-256 `d96c85a3f69d1574b596cb7beefce929db9108667b54250003fa360bdbb69dd1`. Saved summary `data/private-tabs-final-summary.log`. All 551 unit tests passed, no failures/skips (79669.8135 ms; `data/private-tabs-final-unit-summary.log`). This run verifies the corrected account navigation and tab journey, not the subsequently added focused-email polling check.

Review identified an unsupported email-input selection API in private focus restoration. Added the same null-position guard used by the room path: focus can be restored to an email field, but its unavailable text-selection range is not set. Native checks now focus the invite email, composer and unsent-report textarea in turn while a peer posts into a background conversation. Each requires a browser metadata response observing that exact new message position, an idle completed redraw and unchanged focus; supported textareas additionally retain their actual selected range, and report disclosure/reason remain visible. This is a real native commit/poll/read/redraw witness, not only an immediate focus assertion. The same twelve-check selection and full units are repeating before working deployment.

### Final Verification And Working Deployment

Final twelve selected private-tab/private-message/live-room/room-tab/storage/safety-case checks pass across desktop/mobile in dropped `svu_rebuild_it_1791649691086`; 502 unchanged sources, SHA-256 `48dc9390e21448952b6f315bafe4ee7d2c6b710ad66b07ceda4829df62b96c9e`. Retained runner summary `data/private-tabs-focus-final-summary.log`, Playwright result `data/private-tabs-focus-final/.last-run.json`. All three explicitly named initial/expanded/final stage databases independently absent; older unrelated test databases untouched. Final run had no failures. All 551 unit tests pass, no failures/skips (49887.3812 ms; `data/private-tabs-focus-unit-summary.log`); thirteen focused private checks pass. Final desktop/mobile screenshots inspected, idle controls and long-label wrapping visible, native overflow/page-error assertions pass.

Native checks cover unrelated/anonymous summary refusal, unsupported/repeated filters, metadata without body/envelope/reason fields, off-page active/background tabs after twenty-six native closed requests, independent drafts and older-history cursors, background posts, ban/block closure cleanup and fresh accepted conversation without old drafts. A real committed-send response is dropped; switching away/back retains that conversation's original retry key/body, and retry produces exactly one stored message. Confirmed tab discard does not close accepted contact; dismissal retains the draft. Eight tabs refuse a ninth background opening and closing one restores eligibility. Own opt-out removes every accepted tab/composer and preserves authorized retained closed history; re-enabling does not revive any old conversation. Account replacement resets the workspace; detached old tab/input events restore no obsolete draft/history. Email/composer/report focus checks witness real background commits in browser metadata; supported ranges and open report reason survive completed redraw. The externally accepted ninth-tab guard additionally has explicit unit coverage, not a claimed native external-acceptance test. This is not exhaustive other-command rollback/in-flight authority proof or authorization for private investigation, attachments, online presence or literal nickname protocol.

No migration or working reseed. Stopped only owned PID 12492/start milliseconds 1791647783159 after matching its localhost:4173 listener. New owned PID 9228/start milliseconds 1791650840440 owns that listener. Health/database return 200/ok; anonymous private summary/change and room change/report reads return 401/no-store. Authenticated empty private lists/preferences/changes, room workspace and own/safety report queues return 200/no-store; private list advertises the summary capability. Authenticated missing private summary returns 404/no-store and supplied offset returns 400/no-store. Runtime fingerprint matches final proof, `data/private-tabs-dev.err.log` empty, external mail disabled. All seven private-message tables, ten room/report tables and room-role appointment counts remain zero. Runtime verification creates authentication/read audits only, not preferences, contacts, messages, cases, appointments, approvals or policy. Archived PHP/SQL remains untouched/unexecuted/unimported.

During verification the user selected **Account names without presence** for rooms. `MESSAGE_ROOMS.md` and `LEGACY_MESSAGING_REVIEW.md` record that confirmed replacement boundary; native labels already use authenticated account names, without nickname controls, heartbeat or online lists. This does not certify the old command protocol, approve private-history investigation or supply institutional retention/key/import policy. The full legacy-coverage goal remains active and incomplete.

## Native Display Clearing - 2026-10-10

Local active-view clear and freshly authorized restore are implemented and verified alongside the native private/room/tab/storage/safety selection on desktop/mobile. See `MESSAGE_DISPLAY.md` for exact-ID filtering, bounded tab-local state, cursor resets, draft/retry preservation, unchanged-row/no-write-request witnesses, final source fingerprint, runtime evidence and remaining authority/policy boundaries. This is not deletion, a read receipt, moderation restore, literal slash compatibility or completion of legacy coverage.

## Transaction Authority - 2026-10-10

The later shared-principal remediation is documented in `SESSION_PRINCIPAL.md`; the historical gap noted below is superseded by that verified stage. Current-clock quota and retry verification/deployment is documented in `MESSAGE_QUOTAS.md`, including 566 passing units, 38 selected desktop/mobile cases, 22 smoke/demo checks and the unchanged working-data boundary. No automatic word filtering is enabled.

All private transaction paths now revalidate and shared-lock current account/role/assignment/permission authority before domain access or retry lookup. Actor-command ordering preserves concurrent preference/send behavior; distinct eligible peer checks retain the existing consent and safety boundaries. `PRIVATE_MESSAGE_AUTHORITY.md` records the final fourteen selected desktop/mobile checks, 562 passing units, exact native withdrawal/rollback witnesses, source fingerprint, isolated teardown and working deployment. This does not resolve the separate shared authentication projection gap or institutional retention/key/investigation/import dependencies.
