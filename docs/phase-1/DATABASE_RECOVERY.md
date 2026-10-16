# Development Database Recovery

This implements the guide's repeatable local database restoration exercise. It is not production disaster recovery, a retained/off-site backup service, document-byte recovery or deployment rollback. Hosting, recovery objectives, key custody, object storage, retention and owner acceptance remain open.

## Run

```powershell
npm.cmd run backup:rehearse
```

The script requires development mode, the configured PostgreSQL connection and local Docker access. The default container is `svu-postgres`; `SVU_POSTGRES_CONTAINER` and `SVU_DATABASE_USER` select its tools. It verifies that the configured connection and Docker tools address the same PostgreSQL system identifier before restoring anything. Source database names are validated. An optional `SVU_DATABASE_NAME` must equal the configured database; it cannot silently redirect the source.

The target defaults to a random `svu_restore_` name. `SVU_RESTORE_DATABASE_NAME`, when supplied, must use that prefix and a safe PostgreSQL identifier, must differ from the source and must not already exist. CREATE is deliberately not preceded by DROP or `IF NOT EXISTS`. Only a target successfully created by this invocation can be removed. Existing named targets, the source database and system databases are never replaced.

## Verification

An exported repeatable-read, read-only source snapshot is shared with `pg_dump`. The custom archive and schema dump stay in process memory; no private SQL dump/archive is written to the workspace or evidence. Tool output has an explicit 256 MiB development limit and fails rather than truncating. Restore uses `pg_restore --exit-on-error --single-transaction` into the new empty target, without `--clean` or `--create`.

Every non-system application table, partition/materialized view and sequence is enumerated. Row JSON is sorted under C collation and fed to SHA-256 with length boundaries using 500-row cursor batches. `ONLY` avoids counting inherited/partition rows twice. Counts and content digests detect altered values even when row counts match, as well as missing/extra/empty relations. Sequence comparison preserves `last_value` and `is_called`, not internal WAL `log_cnt`. Sequence state is not MVCC: concurrent sequence-consuming writes can cause a safe mismatch, so use an operationally quiet local source. Foreign tables and large objects are refused until their content/provider recovery is separately supported.

Schema comparison retains pg_dump definitions for non-table objects. Table definitions use PostgreSQL's structured catalog: ordered columns/types/defaults/nullability/identity/generated/storage/statistics/collations, owner, persistence, partition/inheritance, row-security/options and named validated CHECK definitions. PostgreSQL's deparser preserves constraint operators/precedence while normalizing harmless nested AND grouping that can change on restore. This does not remove constraints or rewrite SQL expressions. Indexes, foreign/unique keys, triggers, functions, grants and other dump objects remain compared. Random psql restriction tokens are excluded from the schema digest.

The target connection closes before owned-database cleanup. Successful evidence additionally queries `pg_database` to confirm removal. Failures remain failures, including cleanup failures; no automatic source repair or mutation retry occurs. Evidence contains aggregate counts, digests, status and object/field names, not row values, credentials, connection URLs, archive bytes or tool stderr.

## Current Evidence

On 2026-10-06, final `data/build-database-recovery-accepted.log` PASSED (launcher 20898 exit 0), matching schema and all 193 relations / 8,045 retained rows, including sequence-state rows and partition-key definitions. These are local development records, not production control totals or unique people. Target `svu_restore_f3ab0f008bb54bd7b93f96822f319882` was independently confirmed absent after cleanup. The earlier seven owned diagnostic/successful targets are independently absent too. Diagnostic failures remain in their original logs, not relabelled as passed. The first mismatch was three examination CHECK constraints' nested AND grouping; PostgreSQL-deparsed definitions match without changing the stored rules.

Nine focused tests cover target refusal/uniqueness, create-only ownership and success/failure cleanup, restriction-token normalization, column/constraint/non-table definition changes, row/empty-relation changes, cursor bounds/escaping/failure closure, unsupported sources, sequence bookkeeping and table/partition-definition coverage. The complete final unit suite passes 383/383, no failures/skips (`data/build-recovery-tooling-final-units.log`, launcher 56232 exit 0). Earlier unit launcher 18332 and restore launcher 33778 also passed before the final partition-key assertion.

Latest generated evidence is `BACKUP_RESTORE_EVIDENCE.generated.json`. Historical October 1 foundation evidence is preserved in `BACKUP_RESTORE_EVIDENCE.2026-10-01.json`. The development database was not reseeded: accounts/applications/programmes remain 188/114/28 and registrations/enrolments remain zero. Development server PID 3276 remains healthy on 4177; error log is empty. No current full-suite or production acceptance is inferred from this database exercise.

## Remaining Recovery Gates

- Approved RPO/RTO, backup schedule, retention, encryption/off-site custody and monitoring.
- Complete document/object-storage bytes and metadata reconciliation, scanner state and legal holds.
- Encryption/signing keys, configuration, global database roles and grants, provider/job state and secrets recovery on a different host/cluster.
- Production-like volumes, restore duration/capacity, incident exercises and independent owner review.
- Hosted deployment and application/schema rollback or roll-forward rehearsal; this command is not a rollback implementation.

PostgreSQL semantics are documented in [pg_dump snapshot options](https://www.postgresql.org/docs/16/app-pgdump.html), [pg_restore error/transaction options](https://www.postgresql.org/docs/16/app-pgrestore.html) and [catalog deparser functions](https://www.postgresql.org/docs/16/functions-info.html).
