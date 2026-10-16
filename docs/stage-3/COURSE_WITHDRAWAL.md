# Course Withdrawal

## Scope

Migration 074 lets a student leave a confirmed course without erasing the registration. It is a Stage 3 development foundation. The deadline, transcript notation and fee consequences are owner decisions (D-36) and are not applied.

## Workflow

1. A student requests withdrawal from one of their own confirmed courses in the portal, with a reason and optional evidence reference. Registry staff with `registry.exception.request` may request on a student's behalf.
2. A different account with `registry.exception.approve` approves or rejects with a reason. The requester can never review their own request, including administrators; the database enforces this too.
3. Approval marks the enrolment withdrawn (`course_enrolments.withdrawn_at` and `withdrawal_request_id`). The registration confirmation receipt is not changed.
4. Only one live (requested or approved) request may exist per enrolment. A rejected request can be followed by a new one.

Withdrawal is refused once there is any result evidence for the course: an official academic result, or a row in a results batch that has not been rejected.

## Effect

Withdrawn enrolments leave the active rosters: marks entry, LMS rosters, the official results roster, teaching class lists and counts, academic evidence attempts, prior-attempt checks in registration, and credit-recognition attempted-course checks. History readers (receipts, duplicate resolution, calendar guards) still see the enrolment.

Codex-owned exam, exam-arrangement and reporting rosters are being updated to the same rule.

Finance is not touched. Any fee change is a separate finance action.

## Authority And API

- `GET /api/registry/me/programmes/{id}/withdrawals` (student, own programme) and `GET /api/registry/programmes/{id}/withdrawals` (`registry.view`, scoped).
- `POST .../registrations/{periodId}/withdrawals` with `courseId`, `reason`, optional `evidenceRef`.
- `POST /api/registry/programmes/{id}/withdrawals/{requestId}/review` with `outcome` (`approved` or `rejected`) and `reason`.

Out-of-scope programmes return 404. Requests are append-only and every request and decision is audited (`registry.withdrawal.requested`, `.approved`, `.rejected`).

## Verification

`e2e/course-withdrawal.spec.js` covers the student portal request, duplicate and cross-student refusals, student and self-approval refusals, staff requests on behalf, approval, roster exclusion, the unchanged receipt, the results roster, refusal after results import, and audit events.
