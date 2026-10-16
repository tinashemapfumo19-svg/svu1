# SVU Comprehensive Rebuild Roadmap

## Purpose

This roadmap replaces the preliminary rebuild plan. It is driven by the source-derived feature catalogue in [`LEGACY_FUNCTIONALITY_INVENTORY.md`](LEGACY_FUNCTIONALITY_INVENTORY.md) and provides a staged route from the current PHP application to a secure, maintainable university platform.

The roadmap preserves necessary outcomes rather than reproducing legacy pages. Each legacy capability must map to a rebuilt feature, supported integration, or approved retirement decision.

## Programme objectives

The rebuilt platform should:

- provide one authoritative applicant, student, staff, programme, and financial identity;
- make every workflow state, owner, next action, exception, and decision visible;
- separate authentication, permissions, business rules, data, documents, and presentation;
- support mobile student journeys and efficient staff work queues;
- preserve complete academic, financial, and audit history;
- integrate through versioned APIs and managed events;
- use supported dependencies, automated tests, migrations, deployments, backups, and monitoring;
- permit controlled module-by-module replacement of the legacy system.

## Scope model

### Core replacement scope

The source confirms these as core university-system domains:

- identity, authorization, and audit;
- admissions and applicant management;
- academic structure, programmes, curriculum, intakes, and periods;
- student onboarding, registry, registration, and progression;
- fees, invoices, payments, and financial clearance;
- staff/lecturer profiles and teaching allocation;
- teaching resources, assignments, submissions, marking, feedback, course chatrooms, and online classroom delivery;
- examinations, results, GPA calculation, progression decisions, transcripts, and certificates;
- notifications, support, document repository, official documents, and institutional reporting;
- prospective-student engagement through an official SVU WhatsApp chatbot;
- library/resource access and selected integrations.

### Decision scope

These capabilities appear in local custom code or external links but are not proven as part of the operational core:

- full HR and leave management;
- staff transfers and promotions;
- asset and stock management;
- general accounting and bank reconciliation;
- fleet management;
- parent accounts;
- health records beyond essential student onboarding;
- sports, clubs, awards, and extracurricular records;
- website/CMS migration;
- full LMS capabilities beyond the approved SVU learning scope, such as quizzes, attendance, plagiarism checking, or advanced LMS analytics.

They must receive an explicit build, integrate, defer, or retire decision during Stage 0. They must not silently expand the initial release.

## Roadmap overview

| Stage | Delivery focus | Primary inventory coverage | Result |
| --- | --- | --- | --- |
| 0 | Governance, discovery, containment | All, especially `OPS-*`, `EXT-*` | Approved scope and protected legacy service |
| 1 | Platform foundation and master data | `IAM-*`, `OPS-*`, `ACA-01`–`ACA-15`, shared `COM-*`/`RPT-*` foundations | Secure reusable platform |
| 2 | Admissions and applicant portal | `ADM-*`, relevant `ACA-*`, `COM-01`–`COM-03` | First complete modern business workflow |
| 3 | Student record, onboarding, registration, and progression | `REG-*`, relevant `RPT-*` | Authoritative student registry |
| 4 | Student finance | `FIN-01`–`FIN-15` | Auditable ledger, payments, and clearance |
| 5 | Staff, lecturer, and teaching allocation | `STF-01`–`STF-09`, relevant `ACA-*` | Period-specific accountable teaching assignments |
| 6 | Teaching, learning, assignments, and library | `LMS-*`, `LIB-*`, relevant `COM-*` | Modern learning-delivery workflow or LMS integration |
| 7 | Examinations, results, progression, and graduation | `EXM-*`, official `RPT-*` | Controlled assessment-to-award lifecycle |
| 8 | Reporting, documents, communications, support, and integrations | `RPT-*`, `COM-*`, cross-domain integrations | Governed institutional outputs and service operations |
| 9 | Peripheral decisions, final migration, and legacy retirement | `EXT-*`, `OPS-*`, CMS scope | Controlled closure and protected archive |

Stages describe dependency order. After Stage 1, selected teams can work in parallel where data ownership and integration contracts are stable.

## Stage 0: Governance, discovery, and containment

### Objectives

- Establish the real production scope and owners.
- Protect the current service and data during the rebuild.
- Convert code-derived assumptions into approved requirements.

### Work packages

#### 0.1 Governance

- Appoint a product owner and business owner for admissions, registry, finance, academics, examinations, IT, and student support.
- Establish architecture, data, security, and change-control decision forums.
- Define how scope, policy, and exceptions are approved.
- Adopt the feature IDs in the inventory as the traceability baseline.

