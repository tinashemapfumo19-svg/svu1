# Stage 8 Official Document Issuance Register

## Delivered Slice

A register of every official document issued (transcripts and award certificates), with what happened to each: current, superseded by a reissue, or revoked with its reason. It covers the roadmap's "issuance, reissue, revocation ... history" for official documents and part of `RPT-08`. It is read-only and adds no migration: it reports from the immutable `transcripts` records.

## Behaviour

- **Columns.** Each row shows the reference number (or the verification code for documents issued before reference numbers existed), the kind, the status, and the student number and name. It also shows the programme, when and by whom the document was issued, the superseded or revoked date, the revocation reason, and the template version.
- **Filters.** Kind, status, an issue date range (real dates; the end may not precede the start), and a search of 100 characters or fewer over reference, student number, or name. Wildcard characters are matched literally. Results are newest first, up to 2000 rows.
- **Scope.** Rows are limited to programmes and intakes covered by the reader's `registry.transcript.issue` or `results.view` role, so the register never shows students outside their scope. Students have no access.
- **Totals.** Counts by status and kind for the filtered rows.
- **Export.** CSV of the filtered rows, with values containing commas or quotes properly quoted. The export always uses the filters the list was loaded with.

## API

`GET /api/reports/document-issuance?kind=&status=&from=&to=&q=&format=` needs `registry.transcript.issue` or `results.view`. It returns `{filters, totals, rows}`, or `{fileName, csv, rows}` with `format=csv`.

## Interface

The registry has an **Issued documents** panel with the filters, totals, the register table, and **Download CSV**.

## Verification

Unit tests in `test/document-issuance.test.js` cover filter validation and CSV quoting. The transcript journey (`e2e/transcripts.spec.js`, desktop and mobile) covers:
- the register showing the revoked and superseded transcripts with the revocation reason;
- an examinations officer's scoped status filter;
- the student and an invalid date refused;
- UI filtering and totals;
- the CSV export containing exactly the filtered rows.

## Remaining Work

- Access history (views, prints, and public verification lookups) once lookup logging and edge rate limiting are decided with hosting (D-03).
- Further official document kinds (letters, statements, receipts) will appear automatically once they are issued through the same records.
