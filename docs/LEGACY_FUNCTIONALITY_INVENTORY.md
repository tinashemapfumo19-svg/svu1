# SVU Legacy Functionality Inventory

## Purpose

This document inventories the business and operational capabilities discovered in the South Valley University source code. It is the traceability baseline for the rebuild: every confirmed capability must be retained, improved, integrated, or explicitly retired.

This is a source-derived inventory, not proof that every feature was used in production. Static code cannot confirm production configuration, user behavior, external systems, or whether historical and duplicated pages are still active. Those uncertainties are recorded instead of being presented as facts.

## Audit scope

The inventory was assembled from:

- the public, student, and staff entry points;
- active staff navigation in `sf/index.php`, `sf/mymodules/admin.php`, `sf/mymodules/reg.php`, and `sf/mymodules/maint.php`;
- student navigation and request handlers in `sd/`;
- current, undated forms and their included function libraries;
- examination, library, document, communication, and reporting code;
- `southval_db2.sql` and tables created dynamically from PHP;
- references to external or missing systems.

The repository contains approximately 1,127 PHP files, at least 91 dated or explicitly old PHP copies, and two large bundled chat trees. The primary SQL dump defines 219 tables, including a substantial Drupal/CMS schema alongside about 47 clearly SVU-oriented or closely related tables. File count is therefore not a reliable measure of application functionality.

## Status legend

| Status | Meaning |
| --- | --- |
| Confirmed | A local entry page, implementation, and related data access were found. Runtime testing is still required. |
| Supporting | Implemented logic used by another capability rather than a standalone user feature. |
| Unlinked | Implementation exists, but no active route from the inspected primary navigation was confirmed. |
| External | The code links to another application or path not included in this workspace. |
| Placeholder | A menu label, empty link, commented link, or incomplete action exists without a complete local implementation. |
| Historical | A dated, `_old`, backup, or duplicated implementation exists and is not assumed authoritative. |
| Security hold | The code exists but should not be executed or exposed before investigation or remediation. |

## Rebuild disposition legend

| Disposition | Meaning |
| --- | --- |
| Retain | Preserve the business outcome with minimal functional change. |
| Improve | Preserve the outcome while redesigning workflow, controls, and user experience. |
| Integrate | Prefer a supported external platform with a documented API. |
| Decide | Requires business ownership and build-versus-integrate analysis. |
| Retire | Remove after validation that it has no continuing business value. |
| Investigate | Establish origin, use, and risk before making a scope decision. |

## Application surfaces

| Surface | Entry points | Current purpose |
| --- | --- | --- |
| Public application | `sd/application.php`, `sd/confirm.php` | Application capture, fee-code validation, document upload, and confirmation email. |
| Student onboarding | `sd/regform.php`, `sd/stage2.php`, `sd/completing_registration.php` | Multi-stage conversion of an approved applicant into a registered student. |
| Student portal | `sd/frmlogin.php`, `sd/frmindex.php`, `sd/display.php` | Profile, finance visibility, tutorials, assignments, submissions, schedules, and documents. |
| Staff portal | `sf/frmlogin.php`, `sf/index.php` | Authentication and routing into registration, administration, and maintenance areas. |
| Registry/admissions | `sf/mymodules/reg.php`, `sf/mymodules/forms/frmvetting.php` | Applicant vetting, registration queries, vacancies, semesters, invoices, and payments. |
| Academic administration | `sf/mymodules/admin.php` | Faculties, departments, programmes, curriculum, exams, coursework, library, and staff management. |
| Maintenance | `sf/mymodules/maint.php` | User administration plus several incomplete or misdirected maintenance links. |
| Documents | `sf/tcpdf/examples/` | Transcript, progressive-transcript, and certificate generation. |
| Library | `sf/lib/` and student links | Uploaded books/materials organized by programme, subject, and category. |
| Chat | root `index.php`, `chat/`, `chatbox/` | Bundled phpFreeChat instances. |
| CMS data | Drupal-style tables in `southval_db2.sql` | Historical website/CMS content and configuration; portal integration is not established. |

## Feature inventory

### A. Identity, authentication, authorization, and audit

