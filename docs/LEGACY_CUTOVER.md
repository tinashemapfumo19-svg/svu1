# Legacy database cutover — 16 October 2026

The configured `svu_rebuild` PostgreSQL database now uses the supplied `southval_db (1).sql` as its operational data source. Demo operational rows were removed atomically. The modern schema, migration ledger and required role/permission/workflow/template configuration were retained. No legacy SQL statements were executed.

Source SHA-256: `0a2434e24fdf606bcbbcab8cdd12faa29eb4d256d1553016269639d4289a2acd`.

## Loaded into native tables

| Records | Count |
| --- | ---: |
| People / accounts | 1,655 |
| Student identities | 851 |
| Student programme records | 849 |
| Staff employment records | 115 |
| Programmes | 48 |
| Module catalogue records | 182 |
| Intake records | 77 |
| Historical application / registration context records | 1,515 |
| Original password hashes | 945 |
| Legacy sysadmin assignments | 6 |

All account rows have source provenance; none of the former seeded accounts remains. Shared or invalid emails were not converted into invented unique mailboxes or forced person merges. Individual existing student numbers and staff usernames are supported as login identifiers. Native scrypt, imported MD5 and the two Drupal-format password hashes are supported. No source passwords were reset. Sessions, reset links and PHP password overrides were not carried into the login implementation.

## Complete source retention

All 94,988 inserted rows across 78 source tables were retained in `legacy_source_rows`, including records that could not be safely projected into operational tables. Each row is encrypted and checksum-verified. The exact original SQL bytes are also retained in encrypted form in `legacy_imports`; their recovered checksum matches the supplied file. The final legacy view definition was retained as part of the original bytes rather than executed against PostgreSQL.

The local archive key is `data/legacy-cutover/archive-key.bin`. Keep it with the migration recovery materials; it is required to read the encrypted source. The archive has no public application route. Original SQL and row values, including passwords and restricted medical information, are not copied into public documentation or matching reports.

## Records needing reconciliation

- 393 registration rows have no student number. Their applicant identities and source records remain; no student number was fabricated.
- Two student logins have no registration row. They retain their student number and password as standalone identities; programme linkage remains unresolved.
- One staff login has no employment row. Its login is retained separately.
- Seventeen source applications have no programme mapping and remain in the source archive. The native application count also includes registration contexts needed where a numbered student has no usable application context.
- Source applicant/registration statuses remain in `legacy_source_status`; historical workflows do not invent native decision approvals. Student programme records begin pending native onboarding. The registry detail shows the previous-system status.
- Programme versions, modules and intakes are drafts. Module credits/effective dates and unrecorded intake capacities remain null; an explicit unassigned department holds records whose faculty/department association was absent from the source. No curriculum, prerequisite or academic-policy approval was invented.
- Finance invoices/payments, assessment/results/progression/award records, teaching/submission/resource metadata, historical notifications/audits and restricted profile history remain in the encrypted source pending their target-specific reconciliation. The native finance ledger is empty after removal of demo entries; no financial clearance or calculated opening balance is implied.
- The SQL does not supply the referenced attachment bytes. Document/resource availability requires the original files and verified linkage.

## Verification and recovery

The pre-change database backup is `data/legacy-cutover/before-legacy-20261016.dump` (1,549,913 bytes). A separate full restore rehearsal verified all 302 relations and 9,664 rows before replacement.

The import was rehearsed in an owned disposable database before application. Checks verified archive counts and every recovered row checksum, exact retention of all 945 password hashes, absence of non-source accounts, repository reads for registry/catalogue/historical admissions, legacy login/session creation, wrong-password rejection and ambiguous-identifier rejection. The focused foundation/authentication suite passed 42 tests. Current-database totals and registry reads passed after commit, and the local server was restarted.

Local evidence:

- `data/legacy-cutover/result-svu_rebuild.json`: native counts and source-row reconciliation issues.
- `data/legacy-cutover/post-cutover-verification.json`: current-database checks.
- `data/legacy-cutover/verification.json`: isolated login and source-password checks.

Use migrations and targeted reconciliation imports for further work. Do not run the destructive development demo seed against this database.

## Explicit master-login update

On the user's subsequent instruction, the `Jerry` login alias was linked to Jerry Mapfumo's imported staff account, retaining its `mapfumo` alias. The explicitly supplied password was configured without placing it in documentation or source files. This account has global system-administrator and master-administrator assignments covering all 129 registered permissions. Migration 117 maintains the master role's coverage as new permissions are added. The other imported accounts' grants were not expanded.

HTTP sign-in, authenticated identity and eleven administrative endpoint checks passed. Future permission coverage was verified inside a rolled-back transaction. Account-specific evidence is in `data/legacy-cutover/jerry-master-access.json` and the database audit trail. Original source credentials remain in the encrypted source archive.

## Subsequent all-account master-access instruction

The user explicitly clarified that master access should apply to every existing account, including students and applicants. All 1,655 existing accounts now hold globally scoped system-administrator and master-administrator assignments. All 129 current permissions were verified across the full account population. This supersedes the earlier restriction of the expanded grants to Jerry alone.

No usernames, password hashes or account statuses changed during this rollout. There are 710 accounts without a stored password; granting permissions does not create their missing sign-in credentials. Newly created accounts are not automatically assigned master roles. Evidence is in `data/legacy-cutover/all-accounts-master-access.json` and the database audit trail.
