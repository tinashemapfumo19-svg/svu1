# Live Screen Function Map

This is the frontend wiring map, not a completion certificate. Screens use the shared authenticated session and backend authority; hiding an action does not replace API authorization. Working-runtime rollout and broad browser acceptance must be recorded separately from implemented source.

## Access And Navigation

Active students now enter Study / Today rather than the generic Home. Their
current per-page function map is in [Student UI Flow](STUDENT_UI_FLOW.md).
Study owns Today, Courses, Calendar (route `#study/timetable`), Results & Progress and Resources;
Student Office owns Overview, Registration, Fees & Payments, My Details,
Documents and Requests. Shared Inbox/Account and permission-based My teaching
remain available. The older generic route rows below remain applicable to
nonstudent roles or as workflow/alias references.

With no route specified, signed-out visitors enter `#signin`; an existing session enters `#home`. Public admissions/document entry points remain available explicitly, rather than using a demo dashboard as the application entry screen.

| Screen | Route | Functions / API Families |
| --- | --- | --- |
| Sign in | `#signin` | Password login, mandatory MFA enrolment, TOTP/recovery verification, cancellation, password recovery/reset and return to the requested screen; `/api/identity/*` |
| Home | `#home` | Role-aware destinations and live personal/workload data; no fabricated counts. Staff: **This week** tiles (`/api/me/work-summary`); lecturers and applicants: mini month calendar with **Due this week** (`/api/calendar/me`) |
| Calendar | `#study/timetable` | Month / Week / List, filters (All, Coursework, Exams, Fees), selected-day agenda, **Add to calendar** (.ics) and the published examination timetable; Study / Today shows a seven-day strip. `GET /api/calendar/me`; see [CALENDAR.md](CALENDAR.md) |
| Account | `#settings` | Profile, password change, sessions/devices, sign-out and MFA; identity self-service endpoints |
| Messages | `#messages` | Owned non-secret inbox, unread/read filters, paging and explicit acknowledgement; `/api/notifications/me` |
| System | `#foundation` | Accounts, role grants/end dates, suspension/reactivation, MFA reset, session revocation, invitations, audit filtering and service health |
| Student Office extras | `#office/card`, `#office/appointments`, `#office/documents`, `#office/fees` | Digital ID card; appointment booking; self-service letters; online payment ([STUDENT_CARD.md](STUDENT_CARD.md), [APPOINTMENTS.md](APPOINTMENTS.md), [STUDENT_LETTERS.md](STUDENT_LETTERS.md), [ONLINE_PAYMENTS.md](ONLINE_PAYMENTS.md)) |
| Course page extras | `#learning`, `#study/courses/...` | QR attendance and course evaluations ([ATTENDANCE.md](ATTENDANCE.md), [COURSE_EVALUATIONS.md](COURSE_EVALUATIONS.md)); scan landing `#attend/...` |
| Settings → Notifications | `#settings` | Mute optional groups, install the app, push on this device, verified SMS number ([NOTIFICATION_PREFERENCES.md](NOTIFICATION_PREFERENCES.md), [INSTALLABLE_APP.md](INSTALLABLE_APP.md), [SMS_NOTIFICATIONS.md](SMS_NOTIFICATIONS.md)) |
| Ask SVU | Floating panel on every page | How-to help with links to permitted pages, follow-ups, feedback; `POST /api/help/ask`, `/api/help/feedback`; only when AI assistance is on. See [ASK_SVU.md](ASK_SVU.md) |
| Verification | `#verify/{code}` | Public issued transcript/certificate verification, invalid and revoked states |

Shared shell, home, settings and registry separation are under Claude's coordinated implementation. Older local workspace sign-in forms remain in some modules for compatibility; shared-login visual journeys and persona-switch regressions still require complete revalidation. Tokens and private state must clear across all screens on sign-out or authority loss. Unknown routes must not become decorative placeholders.

## Operational Workspaces

