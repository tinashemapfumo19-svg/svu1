# SVU UI Standard

Final refinement (2026-10-07): [STUDENT_VISUAL_REFINEMENT.md](STUDENT_VISUAL_REFINEMENT.md)
supersedes conflicting presentation values below. The permanent canvas is now
`#F4F7FB`, desktop content is 1320px, and compact student compositions, campus
assets and keyboard command search follow that refinement. Existing workflow,
permission and truthful-data requirements remain unchanged.

Status: **OFFICIAL**. Adopted by the user on 2026-10-07 as the design language for the whole application.
Supersedes: [STUDENT_DESIGN_LANGUAGE.md](STUDENT_DESIGN_LANGUAGE.md) and [SVU_DESIGN_LANGUAGE.md](SVU_DESIGN_LANGUAGE.md) wherever they conflict. The truthful-data, API-boundary and workflow rules in [STUDENT_EXPERIENCE_DESIGN.md](STUDENT_EXPERIENCE_DESIGN.md) and ADR-008 still apply unchanged.
Implementation status (2026-10-07): **applied app-wide**.
- `src/svu-ui.css` holds the tokens, the component library and an app-wide layer that restyles every shared class.
- `src/student.css` and `src/student.js` build the student screens from those components.
- Staff, applicant, public and system screens conform through the shared classes, with no markup changes.
- Verification receipts are in `docs/CODEX_CLAUDE_WORKSPACE.md`.

## Staff and other screens (2026-10-12)

Every non-student screen now uses the live Study / Office anatomy, not only its colours. See "Staff screen anatomy" at the end of this document.

## 1. Intent

SVU should feel like a modern macOS application, "Apple designed a university operating system": refined, tactile, layered, spacious, precise, calm, highly structured, premium without decoration. It should feel like macOS System Settings, Apple Music desktop or Apple account pages. It should not feel like an intranet, Bootstrap, Moodle, an ERP admin page, or text separated by horizontal rules.

Hierarchy comes from, in order: **spacing → surface grouping → typography → alignment → color → borders → motion**.

- Horizontal rules are never the main way to organise a page.
- Important sections never dissolve into the page background. Each major region sits on a defined surface.
- Fix missing structure with spacing, surfaces, typography, tint and interaction, never by making things heavy.
- The same semantic component always looks the same, on every page and in both spaces.

## 2. Tokens

Define these once, globally, on `:root` in the shared stylesheet. Pages and components use tokens and never hard-code colours, radii, shadows or spacing.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--svu-bg-page` | `#F4F7FB` | Permanent bluish app canvas; never pure white. |
| `--svu-bg-elevated` | `rgba(255,255,255,0.86)` | Translucent shell and toolbars (with blur) |
| `--svu-bg-solid` | `#FFFFFF` | Cards, inputs, menus |
| `--svu-bg-muted` | `#F8FAFC` | Inset areas, hover rows, empty-state base |
| `--svu-text-primary` | `#0F172A` | Main text |
| `--svu-text-secondary` | `#64748B` | Secondary text **on white surfaces only** (4.76:1) |
| `--svu-text-secondary-on-page` | `#5B6B80` | Secondary text placed directly on `--svu-bg-page` (5.07:1; `#64748B` is 4.43:1 there, below AA) |
| `--svu-text-tertiary` | `#94A3B8` | Placeholders, disabled text, decorative icons only. **Never meaningful text** (2.56:1) |
| `--svu-border` | `rgba(15,23,42,0.08)` | Card and section borders |
| `--svu-border-strong` | `rgba(15,23,42,0.12)` | Input, select and secondary-button borders |
| `--svu-blue` | `#2563EB` | Primary actions, links, active state, focus (5.17:1 on white) |
| `--svu-blue-hover` | `#1D4ED8` | Hover |
| `--svu-blue-pressed` | `#1E40AF` | Active/pressed |
| `--svu-blue-soft` | `#EFF6FF` | Selected rows, active tab fill, info badges |
| `--svu-green` | `#16A34A` | Icons and progress fills only |
| `--svu-green-text` | `#15803D` | Green text on `--svu-green-soft` (4.79:1; `#16A34A` is 3.15:1) |
| `--svu-green-soft` | `#F0FDF4` | Success surfaces |
| `--svu-amber` | `#D97706` | Icons and borders only |
| `--svu-amber-text` | `#B45309` | Amber text on amber tints (4.71:1; `#D97706` is 2.99:1) |
| `--svu-amber-soft` | `#FFF7E6` | Warning surfaces |
| `--svu-red` | `#DC2626` | Icons and borders only |
| `--svu-red-text` | `#B91C1C` | Red text on `--svu-red-soft` (5.91:1; `#DC2626` is 4.41:1) |
| `--svu-red-soft` | `#FEF2F2` | Error/blocked surfaces |
| `--svu-purple-soft` | `#F5F3FF` | Lavender accent surfaces |

