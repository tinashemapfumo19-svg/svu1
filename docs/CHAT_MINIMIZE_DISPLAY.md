# Chat Minimize Display

Subsequent stage: `CHAT_WORKSPACE_PERSISTENCE.md` records verified whole-workspace collapse, account-bound reload persistence, deployment default and redraw/polling focus. The earlier whole-widget gaps below are historical and are now implemented; this document retains the selected-thread milestone's original evidence.

Implemented 2026-10-11. Native private and institutional-room selected threads now support local minimize/restore. Controls default to expanded and use the existing accepted-participation tab context. Collapsing hides the selected thread's controls, policy/member area where applicable, message history and composer; its heading, status and restore button remain visible. Tabs, navigation, invitations/preferences outside the thread and the separate room safety-report workspace remain accessible.

The button exposes `aria-controls`, `aria-expanded`, an action-specific accessible name and matching tooltip. Mouse, Space and Enter activation update the existing DOM without requests or re-rendering. Focus remains on the button. Drafts, history cursors, local clear state, report inputs and retry keys are not erased; timestamp visibility remains a separate tab preference. Existing workspace-generation/disconnected-node guards apply. Busy or pending-command states disable the control.

## Verification

- The 18 existing private/room UI units passed before native testing.
- Full isolated run `svu_rebuild_it_1791704159813` passed unit tests, four browser journeys in `e2e/private-tabs.spec.js` / `e2e/room-tabs.spec.js`, and 22 smoke/demo checks.
- Separate `npm.cmd test` passed all 581 tests with zero failures/skips/cancellations in 26214.9733 ms.
- New native assertions cover expanded default, keyboard collapse, accessible restore labels/focus, hidden history/composer/read-or-leave controls, refresh persistence, separate background-tab defaults, return to the collapsed original tab, keyboard restoration, preserved drafts/cursors and unchanged synthetic message/conversation/read/report or room/message/membership hashes. Messaging write watchers remain empty for the local display operations. Detached minimize controls do not revive contexts after account replacement.
- Existing native journeys still prove polling, report draft preservation, local clear/restore, consent/access renewal, lost-response retry and bounded background tabs.
- Private/room minimized screenshots inspected on desktop and mobile: titles wrap without overlapping status/restore controls, and collapsed histories/composers are absent from the visible layout. Room safety reports remain separate. This is not a general certification of every mobile fixed-navigation surface.
- Playwright last-run is passed with no failures. Isolated database teardown succeeded and the owned name was independently confirmed absent.
- All 521 guarded sources remained unchanged during the run and match the current digest: SHA-256 `9c89a2c3766f5a9136a579e3005f84f8c99bfe23b5f43b019300bd3459f1946b`.
- Working localhost:4173 health and both static chat scripts return 200 with the new controls. No working database migration, account/grant change, chat fixture or server restart occurred.

## Exact Legacy Boundary

Read-only inspection of `_legacy_php_system/chat/data/public/js/pfcclient.js:1853` shows `swap_minimize_maximize` toggles the whole `pfc_content_expandable` widget, stores `pfc_minmax_status` in a cookie, and switches the control's image/title. The template also exposes a configured initial minimized state. The new selected-thread controls are verified native progress, not proof of whole-widget, reload-persistent or configured-initial-state parity. Those behaviors remain open for the broader presentation implementation. No legacy JavaScript, PHP, Flash or cookie code was executed or copied.

Safe optional formatting/composition, alerts, localization/theme, institutional policy/retention, key operations and authoritative import remain open. The overall goal remains active.
