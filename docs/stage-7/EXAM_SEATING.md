# Stage 7 Optional Examination Seating

Optional development capability extending `EXM-19` under D-26. This is recorded seat-label allocation against published candidate rooms, not a room-layout engine, automatic physical seating, attendance certification or a mandatory institutional seating policy.

## Workflow

1. Independently publish a timetable with frozen [candidate manifests](EXAM_MANIFESTS.md).
2. A scoped scheduling officer opens the seating workspace and assigns seat labels to candidates in their exact published rooms. Partial drafts are allowed.
3. A different officer with scoped publication authority reviews and publishes the current draft. Every candidate must have a seat, unless the whole plan is empty to withdraw optional seating.
4. Published manifests include seats, students see only their own seat, and existing calendar exports carry that seat. Candidates and published invigilators receive a generic notice without seat labels, candidate lists or arrangement evidence.

Seat labels are manually entered from the institution's physical room labels: 1-30 ASCII letters, digits, spaces or `. _ / -`, starting with a letter or digit. Surrounding/repeated spaces are normalized; case-insensitive labels must be unique within a room. The same label can appear in different rooms. Every assignment must reference one exact candidate and their frozen room, with no duplicate student. A maximum of 5000 assignments per sitting is a technical bound, not a staffing or entitlement policy. No seat geometry, available-desk inventory, spacing or accessibility layout is inferred from venue capacity.

## Source And Revisions

Each plan pins the timetable publication revision and complete manifest digest. Edits increment its own seating revision; they do not change timetable or sitting revision, invigilators, room reservations, paper custody source or approved arrangement hashes. Draft editing keeps the preceding published seats available when they still match the current timetable source. Only independent seating publication replaces or withdraws that snapshot.

Stale revisions, no-op drafts, changed manifest/publication, draft timetables and started sittings cannot be edited or published. All seating mutations take the per-period timetable advisory lock before the timetable share lock and seating row lock, serializing with timetable publication and edits. A prepared draft cannot bypass a later publication. Any timetable republication invalidates preceding seats even when the manifest content happens to be unchanged: officers explicitly review a fresh plan. Stale assignments never auto-populate the current editor or public projections. Source checks are repeated at publication, with a complete-roster check.

While a timetable is draft, own student timetable snapshots keep the previous exam details but omit seating; staff manifests and the seating workspace fail closed. After republication, stale seats remain in revision history, not current output. Pre-manifest publications never invent a historical roster to enable seating. Deferred sittings use their exact frozen cohort; changed deferral sources still follow the existing cancel/rebook rules.

Migration `059_exam_seating.sql` adds a revisioned plan and immutable prepared/published history. History updates/deletes and plan deletion are refused by database triggers. SHA-256 checksums bind seating revisions, publication source and normalized assignments; they are consistency checks, not signatures or attendance evidence. History is retained in the development database, without claiming approved archival retention. The seating-workspace history endpoint requires a current published manifest. [Publication editions](EXAM_PUBLICATIONS.md) separately permit scoped office selection of historical published seating against the exact preserved manifest, including after current cancellation; historical self-service and approved permanent archival retention remain open.

## Authority And Interface

| Endpoint | Authority |
| --- | --- |
| `GET /api/exams/sittings/{id}/seating` | Scoped `exams.schedule` or `exams.publish` |
| `POST /api/exams/sittings/{id}/seating` | Scoped `exams.schedule`; revision, publishedRevision, manifestDigest, entries and reason |
| `POST /api/exams/sittings/{id}/seating/publish` | Scoped `exams.publish`; current revision/source and reason; not the latest preparer |
| `GET /api/exams/sittings/{id}/seating/history` | Scoped `exams.schedule` or `exams.publish`; current published manifest |

Permission-specific programme and intake scopes apply. Duties-only invigilators cannot access the office editor/history; they receive published seats only through their active, exactly assigned, room-filtered manifest. Students cannot access these office endpoints and receive only their own seat through their existing confirmed-enrolment/published-candidacy timetable projection. No peer seat lists, staff/account IDs or private arrangement evidence are added to student output.

Office preparation compares draft and published seats. An explicit clear command prepares full withdrawal for independent publication. Seat-plan history shows reasoned prepared/published revisions. Registry clears seating caches on sign-out, authentication loss, period change, timetable mutations and arrangement changes. Manifest exports always re-fetch authorization, carry the current seat and separate seating revision/checksum, and retain CSV formula protections. Access and mutation audits record source/revision/counts/checksums, not student numbers or seat labels. Reason text remains officer-entered; inappropriate sensitive text is not automatically detected.

