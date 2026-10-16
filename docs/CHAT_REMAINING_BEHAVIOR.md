# Remaining Chat Behavior

Follow-up audit and implementation register, 2026-10-12. Verification and remaining boundaries are recorded separately from source implementation. No archived PHP/JavaScript/Flash, private configuration, cookies or message records were executed/imported.

## Localization And Command Recall

`CHAT_LOCALIZATION_PREVIEW.md` records the read-only catalogue verifier, precise missing/empty/duplicate/format findings, identical public bundle inventories and six passing archive/CLI checks. Native localization remains unimplemented: catalogue presence is not complete native consent/moderation/accessibility text or approved locale/RTL behavior. The user tentatively prefers English plus two common Zambian languages; English/Bemba/Nyanja is proposed with fluent-speaker review and confirmation against institutional needs. The census distinction between national at-home and urban rankings is recorded. No legacy locale is silently retired or imported, and stored messages remain unchanged.

`CHAT_COMMAND_RECALL_REVIEW.md` revalidates legacy raw typed-attempt history and current native forms. It is not an automatic server replay protocol, and direct GUI leave bypasses the typed buffer. Message-composer and room-definition history are implemented. `ROOM_COMMAND_CONTEXT.md` now records connected member/moderation recall with target lifetime metadata, exact intent/tail/caret, current revisions, separate frozen retries and native cross-form authority checks. The corrected current full run passes units, ten selected desktop/mobile cases and 22 smokes with an unchanged complete guard, inspected retained control captures and independent isolated cleanup; failed fixtures and corrections remain recorded. Invitation/report/review contexts/adapters and additional native lifecycle/peer/async cases remain required. These clarifications preserve the full goal rather than declaring all administrative recall complete.

## Exact Written Text

The user's preserve-written-message decision removes automatic word rewriting. Follow-up implementation now preserves exact valid submitted private and room message text, including outer whitespace and line endings. The exact-text stage introduced `v2:` keyed exact-body receipts; the action stage advances new private receipts to `v3:` binding exact body and kind. Historical `v2:` and unprefixed immutable receipts retain their respective exact/trimmed text retry contracts. Room receipts already hash exact input and are unchanged. Room history, report intake and disclosed evidence validate message bodies without normalizing them; administrative report reasons and room definition fields retain their existing normalization.

Six new units verify exact encrypted storage, new/legacy retries, changed-whitespace conflicts, history/evidence readback, all existing room kinds and invalid-input refusal. All 639 standalone units pass. Isolated native desktop/mobile proof is recorded separately in `CHAT_EXACT_TEXT.md`; do not infer deployed backend adoption or a whole-source certificate from unit success. Existing messages/receipts are not rewritten or reconstructed from guessed input. Empty/whitespace-only input, NUL rejection, quotas, authority, encryption and frozen-key/new-intent semantics remain required. Legacy censor lists, evaluated regexes and plaintext logging remain excluded.

## Private Actions

Supplied `commands/me.class.php` receives the current generic recipient and writes the `me` command type; it does not restrict its own handler to group recipients. The common incoming renderer recognizes action messages across recipient tabs. This establishes a private-action mapping requirement, not legacy runtime certification.

The earlier audit confirmed private input accepted only body/requestKey and rejected an otherwise valid action kind. Follow-up implementation now accepts private text/action kinds with an explicit composer control, encrypted kind binding, versioned exact body/kind receipts and text-only historical retry compatibility. Missing historical envelope kinds remain text; notices and malformed kinds fail. Native institutional rooms retain their existing text/action/moderator-notice kinds.

`CHAT_PRIVATE_ACTIONS.md` records implementation and proof status. Per-context private draft/composer history now carries kind, with deliberate kind changes clearing the cached key and frozen unedited retries preserving it. Focused checks and the full unit/24 selected native desktop-mobile/22-smoke run pass with complete unchanged source guard; owned working adoption and independent isolated cleanup are recorded. Spoofed sender fields, slash execution, presence checks and aliases remain excluded. Default-text/old-record compatibility, encrypted integrity, report evidence and stale-context protections are retained requirements, not a claim of actual legacy data import or all remaining presentation coverage.

## Alerts

