# Phase 1 Decision Register

## Status Legend

- `Proposed`: recommended, awaiting owner/technical approval.
- `Open`: requires input before implementation.
- `Accepted`: approved direction.
- `Deferred`: intentionally postponed.

| ID | Decision | Recommendation | Status | Owner Needed | Blocks |
| --- | --- | --- | --- | --- | --- |
| ADR-001 | Application architecture | Modular monolith with clear internal modules | Proposed | IT/Product | Backend scaffold, deployment, testing |
| ADR-002 | Primary database | PostgreSQL with SQL migrations and seed data | Accepted | IT/DBA | Domain schema, migration pipeline |
| ADR-003 | Identity provider | Build foundation-compatible identity now; allow future external IdP integration | Open | IT/Security | Account activation, MFA, recovery |
| ADR-004 | Document storage | Private object/file storage with DB metadata and short-lived access URLs | Proposed | IT/Security | Upload workflow, application documents |
| ADR-005 | Notification providers | Provider-agnostic email/SMS adapters, in-app inbox first | Proposed | IT/Comms | Admissions receipts, password recovery |
| ADR-006 | Runtime stack | Dependency-free Node scaffold for Phase 1 prototype; final production stack still requires approval | Proposed | IT | Production scaffold and CI |
| ADR-007 | Hosting model | Confirm on-prem, cloud, or hybrid constraints | Open | Management/IT | Deployment, backups, monitoring |
| ADR-008 | LMS boundary | Integrate a dedicated LMS (roadmap Option B). SVU remains the source of truth for users, course offerings, teaching allocations, enrolments and official results; the LMS receives a versioned provisioning manifest and returns course outcomes that pass reconciliation, independent review and the official results controls. Product selection (for example Moodle) remains open | Accepted (2026-10-04, project owner) | Academic/IT | Stage 6 provisioning manifest and outcome return |
| ADR-009 | Accounting boundary | Keep Phase 1 finance-neutral; decide before Stage 4 | Deferred | Finance/IT | Ledger integration |
| ADR-010 | Legacy archive exposure | Legacy archive remains non-deployable read-only reference | Proposed | IT/Security | Security containment |
| ADR-011 | Audit retention | Define retention by legal and institutional policy | Open | Management/Legal | Audit storage, archive policy |
| ADR-012 | Sensitive profile fields | Restrict disability, medical, and protected data with field-level policy | Proposed | Registry/Legal | Student profile model |

## Immediate Approval Questions

1. Who owns final approval for role templates and privileged access?
2. What deployment environment should Phase 1 target first?
3. Will SVU operate its own identity service or use an existing institutional identity provider?
4. Where should private documents be stored?
5. Which email and SMS providers are approved for production?
6. What retention policy applies to audit events, application documents, and official messages?
