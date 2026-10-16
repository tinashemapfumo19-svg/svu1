# Applicant Campaign Operations Reporting

Stage 8 / COM-03. Reuses migration 063 without a schema change. Operational development definitions remain pending institutional approval under D-28/D-32; no provider dispatch or delivery outcome is inferred.

## Workspace And Scope

Admissions > Applicant campaign workload requires native `admissions.communicate` programme/intake authority. Each scope comes from a role granting that permission; unrelated global roles cannot widen it, and an empty intake list is not programme-wide authority. Published campaigns are visible within intake scope. Unpublished previews, including expired previews, remain visible only to their creator, even for administrators. Counts do not disclose other staff's private previews.

Communication-only staff can enter the admissions workspace without admissions.review. Review-queue controls/details/manifest are hidden and their caches cleared when review authority is absent; independent communications/report loaders still authenticate their own permissions. This does not grant application review access.

Optional intake/status and paired inclusive UTC campaign-created dates select a cohort. Default is all retained visible records. Status is current preview/published, not historical state; created dates are real, ordered, at most 366 inclusive days and not future. They do not filter publication/read/cancellation events by when those actions happened. Explicit inaccessible intake filters fail 404.

## Definitions And Controls

Dictionary `applicant-campaign-operations-v1` has 23 measures with proposed owner, pending approval, formula, exclusions, filters, units and refresh policy. UI definitions and CSV version/approval metadata remain explicit.

- Visible campaigns partition into published and own previews; previews partition into live and expired at the report snapshot. A live preview is not approval to publish after audience/consent changes.
- Published captured application/account opportunities sum the retained publication audience snapshots, not current applications or unique people. Repeated campaigns count the same application/account again. Captured accounts include excluded/unconsented accounts. Exclusions are channel-specific snapshot opportunities; zero when that channel was not requested, not current opt-out headcounts.
- Captured eligible recipient-channel totals reconcile to retained published recipients. One account may receive both channels. Distinct recipient accounts are directly counted across recipient records, not summed intake unique counts or inferred unique people.
- Available in-app messages partition into recorded-read and without-recorded-read. A read is the explicit retained portal acknowledgement, not comprehension or an external delivery receipt. Read messages remain available.
- Email records partition into queued and cancelled. Queue records have no provider dispatch/delivery/failure/retry outcome. Cancellation retains the original recipient; there is no cancellation timestamp and no elapsed cancellation metric. Re-opting in does not turn a cancelled record into a queued record.
- Published channel campaigns reflect requested channels and may have zero eligible recipients on one channel. They are not dispatched campaigns.
- Publication timing is original preview creation to publication. Read timing is recipient creation/availability to first retained read. Means use actual samples, not averages of intake averages, handling/business-hours time or an approved SLA. No samples yields null (dash in UI, blank CSV), never invented zero.

One repeatable-read transaction captures generation time, authorized cohort, source checks, campaign and recipient grouping-set aggregates. Campaign/audience/channel/read/timing controls accompany totals and intake rows; row differences cannot cancel in total controls.

Each visible campaign is independently checked before aggregation: bounded whole-number audience counts and channel/exclusion arithmetic, supported distinct channels and native audience-filter intake, publication/preview time ordering, no recipients on previews, and exact publication snapshot versus actual recipient counts per channel. Historical recipient preference revisions must retain affirmative consent for their captured channel with a preceding history timestamp. Recipient availability/read timestamps must be ordered and not future. Missing/surplus recipients in different campaigns cannot cancel out to an accepted total. A 409 requires source reconciliation; the report never repairs sources. Intake metadata remains separately discoverable within authority.

Current application/workflow/account/consent changes do not reconstruct or rewrite captured publication audiences. Historical affirmative preference evidence validates original eligibility, not ongoing consent. Original encrypted audience hashes/content are not decrypted or independently reverified by reporting; this report reconciles retained aggregate snapshots and recipient records, not content validity or a full migration acceptance certificate.

## Privacy And Exports

Queries do not select or decrypt subjects, bodies, internal reasons, encrypted audience/contact data or destination addresses. Outputs omit campaign/recipient/account/creator IDs and contact details. Only authorized intake labels, metric definitions, filters, counts, sample durations and controls appear. Access/export audits retain bounded cohort/count/control metadata, never content, contact addresses or intake labels.

CSV is a fresh authenticated source read, not a download of cached screen totals. Formula prefixes are neutralized and cells quoted; filename is fixed `applicant-campaign-operations.csv`. `providerDeliveryEvidenceAvailable: false` remains explicit in JSON/dictionary and CSV. APIs use no-store.