Primary evidence: `sf/frmlogin.php`, `sf/process_staff.php`, `sd/frmlogin.php`, `sd/process_parent.php`, `sf/mymodules/forms/frmum.php`, and their included helpers.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| IAM-01 | Separate staff and student username/password login | Confirmed | Improve: one identity platform with distinct personas and policies |
| IAM-02 | Staff account creation during staff registration | Confirmed | Improve: controlled invitation and activation |
| IAM-03 | Temporary password generation for new staff | Confirmed | Improve: expiring activation token; never display or email reusable passwords |
| IAM-04 | Password reset and change flows for staff and students | Confirmed | Improve: secure, time-limited recovery with audit events |
| IAM-05 | Staff access-level assignment through `svu_sl`/`svu_sla` | Confirmed | Replace with granular role-based permissions |
| IAM-06 | Session detection, single-session-like checks, and forced logout | Confirmed | Improve with centralized session/device management |
| IAM-07 | Login audit including IP-related helpers | Confirmed | Improve with searchable security events and retention policy |
| IAM-08 | Student activity/audit table creation | Supporting | Expand into shared append-only audit service |
| IAM-09 | Account activation, active status, and reset-code state | Confirmed | Improve with explicit lifecycle states |
| IAM-10 | Default/bootstrap administrator creation | Confirmed, security hold | Remove from runtime; replace with controlled deployment bootstrap |
| IAM-11 | MD5-based or otherwise legacy credential handling | Confirmed, security hold | Replace with modern password hashing and credential migration |
| IAM-12 | User-management UI for access level and department/programme scope | Confirmed | Rebuild with least privilege, approvals, and role history |

### B. Admissions and applicant management

Primary evidence: `sd/application.php`, `sd/application_files.php`, `sf/mymodules/forms/frmvetting.php`, `sf/mymodules/customised/app.php`, `rej.php`, and reporting helpers.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| ADM-01 | Public application form | Confirmed | Improve with accessible, responsive, save-and-resume workflow |
| ADM-02 | Undergraduate/postgraduate or course-level selection | Confirmed | Retain using configurable programme requirements |
| ADM-03 | Applicant nationality/country and prior academic-level capture | Confirmed | Retain with governed reference data |
| ADM-04 | Study category/mode capture | Confirmed | Retain and normalize |
| ADM-05 | Programme selection filtered from configured courses/vacancies | Confirmed | Improve using published intake catalogue |
| ADM-06 | Application-fee-code validation and association with applicant | Confirmed | Replace with payment/waiver verification service while retaining code support if required |
| ADM-07 | Supporting-document upload | Confirmed | Improve with document checklist, scanning, metadata, review status, and secure storage |
| ADM-08 | Duplicate course/document checks | Supporting | Improve with applicant and application duplicate detection |
| ADM-09 | Application confirmation and email | Confirmed | Improve with submission receipt, status timeline, and delivery tracking |
| ADM-10 | Pending/open applicant queues | Confirmed | Improve with ownership, SLA, filtering, and workload assignment |
| ADM-11 | Undergraduate and postgraduate vetting queues | Confirmed | Retain as configurable review routes |
| ADM-12 | Application approval | Confirmed | Improve with criteria, reviewer decision, evidence, and audit history |
| ADM-13 | Application rejection with predefined/free-text reason | Confirmed | Improve with controlled reason catalogue and communication templates |
| ADM-14 | Reopen/defer/review-related status updates | Confirmed in code paths | Model as explicit workflow transitions |
| ADM-15 | Applicant communication from vetting screens | Confirmed | Move to shared notification service |
| ADM-16 | Approved/rejected/vacancy manifests and counts | Confirmed | Replace with governed operational reports |
| ADM-17 | Applicant-to-registration record conversion | Confirmed | Rebuild as idempotent accepted-offer conversion |
| ADM-18 | Registration/authentication link generation for approved applicants | Confirmed | Replace with secure expiring activation link |

### C. Academic structure, catalogue, intakes, and curriculum