#### 0.2 Production discovery

- Identify deployed entry points, scheduled jobs, external databases, and actual active file versions.
- Obtain a sanitized production schema and aggregate record counts.
- Trace all `hrms`, `web`, `tips`, library, payment, email, SMS, and other external routes.
- Catalogue all operational reports, PDFs, imports, exports, spreadsheets, and manual workarounds.
- Interview users and observe real workflows rather than relying only on code.

#### 0.3 Security containment

- Rotate all database, email, and administrator credentials exposed in source or backups.
- Investigate the obfuscated include in `sf/index.php` and scan the deployable codebase.
- Remove public access to dumps, diagnostics, test-mail pages, old copies, and upload directories.
- Restrict legacy network access and administrative endpoints.
- Establish verified backups and perform a recovery exercise.

#### 0.4 Scope decisions

- Decide built-in learning module versus dedicated LMS integration, while preserving SVU-owned requirements for course chatrooms, video-enabled classrooms, document repository access, and official academic outcomes.
- Decide HR, accounting, asset, parent, health, extracurricular, fleet, CMS, and chat boundaries.
- Decide the WhatsApp Business provider, phone-number ownership, chatbot governance model, AI safety limits, and human hand-off ownership for prospective-student conversations.
- Mark every `EXT-*` item as integrate, later phase, or retire.
- Identify legally required records, retention periods, consent, and data-access constraints.

### Deliverables

- Approved current-state workflows
- Production system and integration diagram
- Role and access-level mapping
- Report/document catalogue
- Data dictionary and initial data-quality report
- Security containment report
- Feature traceability matrix with named owners
- Approved first-release scope

### Exit gate

Stage 0 is complete only when no core production integration or authoritative data source remains unknown, immediate critical security findings are contained, and business owners have approved the inventory classifications.

## Stage 1: Platform foundation and master data

### Objectives

- Create shared capabilities once and use them consistently across every module.
- Establish authoritative institutional reference data.

### Functional foundation

- Unified identity for applicants, students, staff, and privileged administrators
- Secure activation, recovery, MFA, session/device management, and account lifecycle
- Granular roles, permissions, organizational scope, and approval limits
- Append-only audit events with actor, subject, reason, before/after references, time, and source
- Workflow engine or explicit state-machine pattern
- Task queues, assignments, hand-offs, deadlines, and escalation
- Email, SMS, and in-app notification service with templates and delivery status
- Private document storage with metadata, malware scanning, retention, and access policy
- Search service with authorization-aware results
- Export logging and sensitive-data controls

### Academic master data

- Faculties, departments, and organizational ownership
- Programmes, awards, levels, modes, campuses, and status
- Versioned curricula, course/subject catalogue, credits, prerequisites, and term placement
- Academic years, terms, intakes, application windows, and registration windows
- Grading schemes, classification rules, and effective dates
- Semester lifecycle configuration for learning delivery, registration, assessment windows, result periods, and archival cut-offs
- GPA rule sets, including credit weighting, repeat/retake treatment, rounding, exclusions, and effective dates
- Reference data for country, currency, disability, and other controlled lists

### Engineering foundation

- Supported runtime and dependency management
- Versioned database migrations and seed/reference data
- Separate development, test, staging, and production environments
- Continuous integration, automated tests, deployment, and rollback
- Centralized logs, metrics, tracing, health checks, and alerting
- Encryption in transit and at rest, secret management, and rotation
- API conventions, idempotency, validation, pagination, and error handling
- Backup, restore, disaster-recovery, and retention automation

### Architecture recommendation

Start with a modular monolith unless scale or team boundaries prove a need for independent services. Use clear modules and internal contracts for identity, admissions, registry, finance, teaching, assessment, documents, notifications, and reporting. This provides transactional consistency and simpler operations while keeping future extraction possible.

### Exit gate

- A user can be invited, authenticated, authorized, suspended, and audited securely.
- Master data changes are effective-dated and protected by permission.
- Workflows, documents, and notifications are reusable by business modules.
- Environments and schema can be recreated from version-controlled automation.
- Backup restoration and deployment rollback have been demonstrated.

## Stage 2: Admissions and applicant portal

### Scope

Implement `ADM-01` through `ADM-18` and the required portions of `ACA-*`, `IAM-*`, `COM-*`, and `RPT-*`.

### Applicant experience

