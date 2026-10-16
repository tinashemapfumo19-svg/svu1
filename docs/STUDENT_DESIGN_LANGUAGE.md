# SVU Student Design Language

> **Superseded (2026-10-07).** The official design language is now [SVU_UI_STANDARD.md](SVU_UI_STANDARD.md).
> Where the two conflict (tokens, radii, shadows, type sizes, action blue, card usage), the standard wins.
> Keep this file only for the truthful-content and component-intent rules it shares with the standard.

Date: 2026-10-07
Status: Design baseline; Phase 1 implementation approved on 2026-10-07.
Source: User-supplied "South Valley University - Study Homepage Design Language"
brief, received 2026-10-07. This is an implementation-oriented interpretation,
not a verbatim copy or a claim that these components already exist.

## Scope and Precedence

Begin with Study / Today and extend the same system across Courses, Timetable,
Results & Progress, Resources and Student Office. Preserve one application,
session and visual identity. This document is the student-specific visual
reference; it supersedes conflicting student layout/navigation guidance in
SVU_DESIGN_LANGUAGE.md. Existing staff/applicant guidance remains applicable.

Use this with STUDENT_EXPERIENCE_DESIGN.md for page ownership, API boundaries
and truthful capability states, and STUDENT_EXPERIENCE_EXECUTION_PLAN.md for
delivery. The supplied brief's desired search/notifications/classes/progress
modules describe the target experience, not authorization to invent their data.

## Product Character and Principles

The brief's "Apple designed a university operating system" direction means
calm hierarchy, precise alignment, legibility, considered spacing and restrained
motion. It is an aesthetic direction, not an instruction to copy Apple assets.

| Principle | Implementation consequence |
| --- | --- |
| Calm | Reduce competing emphasis; reserve strong color for actions and meaningful states. |
| Contextual | Show selected programme/period and relevant actions; preserve that context in links. |
| Task-first | Make the next useful action visible before historical detail. |
| Academic | Course identity, schedule, published progress and useful content take priority. |
| Premium | Consistent spacing/type, stable dimensions and well-resolved loading/error states. |
| Accessible | Semantic HTML, keyboard access, readable contrast and responsive touch controls. |
| Consistent | Shared shell/tokens across both spaces; vary information density by purpose. |
| Progressive disclosure | Brief summaries link to full records; detail does not overwhelm Today. |

Avoid template-dashboard grids, ERP-style homepage tables, promotional heroes,
heavy glass effects, loud gradients, deep shadows, decorative charts and social
feed styling. Student Office may use dense operational tables when the task
requires them, with the same light, readable visual system.

## Shell and Navigation

Desktop global bar has three zones: SVU mark/wordmark; Study / Student Office
space switch; shared utilities/profile. Keep height at 72px with content aligned
to the page grid. Permit responsive wrapping rather than clipping the wordmark
or overlapping controls. A local navigation row belongs to the same shell.

Study navigation: Today, Courses, Timetable, Results & Progress, Resources.
Office navigation: Overview, Registration, Fees & Payments, My Details,
Documents, Requests. Use an underline and text weight for active navigation,
with `aria-current="page"` on the destination link. Space switches navigate;
use real links, not ARIA tabs that do not implement tab keyboard behaviour.

Target shared utilities include command search, notifications, Inbox and avatar.
Initial rollout uses one Inbox with unread badge, not two overlapping message
destinations. Search is added when supported; Ctrl+K is a shortcut, never the
only entry. A separate notification tray requires distinct useful behaviour.

On mobile the space switch remains visible above content, outside More. Study
bottom navigation: Today, Courses, Timetable, Inbox, More. Office: Overview,
Registration, Fees, Requests, More; Inbox remains in the global shell. More holds
secondary destinations, not the only route to the other space. Allow safe-area
padding and reserve content space for fixed bars.

Profile menu contains identity summary, Settings, Help when implemented and
Sign out. Password, security and sessions are sections of Settings, not competing
global destinations. Preserve authorized staff-area access for multi-role users.

## Layout and Grid

