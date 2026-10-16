# Credit Recognition

## Development Scope

Migration 033 adds reasoned, independently reviewed one-to-one course credit recognition in a student's pinned published curriculum. Approved credit may satisfy required courses and prerequisites and contribute to progression credits only when the attached published academic policy explicitly permits `recognisedCredits`. Existing policies default to not permitting recognition.

This is a sample-data foundation for transfers/exemptions, not automatic programme transfer, institutional equivalence certification, or production authority. [Programme transfers](PROGRAMME_TRANSFERS.md) use a separate independent decision and new linked record; no credit is awarded automatically by that decision. A recognition never fabricates a mark/grade, edits a published result, cancels enrolment, or merges identities.

## Source Contract

| Kind | Required source |
| --- | --- |
| `internal_transfer` | `registrationId`, `courseId`: a published passing result for this same student in another programme, with a completed prior source period. Requester and approver must each have authorizing scope for both target and source. |
| `external_transfer` | `institution`, `course`, unique `reference`, numeric half-credit `credits`, `completedOn`; source custody and institutional equivalence require independent evidence-backed review. |
| `exemption` | The same external evidence fields, with exemption authority recorded through the request/review. No default pass or mark is created. |

External completion dates cannot be in the future. Source credits must cover the target course's fixed credits. Awarded credits equal the target curriculum course, not a client-supplied award quantity. Internal source result snapshots, source references, target course/policy, and status revision are retained in private decision evidence. GET contexts do not expose those raw source snapshots or another programme's marks.

Only unattempted target courses can receive new recognition. Existing enrolment, including an unrecorded or failed result, requires a formal correction/other approved workflow. An active source award/request cannot be reused for another course in the same target programme. Database partial unique indexes enforce active target/source uniqueness; rejected/revoked history is retained and can be replaced through a new request.

## Workflow

1. Publish a curriculum-compatible academic policy with `recognisedCredits: true`; policies remain independently published and versioned. The policy must also be currently effective when credit is requested/approved.
2. Staff selects a target course and policy, source type/evidence, reason, evidence reference, and request expiry. Internal sources are drawn from permitted published passing records, not manually assumed marks.
3. Another authorized account approves or rejects with a reason. Administrators cannot approve their own request. Approval rechecks source ownership/scope, published result, credit quantities, unattempted target, effective policy, status revision, expiry, and canonical source hash.
4. Unused approved credit may be independently revoked with a reason; original request/review remains intact. Once a confirmation receipt uses it, revocation is rejected and formal correction is required instead.
5. Registration checks recognition against source chronology, pinned curriculum/credits, approval status, and the attached policy. Recognized core courses need not be selected; already credited courses cannot be enrolled again through ordinary selection.
6. Confirmation retains only recognition actually used for core requirements, selected prerequisites, or progression, with identifiers, source references, awarded credits, and review evidence. Unrelated future-course awards are not made irrevocable by a receipt that does not use them. Subsequent programme lifecycle changes preserve confirmed receipts. Finance, academic clearance, progression/repeat approvals, timetable, calendar, and other eligibility checks remain enforced.

Recognition/revocation changes bind academic evidence hashes, invalidating older progression/repeat/exception approvals. Pending/rejected requests do not award credit. Revoked ledger entries remain hash evidence, so revocation does not resurrect an older pre-recognition approval.

## GPA And Progression

Recognized credits are explicitly excluded from GPA: there is no imported or inferred target-course grade. Preceding-year recognized core credit contributes to passed-credit totals and core completion, alongside actual graded enrolment. Unknown enrolled results, incompatible grading schemes, and future/overlapping source periods remain blockers. If no graded evidence supports GPA, it stays unknown and progression fails closed even when all credits are recognized; a separate approved policy workflow is needed rather than inventing zero GPA.

Published student GPA remains calculated from actual enrolled-course results only. Recognition is shown separately in student self-service. At least one actual selected course is still required for a registration receipt; fully exempt completion/award cases remain separate work.

## Authority And API

Registrar grants permit requests (`registry.credit.request`); scoped academic-approver grants permit independent approval/rejection/revocation (`registry.credit.approve`). Students have owner-only viewing, not award authority. Unrelated global auditor roles cannot widen target or internal-source authorization.

| Endpoint | Permission |
| --- | --- |
| `GET /api/registry/programmes/{id}/credits` | `registry.view`, scoped |
| `GET /api/registry/me/programmes/{id}/credits` | `registry.self`, ownership |
| `POST /api/registry/programmes/{id}/credits` | `registry.credit.request` |
| `POST /api/registry/programmes/{id}/credits/{recognitionId}/review` | `registry.credit.approve` |

Requests contain only `courseId`, `policyId`, `kind`, structured `source`, `reason`, `evidenceRef`, `expiresOn`. Reviews contain `outcome` (`approved`, `rejected`, `revoked`) and `reason`. Staff controls support source menus, typed external evidence, independent review, and retained history. Student views distinguish recognized credit from graded results/GPA.

## Verification And Remaining Gates

All 76 unit tests pass. Focused isolated desktop/mobile recognition journeys passed after the final evidence and selection guards, with temporary-database teardown. Coverage includes source validation/JSONB canonical hashing, strict boolean policy and chronology, unattempted-course safeguards, no invented GPA or missing-result bypass, core/prerequisite consumption, source reuse denial, source/target scope and owner privacy, maker-checker denial, rejected/revoked replacement history, used-credit revocation denial, and retained receipt evidence. Student choices disable already credited courses. Independent progression approval and year-two confirmation retain the 60-credit assessment (30 recognized) with GPA 4 from only two graded courses. Refreshed desktop/mobile screenshots were visually inspected; horizontal-overflow checks passed.

Migration 033 was applied locally without reseeding existing data. The refreshed development server is at `http://127.0.0.1:4182/#registry`. Both the first and final full regressions passed 76 unit tests, 16 desktop/mobile browser tests, and all 22 smoke checks. The final run includes the receipt-evidence, strict-policy, disabled-selection, and year-two confirmation refinements. Its isolated database `svu_rebuild_it_1790967096746` was dropped, test servers stopped, and scratch outbox/storage removed. No local programme, application, registration, or result records were reseeded or removed.

The separate [programme/intake/curriculum transfer pilot](PROGRAMME_TRANSFERS.md) is delivered, without automatic credit awards or invented grades. Institutional equivalence/exemption and transfer policy cases and source authenticity, many-to-many credit allocation, course withdrawal/corrections, GPA-bearing transfer equivalence, all-recognized progression/completion/awards, official documents, migration reconciliation, real finance/teaching access, accessibility/browser breadth, and owner sign-off remain open. Synthetic policies, source records, and approvals are not production decisions.