- Account creation and secure activation
- Reusable personal profile
- Programme/intake catalogue with requirements and availability
- Save-and-resume application
- Dynamic document checklist by programme and applicant category
- Application-fee payment, code, waiver, or exemption status
- Submission validation and receipt
- Status timeline, outstanding actions, messages, withdrawal, and deferral request

### Staff workflow

- Configurable undergraduate/postgraduate review paths
- Unassigned and assigned review queues
- Document verification checklist
- Duplicate-applicant detection
- Academic assessment and internal comments
- Request for additional information
- Conditional offer, offer, rejection, withdrawal, and deferral decisions
- Decision authority and escalation
- Bulk and individual communication
- Capacity/vacancy monitoring

### Target workflow

```text
Draft
  -> Submitted
  -> Payment verified or waived
  -> Completeness review
  -> Academic review
  -> Decision
  -> Offer issued
  -> Accepted, declined, deferred, withdrawn, or expired
  -> Student onboarding initiated exactly once
```

### Migration wave

- Current programme/intake/vacancy catalogue
- Open applications and documents
- Historical applications required for reporting or future reapplication
- Decision reasons and communication history where reliable

### Exit gate

- Every application has a state, owner, next action, history, and decision authority.
- Submitted applications and uploaded documents reconcile with source control totals.
- Accepted applicants convert exactly once without duplicate student records.
- Admissions can complete a pilot intake without legacy writes for the selected scope.

## Stage 3: Student record, onboarding, registration, and progression

### Scope

Implement `REG-01` through `REG-17` and required academic/reporting capabilities.

### Student record

- Stable institutional student identifier
- Person and verified contact details
- Programme enrolment and effective-dated status history
- Intake, mode, campus, curriculum version, and expected completion
- Protected next-of-kin, disability/accommodation, and approved health-related fields
- Identity merge and duplicate-resolution workflow

### Registration

```text
Confirm identity and profile
  -> Verify programme/enrolment status
  -> Determine academic eligibility
  -> Determine financial eligibility
  -> Select or confirm courses
  -> Validate curriculum, prerequisites, repeats, credit limits, and clashes
  -> Resolve exceptions
  -> Confirm registration
  -> Issue registration confirmation and class enrolments
```

### Progression and exceptions

- Explainable progression rules and outcomes
- Repeat, retake, exemption, credit transfer, programme transfer, and re-entry
- Deferral, interruption, withdrawal, suspension, and completion
- Approved exceptions with reason, evidence, authority, expiry, and history
- Learning-semester management for period setup, opening/closing, registration windows, teaching windows, assessment windows, and archive status
- No direct overwriting of historical programme or academic state

### Migration wave

- Student identities and profiles
- Registration numbers and application linkage
- Programme enrolments and registration history
- Current year/level and progression state
- Next-of-kin and sensitive profile data under approved policy
- Exception and suspension records where evidence exists

### Exit gate

- Registry approves the student record as authoritative for the pilot cohort.
- Registration decisions are repeatable and explainable.
- Semester periods can be opened, closed, audited, and linked to enrolment, teaching, assessment, and reporting workflows.
- Historical enrolment and current status reconcile to agreed totals.
- Exceptions no longer require silent database updates.

## Stage 4: Student finance

### Scope

Implement `FIN-01` through `FIN-15`. Handle `FIN-16` only after the accounting boundary is approved.

### Financial model

- Effective-dated fee and charge schedules
- Student subledger for charges, payments, allocations, credits, adjustments, refunds, and write-offs
- Invoice lifecycle and billing runs by intake/period
- Scholarships, sponsorships, waivers, discounts, and payment plans
- Financial holds and clearance policies
- Currency and exchange handling if required

### Payment workflow

```text
Receive provider/bank/cash reference
  -> Validate source and amount
  -> Match to student/account
  -> Allocate to charge(s)
  -> Route unmatched or ambiguous items to work queue
  -> Approve exceptional adjustment/refund
  -> Issue receipt and update statement
  -> Recalculate financial eligibility
```

### Integrations

- Mobile-money and online payment providers
- Bank statement/import feeds
- Accounting/ERP summary or transaction interface
- Notification and receipt service

### Migration wave

- Approved opening balances
- Open invoices and unapplied payments
- Required transaction history
- Sponsors, scholarships, waivers, and payment arrangements
- Control totals by period, programme, and transaction type

### Exit gate

- Migrated opening balances reconcile to finance-approved control totals.
- Every balance-changing action is an auditable transaction.
- Payments trace from external reference through allocation and receipt.
- Financial holds and clearances provide an understandable reason.
- Finance signs off a period-end reconciliation in the new system.

