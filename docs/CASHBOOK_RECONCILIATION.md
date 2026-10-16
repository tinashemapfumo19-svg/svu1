# Cashbook Reconciliation Core

Implementation stage, 2026-10-10. `server/modules/cashbook-reconciliation.js` is a pure, tested calculation engine. It is not exposed through the repository/router, has no database side effects and is not yet an authorized institutional cashbook service. The existing student ledger remains unchanged.

Current stage: the calculator is now used by authenticated cashbook command/read APIs described at the end of this document. The earlier sections retain implementation-stage history. User-facing UI and CSV exports remain unfinished; no institution-approved operational accounting policy or legacy import is claimed.

## Evidence Contract

`reconcileCashbookEvidence` accepts an inclusive `from`/`to` period, 1-100 uniquely identified accounts and up to 10,000 uniquely identified current-period movements. An optional `originalMovements` array contains up to 10,000 retained earlier-period originals referenced by current reversals. Unknown fields, invalid dates, duplicate identifiers, incomplete evidence and wrongly classified movement dates fail closed.

Each account explicitly provides `id`, `kind` (`bank` or `cash`), `currency`, `openingMinor`, `observedMinor`, `openingEvidenceRef` and `observationEvidenceRef`. References are supplied evidence identifiers, not proof that a statement or count was independently verified. Omitted observed/opening values are never replaced by zero. Bank balances may be signed; physical-cash observations cannot be negative.

Amounts are canonical decimal minor-unit strings, never JavaScript numbers. Arithmetic uses bigint and refuses signed 64-bit storage overflow, including aggregates. Currency codes are explicit; configuration approval and reference-catalogue validation belong to the future authorized persistence layer.

Supported movement kinds:

- `revenue`: positive inflow to one account.
- `expenditure`: positive outflow from one account, even in periods with no income.
- `bank_charge`: bank-account outflow, included once in expenditure and separately identified in charge totals.
- `transfer`: one conserved outflow/inflow between distinct same-currency accounts. It is not institutional revenue or expenditure.
- `reversal`: exact inverse of one original movement, dated no earlier than that movement. The original may be in the current period or in `originalMovements`. Amount/account overrides, missing originals, repeated reversal and reversal-of-reversal are refused.

Retained earlier originals must be dated before the current period and explicitly include `priorReversalId: null`. Missing prior-reversal evidence, an existing prior reversal, duplicate/current-period identifiers and unused originals are refused. Earlier original effects are not posted again; only the current reversal changes this period. The supplied no-prior-reversal assertion is an internal calculation contract, not proof of database authority. The future reader must obtain it from retained records under a lock, and database uniqueness must prevent competing reversals across periods.

## Results

For each account, expected closing balance equals its own opening plus net incoming minus net outgoing. Signed variance equals observed minus expected. Currency-separated totals contain opening, expected, observed, variance, net revenue/expenditure, charge and transferred amounts. Bank and cash openings are never conflated. A zero currency-total variance cannot hide offsetting account-level discrepancies: reconciliation requires every account to match individually.

Output is JSON-safe and contains the version `cashbook-reconciliation-v2`, exact decimal amounts, current movement/reversal/retained-original counts and a deterministic internal SHA-256 evidence hash. Account/event/original input order does not change the hash; supplied observations, references and movements do. Earlier originals are included in the hash even though they are not current-period postings. This hash does not establish authorization, freshness, retention or approval and must not be used as a substitute for database locks and immutable snapshots.

Cross-period corrections can produce negative net revenue, expenditure, bank-charge or transfer totals. These signed corrections are preserved, not clamped to zero or relabelled as a new receipt. Their institutional reporting/closure treatment still requires approved policy.

`cashbookPeriodsOverlap` checks complete inclusive interval intersection, including an interval enclosing another and a shared endpoint. It does not itself serialize concurrent bookings; the persistence layer must lock and enforce the same invariant across all relevant periods/accounts.

## Verification and Next Work

All 495 unit tests pass. Eleven focused tests cover interval containment/boundaries, zero-income expenditure, signed variance, transfer conservation, bank/cash separation, multi-currency/account-level reconciliation, exact current/cross-period reversals, prior-reversal evidence, earlier transfer/charge corrections, unused/colliding original rejection, strict inputs, precision above JavaScript's safe range, storage overflow and deterministic non-mutating evidence.