Primary evidence: `frmfaculties.php`, `frmdeptprog.php`, `frmcoursecodes.php`, `frmvacancies.php`, `frmsetupsem*.php`, `func_faculties.php`, `func_courses.php`, `func_vacancies.php`, and `func_semester.php`.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| ACA-01 | Faculty creation, update, listing, and removal | Confirmed | Improve with lifecycle status and dependency controls |
| ACA-02 | Department creation, update, listing, and removal | Confirmed | Improve with effective dates and organizational ownership |
| ACA-03 | Department-to-faculty assignment | Confirmed | Retain with history |
| ACA-04 | Programme catalogue through `courses` | Confirmed | Improve into versioned programme records |
| ACA-05 | Department-to-programme assignment | Confirmed | Improve with effective dates and multi-department ownership if needed |
| ACA-06 | Programme level/class and fee-level mapping | Confirmed | Normalize academic and financial classifications |
| ACA-07 | Course/subject code creation | Confirmed | Improve with credits, prerequisites, level, term, and status |
| ACA-08 | Curriculum listing by programme, year, and term | Confirmed | Rebuild as versioned curriculum structures |
| ACA-09 | Programme vacancy/capacity opening and closing | Confirmed | Improve with intake capacity, application dates, and approval |
| ACA-10 | Intake month/year configuration | Confirmed | Retain as academic-period/intake configuration |
| ACA-11 | Semester/term setup, open/close, and date ranges | Confirmed | Consolidate `academic_term` and `term_setup` into one period model |
| ACA-12 | Current study year and intake-derived logic | Confirmed | Replace hard-coded date logic with effective-period rules |
| ACA-13 | Academic grading ranges and degree classifications | Confirmed | Version and approve grading schemes |
| ACA-14 | Currency and invoice-category reference values | Confirmed | Move into governed finance configuration |
| ACA-15 | Learning-semester lifecycle management | Requested enhancement | Add semester planning, open/close controls, course-offering linkage, registration windows, teaching calendars, result periods, and archive rules |

### D. Student onboarding, registry, and progression

Primary evidence: `sd/regform.php`, `stage2.php`, `completing_registration.php`, `nextreg.php`, `application_files.php`, `process_parent.php`, and registry forms/helpers.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| REG-01 | Approved-applicant registration initiation | Confirmed | Improve with secure accepted-offer onboarding |
| REG-02 | Automatic student registration-number generation | Confirmed | Retain with collision-safe institutional numbering rules |
| REG-03 | Multi-stage personal-data registration | Confirmed | Improve as resumable guided workflow |
| REG-04 | Name, birth date, gender, national ID, email, phone, and address capture | Confirmed | Retain with validation, privacy, and change history |
| REG-05 | Religion and disability capture | Confirmed | Retain only with lawful purpose, consent/access controls, and reporting safeguards |
| REG-06 | Chronic condition, medical aid, provider, and doctor capture | Confirmed | Decide scope with privacy/legal owners; strongly restrict access |
| REG-07 | Next-of-kin data | Confirmed | Retain with relationship and emergency-contact controls |
| REG-08 | Student profile viewing and contact-detail update | Confirmed | Improve with field-level verification and audit history |
| REG-09 | Registration status and stage tracking | Confirmed | Replace numeric stages with explicit workflow states |
| REG-10 | Student search/query and advanced query | Confirmed | Improve with scoped search, filters, and protected fields |
| REG-11 | Programme, faculty, department, intake, and registration-date display | Confirmed | Retain through authoritative enrolment records |
| REG-12 | Registration suspension/override and invoice access override | Confirmed in direct update code | Replace with reasoned, approved, expiring exception workflows |
| REG-13 | Study type/mode determination | Confirmed | Retain as controlled enrolment attribute |
| REG-14 | Academic year/level progression tracking | Confirmed | Rebuild as effective-dated progression decisions |
| REG-15 | Returning-student progression and registration eligibility | Confirmed | Improve with explainable rules and exception handling |
| REG-16 | Retake/repeat-related academic handling | Confirmed in exam/progression helpers | Model explicitly in enrolment and assessment history |
| REG-17 | Student control and current-study-year tracking | Confirmed in schema/code | Consolidate into student status and enrolment-period records |