These contrast ratios are measured. Status is never shown by colour alone: always give it words, and an icon where useful.

### Gradients (structural, subtle, never behind dense body text at high saturation)

| Token | Value | Use |
| --- | --- | --- |
| `--svu-grad-hero` | `linear-gradient(135deg, rgba(239,246,255,.95), rgba(255,255,255,.95) 48%, rgba(245,243,255,.82))` | Hero regions, page greeting |
| `--svu-grad-attention` | `linear-gradient(135deg, #FFF9EC, #FFFDF7)` | Attention card, warning summaries |
| `--svu-grad-blue` | `linear-gradient(145deg, #EFF6FF, #F8FBFF)` | Course card (blue), selected summary tile |
| `--svu-grad-green` | `linear-gradient(145deg, #F0FDF4, #F8FFFA)` | Course card (green), completion tiles |
| `--svu-grad-lavender` | `linear-gradient(145deg, #F5F3FF, #FBFAFF)` | Course card (lavender), feature cards |
| `--svu-grad-empty` | `linear-gradient(145deg, #FFFFFF, #F8FAFC)` | Empty states |

Course cards cycle blue → green → lavender in a fixed order based on the offering, so the same course always gets the same tint.

### Spacing (strict 4px grid)

Allowed values only: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80**. Tokens: `--svu-space-1` (4px) through `--svu-space-11` (80px), following that list.

| Relationship | Value |
| --- | --- |
| Icon to text | 4px |
| Tight metadata | 8px |
| Label to value | 8px (6px allowed inside dense rows, as the brief specifies) |
| Small internal grouping | 12px |
| Standard component gap | 16px |
| Compact card padding | 20px |
| Default card padding | 24px |
| Page header to first section | 32px |
| Section to section | 32–40px (Study 40px, Office 32px) |
| Card title to content | 16–20px |
| Page-level separation | 48px |
| Hero breathing room | 64px or more |

### Radius, depth, motion

| Token | Value |
| --- | --- |
| `--svu-radius-badge` | `999px` |
| `--svu-radius-control` | `10px` (inputs, selects, icon buttons, hovered rows) |
| `--svu-radius-button` | `11px` |
| `--svu-radius-row` | `12px` (selectable rows) |
| `--svu-radius-card-sm` | `14px` (small cards, context bar) |
| `--svu-radius-course` | `16px` |
| `--svu-radius-card` | `18px` (standard and attention cards) |
| `--svu-radius-card-lg` | `20px` (feature cards, empty states) |
| `--svu-shadow-1` | `0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.04)` (standard cards) |
| `--svu-shadow-hover` | `0 10px 30px rgba(15,23,42,.08)` (interactive card hover) |
| `--svu-shadow-2` | `0 12px 32px rgba(15,23,42,.12)` (menus, dropdowns, popovers) |
| `--svu-shadow-3` | `0 24px 64px rgba(15,23,42,.18)` (modals) |
| `--svu-ease` | `cubic-bezier(.2,.8,.2,1)` (ease-out) |
| `--svu-dur` | `160ms` (range 140–180ms; colour, background, shadow, transform) |

Depth levels:
- **0:** flat page.
- **1:** cards.
- **2:** menus and floating controls.
- **3:** modals.

Not every card gets a strong shadow. A card hover is `translateY(-1px)` plus `--svu-shadow-hover`, and only on cards that are entirely clickable. With `prefers-reduced-motion`, drop the transforms and keep colour changes.

## 3. Typography

Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Use tabular numerals for times, money, credits and counts.

| Role | Size / line height | Weight | Tracking |
| --- | --- | --- | --- |
| Display / greeting | 36 / 42 (mobile 28 / 34) | 650–700 | -0.03em |
| Page title | 30 / 36 (mobile 24 / 30) | 650 | -0.02em |
| Section heading | 20 / 28 | 650 | -0.01em |
| Card heading | 16 / 22 | 600 | 0 |
| Body | 14 / 21 | 400–450 | 0 |
| Strong body | 14 / 21 | 550–600 | 0 |
| Label | 13 / 18 | 550 | 0 |
| Metadata | 12–13 / 18 | 450 | 0 |
| Helper | 12 / 18 | 400 | 0 |
| Eyebrow | 11 / 16 | 600 | 0.02em, uppercase optional |

