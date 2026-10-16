# Stage 8 Examination Reporting Foundation

Development implementation of the roadmap's operational dashboard and metric-dictionary requirements, traced to `RPT-07` and `RPT-11`. This first reporting slice uses examination sources already delivered in Stage 7. It does not declare earlier stage exit gates passed or establish institutional/statutory reporting definitions.

## Definitions

The code-owned catalogue `exam-operations-v1` records a stable metric ID, label, unit, formula, exclusions, filters, proposed owner and refresh policy. Examinations office ownership is proposed, not approved. Every definition and CSV explicitly retains development/owner-approval-pending status. Changes to metric meaning require a new definition version; no editable formula or arbitrary SQL interface is provided.

| Metric | Counted Source | Important Limits |
| --- | --- | --- |
| Orders awaiting review | `exam_orders.status = submitted` | Not approved or returned orders |
| Returned orders | `exam_orders.status = returned` | Retained returned rows may remain after a replacement; not unique papers requiring action |
| Draft timetables | `exam_timetables.status = draft` | Excludes periods without timetables, including periods never scheduled |
| Scheduled sittings | `exam_sittings.status = scheduled` | Includes past sittings; not upcoming exams, attendance or candidate counts |
| Retained publication editions | All immutable `exam_publications` | Includes new/retained origins and empty cancellation editions; cannot recover overwritten pre-migration history |

Registration periods with no examination activity remain visible as zero rows in the authorized reporting universe. No admissions/vacancy, statutory headcount, retention, finance, service-level, completion or graduate outcome is inferred from these examination measures.

## Authority And Consistency

- `GET /api/reports/examinations/dictionary`: existing `exams.schedule` or `exams.publish` authority; definitions contain no source records.
- `GET /api/reports/examinations`: the same authority, with optional `programmeCode`, `intakeId` and `periodId` filters; default JSON report.
- `GET /api/reports/examinations?format=csv`: a fresh report calculation and authorization check, returning a JSON envelope with CSV content, filename, definition version and generation timestamp for the existing authenticated workspace client.

Permission-specific role scopes are applied to current period/programme/intake metadata before any operational counts are queried. An unrelated global results/teaching role cannot lend its scope to a restricted examination role. Source counting accepts only selected authorized period IDs. Unknown/inaccessible explicit periods return 404; empty programme/intake selections produce zero totals, not unauthorized counts. Unknown filters (including `asOf`), invalid formats and oversized/control-character identifiers return 400. Student, duties-only, private-arrangements-only and results-only permissions do not grant reporting access.

Each calculation uses one repeatable-read PostgreSQL transaction. The database supplies the snapshot generation timestamp. Orders, sittings, timetable states and editions are counted independently, avoiding multiplicative joins; totals are sums of the returned period rows. This is an on-demand current-state snapshot, not an immutable report edition or historical reconstruction. The report reads no candidates, account IDs, private arrangement evidence, paper custody references/files or student records. Responses use the router's existing `no-store` policy.

Access and export have distinct audit actions. Audit metadata contains definition version, generation timestamp, filter identifiers and returned period count, not candidate/roster data. CSV includes definition approval status/version, applied filters, timestamp, row type, authorized period labels, metric ID, unit and count. Cells are quoted and spreadsheet-formula-leading text is neutralized. Exports calculate again rather than downloading the workspace's cached counts; a denied export produces no file. A refreshed export can legitimately differ from a previously displayed snapshot.

## Workspace

Registry exposes an initially collapsed examination-workload panel for authorized office users. It has authorized-period selection, refresh, CSV, aggregate measures, scrollable period comparisons and the definition catalogue. The generation time stays visible; refreshing is explicit and this is not a scheduled/live push report. Long labels and comparison columns remain readable inside constrained layouts. Generic Registry session-loss/logout reset and departed-session API response rejection cover report caches. Detached details toggles cannot overwrite current panel state.

## Verification

Five focused unit checks pass, covering catalogue/version/approval metadata, filter rejection, permission-specific scope before SQL aggregation, repeatable-read ordering, zero/filter results, period refusal, exact aggregate reconciliation, export auditing and CSV formula neutralization. All 200 unit tests pass.

The real examination browser journey adds live draft/returned/scheduled counts, scoped available-period checks, dictionary access, student denials, unsupported historical-filter refusal, period filtering and CSV export. Following complete cancellation it checks zero active/draft counts, retained edition growth, wrong-intake denials and direct isolated PostgreSQL source reconciliation. Report audit events omit candidate/private values. The separate desktop/mobile layout test uses the real renderer/binder with synthetic long labels; it checks document bounds, filters, freshly authorized export content, definitions and no file after simulated authority loss.

Final isolated `data/build-examination-reporting` passed migration/seed, all 200 unit tests, six desktop/mobile examination/publication/reporting checks and all 22 smoke checks. Database `svu_rebuild_it_1791178193965` and its server were torn down. Verification is scoped, not all browser journeys. The final CSS-only heading-spacing polish and explicit mobile navigation-clearance assertion additionally passed both viewports in `data/build-examination-reporting-layout-final`; desktop/mobile screenshots were inspected.