### E. Fees, invoicing, payments, and financial clearance

Primary evidence: `frminvsetup.php`, `stdinvoices*.php`, `frmconfirm.php`, `frmpay.php`, `func_invoicesx.php`, `func_registration.php`, `func_pay.php`, and student finance views.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| FIN-01 | Invoice-type setup | Confirmed | Retain as approved charge catalogue |
| FIN-02 | Programme-level annual fee and amount setup | Confirmed | Replace with effective-dated fee schedules |
| FIN-03 | Open, close, update, and remove administrative invoice definitions | Confirmed | Improve with approvals and non-destructive versioning |
| FIN-04 | Initial student invoice generation during intake/vacancy processing | Confirmed | Rebuild through rules-based charge generation |
| FIN-05 | Returning-student invoice generation | Confirmed | Retain using academic-period billing runs |
| FIN-06 | Student invoice listing and status | Confirmed | Replace with ledger-based account view |
| FIN-07 | Fee confirmation and invoice clearance | Confirmed | Improve with allocation and reconciliation evidence |
| FIN-08 | Part-payment entry | Confirmed | Retain through payment transactions and allocations |
| FIN-09 | Payment listing and student statement | Confirmed | Retain with running balance and downloadable statement |
| FIN-10 | Outstanding-balance calculation | Confirmed | Centralize in auditable ledger service |
| FIN-11 | Paid-up/financial-eligibility check controlling portal actions | Confirmed | Improve with explainable financial-hold policies |
| FIN-12 | Manual invoice status/allow-access override | Confirmed | Replace with approved exception and expiry |
| FIN-13 | Payment or invoice email notification | Confirmed in helpers | Move to shared notification service |
| FIN-14 | Currency lookup | Confirmed | Retain as currency-aware configuration |
| FIN-15 | Payment plans, advance payments, and reminders | Menu/code references; partly external or placeholder | Decide with finance owners before inclusion |
| FIN-16 | Bank reconciliation, revenue, expenditure, and cash management | Local custom code references tables absent from primary dump | Investigate; likely separate accounting subsystem or incomplete integration |

### F. Staff and lecturer administration

Primary evidence: `frmstaff.php`, `func_staff.php`, `frmum.php`, `func_um.php`, and `frmsubjectassign.php`.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| STF-01 | Staff personal and employment profile registration | Confirmed | Improve with separate person, employment, and account records |
| STF-02 | Employee number, engagement date, category, grade, and exit fields | Confirmed | Retain with effective dates and HR ownership |
| STF-03 | Department assignment | Confirmed | Retain with organizational history |
| STF-04 | Supervisor selection | Confirmed in profile | Improve with effective-dated reporting lines |
| STF-05 | Staff category setup, including Lecturer | Confirmed | Replace category-as-permission with roles and employment classification |
| STF-06 | Staff search, listing, update, and active state | Confirmed | Improve with scoped administration and audit trail |
| STF-07 | Lecturer subject allocation | Confirmed | Replace with academic-period course-offering assignment |
| STF-08 | Allocation deactivation | Confirmed, control weakness | Rebuild with precise allocation identity, reason, and history |
| STF-09 | Lecturer workload visibility | Not substantively implemented | Add if required by academic management |
| STF-10 | Staff leave, transfer, promotion, and personnel history | Local custom files plus external HRMS links; operational status unresolved | Decide whether to integrate a dedicated HR system |

### G. Teaching and learning