Token/generation-bound loads discard departed/superseded responses. Session/scope refusal clears totals, intake and filter caches. Source/network failures hide old totals and disable export; recovery uses only fresh authorized metadata. Shared staff logout clears private state.

## API

- `GET /api/reports/communications`: JSON; optional `intakeId`, `status` (preview/published), paired `from`/`to`, `format=csv`.
- `GET /api/reports/communications/dictionary`: versioned definitions and absent-provider-evidence flag.
- `GET /api/reports/communications/intakes`: current authorized intake choices without count reads.

Unknown filters/statuses, unsupported formats, unsafe identifiers and incomplete/invalid/oversized/future creation cohorts are refused.

## Verification

Seven focused tests and all 300 final-source unit tests pass (`data/build-communication-reporting-unit-final.log`). Coverage includes definition/privacy/delivery distinctions, UTC/status bounds, creator-aware native scope, non-additive recipient totals, consistent snapshots, per-publication/historical-consent guard structure, null timing/control behaviour and fresh audited formula-safe CSV.

Initial `data/build-communication-reporting.log` remains FAILED at 7/8 selected browsers: the desktop report journey, both report loaders and existing communications journeys passed, but mobile correctly refused an administrator preview fixture key reused from desktop with different content. Units and all 22 smokes passed. The fixture key now includes its viewport/run stamp. Launcher 48652 ended exit 1; database `svu_rebuild_it_1791217870913` was dropped and independently confirmed absent. The communication-only workspace change was added after this checkpoint, so it is not final-source acceptance.

Final `data/build-communication-reporting-final.log` passes migrations/seed, the unit suite, all EIGHTEEN selected admissions/communications/campaign-report/enquiry-report desktop/mobile browser checks and 22 smokes. Selector independently lists 18 tests across four files; last-run is passed with no failures. The real journeys cover other-creator published visibility and unpublished-preview privacy, own live/expired previews, multi-intake direct distinct recipient totals, captured repeated opportunities, native read acknowledgement and direct SQL elapsed-time comparison, status/created cohorts, fresh changed-consent cancellation CSV versus older screen totals, formula-safe intake labels, balanced missing/surplus recipient source faults, stale-total hiding/export disablement, authorized alternate-intake recovery, live scope-change cache erasure, sign-out, and a native communication-only role that still receives 403 from review APIs while its own report loads and review controls stay absent. Loader journeys cover departed/superseded/revoked state and failed-source metadata recovery. Final desktop/mobile viewport/full-page screenshots were inspected; wrapped headings, readable measures and contained intake tables are retained. No full-browser-suite or production acceptance is claimed.

Launcher 64648 ended exit 0; its server stopped and database `svu_rebuild_it_1791218127751` was dropped and independently confirmed absent. Both owned databases are absent; port 4197 is released. Fixtures and deliberate source faults were confined to driver-owned temporary databases. Unrelated databases were not touched.

## Local Runtime

No migration, reseed, reference reload or operational mutation was needed. Previous owned development PID 29088/launcher 90444 ended after confirming listener ownership. Current matching-source backend is PID 7816/launcher 14614 at `http://127.0.0.1:4177/#admissions`, logs `data/dev-communication-reporting.log` and `.err.log`; health 200, all three anonymous campaign-report routes 401/no-store, error log empty. Read-only counts retain 188 accounts, 114 applications, 28 programme records and zero registrations/enrolments/campaigns/recipients/preferences/preference-history/support/enquiries. The persistent development server remains intentionally live. Existing source and other agents' reservations were preserved.

## Remaining Gates

Institutional metric/source-control approval, sending provider/consent/retention policy, delivery receipts, retries and failure timelines, cancellation history, sending limits, sensitive/small-cell disclosure, scheduled distribution, retained editions, accessibility/owner acceptance and production migration remain open. Queue status does not establish any of these approvals.

## Campaign Delivery Follow-Up - 2026-10-09

The later consent-controlled email bridge supersedes the original queue-only reporting boundary: current dictionary `applicant-campaign-operations-v2` has 29 measures, adding accepted/delivered/bounced/complained/failed/dead counts. Recipient reconciliation includes each state while published audience totals remain immutable. Signed callback outcomes require matching retained delivery records; cohort provider-evidence flags are not inferred from acceptance or from the dictionary alone. Existing saved editions retain their original definitions. See `../EMAIL_DELIVERY.md` and `../LEGACY_COVERAGE_GOAL.md` for current runtime, 473 passing units, 14 selected desktop/mobile checks and remaining production/policy dependencies. Earlier verification receipts above remain historical, not current full-suite acceptance.
