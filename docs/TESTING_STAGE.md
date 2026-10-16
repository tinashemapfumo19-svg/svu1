# Platform Testing Stage

Status: ACTIVE - controlled end-to-end testing and university user acceptance testing.

Start date: 2026-10-13 (user declaration).

This starts testing, not production approval or completion of legacy parity. Known gaps and external dependencies remain tracked in [Legacy Coverage Goal](LEGACY_COVERAGE_GOAL.md).

## First Test Journey

Application -> admission review and independent decision -> student onboarding -> registration -> course access -> coursework submission -> marking and approved result release -> transcript.

Include finance standing checks and separate applicant, student, admissions, registry, lecturer, approver and finance accounts. Test both desktop and mobile, successful actions and refusals, duplicate submissions, stale revisions and access boundaries.

## Testing Controls

- Use an isolated test database and explicitly designated test accounts and records. Do not reseed or import into existing working data.
- Record the tested source version, frontend/backend compatibility, environment and enabled integrations before execution.
- Keep external delivery and scheduled workers disabled unless explicitly included in a controlled test.
- Record each case's expected result, actual result, role, evidence and pass/fail/blocked status; link defects to failed cases.
- Retest fixes and affected workflows before accepting a defect as resolved.
- Obtain workflow-owner acceptance separately from automated test success.

## Entry Evidence and Limits

The latest isolated integration receipt, `data/room-invitation-history-integration-20261012.log`, reports passing migrations, seed, server startup, the full unit suite, selected messaging browser journeys and all 22 smoke checks, with an unchanged source guard and database teardown. The filename is retained provenance, not the testing-stage start date.

This receipt is not a complete current-build browser regression or university acceptance certificate. A fresh full desktop/mobile regression, redesigned-screen acceptance, live integrations, policy decisions, operational recovery/load/accessibility and historical migration remain separate gates. The supplied primary legacy archive is damaged; automated HR leave accrual remains disabled pending authoritative policy.
