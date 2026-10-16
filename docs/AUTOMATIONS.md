# Automated Reminders and Digests

User request, 2026-10-12. Scheduled messages built from records the platform already holds. Each message goes to the
recipient's inbox (and by email when delivery is configured, see EMAIL_DELIVERY.md).

## What is sent

| Job | Recipient | When | Sent once per |
| --- | --- | --- | --- |
| Assignment deadline reminder | Enrolled student who has not submitted | 48 hours and 24 hours before the deadline | assignment, window, student |
| Submission receipt | Student | On every successful submission (immediately, not scheduled) | attempt |
| Missing-work alert | Lead, co-lecturer and tutor on the offering | Within 7 days after a deadline, when anyone has not submitted | assignment, lecturer |
| Lecturer reminder ("Remind N students") | Students who have not submitted | When the lecturer presses the button on the assignment | assignment, student, day |
| Offer expiry reminder | Applicant with an unanswered offer | 7 days and 2 days before it expires | offer, window |
| Registration ready | Student whose saved selection was blocked and is now eligible | Next sweep after it becomes eligible | registration period, student |
| Fee due reminder | Student with an outstanding charge | Up to 7 days before the due date | programme, due date, currency |
| Financial hold notice | Student | When a hold starts (new set of overdue charges) | programme, set of overdue charges |
| Support waiting reminder | Student | Case waiting on the student for 3 days | case revision |
| Support unanswered alert | Assigned staff member | Open or in-progress case with no update for 5 days | case revision |
| Weekly staff digest | Active staff with open tasks, unmarked submissions or assigned support cases | Mondays (UTC) | ISO week, person |

Course pages also offer **Add to calendar** (.ics) for upcoming assignment deadlines (with a one-day alarm) and online
classes, and **Add all** for every upcoming dated item in the course.

## Running

- `SVU_AUTOMATIONS=enabled` runs the sweep every 15 minutes in the server process. It is off by default, so test and
  demo environments do not fill inboxes unexpectedly.
- System → Automations (permission `notification.send`) shows recent runs, per-job counts and errors, and has
  **Run now**. A manual run includes the weekly digest on any day; it is still sent at most once per week.
- Every message is claimed in `automation_sends` in the same transaction that queues it, so repeated or concurrent
  sweeps never send it twice. `automation_runs` keeps each run's per-job result.

## Evidence

- Unit: `test/automations.test.js` (deadline and offer windows, digest text, ISO weeks, scheduler config and single
  in-flight sweep).
- Preview (port 4211): deadline reminder, missing-work alert, lecturer reminder (repeat on the same day refused),
  fee due reminder, support waiting reminder and weekly digest were each sent once and not repeated on the next run;
  students cannot run automations (403) or send reminders (404). Offer expiry and registration-ready ran without
  error but the preview had no qualifying offers or newly eligible registrations.

Migration 105 creates the tables and message templates.

## Frontend provision

| Feature | On screen | Gap |
| --- | --- | --- |
| Reminders, receipts, alerts, digests (1-7) | Inbox items, and email when delivery is on | No per-person settings or opt-out; no link from the message to the exact assignment, offer, charge or case |
| Lecturer reminder | **Remind N students who have not submitted** on each published assignment with missing work | None |
| Calendar export (8) | **Add to calendar** per upcoming deadline or class, **Add all** per course, and **Add to calendar** on Study → Calendar for everything in view (see [CALENDAR.md](CALENDAR.md)) | No subscribable feed |
| Lecturer reminder (visual) | Each assignment shows a submitted/enrolled ring, initials of students still missing, and the remind button | — |
| Submission receipt (2) | Green receipt card on the course page with the time, file fingerprint and **Download receipt** | — |
| Weekly digest (7) | Staff Home **This week** tiles show the same counts as the Monday digest | — |
| Administration | System → Automations: what each job does, recent runs, per-job errors, **Run now** | The tab does not show whether the schedule is switched on in this environment, and jobs cannot be paused one by one |

## Outstanding requirements

- Notification preferences: let a person mute non-essential reminders (deadline, digest), keeping receipts and holds. See D-40.
- Deep links in messages to the assignment, offer, statement or case they refer to (needs a link field in notification payloads and the Inbox).
- Show the schedule state (on/off, last scheduled run) in System → Automations, and allow pausing a single job.
- Configurable timings (deadline windows, support thresholds, digest day) instead of fixed values. See D-40.
- A private subscribable calendar feed (Study → Calendar now exports a one-off .ics of everything in view).
- Registration-ready and offer-expiry need a live check against real data; the preview had none to trigger them.
- Production: apply migration 105, set `SVU_AUTOMATIONS=enabled` on one server only (two schedulers would each run; claims prevent duplicate messages, but runs are recorded twice), and enable email delivery if messages should leave the Inbox.
