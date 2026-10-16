# Private Action Messages

Implementation follow-up, 2026-10-12. The supplied legacy `me` handler accepts the current generic recipient and the common incoming renderer recognizes actions across recipient tabs. Native room actions alone did not satisfy private recipient parity.

## Contract

- Private sends accept only `text` or `action`; omitted kind remains text. Notices, arbitrary kinds, null, spoofed authors and unsupported fields are rejected. Slash text remains literal and does not execute commands.
- New encrypted envelopes bind kind alongside the existing message/conversation/account identity and exact body. No separate public kind column is added and no historical envelope is rewritten. Existing envelopes without a kind read as text; explicit malformed kinds refuse secure reconciliation.
- New `v3:` keyed receipts bind conversation, exact body and kind. Changing kind/body with a frozen request key conflicts. Omitted and explicit text are the same text intent. Historical exact `v2:` and original trimmed receipts retain their existing text contract but never replay an action intent.
- The private composer provides Text/Action options. Kind travels with per-context drafts across polling, redraw and independent conversation tabs. A deliberate kind input clears the cached request key, just as a deliberate body edit does; an unedited failed send retains its kind/body/key.
- Existing bounded composer history records kind and restores it with the body/draft/caret. Navigation remains disabled while an unresolved request key is held. Recall followed by a deliberate kind change is a new request, not mutation of prior history or ciphertext.
- Action rows have an explicit Action label and reuse the existing italic action style, with the same account-name/You author label, escaping, optional formatting, report controls and read semantics as text. No aliases, presence, online directories or automatic word rewriting are introduced.
- Revoked/closed/replaced participation, tab disposal and session departure retain their existing context-erasure contracts. Backend actor, pair, consent, quota, append-only records and report ownership gates are unchanged. Private reports retain their immutable message reference and encrypted reason; no new safety-review access is granted.

## Verification

Three new backend units verify kind-bound encryption/retries, v1/v2 text-only compatibility and invalid encrypted/input kinds. Two new UI units verify per-tab kind defaults/restoration and escaped action rendering. Together with exact-text and existing private backend/UI checks, all 30 focused tests pass.

The private live journey verifies action API storage, kind conflicts, notice refusal and two-browser action display/read behavior. The shared composer-history journey uses private actions to exercise keyboard recall, exact draft/kind restoration, independent contexts, lost-response frozen packets, successful retry and deliberate recalled-kind new intent.

Full isolated run `svu_rebuild_it_1791793603941` passes the full unit suite, all 24 selected desktop/mobile browser cases in nine files and all 22 smoke scripts, terminal exit 0. Its complete source guard remains unchanged: 565 files, SHA-256 `cb11f53078fb525c3b118c3e1d7b201151fde3ef9920908a23776296f7ad7510`. An independent CLI listing establishes the actual 24-case/nine-file scope; an additional requested `chat-presentation.spec.js` pattern matched no file and supplies no presentation coverage. This run covers private messaging/tabs/authority, composer history, scrolling, formatting, rooms/tabs and safety reports; it is not the older complete 32-case presentation/name/smiley regression set or whole-goal certification.

Playwright last-run passes without failed tests. Desktop/mobile private-message and private-composer-history PNGs were visually inspected: explicit action labels and literal text, intact read status, fitting kind selector/history/toolbar and no horizontal overflow. Captures live under `test-results/private-messages-private-c-c91ef-rticipant-only-live-history-{desktop,mobile}/private-messages.png` and `test-results/chat-history-private-compo-8d91a-nd-freezes-retry-navigation-{desktop,mobile}/private-composer-history.png`.

The runner reports database dropped; independent PostgreSQL/filesystem checks confirm its database/outbox/storage are absent, and a TCP probe confirms isolated port 4181 is closed. The current source digest independently still matched the verified guard before working adoption.

## Working Adoption

Only owned working PID 6400/start 1791759531925 was stopped, after rechecking its exact start and port 4173 listener. Replacement PID 15160/start 1791795067714 uses explicit development/localhost/4173/enrolled-MFA/mail-disabled settings. Its intentional launcher session 69670 remains with the working service. Logs are `data/private-actions-dev-1791795067590-{out,error}.log`; the error log is empty.

Actual health route `/api/health` returns 200/no-store, anonymous private/room changes return 401/no-store, and served `/src/private-messages.js` is byte-identical to disk, JavaScript/nosniff, 23388 bytes, SHA-256 `9c4f6f031d6932d1b163cec0aaa34ed5ae6546df3bcc4434c8ab2f19c6503a11`. An initial probe incorrectly used `/health` and returned 404; the probe was corrected to the current router/integration health path, not a server code change.

Read-only before/after working checks retain 191 active canonical accounts and zero rows across 17 messaging tables; post-check confirms zero room-role appointments and a unique/valid/ready canonical mailbox index. No working reseed, migration, fixture, grant, provider enablement or legacy import occurred. No new authenticated working-user send proof is claimed; native behavior was proved in the isolated database.

## Remaining Work

Alerts, generic administrative-command replay, translations/themes, actual retention/key policy and legacy import remain requirements of the active full goal. Optional user questions now request sound-default and own-message alert preferences; no answer is assumed. Shared UI editing remains the user's last confirmed state; this unchanged test window does not assert that editing has ended. No unrelated edits were reverted or excluded from guards.
