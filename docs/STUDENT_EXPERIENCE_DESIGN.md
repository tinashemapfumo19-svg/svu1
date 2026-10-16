# Student Experience: Study + Student Office

Date: 2026-10-07
Status: Phase 1 baseline approved for implementation on 2026-10-07.
Scope: Logged-in active students. This document does not authorize implementation.

## Purpose

Replace the student's mixed, long Workspace page and overlapping overview pages
with two connected spaces in one SVU application:

- **Study**: the student's academic week, courses and progress.
- **Student Office**: administration, registration, finance and institutional records.

Keep one login, one session, one visual system and existing authorization rules.
Active students land on Study / Today. Applicant and staff experiences remain
role-aware; students with staff roles retain access to authorized staff areas.

## Decisions From the Discussion

| Topic | Planned change |
| --- | --- |
| Primary navigation | Study and Student Office replace the five equal student destinations. |
| Landing page | Today replaces a generic Home/dashboard pair. |
| Course experience | Organize academic content around an enrolled course, identified by its offering and period, not course code alone. |
| Official results | Published results and academic progress belong in Study. |
| Official documents | Issued transcripts, certificates and registration documents belong in Student Office. |
| Registration | Select and confirm courses in Student Office; show relevant notices in Study. |
| Requests | Start requests in context and track them through a common Requests view. Preserve each type's workflow. |
| Communication | Initially one Inbox with unread badge; do not create two overlapping notification destinations. |
| Cross-space information | Duplicate awareness, not functionality. Resolve each action at one owning destination. |
| Mobile | Keep Study / Student Office switching visible, not hidden under More. |
| Settings | One shared Settings destination for security, preferences and accessibility; avatar menu for identity and sign-out. |
| LMS | Preserve accepted ADR-008: integrate a dedicated LMS; do not build a full LMS as part of this redesign. |
| Payments | Do not expose Pay now without a working payment integration. |
| Rollout | Restructure supported features first; add academic capabilities only when backed by real data. |

## Navigation and Page Ownership

The following routes are proposed contracts, not existing implementations.
Codex will confirm their parsing against the current hash router before coding.

| Space | Page | Proposed route | Content |
| --- | --- | --- | --- |
| Study | Today | `#study/today` | Confirmed courses, published exams/results, relevant updates, Your attention and continuation links. |
| Study | Courses | `#study/courses` | Enrolled offerings grouped by period, withdrawn state, previous terms. |
| Study | Course | `#study/courses/<periodId>/<courseId>` | Offering-specific overview; supported materials, assessments, classes and announcements as capabilities become available. |
| Study | Timetable | `#study/timetable` | Published exams initially; classes/labs/tutorials once supported, calendar export and request links. |
| Study | Results & Progress | `#study/results` | Published marks, grades, GPA, academic decisions, recognized credits and existing completion audit. |
| Study | Resources | `#study/resources` | Existing authorized repository search, detail, viewer and downloads. |
| Student Office | Overview | `#office/overview` | Registration status, balances, holds, open requests and issued-document links. |
| Student Office | Registration | `#office/registration` | Selection, checks, confirmation, history and course withdrawal. |
| Student Office | Fees & Payments | `#office/fees` | Existing statement, due amounts, credit, ledger, holds and any supported plan/sponsor detail. |
| Student Office | My Details | `#office/details` | Contact/address/next of kin editing, governed identity correction and programme history. |
| Student Office | Documents | `#office/documents` | Existing issued documents, view/print, verification codes and honest empty states. |
| Student Office | Requests | `#office/requests` | Owned support, identity, withdrawal, arrangement, transfer and applicable admissions records with per-type continuation. |
| Shared | Inbox | `#messages` | Existing notifications; contextual links to supported conversations. |
| Shared | Settings | `#settings` | Password, MFA, sessions and existing profile information; future preferences only when supported. |

Request links carry request type and ID; exam links carry sitting ID. Resource and
document links carry object ID. Programme and period context use encoded hash
query parameters. Never put credentials or private request notes in URLs.

## Page Behaviour

### Study

- Today is action-led: show the next useful action, not decorative counters.
- Initially use authoritative existing information. No invented classes,
  assignment deadlines, unread announcements or lecturer availability.
- A course is an offering in a period. The same course repeated in a later term
  must not reuse another offering's content, grades or lecturer association.
- Course tabs are Overview, Materials, Assessments, Classes and Announcements.
  Phase 1 delivers only supported overview information; subsequent tabs need
  real content or an intentional, useful empty state.
- Timetable distinguishes classes and exams when both exist. Published exam
  seats/instructions and calendar export remain intact.
- Results show only student-authorized published records. Recognized credit,
  attempted credit, completed credit and remaining requirements stay distinct.
- Degree totals must derive from published curriculum/completion rules, not
  guessed denominators or summing every pass. Repeat and elective rules matter.

### Student Office

