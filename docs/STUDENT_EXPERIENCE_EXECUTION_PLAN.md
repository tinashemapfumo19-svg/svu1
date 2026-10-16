# Student Experience Execution Plan

Date: 2026-10-07
Status: Phase 1 functional implementation delivered; post-redesign stable-source verification remains with Claude.
Design baseline: [Study + Student Office](STUDENT_EXPERIENCE_DESIGN.md).
Visual baseline: [Student Design Language](STUDENT_DESIGN_LANGUAGE.md).
Coordinator: Codex. Collaborator: Claude (Office tests and Study/Office review).

## Authorization and Delivery Rules

The user subsequently gave the explicit instruction "now implement" on
2026-10-07. This authorizes Phase 1. The earlier documentation-only gate below
records the planning state and is no longer the current implementation blocker.
The user subsequently confirmed Codex as the single Office implementation
owner. Claude supplies Office tests and cross-review; its alternative unused
Office modules were removed by Claude. The integrated pages live in
`src/student.js` and `src/student.css`. Original proposed ownership below is
historical, not a current instruction to introduce separate Office modules.

Original planning gate (superseded by approval): this turn authorizes
documentation and delegation preparation only. Neither
agent should change executable files or start implementation from this plan
until the user gives the go-ahead. Later capability phases need their own scope
decision; approval of Phase 1 does not authorize a full LMS or payment gateway.

Use existing plain JavaScript modules and local adapters. Preserve user changes.
Do not broadly rewrite shared files or change server contracts for navigation.
Do not reseed the working database. Use the isolated integration harness for
mutating verification. Do not publish or activate external providers.

## Work Packages and Delegation

Every implementation ticket below starts as **Awaiting approval**. Assignments
are proposed ownership, not evidence that Claude has accepted or run a task.

| ID | Owner | Deliverable | Dependencies |
| --- | --- | --- | --- |
| UX-01 | Codex | Endpoint/capability audit and route/context contract, including old-route aliases and multi-role behaviour. | User go-ahead |
| UX-02 | Codex | Shared shell, student route dispatch, validated programme/period context and visible mobile space switch. | UX-01 |
| UX-03 | Claude | Student Office Overview, My Details, Documents and read-only finance surfaces using existing adapters. | UX-01 contract |
| UX-04 | Claude | Registration, confirmation and withdrawal surfaces preserving existing controls. | UX-01 contract; UX-03 scaffolding |
| UX-05 | Claude | Requests list/detail adapters and scoped continuation links, with explicit status/filter mappings. | UX-01 contract; endpoint audit |
| UX-06 | Codex | Study Today, Courses/offering overview, published exam timetable, Results & Progress and Resources route integration. | UX-01; UX-02 |
| UX-07 | Codex lead; Claude supplies Office mappings | Existing-data Your attention, cross-space links and retained application history entry. | UX-03 through UX-06 |
| UX-08 | Codex | Central integration, legacy aliases and shared Inbox/Settings compatibility. | UX-02 through UX-07 |
| UX-09 | Claude reviews Study; Codex reviews Office | Cross-review, desktop/mobile evidence, focused behaviour tests and regression checkpoint. | UX-08 |
| UX-10 | Codex | Final documentation, unresolved-capability list, verification receipt and preview URL. | UX-09 |

## File Ownership

| Owner | Reserved write surface after approval |
| --- | --- |
| Codex | `src/app.js`, `src/shell.js`, `src/session.js`, `src/home.js`, `src/learning.js`, `index.html`, shared `src/styles.css`, new Study/context modules and shared-route tests. |
| Claude | New `src/student-office.js`, `src/student-office.css`, new per-page Office modules only where needed, and Office-specific browser tests. |
| Coordinated | Existing domain adapters, `src/apply.js`, `src/resources.js`, `src/messages.js`, `src/settings.js`, shared test fixtures and `scripts/integration.js`. No independent concurrent edits. |

