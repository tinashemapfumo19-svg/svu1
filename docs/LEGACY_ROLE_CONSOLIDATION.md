# Consolidated legacy access profiles

On 16 October 2026 the user requested consolidation of the 38 separate role logins to match the legacy system. The supplied `svu_sla` table defines six staff levels: 1 User, 2 Reports Access Only, 3 Supervisor, 4 Management, 8 Super user and 9 Sysadmin. Student and Applicant remain separate portal identities, giving eight selectable roles and eight active role accounts.

The current login list is [ROLE_LOGINS.md](ROLE_LOGINS.md). Thirty-four superseded specialist role accounts were suspended and their sessions revoked. Existing individual usernames, passwords, statuses and the previously requested master grants on imported accounts were retained. Jerry remains a full master login.

## New-system permission mapping

The legacy labels and level numbers are exact source values. The source does not define permissions for every new-system feature. These profiles group the existing permission bundles rather than claim to reconstruct undocumented PHP entitlements:

- **User:** normal teaching and assigned exam-duty access.
- **Reports Access Only:** the thirteen registered permissions ending in `.view`; no create, update, publish or approval permissions.
- **Supervisor:** operational admissions, finance, examinations, HR, support, records, asset, fleet, cashbook and room officer bundles.
- **Management:** academic/registrar, admissions-manager, support-manager and independent approval bundles.
- **Super user:** the combined business-operation profiles, privacy-policy administration and report scheduling.
- **Sysadmin:** all 129 current permissions.

Student and Applicant keep their existing self-service permissions. Record ownership, allocations, consent and independent-review requirements continue to determine which records/actions are available.

Migration 119 records profile membership and provides a refresh function. Migration runs refresh the consolidated permission sets after all SQL migrations. Internal specialist roles remain for permission maintenance and historical grants, but are excluded from selectable roles and new role invitations/assignments. Staff invitation choices use the five non-Sysadmin staff levels; Sysadmin is assigned through access management.

All eight role logins and their exact permission sets were verified. The Reports profile was checked for write-permission absence; retired specialist login rejection and Jerry's full permission coverage were checked. The staff, authentication and foundation tests passed (41 tests). Local evidence is `data/legacy-cutover/legacy-role-consolidation-verification.json`.
