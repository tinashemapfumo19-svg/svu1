# Result Period Completion

Guide: EXM-10 recorded/unrecorded completion visibility and RPT-07 recording/publication reports. Development definition: `result-period-completion-v1`. Academic/examinations ownership and institutional acceptance remain pending.

## Native Boundary

The existing staff `GET /api/registry/programmes/:id/results` reader adds `completion` to each registration-period entry. Its existing `results.view` permission and permission-specific programme/intake scope are unchanged. The native staff workspace already reads the selected programme's intake/curriculum-wide result roster; these are course-enrolment counts for that period, not the selected student's individual counts. Student self-service still returns only their published outcomes and does not receive staff completion or rejected/draft batch data.

The complete read uses one repeatable-read transaction. No new permission, schema, grade calculation, marking, import, review, publication or amendment policy is introduced. The dashboard does not authorize a write or attest to institutional grading approval.

## Definitions

- `expectedRecords`: distinct native confirmed-enrolment registration/course tuples returned by the existing result roster reader. This is not an attendance, student, active-access or historical census count. Coordinated withdrawal semantics follow the separate native results workflow; this dashboard does not invent a withdrawal rule.
- `recordedRecords`: expected tuples present in the single non-rejected result batch, whether draft, reviewed or published.
- `awaitingRecording`: expected tuples absent from that batch. Missing work is not a failed mark or necessarily overdue.
- `awaitingReview`: recorded expected tuples in a draft batch.
- `awaitingPublication`: recorded expected tuples in a reviewed batch. Independent review does not make a result official.
- `publishedRecords`: expected tuples with retained official result custody in the published batch. Approved mark amendments do not move these records back to pending.
- `outsideRosterRecords`: retained non-rejected batch tuples not on the current confirmed roster. They remain evidence rather than being silently removed.
- `rejectedBatches`: retained rejected batch records, not current recorded work.
- `sourceCurrent`: no current batch, or its exact tuple membership equals the current roster. A changed roster is visible reconciliation workload, not an automatic deletion, repair or authorization to retry publication.

Awaiting recording/review/publication and published records partition expected records. Recorded plus awaiting recording also equals expected records. Official custody requires an exact, unique complete official tuple set for a published batch, correctly bound to that batch and its snapshot tuple; unpublished batches cannot supply official records.

Before figures are returned, all retained batches have their declared count, whole-number marks, mark total and native SHA-256 checksum recomputed. Duplicate roster/batch/official tuples, multiple non-rejected batches, malformed statuses and invalid official bindings/revisions fail 409. This verifies completion source arithmetic and tuple custody, not every grading band, approved amendment decision, retained workflow timestamp or institutional policy; separate academic reporting and native amendment controls remain necessary.

## Staff Experience

Each result period shows awaiting recording, review, publication and official counts alongside the existing batch history and commands. Changed membership and outside-roster/rejected history remain explicit. A failed result refresh removes cached result figures/batches and leaves Refresh results available for a newly authorized retry. Sign-out uses the existing registry cache reset. Controls have responsive grid tracks without floating section cards.

`results.completion.viewed` audits retain definition version, period count and changed-source period count only. No marks, roster tuples, batch checksum, student numbers, personal details or notes are added to this metadata. No new report CSV, private-edition/schedule kind or intake-wide management-report authority is implied; these remain the existing separate report sources.

## Verification

Six focused tests cover partitions, rejected and empty periods, changed roster membership, malformed/checksum/tuple source refusals, amended official completion and escaped/absent/unavailable UI state. Existing result checksum, reconciliation and publication-window tests remain intact. Native checkpoint evidence is recorded in [BUILD_VERIFICATION.md](../BUILD_VERIFICATION.md); pending verification is not acceptance.

Selected checkpoint 7338 exit 0 PASSED all eight independently listed desktop/mobile admissions/result-amendment checks, all units and 22 smokes, migrations/isolated seed/server/source guard/teardown (`data/build-result-completion.log`). Real native transitions exercise every partition, rejected import retry, publication concurrency, student privacy, unauthorized scopes and approved amendments. Deliberately corrupting the disposable batch checksum refuses figures with 409; the UI removes old counts/batches, and a restored source can be explicitly refreshed. Audit metadata keys are asserted. Desktop/mobile result screenshots were inspected; the four measures wrap into two columns on mobile.

Source fingerprint is unchanged across 363 files: `3cd07332355127aed6261f4a6ee9114d05295a816a565a1bc54e2daef7f2fb70`, no changed paths. Database `svu_rebuild_it_1791253193702` independently absent and 4197 released; last-run metadata is passed/no failures. Standalone unit launcher 89977 exit 0 retains all 395 passing tests, no failures/skips (`data/build-result-completion-units.log`). This is selected development acceptance, not a new complete-suite or institutional/production result.

The old owned development listener 3276 was stopped after acceptance; matching Node PID 12000/persistent launcher 66022 serves the current source at `http://127.0.0.1:4177/#registry`. Health is 200/no-store, anonymous results are 401/no-store, and `data/dev-result-completion.err.log` is empty. No migrations, reseeding or operational fixtures were applied to the working database: counts remain 188 accounts, 114 applications, 28 student programmes and zero registrations/enrolments.

Remaining: approved institutional definitions, small-cell/privacy rules, actual legacy reconciliation, withdrawal integration, real owner pilot acceptance, production/accessibility/load and provider gates.
