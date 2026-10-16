# Phase 1 API Contracts

## API Conventions

- All mutation endpoints require an idempotency key.
- All sensitive mutations produce an audit event.
- Protected endpoints require `Authorization: Bearer <session-token>`.
- The authenticated session resolves the actor for audit events; clients must not supply actor IDs for privileged actions.
- All list endpoints support pagination, filtering, sorting, and authorization-aware scoping.
- Validation errors return machine-readable field errors and plain-language messages.
- IDs are opaque to clients.
- Timestamps use ISO 8601 UTC.

## Identity

```http
POST /api/identity/invitations
POST /api/identity/activations
POST /api/identity/sessions
DELETE /api/identity/sessions/{sessionId}
GET /api/identity/accounts/{accountId}/sessions
POST /api/identity/accounts/{accountId}/suspend
POST /api/identity/accounts/{accountId}/reactivate
POST /api/identity/recovery-requests
POST /api/identity/recovery-confirmations
GET /api/identity/me
POST /api/identity/mfa/totp
POST /api/identity/mfa/totp/confirm
POST /api/identity/sessions/current/mfa
POST /api/identity/accounts/{accountId}/mfa/reset
PATCH /api/identity/me/profile
```

Implemented Phase 1 identity behavior:

- scope is per role: when a request is authorized by permission P, only the caller's roles that grant P (and their scopes) are considered. An empty scope means global only for those roles;

- session and activation tokens are 256-bit random values stored only as SHA-256 digests (`token_digest`, unique index), so authentication is a single indexed lookup; passwords stay scrypt-hashed;
- `DELETE /api/identity/sessions/{id}` ends the caller's own session; ending another account's session needs `identity.manage`. Otherwise the response is `404`, the same as for an unknown session;
- activation tokens are claimed atomically inside the activation transaction, so a replayed or concurrent activation returns `400`;
- logging in marks that account's expired sessions as `expired`;
- login is case-insensitive on email and throttled per email: 5 failures in 15 minutes return `429` for that email, whether or not an account exists. A missing account still pays for one scrypt check so timing does not reveal existence. A successful login clears the counter;
- login/recovery use `lower(btrim(email))` and require exactly one matching account across all statuses. Ambiguous login returns generic `401`; recovery retains generic `202` without selecting an account, superseding tokens or queueing delivery. Existing account-ID-bound sessions/tokens are not automatically revoked by lookup ambiguity. Recovery snapshots the canonical destination without rewriting stored account email. See [preserved mailbox authentication](../MAILBOX_TRIMMED_AUTHENTICATION.md);
- passwords (activation and reset) must be 12-256 characters, not built around the email name, and use at least 5 distinct characters;
- accepting an invitation grants the invited role and scope (`granted_by = invitation:{id}`);
- `GET /api/identity/me` returns the caller's account, person, roles with scope, and permissions;
- `POST /api/identity/recovery-requests` always returns `202` with the same message and allows at most 3 per account per hour. The 30-minute reset code is queued as a redacted notification; in development the full message is written to `data/dev-outbox/`;
- MFA uses TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step drift). Seeds are AES-256-GCM encrypted with `SVU_DATA_KEY`, which is required outside development. A code is accepted once (`last_used_step`), and enrolment issues 10 single-use recovery codes;
- login returns `status` and `nextStep`. Under `SVU_MFA_POLICY` (`off`, `enrolled` as the dev default, or `privileged` as the default elsewhere): enrolled accounts get `mfa_pending`, and high/critical-risk roles without a factor get `mfa_enrolment_required` under `privileged`. Partial sessions last 10 minutes and are refused (`401`) everywhere except the MFA endpoints and cancelling their own sign-in;
- `POST /api/identity/sessions/current/mfa` takes `code` or `recoveryCode`. Five bad codes revoke the sign-in (`401`); success activates the session with `assurance = mfa`;
- authenticated requests recheck current active-factor and effective high/critical-risk role requirements before loading permissions. Old password-only sessions, and enrolment challenges displaced by another session's successful enrolment, return `401` and must sign in again; they are not silently upgraded. Explicit `off` policy and valid partial/verified boundaries remain unchanged. See [current MFA session requirements](MFA_SESSION_REVALIDATION.md);
- an account can't replace its own active authenticator; `POST /api/identity/accounts/{id}/mfa/reset` (`identity.manage`, reason required) removes factors and recovery codes and revokes every session;
- `GET /api/identity/me` also returns `assurance` and `mfa` (`enrolled`, `recoveryCodesRemaining`);
- `POST /api/identity/recovery-confirmations` sets the new password, revokes all of the account's sessions, clears login failures, queues a password-changed notice, and refuses reused or expired codes with `400`.

