# Stage 3 Identity Corrections

## Delivered Slice

Student identity fields now change only through an evidenced request and an independent registry review. This is a development-pilot implementation for `REG-04` and `REG-08`; it does not replace duplicate resolution, approved privacy policy, or registry-owner sign-off.

| Inventory | Coverage |
| --- | --- |
| REG-04 | Legal name, preferred name, date of birth, and nationality are governed fields once a student record exists. National ID capture remains a privacy/lawful-purpose decision and is not stored. |
| REG-08 | Students and registry staff can request corrections with a reason and evidence reference. An independent reviewer approves or rejects; approved requests retain the before snapshot and corrected values. |

## Behaviour

- Governed fields: `legalName`, `preferredName`, `dateOfBirth`, `nationalityCode`. Email, national ID, and restricted fields are rejected.
- Names are whitespace-normalised, 2-200 characters for legal name, 1-200 for preferred name, with no control characters. Date of birth must be a real date for a student aged 14-100. Nationality must be an active, effective country reference value at request and approval time.
- Unchanged values are dropped; a request that changes nothing is rejected.
- Each student has an `identity_revision`. Requests pin the revision and a full snapshot of the current identity. Approval fails with `409` if the revision or snapshot has changed, so a stale request must be rejected and resubmitted.
- One open request per student, enforced by a partial unique index and a row lock.
- The requester can never review their own request (database check plus `assertSeparateApprover`). A student's request is reviewed by registry staff; a registrar's request needs a different reviewer.
- Staff routes are scoped through the programme record; only roles granting the specific permission lend scope. An unrelated global auditor cannot widen a scoped registrar.
- Approval atomically updates `people` and `applicant_profiles`, increments the identity revision, and writes an audit event. Audit metadata contains field names only, never the old or new values.
- If the corrected legal name and date of birth match another student, the request and the approval fail with `409`. Such cases need duplicate resolution, which is not yet built.
- Once a student record exists, `PUT /api/admissions/profile` refuses changes to date of birth or nationality (`409`). Resubmitting the same values is still allowed, so returning applicants can save the rest of their profile.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/me/identity` | `registry.self` | Own identity, revision, and correction history. |
| `POST /api/registry/me/identity` | `registry.self` | Request own correction: `revision`, `changes`, `reason`, `evidenceRef`. |
| `GET /api/registry/programmes/{id}/identity` | `registry.view` | Scoped identity, history, and caller capabilities. |
| `POST /api/registry/programmes/{id}/identity` | `registry.identity.request` | Staff-initiated correction request. |
| `POST /api/registry/programmes/{id}/identity/{requestId}/review` | `registry.identity.approve` | `outcome` (`approved`/`rejected`) and `reason`. Reviewed requests are immutable. |

`academic_registrar` and `system_administrator` hold both identity permissions; separation is enforced for each request.

## Interface

- `#apply`: accepted students see their identity details, a "Request a correction" form (hidden while a request is open), and the outcome of each request.
- `#registry`: the student detail shows an Identity panel with current values, a staff request form, and review forms for requests the viewer did not make.

## Verification

Migration `035_identity_corrections.sql`. Unit tests are in `test/identity-corrections.test.js`. The desktop and mobile browser journey is in `e2e/identity-corrections.spec.js`. It covers a student request through the UI, the second-open-request `409`, the blocked admissions-profile bypass, student and wrong-scope denial, registrar approval through the UI, propagation to the registry list and `/api/identity/me`, immutability after review, stale-revision rejection, staff request with self-review denial, the duplicate-identity `409`, value-free audit metadata, and no horizontal overflow.

## Remaining Work

1. Duplicate detection and governed merge or separation are now delivered in [DUPLICATE_RESOLUTION.md](DUPLICATE_RESOLUTION.md).
2. National ID and other restricted fields, after privacy and lawful-purpose decisions.
3. Uploaded evidence documents linked to requests (the current version accepts a text evidence reference).
4. Notifications to the student when a request is decided.
5. Email or login identifier changes, which belong with identity and access management.
