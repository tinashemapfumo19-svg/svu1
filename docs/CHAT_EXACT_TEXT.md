# Exact Message Text

Follow-up implementation, 2026-10-12. The user chose messages as written without automatic word filtering. This change affects new private/room message storage and literal room report evidence, not identity, presence, aliases or slash commands.

Subsequent verified action work in `CHAT_PRIVATE_ACTIONS.md` advances newly created private receipts from this stage's `v2:` exact-body format to `v3:` exact-body/kind format. Both historical exact `v2:` and original trimmed receipts remain text-only compatible; the stage-specific contract/proof below records the original milestone.

## Contract

- Valid body strings retain every submitted character, including leading/trailing spaces, tabs and CR/LF sequences. Nonblank validation still uses `trim()` only as a predicate, not a storage transformation. The 4000-character limit, NUL rejection and existing quota/authority/consent gates remain.
- New private receipts contain `v2:` plus the existing keyed SHA-256 construction over `{id,body}` using exact body text. An exact replay returns the same record; changed whitespace with the same key conflicts. A deliberate new key creates a new intent under existing quotas.
- Existing unprefixed private receipts retain their historical digest over trimmed text. Replaying one never inserts, rewrites or recovers lost whitespace. Unknown or mismatched receipt values conflict. Existing envelopes and append-only SQL protection are unchanged; no migration is required.
- Room command receipts already bind canonical exact input. Their format and compatibility are unchanged. Message validation is now separate from administrative normalization: history, report intake and disclosed report detail accept exact message bodies; report reasons, policies and other administrative fields still normalize as before.
- Encryption still binds message IDs, conversation/room, author and room membership/kind. Hidden room bodies remain undisclosed; malformed ciphertext/identity swaps still refuse reconciliation. No working records, fixtures, grants, imports or provider settings were modified.

## Verification

`test/chat-exact-text.test.js` adds six focused units for encrypted exact text, new/legacy private receipts, whitespace conflicts, exact private history, all three room kinds, disclosed evidence and invalid bodies. Together with existing backend tests, 28 pass. The standalone suite passes 639 tests, zero failures/skips, duration 76883.6708 ms.

Native browser fixtures in `e2e/private-messages.spec.js` and `e2e/message-rooms.spec.js` now submit padded tab/CRLF multiline text, verify exact authorized API history and refuse a trimmed-body retry with the same request key. Existing acceptance, encrypted storage, live UI, report, authority, consent, moderation and privacy assertions remain.

Isolated run `svu_rebuild_it_1791792882675` passes all four desktop/mobile cases with terminal exit 0, successful migration/seed/server/browser steps, and complete unchanged source guard: 565 files, SHA-256 `01eaf78e7ae7d2915a1765d572812850c3c9b627722f97a2305cc0fead486dbf`. Playwright last-run passes with no failed tests. The runner reports database dropped; an independent PostgreSQL catalog/filesystem check confirms its database/outbox/storage are absent. This focused browser-only run did not execute smoke scripts or certify the full messaging regression set.

## Boundaries

The working development backend was not restarted during the original exact-text stage. The subsequent action stage now records verified working adoption of both changes through an owned-process reload, without working data writes or reseeding. Shared UI editing remains the user's last confirmed state; a changed full integration source guard must be reported rather than narrowed or bypassed. Private actions are now implemented/verified in `CHAT_PRIVATE_ACTIONS.md`; alert semantics remain separate requirements in `CHAT_REMAINING_BEHAVIOR.md`. The full legacy coverage goal stays active.