- invitations create an expiring activation token;
- native identity invitations validate/normalize a single mailbox and refuse an existing account with `409`; pending invitations may coexist, but activation and sharing account registration serialize on the same canonical mailbox transaction lock;
- activations create a new person/account only. An existing account returns `409` without replacing its password, status, identity or role; the pending token claim rolls back. Token expiry is checked after the mailbox wait. Existing-account role grants, reactivation, password recovery and explicit staff appointment acceptance remain separate authenticated workflows. See [native canonical account creation](../MAILBOX_CREATION.md) for proof scope;
- migration 103 enforces all-status canonical account email uniqueness without rewriting identities; historical collisions abort migration rather than merge. See [database canonical uniqueness](../MAILBOX_UNIQUENESS.md);
- applicant registration and staff creation serialize canonical mailbox selection and refuse ambiguous identities. Registration retains generic `202` without identity-specific effects on ambiguity; staff creation returns `409`. Own staff offers retain account-ID binding, canonical matching and ambiguity refusal; roles still require explicit account-holder acceptance. See [registration and staff matching](../MAILBOX_REGISTRATION_STAFF.md);
- sharing acceptance requires a unique canonical active mailbox bound to the signed-in ID, rechecks challenge expiry after the mailbox wait, and refuses owner self-acceptance. Private/room invitations preserve consent/authority/contact locks, refuse all-status canonical ambiguity and recheck the same resolved account ID before insertion. See [sharing and messaging recipients](../MAILBOX_RECIPIENT_MATCHING.md);
- new default notification destinations and consented campaign audiences canonicalize valid stored account mailboxes. Account-bound delivery eligibility requires an active original account ID and exactly one all-status canonical match to the strictly valid frozen destination. Explicit destinations and existing frozen request envelopes are not rewritten; malformed sources, real address changes and ambiguity require reconciliation. See [canonical delivery matching](../MAILBOX_DELIVERY_MATCHING.md). Live provider configuration/receipt proof and historical correction/import authority remain separate requirements;
- activations set a scrypt password hash and mark the invitation token used;
- sessions verify the password and create an expiring session token;
- session deletion revokes an active session and writes an audit event;
- account-session listing returns session metadata without token hashes;
- suspension marks the account suspended, revokes active sessions, blocks login, and audits the action;
- reactivation restores login eligibility and audits the action.

## Authorization

Implemented protected endpoint requirements:

| Endpoint | Permission |
| --- | --- |
| `GET /api/audit/events` | `audit.view` |
| `POST /api/identity/invitations` | `identity.invite` |
| `GET /api/identity/accounts/{accountId}/sessions` | `identity.manage` |
| `POST /api/identity/accounts/{accountId}/suspend` | `identity.manage` |
| `POST /api/identity/accounts/{accountId}/reactivate` | `identity.manage` |
| `POST /api/access/role-assignments` | `access.assign_role` |
| `POST /api/workflows/instances/{workflowId}/transitions` | `workflow.transition` |
| `POST /api/tasks/{taskId}/assign` | `task.assign` |
| `POST /api/tasks/{taskId}/complete` | `task.assign` |
| `POST /api/tasks/{taskId}/handoff` | `task.assign` |
| `GET /api/documents` | `document.create` |
| `POST /api/documents` | `document.create` |
| `GET /api/notifications/templates` | `notification.send` |
| `GET /api/notifications` | `notification.send` |
| `GET /api/notifications/me` | Active authenticated session; own non-secret notices only |
| `POST /api/notifications/me/{id}/read` | Active authenticated session; own visible notice only |
| `POST /api/notifications/preview` | `notification.send` |
| `POST /api/notifications/send` | `notification.send` |
| `POST /api/master-data/programmes` | `master_data.publish` |
| `POST /api/master-data/intakes` | `master_data.publish` |

