# Student Visual Refinement

Implemented against the user's final 50-section visual-system brief on
2026-10-07. This refines the existing Study / Student Office experience; it
does not introduce a new information architecture or backend workflow.

## Design Standard

This document supersedes conflicting presentation values in
[SVU_UI_STANDARD.md](SVU_UI_STANDARD.md). Its workflow and truthful-data
requirements remain unchanged.

- Permanent application canvas: `#F4F7FB`, including Settings and shared pages.
- White primary surfaces, translucent soft/elevated surfaces and restrained
  semantic blue, green, lavender, amber and red treatments.
- Shared tokens in `src/svu-ui.css`; student compositions in `src/student.css`.
  Existing component/icon helpers are reused rather than introducing a framework.
- Desktop content maximum: 1320px. Shared shell is 64px at desktop with brand,
  centered space switcher and right-aligned search/inbox/profile actions.
- Secondary navigation stays below the shell. Programme, semester and student
  number form one structured context toolbar; mobile context is collapsible.
- Typography uses zero letter spacing. Focus states are visible; common action
  targets are at least 44px. Reduced-motion preferences remain respected.
- Page sections are unframed groups or white surface bands, not nested cards.
  Repeated course tiles and genuine framed controls retain existing radii.

## Applied Screens

### Study / Today

- Compact photographic greeting with genuine local date and student context.
- Desktop 8:4 main/rail split; next event and upcoming events sit side by side.
- Registration attention links to existing requirements, without bypassing rules.
- Courses show real code, title, period, credits, requirement type when known,
  enrollment/result status and next published examination when available.
- Programme facts include curriculum version and study year when supplied.
- Progress uses actual award-audit earned credits and satisfied requirements.
- Recent inbox entries and quick actions retain existing deep links.
- Mobile order: context, greeting, attention, next/upcoming events, courses,
  progress, recent updates, quick actions, programme facts.

### Study / Courses

- Reusable course tiles: up to four desktop columns, two intermediate columns,
  one mobile column. Metadata is merged only from matching registration offerings.
- Upcoming exam metadata uses the existing examination endpoint and selected
  period/course ownership. No invented classes or assignment deadlines.
- Existing offering details, arrangement requests and academic links are retained.

### Student Office / Registration

- Existing 8:4 selection/summary layout shares the same canvas and controls.
- Course rows have consistent checkboxes, touch targets and keyboard focus.
- Existing blockers, eligibility, save/submit rules, revisions and draft state
  remain authoritative. Presentation changes do not alter registration logic.

### Remaining Screens

Timetable, results, resources, Office overview, fees, details, documents and
requests inherit the shared context, typography, navigation and surface treatment.
Inbox, Settings and other roles inherit shared tokens and controls. Staff
navigation visibility and geometry are checked separately from the student shell.

## Search

The student search button and Ctrl/Cmd+K open an accessible native dialog.
Search covers permitted student destinations and already-loaded registered
courses. It makes no extra search API calls and does not expose raw records.
Enter activates the first match; arrow keys move focus; Escape, backdrop click,
navigation or session change closes the dialog. Focus returns to the opener.
Empty searches show available destinations; unmatched searches show an empty state.

## Assets And Honest Data

- `src/assets/campus-concept.jpg`: 1400px wide, 130644 bytes.
- `src/assets/campus-concept-mobile.jpg`: 700px wide, 38362 bytes.
- Both are compressed, responsive decorative assets generated as a fictional
  campus concept, not photographs of South Valley University's real buildings.
- The server allows exactly those two JPEG paths. Arbitrary images and traversal
  paths remain denied; there is no broad static-directory permission change.
- Weather is omitted because no weather source is connected. Online class join
  buttons, assignments and academic materials appear only if existing data
  supports them; this refinement does not create an LMS.
- No degree-credit denominator is inferred from prose or all elective offerings.
  Missing audit data gets an honest empty state rather than a fabricated percent.
- Notifications without structured type metadata retain the generic inbox icon.

## Performance And Verification

The session-local cache, invalidation rules, concurrent loading and stale-render
guards in [STUDENT_LOADING_PERFORMANCE.md](STUDENT_LOADING_PERFORMANCE.md)
remain in place. Exam reads use the existing parallel resource loader.

Verification covers keyboard search, focus restoration, shared canvas, JPEG MIME
types, shell geometry, narrow-screen overflow and desktop/mobile screenshots.
The isolated regression selection covers student-experience, student-office,
app-shell and shell-alignment, plus the unit and API smoke suites. Final results
are recorded in [CODEX_CLAUDE_WORKSPACE.md](CODEX_CLAUDE_WORKSPACE.md).

Updated local preview: `http://127.0.0.1:4175`.

Manual Playwright visual checkpoint: Today, Courses and Registration captured
at 1920x900, 768x900, 390x900 and 320x900. All 12 checks passed the document
overflow assertion and retained the shared canvas. At 1920px, Today's course
section began at y=764, within the first viewport. Screenshots are stored as
`data/refinement-{width}-{space}-{page}.png`. Desktop and narrow-mobile captures
were visually inspected. Health and both exact JPEG paths returned HTTP 200;
an unlisted image returned HTTP 404.

Final isolated result (2026-10-08 local time): all 26 selected browser cases,
unit tests and all 22 API smoke suites passed. Source guard passed for 402
files; the temporary database was dropped. Machine-readable receipt:
`data/student-visual-refinement-receipt.json`.

Following that checkpoint, the search-only Arrow Up starting-index fix was
verified in two additional desktop/mobile cases, including wraparound, no
matches, route activation and focus restoration. `node --check src/shell.js`
also passed. No academic, registration, API or permission behavior changed.
