# Confirmed Period Continuation

Stage 8 management/cohort reporting foundation. No schema change. Dictionary `confirmed-period-continuation-v1` contains 16 proposed measures with formula, exclusions, unit, filters, refresh policy, proposed Registry/academic-management owner and pending D-28 approval.

## Explicit Cohort

Registry > Confirmed period continuation requires native `registry.view` programme AND intake authority. Unrelated global roles cannot widen it. Only currently authorized configured registration periods appear. Both selected periods must belong to the same intake, and follow-up must start strictly later. No automatic period/denominator selection, programme-age calculation, caller-supplied as-of date or cross-intake source/destination inheritance is used.

Baseline membership is a distinct student-programme record with a retained confirmed registration in the selected baseline period. The intersection with confirmed follow-up registrations supplies the continuation numerator. Baseline records missing that confirmation are the complement, including drafts/unsaved registrations; they are not inferred dropouts, failures or overdue work. Follow-up-only records are separately counted and excluded from both numerator and denominator. People with multiple programme records are not deduplicated into a person census.

The development share is `100 * confirmed in both periods / baseline programme records`. It is null for an empty baseline or either period not yet started at the snapshot UTC date. Future confirmations remain recorded commitments, not observed retention. Even when both periods have started, the share is a current retained-registration comparison: no registration-deadline maturity, historical entry census, causal retention, active attendance, graduation rate or approved statutory meaning is inferred. Later/backdated confirmations can change it. Display rounds to one decimal; CSV retains the calculated value.

Seven recognized CURRENT baseline programme states plus unclassified states partition the cohort. Status is not reconstructed at either period's start. Suspension, interruption, withdrawal, transfer or completion do not erase retained confirmation membership. Distinct programme records are not unique students. Enrolment measures count retained physical course records, not active access, attendance, passed outcomes, credits or recognized credit.

## Source Controls

One repeatable-read transaction captures time, authorized periods, custody/receipt checks and a direct full-join cohort aggregate. Registration-period curriculum programmes must match intake programmes; saved registrations must retain the same intake/version. Course records require confirmed-registration, student and academic-period custody and exact selected-course count/membership reconciliation.

Only confirmation fields needed by the existing study-year projection are read: registration/reference, pinned period/curriculum identifiers, dates, year/term, confirmation time and minimal consumed progression identifiers/status/hash. Missing/invalid or mismatched receipt bindings fail 409, rather than substituting admission age or live mutable calendar values. Higher-year confirmations require the existing retained approved progression evidence shape AND a matching retained approved progression record for that same programme/period, pinned curriculum/policy and evidence hash. Later expiry or evidence/eligibility changes do not invalidate a consumed confirmation; reporting does not rerun current policy. Stored and receipt confirmation times must be present, valid and not future; they are separate native database/application clocks, not asserted byte-identical.

Cohort/intersection/complement, current lifecycle partition, continuing-versus-all follow-up enrolments, bounded shares and independent receipt counts must reconcile before output. Confirmations and course counts are aggregated without multiplying programme records by enrolled courses. Source errors do not trigger report-side repair. Checks do not cryptographically recompute old evidence or reevaluate current eligibility; owner-approved migration/correction remains separate.

## Privacy And Interaction

Reports expose authorized period/intake metadata and aggregate counts, never student/person/account/programme-record IDs, names, contacts, individual grades, clearance evidence, reasons, reference numbers or receipt hashes. Audits retain bounded selected-period identifiers, aggregate counts, snapshot readiness and controls, not personal evidence or labels.

No cohort counts load until both periods are explicitly chosen. Follow-up choices are constrained by baseline intake and later start date; server independently checks the pair. CSV performs a fresh authenticated snapshot with formula-safe quoted cells, fixed filename `confirmed-period-continuation.csv`, version/approval/time/readiness and control metadata. Old on-screen figures are not the export source.

Token/generation guards discard departed/superseded metadata and stop old loads before a second private request. Scope/session refusals clear counts, period choices and selected pair. Source/network failures hide old counts and disable export; recovery fetches freshly authorized metadata. Shared registry sign-out clears state. Routes use no-store.

## API

- `GET /api/reports/continuation/periods`: current authorized configured registration periods without cohort count reads.
- `GET /api/reports/continuation/dictionary`: development definitions.
- `GET /api/reports/continuation`: required `baselinePeriodId`, `followupPeriodId`; optional `format=json|csv`.

