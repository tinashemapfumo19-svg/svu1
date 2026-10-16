# Private Report Editions

Stage 8 retained-report foundation, migration `069_report_editions.sql`, extended by `076_assessment_reporting.sql`. All ten native operational report kinds are supported: admissions, registry/enrolment, finance, student support, prospective enquiries, applicant campaigns, academic outcomes/awards, confirmed-period continuation, examinations and [assessment recording workload](ASSESSMENT_REPORTING.md). This is creator-private development custody, not institutional publication or a legal records-retention policy. Earlier nine-kind acceptance below remains historical; the assessment contract records extension verification separately.

## Capture And Custody

The existing native report panel exposes Save latest edition. Capture submits only kind, native filters, bounded title/reason, an explicit inclusive UTC keep-until date and an idempotency key. Server regenerates the native report with its existing permission checks, source reconciliation and repeatable-read snapshot. Browser figures, arbitrary definitions and uploaded CSV are never accepted. Native source capture and subsequent custody insertion are separate transactions; this is not an asserted single source-and-store transaction.

Saved JSON retains the original source time, version, definitions, selected rows, aggregate controls and readiness. Choice-only `availableIntakes`/`availablePeriods`/`availableCourses` are removed. Assessment selection retains explicit intake custody even when no offering matches. Original CSV is generated with the native formula-safe serializer and pinned, not regenerated using a later serializer or live source. Subsequent source changes cannot rewrite an edition.

Title, reason and combined JSON/CSV payload use existing AES-GCM encryption. Keyed digests bind the encrypted payload and immutable custody headers/grants. Libraries verify header integrity without fetching report bodies. Detail/download verify body integrity and its version/time bindings; faults return reconciliation errors, not repair or live replacement. Four-megabyte serialized snapshots must be narrowed rather than partially retained.

Creator/request-key uniqueness plus an advisory lock prevents duplicate retained rows. Replay uses the signed original request and current authority without regenerating a native source; changed custody fields conflict. Concurrent first requests may both generate a native snapshot but only one is retained. Replay cannot reopen an expired/withdrawn or inaccessible edition.

Database triggers forbid modifying source payload, title, reason, grants, keep-until, timestamps or other immutable fields and forbid row deletion. Only retained-to-withdrawn lifecycle changes are allowed. This is not protection against a database administrator disabling triggers, truncation, key theft or malicious database administration.

## Current Authority

Editions belong exclusively to their creator, including when another account has global report or administrator permission. This preserves native creator-only unpublished campaign privacy; no share/delegate endpoint exists.

Each read/download and request replay rechecks all original source grants, including original AND current intake programme bindings. All captured scopes must still be authorized; no partial masking, revised denominator or recomputed old total is returned. Academic domains retain native ordered first-award-read authority. Enquiry application associations retain secondary admissions-review authority. Finance retains every selected intake, including intakes with no ledger activity; a captured global unmatched-import queue additionally requires current global import authority. Examination scheduling/publication uses native scoped permission union. Unrelated global roles never widen the relevant permission.

Library authority filtering precedes pagination and totals. Metadata is creator-only and requires complete current source scope even for expired/withdrawn editions. Empty kind authority gives an empty library. Expired or withdrawn content fails before fetching/decrypting the body. Audits contain generic operations, bounded kind/version/time/keep-until metadata and library returned count, never plaintext custody titles/reasons or report labels/figures.

## Lifecycle And UI

Keep-until is today through 366 days ahead, checked against database UTC time and inclusive through that day's end. The UI's initial 30-day selection is a development convenience, not an approved retention duration. Expiry refuses reads/downloads but does not erase encrypted custody. Creator-only reasoned withdrawal is terminal and retry-safe. A creator may withdraw by known ID after losing source permission; this returns only ID/status/replay, not any private labels or report data. It does not restore authority or dispose of legal records.

The saved library has kind/status filters, pagination, scoped metadata, original report totals/rows/definitions/controls and authenticated original CSV download. Capture/withdraw use bounded modal forms. Token/generation guards ignore old sessions and superseded library/detail requests. Authority refusals clear private state; source errors remove selected report content. Sign-out clears shared staff/registry state. No report payload or CSV is persisted in browser storage.

## API

- `GET /api/reports/editions`: optional `reportKind`, `status=all|retained|expired|withdrawn`, `limit=1..100`, `offset=0..10000`.
- `POST /api/reports/editions`: `reportKind`, `filters`, `title`, `reason`, `retainUntil`, `requestKey` (8..100 ASCII letters/digits/underscore/hyphen).
- `GET /api/reports/editions/{id}`: retained JSON plus authorized metadata.
- `GET /api/reports/editions/{id}/download`: pinned original CSV and fixed ID-based filename.
- `POST /api/reports/editions/{id}/withdraw`: bounded `reason`.