`CHAT_ACTIVITY_BASELINES.md` now records verified participant-only metadata reads for private/room recipient activity. Signed actor/type/recipient/access-epoch cursors establish silent initial baselines, classify exact own/other counts, ignore room notice/hidden activity and reset on changed consent, bilateral blocks or retained-ID authorization row changes. Exact database acceptance timestamps prevent pre-consent activity. Full unit/12 selected native API-authority/22-smoke proof passes with unchanged complete source guard; owned working adoption and isolated cleanup are verified. No visible/audible alert UI engine or delivery acknowledgement is implied. Existing broad change/unread endpoints below remain unchanged; the new reads are their per-context alert prerequisite, not a reinterpretation of their counters.

- Public `pfcclient.js:977-990` notifies only new send/action records (`oldmsg == 0`), not notice or old replay. Hidden recipient tabs call `notifyTab`; local inactive state plus `notify_window` calls `notifyWindow`. There is no sender-self exclusion in that inspected branch; this difference must not be silently inferred away from legacy behavior.
- `pfcgui.js:299-401` increments a numeric title prefix, conditionally embeds hidden Flash sound, swaps private/group tab imagery and alternates classes on evaluated 500ms timers. Selecting a tab clears its notification. Source public defaults `notify_window` and `startwithsound` are true; the client can override sound with a global cookie. These are public defaults, not actual deployed settings or native consent/persistence decisions.
- `activity.js` uses only mousemove/mouseout. The client wires title clearing to `onunactivate`, which actually runs on mouseout rather than return-to-focus; the unused idle code is commented out. This is neither server presence nor an authoritative activity/visibility/keyboard/touch detector. Do not copy the callback mismatch, Flash/plugin loading, evaluated timers or global cross-account cookies.
- Native private summaries already expose owned unread counts excluding the reader's own messages, plus latest position including all authors. Those counters are not themselves legacy alert counts; initial/replayed/history data, closed/replaced relations and explicit reads need separate event/baseline handling.
- Native room change stamps include accepted consent-bound message counts/position sums and other room, membership, roster, moderation and report changes. The message CTE filters pre-membership and blocked-author records but does not classify live eligible incoming text/action per room, or exclude own/notices/hidden/closed-room records for alert semantics. Broad manager/approver summary authority also does not establish live participation. A changed stamp cannot be treated as a notification count or a reason to fetch background bodies.

Follow-up `CHAT_ALERTS.md` records the native count-only tab/title/Web Audio client, focus/visibility/reduced-motion handling, account-bound controls and baseline/replay/departure protection. The user selects sound off until enabled and preserves own-message alerts. Final selected full verification passes all units, 10 desktop/mobile cases and 22 smokes with complete unchanged guard, matching independent source capture, isolated cleanup and working static adoption. The earlier larger run's fixture/setup failures and concurrent source invalidation are retained; complete older presentation/authority/report re-certification remains open. Actual deployment policy, background timer throttling, browser/device sound permissions and audible hardware output remain explicit dependencies.

## Source Integrity

Each inspected public file is byte-identical in the supplied chat/chatbox bundles. SHA-256 values:

| File Relative To Bundle | SHA-256 |
| --- | --- |
| `data/public/js/pfcgui.js` | `41d8f3adf66d0e829f3590132e268c64411adf2665094761c661f3c260d3cbef` |
| `data/public/js/pfcclient.js` | `ee2d1b3d4344ef7844f582f3d490fe653c5e6119afa7675aa3888b609e4035bd` |
| `data/public/js/activity.js` | `44f2dabc6709a3eda5d6f24c7bc4cb90bf3eb8b0f026b676cdbd512e2a7cc820` |
| `src/pfcglobalconfig.class.php` | `ec2ecc246a60cfda172b61181a4936f9023f558ca3b964c09ebd4952fe731b20` |
| `themes/default/style.css.php` | `b54033be9bbf8e7f8dda3ebb2dedb18703cb44ec4a2ee9badd5766e788f81f4b` |
| `src/commands/me.class.php` | `7973d49496af8776e4e4f180803dcddaf3f5c482a53b51deb19e8f65288551f6` |

Generic structured administrative-command recall/replay, translations/themes/alternate catalogues, actual retention/key policy and historical imports remain separate requirements in the active full coverage goal. This audit is not a blanket license or asset reuse approval.
