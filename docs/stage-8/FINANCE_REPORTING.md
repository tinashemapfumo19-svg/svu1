# Stage 8 Finance Reporting

Development implementation of `RPT-05`, `RPT-11` and the roadmap's finance dashboard, governed dictionary and permission-aware export requirements. This extends Stage 4 control totals without changing fees, opening-balance imports, postings, allocations, holds or independently approved adjustments. It is not accounting/ERP (`FIN-16`, ADR-009), approved institutional reporting or a Stage 8 exit.

## Definitions And Cutoff

`finance-control-totals-v1` defines nine measures with IDs, units, formulas, exclusions, filters, refresh rules and proposed Finance office ownership. All definitions/exports remain development/owner-approval-pending. Meaning changes require a new version; there is no arbitrary formula editor.

- Programme accounts: distinct student programme records with recorded ledger activity, not unique students; transferred students can retain separate accounts.
- Opening: opening charges minus opening credits, already included in charged/credited; never add again to balance.
- Charged: recorded charges, not accounting revenue recognition.
- Paid: recorded payment entries, not adjustments or unmatched statement lines.
- Credited: credit entries, including approved adjustments and opening credits, not payments.
- Balance: charged minus paid minus credited; may be negative.
- Outstanding: charges less recorded allocations.
- Due: outstanding charges due by the selected date; a subset of outstanding.
- Unallocated: payments/credits less recorded allocations, not the import queue.

JSON amounts remain integer minor units. Currency totals remain separate with no exchange conversion/netting. CSV/display use exact two-decimal major-unit formatting under the existing subledger model. Row, derived balance and aggregate arithmetic check safe-integer precision; unsupported totals fail rather than round. Every intake/currency reconciles outstanding minus unallocated against balance. Currency controls require every row to agree, so opposing discrepancies cannot cancel. Reports never repair source records.

The existing recording-cutoff meaning is explicit: `recorded_at` entries and `allocated_at` allocations before midnight after the selected UTC date. Earlier payment receipt/business dates do not invent an earlier posting. SQL uses UTC independently of connection timezone. Current programme/intake metadata and current authority are used, not reconstructed historical membership/roles/labels. Future cutoffs are rejected. This is a live calculation, not an immutable historical edition or approved accounting close.

## Authority And Exports

- `GET /api/finance/reports/control-totals/dictionary`: `finance.view`, definitions only.
- `GET /api/finance/reports/control-totals`: current permission-specific finance scope; optional `asOf`, `programmeCode`, `intakeId`, `currency`.
- Same endpoint with `format=csv`: fresh source calculation/current authority check; authenticated JSON envelope with CSV, filename, version and generation time.

Only roles granting `finance.view` lend scope. Authorized intake metadata is selected before ledger aggregation; SQL restricts programme accounts to selected authorized intake IDs. Inaccessible explicit intakes return 404. Empty programme selections skip ledger SQL. Zero-activity intakes remain selectable without invented currency accounts. Unknown filters/formats, invalid/future dates, unsafe identifiers and malformed currency codes are rejected.

One repeatable-read transaction supplies generation time, metadata, ledger/allocation totals, queue and read/export audit. The unmatched statement queue needs independently global `finance.import` authority, respects currency, and has its own current timestamp. It is not a historical ledger amount or programme/intake-filtered queue: unmatched lines have no programme binding. UI labels it current; CSV excludes it.

Reports expose aggregate amounts/counts and intake metadata, not student numbers, identities, programme-account IDs, ledger references, reasons or private evidence. Separate `reports.finance.accessed`/`reports.finance.exported` audits contain version/time/filters/row count/controls, not identities. CSV includes version, pending approval, cutoff/time/filters, row kind, currency and reconciliation. Untrusted text is quoted/formula-neutralized; typed negative money remains a decimal. Responses use `no-store`.

## Workspace And Privacy

Registry supports recording-date/intake/currency selection, refresh, exact amounts, definitions and fresh export. Browser-cached CSV generation is removed. Failed explicit refreshes suppress old totals/export and offer another date/currency request. Initial cross-domain loading tolerates absent finance authority. Generic registry session reset clears report/filter/definition caches before logout and on bound 401. Departed loads cannot restore old data; export uses the session-bound API wrapper before downloading.

## Verification

Eight reporting units and two existing migration validation units pass. Coverage: metadata/meaning, filters, scope before SQL, UTC recording/allocation cutoff, empty/denied selections, currency separation, current queue authority, non-cancelling controls, exact/overflow arithmetic, fresh export audits and CSV safety.

Initial isolated `data/build-finance-reporting` passed migration/seed, units, 10 of 12 browser checks and all 22 smokes, but remains failed. Its two opening-balance browser checks used an undefined token from a programme record in the new applicant denial assertion, causing 401 instead of testing authenticated 403. The harness now retains the applicant's account session; no authority behavior or ledger mutation was changed. Database `svu_rebuild_it_1791184932741` and its server were removed. Original evidence remains failed, not relabeled green.

Corrected full `data/build-finance-reporting-final` passed migration/seed, units, all 12 selected desktop/mobile checks and all 22 smoke/demo checks. The persisted summary is `data/build-finance-reporting-final.log`; database `svu_rebuild_it_1791185420345` was dropped and server stopped. The additional terminal unit run confirms 216 passed with no failures/skips/cancellations (`data/build-finance-reporting-unit.log`). Synthetic desktop/mobile long-label/viewport screenshots and the actual desktop cutoff/empty-state report were inspected. This is affected-workflow verification, not a full browser-suite or institutional-data acceptance claim.

The expanded journey checks a payment recorded after the panel loaded appears in fresh CSV, original recording-cutoff behavior, unrelated-global-role scope isolation, applicant denials, definitions, audit privacy and actual session revocation preventing download. Desktop/mobile layout/session checks cover long labels, fresh filters/exports, error suppression/recovery and departed loads. These checks are scoped, not institutional acceptance/full-browser-suite claims.

## Local Runtime

Healthy at `http://127.0.0.1:4177/#registry`, PID 23268, launcher session 88078, logs `data/dev-finance-reporting.log` and `data/dev-finance-reporting.err.log`; previous PID 17936 stopped. No local migration/reseed or ledger posting was performed. Read-only checks retain 188 accounts, 114 applications, 28 student programmes and zero ledger entries. Reporting endpoints return unauthenticated 401 with `no-store`.

## Remaining Gates

D-28 metric ownership, institutional/accounting-close/timezone acceptance, disclosure/statutory reporting, immutable editions, schedules/distribution/consent, approved legacy reconciliation, production-volume performance and Finance office sign-off remain open. ADR-009 accounting integration and provider decisions remain separate. No schema migration, local reseed or policy waiver is required.