Primary evidence: coursework links in `admin.php`, `frmposttutorial.php`, `frmpostasignement.php`, `frmassignments_given.php`, `frmrecord.php`, `sd/display.php`, and `func_courses.php`.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| LMS-01 | Lecturer sees subjects restricted by allocation | Confirmed | Retain through course-offering membership |
| LMS-02 | Tutorial/study-material upload | Confirmed | Improve with organized course resources and secure storage |
| LMS-03 | Tutorial publish, withdraw/close, list, and count | Confirmed | Improve with availability windows and version history |
| LMS-04 | Tutorial notification email | Confirmed in helpers | Move to event-based notifications |
| LMS-05 | Assignment creation with programme, subject, level, term, number, file, and due date | Confirmed | Improve with structured instructions and attachments |
| LMS-06 | Assignment publication and closure | Confirmed | Improve with scheduled release and explicit status |
| LMS-07 | Automatic overdue closure/date synchronization | Confirmed | Replace with scheduled workflow rules |
| LMS-08 | Assignment distribution to eligible students | Confirmed | Base on course-offering enrolment rather than copied rows |
| LMS-09 | Student assignment download | Confirmed | Retain with access logging |
| LMS-10 | Student submission and resubmission | Confirmed | Improve with immutable attempts and receipts |
| LMS-11 | Submitted/not-submitted lecturer views | Confirmed | Improve with class progress dashboard |
| LMS-12 | Marked-file return | Confirmed | Retain as feedback attachment |
| LMS-13 | Assignment mark recording, percentage, grade, and recorded state | Confirmed | Replace with structured gradebook and moderation |
| LMS-14 | Assignment mark publication | Confirmed | Improve with controlled release and notification |
| LMS-15 | Quizzes, discussions, rubrics, attendance, learning outcomes, plagiarism, and virtual classroom | No substantial local implementation found | Decide whether to build a bounded module or integrate a supported LMS |
| LMS-16 | Course chatrooms for student-to-lecturer and student-to-student interaction | Requested enhancement; legacy phpFreeChat is not course-aware | Add supported, moderated, permission-aware course chat with message history, retention, abuse reporting, and staff controls |
| LMS-17 | Online video-enabled classroom | Requested enhancement | Integrate or build scheduled live classes with enrolment-based access, lecturer controls, attendance/participation records, recordings, and low-bandwidth fallback |

### H. Examinations, results, progression, and graduation

Primary evidence: `frmorderexam.php`, `frmschedulexam.php`, `frmrecordexam.php`, `frmBatchUpload.php`, `frmRecorded.php`, examination helpers, publishing code, and TCPDF endpoints.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| EXM-01 | Lecturer/course-specific examination ordering | Confirmed | Improve with exam-cycle workflow and approvals |
| EXM-02 | Exam year, intake, sitting, paper number, pass mark, and contribution capture | Confirmed | Retain in versioned assessment configuration |
| EXM-03 | Duplicate exam-order prevention and order status | Confirmed | Retain with stronger constraints |
| EXM-04 | Exam order publish, unpublish, close, and dashboard delivery | Confirmed | Improve with authorized transitions and history |
| EXM-05 | Exam schedule file upload, listing, count, and closure | Confirmed | Improve with structured schedule plus document export |
| EXM-06 | Student exam-record creation from orders/enrolment | Confirmed | Rebuild from authoritative registration and assessment plan |
| EXM-07 | Retake detection | Confirmed | Model explicit attempt type and linkage |
| EXM-08 | Individual examination mark entry | Confirmed | Improve with validation and autosave |
| EXM-09 | Batch mark upload/import | Confirmed | Retain with preview, validation, rejection report, and idempotency |
| EXM-10 | Recorded/unrecorded result views | Confirmed | Improve with completion dashboard |
| EXM-11 | Grade and class calculation | Confirmed | Version and test grading rules |
| EXM-12 | Semester decision and combined/final progression decision | Confirmed | Rebuild as explainable, approved decision engine |
| EXM-13 | Missing/default result handling | Confirmed in helper logic | Replace with explicit exception states |
| EXM-14 | Result publication by course/exam | Confirmed | Improve with readiness checks, approval, batch history, and rollback procedure |
| EXM-15 | Result unpublishing/amendment | Confirmed in functions | Replace with controlled amendment workflow preserving original values |
| EXM-16 | Progressive transcript | Confirmed | Retain through document service |
| EXM-17 | Final transcript | Confirmed | Retain through document service |
| EXM-18 | Degree/certificate generation based on completion record | Confirmed | Improve with graduation audit and controlled issuance |
| EXM-19 | Exam rooms and invigilator management | Commented or external links only | Decide; no complete local implementation confirmed |
| EXM-20 | Grade point average calculation | Requested enhancement | Add versioned GPA algorithms by programme/award level, credit weighting, repeat/retake rules, exclusions, rounding, auditability, and sample-based validation |