| Property | Student standard |
| --- | --- |
| Application content width | Maximum 1280px including inner gutters; overrides older student 1440px guidance. |
| Desktop gutters | 32px; 48px on spacious outer layouts where content width permits. |
| Tablet gutters | 24px; up to 32px where space permits. |
| Mobile gutters | 16px; 20px on larger phones only when controls still fit. |
| Spacing scale | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px. |
| Today desktop grid | `minmax(0, 1fr) minmax(280px, 320px)` with 32px gap. |
| Section spacing | 32px desktop/tablet; 24px mobile. |
| Repeated-item gap | 16px; course grids use responsive minmax tracks. |

Start with two columns at 1024px and above; below that stack into one column.
These are initial implementation breakpoints, to be adjusted if real content
fails at intermediate widths. Use `min-width: 0` on grid/flex children. Do not
assign viewport-based font sizes or truncate essential course/action text.

Today main column: student context, attention, next supported academic activity,
upcoming, courses, recent updates. Side column: compact programme summary,
supported degree progress and relevant quick actions. These are unframed page
sections, not cards containing more cards. Individual repeated course items may
be cards. One module may receive restrained emphasis without enclosing every
section in elevated boxes.

## Typography

Preferred stack: `Inter, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", sans-serif`. Use an existing local Inter asset when present;
system fallback should work immediately without a network dependency.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 36px / 44px | 600 | Brief student greeting only; 28px / 36px on mobile. |
| Page heading | 28px / 36px | 600 | Main destination heading; 24px / 32px on mobile. |
| Section heading | 20px / 28px | 600 | Next class, My courses, Recent updates. |
| Item/card title | 16px / 24px | 600 | Course title, event title, request subject. |
| Body | 16px / 24px | 400 | Main prose and important information. |
| Helper | 14px / 20px | 400 | Explanations and validation context. |
| Metadata | 13px / 20px | 400 | Secondary dates, course codes and references. |
| Label/control | 14px / 20px | 500 | Form labels and button text. |

Letter spacing is 0. Use sentence case; retain official uppercase course codes.
Limit bold to hierarchy and important values. Long titles wrap; compact panels
do not use display-scale headings. Metadata is readable information, not faint
decoration. Use tabular numerals for times, balances and comparable quantities.

## Color Tokens

White and neutral backgrounds dominate. Blue is an action/brand anchor, normally
under 10-15% of a screen, not the page's background theme. Soft semantic tints
add variety through purpose, not arbitrary course colors.

| Token | Value | Purpose |
| --- | --- | --- |
| `--student-brand` | `#1D9BF0` | Existing SVU brand accent; not automatically suitable for small text. |
| `--student-action` | `#0969A8` | Text links and primary button fill with white text. |
| `--student-action-hover` | `#075786` | Hover emphasis. |
| `--student-action-pressed` | `#064A72` | Pressed emphasis. |
| `--student-bg` | `#FCFCFD` | Main application canvas. |
| `--student-surface` | `#FFFFFF` | Inputs, menus, individual item surfaces. |
| `--student-surface-muted` | `#F3F4F6` | Neutral secondary areas. |
| `--student-text` | `#111827` | Main text. |
| `--student-text-secondary` | `#4B5563` | Readable secondary text and metadata. |
| `--student-border` | `#E5E7EB` | Nonessential dividers. |
| `--student-control-border` | `#6B7280` | Input/control boundary where needed for recognition. |
| `--student-focus` | `#0969A8` | Keyboard focus outline. |
| `--student-success` | `#166534` | Success text/icon. |
| `--student-warning` | `#854D0E` | Warning text/icon. |
| `--student-danger` | `#B91C1C` | Error/destructive text/icon. |
| `--student-info` | `#075985` | Informational text/icon. |
| `--student-tint-course` | `#F0F7FC` | Optional restrained course-item accent. |
| `--student-tint-exam` | `#F4F2FA` | Examination accent. |
| `--student-tint-result` | `#F0F8F2` | Published-result accent. |
| `--student-tint-finance` | `#F3F5F7` | Account summary accent. |
| `--student-tint-announcement` | `#F0F8F8` | Announcement accent. |
| `--student-tint-warning` | `#FFF8E8` | Warning/attention accent. |
| `--student-tint-danger` | `#FEF2F2` | Error accent. |