New filenames are planned, not requirements to introduce an abstraction for
every page. Codex alone wires scripts/styles into index.html and merges shared
navigation/CSS changes. Claude provides narrowly scoped adapter patch requests
for coordinated files. Backend files and migrations are outside Phase 1.

Before editing, announce ticket, files and dependencies in the workspace log.
Before a shared-file change, inspect its current contents and coordinate its
owner. Only one agent runs the shared integration harness/port at a time;
announce and release the verification window. Historical log claims are not
proof of a currently running process or current test pass.

## Phase 1: Existing Capability Restructure

### Step A: Audit and Contract

Codex verifies each page's student-authorized inputs, current guards and adapter
assumptions. Record missing self-service data rather than inventing controls.
Publish route parsing, context validation and a small module API before parallel
page work. Identify endpoints whose finance/request content is not currently
student-visible. Confirm how accepted applications map to programme records.

Proposed module contract to settle in UX-01:
- `render(root, context)` with programme ID, period ID and authorized record context.
- Session access through existing `svuSession`; no new token store.
- Navigation through one shared URL builder; encoded identifiers/query values.
- Re-render after context changes; stale responses cannot overwrite a new account
  or programme. Unmount/session changes invalidate pending reads.

Proposed legacy route policy:
- Active-student `#home` -> Study / Today.
- Active-student `#learning` -> Study / Courses, preserving supported context.
- Active-student `#apply` -> Office / Overview unless explicit application-history
  intent is supplied. Applicant `#apply` keeps the application flow.
- Preserve shared `#messages`, `#settings`, public verification and nonstudent routes.
- Existing `#resources` remains compatible; add a Study alias without breaking
  current resource module location checks.

Gate: route and data contract is recorded, including multi-programme, repeated
course and multi-role cases. Implementation then proceeds within approved scope.

### Step B: Shell and Parallel Page Work

Both agents implement against STUDENT_DESIGN_LANGUAGE.md. Codex maps its proposed
tokens into scoped shared CSS; Claude consumes those tokens in Office styles.
Verify the Today two-column layout, typography, light surfaces, mobile stacking,
focus/contrast and truthful supported modules before extending the visual system.

Codex delivers navigation/context and Study; Claude delivers Student Office.
Keep secondary page modules independent of shared router internals. Reuse
existing forms and transaction APIs. Preserve applicant history as a secondary
destination instead of removing access to accepted application evidence.

For each screen, provide loading, empty, partial failure/retry, permission and
success states. Preserve drafts on failed writes; avoid losing unsaved input on
space/context changes. Display registration and request status from the server.

Gate: every existing student workflow has a destination; unsupported features
are recorded; desktop/mobile navigation and deep links work.

### Step C: Requests and Attention

Claude supplies per-type request readers/mappings and source detail actions.
Codex integrates shared existing-data attention entries and cross-space links.
Aggregate reads without changing independent review, source statuses, consent
or staff-only fields. If an API cannot supply a reliable next actor/update time,
record that gap and show truthful available information.

Gate: students can trace each action from notice to owning workflow and back;
no duplicated submission form or contradictory action state.

### Step D: Verification and Handoff

Run syntax checks for changed modules, appropriate existing units, and affected
isolated desktop/mobile journeys. Adapt tests to new destinations while keeping
their business assertions. Finish with the required broader integration check
once the combined source is stable. Inspect screenshots at 1440, 768 and 390px,
plus 320px overflow; check focus, zoom, long text and controls with keyboard.

Candidate existing suites: app-shell, home-refinement, academic-records,
course-withdrawal, identity-corrections, student-finance, exam-timetable,
exam-arrangement-layout, graduation-awards, document-repository, messages and
MFA/session revalidation. Confirm exact files and harness selector syntax before
running. Never use production or the working development database as a test fixture.

## Acceptance Journeys

1. Active student signs in -> Today; applicant and staff entry remains correct.
2. Switch programme/semester -> corresponding courses, exams, results and fees;
   repeated offerings remain distinct; sign-out clears private context.