No schema migration or local reseed was required. Checked local counts remain 188 accounts and zero sittings, seating plans and publication editions. The refreshed development runtime and database are healthy: server PID 23784, launcher session 41326, at `http://127.0.0.1:4177/#registry`, with logs `data/dev-examination-reporting.log` and `.err.log`. The new dictionary route rejects an unauthenticated request with 401 and `no-store`. Previous server PID 14860 was stopped. Continuous build remains active; the next reporting slice can extend existing-source operational counts to admissions while preserving domain-specific authority and explicitly proposed definitions.

## Source Control Extension (2026-10-06)

RPT-07 source reconciliation now carries independent `controlsVersion: exam-source-controls-v1` without changing the five metric meanings or `exam-operations-v1`. Per-period and selected-period controls reconcile all retained order statuses (submitted/approved/returned), the optional single timetable (draft/published), and retained sitting statuses (scheduled/cancelled). Counts must be nonnegative safe integers. Missing, duplicate or foreign selected-period count rows fail 409 rather than becoming silent zero figures.

Scoped SQL verifies offering bindings, independent order review custody, linked approved orders and timetable publication custody. A published timetable must pin its current revision and independent publisher. A draft timetable may retain an earlier publication; that retained snapshot, staff snapshot, publisher, timestamp and revision must still match its immutable edition. Retained publication JSON has the declared revision and sitting-array shape; new published origins retain an independent preparer/publisher. Legacy retained origins may have no reconstructed preparer, as allowed by migration 060. These checks do not reconstruct unknown history, recalculate old candidate rosters or approve archival policy. They do not certify every nested snapshot field, physical attendance or official assessment recording.

Faults prevent partial JSON, CSV and capture output; no source records are repaired. JSON includes per-period and selected-period controls, and native CSV includes `control_period`, `control_total` and `controls_version`. Access/export audits include the control version and booleans, not source snapshots, candidate identifiers or private reasons. Existing encrypted private editions and schedules inherit the native source checks.

The registry report exposes a collapsible source-control view. Source errors remove previous figures/choices/export, show an error and a fresh all-authorized retry; permission refusal removes the report entirely. Generation/session guards discard superseded or departed responses, and a departed/superseded export creates no Blob. Sign-out still clears all private registry state. Retry does not repair native data.

Seven focused units pass, including malformed counts/partitions, missing/duplicate/foreign rows, source faults before success audit and privacy-safe control CSV. Independent serial all-unit run passes 372/372 without skips/failures (`data/build-examination-controls-units.log`, launcher 71276 exit 0).

Full isolated `data/build-examination-controls.log` PASSED all SIX independently listed desktop/mobile examination/report checks, migrations/seed, units and all 22 smokes; launcher 22517 exit 0. Real native publication-reference corruption is refused for both JSON and CSV, restoration recovers the same figures, and ordinary retained/draft/cancellation publication histories remain usable. Database `svu_rebuild_it_1791238332524` was dropped and independently confirmed absent; 4197 is released and final last-run metadata is passed/no failures.

Four final desktop/mobile state/layout/retry/control-view checks pass (`data/build-examination-controls-layout-accepted.log`, launcher 49213 exit 0), including explicit mobile fixed-navigation clearance. Desktop/mobile control screenshots were inspected and all four rows are unobstructed. Earlier four-check checkpoints (`data/build-examination-controls-layout.log`, 60328; `data/build-examination-controls-layout-final.log`, 13842) also passed but precede the final clearance assertion. Those overlapping selectors are not additive unique coverage. Only UI test assertions/docs changed after the full driver launched; accepted backend/frontend code remained unchanged. No full-suite or production acceptance is claimed. Previous acceptance above remains historical.

No migration, local reseed or operational fixture was required. Local accounts/applications/student programmes remain 188/114/28, with zero registrations/enrolments/orders/sittings/timetables/publications/editions/schedules. Old backend PID 16080/launcher 21356 ended. Matching PID 3276/launcher 78570 serves `http://127.0.0.1:4177/#registry`, logs `data/dev-examination-controls.log` and `.err.log` (empty). Health is 200/no-store; anonymous examination report/dictionary and assessment report are 401/no-store. Finite verification sessions are terminal; the development server remains intentionally live. Coordinated migration 074 is still absent, so active-withdrawal reader integration remains pending.

## Remaining Gates (Unchanged)

Metric owners, institutional formula/filter approval, statutory definitions, service-level clocks, privacy/small-cell disclosure rules, scheduled execution/delivery/consent, immutable report snapshots, cross-domain management dashboards, legacy reconciliation, production-volume indexing/load tests and owner acceptance remain open. Source consistency checks against synthetic test data do not constitute approved institutional control-total reconciliation.