No text under 12px, except the 11px eyebrow. Don't over-bold; combine weight, spacing and tone. Use sentence case, but keep official course codes in uppercase.

## 4. Layout and alignment

- **One container:** `max-width: 1280px`, centred. Use 1360px only for dense administrative screens. Horizontal padding: desktop 32px, large desktop (≥1440px) 40px, tablet 24px, mobile 16px.
- Global header, space switcher, secondary navigation, context bar, page header, section headers and cards all start on the **same left edge**. No arbitrary offsets.
- Use a 12-column internal grid with a 24px gutter (32px for the Study dashboard).
  - Study dashboard: content 8 columns, right rail 4 columns (about 320–360px).
  - Forms: 6–8 columns.
- Breakpoints:
  - ≥1024px: multi-column.
  - 768–1023px: card grids reduce columns and the right rail stacks under the main content.
  - <768px: single column.
- No horizontal page overflow at 320px or wider.
- Density: Study is more visual, with 40px between sections and more cards. Student Office is more structured, with 32px between sections and more lists and forms. Both use the same components.

## 5. App shell

| Part | Specification |
| --- | --- |
| **Global header** | 64px tall, `--svu-bg-elevated`, `backdrop-filter: blur(18px) saturate(1.4)`, bottom border `1px solid rgba(15,23,42,.06)`, sticky. Three zones aligned to the container: **left** logo and "South Valley University"; **centre** space switcher; **right** search (only when search exists; never a dead control), notifications, avatar. |
| **Space switcher** (Study / Student Office) | A segmented control inside a 4px-padded track (`--svu-bg-muted`, radius 12px). Segments are 36px tall with radius 10px. Active: blue text on `--svu-blue-soft`. Inactive: secondary text, with a muted hover. These are real links with `aria-current="page"`. On mobile it stays visible under the header, full width. |
| **Secondary navigation** | A 48–52px band aligned to the container, holding Study or Office destinations. Active: primary text with a 2px blue underline. No background pill as well; one treatment only. Hover changes colour only. If it overflows on mobile, it becomes a single horizontally scrollable row with edge fade, never wrapping onto a second line. |
| **Context bar** | One toolbar surface: `rgba(255,255,255,.72)`, 1px `rgba(15,23,42,.06)` border, radius 14px, padding 12px 16px, flex with 16–24px gap. Each selector has a small label above a strong value and a chevron, e.g. "Programme / BSc Information Systems · February 2027 ▾". The student number sits far right as muted metadata. On mobile it becomes a one-line summary with a "Change" disclosure. |
| **Mobile bottom navigation** | Keep as specified in the student experience design, styled with the same tokens. Leave room for the safe area. |

## 6. Components

These form the shared component library. One implementation each, reused everywhere. Do not write page-specific CSS that redefines them.