### I. Documents, reports, and records

Primary evidence: TCPDF examples, `rptfunc.php`, class/student reporting functions, and finance/registry views.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| RPT-01 | Applicant pending/approved/rejected/vacancy counts and lists | Confirmed | Retain as admissions dashboard and reports |
| RPT-02 | Application document viewing | Confirmed | Retain through secure document viewer |
| RPT-03 | Student profile/registration report | Confirmed | Improve with governed student-record view |
| RPT-04 | Class/student lists and manifests | Confirmed | Retain with filters and controlled exports |
| RPT-05 | Student payment and balance views | Confirmed | Retain from ledger/reporting layer |
| RPT-06 | Assignment submission and recording reports | Confirmed | Retain as course analytics |
| RPT-07 | Exam order, schedule, recording, and publication reports | Confirmed | Retain as exam-cycle dashboards |
| RPT-08 | Transcript, certificate, statement, receipt, and confirmation outputs | Confirmed or implied across modules | Centralize in document service |
| RPT-09 | PDF templates embedded in endpoint scripts | Confirmed | Replace with versioned approved templates |
| RPT-10 | Public authenticity verification/QR | Not found | Add for official documents |
| RPT-11 | Governed metric definitions and export auditing | Not found | Add in reporting platform |
| RPT-12 | Document repository with upload, read-only viewing, download, and search | Requested enhancement; current files are scattered across upload folders | Add managed repository with metadata, full-text/keyword search, permissions, immutable read-only viewer, download controls, versioning, retention, and audit logs |

### J. Communication, support, and engagement

Primary evidence: PHPMailer call sites, `frmcomms.php`, `sd/feedback.php`, `sd/contact.php`, notifications referenced in custom code, and chat entry points.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| COM-01 | Application confirmation email | Confirmed | Retain through notification service |
| COM-02 | Admission approval/rejection email | Confirmed | Improve with templates and delivery history |
| COM-03 | Bulk/group applicant communication by status | Confirmed | Retain with consent, audience preview, and audit trail |
| COM-04 | Password-reset email | Confirmed | Replace with secure identity-provider flow |
| COM-05 | Assignment/tutorial/exam-related notification helpers | Confirmed in code | Consolidate as event-driven notifications |
| COM-06 | Student feedback/contact form | Confirmed | Improve into support cases with assignment and status |
| COM-07 | In-app notification history through `svu_notifications` | Referenced; table not in primary dump | Investigate and rebuild in shared notification service |
| COM-08 | SMS/text-student action | Commented or external link | Decide provider and scope |
| COM-09 | Announcements and reminders | Menu references, partly placeholder/external | Include as controlled communications if validated |
| COM-10 | phpFreeChat | Confirmed bundled application | Decide whether to retire or replace with supported messaging/support channel |
| COM-11 | SVU WhatsApp chatbot for prospective students | Requested enhancement | Add official WhatsApp Business number, consent-aware conversation flows, AI-backed programme guidance, human hand-off, knowledge-base governance, analytics, and admissions lead capture |

### K. Library and learning resources

Primary evidence: `sf/lib/`, `sf/exams/func_lib.php`, staff library links, student library link, and external online-library URL.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| LIB-01 | Upload books/library material | Confirmed | Improve or integrate with repository/LMS |
| LIB-02 | Categorize material by programme, subject, type, author, and year | Confirmed | Retain as structured metadata |
| LIB-03 | Publish/withdraw and count available material | Confirmed | Improve with lifecycle and permissions |
| LIB-04 | Student/staff browsing and download | Confirmed | Retain with access control and search |
| LIB-05 | Shelf/subscription/book-type structures referenced in code | Implemented references; dump coverage incomplete | Investigate active data source |
| LIB-06 | External online library link | Confirmed external integration by URL only | Integrate through supported authentication/linking if still used |

### L. System administration and operations

Primary evidence: maintenance navigation, update scripts, configuration files, runtime table creation, diagnostics, and storage directories.

