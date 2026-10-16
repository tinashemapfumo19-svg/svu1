# Legacy identity matching

The initial read-only matching findings below have been followed by the [legacy cutover](LEGACY_CUTOVER.md). See that document for the current database state and remaining reconciliation work.

User direction, 16 October 2026: retain existing user passwords during continuity migration; match records first and implement later security measures as a separate step. Do not force password resets as part of matching.

The first matching pass is read-only against both the supplied SQL archive and the configured new PostgreSQL database. It does not activate accounts, change passwords, merge people, import records or assign permissions.

## Matching rules

- Student identity: exact legacy student number and normalized email. Repeated identifiers, conflicting candidates and shared emails require review. No fuzzy name matches or invented student numbers.
- Student credential: `student_pro.student_id` links to `students_registration.svu_reg_number`; retain the original `student_pro.key_id` credential for the eventual password compatibility import.
- Staff credential: `svu_sl.staff_id` links to `svu_staff_members.staff_id`; retain `svu_sl.authid` for the eventual compatibility import.
- Drupal credentials: retain `users.pass` separately pending identification of account owners and verification of the Drupal password scheme.
- `students_registration.auth_id` is application association/reference data, not automatically a password. `svu_student_control.authid` is session-control data, not a password.
- Programme and module candidates use exact codes. The legacy `courses` table is the programme catalogue, while `svu_course_codes` supplies module codes and programme associations.

Legacy student and staff PHP login code verifies MD5 password hashes. The new `server/security.js` verifies scrypt credentials. Matching preserves the source credentials unchanged; password continuity still needs an explicit verifier/import implementation. Hashes must not be copied into scrypt fields and treated as usable passwords. Missing passwords remain missing. Shared override passwords in PHP code are not individual users' passwords.

## First-pass findings

The target snapshot contained 191 account rows, 33 programmes and 28 courses. No legacy student/staff record matched a target account by the exact identifiers checked; no programme/module codes matched target codes. This does not prove different ownership or justify duplicates: it establishes that automatic linking is not available from these fields alone.

| Source | Outcome |
| --- | --- |
| 1,242 registration rows | 1,079 without target match and no detected repeated source email/number; 163 require source duplicate/conflict review |
| 115 staff rows | 98 without target match and no detected repeated source email; 17 require source duplicate/conflict review |
| 835 student password records | 833 link to exactly one registration row; 2 have no student-number link |
| 108 staff password records | 107 link to exactly one staff row; 1 has no staff-ID link |
| 3 Drupal user rows | 2 Drupal-shaped hashes and 1 missing password; ownership mapping pending |

Unique source links identify rows, not verified people or approved imports. All unresolved records remain in the source for reconciliation. Duplicate/conflict counts can overlap the uniquely linked credential rows.

## Reproduce

`data/legacy-target-match-snapshot.json` is a local read-only target snapshot containing account identifiers and catalogue codes, without passwords. `data/legacy-identity-match.json` contains source row locators, target candidate IDs, aggregate findings and credential format classifications, without credential values. Both are internal migration artifacts.

```powershell
python scripts/legacy-identity-match.py "C:\Users\DELL\Desktop\southval_db (1).sql" data/legacy-target-match-snapshot.json data/legacy-identity-match.json
```

The script parses selected literal INSERT statements without executing SQL. Selected table row counts were cross-checked against the existing dump recognizer's table-data-only preview. This is not a full dump validator or an importer. Refresh the target snapshot before a later matching pass or import decision.