| Component | Anatomy and rules |
| --- | --- |
| **PageHeader** | Eyebrow (space name), page title, one-line supporting description, optional status badge and actions on the right. 32px below. Never just "Student Office / Registration" over empty space. |
| **SectionHeader** | Title (20px), optional one-line description, optional action link on the right, aligned with the title baseline. 16–20px to content. |
| **SurfaceCard** | `--svu-bg-solid`, `--svu-border`, `--svu-shadow-1`. Sizes: small (16–20px padding, radius 14px), standard (24px, 18px), large (28–32px, 20px). Multi-row content uses subtle internal dividers; there are no full-width rules elsewhere. |
| **FeatureCard** | A large card with `--svu-grad-hero` or `--svu-grad-lavender`, for hero and context regions. |
| **AttentionCard** | `--svu-grad-attention`, border `1px solid rgba(217,119,6,.14)`, radius 18px, padding 24px. Warning icon in a 36px amber-tint container, eyebrow, title, supporting data, primary button. Desktop: content left, action right. Mobile: stacked. A blocked state uses the red variant (`--svu-red-soft` gradient and border). |
| **EmptyState** | Every empty list is a designed component: 40px icon in a soft container, title, one-sentence explanation, optional action. Min-height 220–280px, centred, `--svu-grad-empty`, radius 20px. Copy states what will make content appear; no half-blank viewports. |
| **StatusBadge** | 24–28px tall, padding 0 10px, radius 999px, 12px/600 text, with an optional 6px dot. Active and success: green soft with green text. Open and info: blue soft with blue text. Pending and warning: amber soft with amber text. Blocked and error: red soft with red text. Completed and neutral: muted with secondary text. Always words, never a bare raw code (map `onboarded` → "Active student", and so on). |
| **Button** | **Primary:** 44px, padding 0 18px, radius 11px, 14px/600, blue background with white text, hover `--svu-blue-hover`, pressed `--svu-blue-pressed`. **Secondary:** 42px, padding 0 16px, radius 11px, white, `--svu-border-strong`, primary text. **Tertiary:** 36–40px, transparent, blue text. **Disabled:** `#E8EEF8` background, `--svu-text-tertiary` text, no shadow, `cursor: not-allowed`; it should look deliberate, not broken. Transitions use `--svu-dur`. No native-looking buttons anywhere. |
| **IconButton** | 40 × 40, radius 10px, an 18–20px icon and an accessible label. The touch target is 44px on mobile (pad the hit area). |
| **FormField** | Label 13px/550, 8px above the control. Helper 12px secondary, 6px below. Error in red text with an icon. Fields 20–24px apart. |
| **Input / SelectField** | 44px, radius 10px, padding 0 14px, `--svu-border-strong`, white. Focus: border blue plus `0 0 0 3px rgba(37,99,235,.12)`. Selects use `appearance: none` with one consistent chevron icon. Checkboxes and radios are custom-styled at 18px with a 5px radius, blue when checked. No native styling shows through. |
| **InlineAlert** | Tinted surface (info, success, warning or error), 12px radius, icon, title and body. Errors use `role="alert"`, success uses `role="status"`. |
| **CourseCard** | About 250–300px wide in a grid of 2–4 columns, padding 20px, radius 16px, course gradient. Course code eyebrow, title (16px/600, wraps), next supported activity line, credits, status badge. The whole card is one link; hover lifts it. |
| **CourseSelectionRow** | Min-height 64px, padding 16px, radius 12px. Checkbox, code, title, credits, type, availability. Hover: muted surface. Selected: `--svu-blue-soft` with a blue border. Disabled or recognised courses get a muted surface and a reason badge. |
| **RequirementRow** | Replaces raw blocker bullets. Amber (or red when blocking) icon, title ("Repeat approval required"), one-line explanation, optional action link to the owning page. Sits in an amber-tinted card. |
| **RegistrationSummary** | Card with the course count, credit count against the maximum (with a bar), any blockers, and the grouped actions Save selection (secondary) and Confirm registration (primary). Desktop: sticky in the right rail. Mobile: placed after the selection. |
| **ProgressCard** | A large number ("120 / 360 credits"), an 8px bar with radius 999px in segments (completed, in progress, remaining), and a small legend. Only shown from authoritative completion rules. Otherwise a designed empty state; never a guessed denominator. |
| **QuickActionRow** | 48–52px rows inside a card: 32px icon container, label, chevron right next to it (not floating far away), subtle dividers between rows, hover a muted surface with radius 10px. |
| **ProgrammeCard**, **StudyYearCard** | Structured fact list (label above value). A study year shows "Year 1 · Semester 1", a status badge, dates ("1 Feb – 30 Jun") and the reference, with a "View history" disclosure. No bullet dumps. |
| **ActivityItem / NotificationRow** | 40px icon container, title, metadata line, relative time with the absolute time available, chevron. Unread shown with a dot and strong weight. |

**Icons:** use the existing shell glyph set, which matches Lucide-style outlines; extend it rather than adding a second family.
- Size: 18–20px default, 20px for section icons, 22–24px for hero icons.
- Stroke: 1.75–2px.
- Icon containers: 32–40px, soft-tinted, radius 10px.

**Interaction:**
- Hover changes colour, background or shadow within 140–180ms, ease-out.
- Clickable cards lift by 1px.
- Focus is always visible: a 2px blue outline with 2px offset, or the input focus ring.
- No bouncing, no layout shift on hover.

## 7. Screen standards

### Study / Today (the reference screen)

- **Hero** (FeatureCard): eyebrow, greeting, then "BSc Information Systems · Year 1".
- **Main column:** AttentionCard (only for real items, in priority order), Next class or examination (card, or an EmptyState with a "View timetable" action), Coming up (activity rows in a card), My courses (CourseCard grid, current and upcoming periods first), Recent updates (activity rows in a card).
- **Right rail** (stacked cards, 16–20px gap): ProgrammeCard, ProgressCard, QuickActions.