Required next stages remain: independently approved native/external accounting boundary and policy configuration; institutional account governance; append-only movement/reversal storage; captured recording cutoffs; authorized cross-period correction commands and original-state locking; period locking and opening-evidence selection; audited/replay-safe revisions; independent immutable closure; authorized exports and UI; isolated API/database and desktop/mobile workflow tests. Student-receipt posting, tax/chart-of-accounts rules and historical accounting import are not inferred from this calculator.

No institutional balance, policy, transaction or legacy import was created. Migration 093 subsequently added the empty storage foundation described below. The calculator remains internal and unexposed; full accounting coverage remains incomplete in `LEGACY_COVERAGE_GOAL.md`.

## Retained Storage Foundation

Migration `093_cashbook_storage.sql` adds policies, currency-bound books, bank/cash accounts, movements, periods and actor-bound command receipts. No permissions/roles, policies, books, accounts or financial facts are seeded by this migration.

Policy definitions are immutable, with revision-bound draft/publication/retirement transitions and publication requiring a reviewer different from the creator. New books and writes require a published policy; retirement stops new activity while retaining records. These constraints do not establish actual institutional approval: an authorized application workflow still needs to verify the current permission-bearing roles and record its audit.

Books/accounts/movements/receipts are append-only. Composite foreign keys prevent transfers or reversals from referring to another book's accounts/movements. Positive regular amounts are required, bank charges require bank accounts, and every original movement can be reversed only once. Reversals cannot precede originals or target another reversal. Currency conversion is not supported because every book has one immutable currency.

Account openings, movements and period writes share a book-level transaction advisory lock. Periods cannot overlap, including enclosing intervals or shared endpoints. Closed periods prevent new postings or account openings at/before their closing date. Period definitions cannot change, revisions must advance once, and closed records cannot be updated/deleted. Closure requires an actor different from the period creator and all current-period movement creators.

Snapshot guards bind definition, period and evidence hash, require exactly one row for every account opened through period end, compare current movement count, and refuse postings recorded after capture. Calculation/row-value correctness and evidence-hash recomputation still belong to the future internal capture command; this schema is not a public snapshot-submission API. Role authorization, original-state reads, audit transactions, replay semantics, lifecycle history and institution-approved variance handling are still required before exposing closure.

Two database checks run under the desktop/mobile integration projects passed in isolated database `svu_rebuild_it_1791586230803`, subsequently dropped. They exercise policy gating/retirement, independent reviewers/closure, missing amounts, bank-charge kind, once-only reversals, immutability, overlapping/enclosing periods, account completeness, stale capture and closed-period backdating. A controlled two-connection test observes the closing connection waiting on an advisory lock, commits the competing posting and verifies closure refuses the stale snapshot. These are database checks, not browser UI or API authorization journeys.

Final unchanged 465-file source SHA-256: `c9803bd918082e824baa1a11aa46bda5421c285531282882640e945ee9ff1cc2`. All 495 unit tests also pass. All three isolated storage verification databases are independently confirmed absent.

Migration 093 applied to the working database without reseeding. All six new tables remain empty, and the existing server/database health checks pass. No server restart was necessary for the unexposed schema. The next stage is the authorized account/cashbook commands, internally calculated captures and audited independent closure, followed by UI/export workflows and isolated verification.

## Internal Command Workflow

`server/modules/cashbook.js` now supplies policy creation/publication/retirement, book/account creation, retained movement/reversal commands, period creation, capture and closure. It is not yet wired into the repository/router. Permission-bearing roles must have institution-wide scope for `cashbook.policy.manage`, `cashbook.policy.approve`, `cashbook.manage` or `cashbook.approve`, as applicable. Public authentication and real role provisioning are still pending; internal fixtures are not institutional role appointments.

Commands validate bounded inputs, serialize actor/request keys and use keyed HMAC receipts. Canonical object-field ordering supports identical retries; changed commands cannot reuse a key. Successful business records, metadata-only audit and receipt commit together. Financial evidence text is not copied into the general audit. A configured 32-byte data key is required for receipts.

Capture holds the book lock and reads actual retained accounts/movements. It requires one explicit observed balance/reference per account and calculates the full snapshot internally. Periods must begin at the book start or the day after the latest closed period; gaps are refused. Later opening values come from each account's prior observed closing balance, not a combined bank/cash total. Accounts introduced after the prior close use their own retained opening evidence. Earlier reversal originals are read from the same book, not accepted as client-supplied amounts.

Closure excludes the period creator, current-period posters and every observation capturer. It checks revision/hash and recalculates from current retained movements under the same lock. Changed evidence requires recapture. Nonzero account discrepancies cannot be closed: no institutional variance-exception policy is configured. This restriction is not a claim that the institution never permits approved exceptions; that governed workflow remains outstanding.

