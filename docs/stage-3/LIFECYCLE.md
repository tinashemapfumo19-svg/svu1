# Programme Lifecycle

## Development Scope

Migration 032 adds scoped reasoned requests and independent reviews for programme suspension, interruption, withdrawal, and re-entry. Decisions retain source evidence, actors, dates, and immutable request/review history. This is a sample-data registry pilot, not approval of institutional suspension or re-admission policies.

| Current status | Available requested statuses |
| --- | --- |
| `onboarded` | `suspended`, `interrupted`, `withdrawn` |
| `suspended` | `onboarded` (re-entry), `withdrawn` |
| `interrupted` | `onboarded` (re-entry), `withdrawn` |
| `withdrawn` | `onboarded` (re-entry) |

Pending onboarding cannot use this workflow to bypass identity/profile approval. Completion, graduation, programme/intake/curriculum transfer, and disciplinary adjudication are not inferred from a lifecycle request.

## Decision Workflow

1. Staff requests an allowed transition with current status revision, evidence hash, reason, evidence reference, and request expiry.
2. Suspension/interruption additionally requires a current or future follow-up review date. It is not an automatic re-entry date. A missed follow-up does not silently restore registration access.
3. A different authorized account approves or rejects with a reason. Administrators obey the same requester/reviewer separation. Changed programme/profile/registration evidence and expired requests fail closed at approval; rejected/stale requests remain retained.
4. Approved decisions atomically increment the status revision, change current programme status, append status history linked to the request, invalidate every draft registration revision, and write an audit event. Repeated review returns `409` rather than applying another transition.
5. Changes take effect at the actual approval time. Backdated/future scheduled direct status updates are not accepted. Historic records cannot be rewritten through this API.

Re-entry requires a complete student profile, but does not grant academic eligibility, waive debt, select courses, or approve progression/repeats. Registration still requires its current calendar/curriculum/results and independent academic/financial checks. New draft revisions invalidate old clearances, repeat approvals, and exception approvals. Academic evidence also binds the programme status revision, so a suspension/re-entry cycle cannot reactivate an older progression approval.

Confirmed enrolments, published results, historic approvals, and receipts are not cancelled or modified by a lifecycle change. Receipt retries return the retained confirmation even while new registration is blocked. Teaching-access changes, refunds/invoices, course withdrawal/result treatment, and notifications need their own approved workflows.

## Authority And API

`academic_registrar` grants `registry.lifecycle.request`; `academic_approver` grants `registry.lifecycle.approve`. Administrators have both, with strict independent review. Only grants for the authorizing permission contribute programme/intake scope; unrelated global auditor access does not widen authority. Students can view their own lifecycle history but cannot issue staff status transitions.

| Endpoint | Permission |
| --- | --- |
| `GET /api/registry/programmes/{id}/lifecycle` | `registry.view`, scoped |
| `GET /api/registry/me/programmes/{id}/lifecycle` | `registry.self`, ownership |
| `POST /api/registry/programmes/{id}/lifecycle` | `registry.lifecycle.request` |
| `POST /api/registry/programmes/{id}/lifecycle/{requestId}/review` | `registry.lifecycle.approve` |

Requests contain only `toStatus`, `revision`, `evidenceHash`, `reason`, `evidenceRef`, `expiresOn`, and optional `reviewOn` for held statuses. Reviews contain `outcome` (`approved` or `rejected`) and `reason`. Context includes current status/revision, allowed targets, profile readiness, source hash, retained decisions/history, and scoped capabilities. Raw next-of-kin/contact values are not returned by the lifecycle context or stored in its evidence snapshot.

The registry UI provides status filters, typed requests/follow-up dates, independent review, and retained history. Student self-service displays programme status history with dates.

## Verification And Remaining Gates

Verified on 2026-10-02: full isolated integration passed with 76 unit tests, all 16 desktop/mobile Chromium browser tests, and all 22 smoke checks, including the credit-recognition extension. The temporary database was dropped and test servers stopped. Focused lifecycle/academic journeys and final recognition journeys also passed on both viewports. Refreshed staff/student layouts were inspected and horizontal-overflow assertions passed. After the final review-input guard, all four focused lifecycle unit tests passed and a live null review returned `400` without changing programme records. Migrations 032/033 were applied locally without reseeding existing data. The refreshed development server is healthy at `http://127.0.0.1:4182/#registry`. See [recognition verification](CREDIT_RECOGNITION.md) for final regression evidence.

Unit coverage checks transition boundaries, prevention of onboarding/completion bypasses, evidence/expiry/follow-up validation, source hashing, and academic approval invalidation after lifecycle changes. The isolated academic browser journey exercises stale rejection, requester self-review and wrong-scope denial, suspended registration blocking, re-entry, draft review invalidation, interruption/withdrawal/re-entry, exactly-once status history, owner privacy, and retained confirmed receipts.

[Credit recognition](CREDIT_RECOGNITION.md) adds independent one-to-one internal/external transfer and exemption awards without invented grades. The separate [programme/intake/curriculum transfer pilot](PROGRAMME_TRANSFERS.md) creates linked destination records and makes the source terminal transferred, without rewriting confirmed records. Approved institutional policy cases and authority, sensitive disciplinary evidence custody, scheduled/backdated corrections, awards/completion, real finance and teaching access, notifications, approved migration reconciliation, accessibility/browser breadth, and registry-owner sign-off remain open. Sample approvals are not production decisions.
