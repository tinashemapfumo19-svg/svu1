# Stage 5 Teaching Allocation

## Delivered Slice

Teaching staff are allocated to the period-specific course offerings already used by registration. Each allocation is a separate, dated, independently approved record. Class-list access for lecturers comes from their allocations, and academic managers can see uncovered offerings and lecturer workload. This is a development pilot, not a production sign-off.

| Inventory | Coverage |
| --- | --- |
| STF-07 | Allocations attach to a registration period and course offering. Roles are `lead`, `co_lecturer`, `tutor`, `moderator`, and `examiner`, each with workload units and dates. |
| STF-08 | Allocations end with a last teaching date and a reason, or are substituted by an approved replacement. Nothing is deleted, and every change is audited. |
| STF-09 | The overview lists uncovered open offerings with reasons, and workload (units and allocation count) for each staff member. |

## Behaviour

- **Proposal and approval.**
  - A proposal (`teaching.allocate`, scoped) needs an active staff member, an offering in the period, a start date before the academic period ends, and a reason.
  - Approval (`teaching.approve`, scoped) needs a different person, re-checks the staff member's status and conflicts, and is final once given.
- **Leads and substitution.**
  - An offering has at most one proposed or active lead.
  - Changing the lead means proposing a substitution of the active allocation, starting after it. On approval, the old allocation ends the day before the substitute starts.
  - The same person cannot hold the same open role twice on one offering.
- **Conflicts are refused (`409`):**
  - a teaching role (lead, co-lecturer, tutor) whose scheduled meetings overlap another teaching allocation for the same person in the same academic period, while both are in force (ended allocations count for the dates they covered);
  - a moderator or examiner who also teaches the same offering.
- **Coverage.** An offering is covered only by an approved lead whose staff record is active. "Awaiting approval", "no lead", and "lead suspended" are reported as uncovered. When a staff member exits, their active allocations end on the exit date and their pending proposals are rejected, so the gap appears in the coverage report.
- **Class lists.** Lists come from confirmed course enrolments in that registration period. They show student number, name, registration reference, and programme status, with no contact data.
  - A lecturer (`teaching.self`) sees a class list only for their own active allocation that is in force today.
  - Registry staff see class lists through `teaching.view` scope.
  - Anyone else gets `404`.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/teaching/overview` | `teaching.view` | Open periods in scope, uncovered offerings, and workload. |
| `GET /api/teaching/periods/{periodId}` | `teaching.view` | Offerings with enrolment counts, allocations, coverage, assignable staff, and capabilities. |
| `POST /api/teaching/periods/{periodId}/allocations` | `teaching.allocate` | `courseId`, `staffId`, `role`, `workloadUnits`, `effectiveFrom`, `reason`, optional `replacesAllocationId`. |
| `POST /api/teaching/allocations/{id}/review` | `teaching.approve` | `outcome` `approved`/`rejected` with `reason`. |
| `POST /api/teaching/allocations/{id}/end` | `teaching.allocate` | `effectiveTo`, `reason`. |
| `GET /api/teaching/me` | `teaching.self` | Own active allocations. |
| `GET /api/teaching/allocations/{id}/class-list` | `teaching.self` (own, in force) or `teaching.view` (scoped) | Class list. |

Permissions: `academic_registrar` holds view and allocate; `academic_approver` holds view and approve; `system_administrator` holds all; `lecturer` holds `teaching.self`.

## Interface

`#registry` shows **My teaching**, with class lists, to lecturers. A **Teaching allocation** panel shows uncovered offerings, workload, and period detail, with propose, substitute, review, end, and class-list actions. The workspace now also opens for users without student-registry access (lecturers, finance staff) instead of failing.

## Verification

Migration `042_teaching_allocations.sql`. Unit tests are in `test/teaching.test.js`. The desktop and mobile journey is in `e2e/teaching-allocation.spec.js`. It covers:

- a UI proposal followed by self-approval denial and independent approval;
- a second lead, a timetable clash, and an examiner who also teaches, all refused;
- coverage and workload reporting;
- a lecturer's UI class list, with other staff and students denied;
- a substitution refused while it clashes with tutoring, accepted after the tutoring ends through the UI, and moving class-list access to the substitute;
- a start date after the period ends refused;
- staff exit ending allocations and reopening the coverage gap;
- audit trail.

## Production Gates

- Academic owner approval of allocation roles, workload units, and whether faculty-level approval is needed for each department.
- Migration of active lecturer-subject allocations into period-specific offerings.
- Moderation and examiner independence rules confirmed against examinations policy (Stage 7).