Migration 094 adds append-only capture snapshots bound to their current draft/revision and a database closure guard against capturer self-approval. Internal capture records this history transactionally. Direct privileged database writes remain outside application authentication and must not be exposed as a client snapshot-submission service.

All 497 unit tests pass. Four internal command/storage checks passed under both integration projects in `svu_rebuild_it_1791586613125`, with unchanged 469-file SHA-256 `dcfd8cd9869a6ca4a75b49ba3291aefd3661369fefbf3772430d9ebc5d8a135b`; database dropped. Tests include concurrent replay, conflicting reuse, policy/closure self-approval, incomplete observations, stale/discordant captures, frozen closure, prior observed openings, cross-period corrections, capture retention and audit privacy, alongside existing storage/lock checks. These are internal-module/database tests, not browser UI or public API journeys.

The first command run remains failed: first-period validation converted a database calendar date through local time to UTC. It was fixed by selecting an exact SQL calendar-date string without weakening the assertion. Both databases are independently confirmed absent. Migration 094 applied to working data without reseeding; all seven cashbook tables remain empty and existing server/database health is good. No real policy, account, approval, transaction or source import was created.

Next: permission/role provisioning, fresh authenticated API authority, bounded authorized read models, CSV/export controls, UI and desktop/mobile public workflow verification. Audit-failure/revocation, variance governance, operational retention and external/native approval gates also remain explicit. The overall accounting and legacy-coverage goal is incomplete.

## Authenticated APIs and Reads

Migration 095 provisions distinct institutional cashbook officer/approver roles and five cashbook permissions. The officer can view/manage records and define/retire policies; the approver can view, independently publish policies and approve closure. System administrators have these permissions but still cannot approve their own policy, period, posting or observation. Ordinary student-finance, auditor and connector roles do not inherit cashbook access. Staff invitation acceptance now supports both new roles, including own leave/private-message access. No working staff appointment was made.

Fresh native authentication supplies role authority on every request; the permission-bearing role must itself have institution-wide scope. Unrelated global roles cannot widen scoped cashbook authority. Ended assignments deny subsequent reads. Reads return no-store responses and append metadata-only audit records in the same repeatable-read transaction.

Routes:

- `GET /api/cashbooks`: workspace, with independent `bookOffset`/`policyOffset` pages of 25.
- `POST /api/cashbooks`: create a policy-gated book.
- `POST /api/cashbook-policies` and `PUT /api/cashbook-policies/:id`: create and publish/retire policies.
- `GET /api/cashbooks/:id`: account definitions, movements and period metadata; independent `movementOffset`/`periodOffset` pages of 25.
- `POST /api/cashbooks/:id/accounts`, `/movements`, `/periods`: retained definitions, postings and periods.
- `GET /api/cashbook-periods/:id`: current snapshot and immutable capture history, 25 records per `captureOffset` page.
- `POST /api/cashbook-periods/:id/capture` and `/close`: internal calculation and independent closure, never arbitrary submitted snapshots.

Read offsets are canonical decimal strings bounded to 100,000. Unknown/duplicate query parameters and queries on commands are refused. Commands accept bounded JSON bodies and strict module-specific fields. Creation serializes and enforces the 100-account limit. Constraint conflicts produce coarse reconciliation errors instead of raw financial database diagnostics.

Authorized reads include retained financial evidence and its references, but exclude command request keys, receipt bodies and HMAC digests. Retired policies stop writes without removing authorized retained-history reads. No as-of reconstruction, account-level scoped sharing or external financial publication is implied.

All 499 unit tests pass. Six selected native API/internal-command/storage checks passed under both integration projects in `svu_rebuild_it_1791586973834`, subsequently dropped, with unchanged 471-file SHA-256 `ff53890261b12e956bb755a14a7936fb79a03a681a50369ab9df7f2aef405155`. Native checks include sign-in, actual role grants, scoped denial, separate officer/approver authority, policy publication, 27 postings across pages, query misuse, capture/closure/read evidence and ending both permission-bearing assignments. These are HTTP/database checks, not visual UI verification.

The first six-check run remains failed at 5/6 because its desktop reviewer fixture left an active assignment for mobile. Ending that fixture through native access administration fixed isolation and added reviewer revocation verification; the original initial-denial assertion was retained. Both API verification databases are independently confirmed absent.

Migration 095 applied without reseeding. Hidden server PID 5408/start milliseconds `1791587060829` is healthy at http://127.0.0.1:4173 with external email disabled and empty error log. Unauthenticated `/api/cashbooks` returns 401; all seven working cashbook tables remain empty. No accounts, policies, balances, transactions, approvals or external provider effects were fabricated.

