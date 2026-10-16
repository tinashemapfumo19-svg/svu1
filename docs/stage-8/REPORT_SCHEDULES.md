# Private Report Schedules

## Delivered Development Scope

Migration 072 supplies automatic creator-private report capture across admissions, registry, finance, support, enquiries, communications, academic outcomes, continuation and examinations. Migration 076 adds [assessment recording workload](ASSESSMENT_REPORTING.md), bringing current coverage to ten sources. Each successful capture uses the existing native source and stores a private [report edition](REPORT_EDITIONS.md), including original JSON, definitions and CSV. No email, provider dispatch, shared publication or statutory approval is implied. Earlier nine-source acceptance below remains historical; extension verification is recorded in the assessment contract.

Creation requires the native report permissions and independent `reports.schedule` authority over the complete captured selection. The high-risk `report_scheduler` role grants scheduling only; it does not grant access to report sources. System administrators receive scheduling authority. Titles, reasons and filters are encrypted; immutable intent and run origins have signed custody. Definitions cannot be edited: duplicate and cancel instead. Each creator may retain at most 50 non-cancelled schedules.

Before every execution the worker resolves the active owner and effective current roles from the database, without retained session tokens. Both original and current intake/programme bindings must remain authorized. Newly generated output also requires full scheduling authority. Missing authority fails the attempt and pauses the schedule; it does not generate a partially authorized report. Libraries authorize before counts/pagination; detail and run history remain creator-private. Known-ID creator pause/cancel remains possible after source access loss without disclosing configuration.

## Execution Contract

- Daily or weekly cadence uses a minute-aligned UTC first run, from the current minute (with a one-minute validation grace) through 366 days ahead. Custody duration is 1..366 days, with the edition's inclusive UTC expiry semantics.
- Unstarted missed slots coalesce to the latest due slot. Captures use current source data, not invented historical snapshots. An already-started retry preserves its original slot, request key and custody date.
- Claims use database locks and a unique schedule/slot identity. Leases last 180 seconds; at most three attempts are allowed, with 30/60-second failure backoff. The in-process worker does not overlap its own batches.
- Capture, edition storage and run completion are separate transactions. Retry after an independently committed edition reuses its original idempotency key. This is not distributed atomic completion: an exhausted third lease can leave a private committed edition without a linked successful run.
- Pause/cancel terminates pending failed retries and prevents new claims. An already-claimed running attempt may finish. Resume rechecks full authority and skips unclaimed missed slots; cancellation is terminal. Transitions require reason and current revision.
- Finance defaults to `run_date`: the first claim's signed UTC date replaces the preview's old cutoff and remains stable across retries. `fixed` explicitly preserves the selected native cutoff date.
- Custody or due-state faults pause for reconciliation; the worker does not repair or re-sign altered intent. Audit metadata excludes private titles, reasons, filters and figures.

The development server starts an immediate batch and then checks every 30 seconds, up to five claims per batch. `SVU_REPORT_SCHEDULER=enabled|disabled` controls it; development defaults enabled, other environments disabled. `node scripts/run-report-schedules.js` processes one enabled batch. Authenticated due-run fallback cannot force a future run. Graceful server shutdown waits for its in-flight worker batch.

## API And UI

Authenticated no-store routes: `GET/POST /api/reports/schedules`, `GET /api/reports/schedules/{id}`, `POST /api/reports/schedules/{id}/transitions`, and `POST /api/reports/schedules/{id}/run`.

The native report panels expose scheduling only with explicit delegation. Libraries support kind/status filters and pagination; detail exposes encrypted configuration after authorization, recent run history and links to saved editions. Creation, duplicate, pause/resume and cancellation dialogs preserve revision/idempotency guards. Superseded requests, sign-out and access refusal erase stale private state. Tables scroll within the page on mobile.

## Verification

Fifteen focused unit checks cover input/cadence, finance cutoff, independent scoped authority, fresh owner resolution, encrypted intent, replay, missed slots, crash recovery after edition commit, lost authority, expanded output scope, bounded retries, lifecycle transitions, custody quarantine and worker non-overlap.

Initial `data/build-report-schedules-backend.log` remains FAILED at 9/10 selected browser checks: an existing withdrawal assertion mistook a busy disabled control for completed withdrawal. The test now waits for the terminal row and closed modal. Genuine automatic worker checks, migration, units and 22 smokes passed in that checkpoint.

`data/build-report-schedules-ui.log` remains FAILED: the browser runner failed before completing coverage with Node memory/semispace allocation errors; several smoke processes also failed. Only 9/22 smokes passed. No application/security workaround or unrelated process termination was made. Verification now supports optional bounded `SVU_TEST_CONCURRENCY` and used serial units plus `NODE_OPTIONS=--max-old-space-size=256 --max-semi-space-size=4`.

Recovery `data/build-report-schedules-resource-recovery.log` PASSED 18 selected desktop/mobile checks, units and all 22 smokes. Final `data/build-report-schedules-acceptance.log` PASSED 44 selected desktop/mobile checks across nine reporting files, units and all 22 smokes. The latter includes genuine automatic capture across all nine native domains, rolling finance cutoff, delegation expiry before execution, private history and native create/pause/resume/duplicate/cancel workflows. These selectors overlap, not 62 distinct checks. Final last-run metadata is passed with no failures; desktop library and mobile creation-dialog screenshots were inspected.

All four driver-owned databases (1791229462308, 1791230136728, 1791230703670, 1791231341120) are independently absent. Port 4197 was released after schedule verification. Independent serial final-source units pass 355/355 with no skips or failures (`data/build-report-schedules-unit-acceptance.log`, launcher 21766 exit 0). No full-suite or production acceptance is claimed.

## Local Runtime

The native migration runner applied 072 and the concurrently present Claude-authored 073 registration-exception schema (`data/build-report-schedules-local-migrations.log`), without reseeding, reference reload or operational fixtures. Read-only counts are 188 accounts, 114 applications, 28 student programmes, and zero student registrations, course enrolments, editions, schedules, runs or schedule transitions.

Previously verified owned PID 26740 was stopped. Matching development PID 4304/launcher 31343 intentionally remains live at `http://127.0.0.1:4177/#registry`, logs `data/dev-report-schedules.log` / `.err.log`. Health is 200/no-store; anonymous schedule library/detail/run/transitions are 401/no-store; the error log is empty. Separate subsequent examination-handover verification may reuse 4197; it is not part of schedule acceptance.

The one-pass worker was also run against this empty local queue and exited successfully with `{"runs":[]}`; no operational fixtures were introduced. Subsequent examination-handover verification is terminal and 4197 is released again.

## Remaining Gates

Institutional metric ownership, statutory templates, historical census, small-cell disclosure, approved distribution, legal retention/disposal/holds, operational alerting and production worker deployment remain open. Large selections, worker scaling and failure recovery require production load/operational acceptance. Empty examination selections without period-derived intake grants require global scheduling authority; narrower explicit intake selection is supported. Private capture is not an approved institutional reporting service.
