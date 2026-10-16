# Role logins

The legacy model has six staff access levels, plus Student and Applicant. One separate account per selectable role is restricted to that role permissions. Use the password supplied in the conversation. Passwords are stored as salted scrypt hashes, not in this list.

These accounts have no invented student enrolments, employment records, teaching allocations, shared-record invitations or consent. Self-service screens show records only after the relevant account is linked through the appropriate workflow.

| Legacy level | Role | Username | Permissions |
| ---: | --- | --- | ---: |
| 9 | Sysadmin | `role.sysadmin` | 129 |
| 8 | Super user | `role.superuser` | 112 |
| 4 | Management | `role.management` | 77 |
| 3 | Supervisor | `role.supervisor` | 62 |
| 2 | Reports Access Only | `role.reports` | 13 |
| 1 | User | `role.user` | 7 |
| — | Applicant | `role.applicant` | 6 |
| — | Student | `role.student` | 7 |

The staff names and level numbers are taken from svu_sla. New-system permissions are mapped from the existing specialist permission bundles; they are not claimed to be an exact reconstruction of every historical PHP authorization check. The 34 superseded specialist role accounts are suspended. Specialist roles remain internally for permission maintenance and history, while account administration offers only the eight consolidated profiles.

Jerry retains full master access. The earlier master grants on existing imported accounts were not changed by creating these separate role accounts.
