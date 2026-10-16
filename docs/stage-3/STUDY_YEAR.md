# Effective Study-Year Tracking

## Source Of Truth

REG-14/REG-17 and ACA-12 now have a shared programme-level study-year projection from confirmed enrolment-period receipts. It does not calculate a year from intake age, wall-clock anniversaries, selected courses, onboarding, recognized credits, or an unconsumed progression approval. No new mutable student-year column or shadow history table is introduced. Existing immutable registration receipts already retain year, term, academic period, pinned curriculum, calendar dates, confirmation time, and consumed independent progression evidence.

Each student programme has its own `studyYear` object on existing registry APIs. There is deliberately no single year across unrelated programmes or transfer records. The student can select historical programme records; the current destination does not inherit a source level.

## Effective Rules

- Before any confirmed registration, `state` is `not_registered` and `yearOfStudy` is null, not assumed year one.
- Confirmed periods starting after the UTC `asOf` date are `upcoming`. When none has started, state is `scheduled` and the recorded level remains null.
- On the period's start date, its level becomes effective. The recorded level is the highest independently supported level from started confirmed periods; a later lower-level repeat enrolment does not demote it. Ties select the most recently started period deterministically.
- The level remains recorded between semesters and after a period ends. This is an enrolment level, not a passing result, award, graduation decision, or permission to register.
- `currentPeriods` includes started periods through their inclusive end date only while the programme is onboarded. Suspension, interruption, withdrawal, transfer, and completion retain historical/scheduled evidence but do not claim active enrolment. Upcoming receipts are not teaching-access authorization.
- Higher-level receipts require retained approved progression evidence with a decision identifier, policy identifier, and canonical evidence hash. Expiry, later policy/lifecycle changes, or newly published results do not retroactively rewrite a consumed receipt.
- Missing/invalid legacy dates, year/term, confirmation time, curriculum, or higher-level approval evidence produce `reconciliation_required`, a null scalar level/source, and unresolved registration identifiers. Live calendar values and guessed admissions years never repair incomplete receipts. A separate approved migration/correction workflow must resolve them.

Date boundaries use explicit ISO calendar dates and the existing UTC clock. No scheduled job is necessary to advance the projection at midnight; each read uses current receipt evidence. As-of dates are internal projection/test inputs, not caller-supplied authorization overrides.

## API And Privacy

`GET /api/registry/me`, `GET /api/registry/students`, and `GET /api/registry/programmes/{id}` expose the same derived shape under their existing ownership and permission-specific programme/intake scope. The projection is read-only; profile updates still reject year/status fields. Registration and progression approvals retain their separate guarded write APIs.

Public history contains receipt references, registration/academic-period/curriculum identifiers, period name, year/term, start/end/confirmation dates, and the consumed progression decision identifier. It excludes grades, GPA, source snapshots, reasons/evidence references, clearance records, and policy contents. Raw receipt inputs are removed before registry responses. Existing published results and credit-recognition privacy rules are unchanged.

Staff and student views show recorded level, current/upcoming enrolment, and expandable chronological history. Inactive programme labels remain explicit. The view adds no year-edit control or eligibility override.

## Verification

Six focused unit tests pass for no defaults, UTC start/end boundaries, scheduled confirmation, deterministic ordering, lower-year repeats, retained inactive history, missing/invalid receipts, missing independent approvals, pinned-curriculum separation, and omission of private evidence. Browser assertions extend the existing academic and transfer journeys to cover approval-before-confirmation, confirmed future year-two evidence, identical staff/owner projections, suspension, and source/destination separation.

Full `npm.cmd run test:integration` passed on 2026-10-02: 86 unit tests, 18 desktop/mobile Chromium browser tests, and all 22 smoke checks. The fresh database `svu_rebuild_it_1790972834122` migrated/seeded successfully and was dropped after verification; test servers stopped. Refreshed academic and transfer screenshots were inspected. Transfer views retain configured-viewport-width and heading/navigation assertions, including 390-pixel mobile output.

The updated local server is healthy at `http://127.0.0.1:4182/#registry`. An authenticated registry-list read returned all 28 existing programme records with the new projection and no raw receipt-input property. Existing development totals remain 18 students, 28 programme records, 114 applications, and zero registrations/results; these are not production reconciliation totals.

No schema migration, reseed, or rewrite of existing student/receipt/result records is needed. Production policy approval, legacy receipt reconciliation, governed corrections, identity resolution, many-to-many credit allocation, completion/awards, real finance/teaching access, institutional pilot, broader accessibility/browser QA, and registry-owner sign-off remain open. This is a development foundation, not production registry authority or completion of the full rebuild.