Unknown filters, unsafe/missing/identical identifiers and unsupported formats fail 400; inaccessible periods fail 404 before operational source queries. Cross-intake or non-later pairs fail 400. No unique-student, historical census or institutional retention-rate API is implied.

## Verification

Eight focused tests and all 317 final-source unit tests pass (`data/build-continuation-reporting-unit-final.log`). Focused coverage includes explicit bounded pairs, native exact scope, direct intersection aggregate shape, safe count precision, empty/future null shares, receipt/progression/custody/aggregate refusal with rollback and fresh audited formula-safe exports.

Initial `data/build-continuation-reporting.log` remains FAILED at 2/4 selected desktop/mobile checks: loader checks passed; native fixtures correctly hit calendar overlap rules when recreating an existing seeded academic year and the desktop year. Unit suite and all 22 smokes passed. Launcher 42993 ended exit 1; the driver reports dropped database `svu_rebuild_it_1791222294241`. The fixture now reuses existing matching parent/semester records.

Recovery `data/build-continuation-reporting-recovery.log` passes units, all FOUR selected desktop/mobile checks and all 22 smokes. Launcher 41813 ended exit 0; database `svu_rebuild_it_1791222449913` was dropped. Broader pre-refinement `data/build-continuation-reporting-final.log` passes units, all FOURTEEN selected academic/registry browser checks and 22 smokes. Launcher 28259 ended exit 0; database `svu_rebuild_it_1791222640097` was dropped. This checkpoint predates period-first labels and stronger consumed-progression record binding; it is not final-source acceptance.

Intermediate `data/build-continuation-reporting-verified.log` remains FAILED at 10/14 browsers because the newly strengthened guard contained an extra SQL closing parenthesis. Its server had already loaded that source when review caught and corrected it. Units/22 smokes passed; launcher 94374 ended exit 1 and database `svu_rebuild_it_1791223170854` was dropped. All FOUR earlier owned databases were independently confirmed absent. The corrected guard, minimal receipt query and cohort aggregation were independently accepted by PostgreSQL EXPLAIN without executing data reads or writes; final-source units still pass 317/317.

The final-source selector independently lists 14 desktop/mobile checks in four files, including a new native higher-year consumed-confirmation cohort assertion in academic-records. Final `data/build-continuation-reporting-acceptance.log` passes migration/seed, units, all FOURTEEN selected checks and all 22 smokes. Last-run metadata is passed with no failures. Launcher 64597 ended exit 0; its server stopped, database `svu_rebuild_it_1791223577827` was dropped and independently confirmed absent, and port 4197 has no listener. All FIVE owned test databases are absent; unrelated databases were not touched. Fixtures and deliberate source faults were confined to driver-owned databases. No full-browser-suite or production acceptance is claimed.

Native journeys verify explicit selection without automatic counts, a two-record baseline and one-record intersection, separately excluded follow-up-only confirmation, retained intersection after independently approved suspension, fresh CSV versus old on-screen lifecycle totals, future null percentages, receipt fault refusal/recovery/export disablement, formula-safe labels and private audit metadata, live role-expiry cache erasure and sign-out. Academic-records additionally verifies that genuine independently approved higher-year receipts produce retained cohort counts while future-period shares remain null. Loader checks cover departed/superseded/revoked selection and stopping a departed load before the second private request. Final desktop/mobile viewport/full-page screenshots were inspected; period-first names/dates distinguish selections on mobile and table labels wrap without page overflow.

## Local Runtime

No migration, reseed, reference reload or operational mutation was needed. Previous owned development PID 15708/launcher 73741 ended after listener ownership verification. Matching-source development PID 18176/launcher 1341 intentionally remains live at `http://127.0.0.1:4177/#registry`, logs `data/dev-continuation-reporting.log` / `.err.log`; health 200, all three anonymous continuation-report routes 401/no-store, error log empty. Read-only counts remain 188 accounts, 114 applications, 28 programme records and zero registrations, enrolments, applicant campaigns/recipients, support cases and enquiries. Other agents' work/reservations were preserved.

## Remaining Gates

Institutional retention/cohort definitions, entry/census dates, registration-deadline maturity, historical identities and membership, course-withdrawal active-roster coordination, small-cell disclosure, schedules, distribution/retention rules, owner/accessibility acceptance and production migration remain open. [Private report editions](REPORT_EDITIONS.md) now provide a separately verified creator-only retained snapshot foundation, not approved sharing or legal disposal. This development comparison does not close those gates.
