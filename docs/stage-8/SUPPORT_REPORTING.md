# Student Support Operations Reporting

Stage 8 / COM-06. Reuses support-case migration 061; no new migration. This is an operational development report, not an approved institutional metric, emergency service or response SLA. D-28 and D-29 remain open.

## Scope And Cohorts

`#registry` > Student support workload works for support-only officers as well as authorized registry staff. Report, dictionary and intake choices require `support.view`, using the same permission-specific programme AND intake scope as native support cases. An unrelated global auditor role cannot widen it; a programme scope with an empty intake list does not authorize all its intakes. Inaccessible explicit intake filters fail 404.

Default is all retained cases in current scope. Optional intake, current category/priority, and paired inclusive UTC creation dates (at most 366 days, ordered real dates, not future) select the cohort. Dates filter case creation, not actions performed in that period or historical status. Closed intakes remain discoverable in scope.

## Definitions And Controls

Dictionary `student-support-operations-v1` has 29 measures, each with proposed owner, approval-pending status, formula, exclusions, unit, filters and refresh policy. Definitions appear in the workspace and version/approval remain in CSV.

- Retained cases partition by current open, in-progress, waiting-student, resolved and closed status, current priority and current category. Reopened cases appear only in current status.
- Active is open/in-progress/waiting-student. Unassigned, escalated and urgent active cases are bounded subsets, not elapsed service targets or historical event counts.
- Current owner-account counts use the current student account link, including approved ownership consolidation. Captured programme-record counts remain separate. Neither is unique-person headcount or verified-email evidence. Totals are direct SQL distinct counts, not summed intake unique counts.
- Publicly answered means at least one public staff comment. Internal notes and student messages do not count; no delivery/read receipt is inferred. Active cases with/without a public staff reply partition active workload. Reopening retains earlier replies.
- First-reply timing is elapsed UTC minutes from original creation to first-ever public staff comment. Resolution samples are currently resolved OR closed cases; closed cases retain their resolution timestamp. Reopening clears resolution timestamps and removes the sample until resolved again. Durations include time before reopening, not current-cycle/business-hours/handling time or an approved SLA.
- No samples yields null (a dash in UI, blank CSV), never invented zero minutes. Total means are computed directly over source samples, not averaged intake averages.

One repeatable-read transaction captures generation time, authorized intakes, source checks and grouping-set aggregates. Status, category, priority, active-workload, reply and timing controls accompany totals and rows; row discrepancies cannot cancel at total level.

Case programme/intake custody is immutable. Native transfers create a new programme record while retaining the original case record and intake; reporting does not move cases to the destination. A programme/case custody mismatch, missing/mismatched current revision history (status/category/priority/assignment/escalation), invalid source time ordering or future timestamps fails 409 before counting. No report repairs sources. Authorized intake metadata stays separately discoverable for recovery.

## Privacy And Export

No subject, comment body or internal reason is selected or decrypted. JSON/CSV omit case IDs, owner/assignee identities, student numbers, contact details and conversation text. Only authorized intake labels, definitions, filters, counts, samples, elapsed timings and controls are returned. Audits retain version/cohort/classification/count/control metadata, not conversations or intake labels.

CSV uses a fresh separately authenticated request and source snapshot, not cached totals. Cells are quoted and spreadsheet formula prefixes neutralized. Fixed filename: `student-support-operations.csv`. APIs use no-store.

Loaders bind token and generation; departed/superseded responses are discarded. Session/scope refusal erases report/intake/filter caches. Reconciliation/network errors hide old totals and disable export; recovery uses only freshly authorized metadata. Shared registry sign-out clears all private state.

## API

- `GET /api/reports/support`: JSON; optional `intakeId`, `category`, `priority`, paired `from`/`to`, `format=csv`.
- `GET /api/reports/support/dictionary`: versioned definitions.
- `GET /api/reports/support/intakes`: authorized intake choices without operational counts.

Unknown filters/classifications, unsafe identifiers, unsupported formats and invalid/incomplete/oversized/future date cohorts are refused. No historical as-of reconstruction is implied.

## Verification

Seven focused tests and all 293 final-source unit tests pass (`data/build-support-reporting-unit-final.log`). Coverage includes dictionary distinctions, classification/date bounds, native scope including empty intake arrays and unrelated global roles, one snapshot/direct distinct totals, source reconciliation rollback, no-sample timing/control checks and fresh audited formula-safe CSV.

Initial `data/build-support-reporting.log` remains failed at 8/10 selected browsers: both new report journeys refused an oversized synthetic migration identifier before report creation. Existing support journeys, report loader tests, the unit suite and all 22 smokes passed. Launcher 91280 ended exit 1; database `svu_rebuild_it_1791216323400` was dropped and independently confirmed absent.

Corrective `data/build-support-reporting-corrective.log` remains failed at 2/4 browsers: report journeys reached and checked real counts, fresh CSV, reopened timing, privacy, history reconciliation refusal/recovery and direct SQL mean comparison, then hit a fixture query using nonexistent role_id instead of native role_code. Loader tests, units and all 22 smokes passed. Launcher 5791 ended exit 1; database `svu_rebuild_it_1791216591088` was dropped and independently confirmed absent. No failed checkpoint is relabeled green.

Final `data/build-support-reporting-final.log` passed migrations/seed, the unit suite, all FOURTEEN selected support-report/support-case/enquiry-report desktop/mobile browser checks and 22 smokes. Selector independently lists 14 checks across three files; last-run is passed with no failed tests. Real report coverage includes current classification and inclusive creation cohorts, multi-intake direct distinct owners, public replies versus internal notes, retained closed resolution and reopened null samples, fresh changed-status CSV, formula safety, history fault/recovery, direct SQL means, live role-scope change/cache erasure and sign-out. Loader tests cover departed/superseded/revoked state and failed-source metadata recovery. Final desktop/mobile screenshots were inspected; intake labels remain readable in contained scrolling tables. No full-browser-suite or production acceptance is claimed.

Launcher 69063 ended exit 0; its server stopped and database `svu_rebuild_it_1791216773147` was dropped and independently confirmed absent. All three owned databases are absent; port 4197 is released. Unrelated databases were not touched.

## Local Runtime

No migration, reseed, reference reload or operational mutation was needed. Previous owned development PID 29228/launcher 6833 ended after confirming listener ownership. Current matching-source backend is PID 29088/launcher 90444 at `http://127.0.0.1:4177/#registry`, logs `data/dev-support-reporting.log` and `.err.log`; health 200, all three anonymous support-report routes 401/no-store, error log empty. Read-only counts retain 188 accounts, 114 applications, 28 programme records and zero registrations/enrolments/support cases/enquiries. The persistent server is intentionally running. Existing source and other agents' reservations were preserved.

## Remaining Gates

Support ownership and taxonomy approval, targets and business calendar, sensitive-case segregation, after-hours/emergency handling, provider delivery/read evidence, attachments, small-cell disclosure, scheduled distribution, retained editions, legal hold/disposal, approved control totals, accessibility/owner acceptance and production migration remain open.
