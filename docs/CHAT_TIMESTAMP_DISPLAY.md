# Chat Timestamp Display

Implemented 2026-10-11. The user selects preserved message text, account names without presence, and moderated institutional rooms. No automatic word filter or body rewriting is introduced.

Private conversations and institutional room histories now offer a native Show timestamps checkbox. Timestamps default to visible. The choice belongs to the current accepted participation's in-memory tab context: refresh and tab switches preserve it, while context disposal removes it. It is not a stored account preference. Room report queues, disclosed evidence and case-history dates are not affected.

Changing visibility updates only message-history time elements. It does not send API requests, clear messages, mark them read, alter participation, submit a report, modify a draft or rewrite persisted text. Existing disconnected-node/workspace-generation guards apply to the event handlers. Busy/pending command states disable the controls.

## Verification

- `e2e/private-tabs.spec.js` and `e2e/room-tabs.spec.js`: four desktop/mobile journeys pass. Added checks cover default visibility, hiding, refresh persistence, independent background-tab defaults, returning to the original choice, restoring visibility, preserved drafts, unchanged synthetic record hashes and absence of messaging writes. Private detached-control events remain harmless after identity replacement.
- Existing journeys retain paging, local clear/restore, background refresh, revocation, consent renewal, retry and eight-tab-limit checks.
- First run `svu_rebuild_it_1791703274553` failed all four journeys at a duplicate fixture background-open step after the new visibility assertions. This is not a successful run or a demonstrated product regression. The fixture now uses the already-open tab, and screenshots scroll the new control into view.
- Corrected full run `svu_rebuild_it_1791703478927`: unit suite, four browser journeys and all 22 smoke/demo checks passed. Database teardown succeeded; both owned database names were independently confirmed absent. Playwright last-run status is passed with no failures.
- Separate `npm.cmd test` passed all 581 tests, with zero failures/skips/cancellations, in 26353.545 ms. The current guarded source fingerprint still matches the successful integration run after documentation updates.
- All 521 guarded sources remained unchanged during the corrected run; SHA-256 `1373b418e6095677632a11f8334e66b93136871784070821e63a50b588829681`.
- Private and room timestamp-hidden screenshots were inspected on desktop and mobile. The controls and displayed messages do not overlap. Mobile composer content continues below the viewport; this does not certify the broader fixed-navigation layout concern as resolved.
- Working localhost:4173 health and both updated static chat scripts return 200. No server restart or working-data mutation was needed.

## Remaining Work

Minimize/restore, safe optional formatting/composition, alerts, localization, theme/asset ownership and broader presentation proof remain open. Institutional policy/retention approval, key operations and authoritative legacy import remain external dependencies. The overall legacy coverage goal remains active.
