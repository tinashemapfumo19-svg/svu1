# Stage 7 Exam Orders

## Delivered Slice

Lead lecturers submit paper orders from the offering's assessment panel. The examinations office independently approves or returns them, then links approved orders to timetable sittings. This implements the development pilot for `EXM-01`. Institution-wide ordering requirements remain D-27.

## Behaviour

- The offering must have an open registration period. An in-force lead allocation or scoped `assessment.plan.manage` authorizes submission; callers without standing receive `404`.
- Each order records a paper name, whole duration of 15-480 minutes in steps of 15, a paper custody/reference identifier, allowed materials, optional special requirements, and a reason. The reference can identify a paper held elsewhere. Optional controlled PDF storage and release are delivered in [EXAM_PAPER_CUSTODY.md](EXAM_PAPER_CUSTODY.md).
- Only one submitted or approved order exists per offering and case-insensitive paper name. A paper that already has an active sitting cannot be ordered until the sitting is cancelled.
- Scoped `exams.schedule` authorizes approval or return, with a reason. The submitter cannot review their own order, including with administrator authority. A decision is final for that order. Returned orders stay visible; corrections are submitted as a new order.
- The approved-order selector fills the course, paper, and duration when scheduling. A linked sitting must match all three, and an order can have only one active sitting. A composite foreign key pins the offering, and a partial unique index enforces one active sitting per order.
- Where a paper already has a submitted or approved order, direct scheduling or renaming a direct sitting cannot bypass it. Papers without orders retain the existing direct-scheduling workflow while D-27 remains open.
- Linked sitting changes can update the date/time, venue, or capacity. Paper and duration stay fixed. Cancellation keeps the historical link and frees the approved order for a replacement sitting.
- Submission and scheduling share the period's timetable lock, preventing a concurrent direct sitting from slipping past a new order.
- Order submission and review are audited. Sitting history and audit metadata record the order link. Paper references and requirements remain in staff views; student timetable snapshots do not expose them.

## API

| Endpoint | Authority | Body |
| --- | --- | --- |
| `POST /api/assessment/offerings/{periodId}/{courseId}/orders` | Lead lecturer or scoped `assessment.plan.manage` | `paper`, `durationMinutes`, `paperReference`, `materialsAllowed`, optional `requirements`, `reason` |
| `POST /api/exams/orders/{id}/review` | Scoped `exams.schedule`, independent of submitter | `outcome`: `approved`/`returned`, `reason` |
| `POST /api/exams/periods/{periodId}/sittings` | Scoped `exams.schedule` | Existing sitting fields and optional `orderId` |

Offering assessment reads include `examOrders`; staff timetable reads include `orders` and sitting `orderId`. Each order exposes its current active `sittingId` when scheduled.

## Verification

Migration `052_exam_orders.sql`. `test/exam-orders.test.js` covers input bounds and approved-order matching. The desktop/mobile `e2e/exam-timetable.spec.js` journey covers lecturer UI submission, outsider denial, duplicate refusal, self-review denial despite review authority, returned/corrected orders, staff UI approval and linked scheduling, duration/course mismatch refusal, duplicate linkage refusal, cancellation/rebooking, audit records, and student reference privacy. Existing timetable clash, capacity, publication, student portal, and calendar-download checks remain in that journey.

## Remaining Work

- Institutional rules requiring orders for every examination and the authority for paper approval (D-27).
- Controlled PDF storage, version review, recipient delivery and custody receipts are delivered in [EXAM_PAPER_CUSTODY.md](EXAM_PAPER_CUSTODY.md). Real scanner/object-storage integrations, physical printing controls, institutional copy reconciliation and owner acceptance remain.
- Replacing approved order specifications; the current pilot retains approved specifications and permits rebooking only.
- Deferred/supplementary sitting and retake linkage, governed by the pending assessment policy.
