# Phase 1 Implementation Tickets

These tickets translate the foundation backlog into implementable work. They assume the first code slice will prove the foundation with a mock admissions workflow.

## Epic FND-0: Project Foundation

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-0.1 | Choose runtime stack and scaffold app | ADR-001, ADR-006 | Done for scaffold: Node modular monolith prototype with PostgreSQL, tests, and local run command. |
| FND-0.2 | Add environment configuration pattern | FND-0.1 | In scaffold: runtime config is read from environment with safe defaults. |
| FND-0.3 | Add migration and seed-data framework | FND-0.1, ADR-002 | Done for scaffold: PostgreSQL migration runner, live migration, and seed loader are validated. |
| FND-0.4 | Add health check and structured logging | FND-0.1 | In scaffold: `/api/health` and structured JSON request logs exist. |

## Epic FND-1: Identity and Access

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-1.1 | Create person and user-account schema | FND-0.3 | Person and account records support applicant, student, staff, lecturer, and admin personas. |
| FND-1.2 | Implement invitation and activation flow | FND-1.1 | In scaffold: invitation creates an expiring activation token; activation stores a scrypt password hash and audits completion. |
| FND-1.3 | Implement login/session lifecycle | FND-1.2 | Done for scaffold: login creates expiring sessions; logout revokes active sessions; admins can list account sessions; all actions are audited. |
| FND-1.4 | Implement role and permission schema | FND-1.1 | In scaffold: roles, permissions, role-permission grants, and scoped role assignments can be seeded. |
| FND-1.5 | Enforce permission checks in APIs | FND-1.4 | In scaffold: protected endpoints require bearer sessions, reject users without required permission, and enforce programme/intake scope for scoped resources. |

## Epic FND-2: Audit

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-2.1 | Create audit event schema | FND-0.3 | Audit table supports actor, action, subject, source, reason, timestamp, and before/after refs. |
| FND-2.2 | Emit audit events for identity changes | FND-1.2 | Done for scaffold: invite, activate, login/session creation, login failure, logout, suspension, reactivation, and role changes are audited. |
| FND-2.3 | Build audit query endpoint | FND-1.5, FND-2.1 | Done for scaffold: authorized auditor can query events by actor, subject, action, date range, and limit. |

## Epic FND-3: Workflow and Tasks

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-3.1 | Create workflow definition and instance schema | FND-0.3, FND-2.1 | Done for scaffold: versioned definitions carry states, transitions, initial state, and terminal states; canonical definitions live in `scripts/workflow-definitions.js` and load idempotently (older versions are deactivated, never edited). |
| FND-3.2 | Implement guarded workflow transition service | FND-3.1, FND-1.5 | Done for scaffold: `server/modules/workflow.js` allows only declared transitions, requires a reason, enforces per-transition permissions (`admissions.decide` for decisions), blocks moves out of terminal states, supports `expectedState` concurrency checks, and audits from/to states. |
| FND-3.3 | Create task schema and queue endpoints | FND-3.1 | Done for scaffold: tasks support queue, assignee, priority, due date, status, linked workflow, assignment, handoff, completion, scope checks, and audit events. |
| FND-3.4 | Seed mock admissions workflow | FND-3.2, FND-3.3 | Done for scaffold: admissions v2 follows the roadmap path (Draft → Submitted → Payment verified → Completeness review ⇄ Information requested → Academic review → Decision → Offer issued → Accepted/Declined/Deferred/Expired, Withdrawn from any open state). `demo:phase1` walks it as a scoped officer and proves decision authority. |

## Epic FND-4: Documents and Notifications

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-4.1 | Create document metadata schema | FND-0.3, FND-1.5 | Document record has owner, type, classification, storage key, checksum, version, and lifecycle. |
| FND-4.2 | Implement upload request contract | FND-4.1 | Done for scaffold: `POST /api/documents/upload-requests` validates type/size/classification/file name, issues a randomized private storage key with a 15-minute stub upload intent, and `POST /api/documents/{id}/scan-results` records clean/infected plus file-signature results (mismatch quarantines). Real storage provider waits on ADR-004. |
| FND-4.3 | Create notification template schema | FND-0.3 | Templates can be versioned by channel and code. |
| FND-4.4 | Implement notification preview and send stub | FND-4.3, FND-2.1 | Preview and send actions are audited and provider-neutral. |

## Epic FND-5: Master Data

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-5.1 | Create organization schema | FND-0.3, FND-1.5 | Done for scaffold: faculties/departments can be created, renamed, moved, deactivated, and reactivated through protected APIs with effective-dated `organization_unit_history`, dependency guards, and before/after audit. |
| FND-5.2 | Create programme and version schema | FND-5.1 | Done for scaffold: programmes require an active owning department; versions move draft → published → retired with non-overlapping effective dates, automatic end-dating of the superseded version, as-of resolution, and audit. Maker-checker approval remains open. |
| FND-5.3 | Create intake and academic-period schema | FND-5.2 | Done for scaffold: intakes can be created with windows and audit; academic years and semesters/terms can be created, edited, and moved through planning → published → active → closed → archived with nesting, overlap, and window validation, as-of open-window lookup, and audit (`server/modules/academic-calendar.js`). |
| FND-5.4 | Seed admissions pilot master data | FND-5.1, FND-5.2, FND-5.3 | Pilot faculty, department, programme, intake, roles, and permissions are seeded. |

## Epic FND-6: Exit-Gate Demonstration

| Ticket | Title | Depends On | Done When |
| --- | --- | --- | --- |
| FND-6.1 | Build foundation demo flow | FND-1 through FND-5 | Done for scaffold: `npm.cmd run demo:phase1` proves health, invite, activate, login, session listing, suspension/reactivation, scoped role, protected master-data creation, mock workflow, task assignment/handoff/completion, document metadata, notification stub, and audit events. |
| FND-6.2 | Create backup and restore rehearsal | FND-0.3 | Local full-database rehearsal now verifies snapshot-consistent schema/content in a unique owned target, refuses existing targets and cleans up. Current 193-relation evidence and remaining document/key/provider/production recovery gates are in `DATABASE_RECOVERY.md`; this is not deployment rollback or institutional acceptance. |
| FND-6.3 | Produce Phase 1 sign-off pack | FND-6.1, FND-6.2 | Done for scaffold: `npm run signoff:pack` runs the isolated integration suite and writes `PHASE1_SIGNOFF_PACK.generated.md` (and `SIGNOFF_PACK.generated.json`) mapping each Stage 1 exit gate to evidence, open decisions, and an approvals table. Four gates pass; backup/rollback is partial until a deployment target exists. Awaiting owner approval. |
