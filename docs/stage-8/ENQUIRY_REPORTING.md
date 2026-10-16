# Prospective Enquiry Operations Reporting

Inventory: `COM-11`; Stage 8 reporting and communication-service measurement. Reuses migration 066 without a new schema migration. This is an operational development report, not an approved institutional metric, external lead census or response SLA. D-28 and D-33 remain open.

## Workspace And Scope

Admissions staff use `#admissions` > Prospective enquiry workload. The report, intake choices and dictionary require `enquiries.manage`. Each intake is authorized only by a role granting that permission; an unrelated global auditor role cannot widen it. Retained closed intakes remain available within scope. Explicit inaccessible intake filters fail with 404 instead of returning invented zero counts.

Application associations additionally require a role granting `admissions.review` for the same intake. If any selected intake lacks that authority, the selection-wide application counts and control are null/unavailable rather than partial totals. Authorized intake rows can still show their own counts. Enquiry workload and distinct-account measures remain available. Neither unrelated global roles nor admissions authority in another intake grants access to the missing association facts.

Intake and paired created-date filters support all retained records by default or an inclusive UTC creation cohort of at most 366 days. Bounds must be real calendar dates, ordered, and no later than the current UTC date. These filter when enquiries were created, not historical case status or actions performed in that period. Current status, public response history and application associations are evaluated at the fresh report snapshot.

## Definitions And Controls

The versioned dictionary is `prospective-enquiry-operations-v1`, defined in `server/modules/enquiry-reporting.js`. Every measure records a proposed owner, pending approval, formula, exclusions, unit, filters and refresh policy. The UI exposes the definitions; CSV retains the version and pending-approval status.

- Retained enquiry records partition into current open, in-progress, waiting-applicant, resolved and consent-withdrawn states. Reopened records appear only in their current status.
- Active consent reconciles to the three live states; ended consent reconciles to resolved plus withdrawn. This consent concerns replies in one portal enquiry, not marketing or another channel.
- Unassigned and escalated active records are workload subsets. Publicly answered means at least one public staff message, not a private note, delivery receipt or read acknowledgement. Active cases with/without such a reply reconcile to active consent. A reopened case retains its earlier public response history.
- Verified accounts are distinct enquiry owner accounts, not unique people. One account can appear in multiple intakes. Totals use a direct SQL distinct count, never the sum of intake distinct counts.
- Application associations match the owner account and intake. Any retained application includes pre-existing or withdrawn applications. The later-application subset uses application creation at/after enquiry creation. Neither measure proves causal conversion, admission, acceptance, active enrolment or marketing consent.
- First-reply timing uses elapsed UTC minutes from original creation to the first public staff message, across answered cases only. Resolution timing uses original creation to the latest resolution for currently resolved cases only. Reopened cases are excluded until resolved again. These are not business hours, current-reopening response targets, handling duration or approved service levels.
- No timing samples produces null, shown as a dash, not zero minutes. Total averages are computed directly from their source samples, not by averaging intake averages.

One repeatable-read transaction captures the report timestamp, authorized cohort, source checks, totals and intake rows. Status, consent, reply, application and timing controls are retained in JSON/CSV; row discrepancies cannot cancel each other in the total control. Unavailable application authority produces a null application control, not a source-error warning.

The source check refuses mismatched intake/programme custody, missing/mismatched latest revision history, future creation/message timestamps and messages preceding creation. Associated application records require their expected `Application` resource-scope bindings before association counts are read. Reconciliation failure is 409; authorized intake metadata remains separately discoverable. No source correction or consent mutation is performed by reporting.

## Privacy And Exports

Report queries do not select or decrypt subjects, message bodies or internal reasons. Responses and CSV contain only authorized intake labels, definitions, counts, samples, durations, control flags and filter/snapshot metadata. They omit owner/assignee/staff identities, contact details, conversation text and private notes. Access/export audits retain the definition version, scope size, cohort, count and controls, never conversation text.