Scoped protected actions require the actor's role assignment to match the requested programme/intake context unless the actor has global system-administrator scope. Workflow transitions, task changes, and document metadata creation derive the target scope from the registered resource and reject cross-programme or cross-intake access.

## Roles and Permissions

```http
GET /api/access/roles
POST /api/access/role-assignments
PATCH /api/access/role-assignments/{assignmentId}
GET /api/access/effective-permissions
GET /api/access/audit
```

## Audit

```http
GET /api/audit/events
GET /api/audit/events/{eventId}
POST /api/audit/export-requests
```

Audit events are append-only. There is no update or delete endpoint.

Implemented query parameters for `GET /api/audit/events`:

- `actorId`
- `action`
- `subjectType`
- `subjectId`
- `occurredFrom`
- `occurredTo`
- `limit`

## Workflow and Tasks

```http
GET /api/workflows/definitions
POST /api/workflows/instances
GET /api/workflows/instances/{workflowId}
POST /api/workflows/instances/{workflowId}/transitions
GET /api/tasks
POST /api/tasks/{taskId}/assign
POST /api/tasks/{taskId}/complete
POST /api/tasks/{taskId}/handoff
```

Implemented workflow behavior:

- `POST /api/workflows/instances` (`workflow.transition`) takes `definitionCode`, `subjectType`, `subjectId`, and, for a subject without a registered scope, `scope.programmeCode`/`scope.intakeId`. It starts the latest active definition version at its initial state. A subject can have only one active instance per definition code (`409`);
- transitions require `toState` and `reason`; undeclared moves return `409`, unknown states `400`, and moves needing a permission the actor lacks `403`. Terminal states complete the instance and refuse further moves. An optional `expectedState` returns `409` if the instance changed underneath the caller;
- `GET /api/workflows/instances/{id}` (`workflow.transition`, in scope) returns the instance, `terminal`, the `allowedTransitions` for the caller, and the from/to `history`;
- `GET /api/workflows/definitions` lists versions with their states and transitions.

Implemented task behavior:

- assignment sets the assignee and moves open tasks to assigned;
- handoff moves the task to a new queue, optionally with a new assignee, and reopens it;
- completion marks the task completed;
- every task mutation writes an audit event and enforces the linked workflow subject scope.

## Documents

```http
POST /api/documents/upload-requests
POST /api/documents
GET /api/documents
GET /api/documents/{documentId}
POST /api/documents/{documentId}/reviews
GET /api/documents/{documentId}/view
POST /api/documents/{documentId}/download-requests
POST /api/documents/{documentId}/scan-results
PUT /api/documents/{documentId}/content?op=upload&expires=&signature=
GET /api/documents/{documentId}/content?op=download&expires=&signature=
```

The API returns short-lived view or upload URLs only after authorization checks.

Implemented upload behavior:

- `upload-requests` requires `document.create` and owner scope; accepts `application/pdf`, `image/jpeg`, `image/png` up to 10 MB with classification `public`, `internal`, `confidential`, or `restricted`; optional `checksum` must be SHA-256 hex;
- the storage key is randomized (`private/{ownerType}/{uuid}`) and never contains the client file name;
- the response carries a 15-minute HMAC-signed `PUT` link when a storage provider is configured (local `data/dev-storage/` in development). Elsewhere `provider` is `unconfigured` and the URL is null until ADR-004;
- the signed upload accepts the raw bytes only once. A body bigger than the declared size returns `413` (the stream stops at the 10 MB cap), a declared checksum mismatch returns `422`, and bytes whose magic number does not match the declared type are stored but immediately `quarantined`;
- lifecycle: `upload_requested` → `uploaded` → `available` (clean scan) → `verified`/`rejected` (review with reason, `document.review`), or `quarantined`;
- `POST .../download-requests` (scope-checked, audited as `document.download_requested`) returns a 5-minute signed `GET` link, only for `available`/`verified` documents. Links are bound to the operation and document, and the download is served as an attachment with `nosniff`;
- `GET /api/documents/{id}` returns metadata plus review history;
- `scan-results` requires `document.scan.record` and an `uploaded` document; `clean` with a verified signature moves the document to `available`, while `infected` or a signature mismatch moves it to `quarantined`; a second scan result returns `409`;
- both actions write audit events (`document.upload_requested`, `document.scan.passed`, `document.quarantined`).

