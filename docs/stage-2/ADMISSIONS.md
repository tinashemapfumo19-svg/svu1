# Stage 2: Admissions and Applicant Portal

Working contract and traceability for Stage 2. Every item maps to inventory IDs in `docs/LEGACY_FUNCTIONALITY_INVENTORY.md`. Phase 1 foundation contracts (identity, workflow, documents, notifications, master data) are in `docs/phase-1/API_CONTRACTS.md`.

## Traceability

| Inventory | Capability | Status |
| --- | --- | --- |
| ADM-01 | Public application, accessible and save-and-resume | Done (API): registration, activation, draft applications with saved answers and study mode, resume any time |
| ADM-02 | Undergraduate/postgraduate or course-level selection | Done for programme/intake admissions: configured programme-to-UG/PG route mapping, pinned on each application; standalone course admission is outside this pilot |
| ADM-03 | Nationality/country and prior academic level | Done: applicant profile against `country` and `academic_level` lists |
| ADM-04 | Study category/mode | Done: profile `studyModeCode` against `study_mode` list |
| ADM-05 | Programme selection from configured courses/vacancies | Done: public catalogue of published intakes with requirements |
| ADM-06 | Application-fee code / payment / waiver | Done for pilot: applicants must verify a payment reference or approved waiver code before submission; provider integration remains a later ADR |
| ADM-07 | Supporting-document upload with checklist and scanning | Done: programme-version and applicant-category checklists, signed uploads, scan gates, staff view/verify/reject controls and replacement uploads |
| ADM-08 | Duplicate applicant and application detection | Done: same legal name and date of birth, or same phone, flagged in the queue and explained in the detail view; one live application per intake per applicant |
| ADM-09 | Confirmation, receipt, status timeline | Done: reference receipt, applicant messages and state history across reopened reviews; staff see full audited reasons |
| ADM-10 | Pending/open applicant queues | Done: scoped queue, oldest first, days waiting, route/intake/state/assignee filters, paging, optional completed applications, assignment and handoff |
| ADM-11 | UG/PG vetting queues | Done: separate versioned UG/PG review definitions; institution-wide administrators configure additional academic/faculty stages without changing existing workflow instances |
| ADM-12 | Approval with criteria, evidence, audit | Done: decisions at the Decision step by `admissions.decide` holders, with notes, audit, and capacity-checked offers (unconditional or conditional) |
| ADM-13 | Rejection with controlled reasons | Done: `decision_reason` reference list; the reason appears in the letter and the applicant view |
| ADM-14 | Reopen/defer/review as explicit transitions | Done: applicant deferral requests, controlled approval/rejection or staff deferral, staff withdrawal, and reasoned reopen into a new review instance preserving old history; Accepted cannot be reopened |
| ADM-15 | Applicant communication from vetting | Done for pilot: applicant-visible information requests and individual/bulk messages, plus offer/rejection notification templates; external delivery pending ADR-005 |
| ADM-16 | Manifests and counts | Done: per-intake manifest with counts by workflow state, places taken/remaining, accepted list with student numbers, unconverted count |
| ADM-17 | Exactly-once accepted-offer conversion | Done: conversion inside the accept transaction, idempotent staff retry, DB uniqueness per person and per application, returning students keep their number |
| ADM-18 | Secure activation for approved applicants | Done differently: applicants already hold an activated account from self-registration, so conversion grants the student role and sends a welcome notice; no new credentials or links are issued |

## Stage 2 Exit Gate Status

| Gate | Status |
| --- | --- |
| Every application has a state, owner, next action, history, and decision authority | Met in the API: workflow state, assignee, caller-specific `allowedTransitions`, audited history, and `admissions.decide` for decisions |
| Submitted applications and uploaded documents reconcile with source control totals | Tooling implemented and sample-verified: mapped open/historical applications, private document bytes, source totals/checksums, repeat protection and live reconciliation. Production export and owner approval remain pending; see `MIGRATION.md` |
| Accepted applicants convert exactly once without duplicate student records | Met: DB-enforced and tested with concurrent retries and a returning applicant |
| Admissions can complete a pilot intake without legacy writes | Applicant/staff browser journey verified on desktop and mobile; owner-run pilot still pending. See `BROWSER_QA.md` |

