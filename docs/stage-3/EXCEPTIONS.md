# Governed Registration Exceptions

## Scope

Migration 031 replaces broad credit/timetable bypasses with scoped requests, independent approvals, expiry, revocation, and retained history. These are Stage 3 development-pilot foundations, not the complete REG-12 suspension/override lifecycle or institutional authorization of sample decisions.

Supported exception types:

- `credit_limit`: an explicit positive half-credit ceiling, at most 480, sufficient for the current selected overload.
- `timetable_clash`: exactly two distinct selected courses with an actual meeting overlap. Approval affects only that pair, not every clash.

There is no blanket override. Onboarding, curriculum, required courses, missing/failed prerequisites, unpublished results, progression/repeat approvals, duplicate enrolment, course activity, unknown delivery, registration windows, academic clearance, and financial clearance are not waived by these types. Finance, deadline, prerequisite, and progression exception policies remain separate governed work, not silently authorized defaults.

## Workflow

1. Save the student's current course selection in an open registration window.
2. Staff with `registry.exception.request` submits a type, bounded parameters, selection revision, evidence hash/reference, reason, and expiry no later than the registration-window end.
3. A different account with `registry.exception.approve` approves or rejects with a reason. Administrator authority does not waive maker-checker separation. Approval checks that the request is latest, current, unexpired, and still addresses the selected blocker.
4. Approval removes only its addressed blocker. Separate academic/financial clearances and all other eligibility checks remain required.
5. Authorized independent staff may revoke an approved exception with a reason before confirmation/closure. Original request and review remain retained alongside revocation details. Revoked/rejected decisions cannot be rewritten as approved.
6. Confirmation re-evaluates evidence under existing programme/period locks and retains the exact applied approvals and evidence hash in the receipt. Confirmation audit metadata includes exception identifiers. Confirmed receipts and exceptions cannot be changed through this workflow.

Evidence binds student programme/curriculum, period configuration and calendar, selection/revision, course credits/status/prerequisites/delivery, prior enrolments, and published academic evidence/policy. Selection, schedule, source-result, policy, or calendar changes invalidate approvals; a new request is required. Clearance changes do not invalidate an exception, but remain independently checked. Latest same-type/pair history governs: a new request or rejection never resurrects an older approval.

This workflow records decisions; it does not modify the period's credit limit, change meeting schedules, fabricate course results, waive debt, or overwrite programme status.

## Authority And API

Permissions are separate from general registration configuration/clearance. Registrar grants permit requests, scoped academic-approver grants permit independent review/revocation, and administrators have both with strict requester/reviewer separation. Only grants for the authorizing permission contribute scope. Students cannot request or approve staff exceptions.

| Endpoint | Permission |
| --- | --- |
| `POST /api/registry/programmes/{id}/registrations/{periodId}/exceptions` | `registry.exception.request` |
| `POST /api/registry/programmes/{id}/registrations/{periodId}/exceptions/{exceptionId}/review` | `registry.exception.approve` |

Requests contain `kind`, `parameters`, `revision`, `evidenceHash`, `evidenceRef`, `reason`, `expiresOn`. Reviews contain `outcome` (`approved`, `rejected`, `revoked`) and `reason`. Existing scoped/owner registration GETs return history, current evidence hash, applied exceptions, and blockers. Staff UI provides typed controls and review/revocation; student confirmed receipts display applied approvals.

## Verification And Gates

Verified on 2026-10-02: full isolated integration passed with 76 unit tests, all 16 desktop/mobile Chromium browser tests, and all 22 smoke checks, including lifecycle and credit-recognition extensions. The temporary database was dropped and test servers stopped. Focused desktop/mobile academic and final recognition journeys also passed independently. Refreshed desktop/mobile staff and student screenshots were inspected; horizontal-overflow assertions passed. Migrations 031-033 were applied locally without reseeding existing data. The updated development server is healthy at `http://127.0.0.1:4182/#registry`. See [recognition verification](CREDIT_RECOGNITION.md) for final regression evidence.

Unit tests cover parameter whitelists and bounds, exact pair matching, latest-history behavior, stale/expired/revoked approvals, immutable evidence binding, target validity, and non-bypass of unrelated eligibility checks. The isolated desktop/mobile academic journey exercises stale rejection, maker-checker and scope/owner denial, revocation/restored blockers, replacement approval, pair approval, financial-clearance retention, and confirmed receipt evidence.

[Programme lifecycle](LIFECYCLE.md) now governs independent suspension/interruption/withdrawal/re-entry without rewriting confirmed records. Institutional exception authorities, approved policy cases, deadlines/prerequisites/progression/finance exceptions, course withdrawal/access and completion, migration reconciliation, accessibility/browser breadth, and owner sign-off remain gated. Synthetic sample decisions are not production approvals.

## Prerequisite Waivers and Late Registration

Migration `073_more_registration_exceptions.sql` adds two kinds of exception.

- **Prerequisite waiver** (`prerequisite_waiver`, parameters `{courseId}`). It uses the same model as the credit-load and timetable-clash exceptions:
  - requested with evidence;
  - bound to the registration revision and evidence hash;
  - approved by someone other than the requester;
  - expiring and revocable.

  A request is refused unless the named course is selected and has an unmet prerequisite (no passing latest result and no applicable recognized credit). While current, it clears the `PREREQUISITE_EVIDENCE` blocker for that course only. Waivers are keyed per course, and a changed selection makes them stale.
- **Late registration** (`POST /api/registry/programmes/{id}/registrations/{periodId}/extensions`, `registry.exception.request`). A student who missed the window has no draft to bind an exception to, so late registration is a dated extension of the calendar window for one student and period:
  - It must end after the window closes, no more than 30 days later, and not in the past. The registration period itself must be open.
  - It is reviewed at `.../extensions/{id}/review` (`registry.exception.approve`, by someone other than the requester), with outcomes `approved`, `rejected`, or `revoked` (approved extensions only).
  - Only one extension per student and period may be requested or in force.
  - While approved and unexpired, the closed window does not raise `WINDOW`, so the student can save a selection, request exceptions (expiry up to the extension date), and confirm.
  - Every step is audited.

  Registration contexts return `extensions` and `windowExtension`. The academic evidence used for checks is no longer sent in that response.

Unit tests are in `test/registration-waivers.test.js`. The academic records journey (`e2e/academic-records.spec.js`, desktop and mobile) covers:
- waiver refusal for a course without an unmet prerequisite;
- refusal of self-approval;
- an approved waiver clearing only that course's blocker;
- extension date bounds, duplicate refusal, self-review refusal, approval, and revocation.

Institutional rules for both remain under D-18.
