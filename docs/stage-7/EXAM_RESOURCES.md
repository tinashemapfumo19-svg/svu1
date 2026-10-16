# Stage 7 Exam Resources

Development pilot for optional managed venues and invigilator allocations (`EXM-19`, D-26), using migration `054_exam_resources.sql`. Institutional acceptance and production rollout remain outstanding.

## Behaviour

- Global venue managers maintain coded venues, fixed capacity, campus/location, active status and revision. Updates require a reason and retain append-only history. Scoped timetable authority alone cannot change the global catalogue.
- Sittings may select an active catalogue venue or retain the existing manual-venue option. Catalogue capacity cannot be overridden; known catalogue codes/labels cannot bypass validation as manual venues. Future sittings need reselection after their venue record changes.
- Managed rooms are exclusive during overlapping sittings, across all periods. Adjacent sittings do not overlap. Manual labels are not a complete physical-room identity system.
- Scoped schedulers allocate active staff, with at most one lead and no duplicate staff. Whole-roster replacement requires the sitting revision, increments sitting/timetable revisions, and retains reasoned history. Live deferred-completion marks prevent roster changes.
- Resource mutations and publication share a transaction lock before the period lock. Concurrent overlapping staff allocations cannot both succeed.
- Published rooms and staff remain committed until that period's changed timetable is republished. Draft cancellation, room movement or roster removal cannot silently release what students/staff still see.
- Independent publication checks room conflicts, staff availability and overlaps, venue revision, candidate clashes, capacity and deferred readiness. An initial empty timetable cannot publish; a previously published timetable may republish with no sittings to communicate complete cancellation and release commitments.
- Students receive course/candidate-limited snapshots with venue location, never staff rosters. Private staff snapshots support personal duties and calendar downloads without exposing colleagues. The optional [candidate-arrangement workflow](EXAM_ARRANGEMENTS.md) adds only assigned-room operational candidate instructions to personal duties, never private case notes or evidence. Publication notifies new and former recipients, including zero-sitting cancellations.

## API

| Endpoint | Authority |
| --- | --- |
| `GET /api/exams/venues` | Scheduling, publication, results viewing or venue management |
| `POST /api/exams/venues` | Global `exams.venues.manage` |
| `POST /api/exams/venues/{id}` | Global venue management, revision and reason |
| `GET /api/exams/venues/{id}/history` | Global venue management |
| `POST /api/exams/sittings/{id}/invigilators` | Scoped `exams.schedule`, revision, entries and reason |
| `GET /api/exams/duties/me` | `exams.duties.self`, own linked staff record only |

Venue management is granted to global administrators and examination officers. Personal duties are available to administrators, examination officers, academic registrars, lecturers and the new `exam_invigilator` role. Scheduling and publication retain their existing scope and separate-editor rules. Fresh development seeds preserve these migrated permissions.

## Verification

Focused unit coverage lives in `test/exam-resources.test.js`; desktop/mobile coverage extends `e2e/exam-timetable.spec.js`. The journey exercises catalogue UI/history, capacity/version enforcement, scope/privacy refusals, concurrent allocations, inactive staff, independent publication, personal calendar export, retained published commitments, resource release and full cancellation.

2026-10-05 checkpoint: all 149 unit tests pass. The broader isolated assessment/timetable/staff/teaching regression passed all 22 smoke checks and five of eight browser journeys; two exam journeys failed on an incorrect empty-list assertion and one mobile staff journey raced its busy detail refresh. Corrected exam journeys passed on both viewports (`data/build-exam-resources-verified`), and staff journeys passed on both viewports (`data/build-exam-resources-staff-verified`). A subsequent mobile layout check caught table-parent overflow; the corrected final mobile journey passed with screenshots inspected (`data/build-exam-resources-mobile-layout-verified`). The original broader run remains recorded as failed, not relabelled as an all-green shared run. All isolated databases and test servers were torn down.

## Open Policy

Optional [published candidate manifests](EXAM_MANIFESTS.md) now freeze room rosters and individual end times alongside publication, with scoped office and assigned-room-only invigilator access. Optional [independently reviewed seating](EXAM_SEATING.md) assigns manual labels against those frozen rooms. Neither certifies attendance or infers a physical seating layout. See each slice's separate verification record.

D-26 remains open for mandatory managed venues/seating, physical layouts, minimum staffing/ratios and individual entitlement/evidence/retention policy. Optional [candidate arrangements](EXAM_ARRANGEMENTS.md) and [controlled paper custody/delivery](EXAM_PAPER_CUSTODY.md) have separate development implementations; neither makes them mandatory for every sitting. Broader incomplete-grade/supplementary publication, production integrations and owner approval remain separate work.
