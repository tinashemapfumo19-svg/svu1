# Email Delivery

The notification email worker supports an optional Resend adapter. It is disabled by default. Building the adapter does not select a university provider, approve a data-sharing agreement, or establish real mailbox delivery.

## Deployment Settings

| Variable | Required When Enabled |
| --- | --- |
| `SVU_MAIL_PROVIDER` | `resend`; omit or use `disabled` to prevent all worker enrollment/sending |
| `SVU_MAIL_API_KEY` | Provider credential supplied through deployment secret management, never through the UI or chat |
| `SVU_MAIL_FROM` | One verified sender mailbox; display-name/address-list syntax is not accepted |
| `SVU_MAIL_WEBHOOK_SECRET` | Provider-issued `whsec_` signing secret supplied through secret management |
| `SVU_PUBLIC_ORIGIN` | Approved HTTPS application origin, without a path, credentials, query or fragment |
| `SVU_MAIL_ENABLED_AFTER` | Explicit UTC ISO timestamp; queued notifications must be created at/after it, and applicant campaigns must be published at/after it |
| `SVU_DATA_KEY` | Explicit secure base64 32-byte data key, required even in development when enabling email |

The existing `email_provider` integration must be active, outbound/both, classified restricted, and have a recorded agreement reference. Review its institutional owner, counterparty, purpose, authentication description, retention, timeout, rate and retry budget before activation. The dedicated notification worker uses these governance controls; the generic integration development adapter/outbox is not the email provider transport and its simulated receipts do not establish email delivery.

Apply migrations with `npm.cmd run migrate` on Windows PowerShell (or `npm run migrate` where npm scripts are permitted). Start/restart the application with approved deployment settings. The enabled worker runs every 30 seconds, never overlaps its own passes, and drains its bounded in-flight pass during shutdown. Do not enable it against existing working data merely to test credentials. Verify sender domain, owned public origin and provider sandbox policy first.

## Operator Workspace

Staff workspace > Administration > Email delivery provides bounded status pages, current attempt counts, safe error codes and acceptance timestamps. Institution-wide `integrations.view` authority is required to inspect it; `integrations.manage` is required to process, retry or cancel. A scoped permission cannot borrow an unrelated global role.

- `pending`: eligible for a due attempt, subject to governance and rate limits.
- `accepted`: the provider returned an email identifier; this is not proof of delivery.
- `delivered`, `bounced`, `complained`, `failed`: authenticated provider callback outcomes.
- `dead`: source reconciliation, permanent rejection, retry budget exhaustion, or expired safe retry window.
- `cancelled`: future attempts stopped; already accepted/uncertain remote mail cannot be recalled.

Retries and cancellations require the current revision and a reason. Reviewed retries preserve the request, idempotency key and all earlier attempts, and may extend the attempt budget up to a hard total of 20. They never restart the provider idempotency window. Source-missing, expired or already accepted messages cannot be retried; use the originating business workflow to issue a genuinely new invitation/recovery request after reconciliation.

## Delivery Guarantees And Limits

The exact sender, recipient, subject, plain-text body and public sharing link are encrypted and committed before the first external attempt. Retries use this immutable snapshot, not current template/configuration edits. Account-targeted messages recheck and lock the active account and matching email before sending. The notification is also locked and must still be queued; cancelled source records are not sent. Ordinary and one-time-secret notifications use the same provider path, but historical redacted secret messages without original encrypted content cannot be reconstructed.

Row locks, skip-locked claims and a shared database worker lock serialize concurrent sending and rate accounting. A concurrent pass may skip locked rows; a subsequent pass picks them up. Every actual attempt retains its number, safe error code and outcome. Network ambiguity/timeouts, rate limiting and server failures back off exponentially from 30 seconds to at most one hour; permanent failures become dead letters. A provider response is never stored wholesale or copied into error logs.