| ID | Existing capability | Status | Rebuild disposition |
| --- | --- | --- | --- |
| OPS-01 | Environment/database configuration in PHP files | Confirmed, security hold | Replace with environment configuration and secrets management |
| OPS-02 | SMTP configuration in application code | Confirmed, security hold | Replace with managed provider configuration and secret rotation |
| OPS-03 | Runtime table creation and schema updates from web code | Confirmed | Replace with versioned migrations |
| OPS-04 | Hard-coded localhost and production URLs/paths | Confirmed | Replace with route generation and environment configuration |
| OPS-05 | Shared filesystem upload directories | Confirmed | Replace with managed private object storage and malware scanning |
| OPS-06 | PHP diagnostics and mail-test endpoints | Confirmed, security hold | Remove from public deployment |
| OPS-07 | Database dumps and old source copies in web tree | Confirmed, security hold | Move to protected archive and remove from deployable artifact |
| OPS-08 | Backup menu action | Misdirected/placeholder; no reliable backup workflow confirmed | Implement managed encrypted backup and recovery testing |
| OPS-09 | Assign-machines and offline-system menu items | Placeholder | Investigate, then retire or specify |
| OPS-10 | Audit-trail menu item points to department-programme page | Confirmed navigation defect | Replace with real audit viewer |
| OPS-11 | Monitoring, alerting, health checks, and deployment pipeline | Not found | Add as platform foundation |
| OPS-12 | Obfuscated absolute-path include in `sf/index.php` | Confirmed, security hold | Isolate and investigate before executing legacy staff portal |

### M. External, peripheral, and unresolved capabilities

The custom menu files contain many routes to `../hrms`, `../web`, `/tips`, or Yii-style `index.php?r=...` controllers that are not included as a complete application in this workspace. Some local custom PHP files also reference tables absent from the primary dump. These capabilities must not be assumed to belong to the first rebuild scope without owner validation.

| ID | Referenced capability | Status | Required decision |
| --- | --- | --- | --- |
| EXT-01 | Staff leave categories, balances, requests, recommendation, authorization, denial, and cancellation | Local custom code plus external HR routes | Integrate HR platform or explicitly include HR module |
| EXT-02 | Staff transfers, departmental movement, promotions, grades, and personnel records | Primarily external HR routes with some local handlers | Confirm system of record and integration owner |
| EXT-03 | Asset registration, allocation, disposal, stock take, and issue vouchers | Some local custom code plus external/missing routes | Confirm whether this is university scope or copied subsystem |
| EXT-04 | Revenue, expenditure, cash management, and bank reconciliation | Local custom code references absent finance tables | Confirm accounting-system boundary |
| EXT-05 | Fleet, drivers, routes, fuel, service, and passenger manifests | Menu references only | Likely retire unless business owner validates |
| EXT-06 | Parent accounts and parent notifications | Table/route references outside core portal | Confirm whether used and legally appropriate |
| EXT-07 | Student health records and medical aid beyond onboarding fields | External route/table references | Decide privacy owner, lawful basis, and system boundary |
| EXT-08 | Sports, clubs, awards, commendations, and extracurricular records | Menu/route references | Decide whether student-engagement module is required |
| EXT-09 | General ticket/pending/approved workflows | External `/tips` links | Identify original system or retire |
| EXT-10 | “Bales,” “Grower,” and unrelated agricultural labels | Broken/copied menu remnants | Retire after confirming no SVU use |
| EXT-11 | Exam-room and invigilator management | Commented/external links | Decide whether to build in examination stage |
| EXT-12 | CMS website, media gallery, search, groups, and content workflow | Drupal schema in database dump | Treat as separate website migration unless integration is proven |

## Data-domain inventory

### Confirmed core tables

