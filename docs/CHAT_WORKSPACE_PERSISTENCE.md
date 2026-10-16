# Chat Workspace Persistence

Implemented and verified 2026-10-11. This closes the whole-workspace collapse, reload persistence and configured-initial-state presentation gaps identified after the selected-thread implementation. It does not close the complete legacy coverage goal.

## Contract

`src/messages.js` now keeps an accessible minimize/restore control at the Messages heading. Collapsing hides the complete message workspace, including view tabs, histories, composers and room safety cases. Global navigation, notices and an available account selector remain outside the collapsed region. Selected-thread collapse is independent and remains available after workspace restoration.

`src/message-presentation.js` persists only `{minimized:boolean}` at `svu.messages.presentation.v1:<accountId>`. The account ID comes from an authenticated `/api/identity/me` response, not client-supplied session metadata. It is bounded to the existing ASCII identifier shape. Records over 64 characters, malformed JSON, arrays, extra properties and nonboolean values are refused. No token, email, body, draft, report, retry key, cursor, presence, consent or permission is persisted by this preference.

The explicit deployment default is `index.html`'s `svu-messages-start-minimized` meta element, currently `false`; only literal `true` starts collapsed. A valid saved account choice overrides either default. Reload/route return restores the choice for the same account, while another account gets its own choice or the configured default. This is same-browser storage, not server/cloud synchronization. Changing the default does not replace existing valid choices.

Local minimize/restore sends no API mutation, read acknowledgement or participation command. Within-page restoration retains drafts, exact history cursors, local clear state, pending retries and per-tab display choices. Reload/route departure still discards transient private contexts under the existing privacy contract; drafts are not persisted to make them survive reload.

Storage denial is nonfatal: the current page still collapses/restores, but reports that the preference could not be saved. Busy states disable the control. Detached/stale-account controls cannot persist another account's choice. Focus is retained on the workspace control through redraw and metadata-triggered refresh; hidden composers are not refocused. Identity/route generation changes reset saved focus.

## Verification

- Five new presentation units prove explicit defaults/overrides, account isolation, exact one-boolean records, malformed/oversized/type refusal, invalid keys and unavailable storage.
- First full run `svu_rebuild_it_1791705173972` passed full units, 12 desktop/mobile browser cases and 22 smoke/demo checks at 524-source SHA-256 `fa0efa43e57f1bcbe371128d26237f7ab7a3d49494c1deb1b00f0c8eb6f32beb`. It did not yet include the subsequent redraw-focus assertions.
- Native red `svu_rebuild_it_1791705975010` reproduced inactive restore-button focus after redraw in both desktop private/room journeys. Both failures are actual presentation regressions, not fixture mistakes. Its source guard passed at `1c64cceeda79cc764579b057d7138d75f7643a215b6b831b4144c49352475c22`.
- After the focus fix, run `svu_rebuild_it_1791706231590` was interrupted when the execution host disappeared. Its handle was unknown, app/test listeners absent and no completion report remained. It is not counted as passing. PostgreSQL was also unavailable. The existing Docker Desktop service and `svu-postgres` container were restarted after verifying retained image/volume/port configuration; no container/volume recreation or working reseed occurred. The orphaned owned test database had zero connections and was dropped; only its checked, non-reparse, workspace-contained fixture directory was removed.
- Fresh recovered run `svu_rebuild_it_1791753379863` passed full units, all 12 browser cases in four files, and all 22 smoke/demo checks. The private/room journeys now trigger real background metadata updates while collapsed and prove focused restore controls, unchanged selected-thread drafts/cursors/hashes and no browser messaging writes for the local operations. Explicit peer messages are controlled synthetic writes to the other thread, not claimed to leave all test tables unchanged.
- `e2e/message-presentation.spec.js` proves keyboard collapse/restore, reload and route persistence, account isolation, detached controls, configured-default/saved-choice precedence, storage denial, exact stored records and unchanged notification read/status hashes. `e2e/messages.spec.js` retains native inbox privacy/paging/read-acknowledgement and mocked departed-account/authority checks; its identity mock now supplies distinct account IDs.
- Separate `npm.cmd test`: 586 passed, zero failed/skipped/cancelled, 12140.7257 ms.
- Final source guard: 524 sources, before/after/current SHA-256 `0e459b329cefcba09f818b5a938f29a1f7f3a5e27683a5915e57061850952964`, no changes during testing. Playwright last-run passed with no failures. All four owned database names were independently confirmed absent.
- Durable final summary: `data/workspace-persistence-final-1791753379108-summary.log`; error log empty. Runner PID 2392 is absent, launcher terminal and no isolated port 4180 listener remains.
- Latest desktop/mobile whole-workspace collapsed screenshots inspected: the heading/restore control remain visible without overlap, and the message region is hidden. Broader mobile fixed-navigation geometry is not certified as resolved.

## Working State

Restored dev server PID 11744/start milliseconds 1791753489117 serves localhost:4173 with development/enrolled MFA and external mail explicitly disabled. Health and updated scripts return 200/no-store; anonymous private/room changes return 401/no-store. Working read-only checks retain 191 active accounts, zero noncanonical mailboxes, unique/valid/ready canonical index, seventeen messaging tables with zero rows and zero room appointments. Dev error log is empty. No working migration, reseed, account/grant change, chat fixture, provider enablement or archive execution/import was performed.

Safe formatting/composition, alerts, localization/theme, institutional policy/retention/key operations, provider verification and authoritative imports remain open. `CHAT_PARSER_ARTIFACT_REVIEW.md` records read-only preparation for the next formatter gate; no parser has been installed or rendered.