## Stage 5: Staff, lecturer, and teaching allocation

### Scope

Implement `STF-01` through `STF-09` and the course-offering portion of `ACA-*`.

### Staff and lecturer onboarding

```text
Create/import person
  -> Verify employment and department
  -> Assign employment category and supervisor
  -> Invite account
  -> Assign lecturer and administrative roles
  -> Apply organizational scope
  -> Activate or suspend with history
```

### Course offerings and allocations

- Create course offerings from curriculum, period, cohort, campus, and delivery mode
- Assign lead lecturer, co-lecturer, tutor, moderator, or examiner
- Record workload units and allocation dates
- Route allocations for department/faculty approval when required
- Generate class lists from authoritative registrations
- Reassign, substitute, or close allocations without deleting history
- Detect missing lecturer coverage and conflicting allocations

### Migration wave

- Active staff identities and employment data
- Department, category, and supervisor relationships
- Current staff accounts and approved roles
- Active lecturer-subject allocations translated into period-specific offerings
- Historical allocation data where meaningful

### Exit gate

- Every active course offering has accountable teaching staff and a class list.
- Permissions derive from approved roles and allocations.
- Allocation changes are specific, authorized, effective-dated, and auditable.
- Academic managers can see uncovered courses and lecturer workload.

## Stage 6: Teaching, learning, assignments, and library

### Scope

Implement `LMS-01` through `LMS-17` and `LIB-01` through `LIB-06`. Resolve the broader `LMS-15` feature set through the approved LMS decision while treating course chatrooms and online classroom delivery as required SVU learning capabilities.

### Option A: bounded built-in module

Build course workspaces, resources, announcements, assignments, submission attempts, feedback, gradebook, chatrooms, online classroom scheduling, and notifications. Integrate specialized capabilities such as plagiarism and video meeting infrastructure where needed.

### Option B: dedicated LMS integration

Use the SVU platform as the source for users, course offerings, enrolments, and official outcomes. Synchronize those records to a supported LMS and return approved grades or completion data through versioned APIs/events.

### Required interaction capabilities

- Course chatrooms for lecturer-to-student and student-to-student communication
- Role-aware moderation, message retention, search, reporting, and audit controls
- Scheduled live video classes tied to course offerings and semester calendars
- Attendance/participation capture where required by academic policy
- Recording, transcript, and playback rules governed by consent and retention policy
- Low-bandwidth and mobile access for students

### Required workflow regardless of option

```text
Approved course offering and enrolments
  -> Course workspace provisioned
  -> Chatroom and online classroom space provisioned
  -> Resources/assignment published
  -> Students notified
  -> Submission attempt received and acknowledged
  -> Marking and feedback
  -> Moderation where required
  -> Feedback/mark released
  -> Approved outcome transferred to official assessment record
```

### Required controls

- Immutable submission attempts and receipts
- Availability, due date, extension, late, and resubmission rules
- Safe document storage and content scanning
- Repository integration for read-only viewing, controlled download, and document search
- Grade release separated from draft marking
- Accessibility and low-bandwidth operation
- Moderation, retention, and acceptable-use controls for chat and video classroom activity
- Course archive and retention
- Clear ownership between LMS marks and official university results

### Migration wave

- Current tutorials and published learning materials
- Existing library/repository documents and metadata
- Open assignments and due dates
- Student submissions and returned feedback files
- Legacy chat assets only if business owners require preservation
- Recorded marks required for official outcomes
- Library metadata and active resources

### Exit gate

- Students can access the right course resources based on registration.
- Students and lecturers can communicate through authorized course chatrooms and scheduled online classes.
- A submission is never lost or silently overwritten.
- Lecturers can identify missing work, mark, moderate, and release feedback.
- Official outcomes synchronize exactly once with complete provenance.

## Stage 7: Examinations, results, progression, and graduation

### Scope

Implement `EXM-01` through `EXM-20` and official-document capabilities from `RPT-*`.

### Examination cycle

- Assessment/exam configuration and contribution rules
- Examination ordering and authorization
- Candidate generation from registrations
- Sitting, attempt, retake, deferment, and supplementary handling
- Structured timetable/schedule with downloadable publication
- Mark entry and validated bulk import
- Missing-mark and anomaly work queues
- Moderation and approval
- Controlled publication and student notification

### Result workflow

