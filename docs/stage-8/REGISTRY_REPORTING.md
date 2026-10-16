# Stage 8 Registry And Enrolment Reporting

Development implementation of `RPT-03`, `RPT-04`, `RPT-11` and the roadmap's operational registry/enrolment dashboard foundation. This counts existing Stage 3 sources without changing onboarding, registration eligibility, lifecycle, transfers, duplicate resolution, confirmation or awards. It is not institutional/statutory headcount approval or a Stage 8 exit.

## Definitions And Grain

`registry-enrolment-v1` has 17 code-owned measures with stable IDs, units, formulas, exclusions, filters, refresh policy and proposed Registry office ownership. All definitions/exports remain development/owner-approval-pending. Formula changes require a new version; there is no arbitrary formula editor.

Nine programme measures count programme records and their exhaustive current classification: pending onboarding, onboarded, suspended, interrupted, withdrawn, transferred source records, completed and unclassified states. These are not unique people or historical status events. Transfers retain source and destination records, including same-intake curriculum transfers. Approved student merges move programme custody without deleting those programme records. Completed programme status is not a count of award/certificate documents.

Eight registration measures count configured registration periods (total, planning/open/closed), saved registration records (total, draft/confirmed), and retained course-enrolment records. Registration records have programme-period grain: a programme confirmed in two periods contributes two records, not two unique students. Retained drafts can belong to inactive/transferred programmes and are not an eligibility queue. Confirmations/enrolments remain counted after suspension, interruption, withdrawal, transfer or completion; no current access/attendance/active-headcount meaning is inferred. Unsaved selections and revision/decision history do not add registration records. All retained past/future periods are included; no arbitrary term or historical as-of filter is invented.

Intake rows sum to totals using nonnegative exact integer counts; unsupported row/aggregate precision fails instead of rounding. Three controls verify programme-state, period-state and registration-state partitions. Each intake is checked before aggregate controls, so opposing discrepancies cannot cancel. Unclassified programme states remain an explicit source/definition review condition, not a fabricated lifecycle outcome.

## Authority And Source Integrity

- `GET /api/reports/registry/dictionary`: `registry.view`; version/definitions only.
- `GET /api/reports/registry/intakes`: the same permission-specific scope; metadata-only discovery and a separate metadata-read audit.
- `GET /api/reports/registry`: optional `programmeCode`/`intakeId`; default JSON report.
- Same endpoint with `format=csv`: fresh source calculation/current authority, returning CSV, filename, time and version in an authenticated JSON envelope.

Only roles granting `registry.view` lend scope. Unrelated global roles cannot widen the report. Authorized intake metadata is selected before operational sources; source SQL uses only those selected intake IDs. Draft/published/closed and zero-record intakes remain selectable. Inaccessible/missing explicit intakes return 404; empty programme selections skip operational SQL and return zero totals. Unknown filters (including as-of, period, student and workflow/state), invalid formats and unsafe/oversized identifiers are rejected. Self-service/teaching/admissions permissions alone do not authorize the report.

One repeatable-read transaction supplies generation time, metadata, integrity checks, independent source aggregates and read/export audit. Programme records are not joined to registration periods/enrolments in a way that multiplies counts. Before aggregation, selected-period registrations must bind a programme in the same intake. Enrolments must belong to confirmed registrations and the programme's student/period's academic period. A confirmed registration's saved course set must match its course-enrolment set. Inconsistent bindings return a coarse 409 without source identities, partial totals or repair mutations. Metadata discovery remains available to select another authorized intake.

Reports expose only intake metadata, counts, definitions and controls: no student/programme-account IDs, names, student numbers, receipt references, private profiles, evidence or course-level marks. Distinct `reports.registry.accessed`/`reports.registry.exported` audits retain version/time/applied filters/intake count/controls, not identities. CSV carries version/pending approval, timestamp, filters, row kind, units and controls; untrusted text is quoted/formula-neutralized. Responses use `no-store`. This is a live source snapshot, not a retained report edition or historical membership reconstruction.

## Workspace And Privacy

