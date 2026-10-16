# Phase 1: Platform Foundation and Master Data

## Objective

Create the reusable platform capabilities that every later SVU module depends on: identity, authorization, audit, workflow, tasks, notifications, documents, search, master data, migrations, environments, and operational controls.

This phase corresponds to Stage 1 in `docs/COMPREHENSIVE_REBUILD_ROADMAP.md`.

## Scope

Phase 1 covers:

- unified identity for applicants, students, staff, lecturers, and administrators;
- account activation, recovery, MFA, session/device management, suspension, and lifecycle history;
- granular roles, permissions, organizational scope, and approval limits;
- append-only audit events;
- reusable workflow/state-machine pattern;
- task queues, assignment, hand-off, deadlines, and escalation;
- email, SMS, and in-app notification templates with delivery status;
- private document storage model with metadata, retention, access policy, and malware-scan hooks;
- authorization-aware search model;
- academic master data for faculties, departments, programmes, curricula, courses, intakes, periods, grading, GPA rules, countries, currencies, disability lists, and other controlled references;
- migration, reconciliation, deployment, backup, logging, metrics, health checks, and rollback foundations.

## Out of Scope

Phase 1 does not implement complete admissions, registry, finance, teaching, examination, or reporting workflows. It creates the common services and contracts those modules will use.

## Work Products

- `FOUNDATION_BACKLOG.md`: build backlog linked to inventory IDs.
- `ROLE_PERMISSION_MATRIX.md`: initial least-privilege role model.
- `DOMAIN_MODEL.md`: first-pass entities and relationships.
- `API_CONTRACTS.md`: initial API surface and conventions.
- `MASTER_DATA_CATALOG.md`: controlled reference data required by phase 1 and admissions.
- `MIGRATION_AND_CONTROLS.md`: reconciliation, audit, and cutover controls.
- `ARCHITECTURE_BLUEPRINT.md`: recommended modular architecture and first vertical slice.
- `DECISION_REGISTER.md`: open and proposed architecture/product decisions.
- `IMPLEMENTATION_TICKETS.md`: build-ready ticket breakdown for Phase 1.
- `EXIT_GATE_EVIDENCE.generated.json`: latest generated evidence from the local Phase 1 demo run.
- `BACKUP_RESTORE_EVIDENCE.generated.json`: latest generated evidence from the local Postgres restore rehearsal.

Run the repeatable exit-gate demo against the local server with:

```powershell
npm.cmd run demo:phase1
```

The command proves health, admin login, invite, activation, bearer login, scoped role assignment, workflow transition, document metadata, notification stub, and audit evidence.

Run the backup/restore rehearsal with:

```powershell
npm.cmd run backup:rehearse
```

The command reads the configured development database, restores a snapshot-consistent custom archive into a unique `svu_restore_` database, verifies schema and full relation-content digests and removes only its owned target. An existing target is refused, never dropped. See [database recovery](DATABASE_RECOVERY.md) for controls, current evidence and remaining document/key/provider/production recovery gates. Historical foundation evidence is preserved in `BACKUP_RESTORE_EVIDENCE.2026-10-01.json`.

## Exit Gate

Phase 1 is ready to support admissions when:

- a user can be invited, authenticated, authorized, suspended, and audited;
- roles and permissions can be assigned with scope and history;
- master data changes are effective-dated and protected by permission;
- workflows, tasks, notifications, and documents are reusable by admissions;
- database schema and seed data can be recreated from version-controlled automation;
- backup restoration and rollback have been demonstrated in a non-production environment.
