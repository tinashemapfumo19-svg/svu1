# South Valley University Rebuild

The current local database contains imported legacy records rather than demo data. See [legacy cutover and recovery](docs/LEGACY_CUTOVER.md) for counts, existing-password login support and the records still needing reconciliation. Do not run the destructive demo seed against this database.

This workspace now separates the historical PHP system from the modern rebuild.

- `_legacy_php_system/` contains the packaged legacy PHP files, SQL dumps, uploads, chat bundles, diagnostics, and old root entry points.
- `docs/COMPREHENSIVE_REBUILD_ROADMAP.md` is the active staged rebuild plan.
- `docs/LEGACY_FUNCTIONALITY_INVENTORY.md` is the source-traced feature catalogue.
- `docs/CODEX_CLAUDE_WORKSPACE.md` is the shared working file for Codex and Claude.
- `docs/OUTSTANDING_DECISIONS.md` lists every open owner, policy, and provider decision, with today's behaviour while each is pending.
- [Build verification checkpoints](docs/BUILD_VERIFICATION.md) define quiet windows, source fingerprints and the limits of test evidence.
- [Roadmap exit-gate evidence map](docs/ROADMAP_EXIT_GATE_STATUS.md) distinguishes development coverage from the approvals and production evidence still required.
- `docs/phase-1/` contains the active Phase 1 foundation package.
- `index.html`, `src/styles.css`, and `src/app.js` are the first modern interface slice.

## Current Build Slice

The platform foundation and Stage 2 admissions pilot are implemented, with subsequent development pilots for registry, finance, teaching/LMS integration, examinations, documents, communications and reporting. The contracts below define each delivered scope and its verification; they do not establish that every stage exit gate has passed. Production deployment, provider integrations, approved legacy migration, institutional policy and owner sign-off remain separate exit gates.

The application is a Node modular monolith backed by PostgreSQL. It serves the applicant and staff interfaces, exposes foundation and admissions APIs, runs SQL migrations, and provides a health check. Stage 2 behaviour and traceability are in [ADMISSIONS.md](docs/stage-2/ADMISSIONS.md); browser coverage is in [BROWSER_QA.md](docs/stage-2/BROWSER_QA.md).

Stage 3 student onboarding is available in `#apply` after acceptance and `#registry` for registrar review. The [registry contract](docs/stage-3/REGISTRY.md) records delivered student-profile/search/approval scope and the remaining registration/progression work. Onboarding does not grant course or financial eligibility.

The [course-registration contract](docs/stage-3/REGISTRATION.md) covers semester setup, delivery schedules, student selections, separate academic/financial clearances, and exactly-once confirmed enrolments. [Academic decisions](docs/stage-3/ACADEMIC_PROGRESS.md) add published-result prerequisites and independent policy-backed progression/repeat approvals. [Governed exceptions](docs/stage-3/EXCEPTIONS.md) resolve bounded credit/timetable blockers with independent, expiring approvals. Missing or stale evidence remains an explicit blocker; finance-ledger integration is not implemented.

The [results pilot](docs/stage-3/RESULTS.md) adds reconciled final-mark import, independent evidence-backed review, calendar-controlled publication, and private student result/GPA views. Registration consumes retained published evidence; official policy approval, exceptions, amendments, and the wider examinations lifecycle remain in progress.

[Result-period completion](docs/stage-7/RESULT_COMPLETION.md) separates awaiting recording, review and publication from official completion in the native staff workspace. Rejected history and changed roster membership remain explicit; malformed source evidence refuses figures and allows a clean retry. Counts use the existing intake/curriculum-wide period roster, not one student's individual outcomes or approved institutional performance measures.

[Result-publication notices](docs/stage-7/RESULT_PUBLICATION_NOTICES.md) queue one generic availability message per student account in the publication transaction. Queue failures roll back publication; concurrent and later amended-result retries do not duplicate notices. Actual email delivery and institutional wording approval remain separate gates.

[Personal messages](docs/phase-1/NOTIFICATION_INBOX.md) at `#messages` show the signed-in account's non-secret notices, with unread filtering, paging and explicit read acknowledgement. The header bell opens the inbox on desktop and mobile. Portal read state does not imply email delivery.