### Study / Courses

- PageHeader, then a CourseCard grid grouped by period.
- Withdrawn and completed courses are labelled in words.
- Empty: "No enrolled courses yet. Your course list appears here after registration is confirmed." with a Go to registration action.

### Office / Registration

- PageHeader: "Registration", "Choose and confirm your courses for <period>.", and a status badge.
- **Desktop:** left 8 columns hold the StudyYearCard, the "Available courses" card with CourseSelectionRows, and the Eligibility card with RequirementRows. The right 4 columns hold a sticky RegistrationSummary.
- **Mobile:** the summary follows the selection.
- Confirmed periods show a receipt card: reference, credits, date and course rows.

### Other pages

Results & Progress, Timetable, Resources, Office Overview, Fees & Payments, My Details, Documents, Requests and Settings all use the same PageHeader, SurfaceCards, tables or rows inside cards, badges, alerts and empty states.

**Tables:** inside a card, with header row 12px/600 secondary, rows 52px or taller, 12–16px cell padding and subtle row dividers. Wrap with `overflow-wrap: break-word` (never `anywhere`). Below 768px, tables become labelled stacked rows.

## 8. Accessibility (unchanged requirement: WCAG 2.2 AA)

- Use the measured text tokens above.
- Keep a 3:1 contrast for control boundaries and focus.
- Use semantic landmarks, one `h1` per page, and logical heading order.
- Every input has a label.
- Support keyboard operation everywhere and 200% zoom reflow.
- Respect `prefers-reduced-motion`.
- Blur and translucency must not reduce text contrast below AA. Provide a solid fallback when `backdrop-filter` is unsupported.

## 9. Rollout

1. **Shared foundation.** Add tokens and base components to the shared stylesheet and shell: AppShell, GlobalHeader, SpaceSwitcher, SecondaryNav and ContextBar.
2. **Reference screens.** Build Study / Today, Study / Courses and Office / Registration. Review them at 1440, 1024, 768, 390 and 320px. These set the standard.
3. **Propagate.** Once the reference screens are approved, apply the same components to all other student pages, then Settings and Account. Staff and applicant screens follow in a later pass using the same tokens, scoped so nothing regresses.

Rules: no page-by-page restyling before step 1 is stable. No new values outside the tokens. Existing behaviour, endpoints, approvals and data truthfulness are unchanged; this is a visual system, not a feature change.

## Staff screen anatomy (2026-10-12)

Staff, applicant, public, system and inbox screens follow the live student pages: flat white page bands on the
`#F4F7FB` canvas, 20px apart, with square band corners. Attention cards, tiles, badges and empty states keep their
rounded shapes. Staff pages are denser than Study: tables stay tables, inside bands.

| Piece | Implementation | Use |
| --- | --- | --- |
| Page header | `header.section-header.staff-page-head` | Eyebrow, page title, one-line description, actions on the right (Sign out, refresh). |
| Area navigation | `.workspace-tabs` | Underline navigation, one row, scrolls with an edge fade on mobile. |
| Page body | `.staff-body` (or `.ui-bands`) | Each direct child becomes a band. A top-level `<details>` becomes a collapsible band whose summary reads as its title. |
| Band | `svuUI.panel()` / `.ui-panel` | Section title (18px), optional description and action, content. |
| Workbench | `.registry-grid` / `.ui-workbench` | Queue or list band (4 columns) beside the selected record (8 columns); stacks below 1024px. |
| Record page | `.record-workbench` | Each record section is its own band; a sticky jump bar links them. |
| In-page views | `.fleet-tabs`, `.academic-tabs` | Segmented control, as for student request filters. |
| Home | `.home-ui.ui-home` | Photo greeting and date, attention cards from real queues, work-area tiles, account rail and quick actions. |
| Status | `svuUI.status(code)` | Words with a tone, never raw codes (`onboarded` → "Active student"). |
| Empty | `svuUI.emptyState()` | Designed empty states; `svuUI.enhance()` also marks "No …" lines as compact empty lines without changing their text. |
| Tables | `svuUI.enhance()` | Adds `data-label` to cells so tables become labelled stacked rows below 768px. |

Helpers live in `src/ui-kit.js` (`window.svuUI`); styles in `src/staff.css`. Markup changes keep every `data-*`
hook and every class a browser spec selects on. Behaviour, endpoints, permissions and approvals are unchanged.
