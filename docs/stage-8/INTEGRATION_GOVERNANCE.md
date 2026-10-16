# Stage 8 Integration Governance

## Delivered Slice

Every connection to an outside system is catalogued. Each entry records:
- an accountable owner and a purpose;
- a data classification and an authentication method;
- a data-sharing agreement reference and a retention note;
- a rate limit, a timeout, and a retry budget.

Outbound calls go through a governed delivery queue:
- each message has an idempotency key per connection;
- failed attempts are retried with exponential back-off;
- exhausted messages become dead letters, which operators retry or cancel with a reason;
- each connection's health is derived from the queue.

A contract check sends a ping through the real delivery path.

This covers the roadmap's Stage 8 integration governance: an API catalogue with owners; authentication, rate limits, idempotency, retry, timeout, and an error queue; contract tests and monitoring; and data-sharing and retention agreements. It is a development pilot. No real provider is connected yet (ADR-005, D-05, D-06), so outbound delivery uses a development adapter. Edge rate limiting of inbound traffic depends on hosting (D-03).

## Behaviour

- **Catalogue.** It is loaded as baseline data (`scripts/integration-catalogue.js`, run by the seed and `reference:load`) with the connections the rebuild already needs:
  - LMS connector, email, SMS, payment gateway, and malware scanner, all planned;
  - bank statement import, active.

  Operators with `integrations.manage` create connections and change their details or status. Changes are revisioned and audited.
- **Status rules.**
  - Activating a connection that carries non-public data needs a recorded agreement reference (enforced in code and by a database check).
  - Retired connections are final and refuse new messages.
  - Suspended connections hold their messages until resumed.
- **Enqueueing.** Messages enter the queue through `enqueueIntegration` inside the caller's own transaction, so a message is queued exactly when its business change commits.
  - Repeating a key with the same content returns the original message (`replayed`); reusing it for different content returns `409`.
  - Inbound-only connections refuse outbound messages.
- **Delivery worker** (`POST /api/integrations/outbox/process`, or the panel button). It:
  - attempts due messages for connections that have an adapter and are planned or active;
  - honours each connection's per-minute limit and timeout;
  - records every attempt (delivered, failed, or timeout) in an append-only history;
  - backs off 30 s, 1 m, 2 m, and so on, up to 1 h;
  - moves a message to the dead letters once its attempts reach the connection's limit.

  A scheduler to run it continuously comes with hosting.
- **Operator actions.**
  - Retrying a dead letter gives it a fresh retry budget; earlier attempts stay in the history.
  - Pending and dead messages can be cancelled.
  - Both actions need a reason and are audited.
- **Privacy.** Payloads of restricted connections are never displayed; only their field names are.
- **Contract check.** A ping goes through the same queue and adapter, and the result is reported as passed or failed. A connection without an adapter reports "not configured" instead of pretending to pass.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/integrations` | `integrations.view` | Connections with health (pending, dead, delivered today, failures today, last delivery and failure). |
| `POST /api/integrations/connections` | `integrations.manage` | Create a connection, with a reason. |
| `POST /api/integrations/connections/{id}` | `integrations.manage` | `revision`, `reason`, and changes or `status`. |
| `POST /api/integrations/connections/{code}/check` | `integrations.manage` | Contract check. |
| `GET /api/integrations/outbox?status=&connection=` | `integrations.view` | Recent messages (restricted payloads redacted). |
| `GET /api/integrations/outbox/{id}/attempts` | `integrations.view` | Attempt history. |
| `POST /api/integrations/outbox` | `integrations.manage` | Queue a message manually (`connectionCode`, `idempotencyKey`, `operation`, `payload`, `reason`). |
| `POST /api/integrations/outbox/process` | `integrations.manage` | One worker pass, optionally limited to one `connectionCode`. |
| `POST /api/integrations/outbox/{id}/retry` and `/cancel` | `integrations.manage` | With a reason. |

`system_administrator` holds both permissions; `auditor` can view.

## Interface

The registry has an **Integrations** panel showing:
- each connection's owner, classification, agreement, status, adapter, and health;
- contract check and status forms;
- the delivery queue, with dead and pending views, retry and cancel, and a button to run the delivery worker.

## Verification

Migration `067_integration_governance.sql` and the baseline loader. Unit tests in `test/integrations.test.js` cover back-off, connection validation, payload redaction, and the development adapter. The desktop and mobile journey in `e2e/integrations.spec.js` covers:

- the baseline catalogue, readable by auditors but not changeable by them;
- creation, including missing-reason and duplicate refusals;
- activation refused without an agreement, then allowed with one;
- idempotent replay, and key reuse refused;
- inbound-only refusal;
- a worker run from the UI that delivers one message, rejects one, and times out one (dead letters);
- the attempt history;
- UI retry and cancel, with invalid retry and cancel refused;
- a contract check that passes, and "not configured" for the payment gateway;
- restricted payload redaction;
- a suspended connection holding its messages, and a retired one refusing new messages and changes;
- the audit trail.

## Remaining Work

- Real adapters (email, SMS, payment gateway, scanner, LMS) once providers are chosen (ADR-005, D-05, D-06, D-11), with secrets in managed configuration.
- A scheduled worker and alerting on dead letters once hosting is decided (D-03); edge rate limiting for inbound callers.
- Routing existing notifications and future provider calls through the queue, done with each provider integration.
- Recording each agreement's signatory and expiry once data-sharing agreements are formalised.
