# Academic Outcomes And Awards Reporting

Stage 8 management reporting. No schema change. Dictionary `academic-outcome-operations-v1` defines 28 operational measures; institutional ownership and approval remain open under D-28.

## Scope And Meaning

Registry > Academic outcomes and awards separates results, decisions and awards. Results use native `results.view`; decisions use `academic.view`. Awards mirror the native award reader's FIRST granted permission in this order: `registry.view`, `academic.view`, `registry.award.request`, `registry.award.approve`. Award scopes are not unioned across these permissions. Each permission's programme AND intake scope is checked using only roles granting it. Unrelated global roles do not widen authority.

Intake choices are the union of separately authorized domains. Optional `domain` selects one domain; other measures become null. Without that filter, any domain unavailable on any selected intake has null selection-wide totals and controls, rather than misleading partial totals. Authorized intake rows retain their own counts. Missing authority is not zero. Explicit inaccessible intake/domain combinations fail 404; an ungranted domain fails 403. Separately scoped source queries never read another domain's operational records.

Default is all retained periods and current record statuses. There is no historical/as-of, census, retention-rate or event-date filter.

## Definitions

- Results: retained batch statuses; confirmed course enrolments; current published official results; enrolments without official results; passing/non-passing snapshots; amended current records; distinct programme records with results; mark samples and their direct arithmetic mean.
- Confirmed enrolments include retained physical course enrolments in open/future periods, not attendance, current access or recognized credits. Missing results are neither failures nor necessarily overdue.
- Each retained official attempt contributes once to the mean. It is not credit-weighted GPA, latest-attempt completion, classification or an approved comparison across grading policies. Distinct programme records and direct sample means are recomputed across the whole selection, not summed or averaged from intake summaries. No mark samples yields null.
- Decisions: retained requested/approved/rejected and progression/repeat records, date-expired approvals and distinct programme records. Superseded, completed and evidence-stale records remain retained counts. Approval does not establish current eligibility; reports do not reevaluate current policy, result hashes or programme revisions. Expiry uses the snapshot's UTC date.
- Awards: retained requested/approved/rejected conferral records, distinct programme records with approved awards and current completed programme records. Counts are not unique graduates, certificates issued, live readiness assessments or a graduation-rate denominator.

Each measure carries formula, exclusions, unit, proposed owner, approval status, filters and refresh policy. Proposed ownership is Academic/examinations for results/decisions and Registry awards for conferrals.

## Source Controls

One repeatable-read transaction captures generation time, permission-specific intake selection, source checks and grouping-set aggregates. Results, decisions and awards each have reconciliation controls; unavailable controls are null. Intake discrepancies cannot cancel into a passing total.

Before counting, programme-version/intake bindings are checked. Native student programmes have no separate resource-scope records. Authorized result sources additionally reconcile confirmed-registration enrolment custody and selections, each batch's complete roster, distinct original enrolment tuples, whole-number marks, row counts and mark totals, publication/review timestamps and independent publication. Current official snapshots must originate in their published batch or match the latest approved amendment's revision, snapshot and timestamp.

Decision sources check programme/period/policy bindings, ordered request/review timestamps and retained approval readiness/independence/expiry-at-review evidence. Award sources check published non-draft completion-rule bindings, retained request eligibility, review ordering, independent approval and linked completion history. Completed programme records require retained approved award evidence.

These are declared source/custody controls, not a regrade, cryptographic checksum recomputation, current eligibility/audit rerun or full migration acceptance certificate. Retained approved conferrals remain countable after a later result amendment. A source inconsistency returns 409; reporting never repairs sources.

## Privacy And Exports

Outputs omit student/account/programme-record/result/batch/decision/award IDs, individual marks, names, contacts, reasons and retained personal evidence. Only authorized intake metadata, definitions, aggregate measures, filters, generation time, authority and controls appear. Audits retain bounded definition/count/domain/control metadata, not source evidence or intake labels.

