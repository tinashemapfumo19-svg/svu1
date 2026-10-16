# Study Review (UX-09): Claude

Date: 2026-10-07, 22:15
From: Claude. To: Codex, owner of Study, the shell and integration.
Scope: Study pages in `src/student.js` (as of 22:07), the student aliases in `src/app.js` and the student navigation in `src/shell.js`.
Evidence: isolated run on port 4363 (database `svu_rebuild_it_1791403638358`, dropped). Both `student-experience.spec.js` and `student-office.spec.js` passed on desktop and mobile. The source check failed because Codex edited `student.js`, `student.css`, `apply.js` and `student-experience.spec.js` at 22:07, during the run. Treat the screenshots as a review aid, not a clean receipt.
Claude does not edit these files. Each item below is a request.

## Findings

| # | Severity | Location | Issue | Requested change |
| --- | --- | --- | --- | --- |
| S1 | Medium | `shell.js` items, `app.js` alias | A student who also teaches (has `teaching.self`) loses "My teaching". The shell hides the item for students, and `#learning` always redirects to `#study/courses`, so class lists and allocations can't be reached. The design keeps authorized staff access for people with several roles. | Redirect `#learning` only when the user lacks `teaching.self`. Give students who teach a "My teaching" item (or put it in the profile menu) that opens the teaching view. |
| S2 | Medium | `attention()` on Today | The demo student's open registration is blocked (2 requirements), but Today says "Choose your courses" with a primary "Continue registration" button. That frames a blocked state as routine. It also only ever shows one item. | Use the Office attention mapping in [CLAUDE_OFFICE_REVIEW.md](CLAUDE_OFFICE_REVIEW.md) (UX-07): when a saved selection isn't ready, show "Registration for <period> is blocked: n issues" → Registration. Show several items in priority order. |
| S3 | Low (visual) | Timetable and Results tables at 390px | The shared table styles use `overflow-wrap: anywhere`, which splits codes and words mid-token ("COMP1 01", "examinat ion", "Computi ng Hall"). Same cause as R11. | Scoped to `.student-experience`, use `overflow-wrap: break-word` in table cells. Below 768px, show labelled rows, or use a labelled scroll region. |
| S4 | Low | `courses()` on Today and Courses | With "All semesters", My courses lists every confirmed course labelled "Registered", including semesters whose results are already published. | On Today, prefer `programme.studyYear.currentPeriods` and upcoming periods. Label a course "Completed" once a published result exists for that registration and course, and "Withdrawn" when approved. |
| S5 | Low | Today side column; Results | Raw values appear: programme status "onboarded" (lowercase code). The internal batch reference (`DEMO-TARIRO-SEMESTER-1`) is the results heading. | Turn the status into words ("Active student" or "Onboarded"). Title result batches with the period name, and show the source reference as small print at most. |
| S6 | Low (mobile) | Local nav and context bar | At 390px the Study nav wraps "Resources" onto its own row, and the programme, semester and student-number block takes about 150px on every page before the content starts. | On mobile, show a one-line context summary with a "Change" disclosure. Keep the local nav to one scrollable row with a visible cue, or rely on the bottom nav. |
| S7 | Low (a11y) | `render()` | All page content sits inside `<fieldset class="student-controls">` with no legend, so screen readers announce an unnamed group around every page. | Use a plain container. During a write, disable only the acting form (or set `inert`/`aria-busy` on the container). |
| S8 | Info | Bottom nav | Study's bottom nav ends with "Account", where the design says "More". Results & Progress and Resources are reachable only through the wrapped top nav. | Either is acceptable. If "Account" stays, make sure the top nav stays reachable (see S6). |
| S9 | Info | Recent updates | Three identical "An update from SVU Admissions" rows appear for an enrolled student. | For students, consider grouping repeated campaign messages, or leaving admissions campaigns out of Study updates. It's a messaging-policy choice, so it isn't required. |

## Verified working (from screenshots and code)

- Choosing a semester filters Results and Timetable correctly. Result rows match registrations by ID.
- A course is identified by period and course (`#study/courses/<period>/<course>`), and a reload keeps the page.
- Nothing is invented. Next examination and Coming up use published sittings only. Academic progress shows a neutral link when there's no completion audit. There are no fake classes or deadlines, which respects the ADR-008 boundary.
- An unowned programme in the URL is refused. Signed-out deep links go through shared sign-in with `next`.
- On the 1440px Today page, the two-column layout matches STUDENT_DESIGN_LANGUAGE: unframed sections, restrained blue, a quiet side column.

## Office re-check (22:07 source)

R1 (country-list read breaks My Details), R2 (old sitting or support links break Requests) and R3 (errors shown as status, not alert) are still open. See [CLAUDE_OFFICE_REVIEW.md](CLAUDE_OFFICE_REVIEW.md).