```text
Assessment configured
  -> Marks entered/imported
  -> Automated validation
  -> Lecturer submission
  -> Department review
  -> Faculty moderation/approval
  -> Final authorized approval
  -> Publication batch
  -> Progression/graduation decision
  -> Controlled amendment when necessary
```

### Progression and graduation

- Versioned grading and classification rules
- Versioned GPA algorithms with credit weighting, repeat/retake handling, exclusions, rounding, and effective dates
- Explainable semester and final progression decisions
- Graduation audit against curriculum and institutional requirements
- Award approval record
- Transcript, completion letter, and degree-certificate issuance
- Amendment/revocation/reissue workflow

### Migration wave

- Assessment definitions and examination orders
- Exam schedules
- All official marks, grades, attempts, publication states, and decisions
- GPA calculation baselines and approved legacy samples
- Degree/completion records
- Document issuance history where available

### Exit gate

- Imported and calculated grades match approved legacy samples and totals.
- GPA outputs are explainable, policy-versioned, and reconciled against approved sample students.
- Every published result has validation, approval, and publication history.
- Amendments preserve original and revised values with authority and reason.
- Graduation audit, degree certificates, and official documents are approved by academic authorities.

## Stage 8: Reporting, documents, communications, support, and integrations

Many of these foundations begin in Stage 1 and are delivered incrementally with each module. Stage 8 completes cross-domain institutional capability.

### Reporting

- Institutional metric dictionary with owner, formula, filters, and refresh policy
- Operational dashboards for pending work, exceptions, and service levels
- Management dashboards for admissions, enrolment, finance, progression, retention, results, and graduation
- Statutory/regulatory outputs
- Scheduled reports and permission-aware exports
- Reconciliation reports between source, migration, and target

### Documents

- Managed document repository for institutional, applicant, student, course, library, and official records
- Secure upload with metadata, document type, owner, lifecycle status, and malware scanning
- Read-only browser viewing for supported formats without exposing private storage paths
- Controlled download permissions, watermarks where appropriate, and download history
- Authorization-aware document search across metadata and extracted text
- Versioning, retention, legal hold, archive, and disposal rules
- Versioned templates and approval workflow
- Unique document/reference numbers
- QR or reference-based authenticity verification with minimal public disclosure
- Issuance, reissue, revocation, download, and access history
- Accessible and print-consistent output

### Communications and support

- Email, SMS, and in-app templates
- Official SVU WhatsApp Business number and chatbot channel for prospective students
- AI-assisted programme guidance using approved programme, admissions, fees, and intake knowledge sources
- Lead capture, application links, human hand-off, conversation history, consent, opt-out, and escalation rules
- Guardrails for admissions advice so the chatbot gives guidance without making unauthorized admission decisions
- Audience preview and authorization for bulk messages
- Delivery, failure, retry, and opt-out/consent status where applicable
- Student support cases with category, priority, assignee, status, comments, and escalation
- Knowledge-base or contextual help linked to real tasks

### Integration governance

- API catalogue and owner for every connection
- Authentication, rate limits, idempotency, retry, timeout, and error queue
- Contract tests and monitoring
- Data-sharing and retention agreements
- Manual fallback and reconciliation procedure

### Exit gate

- Priority reports reconcile to approved definitions and control totals.
- Repository upload, read-only view, download, and search permissions behave consistently across roles.
- Official documents are traceable and verifiable.
- The WhatsApp chatbot answers approved programme questions, captures leads, and hands off safely to admissions staff.
- Every outbound integration is monitored and has an owner and recovery process.
- Support and communication teams can measure delivery and resolution performance.

## Stage 9: Peripheral decisions, final migration, and legacy retirement

### Peripheral capability delivery

Implement only the `EXT-*` items approved during Stage 0. Prefer integration for mature commodity domains such as HR, accounting, LMS, and asset management unless university-specific requirements justify custom development.

### Final migration

- Resolve remaining historical and orphan records.
- Preserve required CMS, audit, document, and communication history.
- Execute final incremental migration and reconciliation.
- Freeze legacy writes by domain according to the cutover plan.

### Retirement

- Keep a protected read-only archive for approved retention periods.
- Remove credentials, network access, mail sending, scheduled jobs, and payment callbacks from the legacy system.
- Preserve source, schema, migration scripts, reconciliation evidence, and operating records in a controlled archive.
- Remove public DNS/routes only after rollback and support windows close.

### Exit gate

- Every inventory feature has a final disposition and owner sign-off.
- No operational process requires a legacy write.
- Data and documents are retrievable under approved archive procedures.
- Security, privacy, recovery, and incident procedures have been tested.
- Formal decommission approval is recorded.

