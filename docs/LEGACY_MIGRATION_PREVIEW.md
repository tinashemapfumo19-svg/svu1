# Legacy Migration Preview

Read-only source validation, 2026-10-09. Neither archive was executed, repaired or imported. The older archive is historical evidence, not an approved replacement for the primary archive or a current production backup.

## Command

```powershell
npm run legacy:preview -- "_legacy_php_system/southval_db -old.sql"
npm run legacy:preview -- "_legacy_php_system/southval_db2.sql"
```

The command accepts one regular file, at most 128 MiB. It has no apply option, database connection or output-file replacement. JSON output contains table/column names, base types, primary-key columns, inserted row counts and the original byte fingerprint, not record values. Treat even schema metadata as internal migration material.

The recognizer accepts literal phpMyAdmin CREATE TABLE / INSERT VALUES dumps and settings, not arbitrary MySQL SQL. Unsupported SQL, quoting modes, malformed rows, undefined columns, binary corruption and truncation fail closed with a location-only error. It does not evaluate SQL expressions. A reported row count counts archived insert tuples, not distinct business entities or successful database insertions; duplicate keys and relationships still need validation.

## Verified Archives

| Source | Original Bytes | SHA-256 | Result |
| --- | --- | --- | --- |
| `southval_db -old.sql` | 1,217,929 | `dd5f04aa5fd2dd12f0db91c621b974bbe5d3a728ee29fca4e9ab1b0012ae3572` | Readable: 65 tables, 505 columns, 6,439 inserted rows, 75 insert statements |
| `southval_db2.sql` | 10,508,842 | `4c1151c68d98693e70aff65f437aaffea767e695fa8a1ff8ca62e642a47bc20c` | Refused at line 873, zero-based byte offset 229379: a non-hex control byte follows a hex literal in cache data |

The primary archive must not be counted as a reconciled data source. Its apparent schema inventory does not prove its rows are importable. Request an authoritative clean export and compare its manifest; do not silently discard cache rows, patch bytes or substitute the older archive. The cause and extent of the damaged data are not established by this check.

## Learning / Student Mapping Review

These counts refer exclusively to the historical readable archive. Candidate targets describe design review, not approved mappings or applied imports.

| Source Table | Inserted Rows | Candidate Target / Required Review |
| --- | --- | --- |
| `students_registration` | 65 | Student/programme identities; resolve duplicate identities, programme/intake codes and effective dates; exclude restricted fields from ordinary projections |
| `students_auto` | 91 | Registration-number/application linkage; reconcile with the 65 registration rows rather than assume one-to-one equality |
| `student_applications` | 79 | Existing admissions migration contract, subject to source status, identity and document mappings |
| `student_applications_documents` | 256 | Resolve applicant/document linkage and verify actual attachment bytes, types and checksums |
| `svu_course_codes` | 66 | Course/curriculum version, programme, level and semester mappings |
| `svu_subject_allocation` | 48 | Effective teaching allocations; legacy active flags do not establish current approval or scope |
| `svu_assignments` | 21 | `course_resources` assignment definitions; resolve offering, creator, due-date timezone, filename and publication state |
| `svu_tutorials` | 87 | `course_resources` teaching resources; verify file existence/checksum and review publication, not inferred notification delivery |
| `svu_student_assignment` | 190 | `course_assignment_uploads` / `course_assignment_reviews`; resolve student, resource, registration, attempts, dates and returned-file visibility; do not synthesize missing attempts or bytes |
| `svu_recorded_assignments` | 76 | Academic assessment evidence, separate from immutable submission/review history; validate mark scale, contribution, grade policy and explicit release |
| `svu_student_exam` | 0 | No examination-result rows in this archive; absence is not proof no results existed in production |
| `student_medical_aid` | 46 | Restricted encrypted records only after approved policy/mapping; legacy possession does not establish new purpose-bound consent |
| `svu_student_nxtkin` | 35 | Contact relationship review only; no automatic recipient role, sharing consent or guardian entitlement |

Reusable passwords, reset codes, legacy access levels and session material are outside any automatic migration. Attachment paths are untrusted metadata, not permission to read arbitrary local files. Drupal/CMS content needs separate ownership, sanitization and publication review. Dynamic PHP-created tables and external systems may be absent from both archives.

## Remaining Gates

Obtain the authoritative clean source and attachment manifest; approve identity/programme/course/period mappings; validate relationship and duplicate-key control totals; preview target-specific exports; implement audited idempotent import with independent authorization and post-import reconciliation. No learning/student import, policy approval, production migration or CMS publication is claimed by this preview.