| Function Family | Live Screen | Actions / Backend Families |
| --- | --- | --- |
| Prospective enquiries / guidance | `#home`, `#apply`, `#admissions` | Public guidance/search/enquiries; staff assignment, escalation, response and governed publication |
| Applicant application | `#apply` | Registration/activation, programme/intake choices, draft/upload/fee/submission, offer acceptance/decline, withdrawal/deferral and student conversion status |
| Admissions review | `#admissions` | Queues, assignment, completeness, evidence, request-information, independent decision, offer/expiry/conversion, routing, communication groups, manifests and migration controls |
| Student records | `#registry/students` | Search and paging; onboarding, identity correction, duplicates, status history, interruptions/withdrawal/return, transfers and study-year correction |
| Registration | Student record and `#apply` | Eligibility, calendar, enrolment, guarded exceptions, course withdrawal and retained history |
| Results / academic progress | Student record and `#apply` | Source/review custody, publication, amendments, progression, prerequisites, repeats, credits, transcripts and awards |
| Support | `#registry/support`, `#apply` | Owned student cases, scoped staff assignment, private notes, escalation/resolution and service reports |
| Finance | `#registry/finance`, student record, `#apply` | Fee/billing/payment/hold views, adjustments, imported payment matching/reconciliation, sponsorships, plans/instalments and finance controls |
| Teaching / assessment / LMS | `#registry/teaching`, `#learning` | Staff allocations, independent approval/clashes, class lists, assessment plans/marks/imports/review and governed LMS/result transfer |
| Examinations | `#registry/exams` | Sittings, candidate eligibility, timetables/publication, rooms/resources, manifests/seating, paper custody and special arrangements |
| Official documents | `#registry/documents`, student record | Issuance, versioned template governance, evidence/independent approval, transcripts/certificates and revocation |
| Repository / library | `#resources` | Search/filter, uploads/scans, version publication, private previews/downloads, holds/access decisions, library items and loans |
| Reports | `#registry/reports` and relevant operational screens | Scoped live reports, source controls, CSV export, retained editions, schedules and cancellation |
| Staff / integration governance | `#registry/admin` | Staff records/account links/appointments, integration catalogue, evidence, approvals and publication |
| AI similarity check (2026-10-12) | Study course page, lecturer course content | Check-before-submit with warning and **Submit anyway**, receipt score, lecturer **AI similarity** column, per-assignment allowable score in the assignment editor; `/api/course-workspaces/.../ai-check` ([AI_SIMILARITY_CHECK.md](AI_SIMILARITY_CHECK.md)) |
| Automations (2026-10-12) | `#foundation` → Automations; course pages; Inbox | Run history, per-job errors, **Run now**; lecturer **Remind N students who have not submitted**; **Add to calendar** / **Add all** (.ics); reminders, receipts and digests arrive in the Inbox; `/api/automations`, `.../remind-missing` ([AUTOMATIONS.md](AUTOMATIONS.md)) |
| AI assistance (2026-10-12) | Mark / feedback form, staff support case, `#apply` guidance, applicant uploads, `#study/results` | **Draft feedback with AI**, **Suggest triage and reply** / **Use this reply**, **Ask a question about applying**, document-type check before upload, **Explain in plain language**; shown only when `/api/ai/status` reports enabled ([AI_ASSIST.md](AI_ASSIST.md)) |
| Early warning (2026-10-12) | `#registry/students` | **Students who may need support** → **Show list** (rules only); `/api/registry/early-warning` |

The routes above identify existing adapters, not blanket proof of every action. Existing per-domain browser specs remain the authoritative behavioural regressions, and many need navigation updates for the shared shell. Course-withdrawal integration into active exam/arrangement/reporting sources is still pending; historical records must not be silently removed.

## New System Functions

| Tab | Permission | Controls |
| --- | --- | --- |
| Workflows | `workflow.transition` | Scoped queue, pages, guarded create, subject/programme/intake binding, permitted transitions, expected-state refusal and history |
| Tasks | `task.assign` | Scoped queue, search/status/pages, assignment/self-assignment, handoff and completion with reasons |
| Reference lists | `master_data.publish` | List selection, owner/status/purpose, add/edit, effective-date retirement/restore and currency minor units |
| Notifications | `notification.send` | Active non-secret template selection, variable fields, recipient, escaped preview, explicit queue command, delivery-state filters/pages |
| Verification records | `foundation.view` | Recorded development checks and database-recovery checks; not production or institutional approval |

These controls use native endpoints, not mock success messages. Queueing is not delivery. Secret-bearing activation/recovery/invitation templates are excluded from generic composition. Queues paginate the fetched authorized set in the browser; backend bounded pagination/search is still required before large-scale operational acceptance. Identifier entry for generic workflow subjects/task assignees/message recipients still needs governed record-picker ergonomics.

## Remaining Frontend Work

- Academic setup screens (organization, programme/curriculum, courses, periods, intakes, grading, GPA rules) are built and desktop/mobile verified per [LEGACY_COVERAGE_GOAL.md](LEGACY_COVERAGE_GOAL.md); this bullet previously listed them as missing.
- Every non-student screen now uses the shared staff anatomy (page header, bands, workbench, status words, empty states); see the "Staff screen anatomy" section of [SVU_UI_STANDARD.md](SVU_UI_STANDARD.md).
- Map each remaining route-level action to a control and regression, including exceptional states, independent approvals and import reconciliation. This family-level map must not be mistaken for a complete endpoint inventory.
- Finish the shared-shell integration and remove redundant per-workspace login paths only after replacement journeys pass.
- Verify authority/cache clearing, held responses, draft/retry behaviour, disabled/loading states, empty/error states and role-limited navigation throughout every workspace.
- Apply only reviewed pending working migrations and refresh the owned development backend after isolated acceptance. Never reseed the working database to make screens look populated.
- Run the complete current-source desktop/mobile suite and inspect representative screenshots. Accessibility, performance, production providers and owner acceptance remain separate gates.
