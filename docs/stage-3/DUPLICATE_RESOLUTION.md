# Stage 3 Duplicate Student Resolution

## Delivered Slice

Registry staff can find possible duplicate student records. A reviewed case either merges the records or confirms that they belong to different people. This is a development-pilot implementation for the duplicate-resolution part of `REG-04` and `REG-10`. It is not an approved production merge policy.

## Behaviour

- **Candidates.** A student record's possible duplicates are other unmerged students who share either the same legal name and birth date or the same phone (from the student or applicant profile). Staff can also compare against a specific student number. Candidates appear only when every one of their programmes is in the viewer's scope. Phone values are not exposed; only the match reason is shown.
- **Proposals.** A requester proposes `merge` (choosing which record survives) or `distinct`. The request pins a SHA-256 evidence hash covering both records' identity revision, profile revision, merge state, and programme status revisions. The hash does not depend on which record is viewed first.
- **Independence and scope.** Requests need `registry.duplicate.request`, and reviews need `registry.duplicate.approve`. The requester cannot review their own case. Both actions require scope over every programme of both students; an out-of-scope candidate returns `404`. Only roles that grant the specific permission lend scope.
- **One open case.** A student can be in only one open case at a time, enforced by a check under a row lock and a partial unique index for the pair.
- **Merge preconditions.** Merges fail closed (`409`) in each of these cases:
  - either record is already merged;
  - either record has an open identity correction;
  - both records hold a non-transferred programme in the same intake;
  - both records are enrolled on the same course in the same period.
- **Approval.** Approval recomputes the hash. Any change since the request (for example a profile edit) returns `409`, and the case must be rejected and resubmitted. A merge then does the following in one transaction:
  - re-links the duplicate's programme records and course enrolments to the survivor;
  - invalidates draft registrations on the moved programmes, so earlier clearances do not carry over;
  - marks the duplicate with `merged_into_student_id` and `merged_at`;
  - stores the moved programme IDs and enrolment count on the case.

  The duplicate student row, its profile, its profile history, and its identity requests are kept, not deleted. Programme status history, receipts, and results are unchanged because they belong to the programme records.
- **Distinct outcome.** An approved `distinct` case stops the pair from being suggested automatically. A lookup by student number still shows the pair, flagged as confirmed distinct. A second `distinct` request for the pair is refused.
- **After a merge:**
  - the survivor's account sees all programme records;
  - the duplicate account's `GET /api/registry/me` returns no programmes;
  - identity corrections on the merged record are refused;
  - name and birth-date clash checks ignore merged records;
  - if the merged person accepts a new offer, conversion attaches the programme to the surviving record.
- **Audit.** Audit events record the proposal, both student IDs, the evidence hash, and the merge result. They contain no identity values.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/programmes/{id}/duplicates?studentNumber=` | `registry.view` | Scoped candidates with match reasons and pair evidence hashes, cases involving the student, and caller capabilities. |
| `POST /api/registry/programmes/{id}/duplicates` | `registry.duplicate.request` | `candidateStudentId`, `survivor` (`current`/`candidate`), `proposal` (`merge`/`distinct`), `evidenceHash`, `reason`, `evidenceRef`. |
| `POST /api/registry/programmes/{id}/duplicates/{caseId}/review` | `registry.duplicate.approve` | `outcome` (`approved`/`rejected`) and `reason`. Reviewed cases are immutable. |

`academic_registrar` and `system_administrator` hold both permissions; separation is enforced for each case.

## Verification

Migration `036_duplicate_resolution.sql`. Unit tests are in `test/duplicate-resolution.test.js` (validation, order-independent evidence hash, merge conflicts). The desktop and mobile browser journey is in `e2e/duplicate-resolution.spec.js`. It covers:

- name and birth-date matching, with unrelated records excluded;
- wrong-scope hiding and `404`, with a global auditor role unable to widen scope;
- a UI merge request, then self-review and wrong-scope review denial, and the second-open-case `409`;
- stale-evidence rejection after a profile edit, a fresh request, and approval;
- programme re-linking visible to both accounts and in staff detail, the immutable case, and the refused identity correction on the merged record;
- a lookup by student number, a distinct request through the UI and its approval, the flagged candidate, and refusal of a repeat request;
- audit evidence and no horizontal overflow.

## Remaining Work

1. Account consolidation: retiring or linking the duplicate login account and its sessions under an identity-management decision.
2. Moving or reconciling the duplicate's profile and next-of-kin data into the survivor, and handling the duplicate's admissions documents.
3. A reviewed un-merge or correction path for mistaken merges.
4. Fuzzy matching (name variants, transposed dates) and national ID matching once that field is approved.
5. Notifications and owner-approved merge policy before production use.
