# Chat Activity Baselines

Alert prerequisite implementation, 2026-10-12. Existing unread counters and room change stamps are not live-alert counts. These reads supply per-context activity classification without fetching background bodies; they do not themselves implement title, tab or sound presentation.

## Contract

- Authenticated `GET /api/private-messages/conversations/:id/activity` and `GET /api/message-rooms/:id/activity` accept only an optional signed `cursor`. Duplicate query parameters, arbitrary positions, injected authority and non-GET operations are rejected.
- Responses contain only `cursor`, `reset`, `own` and `others`. Counts are exact nonnegative bigint strings, not JavaScript numbers. No body, name, author list, report content, presence or read acknowledgement is returned/published. Existing unread and change endpoints retain their contracts.
- A first read establishes the current baseline and returns zero counts. Subsequent valid cursors count new native private text/actions, or eligible room text/actions. Room notices and currently hidden messages do not alert; hidden/notice positions still advance an authorized baseline so later restoration is not misclassified as new activity.
- Room visibility uses the exact PostgreSQL membership acceptance timestamp and bilateral block filtering. General manager/approver/safety scope does not establish participation. Active room status, current participant consent, fresh actor authority and enabled preferences are required.
- Private activity requires accepted live mutual opt-in, fresh authority for both parties and no bilateral block. Historical closed conversation history remains separately readable under its existing rules but cannot produce live activity counts.
- Cursors bind authenticated account, recipient type/ID, exact high-water position and a keyed authorization epoch. The payload is signed, not encrypted: its own account/context/position are readable, while authorization details are represented only by a keyed epoch. No private names or words are embedded.
- Epochs bind current account/grant/role/permission row versions, including PostgreSQL `xmin`, to detect retained-ID disable/re-enable cycles, plus private conversation/preference revisions or room membership/consent and bilateral block revision totals. Changed access establishes a fresh baseline rather than replaying activity from the prior lifetime.
- Tokens expire after 30 minutes, and a future-issued token following clock rollback also resets. Restored lower positions reset instead of replaying old history. Tokens are at most 1200 characters; tampered, wrong-account, wrong-recipient/type and malformed signed payloads are rejected coarsely. Key failure is 503; snapshot reconciliation faults are 409.
- Reads use repeatable snapshots with existing authority/participant/recipient lock ordering. They query message metadata only, leave encrypted rows/read receipts unchanged, and introduce no new audit writes, schema changes, preference writes, queue entries or providers. Snapshot-time authorization is not a claim about changes committed after that snapshot.
- Replaying the same old cursor returns its same eligible window; the future client must adopt each returned baseline only for its current account/context/generation and deduplicate consumption. This is not a server-side alert-delivery acknowledgement or read receipt.

## Verification

Eight new units cover exact bigint cursors, identity/type/recipient binding, expiry/clock rollback, changed epochs, lower positions, malformed/tampered/oversized input, invalid key/snapshot refusal, repeatable metadata-only snapshots, consent/authority/closed-context gating and grant/block changes. Together with existing private/room backend tests, all 30 focused checks pass.

`e2e/chat-activity.spec.js` adds four isolated desktop/mobile-project API cases for native private/room baselines, own/other text/actions, notice/hidden exclusion, restoration without new alerts, positive encrypted/read row hashes, exact microsecond consent boundary, bilateral blocks/unblocking, consent renewal, participant-only scope, changed grants, inactive role refusal/re-enable baseline reset, closed contexts and malformed/foreign cursors.

Full isolated run `svu_rebuild_it_1791796236994` passes the full unit suite, all 12 selected native cases in five files and all 22 smoke scripts, terminal exit 0. An independent CLI listing confirms actual coverage: activity baselines, private authority, bilateral room/contact blocks, room recipient authority and room safety reports, each in desktop/mobile projects. These are API/authority checks, not visible/audible alert UI proof or the complete prior presentation regression set.

The complete unchanged source guard covers 568 files, SHA-256 `16fe2dee44c84a40958c3d13a1de30b6a4e46a456c7575c952ed888d920ea99a`. The digest independently still matched before adoption. Playwright last-run passes with no failed tests. The runner reports database dropped; independent PostgreSQL/filesystem checks confirm its database/outbox/storage are absent and a TCP probe confirms isolated port 4181 is closed. No source edits occurred during the live run, and no guard was narrowed.

## Working Adoption

Only owned PID 15160/start 1791795067714 was stopped after exact process-start and listener checks. Replacement PID 18988/start 1791796902114 retains explicit development/127.0.0.1/4173/enrolled-MFA/mail-disabled settings. Its intentional launcher session 29090 remains with the service. Logs are `data/chat-activity-dev-1791796902036-{out,error}.log`; the error log is empty.

`/api/health` returns 200/no-store; both new activity routes refuse anonymous reads with 401/no-store; backend helper source remains nonpublic (404/no-store). Before/after working metadata retains 191 active canonical accounts and zero rows across 17 messaging tables; post-check confirms zero room-role appointments and a unique/valid/ready canonical mailbox index. No working fixture, grant, schema migration, reseed, provider enablement or legacy import occurred. Native authenticated classification was proved only in the isolated database; no new working-user login/send proof is claimed.

## Remaining Work

Follow-up `CHAT_ALERTS.md` records native tab/title/audio controls and their separate verification. The user selects sound off until enabled and preserves own-message alerts; these questions are answered. PostgreSQL row versions are authorization-change evidence, not a substitute for deployment key/cursor invalidation during physical restore or key rotation. Live audio hardware/provider and institutional policy/key/retention/import boundaries remain explicit. Shared UI files were not edited for this prerequisite stage, and the full legacy goal stays active.