## Notifications

Authenticated personal messages: `GET /api/notifications/me?view=all|unread|read&limit=20&cursor=...` and `POST /api/notifications/me/{id}/read` with `{}`. These are owned, bounded, non-secret projections, not staff queue grants. Read acknowledgements are transactional/idempotent and separate from delivery status. See [personal inbox](NOTIFICATION_INBOX.md) for privacy, cursor precision, legacy-secret exclusions and acceptance scope.

```http
GET /api/notifications/templates
POST /api/notifications/preview
POST /api/notifications/send
GET /api/notifications
GET /api/notifications/{notificationId}/delivery-attempts
```

## Master Data

```http
GET /api/master-data/organization-units?unitType=&status=
POST /api/master-data/organization-units
PATCH /api/master-data/organization-units/{unitId}
GET /api/master-data/organization-units/{unitId}/history
POST /api/master-data/organization-units/{unitId}/deactivate
POST /api/master-data/organization-units/{unitId}/reactivate
GET /api/master-data/programmes
POST /api/master-data/programmes
GET /api/master-data/programmes/{programmeId}/versions?asOf=YYYY-MM-DD
POST /api/master-data/programmes/{programmeId}/versions
POST /api/master-data/programme-versions/{versionId}/publish
POST /api/master-data/programme-versions/{versionId}/retire
GET /api/master-data/intakes
POST /api/master-data/intakes
GET /api/master-data/academic-periods?periodType=&status=&asOf=YYYY-MM-DD
POST /api/master-data/academic-periods
PATCH /api/master-data/academic-periods/{periodId}
POST /api/master-data/academic-periods/{periodId}/transitions
GET /api/master-data/courses?departmentId=&status=
POST /api/master-data/courses
PATCH /api/master-data/courses/{courseId}
POST /api/master-data/courses/{courseId}/retire
PUT /api/master-data/courses/{courseId}/prerequisites
GET /api/master-data/programme-versions/{versionId}/curriculum
POST /api/master-data/programme-versions/{versionId}/curriculum
DELETE /api/master-data/programme-versions/{versionId}/curriculum/{courseId}
GET /api/master-data/grading-schemes
POST /api/master-data/grading-schemes
POST /api/master-data/grading-schemes/{schemeId}/publish
POST /api/master-data/grading-schemes/{schemeId}/retire
GET /api/master-data/gpa-rule-sets
POST /api/master-data/gpa-rule-sets
POST /api/master-data/gpa-rule-sets/{ruleSetId}/publish
POST /api/master-data/gpa-rule-sets/{ruleSetId}/retire
POST /api/master-data/gpa-rule-sets/{ruleSetId}/calculate
GET /api/master-data/reference-lists
GET /api/master-data/reference-lists/{listCode}?asOf=YYYY-MM-DD&includeRetired=true
POST /api/master-data/reference-lists/{listCode}/values
PATCH /api/master-data/reference-values/{valueId}
POST /api/master-data/reference-values/{valueId}/retire
POST /api/master-data/reference-values/{valueId}/restore
```

Implemented master-data behavior:

- every master-data mutation requires `master_data.publish`; reads are public to the foundation UI;
- faculties and departments share `organization-units` (`unitType` = `faculty` | `department`); faculties are top-level, departments must sit under an active faculty, and programmes must be owned by an active department;
- unit changes (rename, move faculty, deactivate, reactivate) require a `reason` and an `effectiveFrom` date (default today). Each change closes the open `organization_unit_history` period and opens a new one. Backdating before the current period returns `409`; future-dated changes return `400` until scheduled changes are supported;
- deactivation is blocked (`409`) while a unit has active child units or non-retired programmes, and reactivation requires an active parent;
- programme versions are created as `draft` and are not editable once published. Publishing requires a `reason` and an effective date later than any other published version's; the previously open-ended published version is end-dated to the day before. Publishing anything other than a draft returns `409`;
- retiring a published version sets `status = retired` and an `effectiveTo` date; history is never deleted;
- `GET .../versions?asOf=` returns all versions plus `effectiveVersionId`, the published or retired version in force on that date;
- each mutation writes an audit event with `beforeRef`/`afterRef` (history or version ids) and `metadata.before`/`metadata.after` snapshots;
- intake creation preserves status and application windows where supplied;
- academic periods are `academic_year` (top-level, non-overlapping) or `semester`/`term` (inside one academic year, not overlapping siblings of the same type). Windows are `application`, `registration`, `teaching`, `assessment`, `results_publication`, and `archive` as `[start, end]`; teaching and assessment must sit inside the period;
- period lifecycle is planning → published → active → closed → archived (published may return to planning). Terms activate only after their year is published; a year closes only after its terms close; active periods accept window changes only; closed/archived periods are immutable;
- the list response carries `asOf`, plus `containsDate` and `openWindows` per period (planning periods never report open windows);
- courses have an immutable code (`COMP101` pattern), credits (0.5-60 in steps of 0.5), a level of 1-8, and an active owning department. Credits and level are frozen once the course is in a published curriculum. Retirement is blocked while the course is in a draft curriculum or is a prerequisite of an active course;
- `PUT .../prerequisites` replaces the set; only active courses are accepted, and cycles are refused with the cycle path;
- curriculum entries (`yearOfStudy` 1-8, `term` `S1`/`S2`/`S3`/`ANY`, `core`/`elective`) can change only while the programme version is a draft. `GET .../curriculum` returns entries, `creditsByYear`, and `problems` (prerequisite missing or not scheduled earlier, retired course). Publishing a version with problems returns `409`;
- maker-checker: publishing a programme version, grading scheme, or GPA rule set returns `403` if the caller drafted it. The new `academic_registrar` role (`master_data.publish`) acts as the checker; `publishedBy` records the approver;
- grading schemes and GPA rule sets are versioned per `code` (v1, v2, … assigned by the server), drafted, then published with `effectiveFrom` and `reason`. Publishing end-dates the previous published version, and history is never edited. Scheme bands must cover 0-100 contiguously, with points and pass status non-decreasing as marks rise. Classifications are GPA thresholds;
- GPA rules: `creditWeighted`, `retakePolicy` (`latest`/`best`/`all`), `excludeGrades` (e.g. `W`, `EX`), `includeFailed`, and `rounding` (`decimals`, `half_up`/`truncate`). A rule set must reference a published scheme and can publish only if it has worked examples (`samples`) that all reproduce their expected GPA and classification; outcomes are returned and audited;
- `.../calculate` (any authenticated user) returns the GPA, classification, counted results, and excluded results with reasons; a scheme still used by a published rule set cannot be retired;
- reference lists (`country`, `academic_level`, `study_mode`, `currency`, `disability`, `religion`) are registered in `reference_lists` with owner, sensitivity, lawful purpose, status, and an optional value-code pattern (ISO alpha-2 for countries, ISO 4217 for currencies, which also need `metadata.minorUnits`);
- value codes are immutable and never deleted; values are relabelled, retired (with `effectiveTo`), or restored. Lists marked `under_review` (religion) refuse new values;
- baseline values live in `scripts/reference-data.js` and load idempotently with `npm.cmd run reference:load`.

## Example Error Shape

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields need attention.",
    "fields": [
      {
        "field": "applicationWindow.startDate",
        "message": "Start date must be before the end date."
      }
    ],
    "correlationId": "01JZ3F7P8W6V1K4X7B8C9D0E1F"
  }
}
```