Remaining: cashbook UI and exports, public browser session/cache/visual journeys, audit-write-failure injection, approved variance-exception and operational policy/retention handling, authoritative import and native/external ownership decision. This is not full legacy accounting parity or overall goal completion.

## Cashbook Workspace

The native staff workspace at `#registry/cashbook` now provides policy creation/publication/retirement, book and bank/cash account definitions, revenue/expenditure/bank-charge/transfer/reversal posting, period creation, explicit closing observations and independently approved closure. It displays retained movement pages, named account balances, signed discrepancies and capture history. Amounts are explicitly labelled minor units; missing observations are not fabricated as zero. Controls follow current permissions, published-policy state and server-calculated independent closure eligibility.

Submitted command drafts and actor-bound retry keys remain in memory only. A lost response can be retried with the identical body/key, including the submitted revision/hash, without silently rebasing the command. Explicit draft discard drops that pending command. Route departure, account changes and denied reads remove cashbook state and financial drafts. Context guards prevent delayed responses from restoring departed-account data or erasing newer-account state. No financial browser-storage persistence is introduced.

All 501 unit tests pass, including delayed-read/account-change and selected-book access-denial regressions. Final desktop/mobile browser journeys passed in isolated database `svu_rebuild_it_1791588096123`, subsequently dropped, with unchanged 474-file source SHA-256 `56ccef08faf8c9fdd0657c51148242320243c4daf6bfdd340fe6a5a607f27271`. These actual browser journeys verify policy publication, account opening, posting, capture, independent closure, revoked access and same-route account changes. A deliberately lost committed posting response is retried with the same request key and leaves exactly one retained movement. Final desktop/mobile balance screenshots in `data/cashbook-ui-final-privacy` were inspected.

Earlier combined UI/API/internal-command/storage verification passed all eight selected desktop/mobile checks in `svu_rebuild_it_1791587809925`, with unchanged 474-file SHA-256 `ea25343eb460f0c891bce6c9179d30481e717c66b37017a37ab547877a2e0753`. Later changes tightened frontend denial cleanup, reversal-choice labels and unit coverage; the final two browser checks above verify that final runtime source. The earlier eight checks are not substituted for a final-source eight-check run.

The initial combined UI run remains failed at 5/8: a self-publication assertion also counted unrelated retirement forms, and its failed reviewer fixture left authority active for the next project. Scoping the assertion to the created policy's publication control and ending native reviewer authority in `finally` fixed test isolation without weakening independent-approval or initial-denial assertions. All six milestone verification databases are independently confirmed absent, including that failed run and subsequent successful runs.

The owned server was restarted hidden as PID 22944/start milliseconds `1791588226393`; health/database checks pass at http://127.0.0.1:4173 and its error log is empty. External mail remains disabled. No migration or reseed was needed. All seven working cashbook tables contain zero rows; no working financial policy, balance, posting, appointment or institutional approval was fabricated.

Next: authenticated bounded cashbook CSV exports with exact minor units, spreadsheet protection and transactional metadata-only audit. Audit-write-failure injection, approved variance exceptions, operational retention, authoritative imports and the institutional native/external ownership decision remain open. The overall legacy coverage goal remains active and incomplete.

## Native CSV Reports

`GET /api/cashbooks/:id/reports` returns an authenticated download payload under current institution-wide `cashbook.view` authority and no-store response headers. The workspace provides a report selector, optional movement date inputs and download button. Reports include all matching rows, not the currently visible 25-row page; more than 5,000 rows refuses the entire export.

- `kind=accounts`: retained account definitions, names/kinds, opening dates, exact opening amounts and references. These are original opening facts, not current balances.
- `kind=movements` (default): retained movements with optional inclusive `from`/`to` dates. Bank/cash account names, transfer endpoints and original reversal references remain distinct. Reversal rows include original amount/kind/date/account references, including earlier originals outside the filter, without pretending that the reversal has a separately submitted amount.
- `kind=reconciliation&periodId=...`: that book's selected period's captured account rows with opening/incoming/outgoing/expected/observed/variance amounts and references. Status, revision, capture/closure times, closing actor, evidence hash, calculation definition and `capturedSnapshotOnly=true` identify retained evidence. Missing capture refuses output. A draft can become stale after capture; exporting it does not recalculate it or imply independent approval. Closed snapshots remain immutable under the native workflow.

