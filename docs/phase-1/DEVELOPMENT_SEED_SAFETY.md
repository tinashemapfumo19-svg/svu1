# Development Seed Safety

Demo data contains known sample passwords and is not a deployment bootstrap or production dataset. The PostgreSQL seeder truncates foundation/application dependencies with CASCADE; JSON seeding replaces a whole file. Never use these commands to update an existing operational environment. Use migrations and governed reference loading instead.

## Explicit Commands

Only for a deliberately disposable local development database:

```powershell
$env:SVU_ENV='development'
npm.cmd run seed -- --reset-database svu_rebuild
```

`--reset-database` must match the configured URL's database name exactly. The acknowledgement is a one-shot CLI argument, not a persistent environment setting. It is required even for the first demo seed. Missing, wrong, repeated or extra arguments fail before opening a pool. The connected database is checked again before TRUNCATE. System databases, non-loopback PostgreSQL hosts and URL parameter/fragment overrides are refused. Invalid connection URLs produce a credential-free error.

For a deliberately disposable JSON file, configured inside this workspace's `data` directory:

```powershell
$env:SVU_ENV='development'
npm.cmd run seed:json -- --reset-file data/dev-store.json
```

`--reset-file` must resolve to the configured `SVU_DATA_FILE` (default `data/dev-store.json`). Outside-data paths, traversal, non-JSON filenames, device names, alternate streams, symlinks/junctions, hard links and non-regular targets are refused. Replacement is prepared in an exclusively created sibling file with restrictive permissions, then renamed atomically; owned temporary files are removed. No other seed file is implicitly reset. These are trusted-workspace operator controls, not protection against a malicious privileged process changing filesystem ancestors concurrently.

Both commands require explicit development mode (`SVU_ENV=development`, or `NODE_ENV=development` when SVU_ENV is absent). Production, staging, unknown modes and a conflicting non-development NODE_ENV are refused; explicitly development SVU_ENV with NODE_ENV=test is supported for test fixtures. No key or reset argument bypasses that environment guard. These flags do not independently prove that an operator labelled a database correctly: production least privilege, credentials and deployment controls remain essential.

## Isolated Verification

`scripts/integration.js` creates its own new database and passes an acknowledgement bound only to that generated name. It does not acknowledge or reseed the configured working database. Normal isolated migration/seed/test/smoke/teardown behaviour is retained.

```powershell
$env:SVU_ENV='development'
node scripts/verify-development-seed.js
```

This native control probe creates a unique owned `svu_restore_seed_` database, applies migrations, performs the acknowledged first seed and installs a synthetic sentinel. Missing/wrong acknowledgement, production and conflicting production mode must all fail without changing the actual sentinel row. An acknowledged reset must restore the demo bootstrap. Only the owned database is removed, and removal is queried afterward. No source/working database row is written. This is not an invitation to test destructive reset against real data.

Six focused tests cover environment conflicts, exact/local/credential-safe database parsing, exact/file path validation, real hard-link refusal, native pre-connect refusals, actual atomic JSON replacement, junction refusal/destination preservation and temporary-file cleanup.

Final native `data/build-seed-safety-native-accepted.log` passes all controls (launcher 8703 exit 0), target `svu_restore_seed_bf64bd55be11456089fc0a3f8c5c53a2` independently absent after cleanup. Earlier native launcher 68171 also passed and its target is independently absent. Selected integration PASSES as launcher 81088 exit 0 in `data/build-seed-safety-integration.log`: all twelve independently listed admissions/MFA checks, all units and 22 smokes, migrations/seed/server/source guard/teardown. Before/after 359-file digest is unchanged `d51600b35b99f939620d2cc4c4b3f7718ecf77ab327163122cce81d78e0e7c66`, changed paths empty. Database `svu_rebuild_it_1791251170500` is independently absent, 4197 has no listener and last-run metadata is passed/no failures. Final standalone all-unit verification passes 389/389, no skips (`data/build-seed-safety-units-accepted.log`, launcher 91810 exit 0). All finite jobs are terminal; generated JSON test directories are absent. No current-source full-suite acceptance is inferred; the prior complete 152-check checkpoint remains pinned to its original source.

Working accounts/applications/programmes remain 188/114/28, registrations/enrolments zero, development server PID 3276 remains healthy/no-store on 4177 and its error log is empty. Neither the working database nor its demo JSON store was reset.

## Remaining Gates

Production bootstrap/identity provider choice and privileged MFA/key/secret custody still require approved deployment procedures. Demo seeders are deliberately unavailable outside development. Hosted CI execution, actual owner-run pilot, target-environment restore/rollback and institutional sign-off remain open. The working development database is not reseeded by this safety work.