[Result source custody](docs/stage-7/RESULT_SOURCE_CUSTODY.md) binds review approval and first publication to the native import/review receipts, recomputed source controls, retained enrolment snapshots and pinned grading policy. A reviewed status alone is not approval. Rejection and exactly-once published retries retain their existing behavior; institutional source/policy acceptance remains gated.

[Programme lifecycle](docs/stage-3/LIFECYCLE.md) supports independently approved suspension, interruption, withdrawal, and re-entry with retained status history. Changes invalidate draft reviews without rewriting confirmed enrolments, receipts, or published results; institutional policy and production approvals remain gated.

[Credit recognition](docs/stage-3/CREDIT_RECOGNITION.md) adds independently approved internal/external transfers and exemptions for unattempted curriculum courses. Recognized credit can satisfy core/prerequisite/progression requirements under an explicit published policy, but is excluded from GPA and cannot replace missing or failed results.

[Programme transfers](docs/stage-3/PROGRAMME_TRANSFERS.md) add independently reviewed programme, intake, and curriculum changes through new linked records. Original admissions, enrolments, results, and receipts are retained; destination capacity and fresh registration eligibility remain enforced. Verification status and production gates are recorded in that document.

[Effective study-year tracking](docs/stage-3/STUDY_YEAR.md) derives each programme's recorded level and current/upcoming enrolment from immutable confirmed receipts. Future registration does not advance the year early, lower-year repeats do not demote it, and incomplete legacy evidence requires reconciliation. Staff and students share dated history without a year-edit override.

Stage 7 adds [result amendments](docs/stage-7/RESULT_AMENDMENTS.md), [assessment plans with mark entry, batch upload, moderation, and external-examiner sign-off](docs/stage-7/ASSESSMENT_MARKS.md), [deferred-assessment completion](docs/stage-7/DEFERRED_ASSESSMENT.md), [transcripts with public verification](docs/stage-7/TRANSCRIPTS.md) at `#verify`, [exam orders](docs/stage-7/EXAM_ORDERS.md) linked to the [examination timetable](docs/stage-7/EXAM_TIMETABLE.md), [managed exam venues and personal invigilation duties](docs/stage-7/EXAM_RESOURCES.md), a [graduation audit with award conferral](docs/stage-7/GRADUATION_AWARDS.md), a Stage 8 [document repository](docs/stage-8/DOCUMENT_REPOSITORY.md) at `#resources`, [approved official-document templates with reference numbers](docs/stage-8/DOCUMENT_TEMPLATES.md), an [issued-documents register](docs/stage-8/DOCUMENT_ISSUANCE.md), and [integration governance](docs/stage-8/INTEGRATION_GOVERNANCE.md) (connection catalogue and governed delivery queue). Each is a development pilot pending Academic Board and registry-owner approval.

[Controlled exam-paper custody](docs/stage-7/EXAM_PAPER_CUSTODY.md) adds private PDF versions, independent approval, recipient-bound timed packages, recall and custody receipts. Production storage, malware scanning, physical printing controls and owner acceptance remain open.

[Candidate arrangements](docs/stage-7/EXAM_ARRANGEMENTS.md) adds encrypted private requests, independent review, extra-time and separate-room bookings, personalised timetables/calendars and room-specific invigilation instructions. Institutional entitlements, evidence custody, seating and retention policy remain open.

[Published candidate manifests](docs/stage-7/EXAM_MANIFESTS.md) freeze room rosters and individual end times at independent timetable publication. Scoped officers can view/export the full sitting; active assigned invigilators receive only their rooms. Later enrolments join only after republication, and CSV downloads recheck authorization. Optional [independently reviewed seating](docs/stage-7/EXAM_SEATING.md) binds manual seat labels to the published room roster. [Publication editions](docs/stage-7/EXAM_PUBLICATIONS.md) preserve historical snapshots for scoped office review and export. Recorded attendance, approved archival retention and historical self-service remain separate work.

Stage 8 begins with [examination workload reporting](docs/stage-8/EXAMINATION_REPORTING.md) and [admissions workload/capacity reporting](docs/stage-8/ADMISSIONS_REPORTING.md): permission-scoped counts, versioned development metric dictionaries, consistent source snapshots and freshly authorized audited CSV exports. Admissions follows current workflows and existing transfer-place policy with explicit reconciliation controls. Institutional metric approval, wider management/statutory dashboards and production scheduled-reporting operations remain open.

