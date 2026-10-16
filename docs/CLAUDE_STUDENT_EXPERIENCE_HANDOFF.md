# Claude Handoff: Student Office

Date: 2026-10-07
From: Codex
Status: Implementation approved; Claude review and Office tests delivered.
Implementation: Codex is the single integrated Study/Office implementation owner.

Update: The user selected Codex as the single Office owner. Claude's current
scope is `e2e/student-office.spec.js`, review documentation and coordinated
patch requests. Review findings are recorded in CLAUDE_OFFICE_REVIEW.md and
CLAUDE_STUDY_REVIEW.md; substantive fixes are incorporated by Codex. Codex
implements UX-03/04/05 in src/student.js along with shared shell and Study.
The assignments below are the historical original handoff, not current write
ownership. Read the latest workspace entry before further changes.

## Read First

1. [Design baseline](STUDENT_EXPERIENCE_DESIGN.md)
2. [Execution plan and ownership](STUDENT_EXPERIENCE_EXECUTION_PLAN.md)
3. [Shared workspace log](CODEX_CLAUDE_WORKSPACE.md)
4. [SVU design language](SVU_DESIGN_LANGUAGE.md)
5. [Accepted LMS boundary](stage-6/LMS_INTEGRATION.md)
6. [Latest Student Design Language](STUDENT_DESIGN_LANGUAGE.md): student-specific
   visual baseline; overrides older conflicting student layout/token guidance.

The user requested documentation, an execution plan and delegated tasks before
implementation approval. Do not interpret this handoff as authorization to code.

## Your Assigned Work After Approval

Own UX-03, UX-04 and UX-05: the Student Office experience using existing
student-authorized APIs. Deliver Overview, Registration, Fees & Payments,
My Details, Documents and Requests. Start from new student-office modules/styles;
reuse current domain forms and behaviours without taking over the shared router.

Codex owns the shared shell, route/context contract, Study pages, index.html and
shared CSS. Wait for UX-01's contract before implementing route-dependent work.
Provide exports and integration notes; Codex wires them into the app.

## Required Behaviour

- Overview: real registration/finance/request information and direct actions.
- Registration: preserve revision guards, eligibility checks, confirmed receipts
  and withdrawal workflow. No bypass of server-side controls.
- Fees: distinguish balance/due/credit/holds; expose plan/sponsorship/receipt
  details only when authorized self-service data exists. No fake Pay now.
- Details: editable contact and next of kin, reviewed identity correction,
  programme history and access to original application history.
- Documents: issued records, view/print and verification; honest missing states.
- Requests: shared list with source-specific detail/actions and explicit filter
  mappings. Include eligible support, identity, withdrawal, arrangements, transfer
  and applicable enquiry records without merging their approval/consent rules.
- Attention: supply Office action mappings to Codex with authoritative state,
  next actor only when known, and destination parameters.

Keep partial-data errors visible, preserve failed-write drafts, invalidate stale
responses on programme/account changes and never expose staff-only notes.

## Ownership and Coordination

Reserve proposed new `src/student-office.js`, `src/student-office.css` and
Office-specific tests after approval. Introduce additional modules only when
they reduce real complexity. Do not independently edit `src/app.js`,
`src/shell.js`, `src/session.js`, `index.html` or shared `src/styles.css`.
Coordinate changes to `src/apply.js`, existing domain adapters and shared fixtures.
Backend/schema expansion is outside this assignment.

Announce ticket/file claims in CODEX_CLAUDE_WORKSPACE.md. Preserve concurrent
changes. Do not use historical PIDs or test receipts as current runtime evidence.
Coordinate integration-harness ownership; do not launch a competing shared-port
run. Use isolated test data, never reseed the working database.

## Deliverable and Review

For each ticket, report files, supported endpoints, outstanding capability gaps,
test evidence and desktop/mobile screenshots. Codex reviews Office; you review
Study after integration. Retain substantive existing business assertions when
updating tests for new page locations. No unsupported completion claims.

## Acknowledgment Template

After the user approves implementation, add a short workspace entry:

> Claude: acknowledged Student Office UX-03/04/05; claimed files: [...].
> UX-01 contract read: [...]. Current ticket: [...]. Shared-file requests: [...].

This file is the prepared handoff in the shared workspace. Its existence is not
proof of direct delivery to Claude, task acceptance or completed implementation.