All routes authenticate and use no-store. Existing report permissions remain authoritative; no new blanket report role is introduced. Unknown input fields/export-format capture overrides fail 400; missing/private/expired/withdrawn detail is 404; tampering/reconciliation and changed request fields are 409; oversized content is 413.

## Verification

Thirteen focused tests pass, covering strict contracts, native scope/secondary authority, pinned definitions/CSV, encryption and both signatures, replay, creator privacy, scope loss before body lookup, UTC expiry, terminal blind withdrawal, authority-before-pagination and size/time guards. Serial final-source unit acceptance passes all 335 tests with no failures/skips (`data/build-report-editions-unit-acceptance.log`, launcher 32533 exit 0). Earlier standalone concurrent `data/build-report-editions-unit-final.log` remains FAILED at 334/335 after the existing crypto secret-derivation helper returned `Deriving bits failed` (launcher 97948 exit 1); no security helper was changed on that evidence alone.

Initial `data/build-report-editions-initial.log` remains FAILED at 4/6 desktop/mobile checks: loader/button tests passed, native journeys correctly rejected fixture request keys containing dots. Migration, units and all 22 smokes passed. Launcher 94856 ended exit 1; driver dropped `svu_rebuild_it_1791226048813`. Fixture keys now use underscores.

Second `data/build-report-editions-recovery.log` remains FAILED at 4/6: a test incorrectly expected a finance-version value inside an empty native CSV, whose unchanged native serializer produces headers only when no ledger activity exists. Migration, units and 22 smokes passed. Launcher 45530 ended exit 1; driver dropped `svu_rebuild_it_1791226281531`. All nine capture checks now compare archived CSV byte-for-byte against the native serializer; the finance serializer/contract was not changed.

Recovery `data/build-report-editions-recovery-native-csv.log` PASSED all six desktop/mobile checks plus migration, units and all 22 smokes. Launcher 63633 ended exit 0; driver dropped `svu_rebuild_it_1791226573218`. All THREE earlier owned databases are independently absent. This verifies native captures/JSON/downloads/replays for all nine types, concurrent single-row custody, source mutation versus pinned originals, encryption/metadata-only audits, database immutability, another creator's refusal, scope-loss cache erasure/download refusal and blind terminal withdrawal. Loader/synthetic-button checks cover all nine panels without altering native form submits. Desktop/mobile saved-library viewport screenshots were inspected; wide tables scroll within the page and labels wrap without page overflow.

Broader selector independently lists 32 desktop/mobile checks across eight affected reporting files. `data/build-report-editions-acceptance.log` PASSED migration/seed, units, all 32 selected checks and all 22 smokes, including the native withdrawal dialog and capture-modal sizing/screenshots. Launcher 93485 ended exit 0; driver dropped `svu_rebuild_it_1791226878160`; last-run was passed with no failures. This checkpoint precedes the final small frontend change that exposes save/withdraw errors inside an open modal and clears old errors when opening a new one.

Final `data/build-report-editions-modal-acceptance.log` PASSED migration/seed, units, all EIGHT independently listed desktop/mobile checks and all 22 smokes after that refinement. New dialog checks preserve bounded retry fields, escape visible source errors and cancel without retaining private input. Launcher 27285 ended exit 0; driver dropped `svu_rebuild_it_1791227443793`; final last-run passed with no failures. The eight focused checks overlap the earlier 32; they are not 40 distinct checks. All FIVE owned databases are independently absent, finite launchers are terminal and port 4197 has no listener. Final desktop/mobile capture-dialog and library/full-page screenshots were inspected; forms fit, labels wrap and wide tables scroll within the page. Faults/fixtures were confined to driver-owned databases. No full-browser-suite or production acceptance is claimed.

## Local Runtime

The native migration runner applied 069 plus the existing pending Claude-authored 070 sponsorship schema (`data/build-report-editions-local-migrations.log`), without finance-source edits, reseeding or reference reload. Read-only counts remain 188 accounts, 114 applications, 28 programme records and zero registrations, enrolments, campaigns/recipients, support cases and enquiries. New editions and sponsorships remain zero; no local operational fixtures were created.

Previous owned development PID 18176/launcher 1341 was stopped after independently checking its node process/start time and 4177 listener; launcher 1341 ended exit 1 from explicit termination. Matching-source development PID 26740/launcher 7977 intentionally remains live at `http://127.0.0.1:4177/#registry`, logs `data/dev-report-editions.log` / `.err.log`. Health is 200/no-store; anonymous library/detail/download are 401/no-store; the error log is empty. Only this persistent development server remains intentionally running.

## Remaining Gates

The [private schedule foundation](REPORT_SCHEDULES.md) now implements delegated background capture into these editions. Institutional metric ownership/approval, historical census/identity and small-cell disclosure, sharing/distribution, approved retention/disposal/legal holds, production worker operations, provider dispatch, owner/accessibility acceptance and production migration remain open. Private retained editions do not approve any of those policies.