These are proposed implementation tokens, not claims of completed contrast
testing. Validate actual foreground/background pairs during implementation.
Older light blue, muted gray and bright semantic colors must not be copied into
small text or white-text buttons without checking contrast. Status always has
text/icon meaning in addition to color. Beige is not the dominant student theme.

## Shape and Surfaces

| Element | Radius / treatment |
| --- | --- |
| Page section | Unframed; typography, spacing and subtle dividers establish hierarchy. |
| Repeated item card | 8px; white or soft tint, optional neutral border. |
| Input/button | 6px. |
| Menu/dialog/framed tool | 8px. |
| Icon container | 6px; avoid decoration-only containers. |
| Badge/chip | 4px; use sparingly for actual status/filter values. |
| Avatar | Circular. |

Default surfaces have no shadow. Menus/dialogs may use
`0 4px 16px rgb(17 24 39 / 10%)`; a genuinely interactive repeated item may use
`0 1px 3px rgb(17 24 39 / 6%)` on hover. No nested cards, oversized radii, heavy
glassmorphism or blanket elevation. Subtle visual borders are not substitutes
for accessible control boundaries.

## Icons and Actions

Use one clean outline family, preferably Lucide, with consistent 20px icons and
2px strokes; compact metadata may use 16px. Integrate with existing icon setup
before introducing a dependency. Icons identify functions, not decoration.

| Action type | Standard |
| --- | --- |
| Primary | Action-blue fill, white text; one dominant action per major actionable surface. |
| Secondary | Neutral/light surface, readable text, visible boundary where needed. |
| Tertiary | Text or icon+text, minimal surface treatment. |
| Icon button | Stable 44px touch target, accessible label; tooltip for unfamiliar meaning. |
| Inline link | Semantic link with clear text; underline/focus treatment when appropriate. |

Controls normally have minimum 44px height, 16px horizontal padding and text
that can wrap where necessary. Use icons for refresh, calendar export, search
and familiar tool actions. Use text for commands such as Choose courses, Join
class and View requirements. Navigation uses links; mutations use buttons.
Loading keeps the control's dimensions stable and prevents duplicate submission.

## Today Component Anatomy

| Component | Required content and behaviour |
| --- | --- |
| StudentContext | Greeting plus student number, programme, intake, year and status when known. Unframed; avoid repeating the complete identity record elsewhere. |
| AttentionBanner | Your attention, highest-priority actionable issue, concise impact, owning-destination action; optional secondary link. No false urgency or assumed obligation. |
| NextActivity | Time, course/code, session type, location or configured joining link; preparation link when available. Use Next examination if only exams are supported. |
| UpcomingList | Supported deadlines/events, absolute date/time plus optional time-to-due, course context and exact destination. |
| CourseCard | Code, title, meaningful secondary state, next supported activity and clear course-entry link. Offering-specific identity. |
| ProgrammeSummary | Compact academic context; do not repeat the full greeting/context block. |
| DegreeProgress | Completed, currently attempted and remaining requirement information from authoritative rules; link to full progress. |
| RecentUpdates | Meaningful icon, title, short explanation, relative time with absolute timestamp available, direct object link. Lighter than academic action sections. |
| QuickActions | Small set of frequent, eligible actions with a clear owner; do not duplicate every navigation destination. |

Today answers who the student is academically, what needs attention, what is
next, what is coming, which courses matter and what changed. Full ledgers,
transcript lists, request management, historical tables and forms stay on their
own pages. Missing future capability is not filled with demo-looking content.

## Course, Progress and Feed Rules

Course cards reuse the same anatomy across grids, lists and selectors. Keep the
whole primary entry a semantic link; do not nest interactive buttons inside it.
If multiple actions are necessary, use a titled container with separate links.
Wrap long course titles, keep action placement stable and identify withdrawn or
historical courses in words. Any imagery must be relevant and lightweight; it is
not a requirement to add stock images to every academic course.

