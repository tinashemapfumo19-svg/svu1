# Stage 4 Student Finance Foundation

## Delivered Slice

This is the first Stage 4 development-pilot slice: an append-only student subledger with governed fee schedules, period billing, recorded payments, automatic allocation, statements, and explainable financial holds that feed course registration. ADR-009 (accounting boundary) is still open. This slice does not replace an accounting/ERP system, and `FIN-16` (bank reconciliation, revenue, cash management) is out of scope until that ADR is decided.

| Inventory | Coverage |
| --- | --- |
| FIN-01 | Charge catalogue as the governed `charge_type` reference list (`TUITION`, `REGISTRATION`, `EXAMINATION`, `LIBRARY`). |
| FIN-02, FIN-03 | Effective-dated fee schedules per programme, study year, term, and currency. Drafts are published by an independent approver; published schedules are immutable, and a slot cannot hold two published schedules for the same date. |
| FIN-04, FIN-05 | Billing runs per registration period charge every onboarded student in the intake from the latest applicable published schedule. Re-runs are idempotent (one charge per programme, period, and charge code). |
| FIN-06, FIN-09, FIN-10 | Ledger statement for staff and the student, with running totals, due amounts, and unallocated credit per currency. |
| FIN-07, FIN-08 | Payments by bank, mobile money, or cash with a unique external reference per method, received date, reason, and receipt number. Part-payments are supported. |
| FIN-11 | Financial hold is derived from outstanding charges whose due date has arrived. Each reason names the charge, amount, and due date. |
| FIN-14 | Currency is taken from the governed currency list; amounts are integer minor units, with one currency per row and no conversion. |

