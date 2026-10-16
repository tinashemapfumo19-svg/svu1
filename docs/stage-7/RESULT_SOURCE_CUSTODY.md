# Result Approval Source Custody

Guide Stage 7: published results need validation, independent approval and publication history. This strengthens the existing native result workflow without new permission, schema or institutional grading rules. Production and Academic Board acceptance remain separate gates.

## Approval Guards

Before a draft batch is approved for review and before a reviewed batch is first published, the locked native batch must:

- Recompute its whole-number mark count, total and canonical registration/course/mark SHA-256.
- Cover the existing confirmed result roster exactly once.
- Match exactly one native `results.batch.imported` audit receipt for this ResultBatch. Receipt actor, period/source reference, count, total, checksum, reason and exact database timestamp must agree with the retained batch. Recomputing altered marks' controls cannot replace the original receipt.
- Match immutable identifiers/version/code/rules/grading scheme and classification fields of its effective published pinned policy. Mutable status/effective-date metadata is not compared as content; native policy validity checks still apply.
- Reproduce every retained student/programme/course/credit/grade/points/passing enrichment from the native roster snapshots and pinned grading bands. The mark checksum alone does not bind these fields.

First publication additionally requires exactly one native `results.batch.reviewed` receipt bound to its independent reviewer, original checksum, evidence reference, reason and exact reviewed timestamp. A manually assigned reviewed status is not an approval record. PostgreSQL compares receipt `occurred_at` to the batch timestamps directly, without JavaScript's millisecond truncation of database microseconds.

Failure returns 409 without advancing the batch, adding an official result or writing a successful review/publication audit. Period/calendar/batch locks, separate-approver checks, publication window, effective policies and result uniqueness remain in place. The existing rejection path can still reject a damaged checksum when the roster reconciles; it does not claim approval. An already-published retry still returns the retained batch before these pre-publication guards, preserving exactly-once behavior and later approved amendments or policy retirement.

## Limits

These are trusted native database custody controls, not externally signed source authentication or protection against an operator who can rewrite both source and audit history. Receipt-free or malformed imports cannot be silently upgraded to approved native batches. Approved actual legacy reconciliation must use governed migration/import custody; no existing working records are automatically modified. Rejection's existing roster requirements remain unchanged. Full assessment/moderation/LMS provider provenance, grading approval and institutional separation-of-duty policy remain separate controls.

## Verification

Six focused tests cover legitimate enrichment/row ordering, malformed controls/roster, recomputed forged marks versus origin receipt, checksum-neutral enrichment changes, pinned policy semantics and independent review receipt bindings. Native direct-result tests deliberately alter only a disposable integration database and restore exact timestamp text after each refusal. They assert no official rows, status advancement or successful decision audit, then exercise genuine approval/publication/concurrent retry and damaged-source rejection. The selected checkpoint also includes actual LMS and mixed native-assessment/deferred-completion transfer, plus approved result amendments. Acceptance is recorded only after the finite integration checkpoint completes in [BUILD_VERIFICATION.md](../BUILD_VERIFICATION.md).

Selected checkpoint 68097 exit 0 PASSED all twelve independently listed desktop/mobile checks across admissions, result amendments, LMS integration and assessment marks (including deferred completion), all units and 22 smokes (`data/build-result-custody.log`, requests `data/build-result-custody-server.log`). Thirty intended custody refusals are exercised across both direct-result viewports, followed by successful independent review/publication. Rejection of a damaged checksum and concurrent exactly-once publication remain supported. The fixture restores timestamps using PostgreSQL text rather than truncating microseconds in JavaScript.

Source fingerprint passed unchanged364-file SHA-256 `2de7f243cf1438fd2f8d00bd1caff549e3797760a90e807e311bf89d9dc83066`, changed[]. Database `svu_rebuild_it_1791254424184` independently absent,4197 no listener,last-run passed/no failures. Standalone8274 exit0 confirms401/401units without failures/skips (`data/build-result-custody-units.log`). All finite verification jobs are terminal. This is selected development evidence, not a new full-suite run, approved legacy reconciliation, external source attestation or production/Academic Board acceptance.

Working counts remain188 accounts/114 applications/28 student programmes and zero registrations/enrolments, with no working schema/reseed/operational fixtures. Old owned12000/66022 terminated; current20188/persistent72024 serves4177, health200/no-store,anonymous results401/no-store,`data/dev-result-custody.err.log` empty.

At the custody checkpoint, first result publication had no student notification hook. The subsequent [publication-notice implementation](RESULT_PUBLICATION_NOTICES.md) adds transactional, deduplicated generic notices; its separate acceptance checkpoint is recorded in BUILD_VERIFICATION. Queueing does not establish real provider delivery or approved institutional wording. Existing amendment and timetable notifications remain separate events.
