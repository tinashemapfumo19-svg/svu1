# Stage 4 Payment Plans

## Delivered Slice

A finance officer can propose an instalment plan covering a student programme's outstanding charges in one currency, and a different person approves it. While payments keep pace with the instalments due so far, the covered charges stop placing a financial hold on registration. If the student falls behind, the hold returns automatically. Once the covered total is paid, the plan is complete.

This closes the Stage 4 "payment plans" gap. It is a development pilot: eligibility, the maximum number of instalments, and any late fees are finance policy (D-34 in [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md)).

## Behaviour

- **Request** (`finance.adjustment.request`, scoped).
  - A plan covers every charge in the chosen currency that is outstanding at the time of the request. It records which charges and the total.
  - Instalments: 2 to 12, on increasing dates from today up to a year ahead, in positive whole minor units, adding up exactly to the covered total.
  - Only one requested or approved plan is allowed per programme and currency (enforced by a unique index).
- **Approval** (`finance.adjustment.approve`).
  - The approver must be someone other than the requester.
  - Approval re-checks that the covered charges and their outstanding total are unchanged. If a payment or adjustment has changed the balance, the plan must be rejected or cancelled and requested again.
  - The student receives a `finance.plan` email with the first instalment.
- **Standing.** Standing is computed from the ledger every time, never stored:
  - *paid* = the covered total minus what is still outstanding on the covered charges;
  - *required to date* = the sum of instalments due on or before today;
  - **completed** when paid reaches the covered total;
  - **current** when paid is at least the amount required to date;
  - otherwise **in arrears**.
- **Effect on holds.** The hold calculation (`accountSummary`) ignores overdue covered charges only while the plan is current. Charges that are not covered, and plans in arrears, hold as before. Registration's `FINANCIAL_HOLD` and financial clearance use the same calculation, so they follow automatically.
- **Cancellation.** Cancelling (`finance.adjustment.request`, with a reason) ends the protection at once. The ledger is never changed by a plan. Plans cannot be deleted.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/finance/programmes/{id}/plans` | `finance.view` (scoped) | Plans with live standing, currencies, and capabilities. |
| `POST /api/finance/programmes/{id}/plans` | `finance.adjustment.request` | `currency`, `instalments` (`dueOn`, `amountMinor`), `reason`. |
| `POST /api/finance/programmes/{id}/plans/{planId}/review` | `finance.adjustment.approve` | `outcome` `approved`/`rejected`, `reason`. |
| `POST /api/finance/programmes/{id}/plans/{planId}/cancel` | `finance.adjustment.request` | `reason`. |

The student account (`GET .../account`) now includes `plans` with their standing.

## Interface

The registry student detail has a **Payment plans** section with:
- each plan's instalments, status, and live standing (current, in arrears, or completed), with the next instalment;
- an independent approve or reject form;
- cancellation;
- a form to propose a plan, with one instalment per line as date and amount in major units.

## Verification

Migration `068_payment_plans.sql`, and the `finance.plan` template. Unit tests in `test/payment-plans.test.js` cover:
- standing for current, in-arrears, and completed plans;
- holds lifted only for covered charges while current, and restored in arrears;
- instalment validation (count, order, date window, real dates, total).

The desktop and mobile journey in `e2e/payment-plans.spec.js` covers:
- refusals for a wrong total, a currency with no balance, an out-of-scope officer, a duplicate, and self-approval;
- a balance change between request and approval refused, then cancellation;
- a UI proposal, then independent approval;
- an unpaid first instalment leaving the plan in arrears and the hold in place;
- the instalment payment making the plan current and lifting the hold, in the API and the UI;
- the student notification;
- cancellation restoring the hold;
- the audit trail.

The student finance and finance adjustment journeys still pass.

## Remaining Work

- Policy: eligibility, instalment limits, late fees or interest, and whether a defaulted plan blocks a new one (D-34).
- Sponsor accounts, where a third party pays some or all of a student's charges (next Stage 4 gap).
- Student-initiated plan requests through the portal.