Unknown/duplicate filters, wrong-kind filters, invalid/future/reversed dates and cross-book or missing period references fail. Retired-policy history remains readable under current authority. No consolidated multi-currency totals, as-of reconstruction, external voucher/report compatibility or accounting-system integration is implied.

CSV `cashbook-reports-v1` repeats generation time, report kind, movement filters, book/currency/policy identity alongside row evidence. Values are quoted with doubled embedded quotes and CRLF records. Formula-like cells receive an apostrophe, including negative monetary strings; output never converts exact amounts through JavaScript numbers. CSV cannot control spreadsheet type inference: import monetary/identifier columns as text when precision or literal values matter. An empty result produces only column headers and returns row count zero.

Extraction and metadata-only audit commit together in one repeatable-read transaction. The audit contains kind/date/period identifiers and row count, not names, statement references, posting reasons or receipt data. Oversize and failed audit writes roll back and return no report. Browser downloads use the existing bound cashbook request context; financial exports are not copied into browser storage.

All 505 unit tests pass. Final eight selected UI/API/internal-command/storage desktop/mobile checks passed in `svu_rebuild_it_1791588830949`, dropped, with unchanged 476-file SHA-256 `e1592cac24bc119525ba5c21c748e0e8e927f507f90e9a25c15967eff994f80e`. Browser journeys download all three reports and verify file names/content, date controls and layout. Native HTTP checks cover complete 27-posting export, inclusive dates, zero matches, account facts, unknown/duplicate filters, missing captures, draft/closed snapshot distinction, cross-period correction references and revoked authority. An internal report call injects a genuine PostgreSQL failure at its audit write, proving no returned export and unchanged audit count; this is not an HTTP fault-injection claim. Final screenshots in `data/cashbook-reports-final` were inspected.

Earlier eight-check verification passed in `svu_rebuild_it_1791588642721`, SHA-256 `8d3b0f94908cb81564915af1b87fa41020fad602d5c01767607af29252d6db7b`, before reversal enrichment and real audit-fault coverage. Both databases are independently confirmed absent. Working hidden server PID 18744/start milliseconds `1791588948162` is healthy at http://127.0.0.1:4173 with empty error log and external email disabled. No migration/reseed was needed and all seven working cashbook tables remain empty.

Next: command-side audit-write-failure/rollback evidence. Approved variance exceptions, operational retention, actual institutional policy/native-external ownership decisions and authoritative imports remain incomplete. Native reports do not complete full legacy accounting coverage or the overall goal.

## Command Failure Atomicity

`e2e/cashbook-atomicity.spec.js` now tests all 14 command scenarios against isolated PostgreSQL: policy creation/publication/retirement, book creation, both account kinds, each of the five movement kinds, period creation, capture and independent closure. Internal fixture actors are explicitly distinguished from authenticated institutional appointments.

For each command, a wrapped database client injects a genuine PostgreSQL error at the audit insert, then independently at the replay-receipt insert. Both points occur after native business writes. The receipt-stage failure occurs after the audit insert, so it also tests audit rollback. Exact whole-table retained-state comparisons cover policies, books, accounts, movements, periods, capture history, receipts and cashbook audits. No partial business fact, period revision, capture snapshot/history, closure, audit or receipt survives either failure.

After both failures the same request key/body succeeds through the unmodified module. Repeating the committed request returns the same result and leaves all retained state unchanged; exactly one actor-bound receipt exists. This also checks that a failed reversal does not consume its original and that failed capture/closure does not advance its revision. No runtime fault hooks or production configuration changes were introduced. These checks prove internal transaction guarantees, not public HTTP failure handling or provider/database-outage recovery.

All 505 unit tests pass. Final ten selected atomicity/UI/API/internal-command/storage checks passed across desktop/mobile integration projects in `svu_rebuild_it_1791589186007`, subsequently dropped, with unchanged 477-file SHA-256 `fafdab9aae88e664ada529537655840db343be557fdffa293238e28df0c381e0`. The first four atomicity/internal-command checks also passed in `svu_rebuild_it_1791589121805` on the same fingerprint. Both verification databases are independently confirmed absent. No new UI layout or screenshot claim is required for this test-only change; existing browser/download/privacy journeys remain passing in the combined run.

Working server/database health passes, error log is empty and all seven cashbook tables remain empty. No migration, reseed or restart was needed. Institutional variance exceptions, operational retention, actual policy approval/native-external ownership decisions and authoritative imports remain open. Continue the remaining legacy-capability/source audit without treating verified native cashbook behavior as full accounting parity or goal completion.
