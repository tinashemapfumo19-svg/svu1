# Personal Calendar

One read-only calendar of what is due or scheduled for the signed-in person. It collects dates that already exist
elsewhere (course resources, examination sittings, fee charges, offers and intakes) and stores nothing of its own.

## Endpoint

`GET /api/calendar/me?from=YYYY-MM-DD&to=YYYY-MM-DD`. Requires `registry.self`, `teaching.self` or `admissions.apply`.
With no dates the range is 7 days back to 42 days ahead; a requested range may be up to 120 days.
Server module: `server/modules/calendar.js`; unit tests: `test/calendar.test.js`.

| Who | Event type | Source | Status |
| --- | --- | --- | --- |
| Student | `assignment` | Published assignments in confirmed, not-withdrawn course enrolments | `submitted`, `overdue`, `due_soon` (within 24 hours), `due` |
| Student | `class` | Published online classes in the same courses (one hour by default) | `scheduled` |
| Student | `exam` | The student's own published examination sittings, with venue and seat | `scheduled` |
| Student | `fee` | Charges with a due date on the student account | `paid`, `overdue`, `due` |
| Lecturer | `assignment`, `class` | Resources in courses with an active teaching allocation; assignments carry `progress {done,total}` | `teaching` / `scheduled` |
| Applicant | `offer` | Open offer expiry (not yet accepted or declined) | `due` |
| Applicant | `intake` | Start date of the applied intake | `scheduled` |
| Student / host | `appointment` | Booked appointments ([APPOINTMENTS.md](APPOINTMENTS.md)) | `scheduled` |

Each event has `id`, `type`, `title`, `subtitle`, `start`, optional `end`, `allDay`, `status` and an in-app `href`.
A person with several roles sees the events of each, without duplicates, sorted by start time.

## On screen

Client: `src/calendar.js` (`window.svuCalendar`), styles in `src/staff.css` (`.cal-*`). It mounts itself into any element with:

| Attribute | Where | What it shows |
| --- | --- | --- |
| `data-calendar-full` | Study → **Calendar** (`#study/timetable`, formerly Timetable) | Month / Week / List views, previous / today / next, filters (All, Coursework, Exams, Fees), the selected day's agenda, a colour legend and **Add to calendar** (.ics of everything in view). The published examination timetable stays below it. Month cells show up to two titled chips on wide screens and colour dots on phones. |
| `data-calendar-week` | Study → Today, under Your attention | **This week**: seven day pills from today with a dot on busy days, and the chosen day's agenda |
| `data-calendar-mini` | Home for lecturers and applicants (right rail) | A small month grid with dots and **Due this week**; lecturers see a submitted/enrolled count per assignment |

Related touches that use the same data:

- Course cards on Study → Today / Courses show a countdown pill for the next deadline (due soon / overdue / submitted).
- Fees & Payments shows a **Payment timeline**: every charge in due-date order with paid / due / overdue markers and today between them.
- Staff Home shows **This week** tiles (unmarked submissions, applications waiting, support cases assigned, open tasks) from `GET /api/me/work-summary`, the same counts as the Monday digest ([AUTOMATIONS.md](AUTOMATIONS.md)).
- Applicant Home shows an offer-expiry countdown in Your attention.

## Subscription feed

Calendar → **Subscribe** creates a private address (`/api/calendar/feed/<token>.ics`) that Google, Apple and Outlook
calendars poll about hourly. Only a SHA-256 digest of the token is stored (migration `106_calendar_feeds.sql`), so the
address is shown once; **Reset address** replaces it and **Turn off** removes it. The feed covers two weeks back to about
15 weeks ahead and carries titles and times only: fee amounts and exam seats stay in the portal. It follows the
person's current roles, and stops when the account is inactive. `GET/POST/DELETE /api/calendar/feed`.

## Outstanding

- Staff-side calendars for registry and finance dates (registration windows, results publication, payment-plan instalments).
- Lecturer calendar inside My teaching (currently only the Home mini calendar).
- Timezone: events are shown in the browser's timezone; assignment due times keep the course's stated timezone in the course page.
