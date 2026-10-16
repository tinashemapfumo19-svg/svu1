# Programme Transfers

## Development Scope

Migration 034 adds reasoned independent programme, intake, and curriculum transfer requests. Approval creates a new `student_programmes` record for the same student, linked to its source through `origin_programme_id` and `transfer_request_id`. The original admissions application remains a provenance link, not a manufactured destination application or rewritten admissions decision. Accepted-offer conversion and admissions manifests still identify only the original admission record.

Source status becomes terminal `transferred`, with a status revision increment and retained history. The destination starts `onboarded` only after an active onboarded source and complete previously verified profile are rechecked. Ordinary lifecycle re-entry cannot reactivate a transferred source. Subsequent changes require another independently reviewed transfer. This is a sample-data pilot, not institutional transfer-policy approval or production authority.

## Controls

- Requester and independent reviewer each need permission-specific scope for both source and destination programme/intake. Global roles without that permission cannot widen authority. Students can view only their own records, not request or review transfers.
- The destination must change intake or curriculum and belong to an active programme, with a published intake and published curriculum currently effective on the approval date. Curriculum must contain courses. A transfer may repin a cohort to a different currently effective curriculum only through this explicit review, not a master-data overwrite.
- Pending requests retain source profile revision/completeness, programme status/revision, source registration revisions and selections, credit-recognition ledger, destination facts, a canonical SHA-256 evidence hash, reason, evidence reference, expiry, and actors. Review recomputes those facts. Stale/expired requests require rejection and a fresh request; approved/rejected history is immutable.
- Pending onboarding, suspension, interruption, withdrawal, completion, and transferred status cannot use transfer to bypass their own review. Current/future confirmed source enrolments must finish or be formally resolved first; no silent course withdrawal or learning-access cancellation occurs.
- Source and student locks serialize approval against source registration/profile changes and other transfers for the same student. One pending transfer per source, independent reviewer checks, unique destination request linkage, and transactionally paired history/audit records protect exactly-once effects. Concurrent approval retries yield one success and one immutable-review conflict.
- No duplicate live destination programme is created; an existing destination record must use its own lifecycle. Historically transferred destinations may be revisited through a fresh record and decision, never by repinning historic records.

## Capacity And Registration

Admissions offers, reconciled legacy acceptance imports, and transfer approvals share the `intake-seats:{intakeId}` advisory lock and occupancy calculation. Transfer arrivals consume destination seats without changing admissions counts. Each student's transfer arrivals consume at most one seat per intake; same-intake curriculum changes do not add another seat. A student already holding an offered/accepted admission in that intake is not counted twice. Catalogue places and manifests include `transferPlaces` while accepted manifests retain one row per original accepted application. Imports exceeding capacity roll back without partially creating accepted records.

Seat reservations remain conservative historical occupancy, like accepted admissions: transfer-away, withdrawal, and completion do not silently release seats. A governed capacity-release policy remains separate work. Sample legacy imports retain their own source-reconciliation contract rather than becoming an ordinary capacity override.

Registration periods are now unique per intake, semester, and pinned curriculum. Different curricula in the same intake can have distinct offerings, policies, and schedules. Registration, academic, and staff results period reads/writes reject the wrong curriculum. Destination enrolment cannot precede the approved transfer date, compared as an explicit UTC calendar day rather than a local-time Date conversion. Student/semester/course uniqueness remains in force across programme records.

Confirmed source enrolments, published results, and receipt retries remain unchanged and available to the owner. Draft source revisions are invalidated. The new destination has no inherited enrolments, grades, GPA, clearances, progression/repeat approvals, exceptions, or recognized-credit awards. Any credit mapping uses the separate independently reviewed [credit-recognition workflow](CREDIT_RECOGNITION.md). New registration still requires its own academic/financial clearance, calendar, curriculum, prerequisite, progression/repeat, and timetable checks.

## API And Views

| Endpoint | Authority |
| --- | --- |
| `GET /api/registry/programmes/{id}/transfers` | `registry.view`, scoped source |
| `GET /api/registry/me/programmes/{id}/transfers` | `registry.self`, ownership |
| `POST /api/registry/programmes/{id}/transfers` | `registry.transfer.request`, source and destination scope |
| `POST /api/registry/programmes/{id}/transfers/{requestId}/review` | `registry.transfer.approve`, source and destination scope, independent reviewer |

Requests accept only `intakeId`, `programmeVersionId`, `revision`, `evidenceHash`, `reason`, `evidenceRef`, and `expiresOn`. Reviews accept `outcome` (`approved`/`rejected`) and `reason`. No client-controlled student number, grade, study year, copied clearance, backdated effect, or source status is accepted.

Staff controls provide a permitted destination menu, reasoned requests, independent review, retained decisions, and navigation to the destination record. Registry filters include `transferred`. Student self-service defaults to the newest linked record and provides a programme/intake/curriculum/status picker for historic registrations and results. Private decision source snapshots are not returned in GET contexts.

## Verification And Remaining Gates

The broad isolated regression passed 80 unit tests, 18 Chromium browser tests, and 22 smoke checks (`svu_rebuild_it_1790970041546`, removed after verification). After tightening results curriculum guards, UTC chronology, and legacy-import capacity, the affected admissions, credit-recognition, and transfer regression passed all 80 units, six desktop/mobile browser journeys, and 22 smoke checks (`svu_rebuild_it_1790971074917`, removed). This distinguishes the broad baseline from verification of the final backend changes.

Coverage includes strict bounded requests, all three transfer types, independent review, permission-specific source/destination scope, owner isolation, stale evidence, exactly-once concurrent approval, preserved original conversion/manifest/receipt/result records, invalidated drafts, terminal lifecycle, no copied grades or credit, capacity denial/deduplication and import rollback, separate same-intake curriculum periods, wrong-curriculum results denial, UTC backdating denial, fresh clearance, and student historical-record selection. After the final student layout correction, both desktop/mobile transfer journeys passed again (`svu_rebuild_it_1790972278270`, removed). Assertions compare document width against the configured viewport and check the heading below the navigation after scrolling settles. Refreshed screenshots were inspected; mobile output is 390 pixels wide with the full heading and sign-out control visible.

Migration 034 was applied locally without reseeding. Before/after counts were identical: 18 students, 28 programme records, 114 applications, and zero local registration/enrolment/result/recognition records. These are development counts, not production reconciliation totals. The updated server is healthy at `http://127.0.0.1:4182/#registry`; an authenticated transfer-context GET returned a 64-character evidence hash and zero decisions without changing student records.

Institutional transfer and cohort-mapping policies, scheduled/backdated corrections, formal course withdrawal and teaching access, governed capacity release, many-to-many credit allocation, approved study-year corrections and legacy reconciliation, identity correction/merge, completion/awards, official documents, real finance and integrations, approved source migration/reconciliation, accessibility/browser breadth, and owner sign-off remain open. No synthetic policy or sample approval authorizes production transfers. The full rebuild remains active.