## API

```http
GET  /api/admissions/catalogue
POST /api/admissions/registrations
GET  /api/admissions/profile
PUT  /api/admissions/profile
POST /api/master-data/intakes/{intakeId}/transitions
GET  /api/admissions/applications
POST /api/admissions/applications
GET  /api/admissions/applications/{applicationId}
PATCH /api/admissions/applications/{applicationId}
POST /api/admissions/applications/{applicationId}/documents
POST /api/admissions/applications/{applicationId}/fee
POST /api/admissions/applications/{applicationId}/submit
POST /api/admissions/applications/{applicationId}/withdraw
POST /api/admissions/applications/{applicationId}/respond
GET  /api/admissions/review/applications?intakeId=&programmeCode=&state=&assigned=me|unassigned&limit=
GET  /api/admissions/review/applications/{applicationId}
POST /api/admissions/review/applications/{applicationId}/assign
POST /api/admissions/review/applications/{applicationId}/notes
POST /api/admissions/review/applications/{applicationId}/request-information
POST /api/admissions/review/applications/{applicationId}/decision
POST /api/admissions/review/offers/expire
POST /api/admissions/applications/{applicationId}/offer-response
POST /api/admissions/review/applications/{applicationId}/convert
GET  /api/admissions/review/intakes/{intakeId}/manifest
```

Additional completion APIs:

```http
GET  /api/admissions/routes
PUT  /api/admissions/routes/{undergraduate|postgraduate}
POST /api/admissions/applications/{applicationId}/deferral
POST /api/admissions/review/applications/{applicationId}/deferral
POST /api/admissions/review/applications/{applicationId}/reopen
POST /api/admissions/review/applications/{applicationId}/withdraw
POST /api/admissions/review/messages
POST /api/admissions/migrations
GET  /api/admissions/migrations/{batchId}
```

Route updates require institution-wide `admissions.configure` authority. Academic stages start with `Academic review` and can add up to five further named stages. `programmeIds` maps programmes to a route. New definitions are immutable versions; already-submitted applications retain their original workflow definition.

Programme-version requirements can include `documentsByCategory`, mapping category codes to additional document-type lists. The draft application stores `answers.applicantCategory`; the UI and upload/submission validation use the same combined checklist.

Deferral requests specify a later published `targetIntakeId` for the same programme and a reason. A decider must cover both source and target intake scopes. Approval ends the current review as Deferred and releases its offered place; it does not reserve a future seat. The applicant starts a separate application for the deferred intake. Staff may also record a direct `defer` decision with a target intake and note. Pending requests are closed when an offer is accepted/declined/expired or an application is withdrawn.

Reopen requires `admissions.decide` and a reason, creates a new workflow at Completeness review, and preserves prior instances and decisions. A competing live application for the same applicant/intake prevents reopening. Staff withdrawal uses a dedicated audited action. Generic workflow endpoints cannot directly set admissions decision/response/withdrawal terminal states on real applications.

Bulk messages accept 1-100 `applicationIds` and a `message`. All scopes are checked within one transaction before any message is recorded. Applicant-visible messages are stored separately from internal notes. Reviewer handoff only lists active staff authorized for the selected application's scope.

### Catalogue (public)

Lists `published` intakes whose application window has not closed. Each entry gives the programme, department and faculty, the entry date (`startsOn`), the window, `applicationsOpen`, capacity, and the requirements of the programme version in force on the entry date.

### Intake publication (`master_data.publish`)

Intakes are created as `draft`, and any client-supplied status is ignored. `draft → published` requires an entry date, an application window that opens before it closes, capacity above zero, a non-retired programme, and a published programme version in force on the entry date. `published → closed` removes the intake from the catalogue. Both moves need a `reason` and are audited.

### Self-registration (public)

`POST /api/admissions/registrations` takes `email`, `preferredName`, and `legalName`, and always returns `202` with the same message (at most 3 per email per hour):

- new email: creates an `applicant` invitation and sends an activation code (stored redacted; in development the full message is written to `data/dev-outbox/`). The applicant finishes with `POST /api/identity/activations` (password policy applies) and receives the `applicant` role and persona;
- existing account: sends an "you already have an account" notice instead.

