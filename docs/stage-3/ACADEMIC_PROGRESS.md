# Results-Backed Academic Decisions

## Delivered Pilot

Migration 030 adds versioned academic policies, independent progression/repeat decisions, and results-backed registration eligibility. Policies used in tests are explicitly labelled SAMPLE; they are not approved institutional rules. This is a bounded Stage 3 development slice, not production registry sign-off or completion of the rebuild.

## Evidence And Rules

- Prerequisites require a published passing result from a completed prior period in the same student programme. Future/overlapping periods cannot supply evidence. A newer unrecorded attempt blocks reliance on an older pass.
- A published policy pins the programme curriculum and GPA rule snapshot. Configurable rules are minimum GPA/passed credits, maximum failed credits/outstanding core courses/attempts, and whether passed-course retakes are permitted. Publication requires an independent account, evidence, reason, and effective date; GPA/grading policies must be published and effective.
- Progression requires preceding-year enrolment and required-core result evidence. Missing results and incompatible grading schemes fail closed; no unapproved grade equivalence is inferred. GPA uses retained official grades and credits.
- Higher-year registration requires a current approved progression decision. Prior enrolment requires a current approved repeat decision; passed retakes require explicit policy permission. Planning can add optional repeat offerings from the pinned curriculum. Every offering still needs configured delivery.
- Academic and financial registration clearances remain separately required. Neither a generic clearance nor an academic approval bypasses prerequisite, policy, timetable, credit, calendar, or result-evidence blockers.

## Independent Decisions

Staff requests retain reason, evidence reference, expiry, source evidence, policy, and assessment. A different authorized account approves or rejects with a reason. Approval re-evaluates eligibility and rejects changed evidence, expired requests, closed/confirmed targets, or a changed repeat selection revision. An administrator cannot approve their own request.

The source hash binds result/enrolment facts, curriculum, target period/year/dates, and policy identity. Latest applicable decision history governs; rejected/stale decisions remain visible rather than being rewritten. Requests with blockers can be recorded, but cannot be approved to override those blockers.

Confirmation retains policy, source hash, prerequisite results, approved decisions, and calendar dates with the existing receipt. Academic period dates cannot change after course enrolments exist. The [effective study-year projection](STUDY_YEAR.md) now reads those immutable receipts, activates recorded levels on period start, and retains separate current/upcoming/history views. Confirmed registration remains separate from the programme's `onboarded` state and does not award passing/completion status.

## Authority And API

Only grants for the authorizing permission contribute programme/intake scope. Unrelated global roles cannot widen authority; students receive only their own context.

| Endpoint suffix under `/api/registry/programmes/{id}` | Permission |
| --- | --- |
| `GET /academic` | `academic.view` |
| `POST /academic/policies` | `academic.policy.manage` |
| `POST /academic/policies/{policyId}/publish` | `academic.policy.publish` |
| `POST /academic/{periodId}/decisions` | `academic.request` |
| `POST /academic/{periodId}/decisions/{decisionId}/review` | `academic.approve` |

`GET /api/registry/me/programmes/{id}/academic` requires `registry.self` and ownership. Registrar grants cover viewing, requests, and policy drafting. The scoped `academic_approver` role covers independent decision approval and policy publication. System administrators have all permissions but still obey maker-checker separation.

The registry UI supports policy drafting/publication, planning-period policy/repeat setup, explained assessments, reasoned requests, independent review, and retained history. Student views show their retained decisions. Registration setup accepts `academicPolicyId` and `repeatCourseIds` while planning.

## Verification

The pre-recognition lifecycle baseline was verified on 2026-10-02: full isolated integration passed with 71 unit tests, all 14 desktop/mobile Chromium browser tests, and all 22 smoke checks, including governed exceptions and lifecycle invalidation. The temporary database was dropped and test servers stopped. The focused isolated academic journey also passed on desktop and mobile. Refreshed staff/student screenshots were inspected and horizontal-overflow assertions passed. Unit coverage includes bounded rules, GPA/credit/core blockers, missing/future/incompatible results, superseding attempts, retake/attempt limits, evidence hashing, expiry, policy/revision invalidation, and registration integration. Browser coverage exercises independent policy publication, prerequisite pass/fail decisions, progression and repeat approvals, stale repeat rejection, scope/ownership denial, immutable decisions, and confirmation evidence after reload.

The credit-recognition extension passed full integration with 76 unit tests, 16 desktop/mobile browser tests, and 22 smoke checks. Final focused recognition journeys also passed after the evidence refinements, including independently approved year-two progression and confirmation with recognized credits excluded from GPA. See [recognition verification](CREDIT_RECOGNITION.md) for final regression evidence. Migrations 030-033 were applied to local development without reseeding or removing existing records. The updated server is healthy at `http://127.0.0.1:4182/#registry`. Run `npm.cmd run test:integration` for isolated migration, seed, units, desktop/mobile journeys, smoke checks, and teardown.

## Remaining Gates

[Governed exceptions](EXCEPTIONS.md) cover credit-load and exact timetable-pair decisions without waiving academic evidence. [Programme lifecycle](LIFECYCLE.md) adds independent suspension/interruption/withdrawal/re-entry, retaining confirmed records and invalidating older academic evidence through status revisions. [Credit recognition](CREDIT_RECOGNITION.md) contributes prior approved credits and core completion only under a published policy with boolean `recognisedCredits: true`; it never contributes grades to GPA or bypasses missing attempted results. Ledger changes invalidate earlier academic approvals, including after revocation. The separate [programme/intake/curriculum transfer pilot](PROGRAMME_TRANSFERS.md) creates linked records without copying progression approvals or credits. Approved institutional and transfer policy cases, approved study-year corrections and legacy reconciliation, wider exception types, many-to-many credit allocation, course withdrawal/access and completion, identity corrections, formal published-result amendments, official assessment/moderation, graduation, real finance integration, approved source migration/reconciliation, broader accessibility/browser QA, and owner sign-off remain open. No synthetic policy or sample result authorizes production decisions.
