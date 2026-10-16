# University Demo Walkthrough

Open http://127.0.0.1:4188/#signin. This runs the current application against the
local development database. All walkthrough records are synthetic. Sample
academic periods are in 2028 so they do not overlap the existing calendar; they
are not the university's actual schedule.

| Person | Email | Password |
| --- | --- | --- |
| Tariro, student with results and fees | active.student@southvalley.test | Active-Student-Demo-2026! |
| Nyasha, student in the teaching cohort | demo.classmate@southvalley.test | Active-Student-Demo-2026! |
| Chipo, lecturer | demo.lecturer@southvalley.test | Demo-Lecturer-2026! |
| Registrar | registrar@southvalley.test | Kariba-Senate-Approvals-2026! |
| Administrator | admin@southvalley.test | Phase1-Admin-Password-2026! |

Sign out before switching people.

## Student Tour

1. Sign in as Tariro. Home shows student number `S27000019`, BSc Information
   Systems, course registration, fees, and recent messages.
2. Open My learning. COMP101 and INFS101 have confirmed registration, an exam
   timetable, and published marks of 78 and 65. GPA is 3, classification Pass.
   Try the examination calendar download.
3. Open Portal. Inspect the accepted application, completed student profile,
   next-of-kin, registration confirmation, published results, and statement.
   The statement has USD 1,250 charges, USD 750 paid, and USD 500 remaining.
4. The second demo semester includes a draft repeat selection. Confirmation is
   blocked until a valid repeat decision is approved. This deliberately shows
   the academic controls rather than bypassing them.
5. Open Resources. Search for Demo Student Handbook or Introduction to
   Programming - Study Guide. Open or download the published PDF files.
6. Open Messages using the bell. Read orientation, fee, and results notices.
7. In Portal, inspect the academic support request and the student services
   reply. Try adding a comment or a new request.
8. Open Account settings to inspect the profile, password, MFA, and sessions.
   Changing a demo password affects subsequent provisioning runs.

## Staff Tour

1. Sign in as Chipo and open My learning. Inspect the two teaching allocations
   and Show class list; Nyasha (`S27000020`) is enrolled in this cohort.
2. Sign in as the registrar. Open Students and search for `S27000019` or
   `S27000020`. Inspect onboarding, registration, results, fees, and history.
   The registrar also has demo finance, records-manager and examinations roles
   to demonstrate independent publication and review.
3. Open Examinations, Teaching, Resources, and Reports to inspect their records.
   The completed semester has published results and an exam timetable; the
   separate open semester has approved lecturer allocations and Nyasha's class
   list. Additional assessment plans and marks are available to enter there.
4. Sign in as administrator. Inspect Support for the request and reply,
   People & systems for the lecturer, and System for accounts, workflows,
   tasks, reference data, notifications, and audit evidence.

## Repeatable Setup

```powershell
npm.cmd run demo:walkthrough
```

This defaults to the demo server on 4188. It adds or reuses the walkthrough
accounts and records through application APIs. It does not run the destructive
foundation seeder. The database URL and development outbox configuration must
match the running server. The seed account passwords must still be unchanged.

To start this server in a terminal after it has stopped:

```powershell
$env:SVU_ENV='development'
$env:SVU_PORT='4188'
$env:SVU_REPORT_SCHEDULER='disabled'
npm.cmd run dev
```

The scheduler is disabled for this walkthrough server. No external learning
platform, payment provider, mail delivery, or production identity provider is
connected by this setup. Graduation, awards and issued official transcripts
require their own reviewed workflows and are not pre-approved in this demo.
