# Screen-by-Screen UI Refactor

## Student Spaces: Phase 1 (7 October 2026)

Study + Student Office are implemented using the existing backend workflows.
Codex owns the integrated shell and pages; Claude provided Office regression
tests and Study/Office reviews. Substantive review fixes are integrated.
The final selected browser/unit/API tests passed, but concurrent Claude visual
edits failed the source-stability guard. A clean post-redesign checkpoint is
still required; see the execution plan's receipt rather than treating this as
full visual acceptance.
The earlier student destination model below is historical; see
[Student UI Flow](STUDENT_UI_FLOW.md) for current routes and
[Execution Plan](STUDENT_EXPERIENCE_EXECUTION_PLAN.md) for verification status.

## Assessment of the Brief

The strongest parts are the distinction between records and requests, direct
destinations, progressive detail, shared role-aware anatomy, and truthful
loading/error states. These address concrete issues in the current platform.
Apple-inspired should mean legibility and restraint, not decorative imitation.

Staff screens must still support fast scanning, comparison and repeated work.
Spacing should vary with task density; a finance table should not inherit a
student dashboard's whitespace. Build reusable components when the screens
demonstrate a shared need rather than create every listed abstraction upfront.

Home, Workspace, Records, Resources and Inbox are a useful destination model.
The migration must retain legacy links and authorized role-specific routes
until real replacements exist. Changing labels without splitting the portal
would not implement this information architecture.

## Completed First Pass

### Screen 01: Shared Sign-In

- Unframed, branded form with a restrained type hierarchy and 48px controls.
- Matching presentation for password, recovery and MFA stages.
- Busy state and disabled controls; errors announced as alerts.
- Entered values survive a failed request for retry, in memory only.
- Existing session/MFA/recovery/cancellation endpoints and rules preserved.
- Focus indicator and reduced-motion treatment.

### Screen 02: Signed-In Home

- Student identity/programme displayed without a floating dashboard container.
- Registration attention precedes academic summaries and recent updates.
- Selected-course and credit counts, with an honest count of blockers.
- Balance and amount due shown separately; no claim that future charges are
  overdue. Financial hold state remains based on the actual account response.
- Published-result summary and next published exam use live owned records.
- Recent updates use the notification inbox; no external delivery claim.
- Sections use typography and dividers rather than nested cards.
- Staff directory links retain their permissions and routes in a lighter layout.
- Partial data failures are explicitly listed with retry; unaffected content
  remains usable. Account-profile failure has a visible retry state.
- Structured initial loading state rather than an empty dashboard.

This is the first pass on these screens. Shared navigation has not yet migrated
to the five-destination model, and Home links still use existing routes. The
public applicant landing page has not been redesigned in this pass.

## Next Screens and Acceptance Criteria

| Order | Screen | Required change | Acceptance focus |
| --- | --- | --- | --- |
| 03 | Shared shell and programme context | Workspace/Records destinations; programme selector; legacy route compatibility | Role visibility, programme consistency, keyboard/mobile navigation, back/refresh |
| 04 | Student Workspace overview | Active tasks and requests; current application only when relevant | No historical admissions dominance; no invented actions |
| 05 | Course registration | Dedicated route; course selection, nearby blockers, expandable clearance context | Selection revision, prerequisites, repeats, clashes, holds, confirmation snapshot |
| 06 | Student requests | Consistent request queue/detail; identity, withdrawals, arrangements, enquiries, support | Per-type validation, private-note isolation, approval states, rejected/returned outcomes |
| 07 | Programme and course records | Authoritative programme/study-year/course/history screens | Matching programme context; records distinguished from requests |
| 08 | Published results and transcript | Separate destinations and clear issuance/empty states | Published only; no implied transcript issuance |
| 09 | Examination records | Dedicated timetable; readable mobile rows; arrangement deep links | Published editions, eligibility, calendar export, sitting context |
| 10 | Finance records | Statement, payments, due/future charges and holds | Balance versus due, receipts, plans/sponsorships when present |
| 11 | Application history and identity | Historic admissions under Records; governed identity separate from profile | Accepted-student terminology, correction request versus direct edit |
| 12 | Resources | Search/result/detail with consistent access states | Private assets, scan/publication state, view/download permission |
| 13 | Inbox | Notifications and discoverable conversation links without mixing data | Owned unread counts; support conversation remains scoped |
| 14 | Account/security | Profile, password, MFA and sessions | Recovery code handling, revoked/expired sessions, identity distinction |
| 15 | Lecturer Home/Workspace/Records | Teaching priority, allocations, class lists, assessment work | Real teaching data; no invented attendance/LMS services |
| 16 | Admissions and registry workspaces | Shared queues/request anatomy and contextual student detail | Scope and independent decisions; existing workflow controls retained |
| 17 | Finance operations | Efficient filters, dense readable ledgers and review surfaces | Reconciliation, approvals, immutable ledger and reason capture |
| 18 | Examinations, support and administration | Apply the shared screen anatomy to operational areas | Permissions, custody/private notes, publishing and audit controls |

The stages are queued, not completed. Each migration should include screenshots,
desktop/tablet/mobile inspection and behavioral checks suited to that screen.
Final cross-role, accessibility and complete-suite acceptance remain separate.

## Verification of Screens 01-02

On 6 October 2026:

- Live demo screenshots inspected at 1440px desktop and 390px mobile; rendered
  checks also passed at 768px tablet, without page errors or horizontal overflow.
- JavaScript syntax checks passed for the modified shell and Home modules.
- Isolated browser checkpoint passed 12 desktop/mobile cases: app-shell,
  home-refinement and current-session MFA revalidation.
- New behavioral checks verify sign-in retry preserves values and a failed
  notification load is shown as an error, then recovers through retry.
- Isolated database was dropped; executable source guard passed at
  6a33efa97b27710c340b1f3cc79829f88407c36a100dc38837939d660d251885.

The initial checkpoint failed two shell cases because a styling class used by
the existing test was removed. That hook was restored; all selected cases then
passed. No broader full-suite claim follows from this checkpoint.

Demo URL: http://127.0.0.1:4188/#signin. The server remains running.
