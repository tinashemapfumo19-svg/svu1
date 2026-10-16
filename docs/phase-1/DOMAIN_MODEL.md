# Phase 1 Domain Model

## Identity and Organization

| Entity | Purpose | Important Fields |
| --- | --- | --- |
| Person | Real individual shared by applicants, students, staff, and users | legal names, preferred name, birth date, contact channels, identifiers, privacy flags |
| UserAccount | Login account linked to a person | username/email, status, password hash reference, MFA state, recovery state, last login |
| Persona | Context-specific role identity | applicant, student, staff, lecturer, administrator |
| Role | Named permission bundle | code, name, description, risk level, active state |
| Permission | Action on a resource | resource, verb, constraints |
| RoleAssignment | Role granted to user/persona | role, subject, organizational scope, effective dates, granted by, reason |
| OrganizationUnit | Faculty, department, office, or service unit | type, parent, code, name, status, effective dates |

## Audit, Workflow, and Tasks

| Entity | Purpose | Important Fields |
| --- | --- | --- |
| AuditEvent | Append-only record of sensitive action | actor, action, subject, source, reason, occurred at, correlation id, before/after refs |
| WorkflowDefinition | Reusable state machine | code, version, states, transitions, guards |
| WorkflowInstance | A case moving through a workflow | definition, subject, state, owner, due date, status |
| WorkflowTransition | Attempted or completed state change | from state, to state, actor, reason, validation result |
| Task | Work item for people or queues | queue, assignee, priority, due date, status, linked workflow |
| CaseComment | Internal or user-visible discussion | author, body, visibility, linked case |
| ExceptionApproval | Time-bound exception to policy | type, subject, evidence, approver, expiry, status |

## Documents and Notifications

| Entity | Purpose | Important Fields |
| --- | --- | --- |
| Document | Metadata for private stored file | owner, type, classification, storage key, checksum, version, lifecycle |
| DocumentReview | Verification or rejection of a document | reviewer, status, reason, notes, reviewed at |
| DocumentAccessPolicy | Who can view/download/manage a document | subject type, scope, allowed actions |
| NotificationTemplate | Approved message template | channel, code, subject, body, variables, locale, version |
| Notification | Message instance | recipient, channel, template, payload, status, delivery provider |
| DeliveryAttempt | Provider send attempt | provider ref, status, error, attempted at |

## Master Data

| Entity | Purpose | Important Fields |
| --- | --- | --- |
| Programme | Academic programme/award | code, name, faculty, department, award type, level, status |
| ProgrammeVersion | Effective-dated programme rules | programme, version, effective dates, requirements, owner |
| Intake | Admissions/registration intake | month/year, programme, capacity, application window, status |
| AcademicPeriod | Academic year, term, semester, or assessment window | type, start/end, lifecycle status, registration dates, teaching dates |
| Course | Subject/course catalogue item | code, title, credits, level, status |
| CurriculumVersion | Programme course structure | programme version, course requirements, term placement, prerequisites |
| GradingScheme | Grade/classification rules | version, mark ranges, labels, effective dates |
| GpaRuleSet | GPA calculation policy | weighting, repeats, rounding, exclusions, effective dates |
| ReferenceValue | Controlled list item | list code, value code, label, status, effective dates |

## Core Relationship Rules

- One `Person` may have multiple personas, but identity merges require an audited duplicate-resolution workflow.
- A `UserAccount` belongs to one `Person`; shared accounts are prohibited.
- `RoleAssignment` always has effective dates, grant history, and optional organization/programme scope.
- Business workflows should reference `WorkflowInstance` instead of storing only numeric status flags.
- Documents are never served from public upload paths; application routes enforce access policy.
- Master data is versioned or effective-dated when it can affect historical academic, financial, or admissions decisions.
