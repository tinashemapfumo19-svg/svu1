# Admissions Migration and Reconciliation

The tooling imports mapped open and historical admissions records. It does not read production databases or change legacy records. `SAMPLE_ADMISSIONS_EXPORT.json` is a non-production fixture with placeholder account and intake mappings. The browser suite builds a separate sample export using real temporary mappings and verifies open applications, historical decisions, documents, communication history, and accepted-student conversion.

## Source Mapping

Prepare an approved JSON export with a stable `source` identifier and original `legacyId` values. Map applicants to existing activated account IDs and programme/intake/vacancy records to the governed master-data APIs before importing applications. Each mapped intake needs a programme version effective on its entry date. Record original application references and map historical rejection reasons to the controlled decision-reason list.

`totals` must independently declare `applications`, `documents`, and `documentBytes`. Each document carries its original legacy ID, document type, filename, content type, base64 bytes, and SHA-256 checksum. Do not omit documents to make totals balance. Split exports into batches of at most 200 applications, using distinct stable source identifiers per batch. Historical offer states require a matching `decision` object with `decision: "offer"`, `offerExpiresAt`, and optional `conditions`; rejected records require `decision: "reject"` and `reasonCode`.

## Commands

```powershell
npm.cmd run admissions:migrate -- docs/stage-2/SAMPLE_ADMISSIONS_EXPORT.json
npm.cmd run admissions:migrate -- approved-mapped-export.json --apply
```

The default command validates totals, duplicate IDs, file signatures, checksums, and basic structure without making changes. Applying requires `SVU_ADMISSIONS_MIGRATION_TOKEN`, a session with `admissions.migrate`, and `SVU_BASE_URL`. Account/intake mappings are validated against the target database when applying.

## Controls

- Database changes are atomic; imported storage files are removed if the transaction fails.
- Replaying the same source and export checksum returns the original batch. Reusing a legacy ID in a changed export is refused for explicit reconciliation.
- Imported files are private and remain `uploaded` with a pending scan. Legacy clean/verified labels are not trusted.
- Imported accepted records convert exactly once through the normal conversion service. Intake capacity still applies.
- `GET /api/admissions/migrations/{batchId}` rereads target records and stored file bytes, verifies checksums, and compares actual application/document/byte totals to source totals.
- The CLI runs that reconciliation after applying and fails if any mismatch exists.
- Failed totals and unauthorized requests are rejected before import. Import actions and workflow histories are audited.

## Production Gate

Sample reconciliation verifies the tooling, not the production migration gate. The owner must approve the source export, mappings, source control totals, discrepancy resolutions, and post-import scanner results. An owner-run intake pilot and deployment/provider decisions remain necessary before legacy admissions writes are retired.