## Data migration strategy

Data migration is delivered with each stage, not left until the end.

### Migration pipeline

1. Discover source fields, constraints, and hidden transformations.
2. Define canonical target meaning and mapping.
3. Profile completeness, uniqueness, validity, and relationships.
4. Clean through reproducible rules; never silently discard records.
5. Load into a staging area with source identifiers.
6. Validate structural, business, and financial/academic control totals.
7. Rehearse migration repeatedly using production-like volume.
8. Obtain business-owner sign-off.
9. Execute incremental and final cutover loads.
10. Preserve reconciliation evidence and unresolved exceptions.

### Required control totals

- Applications by intake, programme, status, and category
- Students by programme, intake, year/level, and registration state
- Academic semesters by lifecycle status, linked course offerings, registration windows, and assessment periods
- Open and historical invoice/payment totals
- Ledger opening balances by student and period
- Course registrations and class-list counts
- Assignments, submissions, and recorded marks
- Exam attempts, published grades, progression decisions, and awards
- GPA values by student, semester, programme, and rule version
- Repository documents by type, owner, access class, and lifecycle state
- Issued official documents

## Cross-cutting product requirements

### Security and privacy

- Least privilege and separation of duties
- MFA for privileged and sensitive roles
- Protection against injection, CSRF, XSS, insecure uploads, and broken object authorization
- Encryption, key management, secret rotation, and secure logging
- Field-level protection for medical, disability, identity, financial, and disciplinary data
- Access reviews and privileged-action alerts
- Retention, deletion, correction, and legal-hold procedures

### Accessibility and usability

- WCAG-aligned interfaces
- Keyboard navigation and screen-reader support
- Plain-language errors and status explanations
- Responsive student journeys and efficient staff keyboard/mouse workflows
- Low-bandwidth resilience and appropriately sized uploads
- No workflow should require staff to alter the database directly

### Reliability and operations

- Peak-load testing for application deadlines, registration, payments, and result release
- Idempotent payment, submission, import, and conversion operations
- Background jobs with retry and dead-letter handling
- Monitoring based on user outcomes, not only server uptime
- Tested recovery-point and recovery-time objectives

## Delivery governance

### Definition of ready

A work item is ready only when it has:

- linked inventory feature IDs;
- named user and business owner;
- current and target workflow;
- acceptance criteria and permission rules;
- data fields and migration impact;
- audit, notification, reporting, and document impact;
- exception and failure handling;
- privacy/security classification.

### Definition of done

A feature is done only when:

- functional and authorization tests pass;
- audit events and operational metrics exist;
- migration/reconciliation checks pass where relevant;
- accessibility and responsive behavior are verified;
- support procedures and user communication are ready;
- business owner accepts the workflow;
- deployment and rollback are tested;
- the corresponding legacy feature has an explicit coexistence or retirement decision.

## Success measures

Baseline current performance during Stage 0 and measure at each release:

- application completion and conversion rates;
- application decision turnaround and overdue cases;
- registration completion time and exception rate;
- unmatched payments, reconciliation time, and balance discrepancies;
- direct database correction count;
- teaching allocations completed before term start;
- assignment submission success and marking turnaround;
- missing/invalid marks before publication;
- post-publication result amendment rate;
- transcript/certificate turnaround;
- document repository search success and controlled-download usage;
- WhatsApp chatbot conversion, hand-off, and answer-quality rates;
- notification delivery and support resolution rates;
- security incidents and unauthorized-access findings;
- service availability during institutional peaks;
- user task-completion success and satisfaction.

## Immediate execution plan

The next programme increment should produce:

1. Owner-validated inventory classifications, especially every `EXT-*` item.
2. Current and target admissions workflow maps.
3. Role/permission matrix for applicant, student, lecturer, admissions, registry, finance, examinations, academic management, and system administration.
4. Production schema comparison against the primary dump.
5. Data-quality profile for applications, students, programmes, invoices, payments, allocations, assignments, and results.
6. Architecture decision records for identity, storage, notifications, LMS boundary, accounting boundary, and deployment model.
7. Prioritized Stage 1 and Stage 2 product backlogs linked to inventory IDs.
8. A pilot definition for one new intake, including migration controls, training, support, rollback, and acceptance authority.

The first production release should remain the platform foundation plus admissions for a controlled new intake. Student registry follows once applicant conversion and master data are stable. Finance, teaching, learning, examinations, and historical migration should then progress in bounded releases with explicit reconciliation and owner approval.