| Domain | Tables |
| --- | --- |
| Reference/catalogue | `country`, `academic_level`, `religion_list`, `disabilities_list`, `faculties`, `courses`, `svu_currency` |
| Admissions | `application_fee_code` (referenced), `student_applications`, `student_applications_documents`, `students_reject_reasons`, `vacancies` |
| Student registry | `students_auto`, `students_registration`, `student_medical_aid`, `svu_student_nxtkin`, `svu_student_control`, `svu_current_study_year_tracking` (created by update script), `svu_study_progression` (referenced) |
| Academic structure | `academic_term`, `term_setup`, `svu_departments`, `svu_department_programmes`, `svu_course_codes`, `svu_programme_level` |
| Identity/audit | `svu_sl`, `svu_sla`, `svu_sl_audit`, `svu_student_audit` |
| Staff/teaching allocation | `svu_staff_members`, `svu_staff_category`, `svu_subject_allocation` |
| Finance | `svu_invoices_types`, `svu_admin_invoices`, `svu_student_invoices`, `svu_payments`, `students_invoices` |
| Learning | `svu_tutorials`, `svu_assignments`, `svu_student_assignment`, `svu_recorded_assignments` |
| Examinations/results | `svu_order_exam`, `svu_exam_schedule`, `svu_student_exam`, `svu_exam_grades`, `svu_exam_grades_list`, `svu_exam_grades_class`, `svu_exam_grades_class_list`, `svu_student_degree` (referenced), `svu_student_exam_progression` (referenced) |
| Communication/library | `svu_notifications`, `svu_book_type`, `svu_lib_subs`, `svu_shelf` are referenced in code but are not all present in the inspected primary dump |

### Secondary CMS schema

The dump contains Drupal-oriented tables including `node`, `users`, `role`, `role_permission`, `menu_*`, `field_config*`, `field_data_*`, `field_revision_*`, `file_managed`, `taxonomy_*`, `views_*`, `cache_*`, `search_*`, `og_*`, media-gallery tables, and `watchdog`. These should be inventoried as a separate website/CMS workstream. Their presence does not prove that the student/staff portal depends on them.

### Referenced data absent from the primary dump

Code references additional groups such as `acc_*`, `asset_*`, `leave_*`, `staff_transfers`, `enrolment`, `student_school_work`, `subject_allocation`, `school_grading_parameters`, parent-account tables, and several views. This suggests one or more of the following:

- another database or later schema was used in production;
- code was copied from a related system;
- a partially integrated HR/accounting/school-management application existed;
- the primary dump is incomplete.

These references are migration risks and must be resolved through production database inspection and stakeholder interviews.

## Known workflow and control gaps

- Business rules are spread across pages, helper files, SQL, and dated copies.
- Several actions directly update status or financial-access fields without a durable approval case.
- Lecturer allocation is tied to subject code, not a specific academic-period course offering.
- Assignment distribution copies rows to students and relies heavily on files and flags.
- Result and progression calculations need formal rule extraction and regression tests.
- Runtime DDL means the dump may not contain the complete production schema.
- Some menus point to unrelated, missing, empty, or commented destinations.
- Sensitive personal, medical, academic, and financial data do not have a unified authorization model.
- Existing audit records are not a complete institutional event history.
- External integrations are URL-level links rather than governed contracts.

## Coverage register

The following evidence must still be collected before this inventory can be declared institutionally complete:

| Gap | Required evidence | Owner |
| --- | --- | --- |
| Production routes | Current deployed document root, virtual hosts, and active URLs | IT |
| Production schema | Read-only schema export without student data | DBA/IT |
| Scheduled operations | Cron jobs, imports, backups, and manual routines | IT |
| External systems | HRMS, accounting, payment, SMS, library, LMS, and `/tips` ownership | IT and department owners |
| Role use | List of actual access levels and users assigned to each | IT/security |
| Workflow validation | Walkthroughs for admissions, registry, finance, teaching, exams, and graduation | Process owners |
| Reports/documents | Catalogue of required reports, letters, transcripts, certificates, and statutory returns | Registry/management |
| Historical files | Confirmation of authoritative current versions | IT/developers |
| Data retention | Legal and institutional retention requirements | Management/legal |

## Traceability rule for the rebuild

Every backlog item must reference one or more feature IDs from this inventory or be marked as a genuinely new capability. Every legacy feature must eventually receive one final decision:

```text
Retained and verified
Improved and verified
Integrated and verified
Retired with owner approval
Not applicable with recorded reason
```

No legacy module should be switched off while it still contains an unresolved feature, report, document, integration, or authoritative record.
