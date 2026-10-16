# Stage 7 Exam Paper Custody

Development pilot extending `EXM-01` exam orders and `EXM-19` invigilation with controlled paper storage, approval and delivery. Migrations: `055_exam_paper_custody.sql` and `056_exam_paper_integrity.sql`. This is a new custody capability linked to the inventory, not a claim that a complete equivalent existed in the legacy application.

## Workflow

1. Approve an exam order. An in-force lead lecturer, scoped assessment planner or paper custodian requests a PDF version with its exact byte size, SHA-256 checksum and reason.
2. Its author uploads the bytes through an authenticated, time-limited upload intent. Files remain outside the static web root. Wrong size/checksum is refused; a disguised PDF is quarantined. Versions cannot overwrite their immutable file facts.
3. Authorized scanner-result staff record a clean/infected result against the exact checksum and revision, with a scanner reference. Infected files are quarantined. Scanner and later review evidence cannot be rewritten.
4. The author submits a clean version. A different scoped paper reviewer approves or returns it with a reason. Returned versions remain history; correction creates a new version. Approving a replacement supersedes the previous approved master and blocks its existing releases.
5. A scoped release officer selects an active, account-linked invigilator on the current published sitting. The release pins paper identity, sitting revision, published timetable revision, recipient, access times, declared copy count and sealed-package reference. Its access window must end by the recipient's published room end, including approved candidate extra time where applicable. See [candidate arrangements](EXAM_ARRANGEMENTS.md).
6. The named recipient signs in, downloads within that window, and records a reasoned custody receipt reference. A prior successful download is required. Download is not treated as proof of physical receipt; the separate acknowledgement records the recipient's attestation. Physical printing/packaging is represented by the custodian's declared copies and package reference, not a printer integration.
7. Release officers can recall a package. Withdrawn/superseded masters, draft or republished timetables, changed sittings, inactive/relinked staff, absent published allocations, expired windows and revoked releases fail closed on every delivery request. Previously downloaded bytes cannot be recalled from a recipient's device.

## Authority And Privacy

- `exams.papers.manage`: examination officers and administrators, scoped to the offering.
- `exams.papers.review`: examination officers, academic registrars and administrators; authors cannot approve their own versions.
- `exams.papers.scan`: administrators in the current development pilot. Recording a scanner result is not itself malware detection.
- `exams.papers.release`: examination officers and administrators, scoped to the offering.
- `exams.duties.self`: personal release listing, downloads and receipt acknowledgement; this does not grant generic paper access.
- Lead/planner upload authority uses the existing assessment-allocation and permission-scope rules. Generic results viewing alone grants no custody access. Wrong-scope order reads return `404`.
- Paper metadata and bytes are separate from generic documents. Generic document upload/list/download permissions or signed document URLs cannot reach these files.
- Downloads require an authenticated request and purpose; no public or transferable signed download URL is issued. Responses use `no-store`, attachment disposition and `nosniff`. Stored bytes are checked against size, digest and PDF signature before release/download.
- Student timetables contain no paper IDs, storage paths or custody data. Personal package responses omit colleague/custodian identities, staff IDs and internal custody reasons. Release email notices contain access times, not paper content, filenames, digests or package references.

## API

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/exams/orders/{id}/papers` | Authorized custody view, versions, packages, recipients and event history |
| `POST /api/exams/orders/{id}/papers` | Immutable PDF upload intent |
| `PUT /api/exams/papers/{id}/content` | Author-authenticated binary upload |
| `POST /api/exams/papers/{id}/scan` | Revision/checksum-bound scanner result |
| `POST /api/exams/papers/{id}/submit` | Author submission after clean scan |
| `POST /api/exams/papers/{id}/review` | Independent approve/return |
| `POST /api/exams/papers/{id}/withdraw` | Reasoned withdrawal; approved masters require custody authority |
| `POST /api/exams/papers/{id}/download` | Purpose-bound custody/author/reviewer access |
| `POST /api/exams/papers/{id}/release` | Recipient-bound package for the published sitting |
| `GET /api/exams/paper-releases/me` | Own release history and current eligibility |
| `POST /api/exams/paper-releases/{id}/download` | Revalidated recipient download |
| `POST /api/exams/paper-releases/{id}/acknowledge` | Own custody receipt after download |
| `POST /api/exams/paper-releases/{id}/revoke` | Revision-bound recall |

Custody mutations acquire the existing resource lock before the period timetable lock. Release/download/recall are serialized with timetable and allocation changes. Staff records are share-locked during release and delivery. Copy counts, recipients, access windows, file facts and already-recorded receipts cannot be edited in place; corrected packages/versions are new records. Events are append-only and actions are audited.

## Interface And Tests

Approved orders expose a **Paper custody** command in the offering assessment and examination timetable workspaces. Authorized staff see upload, scan, submission, review, download, release, recall and history controls. Named recipients see their own **Exam paper packages**, controlled downloads and receipt forms. Open forms survive refresh; sign-out clears custody state.

`test/exam-papers.test.js` covers upload bounds, explicit real release dates, half-open windows, stale/revoked/inactive/superseded delivery, permission seed parity and private single-query own responses. `e2e/exam-timetable.spec.js` covers desktop/mobile custody and recipient UI, quarantine, clean/infected scans, returned corrections, author separation, scope and recipient refusals, content/privacy headers, timed release, recall, supersession, receipt duplication, draft-allocation invalidation and direct database mutation refusal. Its database probes are guarded to isolated integration databases and rolled back.

Integration calendar fixtures share `SVU_TEST_NOW` for each run so desktop/mobile execution across midnight cannot create overlapping date-shifted calendars. This affects tests only, not institutional time or production calendars.

2026-10-05 verification: all 155 unit tests pass. The isolated affected-workflow regression (`data/build-exam-paper-custody-verified`) passed migration/seed, its unit phase, all four assessment/exam desktop/mobile journeys and all 22 smoke checks. That run started before the personal-package query optimization and its additional unit test; the final isolated custody run (`data/build-exam-paper-custody-final`) passed on both viewports against the optimized read, including database immutability probes, with receipt/custody screenshots inspected. Both databases and test servers were torn down. This is scoped verification, not a claim that all 48 browser journeys were rerun. Earlier midnight fixture and test-account-ID failures remain recorded in their original failed run. Local migrations and the canonical release notification template were applied without reseeding; the development app is healthy at `http://127.0.0.1:4177/#registry`.

## Production Gates

- ADR-004 object storage, encryption/retention, backup and recovery controls; only private local development storage is currently configured.
- Real malware-scanner integration. Development scan evidence uses explicit synthetic references; a manually recorded clean result must not be mistaken for scanning.
- Examinations-owner acceptance of author/reviewer/release roles, copy-count reconciliation, sealed-package handling, lost-package incidents and printing operations.
- D-27 mandatory ordering and paper requirements, D-26 staffing/seating/individual arrangements, production sign-off and institutional retention policy.

Direct scheduling remains available under current policy. This optional workflow does not make paper uploads or electronic release mandatory for every sitting.