Reviewed adjustments are delivered below (see [Adjustments](#adjustments)). `FIN-13` notifications are delivered (see [Notifications](#notifications)). `FIN-15` payment plans are delivered in [PAYMENT_PLANS.md](PAYMENT_PLANS.md). Sponsor accounts and third-party billing are delivered in [SPONSORSHIPS.md](SPONSORSHIPS.md). Not yet delivered: payment reminders; provider and bank feeds; opening-balance migration; and period-end reconciliation sign-off.

## Behaviour

- **Append-only ledger.** `ledger_entries`, `ledger_allocations`, and `student_payments` reject `UPDATE` and `DELETE` through database triggers. Balances are always recomputed from entries and allocations.
- **Allocation.** After every payment and billing run, unallocated payment credit settles the earliest-due open charge in the same currency (first in, first out). Overpayment stays as credit and is applied automatically to later charges.
- **Billing.**
  - The billing run uses the published schedule with the latest effective date on or before the period start.
  - If two currencies apply on that date, billing is refused rather than guessed.
  - The due date is the period start plus the schedule's due days.
  - Closed periods cannot be billed.
- **Payments.** Payments with a future received date are refused. A duplicate `(method, external reference)` returns `409`; concurrent replays are serialised, so exactly one succeeds.
- **Registration.**
  - A financial hold adds a `FINANCIAL_HOLD` blocker with plain-language reasons.
  - Recording an `eligible` financial clearance while a hold exists returns `409`.
  - A recorded clearance does not override a later hold, because confirmation re-evaluates the ledger.
  - Students with no charges are not held.
- **Separation and scope.**
  - Schedule publication cannot be done by its drafter.
  - Schedule access is scoped by programme code; billing, payments, and accounts are scoped by programme and intake.
  - Only roles that grant the specific finance permission lend scope, so a global auditor cannot widen a finance officer's scope.
- **Audit.** Drafting, publishing, billing, and payments write audit events with amounts, references, and counts.

## Adjustments

Migration `038_finance_adjustments.sql` adds reviewed adjustments. This is the governed replacement for the legacy manual invoice status and access override (`FIN-12`).

| Kind | Effect on approval |
| --- | --- |
| `waiver`, `scholarship`, `write_off` | Adds a `credit` ledger entry allocated directly to one billed charge. It cannot exceed that charge's outstanding amount and cannot target a refund or manual debit. |
| `debit` | Adds a manual `ADJUSTMENT` charge with a description and due date. It can create a hold. |
| `refund` | Adds a `REFUND` charge due today, settled from unallocated credit. It cannot exceed that credit. |
| `hold_exemption` | No ledger effect. While approved and unexpired (at most 180 days), the hold is lifted but its reasons stay visible. Approvers can revoke it with a reason. |

- **Evidence.** Each request pins a hash of the exact ledger state: every entry with its outstanding or unallocated amount. A payment, billing run, or other adjustment before approval makes the request stale (`409`); it must be rejected and requested again.
- **Review.** There is one open request per account. The requester can never review it (database check plus separation guard). Permissions are `finance.adjustment.request` and `finance.adjustment.approve`, both scoped by programme and intake.
- **Immutability.** A database trigger rejects changes to reviewed adjustments, except revoking an approved hold exemption. Adjustments cannot be deleted. Mistakes are corrected with a new reviewed adjustment.
- **Visibility.** Staff see the requester and reviewer. Students see their decided adjustments without staff identities, and their open requests are hidden.
- **Totals.** The account summary reports `credited` separately from `paid`, and `balance = charged - paid - credited`.

## Statement Imports and Unmatched Queue

Migration `039_payment_imports.sql` follows the roadmap payment workflow: receive the reference, validate the source and amount, match it to a student, route anything unmatched to a queue, and post a receipt. Manual payments and imported lines use the same posting function.

- **Reconciliation.** A statement (`bank` or `mobile_money`) carries the expected line count, the expected total, and a SHA-256 checksum of its lines. If any of these differ, nothing is posted (`409`). A source can import each statement reference only once.
- **Matching.** A line matches automatically only when:
  - its payer reference contains exactly one student number (`S` followed by 8 digits);
  - that number exists (a merged duplicate resolves to its survivor);
  - the student has exactly one programme that is not withdrawn or transferred.

  Matched lines post a payment and receipt immediately.
- **Duplicates.** A line whose `(source, reference)` already exists, including a repeat earlier in the same file, is recorded as `duplicate` and posts nothing.
- **Queue.** Every other line is `unmatched` and shows a plain-language note: no number, several numbers, unknown number, or zero or several active programmes. A different finance officer from the importer either assigns it to a student number (and a specific programme when the student has more than one) or marks it `returned` to the payer, with a reason. Assignment re-checks for duplicate references.
- **Immutability.** Imports and lines cannot be deleted. Lines change only once, from `unmatched` to `assigned` or `returned`, which a database trigger enforces.
- **Scope.** Unmatched lines belong to no programme yet, so importing and resolving need `finance.import` from a role with institution-wide scope. A programme-scoped finance officer, even with a global auditor role, is refused.

## Notifications

Finance events queue student email notifications through the shared notification service, in the same transaction as the ledger change. A rollback therefore never leaves a receipt behind.

| Template | Sent when |
| --- | --- |
| `finance.payment_receipt` | Any payment posts: manual, a matched statement line, or an assigned queue line. Includes the receipt number, amount, method, reference, and the new balance. |
| `finance.charges_billed` | A billing run creates charges for the student. Includes the period, total, and due date. Idempotent re-runs that create nothing send nothing. |
| `finance.adjustment_decided` | An adjustment is approved or rejected, or a hold exemption is revoked. Includes the type, amount, and reason. |

Templates load with `npm.cmd run reference:load` (and the dev seed). Delivery to a real mail provider still depends on ADR-005. The shared queue now fills variables into subjects as well as bodies; earlier admissions subjects were stored with raw `{{...}}` placeholders.

## Opening Balances and Control Totals

Migration `040_finance_opening_balances.sql` covers the roadmap's "approved opening balances" migration wave and the period-end reconciliation exit gate. Only sample data has been imported; no legacy finance export has been loaded or approved.

- **Import rules.**
  - Each line is a legacy reference, a student number (a merged duplicate resolves to its survivor), an optional programme ID, and a non-zero amount: positive is owed, negative is credit held.
  - The file must match its expected line count, debit total, credit total, and checksum.
  - `dryRun: true` returns a line-by-line problem report without posting.
  - A real import posts nothing if any line has a problem: an unknown student, an ambiguous programme, an existing opening balance in that currency, or two lines for one programme.
  - Each `(source, reference)` imports once; a programme holds at most one opening balance per currency (unique index).
  - Imports and lines are append-only.
- **Ledger effect.** Debits become `OPENING_BALANCE` charges due on the as-of date, so they hold immediately if unpaid. Credits become `credit` entries that settle later charges. Statements, allocation, holds, and reports treat them like any other entry.
- **Permission.** `finance.migrate` (system administrator only, institution-wide). CLI: `npm.cmd run finance:opening-balances -- balances.json` validates locally. With `SVU_FINANCE_MIGRATION_TOKEN` set it runs a server dry run, and `--apply` posts.
- **Control totals.** `GET /api/finance/reports/control-totals?asOf=&currency=` gives accounts, opening, charged, paid, credited, balance, outstanding, due, and unallocated credit for each programme, intake, and currency, plus currency totals.
  - Only entries and allocations recorded by the as-of date count.
  - Each row checks that outstanding charges minus unallocated credit equal the balance (`reconciles`).
  - Rows are limited to the caller's finance scope. Institution-wide import roles also see the unmatched statement queue total.
  - `#registry` shows the panel with an as-of selector and CSV download.
  - [Stage 8 finance reporting governance](../stage-8/FINANCE_REPORTING.md) versions the definitions, makes the recording cutoff explicitly UTC, filters finance-authorized intakes before aggregation, and recalculates/audits CSV under fresh authority. Programme accounts are not unique students; the separately authorized unmatched import queue is current, not historical.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/finance/fee-schedules?programmeId=` | `finance.view` | Schedules for a catalogue programme. |
| `POST /api/finance/fee-schedules` | `finance.schedule.manage` | Draft: `programmeId`, `yearOfStudy`, `term`, `currency`, `effectiveFrom`, `dueDays`, `lines[{chargeCode,description,amountMinor}]`, `reason`. |
| `POST /api/finance/fee-schedules/{id}/publish` | `finance.schedule.publish` | Independent publication with `reason`. |
| `POST /api/finance/billing-runs` | `finance.billing.run` | `registrationPeriodId`, `reason`. |
| `GET /api/registry/programmes/{id}/account` | `finance.view` | Statement, hold, schedules, period billing runs, and capabilities. |
| `GET /api/registry/me/programmes/{id}/account` | `registry.self` | Own statement and hold. |
| `POST /api/registry/programmes/{id}/payments` | `finance.payment.record` | `currency`, `amountMinor`, `method`, `externalRef`, `receivedOn`, `reason`. Returns the receipt number and allocations. |
| `GET /api/registry/(me/)programmes/{id}/adjustments` | `finance.view` / `registry.self` | Adjustments, current ledger evidence hash, and capabilities (staff); decided adjustments only (student). |
| `POST /api/registry/programmes/{id}/adjustments` | `finance.adjustment.request` | `kind`, `evidenceHash`, `reason`, `evidenceRef`, plus `amountMinor`/`targetEntryId`/`currency`/`description`/`dueOn`/`expiresOn` as the kind requires. |
| `POST /api/registry/programmes/{id}/adjustments/{adjustmentId}/review` | `finance.adjustment.approve` | `outcome` `approved`/`rejected`, or `revoked` for an approved hold exemption, with `reason`. |
| `POST /api/finance/opening-balances` | `finance.migrate` (global) | Opening-balance file with control totals; `dryRun` reports problems without posting. |
| `GET /api/finance/reports/control-totals?asOf=&currency=` | `finance.view` (scoped) | Period-end control totals and reconciliation flags. |
| `GET /api/finance/payment-imports` | `finance.import` (global) | Recent statements with status counts, and the unmatched queue. |
| `POST /api/finance/payment-imports` | `finance.import` (global) | `source`, `sourceRef`, `currency`, `reason`, `expectedLineCount`, `expectedTotalMinor`, `checksum`, `lines[{externalRef,amountMinor,receivedOn,payerReference}]`. |
| `POST /api/finance/payment-imports/lines/{lineId}/resolve` | `finance.import` (global) | `action` `assign` (with `studentNumber`, optional `programmeId`) or `return`, plus `reason`. |

`finance_officer` and `system_administrator` hold all finance permissions (separation is enforced per schedule). `academic_registrar` has `finance.view`.

## Interface

- `#registry`: the student detail has a Student account panel showing totals, hold reasons, and the ledger, plus forms to record a payment, draft or publish a fee schedule, and run billing for each period.
- `#apply`: students see Fees and payments, with totals, hold reasons, and their ledger.

## Verification

Migration `037_student_finance.sql`. Unit tests are in `test/student-finance.test.js`: validation, FIFO allocation, per-currency summaries and holds, and the registration `FINANCIAL_HOLD` blocker. The desktop and mobile browser journey is in `e2e/student-finance.spec.js`. It covers:

- self-publish denial, an unknown charge type, wrong scope with a global auditor, and billing before publication;
- UI publication and billing, with the hold appearing;
- an idempotent re-run;
- clearance refused under a hold, and the registration blocker;
- a UI part-payment, duplicate and future-dated payments refused, and wrong-scope and student denial;
- a concurrent mobile-money replay, where exactly one is accepted;
- settlement with overpayment credit, then clearance and confirmed registration;
- the student's statement and audit evidence.

## Production Gates

- ADR-009 accounting boundary and the ERP/export interface.
- Finance-approved schedules, the charge catalogue, and the hold policy (including grace periods and minimum-payment rules).
- A finance-approved legacy opening-balance export loaded and reconciled with the control-totals report (tooling is ready; only sample data has been used).
- Live provider and bank feed connections (statement files are currently entered or pasted; no provider API is connected).
- Finance-approved adjustment authority limits.
- A period-end reconciliation signed off by finance.
