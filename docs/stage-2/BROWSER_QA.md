# Stage 2 Browser Verification

Verified locally on 2026-10-02 with Playwright and Chromium. Full isolated integration passed: 76 unit tests, 16 browser tests across desktop and mobile, and all 22 smoke checks, including the edge cases below and Stage 3 onboarding/course-registration/results/academic-decision/exception/lifecycle/recognition slices. Final focused recognition journeys also passed after receipt/progression refinements; see `docs/stage-3/CREDIT_RECOGNITION.md` for final regression evidence. The temporary database was dropped, the test servers stopped, and test outbox/storage folders removed. The CI workflow installs Chromium and runs the same integration command; a hosted CI run has not been verified.

## Covered Journey

The same journey runs at 1440x1000 and 390x844 with separate applicant and staff browser contexts:

1. Create an applicant account, retrieve the emailed activation code from the development outbox, activate, and sign in through the UI.
2. Save profile, start an application in a dedicated open intake, save answers, and verify the pilot waiver code.
3. Upload transcript and identity PDF bytes through the browser. Record clean scan results through the existing administrative scan API.
4. Submit and verify the reference receipt and current timeline state.
5. Staff sign in, select the application, advance payment/completeness review, and request more information.
6. Staff rejects the transcript through the document-review form. Applicant sees the rejection message, uploads a replacement, and sees it become checked after a clean scan callback. Applicant replies; staff refresh, advance academic review and Decision, then issue an offer.
7. Applicant accepts; verify the student number and Accepted timeline state.
8. Staff refresh sees acceptance. A conversion retry returns the existing student number. The selected intake's UI accepted count is one, and its API manifest contains the same student number with zero unconverted acceptances.
9. Student saves contact and next-of-kin details; stale revisions are rejected. Registrar searches the converted student and approves identity-confirmed onboarding, retaining status history. Scope/permission boundaries and private-field exclusion are checked. See `docs/stage-3/REGISTRY.md`; onboarding alone does not confirm course registration.
10. Registrar creates a calendar-linked registration period, configures course meetings, and corrects a timetable clash. Student saves a course selection; separate scoped academic and financial clearance checks are required. Stale selections/reviews are rejected, changing the selection invalidates both checks, and concurrent confirmation retries create only one receipt and one enrolment per course. Closing the period preserves the receipt. See `docs/stage-3/REGISTRATION.md`.
11. Registrar downloads the confirmed roster, generates synthetic sample results, validates source controls, and imports a final-mark batch. An independent scoped reviewer rejects the first batch, reviews its replacement, and publishes it within the calendar window. Draft privacy, ownership/scope boundaries, importer self-approval denial, and concurrent exactly-once publication/audit are checked. Student sees only their published marks and GPA after reload. See `docs/stage-3/RESULTS.md`.

A separate desktop/mobile academic-records journey covers independent SAMPLE policy publication, published-result prerequisites, progression approval, selection-revision-bound repeats, stale-request rejection, wrong scope/ownership, historical calendar-date protection, and confirmed receipt evidence after reload. It also covers credit/timetable exception requests, independent approval, stale rejection, revocation/restored blockers, replacement approvals, and retained clearance requirements. See `docs/stage-3/ACADEMIC_PROGRESS.md` and `EXCEPTIONS.md`.

The same journey now exercises stale lifecycle rejection, independent suspension/interruption/withdrawal/re-entry, requester self-review and wrong-scope/ownership denial, blocked new registration while suspended, invalidated draft reviews after re-entry, one status-history entry per approval, and untouched confirmed receipts. See `docs/stage-3/LIFECYCLE.md`.

A dedicated desktop/mobile credit-recognition journey covers independently approved internal transfer and external exemption, same-student source ownership and both-programme permission scope, private source snapshots, self-review denial, source-reuse denial, rejected/revoked replacement history, attempted-course protection, and used-credit revocation denial. It verifies disabled credited-course choices, core/prerequisite satisfaction, independent progression review, and year-two confirmation with 60 prior credits (30 recognized) and GPA 4 from only actual graded courses. Student published results and recognized credits remain separate. See `docs/stage-3/CREDIT_RECOGNITION.md`.

The tests check horizontal overflow, desktop applicant panel widths, and uncaught browser errors. Successful applicant/staff screenshots are saved under `test-results/` and were visually inspected. Failures retain screenshots and Playwright traces; CI uploads failure artifacts.

The transfer extension has focused desktop/mobile coverage for independent programme, intake, and curriculum changes; same-student number and original admissions linkage; one arrival after concurrent review; stale-profile rejection; source/destination permission scope; owner isolation; preserved original receipts/results/conversion/manifest rows; invalidated drafts; terminal source lifecycle; no copied grades/credit/clearance; destination seat denial and same-intake deduplication; separate curriculum periods; backdating and wrong-curriculum denial; fresh destination registration; and student historical-record selection. The full-suite checkpoint is recorded in `docs/stage-3/PROGRAMME_TRANSFERS.md`.

## Edge Cases Covered

The browser suite now also covers:

- rejected client-side uploads for unsupported file types;
- applicant withdrawal from a submitted application;
- staff rejection with a controlled decision reason and applicant-visible rejection messaging;
- applicant offer decline and terminal Declined state;
- expired-offer handling when an applicant attempts to respond after the deadline, plus the staff stale-offer expiry action;
- rejected-document messaging and replacement upload during an information request;
- staff, applicant, and registrar MFA enrolment, cancellation of enrolment and verification sessions, authenticator verification, recovery-code sign-in, and rejection of a reused recovery code. Cancellation checks that the pending session token is revoked; recovery checks that nine unused codes remain. Background refresh preserves in-progress staff/applicant sign-in fields;
- configurable postgraduate routing through academic, faculty, and senate review, scoped assignment, and applicant-visible communication;
- applicant deferral requests, staff approval, guarded workflow transitions, reopening with preserved history, and staff withdrawal;
- sample migration of submitted, rejected, and accepted applications, repeat-import protection, document quarantine, control totals, checksum tampering detection, and exactly-once conversion retries.

## Run

```powershell
npm.cmd install
npx.cmd playwright install chromium
docker compose up -d postgres
npm.cmd run test:browser
npm.cmd run test:integration
```

Both test commands create an isolated database and server. To use an installed Chromium-based browser locally, set `SVU_BROWSER_CHANNEL` to `msedge` or `chrome`. The main server uses the development MFA policy `enrolled`. The MFA tests start an additional server on an ephemeral port with the `privileged` policy against the same isolated database, and enrol dedicated temporary accounts. No seeded account is enrolled.

## Remaining Verification

The latest registry/study-year checkpoint passed the full isolated suite: 86 units, 18 desktop/mobile Chromium browser journeys, and 22 smoke checks. Database `svu_rebuild_it_1790972834122` was removed after verification. Academic journeys now assert that approval alone does not advance a level, confirmed future progression remains scheduled, staff/owner projections agree, and inactive statuses retain evidence without active enrolment. Transfer journeys assert independent source/destination study-year histories and configured viewport/header bounds. See [effective study-year tracking](../stage-3/STUDY_YEAR.md) for the read-only contract and remaining gates.

- Production source migration and owner approval: sample reconciliation alone does not close this gate.
- Accessibility audit, additional browser engines, and wider viewport coverage.
- Owner-run pilot and migration reconciliation against legacy application/document control totals.
- Real mail delivery, malware scanner, storage provider, and payment provider integrations remain outside this browser journey. The waiver uses the existing pilot verifier; the scan API substitutes for the pending scanner.
