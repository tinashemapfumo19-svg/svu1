# Phase 1 Foundation Backlog

## Legend

- `P1`: required for the first admissions pilot.
- `P2`: required before broader module rollout.
- `P3`: desirable hardening once the core foundation is stable.

## Identity and Access

| ID | Priority | Work Item | Inventory Links | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| FND-IAM-01 | P1 | Define unified person and user-account model | IAM-01, IAM-02, IAM-09, REG-04, STF-01 | Applicants, students, staff, lecturers, and admins can share one identity model while keeping persona-specific records. |
| FND-IAM-02 | P1 | Implement invitation and account activation contract | IAM-02, IAM-03, IAM-18 | Accounts use expiring activation tokens; no reusable temporary passwords are exposed. |
| FND-IAM-03 | P1 | Define password recovery and MFA policy | IAM-04, IAM-11 | Recovery uses time-limited tokens; MFA is required for privileged roles. |
| FND-IAM-04 | P1 | Define session and device lifecycle | IAM-06, IAM-07 | Login, logout, device, failed attempt, and forced session termination events are audited. |
| FND-IAM-05 | P1 | Replace access levels with role and permission catalogue | IAM-05, IAM-12 | Permissions separate view, create, review, approve, publish, export, and administer actions. |

## Audit, Workflow, and Tasks

| ID | Priority | Work Item | Inventory Links | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| FND-AUD-01 | P1 | Define append-only audit event schema | IAM-07, IAM-08, OPS-10 | Every sensitive event records actor, subject, source, reason, timestamp, and before/after references. |
| FND-WFL-01 | P1 | Define reusable state-machine pattern | ADM-10, ADM-14, REG-09, FIN-12, EXM-14 | Workflow transitions require permission, reason where needed, and audit output. |
| FND-TSK-01 | P1 | Define task queue and assignment model | ADM-10, ADM-11, COM-06 | Tasks have owner, due date, priority, status, hand-off history, and escalation state. |
| FND-EXC-01 | P2 | Define approved exception pattern | REG-12, FIN-12, EXM-15 | Overrides are time-bound, reasoned, evidence-backed, permissioned, and auditable. |

## Documents, Notifications, and Search

| ID | Priority | Work Item | Inventory Links | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| FND-DOC-01 | P1 | Define private document metadata model | ADM-07, RPT-02, RPT-12, OPS-05 | Documents have owner, classification, type, lifecycle status, version, retention, and access policy. |
| FND-DOC-02 | P1 | Define upload safety controls | ADM-07, OPS-05, OPS-07 | Upload contract includes size limits, file signatures, malware scan status, and randomized storage key. |
| FND-NOT-01 | P1 | Define notification templates and delivery status | COM-01, COM-02, COM-03, COM-04, COM-05 | Email, SMS, and in-app messages use templates, audience preview, delivery status, retry, and audit events. |
| FND-SRC-01 | P2 | Define authorization-aware search contract | RPT-12, REG-10 | Search results are filtered by role, organizational scope, and document classification. |

## Master Data

| ID | Priority | Work Item | Inventory Links | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| FND-MST-01 | P1 | Define organization model | ACA-01, ACA-02, ACA-03, STF-03 | Faculties, departments, and ownership changes are effective-dated. |
| FND-MST-02 | P1 | Define programme and intake model | ACA-04, ACA-05, ACA-09, ACA-10, ADM-05 | Programmes and intakes have status, capacity, dates, requirements, and publish controls. |
| FND-MST-03 | P1 | Define academic period model | ACA-11, ACA-12, ACA-15 | Academic years, terms, registration windows, teaching windows, assessment periods, and archive states are explicit. |
| FND-MST-04 | P2 | Define curriculum and course catalogue model | ACA-07, ACA-08 | Curricula are versioned with courses, credits, prerequisites, levels, and term placement. |
| FND-MST-05 | P2 | Define grading and GPA rule model | ACA-13, EXM-11, EXM-20 | Rules are effective-dated, approved, and testable against samples. |

## Engineering and Operations

| ID | Priority | Work Item | Inventory Links | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| FND-OPS-01 | P1 | Define environment and secret-management approach | OPS-01, OPS-02, OPS-04 | Runtime config is outside source; secrets are rotatable. |
| FND-OPS-02 | P1 | Define migration and seed-data approach | OPS-03 | Schema and reference data can be recreated repeatably. |
| FND-OPS-03 | P1 | Define deployment, rollback, and health-check approach | OPS-11 | Environments support deploy, verify, rollback, and health monitoring. |
| FND-OPS-04 | P1 | Define backup and restore procedure | OPS-08 | A restore exercise is documented and repeatable. |
| FND-SEC-01 | P1 | Contain legacy security-hold items | IAM-10, IAM-11, OPS-06, OPS-07, OPS-12 | Diagnostics, dumps, test mailers, and suspicious includes are not exposed by the rebuild artifact. |