### Applicant profile (`admissions.apply`)

`PUT` accepts partial updates (`dateOfBirth`, `nationalityCode`, `phone` in E.164, `priorLevelCode`, `studyModeCode`, `address {line1, line2, city, postalCode, countryCode}`). Codes must be active reference values. Responses include `complete` and `missing`, which gate submission.

### Applications (`admissions.apply`, own applications only)

- `POST` with `intakeId` starts a `draft` for an intake that is published and inside its window, pinned to the programme version in force on the entry date. It registers the programme/intake scope for staff access. One live application per applicant per intake (`409`); a withdrawn one can be replaced;
- another applicant's application returns `404`, never `403`;
- `PATCH` (draft only) saves `studyModeCode` (active `study_mode` value) and merges `answers` (an object under 20 KB);
- `GET` returns the application, a `checklist` (each required document type with `missing`/`upload_requested`/`uploaded`/`available`/`verified`/`quarantined` and whether it is satisfied), fee status, and `readiness` (`ready`, `blockers` in plain language);
- `POST .../documents` (draft only, required types or `other`) issues a confidential upload intent through the Phase 1 document pipeline. Documents satisfy the checklist once a scan marks them `available`;
- `POST .../fee` (draft only) verifies a pilot payment reference (`SVU-PAY-...`) or approved waiver code (for example `SVU-WAIVER-2027`) and audits the acknowledgement. This is the ADM-06 bridge until a payment provider ADR is approved;
- `POST .../submit` re-checks readiness and that the intake is still open, assigns `SVU-<entry year>-<000001>`, starts the admissions workflow and moves it to `Submitted`, and queues a receipt. Submitted applications are read-only;
- `POST .../withdraw` (reason required) moves the workflow to `Withdrawn` when one exists;
- while the workflow is at `Information requested`, the applicant may upload more documents and `POST .../respond` with a message, which returns the application to `Completeness review`.

### Review (`admissions.review`, scoped to the reviewer's programme/intake)

- the queue lists active submitted applications the caller's `admissions.review` roles cover, oldest first, with days waiting, assignee, and a `possibleDuplicates` count;
- the detail view adds the applicant profile, checklist and documents, notes, duplicate candidates with reasons, and `allowedTransitions` for the caller. Out-of-scope applications return `403`;
- `assign` (defaults to the caller) only accepts an assignee who can review that programme and intake;
- `notes` take a `category` (`completeness`, `academic`, `general`) and `body` of up to 5000 characters;
- `request-information` needs `workflow.transition` in scope, moves the workflow to `Information requested` (only from completeness or academic review), records a note, and notifies the applicant;
- workflow moves themselves use `POST /api/workflows/instances/{id}/transitions`.

### Decisions and offers

- `POST .../decision` (`admissions.decide`, in scope, application at `Decision`) takes `decision` `offer` or `reject`. Rejections need an active `decision_reason` `reasonCode`. Offers accept optional `conditions` (up to 10) and `offerExpiresInDays` (1-90, default 21). An optional `note` is kept as an academic note;
- offers are serialised per intake with an advisory lock. When offered plus accepted places reach capacity the response is `409` (two concurrent offers for the last seat: exactly one wins);
- letters (`admissions.offer_issued`, `admissions.application_unsuccessful`) are queued, and the applicant view shows `decision` with conditions, deadline, reason, and response;
- `POST .../offer-response` (applicant) takes `accept` or `decline` (optional `reason`). Responding after the deadline expires the offer and returns `409`;
- accepting converts the application in the same transaction: a student record per person (`S<yy><000001>`, reused if the person was already a student), a programme record per application (`pending_onboarding`), the `student` role and persona, a `registry.onboarding` task, and a welcome notice. The response includes `studentNumber`;
- `POST .../convert` (`admissions.decide`) is the idempotent retry/backfill: it returns the existing record with `created: false` and refuses applications that are not `Accepted`;
- `GET .../intakes/{id}/manifest` (`admissions.review`, in scope) gives counts by state, `placesTaken`/`placesRemaining`, the accepted list with student numbers, and `notConverted`;
- `POST /api/admissions/review/offers/expire` (`admissions.decide`) moves every overdue offer to `Expired` and frees its place. It is safe to run on a schedule.