[Finance reporting governance](docs/stage-8/FINANCE_REPORTING.md) adds versioned definitions, explicit UTC recording cutoffs, currency-separated exact arithmetic and freshly authorized audited server-side CSV to the existing ledger control totals. Institutional finance and accounting-close approval remain open.

[Registry and enrolment reporting](docs/stage-8/REGISTRY_REPORTING.md) distinguishes current programme records from retained programme-period registrations and course enrolments, with scoped source-binding reconciliation and audited fresh CSV. It does not infer unique-student or active-enrolment census figures.

[Student support cases](docs/stage-8/SUPPORT_CASES.md) add private student-programme feedback/contact handling, explicit scoped support roles, assignment, public/internal replies, manager escalation and retained resolution history. Support policy and production acceptance remain open.

[Student support reporting](docs/stage-8/SUPPORT_REPORTING.md) adds scoped current workload, distinct owner/programme counts, public-reply and elapsed-resolution samples, reconciliation controls and fresh audited CSV. Definitions and service targets remain approval-pending.

[Applicant campaign reporting](docs/stage-8/COMMUNICATION_REPORTING.md) preserves private previews, reconciles published audience/recipient records, distinguishes portal read acknowledgements from queued/cancelled email, and provides fresh audited CSV. Provider delivery evidence remains unavailable.

[Academic outcomes and awards reporting](docs/stage-8/ACADEMIC_REPORTING.md) separately authorizes current official results, retained progression decisions and approved conferrals. Unavailable domains produce null totals, not partial counts; fresh audited CSV and source reconciliation are provided. Institutional metrics, eligibility and graduation-rate definitions remain separate gates.

[Confirmed period continuation](docs/stage-8/CONTINUATION_REPORTING.md) compares an explicitly selected baseline cohort with a later same-intake period. Follow-up-only records stay outside the denominator, future/empty shares are null and current lifecycle states do not erase retained confirmations. Institutional retention/census rules remain approval-pending.

[Assessment recording workload](docs/stage-8/ASSESSMENT_REPORTING.md) adds staff-scoped plan, roster, component, moderation and recording measures with source controls and fresh CSV. These are native staff mark sheets, not student assignment-upload events or official result eligibility; institutional definitions remain approval-pending.

[Private report editions](docs/stage-8/REPORT_EDITIONS.md) add server-generated retained JSON/definitions/original CSV across all ten native reporting domains, encrypted creator-only custody, complete current-scope checks, explicit UTC expiry and terminal withdrawal. [Private report schedules](docs/stage-8/REPORT_SCHEDULES.md) add automatic UTC capture with independent delegation, fresh owner authority, durable retries and reasoned lifecycle controls. Institutional approval, sharing/distribution, legal retention/disposal and production acceptance remain separate gates.

[Applicant group communications](docs/stage-8/APPLICANT_COMMUNICATIONS.md) add explicit optional-update preferences, scoped audience previews, encrypted campaign history and own-account inboxes. Development verification is recorded; email is queued, not delivered, and sending-policy/provider gates remain open.

[Governed admissions guidance](docs/stage-8/ADMISSIONS_GUIDANCE.md) adds immutable scoped drafts, independent publication and effective-dated public search at `#apply`. Development verification is recorded. This is a COM-11 knowledge foundation, not an accepted AI/WhatsApp service; external-channel hand-off and owner/provider approval remain open.

[Prospective applicant enquiries](docs/stage-8/PROSPECTIVE_ENQUIRIES.md) add explicit in-app response consent, account/intake-bound conversations, scoped admissions assignment, private notes, manager escalation and terminal withdrawal. Selected development verification and separate portal-loading corrective results are recorded; this portal hand-off is separate from external AI/WhatsApp delivery and admission decisions.

[Prospective enquiry reporting](docs/stage-8/ENQUIRY_REPORTING.md) adds scoped workload/consent/reply controls, distinct-account totals, separately authorized application associations and elapsed-time samples with fresh CSV exports. Selected development verification is recorded; definitions and institutional service targets remain approval-pending.

Open `index.html` in a browser to view the rebuild shell without the API. The initialization example below is only for a new, disposable local development database: the acknowledged seed destroys existing data. For this existing workspace, run migrations and start the server without seeding.