## Verification

`test/exam-seating.test.js` covers exact candidate/room membership, label bounds and normalization, within-room uniqueness, partial-draft/full-publication/withdrawal rules, detached checksum snapshots, stale source, started refusal, permission-specific scope, locked revision updates, independent publication, prior seats during draft edits, JSONB-key-order-independent no-op detection, stale editor/manifest suppression and own-student projection privacy.

The examination journey adds real database preparation and independent publication, partial and stale denials, room mismatch, self-publication refusal, room-only invigilator seats, own student/calendar output, draft preservation, withdrawal/restoration, generic notices, append-only history and invalidation after late-candidate republication. `e2e/exam-seating-layout.spec.js` separately checks the real renderer/binder with synthetic long metadata on both viewports, exact source/entry submission, clear command, cache cleanup, close controls and mobile navigation clearance.

2026-10-05 checkpoint: all 189 unit tests pass. Final isolated `data/build-exam-seating-final` passed migration/seed, all units, eight desktop/mobile examination/manifest/refresh/seating checks and all 22 smokes. It verifies the actual JSONB no-op refusal, seating publication/withdrawal/restoration, private own-seat projections, checksum-stamped room-only CSV export, generic notices, append-only history, and stale-source invalidation through late-candidate refresh/republication. Existing arrangement, paper-custody, deferred-completion, session-privacy and PostgreSQL publication-blocking checks remain in the examination journey. Database `svu_rebuild_it_1791174778958` was dropped and its test server stopped. This is scoped browser verification, not a full suite rerun.

The first isolated run `data/build-exam-seating` passed migration/seed, units, both real examination journeys and all 22 smokes, but remains failed overall: its synthetic mobile seating check found document overflow (439px in a 390px viewport). Database `svu_rebuild_it_1791174154235` was dropped and its test server stopped. Constraining the seating form's grid tracks/children fixed the overflow; `data/build-exam-seating-layout-verified` passed both viewports and screenshots were inspected. The mobile viewport screenshot confirms primary controls clear fixed navigation; wide tables scroll within their wrapper. That first integration preceded the final JSONB no-op correction, manifest audit seating stamps and assigned-room seat-export assertion. Final run screenshots were also inspected; source and operational assertions are distinct from synthetic layout checks.

Migration 059 was applied to the local development database without reseeding. Before/after checks retained 188 accounts, with registration/sitting/arrangement counts unchanged; the new seating table is empty until a local officer prepares a plan. The seating template is loaded. Development server PID 3764, launcher session 89157, is healthy at `http://127.0.0.1:4177/#registry`, logs `data/dev-exam-seating.log` and `.err.log` (empty at checkpoint). Previous candidate-refresh server PID 27560/launcher 26563 was stopped.

No claim of production acceptance is made. D-26 remains open for mandatory seating, physical layouts, staffing, entitlements, evidence retention and owner acceptance. Recorded attendance, archival editions, supplementary-result policy and production integrations remain distinct unfinished work. Next implementation work is preserving prior examination publication editions; retention duration and institutional archival approval are not inferred from development history.

## Later Handover Verification

2026-10-05: Claude handed over the remaining examination failures from a full 125/128 browser checkpoint. Whole-workspace rerenders after sign-in and freshly authorized manifest downloads could replace the element while tests opened panels or captured screenshots. The examination spec now waits for the registry's enabled controls after submits and before post-download manifest screenshots. A separate student-portal arrangement open is asynchronous; the spec waits for its requested panel to become visible before calendar capture and the timetable screenshot. No production authorization, native operations, privacy checks or assertions were weakened.

First focused continuation/examination recovery `data/build-exam-handover-recovery.log` remains FAILED at 5/6. Mobile completed the entire journey, while desktop reached a later student-personal screenshot before the pending arrangement-panel render completed. Launcher 20074 ended exit 1 and database `svu_rebuild_it_1791233067481` was dropped.

Final `data/build-exam-handover-final.log` PASSED all six independently listed desktop/mobile checks across continuation reporting and the complete examination journey. Launcher 33986 ended exit 0; database `svu_rebuild_it_1791233971105` was dropped. Both databases are independently absent, 4197 has no listener and last-run metadata is passed with no failures. Desktop seating/personal-timetable and mobile manifest/personal-timetable screenshots were inspected. This browser-only run does not rerun units/smokes or establish full-suite acceptance; the separate scheduled-report checkpoint passed 355 standalone units, 44 reporting browsers and 22 smokes. The earlier full-run and first recovery remain failed provenance.
