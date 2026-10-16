# Stage 7 Examination Timetable

## Delivered Slice

Examinations staff schedule sittings for each course offering in a registration period. Each sitting has a paper, start, duration, venue, and optional capacity, and must fall within the academic calendar's assessment window. Candidates are the confirmed enrolments, so the system computes student clashes and venue overcapacity live. A period's timetable is published by someone other than its last editor, and only once there are no clashes or capacity problems. Students see their own sittings from the last published version and can add them to a calendar.

This covers:
- `EXM-03`: duplicate-paper prevention and status;
- `EXM-04`: publish, republish, and cancellation with history;
- `EXM-05`: a structured timetable with CSV and calendar downloads instead of an uploaded schedule file;
- part of `RPT-07`: the timetable report.

It is a development pilot. See [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md) entries D-24 to D-27.

## Behaviour

- **Scheduling** (`exams.schedule`, scoped to the period's programme and intake).
  - The course must be offered in the period.
  - The paper name is unique per course among scheduled sittings, ignoring case.
  - The start needs an explicit UTC offset (for example `2025-06-02T09:00+02:00`). The date as entered must fall within the term's `assessment` window. Scheduling is refused if the window is not defined.
  - Duration is 15-480 minutes in 15-minute steps. Capacity, if given, is 1-5000.
- **Changes and cancellation.**
  - Each sitting carries a revision. A stale revision returns `409`.
  - Cancelled sittings cannot be changed.
  - Every schedule, change, and cancellation is recorded in an append-only history with a snapshot and reason, and audited.
- **Issues**, recomputed on every read from the current candidates:
  - **Clashes:** overlapping sittings that share a candidate. Sittings that only touch (one ends as the other starts) do not clash.
  - **Capacity:** a sitting with more candidates than its capacity, or overlapping sittings in the same venue (ignoring case) whose candidates together exceed the smaller declared capacity.
- **Timetable revision.** Every change bumps the timetable revision, returns it to draft, and records the editor as its preparer.
- **Publication** (`exams.publish`). Publication requires:
  - the revision the publisher reviewed;
  - a publisher other than the preparer (also enforced by a database check);
  - at least one scheduled sitting on initial publication (a later full cancellation may republish an empty timetable);
  - no clashes, capacity problems or managed-resource issues.

  Publishing freezes a snapshot of the sittings (course, paper, start, duration, venue) and queues an `exams.timetable` email to each candidate. The email says "published" the first time and "updated" afterwards.
- **After publication.** Later changes return the timetable to draft. Students keep seeing the last published snapshot until a colleague republishes.
- **Students** (`GET /api/registry/me/programmes/{id}/exams`) see only published sittings for courses they hold a confirmed enrolment for. They can download an `.ics` calendar with UTC times and the venue.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/exams/periods` | `exams.schedule`, `exams.publish`, or `results.view` | Open and closed periods in scope, with timetable status. |
| `GET /api/exams/periods/{periodId}` | Same, scoped | Period and assessment window, timetable state, sittings, offerings with candidate and sitting counts, clashes, capacity problems, and capabilities. |
| `POST /api/exams/periods/{periodId}/sittings` | `exams.schedule` | `courseId`, `paper`, `startsAt`, `durationMinutes`, `venue`, optional `capacity`, `reason`. |
| `POST /api/exams/sittings/{id}` | `exams.schedule` | `revision`, `reason`, and changed fields, or `cancel: true`. |
| `POST /api/exams/periods/{periodId}/publish` | `exams.publish` | `revision`, `reason`. |
| `GET /api/registry/me/programmes/{id}/exams` | `registry.self` (own) | Published sittings for the student's courses. |

Permissions:
- `examinations_officer` schedules and publishes, but needs a second officer for publication.
- `academic_registrar` publishes.
- `system_administrator` holds both.

## Interface

- **Staff (`#registry`).** An **Examination timetables** panel lists periods. Opening one shows:
  - the assessment window;
  - candidates and sittings per course, with courses lacking a sitting flagged;
  - an issues box listing clashes and capacity problems;
  - the sittings table and a CSV export;
  - change and cancel forms, and a schedule form;
  - a publish form for an eligible colleague, or a note when you made the latest change.

  Times are entered in the browser's timezone and sent with its offset.
- **Students (`#apply`).** An **Examination timetable** section with a table per period and an **Add to calendar (.ics)** button.

## Verification

Migration `048_exam_timetable.sql`, and the `exams.timetable` notification template. Unit tests in `test/exams.test.js` cover offset and duration validation, local dates, clash detection (touching and cancelled sittings excluded), and venue capacity. The desktop and mobile journey is in `e2e/exam-timetable.spec.js`, with the browser pinned to Africa/Harare. It covers:

- refusals for a missing offset, outside the window, a course not offered, a student, and publishing with nothing scheduled;
- UI scheduling that produces a clash and an over-capacity venue, both shown;
- a duplicate paper, self-publication, publishing with clashes, and a stale revision, all refused;
- UI changes that clear the issues, and the CSV export;
- publication by a second officer in the UI, after which a repeat publication is refused;
- students' own timetables and notifications, and another student's programme returning `404`;
- a cancellation staying in draft while students keep the published version, then republication;
- audit of both publications;
- the student portal table and `.ics` contents;
- no horizontal overflow.

## Remaining Work

- Mandatory ordering policy and production custody/printing controls. Development exam orders (`EXM-01`) are delivered in [EXAM_ORDERS.md](EXAM_ORDERS.md), with optional [controlled paper custody and recipient delivery](EXAM_PAPER_CUSTODY.md).
- Deferred sittings and completion under D-01's current hold-until-resolved policy are delivered in [DEFERRED_ASSESSMENT.md](DEFERRED_ASSESSMENT.md). Supplementary results batches, incomplete grades, and wider retake linkage (`EXM-07`) remain open.
- Optional managed venues and invigilator allocations (`EXM-19`) are delivered in [EXAM_RESOURCES.md](EXAM_RESOURCES.md). Mandatory staffing and seat allocation remain open.
- Special arrangements for individual candidates (extra time, separate room) and their privacy.
- A minimum notice period before sittings, once agreed (D-25).