```powershell
npm.cmd install
docker compose up -d postgres
$env:SVU_ENV='development'
npm.cmd run migrate
npm.cmd run seed -- --reset-database svu_rebuild
npm.cmd run backup:rehearse
npm.cmd run dev
```

Outside development, set `SVU_DATA_KEY` (see `.env.example`); the server refuses to start without it. Load baseline reference data, workflow definitions, and notification templates in any environment with `npm.cmd run reference:load`.

`seed` requires explicit development mode and a one-shot exact-database reset acknowledgement. JSON demo seeding also requires an exact-file acknowledgement. See [development seed safety](docs/phase-1/DEVELOPMENT_SEED_SAFETY.md). For an existing workspace, use `migrate` and `reference:load` instead of reseeding. Sample admissions export validation is available with `npm.cmd run admissions:migrate -- docs/stage-2/SAMPLE_ADMISSIONS_EXPORT.json`; mapped import and reconciliation instructions are in [MIGRATION.md](docs/stage-2/MIGRATION.md).

Then open `http://127.0.0.1:4173`.

The default local database URL is:

```text
postgres://postgres:postgres@127.0.0.1:5433/svu_rebuild
```

Override it with `DATABASE_URL` or `SVU_DATABASE_URL`.

Phase 1 APIs cover identity (invitations, activation, sessions, MFA, recovery, `me`), access and audit, guarded workflows and tasks, the document pipeline (upload intents, signed upload/download, scanning, review), notifications, and effective-dated master data (organisation units, programmes and versions, curricula and courses, academic calendar, intakes, grading schemes, GPA rule sets, reference lists). The full list with behaviour notes is in `docs/phase-1/API_CONTRACTS.md`.

Protected APIs require:

```text
Authorization: Bearer <session-token>
```

Local development credentials seeded by `npm.cmd run seed`:

```text
admin@southvalley.test
Phase1-Admin-Password-2026!
```

The seeded academic registrar is the maker-checker approver for publishing programme versions, grading schemes, and GPA rule sets:

```text
registrar@southvalley.test
Kariba-Senate-Approvals-2026!
```

The seeded student account can log in but is intentionally denied privileged foundation actions:

```text
tinashe@example.edu
Phase1-Student-Password-2026!
```

Workflow transitions and document metadata creation are also scope-checked against registered programme/intake context. The seeded admin has global scope; restricted users must have a matching role assignment for the target programme and intake.

Useful checks:

```powershell
npm.cmd test                    # unit tests
npm.cmd run test:integration    # isolated: throwaway database + server + every smoke script, then teardown
npm.cmd run test:browser        # isolated applicant/staff browser journey on desktop and mobile
npm.cmd run smoke:all           # every smoke script against the running dev server
npm.cmd run backup:rehearse
npm.cmd run demo:phase1
```

Install the test browser once with `npx.cmd playwright install chromium`. `test:integration` is what CI runs (`.github/workflows/ci.yml`); it includes the browser journey and never touches the development database. Browser failures retain screenshots and traces under `test-results/`; successful journeys also save applicant and staff screenshots there. The browser tests use actual uploads, with the existing scan-result API standing in for the pending malware scanner.

The Phase 1 demo command writes its latest evidence pack to `docs/phase-1/EXIT_GATE_EVIDENCE.generated.json`.
The backup rehearsal writes its latest evidence pack to `docs/phase-1/BACKUP_RESTORE_EVIDENCE.generated.json`. It creates a unique disposable database, verifies snapshot-consistent schema/content and removes only its owned target; it never replaces an existing rehearsal database. See [database recovery](docs/phase-1/DATABASE_RECOVERY.md) for requirements, scope and remaining recovery gates.

## Design Direction

The interface follows the South Valley University e-learning design language:

- white and neutral surfaces first;
- Twitter/X blue `#1D9BF0` only for active, interactive, progress, and informational emphasis;
- warm beige only for selective supporting surfaces;
- top navigation on desktop and bottom navigation on mobile;
- calm spacing, clear next actions, and student-first learning context;
- reusable primitives rather than one-off page styling.

## Legacy Archive Rule

Do not edit files inside `_legacy_php_system/` unless a task explicitly requires source inspection or migration extraction. Treat it as a read-only reference archive.