Stable notification-based idempotency keys protect retries within the provider's supported window. Resend documents a 24-hour window; this worker stops attempts 23 hours after the first prepared request, allowing a safety margin. This is bounded duplicate protection, not an unlimited exactly-once promise. A crash after remote acceptance can require retry/reconciliation with the original key. Late retries are refused rather than risk a duplicate send. [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Provider Callbacks

Register `POST /api/email-delivery/webhooks/resend` with the approved publicly reachable origin. Subscribe to `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, and `email.delivery_delayed`. The application verifies the original bounded request body and Svix headers using the maintained Svix library before JSON processing. Missing/invalid/stale signatures are rejected. [Resend verification documentation](https://resend.com/docs/webhooks/verify-webhooks-requests), [event types](https://resend.com/docs/webhooks/event-types).

The immutable callback journal retains only event/message IDs, type, event/receipt times and an actor-keyed digest, not raw provider payloads, recipient addresses, subjects or bounce text. Duplicate event IDs with identical bodies do not repeat state changes; conflicting bodies are refused. Early callbacks are retained and reconciled when acceptance commits. Late sent/delayed/failed events cannot downgrade delivery, bounce or complaint outcomes; complaints and bounces remain visible even after older delivery events arrive.

## Applicant Campaigns

Migration 091 bridges the separate optional applicant campaign queue through immutable `applicant_communication_email_links`. Only published campaigns at/after the deployment cutoff, with original queued email recipients, are eligible. Existing scoped audience preview/publication and captured consent remain authoritative; the worker does not create recipients or grant consent. Concurrent enrollment produces one notification per original recipient.

The original campaign mailbox, subject and body are copied into an encrypted immutable notification snapshot in the same transaction as the link. Public notification/operator APIs expose no campaign body, subject, internal reason or mailbox. The operator template label is `applicant.campaign`. Enrollment checks the active account and unchanged mailbox. Missing/corrupt encrypted sources or changed mailboxes become campaign dead letters without reconstructing content; unlinked source failures require reconciliation and a newly approved campaign, not a blind operator retry.

Before preparation and every send/retry, the worker locks the account, the existing per-account communication preference lock and the original recipient. It checks current explicit email consent and retained cancellation. Opt-out cancels queued/dead campaign recipients, including those not yet bridged. A later opt-in cannot revive those recipients. A worker waiting behind a preference change observes its committed cancellation before contacting the provider. Once an attempt has begun under the lock, withdrawal waits for that bounded attempt to finish; accepted or uncertain remote mail cannot be recalled. Operational cancellation also updates the original campaign recipient. Retry cannot override withdrawn consent.

Provider acceptance, signed callback outcomes, local dead letters and operational cancellation are reflected back into the original campaign recipient in the same transaction. Published audience counts never change. Admissions campaign detail shows safe aggregated email states; the scoped operations report and CSV use `applicant-campaign-operations-v2` with 29 measures and reconcile every email state against retained recipients. A report's provider-evidence flag is true only when that cohort contains retained delivered/bounced/complained/failed outcomes, not merely acceptance; the dictionary alone does not attest to a cohort or live production send. Existing retained editions are not rewritten.

## Verification And Outstanding Boundaries

Tests exercise fixed provider endpoint/idempotency headers, safe error classification, signature/body/timestamp verification, concurrent claims, lost responses, backoff, timeout exhaustion, retries, cancellation, suspension/rate gates, ordinary and encrypted secret sources, mailbox changes, early/replayed/conflicting/out-of-order callbacks, metadata privacy, database guards and desktop/mobile operator layout. Provider calls and callbacks are controlled fixtures in an isolated database, not genuine Resend sends.

Production credentials, provider selection/agreement, verified sender, deployed origin, live receipt/bounce testing, callback ingress rate controls, retention execution, key rotation and operational monitoring remain deployment gates. Campaign timing/cancellation history policy, institutional metric approval and production migration remain separate boundaries. All provider calls and signatures in verification are isolated controlled fixtures, not genuine mailbox delivery. The broader legacy-coverage goal remains active.