CSV is generated by a fresh separately authenticated request, not a download of cached UI totals. Its application facts are reauthorized independently for the current scope. Text cells neutralize spreadsheet formula prefixes; quoted cells handle commas and quotes. Download filenames are fixed by the service. Unavailable application values and no-sample durations remain blank.

Browser loads bind token and generation, discard superseded/departed responses, and erase report totals, intake choices and filters on scope/session refusal. Reconciliation/network failure hides totals and disables export while retaining only freshly authorized intake metadata for recovery. Sign-out clears the shared staff workspace. APIs use `no-store`.

## API

- `GET /api/reports/enquiries`: JSON by default, optional `intakeId`, paired `from`/`to` and `format=csv`.
- `GET /api/reports/enquiries/dictionary`: version and immutable definitions.
- `GET /api/reports/enquiries/intakes`: current authorized intake choices without operational count reads.

Unknown filters, unsupported output formats, unsafe intake identifiers, invalid/future dates and incomplete or oversized cohorts are refused. This is not an as-of reconstruction API.

## Verification

Nine focused tests and all 286 final-source unit tests pass (`data/build-enquiry-reporting-unit-final.log`): definition distinctions, bounds, exact scopes, consistent snapshot and non-additive totals, primary custody/history checks, separate application authority/bindings, null timing/control behaviour and fresh audited formula-safe CSV.

Initial `data/build-enquiry-reporting.log` passed migrations/seed, the unit suite, TEN selected reporting/enquiry desktop/mobile checks and all 22 smokes. Launcher 14284 ended exit 0; driver database `svu_rebuild_it_1791214261565` was dropped and independently confirmed absent. Both report viewport screenshots were inspected: unframed measures, readable wrapped headings and contained mobile tables/controls. The application resource-binding guard and real separate-domain permission fixture were added after this checkpoint, so it is not final-source acceptance.

Final `data/build-enquiry-reporting-final.log` passed migrations/seed, the unit suite, all EIGHTEEN selected reporting/enquiry/guidance/communications desktop/mobile checks and all 22 smokes. The selector was independently listed as 18 checks across four files; last-run metadata reports passed without failures. Coverage includes real report filters/downloads, distinct-owner totals across intakes, public/private reply distinctions, pre-existing/later application associations, elapsed-time source comparison, current history and application scope reconciliation refusals, fresh changed-status export, role-scope change/refusal, native enquiry-only authority without same-intake admissions review, and departed/superseded/revoked browser state. Final desktop/mobile report viewport screenshots were inspected. No full-browser-suite acceptance is claimed.

Launcher 87509 ended exit 0; its server stopped, database `svu_rebuild_it_1791214663815` was dropped and independently confirmed absent, and port 4197 has no listener. Both owned reporting-test databases are absent; unrelated databases were not touched.

## Local Runtime

No migration, reseed, reference reload or operational mutation was needed for reporting. Previous development PID 13348/launcher 33725 ended; intermediate PID 19676/launcher 66575 was replaced after the application-binding guard. Current matching-source backend is PID 29228/launcher 6833, `http://127.0.0.1:4177/#admissions`, logs `data/dev-enquiry-reporting-final.log` / `.err.log`. Health is 200; all three anonymous enquiry-report routes are 401, all `no-store`; error log empty. Read-only counts independently retain 188 accounts, 114 applications, 28 student programme records, zero registrations/enrolments/support cases/enquiries/messages/history. The persistent development server remains running intentionally. Existing source and other agents' reservations were preserved.

## Remaining Gates

Admissions/communications ownership, approved metric definitions and source control totals, response targets, after-hours/business-calendar rules, current consent-cycle timing, provider delivery/read evidence, external-channel identifiers and attribution, small-cell disclosure, scheduled distribution, retained report editions, accessibility/owner acceptance and production data migration remain open. Student-support and outbound-campaign service measures are separate workflows, not implied by this report. Real AI/WhatsApp/provider delivery remains outside this development slice.
