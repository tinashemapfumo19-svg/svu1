# Online Fee Payments

Students pay towards their balance on Student Office → Fees & Payments → **Pay online**.

## Flow

1. The student chooses an amount (at least 1.00, at most their balance in that currency). The server records a
   **payment intent** (`payment_intents`, migration `113_online_payments.sql`) and asks the provider to start a payment.
2. The student completes payment on the provider's page and returns to `#office/fees?payment=<intent>`. The page polls
   `GET /api/payments/:id`, which asks the provider for the latest status while pending.
3. The provider's server-to-server result (`POST /api/payments/paynow/result`) and the poll are both **hash-verified**.
4. Only a verified **paid** status for the **exact amount** posts the payment, through the same `postPayment` path as a
   cashier entry (method `online`, external reference = intent id, so it can never post twice). The ledger, FIFO
   allocation, receipt (`RCT-…`) notification and audit follow as usual. An amount mismatch fails the intent for Finance
   review.

Open intents older than a day expire when the student starts a new one.

## Configuration

| Variable | Meaning |
| --- | --- |
| `SVU_PAYMENTS` | `disabled` (default), `paynow`, or `simulated` (development only; a local page decides the outcome) |
| `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY` | Paynow integration credentials |
| `SVU_PUBLIC_URL` | `https://` address Paynow returns to and posts results to |

`server/payment-gateway.js` follows Paynow's published web integration (form fields signed with an uppercase SHA-512 of
the values plus the key). **It has not been tested against Paynow; do a sandbox check before enabling it.**

## Outstanding (D-44)

- Provider choice and contract, currencies accepted (USD/ZWG), who pays fees, and the Finance reconciliation routine.
- Refunds and reversals (handled by Finance adjustments today).
- A Finance view of online payment intents, including failed and mismatched ones (they are audited).
