# Phase 1 Sign-off Pack

Generated 2026-10-01T09:35:46.216Z by `npm run signoff:pack`. Do not edit by hand; re-run the command to refresh the evidence.

## Summary

- Isolated integration run: **passed** (fresh database `svu_rebuild_it_1790847346344`, database dropped).
- Smoke scripts in that run: 17 passed, 0 failed.
- Phase 1 demo evidence: passed at 2026-10-01T09:36:11.300Z.
- Backup/restore rehearsal: passed at 2026-10-01T09:35:06.027Z.
- Schema: 19 migrations, all applied from empty in the integration run.

## Stage 1 Exit Gates

### Passed: A user can be invited, authenticated, authorized, suspended, and audited securely.

Evidence: `demo:phase1` passed, `smoke:identity` passed, `smoke:identity-hardening` passed, `smoke:sessions` passed, `smoke:mfa` passed, `smoke:authz` passed, `smoke:audit` passed.

- Tokens are stored as SHA-256 digests; passwords use scrypt; TOTP seeds are AES-256-GCM encrypted.
- Login throttling, password recovery, TOTP MFA with recovery codes, and admin MFA reset are covered.
- The `privileged` MFA policy (the production default) was checked manually, not in CI, because the shared smoke admin signs in without MFA.

### Passed: Master data changes are effective-dated and protected by permission.

Evidence: `smoke:master-data` passed, `smoke:master-data-lifecycle` passed, `smoke:academic-calendar` passed, `smoke:reference-data` passed, `smoke:curriculum` passed, `smoke:grading` passed.

- Organisation units, programme versions, curricula, academic periods, reference values, grading schemes, and GPA rule sets are effective-dated, audited with before/after snapshots, and need `master_data.publish`.
- Maker-checker: the drafter cannot publish programme versions, grading schemes, or GPA rule sets.
- Seeded grading bands and GPA rules are placeholders pending Academic Board approval.

### Passed: Workflows, documents, and notifications are reusable by business modules.

Evidence: `smoke:workflow` passed, `smoke:tasks` passed, `smoke:documents` passed, `smoke:service-reads` passed.

- Workflows are versioned definitions with guarded transitions, decision authority, and terminal states.
- Documents go through signed upload, size, checksum, and file-signature checks, scan, review, and audited signed download.
- Malware scanning is recorded through an API; no scanner engine is integrated yet. Notifications queue but are not delivered (ADR-005).

### Passed: Environments and schema can be recreated from version-controlled automation.

- `npm run test:integration` builds a throwaway database from migrations, seeds it, and runs every smoke script.
- CI workflow exists (`.github/workflows/ci.yml`) but has not run on a hosted runner because this workspace is not yet a git repository.
- Staging and production environments do not exist yet (ADR-007 hosting is open).

### Partial: Backup restoration and deployment rollback have been demonstrated.

**Partial:** Backup restore is rehearsed; deployment rollback cannot be shown until a deployment target exists (ADR-007).

- `npm run backup:rehearse` dumps, restores into a separate database, and verifies foundation counts.

## Decisions Still Needed

| ID | Decision | Status | Owner | Blocks |
| --- | --- | --- | --- | --- |
| ADR-001 | Application architecture | Proposed | IT/Product | Backend scaffold, deployment, testing |
| ADR-003 | Identity provider | Open | IT/Security | Account activation, MFA, recovery |
| ADR-004 | Document storage | Proposed | IT/Security | Upload workflow, application documents |
| ADR-005 | Notification providers | Proposed | IT/Comms | Admissions receipts, password recovery |
| ADR-006 | Runtime stack | Proposed | IT | Production scaffold and CI |
| ADR-007 | Hosting model | Open | Management/IT | Deployment, backups, monitoring |
| ADR-008 | LMS boundary | Deferred | Academic/IT | Learning module integration |
| ADR-009 | Accounting boundary | Deferred | Finance/IT | Ledger integration |
| ADR-010 | Legacy archive exposure | Proposed | IT/Security | Security containment |
| ADR-011 | Audit retention | Open | Management/Legal | Audit storage, archive policy |
| ADR-012 | Sensitive profile fields | Proposed | Registry/Legal | Student profile model |

## Approvals

| Area | Owner | Decision | Date | Signature |
| --- | --- | --- | --- | --- |
| Identity, access, and audit | IT/Security | | | |
| Master data and academic rules | Registry / Academic Board | | | |
| Documents and notifications | IT/Security, Communications | | | |
| Environments, backup, and operations | IT | | | |
| Phase 1 exit overall | Programme sponsor | | | |