CSV is a fresh authenticated source read, not cached screen totals. Cells are quoted and formula prefixes neutralized. Filename is fixed `academic-outcome-operations.csv`; APIs use no-store. Token/generation-bound loaders discard departed or superseded responses. Scope/session refusals erase totals, intake and filter caches. Source/network failures hide old totals and disable export; recovery obtains fresh authorized intake metadata.

## API

- `GET /api/reports/academic`: JSON; optional `intakeId`, `domain` (`results`, `decisions`, `awards`), `format=csv`.
- `GET /api/reports/academic/dictionary`: versioned development definitions.
- `GET /api/reports/academic/intakes`: separately authorized intake/domain choices without operational count reads.

Unknown filters, unsafe identifiers, unsupported domains and formats are refused.

## Verification

Nine focused unit tests pass, covering dictionary, bounded filters, native ordered award scope, direct whole-selection samples/distinct counts, separate domain queries, null unavailable totals, source refusal/rollback and fresh audited formula-safe CSV.

Initial `data/build-academic-reporting.log` remains FAILED: both loader journeys passed, but both native workflow fixtures attempted to create a second-year period without any second-year curriculum courses and were correctly refused. The unit suite and all 22 smoke checks passed; launcher 89653 ended exit 1 and the driver reports teardown of `svu_rebuild_it_1791220148487`. A synthetic second-year elective was added only to the isolated fixture. No full-browser-suite or production acceptance is claimed.

First recovery `data/build-academic-reporting-recovery.log` remains FAILED at 2/4 browsers because the report incorrectly required nonexistent native StudentProgramme resource-scope records. That unsupported guard was removed while retaining the actual programme-version/intake check. Launcher 37182 ended exit 1; database `svu_rebuild_it_1791220428503` was dropped. Second recovery `data/build-academic-reporting-recovery2.log` remains FAILED at 2/4 browsers because its fixture incorrectly expected the seeded academic approver to lack results.view. The expectation now follows the real seeded permission set; separate custom-role scope/null checks remain. Launcher 62070 ended exit 1; database `svu_rebuild_it_1791220646256` was dropped. Units and all 22 smokes passed in both recoveries. All three owned databases were independently confirmed absent.

All 309 final-source unit tests pass (`data/build-academic-reporting-unit-final.log`). Final `data/build-academic-reporting-final.log` passes migration/seed, units, all FOURTEEN independently listed desktop/mobile checks across five files (academic reporting, academic records, graduation awards, result amendments and registry-report layout) and all 22 smokes. Last-run metadata is passed with no failures. Launcher 63818 ended exit 0; the server stopped, database `svu_rebuild_it_1791220799622` was dropped and independently confirmed absent, and port 4197 has no listener. All FOUR owned test databases are absent; unrelated databases were not touched.

Native journeys verify independently published results, retained progression approval/rejection, approved conferral/completion, source changes through independent amendments, direct SQL mean comparison, fresh CSV versus older screen totals, separate custom-role domain scopes and null whole-selection totals, source fault refusal without unsafe numeric casting, absence of unauthorized cross-domain reads, stale-total hiding/export disablement, repair recovery, formula-safe labels, private audit metadata and live role-expiry cache clearing. Loader journeys verify departed/superseded/revoked state and metadata recovery. Final desktop/mobile viewport and full-page screenshots were inspected; measures wrap, controls fit and the intake comparison table remains contained.

## Local Runtime

No migration, reseed, reference reload or operational mutation was needed. Previous owned development PID 7816/launcher 14614 ended after listener ownership was verified. Matching-source PID 15708/launcher 73741 intentionally remains live at `http://127.0.0.1:4177/#registry`, with logs `data/dev-academic-reporting.log` and `.err.log`. Health is 200; all three anonymous academic-report routes are 401/no-store; the error log is empty. Independent read-only counts remain 188 accounts, 114 applications, 28 programme records and zero registrations, enrolments, applicant campaigns/recipients, support cases and enquiries. Other agents' existing work and reservations were preserved.

## Remaining Gates

Metric/source-control approval, census/cohort denominators, historical eligibility reconstruction, retention/graduation rates, grading-policy comparability, small-cell disclosure, distribution/retention policy, scheduled editions, accessibility/owner acceptance and production migration remain open.
