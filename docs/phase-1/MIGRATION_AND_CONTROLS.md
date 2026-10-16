# Phase 1 Migration and Controls

## Migration Principles

- Migrate data by stage, not as one final import.
- Preserve source identifiers for reconciliation and audit.
- Never silently discard unresolved records.
- Use staging tables or equivalent import areas before canonical records.
- Every transformation must be reproducible and documented.

## Phase 1 Source Areas

| Target Area | Legacy Evidence | Control Needed |
| --- | --- | --- |
| Identity | `svu_sl`, `svu_sla`, student login/session fields, staff login helpers | Count accounts by persona/status; identify duplicate emails/usernames. |
| Staff/person records | `svu_staff_members`, staff registration helpers | Count active staff, departments, lecturers, and categories. |
| Applicants/students as persons | `student_applications`, `students_registration`, `students_auto` | Identify duplicate national IDs/emails/phones before unifying identities. |
| Faculties/departments/programmes | `faculties`, `courses`, `svu_departments`, `svu_department_programmes` | Reconcile programme ownership and active/inactive status. |
| Intakes/periods | `vacancies`, `academic_term`, `term_setup` | Compare intake, vacancy, and term dates; identify conflicting current-period logic. |
| Reference data | `country`, `academic_level`, `religion_list`, `disabilities_list`, `svu_currency` | Normalize labels, duplicates, and inactive values. |

## Reconciliation Outputs

Phase 1 trial migrations should produce:

- account counts by user type, active state, and access level;
- role-assignment mapping from legacy access levels to new roles;
- person duplicate report by email, national ID, phone, and name/date-of-birth similarity;
- organization hierarchy report;
- programme/intake availability report;
- academic-period overlap and gap report;
- reference-data duplicate and orphan report;
- rejected-row report with reason and owner.

## Security Controls

- Legacy diagnostics, SQL dumps, upload folders, test mailers, and bundled chat remain inside `_legacy_php_system/`.
- No legacy file should be exposed as part of the modern rebuild artifact.
- Exposed credentials from legacy source must be treated as compromised and rotated before any connected environment exists.
- Suspicious legacy includes remain investigation-only and must not execute in the rebuild.

## Audit Controls

Every Phase 1 mutation must produce an audit event for:

- account invitation, activation, suspension, recovery, and login state changes;
- role assignment, role revocation, permission changes, and scope changes;
- master-data create, update, publish, retire, or restore;
- workflow state transition;
- document upload, review, view, download, and lifecycle change;
- notification template update, audience preview, send, failure, and retry;
- export request and completion.

## Cutover Rule

Phase 1 does not retire legacy business modules. It creates the platform needed for a controlled admissions pilot. Legacy writes can only be retired by domain after reconciliation and business-owner sign-off.
