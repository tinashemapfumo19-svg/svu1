# Stage 5 Staff Records

## Delivered Slice

This is the first Stage 5 development-pilot slice: staff employment records separated from the person and login account, effective-dated department, category, grade and supervisor periods, and status history whose effects on access are applied automatically. Teaching allocation (`STF-07` to `STF-09`) is the next slice. `STF-10` (leave, transfer, promotion workflows, and personnel history) waits on the decision whether to integrate a dedicated HR system.

| Inventory | Coverage |
| --- | --- |
| STF-01 | A staff record holds the employment relationship. The person and account are created when the invited staff member activates, and the record links to the account at that moment. |
| STF-02 | Employee number (supplied, or generated as `E` plus 6 digits, and unique), engagement date, category, grade, and exit date. |
| STF-03, STF-04 | Department and supervisor are held on effective-dated employment periods. A change closes the current period the day before the new one starts; history is never overwritten. Reporting loops, including indirect ones, are refused. |
| STF-05 | Employment category is the governed `staff_category` reference list. It does not grant permissions; access comes from roles. |
| STF-06 | Search by name, number, or email; filter by status and department. Status moves `invited` to `active`, `active` to `suspended` or `exited`, and `suspended` to `active` or `exited`. Each change is recorded in append-only history with an effective date, reason, and actor. |

## Behaviour

- **Creating a record.** Creating a staff record (`staff.manage`, institution-wide) creates an invitation for one role and an optional programme or intake scope. It then queues a sensitive `staff.invitation` email with the activation code. Self-service and critical roles (student, applicant, auditor, system administrator) cannot be granted this way; they go through access management.
- **Duplicates.** An email already used by an account or a staff record is refused (`409`), so existing people are not duplicated. Linking an existing account to a staff record is future work.
- **Activation.** Activation grants the invited role, links the staff record, and records the `invited` to `active` change.
- **Access follows employment:**
  - suspension locks the account and revokes live sessions;
  - reinstatement unlocks it;
  - exit locks the account, revokes sessions, ends every role assignment on the exit date, and closes the current employment period;
  - exiting someone who has not yet activated withdraws the invitation, so the activation code stops working.
- **Exited records.** These are closed to further employment or status changes. A supervisor who exits is flagged on their reports' records ("exited: reassign").
- **Concurrency.** Changes carry the record's revision; a stale revision returns `409`. Status changes take effect today or earlier, and an exit cannot precede the current employment period.
- **Permissions.** `hr_officer` and `system_administrator` hold `staff.manage` and `staff.view`. `academic_registrar` and `academic_approver` hold `staff.view` for allocation planning. A new `lecturer` role is available for invitations; its permissions will come from teaching allocations in the next slice.

## Existing Accounts

A person who already has an account (for example, a student who becomes a graduate teaching assistant) is never given a second account.

- **Creating the record.** Creating a staff record for an email that already has an account is refused (`409`) unless HR sets `linkExistingAccount: true`. Linking also requires that the account exists and is active, and `linkExistingAccount` with an unknown email returns `400`.
- **The offer.** A linked record starts as `invited`, with the invitation `pending_acceptance` and no activation token. The account holder receives a `staff.appointment` notification. Nothing changes on their account at this point.
- **Accepting.** The holder signs in as usual (password and MFA) and sees the offer under **Staff appointment** in the portal (`GET /api/identity/staff-appointments`), matched to their own account email. `POST /api/identity/staff-appointments/{invitationId}` with `accept: true` then:
  - grants the invited role;
  - adds the `staff` persona;
  - links the staff record to the account, making it `active` with history.

  Signing in again shows the new access. Offers for other accounts return `404`, and a second answer returns `409`.
- **Declining.** `accept: false` marks the invitation `declined` and leaves the account untouched. HR sees the outcome on the record and can close it by exiting.
- **Audit and HR view.** Both outcomes are audited. HR's staff detail shows the invitation state: waiting for activation, waiting for acceptance, declined, or withdrawn.

The journey is in `e2e/staff-account-links.spec.js`.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/staff?q=&status=&departmentId=&limit=&offset=` | `staff.view` | Staff list with current employment and capabilities. |
| `POST /api/staff` | `staff.manage` (global) | `email`, `legalName`, `preferredName`, optional `employeeNumber`, `engagedOn`, `roleCode`, optional `scope`, `departmentId`, `category`, `grade`, optional `supervisorStaffId`, `reason`. |
| `GET /api/staff/{id}` | `staff.view` | Record with employment periods, status history, and role assignments. |
| `POST /api/staff/{id}/employment` | `staff.manage` (global) | `revision`, `departmentId`, `category`, `grade`, optional `supervisorStaffId`, `effectiveFrom`, `reason`. |
| `POST /api/staff/{id}/status` | `staff.manage` (global) | `revision`, `toStatus`, `effectiveOn`, `reason`. |

## Interface

`#registry` has a collapsible **Staff records** panel for people with `staff.view`. It offers search and filters, an add-and-invite form, details with employment and status history and roles, and forms to change employment and status.

## Verification

Migration `041_staff_records.sql`. Unit tests are in `test/staff.test.js`. The desktop and mobile browser journey is in `e2e/staff-records.spec.js`. It covers:

- HR-officer and UI creation, with duplicate-email, critical-role, and registrar denials;
- activation linking the account and granting the role;
- a same-day employment change refused, then a UI promotion with supervisor and correct period history;
- an indirect reporting loop refused;
- UI suspension revoking sessions and blocking sign-in, then reinstatement;
- exiting an un-activated supervisor, which invalidates their activation code;
- lecturer exit ending roles and the employment period, with closed records refusing changes;
- audit trail and no horizontal overflow.

## Production Gates

- HR owner approval of categories, grades, the employee-number format, and the migration of active staff with departments and supervisors.
- A decision on a dedicated HR system (`STF-10`) and on the source of truth for employment data.
