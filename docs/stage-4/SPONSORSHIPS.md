# Stage 4 Sponsor Accounts and Third-Party Billing

## Delivered Slice

A sponsor (a bursary fund, employer, or government scheme) can cover part or all of a student programme's fees. A finance officer proposes a sponsorship and a different person approves it. The covered share of each eligible charge then moves to the sponsor: the student's ledger receives a sponsor credit, and the sponsor owes the same amount. Sponsor payments settle the sponsor's balance, never the student's. The student is held only for what remains theirs to pay.

This closes the Stage 4 "sponsor accounts and third-party billing" gap. It is a development pilot. Sponsor agreements, invoicing practice, and the policy questions are D-35 in [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md).

## Behaviour

- **Sponsors.** Sponsors are institution-wide records with a code, name, and contact. Creating them (`finance.adjustment.request`) and recording their payments (`finance.payment.record`) needs a globally scoped finance role. Programme-scoped officers are refused.
- **Sponsorships.** Each sponsorship has:
  - a currency and a coverage percentage (1-100);
  - optional charge codes (none means all codes) and an optional cap;
  - a validity window for charge due dates.

  Requests need `finance.adjustment.request` within the programme's scope. Only one requested or approved sponsorship is allowed per sponsor, programme, and currency (enforced by a unique index).
- **Approval** (`finance.adjustment.approve`).
  - The approver must be someone other than the requester.
  - Approval immediately covers the programme's existing eligible charges, and the student receives a `finance.sponsorship` email.
  - Billing runs apply all approved sponsorships to newly billed charges automatically.
- **Coverage rule.**
  - Charges are considered in due-date order. Each eligible charge gets the coverage percentage, rounded down to whole minor units, until the cap is used up.
  - A charge is sponsored at most once, by any sponsor (enforced by a unique index on the charge), so a second sponsor never covers what a first already covers.
  - Repeating the application, for example re-running billing, creates nothing new.
- **Ledger.** Each transfer is a `sponsor_transfers` row (append-only) plus a `credit` ledger entry linked to it. Sponsor transfers are a third kind of ledger credit, alongside approved adjustments and opening balances, with the database shape check extended. The ledger is then re-allocated oldest-first, as for payments and other credits. Holds, statements, and registration clearance follow automatically.
- **Sponsor statement.** What a sponsor owes (its transfers) minus what it has paid gives its balance per currency. Each sponsor payment reference is recorded once.
- **Ending.** Ending a sponsorship (with a reason) stops future coverage. Transfers already made stand.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/finance/sponsors` | `finance.view` | Sponsors with statements, and capabilities. |
| `POST /api/finance/sponsors` | `finance.adjustment.request`, global | `code`, `name`, optional `contactEmail`, `reason`. |
| `POST /api/finance/sponsors/{id}/payments` | `finance.payment.record`, global | `currency`, `amountMinor`, `externalRef`, `receivedOn`, `reason`. |
| `GET /api/finance/programmes/{id}/sponsorships` | `finance.view`, scoped | Sponsorships with the amount transferred, active sponsors, and capabilities. |
| `POST /api/finance/programmes/{id}/sponsorships` | `finance.adjustment.request` | `sponsorId`, `currency`, `coveragePercent`, optional `chargeCodes` and `capMinor`, `validFrom`, `validTo`, `reason`. |
| `POST /api/finance/programmes/{id}/sponsorships/{sid}/review` | `finance.adjustment.approve` | `outcome`, `reason`. Returns the transfers made. |
| `POST /api/finance/programmes/{id}/sponsorships/{sid}/end` | `finance.adjustment.request` | `reason`. |

## Interface

- **Sponsors panel (`#registry`).** A session-level panel lists sponsors with their statements, an add-sponsor form, and sponsor payment forms.
- **Sponsorships section.** The student detail shows sponsorships with coverage, validity, cap, and the amount transferred, plus forms to request, independently approve, and end them.

## Verification

Migration `070_sponsorships.sql`, and the `finance.sponsorship` template. Unit tests in `test/sponsorships.test.js` cover the coverage rule: currency, codes, and validity window; already-sponsored charges; percentage rounding; and a cap spread across earlier and new transfers. The desktop and mobile journey in `e2e/sponsorships.spec.js` covers:

- global-scope sponsor creation, with a UI add and a duplicate refused;
- the sponsorship request, with duplicate, invalid-percentage, and self-approval refusals;
- UI approval moving 80% of tuition (USD 960.00) to the sponsor, with the student balance and hold, the sponsor statement, and the notification checked;
- a repeat billing run creating no second transfer;
- a UI sponsor payment changing only the sponsor's balance, with replay and scoped refusals;
- a second sponsor covering only the not-yet-sponsored registration fee;
- the student paying the remainder and the hold clearing;
- ending a sponsorship while keeping its transfers;
- the audit trail.

The student finance and payment plan journeys still pass.

## Remaining Work

- Sponsor invoices and statements as documents, using the document-template mechanism, and delivery to sponsors through the integration queue.
- Allocating each sponsor credit to the specific charge it covers. Today it joins the oldest-first allocation, which can settle an older charge first; the totals are the same.
- What happens to a sponsor's share if the student withdraws, and to sponsor refunds (D-35).