Registry has an initially collapsed report, intake selector, explicit refresh/export, grouped current programme versus retained registration totals, scrollable intake comparisons and expandable definitions. The registry search queue/page limit does not define report totals. Source failures suppress old totals and disable CSV, while authorized metadata allows another intake selection and refresh after repair. Failed metadata authority cannot restore private state.

The existing generic registry reset clears report/filter/definition caches before logout and on bound authenticated 401. Report loads capture the initiating session and refuse both late success and late failure restoration after a session change. Export uses the session-bound API wrapper before downloading. Detached toggles cannot overwrite current state.

## Verification

Eight focused reporting tests pass; all 224 unit tests pass (`data/build-registry-reporting-unit.log`). Coverage includes meaning/version/approval metadata, bounded filters, permission-specific scope before SQL, repeatable-read order, independent aggregates, source-binding checks/refusal, metadata recovery, empty/inaccessible scope, partitions/unknown states, non-cancelling discrepancies, exact-count overflow, fresh audits and formula-neutralized CSV.

Expanded real workflows check pending onboarding, saved draft, confirmation/enrolment counts, applicant/out-of-scope denials, fresh CSV, private audit output, and a guarded isolated database cross-intake binding probe with refusal, UI suppression, restoration and recovery. Transfer tests check retained source confirmations/drafts and same-intake source/destination records; lifecycle tests retain confirmations through suspension/interruption/withdrawal/re-entry; duplicate resolution preserves programme-record counts; awards check completed records while retaining confirmed enrolments. Desktop/mobile layout/session checks cover long labels, filters/exports, source-error recovery, navigation clearance and departed success/failure responses.

Initial full `data/build-registry-reporting` passed migration/seed, all units, 14 of 18 selected browser checks and all 22 smokes, but remains failed. Two newly added assertions failed on both viewports: the duplicate fixture retains three pending-onboarding records, not three onboarded records; the collected awards test used a programme-helper intake property that was not returned. The harness now expects the actual pending classification and uses the awards fixture's intake ID. The running suite retained its collected earlier test bodies; editing the files did not make those cases green. No onboarding or reporting source behavior was changed. Its server stopped and database `svu_rebuild_it_1791186983479` was dropped; persisted summary is `data/build-registry-reporting.log`.

Corrected full `data/build-registry-reporting-final` passed migration/seed, all 224 units, all 18 selected desktop/mobile browser checks and all 22 smokes. Persisted terminal summary is `data/build-registry-reporting-final.log`; its server stopped and database `svu_rebuild_it_1791188760228` was dropped. The implementation remained unchanged during this run. Final actual desktop/mobile reports and the mobile definition-list viewport were inspected; the layout checks verify horizontal fit and last-row clearance above mobile navigation. The initial failed run remains retained, not relabeled passed. Institutional/full-browser-suite acceptance is not inferred.

## Local Runtime

Refreshed healthy development app at `http://127.0.0.1:4177/#registry`, PID 24528, launcher session 69016, logs `data/dev-registry-reporting.log` and `data/dev-registry-reporting.err.log`; previous PID 23268 stopped. No local migration/reseed or registry/enrolment mutation was performed. Read-only counts before/after restart agree: 188 accounts, 114 applications, 28 programme records, zero saved registration and course-enrolment records. All three registry reporting endpoints return unauthenticated 401 and `no-store`. This runtime health check is not a passed browser integration claim.

After final browser verification, local health remained 200 and the same read-only counts were unchanged. The older unrelated isolated database `svu_rebuild_it_1791103364417` was left untouched. Continuous development remains active; the next Stage 8 slice is student feedback/contact handling as assigned support cases (`COM-06`), with explicit support authority, private comments and reasoned escalation.

## Remaining Gates

D-28 institutional enrolment/headcount definitions, Registry office ownership/approval, census/term/historical membership rules, retention/progression indicators, disclosure/statutory outputs, immutable editions, scheduled distribution/consent, approved legacy reconciliation, production-volume indexing/load tests and owner acceptance remain open. Operational record reconciliation is not an institutional census sign-off.
