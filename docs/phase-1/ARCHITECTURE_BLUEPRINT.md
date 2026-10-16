# Phase 1 Architecture Blueprint

## Recommended Starting Shape

Use a modular monolith for the first production system unless Stage 0 evidence proves a need for separately deployed services.

Reasoning:

- Admissions, registry, finance, teaching, and examinations share transactional student, programme, document, and audit data.
- SVU needs reliable workflow and reconciliation more urgently than service-level distribution.
- A modular monolith is easier to deploy, back up, observe, and support with a small team.
- Clear internal modules still allow future service extraction.

## Modules

| Module | Owns | Depends On |
| --- | --- | --- |
| Identity | persons, user accounts, sessions, recovery, MFA | Audit, Notifications |
| Access Control | roles, permissions, scoped assignments | Identity, Audit |
| Audit | append-only platform and business events | Identity for actor references |
| Workflow | definitions, instances, transitions | Identity, Access Control, Audit |
| Tasks | queues, assignments, hand-offs, escalation | Workflow, Notifications |
| Documents | metadata, storage keys, review, retention, access policy | Identity, Access Control, Audit |
| Notifications | templates, recipients, delivery attempts | Identity, Audit |
| Master Data | faculties, departments, programmes, periods, intakes, reference lists | Access Control, Audit |
| Admissions | applications, checklists, reviews, decisions, offers | All foundation modules |

## Boundary Rules

- Other modules do not write directly to identity tables. They call identity services.
- Business modules do not mutate audit events.
- Documents are accessed through document APIs, never public filesystem paths.
- Workflow state changes go through transition guards and emit audit events.
- Master data that affects decisions is versioned or effective-dated.
- Exports are permissioned, logged, and attributable to a user and reason.

## Suggested Data Store

Use a relational database for canonical platform data.

Phase 1 needs:

- transactions for account activation, workflow transitions, and master-data publication;
- relational integrity across persons, roles, organizations, programmes, periods, tasks, and documents;
- migration and seed-data repeatability;
- reportable audit and reconciliation evidence.

Document binaries should live outside the relational database in private object storage or an equivalent private file service. The database stores metadata, access policy, checksum, lifecycle, and storage key.

## Deployment Shape

Initial environments:

- `dev`: local and disposable developer environment.
- `test`: automated tests and migration verification.
- `staging`: production-like acceptance and migration rehearsal.
- `production`: controlled release only after backup/restore and rollback are demonstrated.

Every environment needs:

- runtime config outside source;
- secrets outside source;
- database migrations;
- seed/reference data;
- health check endpoint;
- structured logs;
- backup and restore procedure.

## Observability

Minimum Phase 1 signals:

- login success/failure counts;
- account activation and recovery attempts;
- role assignment changes;
- workflow transition success/failure;
- task age and overdue counts;
- document upload/review/download events;
- notification delivery/failure/retry counts;
- migration import/rejection totals;
- health check status;
- backup and restore verification status.

## Security Baseline

- MFA for privileged roles.
- Passwords hashed with a modern adaptive algorithm.
- Session rotation on login and privilege changes.
- CSRF protection for browser mutations.
- Server-side authorization on every resource.
- Upload scanning and file signature checks.
- Least-privilege service accounts.
- No legacy diagnostics, dumps, test mailers, or upload directories in deployable artifacts.

## First Implementable Vertical Slice

The first code slice should prove the foundation without building full admissions:

1. Seed faculties, departments, programmes, intakes, roles, and permissions.
2. Invite an admissions officer.
3. Activate the account.
4. Assign the admissions role with programme/intake scope.
5. Create a workflow instance for a mock application.
6. Assign a task to the officer.
7. Upload a mock document metadata record.
8. Transition the workflow from `Submitted` to `Completeness review`.
9. Emit audit events for every mutation.
10. Show the user and task in the UI.

This demonstrates the Phase 1 exit path without pretending the full admissions module is complete.