- Overview is a short administrative briefing, not a second academic dashboard.
- Registration preserves revisions, selections, prerequisites, repeats, clashes,
  holds, exceptions and immutable confirmation records.
- Finance distinguishes balance, due now, future charges and unallocated credit.
  Receipts, payment plans, sponsorship and letters appear only if the student's
  authorized API actually supplies them; otherwise record the capability gap.
- Contact details are editable where allowed. Identity changes require the
  existing evidence and review process; no direct identity-edit shortcut.
- Documents distinguish issued official records from previews. Do not imply a
  transcript has been issued merely because results exist.
- Historical applications remain accessible through an Application history link
  in My Details. Accepted students should not default to admissions screens.

### Requests

| Action origin | Tracking destination |
| --- | --- |
| My Details / Request correction | Requests / Identity correction |
| Timetable / Request arrangement | Requests / Examination arrangement |
| Registration / Request withdrawal | Requests / Course withdrawal |
| Requests / New support case | Requests / Support case |

Use a common list envelope: type, subject, programme, source status, last update,
next actor when known and continuation link. Keep source status and per-type
forms; do not invent a universal write endpoint or flatten distinct approvals.
Open, Awaiting you and Completed filters require explicit per-type mappings.
Unknown next actor is displayed honestly, not inferred as a student obligation.
Admission enquiries retain their separate consent and ownership rules. Private
staff-only notes never become visible through aggregation.

### Shared Context and Communication

- Programme/semester context is visible where relevant and persists across the
  two spaces. Global Inbox and Settings are not misleadingly semester-filtered.
- Validate context against the current account. Clear account-specific state on
  sign-out/switch; handle missing, changed and unauthorized records explicitly.
- Deep links work on refresh and browser back/forward. Switching spaces returns
  to the last valid page without losing a saved draft or silently discarding edits.
- Your attention initially uses existing registration, finance and request data.
  Study prioritizes academic impact; Office shows administrative actions. Both
  use the same underlying states and link to the owning workflow.
- Keep one Inbox in the initial release. Announcements are published updates;
  conversations are threaded replies. Existing support/enquiry threads remain
  scoped to their owners. Lecturer chat and a distinct notification tray are later
  capabilities, not implied by the current notification inbox.
- Shared Help distinguishes guidance/contact information from tracked cases.
  Global search follows later; start with destinations, then authorized data.

## UI Direction

Use [Student Design Language](STUDENT_DESIGN_LANGUAGE.md) for the latest
user-supplied Study / Today visual brief, exact proposed tokens, 1280px student
layout, component anatomy, motion, responsive behaviour and accessibility targets.
It takes precedence over conflicting older student visual guidance.

Use the existing calm, light SVU design language and actual implemented tokens.
Use unframed sections, restrained borders, readable lists and tables, clear focus
states and familiar icon controls. Study emphasizes courses and schedules;
Student Office emphasizes forms and statuses. Do not create separate themes.

Desktop: visible Study / Student Office switch, shared Inbox/profile utilities,
and predictable secondary navigation. Mobile: the space switch remains visible;
each area has a short bottom navigation with More for less frequent pages.
Inbox remains accessible from both. Avoid nested cards and decorative dashboard
grids. Loading, empty, error/retry, permission and partial-data states are required.

## Existing Implementation Sources

| Concern | Existing sources |
| --- | --- |
| Shell/router/session | `src/shell.js`, `src/app.js`, `src/session.js`, `index.html` |
| Student dashboard/academic summaries | `src/home.js`, `src/learning.js`, `src/study-year.js` |
| Student administrative orchestration | `src/apply.js` |
| Existing domain adapters | `src/course-withdrawals.js`, `src/support-cases.js`, `src/registry-identity.js`, `src/registry-finance.js`, `src/registry-exams.js`, `src/registry-exam-arrangements.js`, `src/registry-awards.js`, `src/transcripts.js` |
| Shared repository/communication/security | `src/resources.js`, `src/messages.js`, `src/settings.js` |

The existing student API uses `/api/registry/me` and programme-scoped reads.
Reuse current endpoints and domain adapters. Do not expose staff endpoints to
students to fill a missing capability.

## Boundaries and Evidence

No backend/schema expansion, provider activation, working-database reseeding or
staff/applicant redesign is part of the first phase. The accepted LMS boundary
also assigns course chat and online-class capabilities to the selected LMS or
video integration; native expansion requires a separate architecture decision.

References:
- [Execution plan](STUDENT_EXPERIENCE_EXECUTION_PLAN.md)
- [Claude handoff](CLAUDE_STUDENT_EXPERIENCE_HANDOFF.md)
- [Current student flow](STUDENT_UI_FLOW.md) (historical implementation snapshot)
- [Design language](SVU_DESIGN_LANGUAGE.md)
- [LMS boundary / ADR-008](stage-6/LMS_INTEGRATION.md)

This is a design and planning artifact. No new screen is claimed implemented or
verified by publishing this document.