3. Open saved link or use refresh/back/forward -> same authorized page/object.
4. Registration blocker -> relevant fee/academic detail -> retained selection ->
   eligible confirmation with unchanged server controls and receipt.
5. Confirmed course -> request withdrawal -> independent review -> truthful
   course/roster state, with retained historical results/receipt evidence.
6. Published exam -> arrangement request -> tracked case -> correct sitting and
   approved personal instruction; private notes remain scoped; ICS still works.
7. Identity correction/support/enquiry -> source-specific form -> request history;
   replies, awaiting-student states and consent work as originally authorized.
8. Published results/progress -> issued document -> view/print; unpublished grades
   are absent and missing issuance does not masquerade as an official document.
9. Inbox/resource/settings -> permission-correct data, downloads, unread state,
   password/MFA/session flows; no regressions from route aliases.
10. Missing endpoint, failed request, expired session or context switch during a
    response -> clear recoverable state, no stale/private data from another context.

## Later Phases (Not Authorized by Phase 1)

| Phase | Scope | Prerequisite |
| --- | --- | --- |
| 2 | Permission-aware global search, better request next-action data and richer curriculum-derived degree progress. | Verified Phase 1; approved endpoint gaps and progress rules. |
| 3 | Course materials, announcements, lecturer/class information and configured LMS links. | Content owners, offering-level data, publication/access rules and ADR-008-compatible contracts. |
| 4 | Selected LMS connector/class integration, payment provider and optional messaging. | Provider selection and explicitly approved integration scope. |
| 5 | Additional native academic capabilities only where justified by actual usage. | Separate architecture/product decision; no silent full-LMS expansion. |

## Completion Receipt

Each completed ticket records files, behaviour, checks/artifacts and remaining
gaps in the workspace log. Final receipt distinguishes implemented capability
from future design, reports failures honestly and provides the running preview
URL. Update current flow/function-map documents after verified implementation;
do not overwrite historical evidence with planned behaviour.

## Historical Setup Receipt (Before Approval)

- Design baseline and this plan created; no executable implementation changed.
- Claude handoff prepared in [CLAUDE_STUDENT_EXPERIENCE_HANDOFF.md](CLAUDE_STUDENT_EXPERIENCE_HANDOFF.md).
- Shared workspace coordination links added.
- Claude has not acknowledged this assignment; no direct Claude delivery or
  execution is claimed. User go-ahead remains the implementation gate.

## Implementation Update (2026-10-07)

The gate above has now been satisfied. New `src/student.js` / `src/student.css`
provide Study and Student Office pages using current APIs and exported existing
student form renderers. Shared shell/router/index integration and Resource route
compatibility are in place. Existing applicant history is `#apply?history=1`.

UX-01 through UX-08 are implemented. UX-09 reviews were delivered by Claude,
and Codex integrated the substantive fixes and Claude's Office browser suite.
The proposed separate Office file ownership above is superseded by the user
choosing Codex as integrated implementation owner. Claude now owns the newer
SVU_UI_STANDARD visual rollout; that is separate from this Phase 1 functional
receipt and will need its own final verification.

Final combined isolated run: all 14 selected desktop/mobile browser cases,
unit tests and 22 API smoke suites passed. The isolated database was dropped.
The harness nevertheless exited 1 because Claude's concurrent visual rollout
changed source files during the run. This functional receipt is not a clean
acceptance certificate for the latest redesigned build. Claude owns the fresh
stable-source visual/functional checkpoint after its rollout. UX-10 functional
documentation/handoff is delivered; app-wide visual acceptance is outstanding.

Receipt: `data/student-experience-acceptance-receipt.json`; screenshots/traces:
`data/student-experience-acceptance/`. Earlier clean checkpoints and the first
combined failed browser run are recorded separately in the workspace log.
Local preview: http://127.0.0.1:4173/#study/today; frontend/backend health and
database connectivity were confirmed. Live records were not reseeded.

Future class/material/assessment tabs, global search, lecturer chat, provider
payments and a full credit-based degree visualization are not implemented by
this restructure. No unsupported CTA or fabricated academic content is added.