Degree progress uses a labelled simple bar or segments, plus textual quantities.
Completed/in-progress/remaining must not be counted twice, exceed the validated
requirement total or imply graduation eligibility from credits alone. Preserve
elective, repeat and recognition rules. If a reliable denominator is unavailable,
show existing completion checks instead of a percentage or guessed bar.

Recent updates show meaningful events rather than duplicating all notifications.
Give each event one destination; keep read state authoritative. Quick actions
require real capability, student eligibility and a useful context. Hide irrelevant
actions; explain important unavailable actions when the reason helps the student.

## Interaction and State Language

- Hover changes color/border subtly; it never shifts layout or enlarges text.
- Focus uses a 2px outline with 2px offset, visible on each actual surface.
- Transitions use 120-180ms ease-out for color/opacity; overlays may use 200ms.
- No bouncy motion, dramatic page transitions or hover-driven layout shifts.
- Respect reduced motion; use static skeletons without animated shimmer when requested.
- Loading reserves approximate content geometry and announces busy state briefly.
- Empty states distinguish no records, no current activity and unavailable capability.
- Errors identify the affected module and offer retry without hiding unaffected data.
- Validation sits beside the field with a clear reason; preserve values on failure.
- Success confirms the actual saved/submitted state and next step, not a vague toast.
- Stale data shows its last update when known; a failed write never appears successful.
- Expired/unauthorized sessions clear private data and use the shared sign-in flow.

## Responsive Behaviour

| Width | Behaviour |
| --- | --- |
| 1024px and above | Two-column Today; compact support rail; full local navigation where it fits. |
| 768-1023px | One-column Today; support summaries become compact sections; shell reflows before collision. |
| Below 768px | One-column flow, visible space switch, bottom navigation, wrapped context and touch-friendly controls. |

Mobile primary order: context, attention, next activity, upcoming, courses,
recent updates, quick actions. Compact programme/progress summaries follow or
use a secondary expandable section without hiding urgent information. Courses
stack by default; any optional horizontal selector has a visible scroll cue and
keyboard access and is not the sole means of finding a course. Tables belong on
detail pages; use a labelled scroll region or readable row layout when needed.

Verify 320, 390, 768 and 1440px plus intermediate widths. No whole-page horizontal
overflow, clipped navigation, obscured controls or overlapping text. Preserve
drafts during connection failures, keep asset payloads modest, avoid autoplay
and never claim offline submission unless an actual delivery mechanism exists.

## Accessibility and Content

Target WCAG 2.2 AA during implementation; documentation alone is not evidence
of conformance. Check normal text contrast at 4.5:1, qualifying large text at 3:1,
and required control/focus contrast at 3:1. Use semantic landmarks, one page h1,
logical heading order, labelled inputs, keyboard-operable menus and skip link.
Support 200% zoom/reflow and screen-reader announcements for important state
changes. Dates/time zones and academic references must be understandable.
Use words/icons as well as colors; tooltips supplement accessible names.

Copy is clear, calm, respectful and concise. Prefer Choose courses, View
requirements, Next class, Recent updates and View account. Avoid institutional
jargon, vague system states and playful urgency. Do not put implementation
instructions or descriptions of styling/features in product screens.

## Implementation and Review

Component names above describe reusable anatomy, not a requirement to adopt a
new framework or class hierarchy. Extend existing plain-JavaScript patterns;
add helpers only for meaningful repeated behaviour. Namespace student tokens
and scoped styles so staff/applicant pages do not change unintentionally.

Before coding, map proposed tokens to existing CSS and note deliberate overrides:
1280px student width, two-space navigation, accessible action/text colors and
controlled radii. Codex owns shared CSS/shell integration; Claude uses those
tokens in scoped Student Office CSS. Both use this document for visual review.

Acceptance: students can identify their academic context and next action quickly;
Study and Office share identity but serve distinct tasks; all supported states
are legible; course/resource entry is clear; mobile and keyboard flows work;
screenshots demonstrate coherent spacing, no overlap and truthful data.

Review artifacts should include populated, empty, blocked, error and loading
screens where feasible. Record visual/behaviour checks and remaining gaps in
the execution receipt. No application code changed as part of this documentation.
