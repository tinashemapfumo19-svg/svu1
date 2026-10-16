# Outstanding Decisions

These decisions need people rather than code. Each entry gives:
- the question;
- what the system does today until it is decided;
- what the decision unblocks;
- where the detail lives.

Where there is an obvious default, it is listed as **Suggested**, and building continues on that basis.

Record each answer in the **Decision** line with a date and who decided, then move the entry to [Decided](#decided). Architecture answers also go in [DECISION_REGISTER.md](phase-1/DECISION_REGISTER.md).

Last updated: 2026-10-04.

## Summary

| ID | Decision | Owner | Blocks |
| --- | --- | --- | --- |
| D-01 | How deferred students appear in official results | Academic Board | Any period with a deferral reaching official results |
| D-02 | Whether fees or holds block transcript issue | Registry and Finance | Production transcript policy |
| D-03 | Hosting model (ADR-007) | Management and IT | Staging, deployment, backups, rollback gate |
| D-04 | Identity provider (ADR-003) | IT and Security | Production sign-in, MFA, recovery |
| D-05 | Document storage and malware scanner (ADR-004) | IT and Security | Production uploads |
| D-06 | Email, SMS, and payment providers (ADR-005) | IT, Comms, and Finance | Real notifications and payments |
| D-07 | Accounting boundary (ADR-009) | Finance and IT | Ledger integration, sponsors, payment plans |
| D-08 | Audit retention period (ADR-011) | Management and Legal | Archive policy |
| D-09 | Restricted profile fields and national ID (ADR-012) | Registry and Legal | Religion, disability, medical, national ID fields |
| D-10 | Production stack and architecture sign-off (ADR-001, ADR-006, ADR-010) | IT | Production build |
| D-11 | LMS product and library scope | Academic and IT | Stage 6 connector |
| D-12 | Grading scheme, GPA rules, and classifications | Academic Board | Official grading |
| D-13 | Assessment rules (components, rounding, absent, deferred, exempt) | Academic Board | Official mark calculation |
| D-14 | Result amendment authority | Academic Board | Production amendments |
| D-15 | Exam-board approval before first publication | Academic Board | Results workflow |
| D-16 | Moderation and external-examiner sign-off | Academic Board | Assessment review |
| D-17 | Transcript layout, wording, and delivery | Registry | Production transcripts |
| D-18 | Exception, transfer, and progression policy cases | Academic Board and Registry | Wider registration exceptions |
| D-19 | Duplicate account consolidation and un-merge policy | Registry and IT | Merging login accounts |
| D-20 | Staff and teaching ownership | HR and Academic | Staff migration, workload rules |
| D-21 | Legacy data migrations and control totals | Each data owner | Every production cut-over |
| D-22 | Phase and stage sign-offs | Project owner | Production use of each stage |
| D-23 | Accessibility and browser support target | Project owner | QA exit criteria |
| D-24 | Institution timezone | Project owner | Consistent exam, deadline, and window times |
| D-25 | Exam timetable publication rules | Examinations office | Production timetables |
| D-26 | Exam venues, invigilators, and special arrangements | Examinations office and Registry | `EXM-19`, candidate arrangements |
| D-27 | Exam ordering by lecturers | Examinations office | `EXM-01` paper requests |
| D-28 | Metric ownership and institutional reporting rules | Institutional owners | Production reports |
| D-29 | Support ownership, routing, and service policy | Student services | Production support cases |
| D-30 | Graduation rules and conferral authority | Senate and Registry | Production awards |
| D-31 | Document repository ownership and records retention schedule | Records owner and Legal | Repository go-live, disposal |
| D-32 | Applicant group-message consent and sending policy | Admissions, Communications and Legal | Production optional communications |
| D-33 | Public knowledge ownership and assisted guidance policy | Admissions, Communications, IT and Legal | Approved knowledge, prospective hand-off and AI/WhatsApp acceptance |
| D-34 | Payment plan policy | Finance | Production payment plans |
| D-35 | Sponsor accounts policy | Finance | Production sponsorships |
| D-36 | Course withdrawal policy | Registry, Academic Board and Finance | Production course withdrawal |
| D-37 | AI similarity checking of assignments (GPTZero) | Academic Board, IT and Legal | Enabling the GPTZero provider in production |
| D-38 | Claude-assisted features: data sharing, notice and use | IT, Legal, Academic Board and Student Services | Setting `SVU_AI_ASSIST=anthropic` in production |
| D-39 | Early-warning rules and who acts on them | Registry and Student Services | Production use of the early-warning list |
| D-40 | Automated reminders: timings, opt-out and channels | Registry, Academic Board, Finance, Student Services and Communications | Enabling `SVU_AUTOMATIONS` in production |
| D-41 | Ask SVU in-app help guide: audience, personal data, logs and external links | Communications, Student Services, Admissions and the data protection officer | Enabling `SVU_AI_ASSIST` in production, and starting phase 2 (personal answers) |
| D-42 | Student self-service documents: letter wording, letterhead and signature; digital ID card photo and acceptance | Registrar, Communications, Library, Examinations, Security | Announcing letters and the digital card to students |
| D-43 | Course evaluations: questions, anonymity threshold, who reads comments, moderation | Academic Board, Quality Assurance, Deans | Opening the first evaluation round |
| D-44 | Online fee payments: provider, currencies, charges, reconciliation and refunds | Finance, Bursar, IT | Enabling SVU_PAYMENTS in production |
| D-45 | Text messages: provider, cost, which notices, consent wording | Communications, Finance, IT, data protection officer | Enabling SVU_SMS in production |
| D-46 | Class attendance: what it counts for, threshold, retention and exceptions | Academic Board, Deans, Student Services | Using attendance beyond the early-warning list |

## Academic Board

### D-01 How deferred students appear in official results

- **Question.** When a student has a deferred assessment, how do the period's official results handle them?
- **Today.** A deferral withholds that student's final mark. The period's official results batch must cover every enrolled student, so one deferral blocks publication for the whole period. Deferred sittings and independently reviewed completion marks now resolve the component before a fresh sheet is moderated and approved; earlier submissions and decisions remain history. This preserves the existing hold-until-resolved policy, not the suggested incomplete-grade option.
- **Options.**
  1. Publish everyone else, and record deferred students with an explicit incomplete grade (for example `DEF` or `I`), excluded from GPA. Their result is completed later through a deferred sitting. *Suggested.* This is common practice, but it adds a non-numeric outcome that GPA, prerequisites, progression, and transcripts must all handle.
  2. Hold the whole course's results until deferred sittings are marked. This is simple, but delays everyone.
  3. Publish the course without deferred students and add them in a later supplementary batch.
- **Also decide.**
  - Whether the deferred grade counts as attempted credit.
  - Whether it blocks prerequisites and progression.
  - The deadline by which a deferral must be resolved, and what happens if it is not.
- **Unblocks.** Incomplete-grade publication and supplementary results batches (Stage 7). Deferred-sitting completion under the current policy has a development-pilot implementation.
- **Detail.** [ASSESSMENT_MARKS.md](stage-7/ASSESSMENT_MARKS.md).
- **Decision.**

### D-12 Grading scheme, GPA rules, and classifications

- **Question.** What are the official grade bands, points, classifications, GPA method, retake rule, exclusions, and rounding, for each award level?
- **Today.** The seeded schemes are placeholders. Each scheme is versioned and needs maker-checker publication, so approved values can be loaded without code changes.
- **Unblocks.** Official grading, GPA, and transcripts.
- **Detail.** [MASTER_DATA_CATALOG.md](phase-1/MASTER_DATA_CATALOG.md) and the `EXM-20` requirements.
- **Decision.**

### D-13 Assessment rules

- **Question.** Which component structures are allowed (count and weight limits), and how are final marks rounded? How are absent (scores zero), exempt (remaining weights rescaled), and deferred (final withheld) components treated?
- **Today.** The rules above are implemented as a pilot. Final marks round half up to a whole number.
- **Unblocks.** Official mark calculation.
- **Detail.** [ASSESSMENT_MARKS.md](stage-7/ASSESSMENT_MARKS.md).
- **Decision.**

### D-14 Result amendment authority

- **Question.**
  - Which amendment categories are allowed?
  - Who may approve an amendment?
  - Does a change across the pass/fail boundary need faculty or board approval?
- **Today.**
  - The categories are marking error, transcription error, moderation, appeal, and academic misconduct.
  - The requester and approver must be different people.
  - A pass-to-fail change is refused while the result supports approved credit.
- **Unblocks.** Production amendments.
- **Detail.** [RESULT_AMENDMENTS.md](stage-7/RESULT_AMENDMENTS.md).
- **Decision.**

### D-15 Exam-board approval before first publication

- **Question.** Must results pass department review and faculty or board approval before publication, as the roadmap's results workflow describes?
- **Today.** Results need one independent review, then publication within the results window.
- **Unblocks.** The full results workflow.
- **Detail.** [RESULTS.md](stage-3/RESULTS.md).
- **Decision.**

### D-16 Moderation and external-examiner sign-off

- **Question.** Must submitted marks be moderated, or signed off by an external examiner, before review? What sample size is required, and who may moderate?
- **Today.** Independently approved plans can require internal moderation, or internal plus external sign-off, before submitted marks can be approved. Existing plans default to no moderation. Scoped academic approvers perform internal moderation; scoped external examiners sign after it. Both must be independent of mark editors and the submitter, and of each other. Evidence references and reasons record the sample review; there is no computed sampling rule. Teaching allocations also record moderator roles, but those allocations alone do not grant sign-off authority.
- **Unblocks.** Institution-wide moderation requirements and sampling rules.
- **Detail.** [ASSESSMENT_MARKS.md](stage-7/ASSESSMENT_MARKS.md) and [TEACHING_ALLOCATION.md](stage-5/TEACHING_ALLOCATION.md).
- **Decision.**

### D-18 Exception, transfer, and progression policy cases

- **Question.** Which institutional policy cases apply, and who holds authority for each?
  - deadline, prerequisite, progression, and finance exceptions;
  - equivalence rules for credit transfer;
  - many-to-many credit allocation;
  - course withdrawal and access.
- **Today.** Credit-load and timetable-clash exceptions, one-to-one credit recognition, and programme transfers work, each with independent approval. Other cases are refused.
- **Unblocks.** Wider Stage 3 exceptions.
- **Detail.** [EXCEPTIONS.md](stage-3/EXCEPTIONS.md), [CREDIT_RECOGNITION.md](stage-3/CREDIT_RECOGNITION.md), and [PROGRAMME_TRANSFERS.md](stage-3/PROGRAMME_TRANSFERS.md).
- **Decision.**

## Registry

### D-31 Document repository ownership and records retention schedule

- **Question.**
  - Who owns the repository and each collection?
  - Which collections are needed (policies, handbooks, forms, minutes, HR), and who may see, contribute to, and publish in each?
  - How long is each kind of record kept?
  - How is disposal approved and evidenced?
- **Today.**
  - Records managers create collections with view roles, view-only or download rules, and an optional retention period.
  - A second person publishes each file.
  - Items past retention appear in a review queue, but nothing is ever deleted.
- **Suggested.** Adopt a records retention schedule by document class, and keep two-person disposal with a retained disposal record.
- **Detail.** [DOCUMENT_REPOSITORY.md](stage-8/DOCUMENT_REPOSITORY.md). Related to D-08 (audit retention) and D-05 (scanner and text extraction).
- **Decision.**

### D-30 Graduation rules and conferral authority

- **Question.**
  - What are the completion rules for each programme: minimum credits, elective credits, cumulative GPA, award titles, and any year-by-year or time-limit rules?
  - Who may confer an award?
  - Must Senate approve a graduation list?
  - Do outstanding fees, financial holds, or open disciplinary cases block conferral?
- **Today.**
  - Rules are drafted by a registrar and published by an independent approver.
  - Conferral needs a met audit and a second person.
  - Holds and discipline are not checked.
- **Suggested.** Keep two-person conferral. Decide on holds together with D-02.
- **Detail.** [GRADUATION_AWARDS.md](stage-7/GRADUATION_AWARDS.md).
- **Decision.**

### D-36 Course withdrawal policy

- **Question.**
  - What is the last date a student may withdraw from a course?
  - Should a withdrawn course appear on the transcript (for example as "W")?
  - What fee refund or charge applies, and does it differ by date?
  - Does withdrawal need evidence or adviser sign-off, and who approves?
  - Does a withdrawal count as an attempt for repeat or progression rules?
- **Today.**
  - Students or registry staff request; a second person approves.
  - No deadline applies, but withdrawal is refused once any result exists.
  - The course leaves active rosters; the transcript and finance are unchanged.
- **Detail.** [COURSE_WITHDRAWAL.md](stage-3/COURSE_WITHDRAWAL.md).
- **Decision.**

### D-35 Sponsor accounts policy

- **Question.**
  - Which sponsors are recognised, and what agreement must be on file?
  - How are sponsors invoiced, and on what terms?
  - Should a sponsor credit settle only the charge it covers?
  - What happens to the sponsor's share when a student withdraws or a sponsor fails to pay?
  - Who may approve sponsorships above a threshold?
- **Today.**
  - Global finance staff create sponsors.
  - Sponsorships (percentage, codes, cap, validity) are approved by a second person.
  - Covered amounts move to the sponsor's balance immediately, and sponsor credits join the oldest-first allocation.
  - Nothing reverses if a sponsor does not pay.
- **Detail.** [SPONSORSHIPS.md](stage-4/SPONSORSHIPS.md).
- **Decision.**

### D-34 Payment plan policy

- **Question.**
  - Who is eligible for a payment plan?
  - What is the maximum number of instalments or the longest plan?
  - Are there late fees or interest?
  - Does a defaulted plan block a new one?
  - May students request plans themselves?
- **Today.**
  - Finance officers propose 2-12 instalments within a year, covering the full outstanding balance in one currency.
  - A second person approves.
  - The covered fees stop placing a hold only while the plan is current.
  - There are no fees and no default restriction.
- **Detail.** [PAYMENT_PLANS.md](stage-4/PAYMENT_PLANS.md).
- **Decision.**

### D-02 Whether fees or holds block transcript issue

- **Question.** Should an outstanding balance or an active financial hold stop a transcript being issued? Should that apply to all transcripts, or only to those sent to third parties?
- **Today.** Holds do not block transcripts; they only block registration.
- **Suggested.** Do not block a student's own progressive transcript. Decide separately for official copies sent to third parties.
- **Unblocks.** The production transcript policy.
- **Detail.** [TRANSCRIPTS.md](stage-7/TRANSCRIPTS.md) and [STUDENT_FINANCE.md](stage-4/STUDENT_FINANCE.md).
- **Decision.**

### D-17 Transcript layout, wording, and delivery

- **Question.**
  - Approve the layout and wording.
  - Should students be able to request transcripts themselves?
  - Should transcripts be sent to third parties?
  - Is a digital signature required, and how long are transcripts retained?
- **Today.** Registrars issue a printable page with a verification code. Students can view and print their own.
- **Unblocks.** Production transcripts, and the document-service template (`RPT-09`).
- **Detail.** [TRANSCRIPTS.md](stage-7/TRANSCRIPTS.md).
- **Decision.**

### D-19 Duplicate account consolidation and un-merge policy

- **Question.** When two student records are merged, what happens to the duplicate's login account, profile, next-of-kin details, and documents? Can a mistaken merge be undone, and by whom?
- **Today.** Records are merged with independent confirmation. Login accounts are left as they are.
- **Unblocks.** Account consolidation.
- **Detail.** [DUPLICATE_RESOLUTION.md](stage-3/DUPLICATE_RESOLUTION.md).
- **Decision.**

### D-09 Restricted profile fields and national ID (ADR-012)

- **Question.** May the system hold religion, disability, medical details, and national ID? If so, for what lawful purpose, who may see them, and how long are they kept?
- **Today.** These fields are rejected.
- **Unblocks.** `REG-05` and `REG-06`, and national ID matching for duplicates.
- **Detail.** [REGISTRY.md](stage-3/REGISTRY.md) and [IDENTITY_CORRECTIONS.md](stage-3/IDENTITY_CORRECTIONS.md).
- **Decision.**

## Infrastructure and providers

### D-03 Hosting model (ADR-007)

- **Question.** On-premises, cloud, or hybrid?
- **Today.** Local development only.
- **Unblocks.**
  - staging and deployment;
  - backups in production (backup restore is rehearsed locally);
  - the rollback gate;
  - edge rate limiting for public transcript verification;
  - a hosted CI run.
- **Decision.**

### D-04 Identity provider (ADR-003)

- **Question.** Keep the built-in identity service (activation, sessions, TOTP MFA, recovery), or integrate an external identity provider?
- **Today.** The built-in service is used throughout.
- **Decision.**

### D-05 Document storage and malware scanner (ADR-004)

- **Question.** Which storage service and which malware scanner?
- **Today.** Files go to local development storage, and the scan-result API stands in for a real scanner.
- **Decision.**

### D-06 Email, SMS, and payment providers (ADR-005)

- **Question.** Which providers to use?
- **Today.**
  - Notifications go to a development outbox.
  - Payments are recorded and imported from statements, with no live gateway.
- **Decision.**

### D-07 Accounting boundary (ADR-009)

- **Question.** Is the student ledger the system of record, or does it feed an external accounting system? Who owns sponsor accounts, payment plans, provider feeds, and reconciliation sign-off?
- **Today.** There is a self-contained student ledger with billing, payments, adjustments, holds, opening balances, and control totals.
- **Decision.**

### D-08 Audit retention period (ADR-011)

- **Question.** How long is the audit trail kept, and where is it archived?
- **Today.** The audit trail is kept indefinitely in the main database.
- **Decision.**

### D-10 Production stack and architecture sign-off (ADR-001, ADR-006, ADR-010)

- **Question.** Should the following be approved for production?
  - the modular monolith design;
  - the dependency-light Node stack;
  - keeping the legacy PHP archive non-deployable and read-only.
- **Today.** Each is proposed and in use for development.
- **Decision.**

### D-11 LMS product and library scope

- **Question.** Which LMS product to use (for example Moodle)? Which classroom capabilities are needed (chat, online classes, recording, attendance)? Is library scope in or out (`LIB-01` to `LIB-06`)? Do existing learning materials need migrating?
- **Today.** The SVU side of the LMS boundary is built and connector-agnostic (ADR-008 accepted).
- **Detail.** [LMS_INTEGRATION.md](stage-6/LMS_INTEGRATION.md).
- **Decision.**

## Staff

### D-20 Staff and teaching ownership

- **Question.**
  - Approve the staff categories, grades, and employee-number format.
  - Is there a dedicated HR system, and which system is the source of truth for employment data?
  - Approve the allocation roles, workload units, and whether faculty approval is needed.
- **Today.** Staff records and teaching allocations work with sample values.
- **Detail.** [STAFF_RECORDS.md](stage-5/STAFF_RECORDS.md) and [TEACHING_ALLOCATION.md](stage-5/TEACHING_ALLOCATION.md).
- **Decision.**

## Cut-over and sign-off

### D-21 Legacy data migrations and control totals

- **Question.** For each area, supply an approved legacy export with source control totals, and approve the reconciliation:
  - admissions;
  - student records and study years;
  - results;
  - finance opening balances;
  - staff and allocations;
  - learning content.
- **Today.** Import, replay, and reconciliation tooling is verified on sample data only.
- **Detail.** [MIGRATION.md](stage-2/MIGRATION.md), [STUDENT_FINANCE.md](stage-4/STUDENT_FINANCE.md), and [STUDY_YEAR.md](stage-3/STUDY_YEAR.md).
- **Decision.**

### D-22 Phase and stage sign-offs

- **Question.** Each owner reviews and signs off their stage:
  - the Phase 1 sign-off pack (`docs/phase-1/PHASE1_SIGNOFF_PACK.generated.md`, from `npm.cmd run signoff:pack`);
  - the Stage 2 admissions pilot, run by the owner;
  - each later stage's exit gates.
- **Today.** Development pilots only. No stage is approved for production.
- **Decision.**

### D-23 Accessibility and browser support target

- **Question.** Which accessibility standard (for example WCAG 2.2 AA) and which browsers and devices must pass before production?
- **Today.** Automated Chromium tests run at desktop and mobile widths and check that pages do not scroll sideways.
- **Detail.** [BROWSER_QA.md](stage-2/BROWSER_QA.md).
- **Decision.**

## Examinations office

### D-24 Institution timezone

- **Question.** Which timezone is official for exam times, deadlines, and calendar windows? Africa/Harare (UTC+02:00) is assumed from the seeded addresses.
- **Today.**
  - Sitting times are stored as exact instants and entered with an explicit offset; the staff UI uses the browser's timezone.
  - Calendar windows are plain dates.
  - Tests run in Africa/Harare.
- **Suggested.** Africa/Harare as a configured institution setting, with all staff and student displays in that zone.
- **Decision.**

### D-25 Exam timetable publication rules

- **Question.**
  - Who may publish, and does a second person always need to publish?
  - What minimum notice must students have before a sitting?
  - Can a published timetable change close to the exam, and must students be notified of every change?
- **Today.**
  - An examinations officer or registrar publishes, and must not be the last editor.
  - Every publication notifies candidates.
  - There is no minimum notice.
- **Detail.** [EXAM_TIMETABLE.md](stage-7/EXAM_TIMETABLE.md).
- **Decision.**

### D-26 Exam venues, invigilators, and special arrangements

- **Question.**
  - Should venues be managed records with fixed capacities?
  - Are invigilators allocated in the system (`EXM-19`)?
  - How are individual arrangements recorded (extra time, separate room, assistive technology), and who may see them?
- **Today.** Optional managed venues provide fixed capacities, locations, revision/history and cross-period exclusive room checks; manual venues remain available. Scoped invigilator allocations enforce active staff, one lead and overlapping-duty checks, with independent timetable publication and personal published-duty calendars. Optional [candidate arrangements](stage-7/EXAM_ARRANGEMENTS.md) now provide encrypted private requests/reviews, independent approval, extra time, separate managed rooms with dedicated staff, personalised calendars and room-specific operational instructions. Generic timetables, audits and notices omit private case evidence. Extended published commitments remain reserved until changes are republished. Mandatory managed venues/staffing, staffing ratios, seating, entitlement rules, restricted evidence custody and retention remain undecided. Technical scheduling bounds are not an entitlement policy. See [EXAM_RESOURCES.md](stage-7/EXAM_RESOURCES.md).
- **Historical access.** Own and scoped staff case indexes retain discovery after cancellation or loss of current candidacy, without authorizing new requests or historical approvals. Private workspace state clears at logout, session expiry and student programme switch. These access controls do not settle evidence retention policy.
- **Candidate manifests.** Optional [published room manifests](stage-7/EXAM_MANIFESTS.md) freeze confirmed/assigned cohorts alongside timetable publication. Office access is scoped; active invigilators receive only their assigned rooms, without private evidence. CSV downloads recheck the published revision. Seat allocation, recorded attendance and archival-retention policy remain separate decisions/work; no seat or attendance result is inferred.
- **Candidate revision.** A scoped officer can prepare changed confirmed cohorts for independent republication without changing sitting details. Refresh is refused for changed sittings that have started; it does not settle minimum notice, seating or attendance policy. Legacy rosters are not reconstructed and deferred cohorts still use cancel/rebook.
- **Optional seating.** [Recorded seat plans](stage-7/EXAM_SEATING.md) pin manual labels to exact published room candidates. A different publisher reviews complete assignment or full withdrawal; timetable republication invalidates preceding seats. Assigned invigilators see only their rooms and students only their own seat. This does not approve mandatory seating, physical layouts, staffing, attendance certification or retention policy.
- **Publication history.** [Immutable editions](stage-7/EXAM_PUBLICATIONS.md) preserve new publications and the existing retained last snapshot, without reconstructing overwritten rosters. Current scoped office authority can read older timetables/manifests and exact published seating after republication/cancellation. Student/duties-only history access, legal hold/disposal, retention duration and institutional archive acceptance remain undecided/unimplemented; development history does not approve these policies.
- **Decision.**

### D-27 Exam ordering by lecturers

- **Question.** Must lecturers submit an exam order before the office schedules a sitting (`EXM-01`)? An order would cover the paper, duration, materials allowed, and special requirements. Who approves it?
- **Today.** Lead lecturers or scoped academic planners submit paper orders with a custody reference, duration, materials, and special requirements. An independent examinations officer approves or returns them. Approved orders link to sittings and pin the paper and duration. Where a paper has an order, scheduling must use it; papers without orders can still be scheduled directly. Optional [paper custody](stage-7/EXAM_PAPER_CUSTODY.md) now provides private PDF versions, scan evidence, independent version review, recipient-bound timed releases, declared copies/package references, recall and custody receipts. Mandatory ordering/storage requirements, actual scanner/object-storage and physical printing controls still need institutional decisions and production integration.
- **Detail.** [EXAM_ORDERS.md](stage-7/EXAM_ORDERS.md).
- **Decision.**

## Institutional Reporting

### D-28 Metric Ownership And Institutional Reporting Rules

- **Assessment workload.** [Staff recording operations](stage-8/ASSESSMENT_REPORTING.md) distinguishes approved-plan component coverage, active roster and retained outside-roster entries, ordered moderation, changed sources and recorded batch custody. Standing native staff permissions remain scoped; allocation-only teaching access does not expose intake-wide aggregates. These are not student assignment-upload events, business-hours SLA, period transfer eligibility or official results. Definitions, ownership, disclosure and production acceptance remain pending.

- **Private schedules.** [Delegated automatic report capture](stage-8/REPORT_SCHEDULES.md) now covers all ten native domains with fresh active-owner authority, UTC cadence, bounded retries and creator-private editions. This development implementation does not approve distribution, institutional metrics, statutory templates, retention/disposal policy or production worker operations.

- **Private editions.** [Retained report editions](stage-8/REPORT_EDITIONS.md) pin the original native report/definitions/CSV with encrypted creator-only custody and recheck all original source authority before read/download. Selected development verification is recorded. Explicit UTC expiry and terminal withdrawal are development access controls, not legal disposal, publication, institutional metric approval or approved retention durations. Sharing, approved scheduled distribution, disclosure and production acceptance remain open.
- **Continuation cohorts.** [Confirmed period comparison](stage-8/CONTINUATION_REPORTING.md) uses an explicit same-intake baseline/follow-up pair and retained programme-registration intersection. Follow-up-only records are excluded from its denominator; empty/future shares are null. Current lifecycle states do not rewrite confirmation membership. This development share is not an approved retention rate: historical entry census, registration deadlines, unique-person identity, maturity, disclosure and institutional denominator policy remain open.

- **Academic outcomes.** [Results, decisions and award reporting](stage-8/ACADEMIC_REPORTING.md) uses separate native domain scopes and null selection-wide totals when authority is incomplete. Current official marks are direct retained-attempt arithmetic samples, not GPA; retained approvals are not current eligibility, and conferrals are not unique-graduate or graduation-rate denominators. Source reconciliation, proposed ownership and fresh exports do not close institutional approval, comparability, census or disclosure gates.

- **Applicant campaigns.** [Operations reporting](stage-8/COMMUNICATION_REPORTING.md) preserves creator-only preview privacy, reconciles retained publication audience/recipient channels and historical affirmative preference revisions, and separates in-app read acknowledgements from queued/cancelled email. Captured opportunities are repeated-campaign counts, not unique/current applicants. Provider delivery evidence is unavailable; metric ownership, disclosure/distribution and retention remain approval-pending.

- **Student support.** [Operations reports](stage-8/SUPPORT_REPORTING.md) distinguish current cases, current owner accounts and captured programme records, with status/category/priority/public-reply controls and elapsed original-creation timing. Closed cases retain resolution timestamps; reopened cases lose current resolution samples, not earlier replies. Support ownership is proposed; institutional definitions, approved targets, sensitive/small-cell disclosure and distribution/retention remain open.

- **Question.** Who approves each institutional metric, formula, denominator, filter and refresh policy? Which statutory outputs and service-level measures are required? What small-cell disclosure, scheduled distribution and report-retention rules apply?
- **Today.** The [Stage 8 examination reporting foundation](stage-8/EXAMINATION_REPORTING.md) provides five versioned operational measures using current authorized periods and a consistent source snapshot, with separate status-partition and retained publication-origin controls that refuse inconsistent sources. The Examinations office is a proposed owner; definitions and CSV exports explicitly remain development/approval-pending. Scoped source counts and audited fresh exports do not authorize institutional/statutory reporting or external distribution. Returned orders are retained record counts, scheduled sittings include past times, and retained editions include cancellation publications; none is inferred as a candidate/attendance/headcount outcome.
- **Admissions.** [Operational admissions reports](stage-8/ADMISSIONS_REPORTING.md) define current application-record partitions, conversion/expiry subsets and existing policy-held capacity/transfer places with source reconciliation controls. Admissions office ownership remains proposed. These are not unique applicant, enrolled-student or statutory counts; capacity does not authorize an offer or invent a deferred destination application. Privacy/small-cell rules, institutional definitions, approved control totals and distribution/retention remain open.
- **Prospective enquiries.** [Operational enquiry reports](stage-8/ENQUIRY_REPORTING.md) add current status/consent/public-reply controls, non-additive distinct-account totals, separately authorized same-intake application associations and sample-based elapsed UTC timing. These are development definitions, not unique-person leads, causal conversion, provider delivery evidence or an approved business-hours SLA. Current consent-cycle response policy, small-cell disclosure and distribution/retention need approval; selected development verification is recorded.
- **Finance.** [Governed control totals](stage-8/FINANCE_REPORTING.md) define programme accounts (not unique students), currency-separated subledger measures, the existing recording/allocation cutoff (explicitly UTC), and a separately authorized current unmatched-import queue. Finance office ownership and institutional/accounting-close definitions remain unapproved. Accounting integration, business-date reporting, historical membership, disclosure, retained editions and schedules require separate decisions; fresh audited exports do not establish these approvals.
- **Registry/enrolment.** [Operational reports](stage-8/REGISTRY_REPORTING.md) distinguish current programme records from retained programme-period confirmations and course-enrolment records. Registry office ownership is proposed. Transfers, lifecycle changes and approved student merges do not erase retained records or authorize unique-student/active-enrolment census assumptions. Institutional term/census denominators, historical membership, progression/retention indicators, disclosure, statutory outputs and distribution still need approval.
- **Decision.**

## Student Support

### D-29 Support Ownership, Routing And Service Policy

- **Reporting.** [Student-support operations reporting](stage-8/SUPPORT_REPORTING.md) supplies current status/category/priority partitions, active workloads, distinct current owner accounts/captured programme records and elapsed first-public-reply/resolution samples. Reopening retains earlier replies but clears current resolution samples. These are development definitions, not unique-student headcount, approved business-hours targets or emergency-service promises. Metric approval, disclosure/distribution and service policy remain open.

- **Question.** Which office owns student support and approves categories, priorities, routing and escalation? What response/resolution targets, business calendar, after-hours/emergency handling, sensitive-case segregation and retention/legal-hold rules apply? Which notification channels and migration sources are approved?
- **Today.** [Development support cases](stage-8/SUPPORT_CASES.md) provide explicit scoped support roles, private student-programme custody, encrypted public/internal conversations, reasoned assignment/escalation, manager-controlled escalation resolution, revision history and retry guards. Retained timestamps are not an approved service-level formula. An urgent priority is not an emergency-service promise. Production ownership, taxonomy, targets, notification delivery/consent, attachments and retention/disposal remain unapproved.
- **Decision.**

## Applicant Communications

### D-32 Applicant Group-Message Consent And Sending Policy

- **Measurement.** [Campaign reports](stage-8/COMMUNICATION_REPORTING.md) provide private scoped workload and retained recipient reconciliation, not sending approval or evidence of provider delivery. Historical consent validates original captured eligibility, not current consent; email cancellations have no timestamp, so no cancellation-duration or historical opt-out timeline is inferred. Sending outcomes/retries, approved reporting denominators and retention/distribution still require decisions.

- **Question.** Which purposes, wording, sending roles and independent approval thresholds apply to optional applicant updates? How do required notices differ? What provider, opt-out, bounce/suppression, scheduling, retention and legal-hold rules apply?
- **Today.** The development [applicant communications workflow](stage-8/APPLICANT_COMMUNICATIONS.md) defaults optional in-app/email choices off, retains own-account preference revisions, binds scoped campaign previews to current source/consent, publishes in-app messages and queues encrypted email without claiming delivery. Optional email opt-out cancels unsent queued records; retained in-app history is not deleted. Existing required notices are unchanged. Development batch limits and technical locks do not approve institutional sending, consent wording, retention or provider delivery.
- **Decision.**

## Admissions Guidance

### D-33 Public Knowledge Ownership And Assisted Guidance Policy

- **Question.** Which office owns public admissions knowledge, approves source references and expiry/review cadence, and defines prospective enquiry routing, contact consent and retention? Which official WhatsApp number/provider and AI policy, citations, abstention, evaluation and human escalation safeguards are approved?
- **Today.** [Governed guidance](stage-8/ADMISSIONS_GUIDANCE.md) is a development publishing foundation: explicit programme/intake custody, immutable encrypted drafts, independent publication, effective dates, terminal withdrawal and public-only search. No fabricated approved corpus is seeded. A public source reference requires human review; this does not verify source policy automatically. [Prospective enquiries](stage-8/PROSPECTIVE_ENQUIRIES.md) add a development portal hand-off with verified-account ownership, explicit in-app reply consent, reasoned scoped assignment, manager escalation and terminal withdrawal; selected development verification is recorded. External channels and AI assistance remain unfinished. This does not authorize admission decisions, contact marketing, production retention or provider delivery.
- **Decision.**

### D-37 AI similarity checking of assignments

- **Question.** Under what terms may student assignment files be sent to GPTZero, and what is the institutional allowable AI similarity score?
- **Decided by the user (2026-10-12).** GPTZero is the provider. Above the threshold the student is warned and may still submit; lecturers see the score.
- **Still open.**
  - Data agreement with GPTZero, and the student notice or consent for sending work to it. Production stays `disabled` until this exists.
  - Default threshold. The system uses 20% unless `SVU_AI_CHECK_THRESHOLD` is set; lecturers can override it per assignment.
  - Whether the score is the `ai` probability alone (current) or `ai` plus `mixed`.
  - How a lecturer may use a score above the threshold: prompt for review only, or as evidence in academic-integrity cases. Scores are estimates and vary between runs.
  - Retention period for check records, and whether students may appeal a recorded score.
  - The daily check limit per student per assignment (currently 10).
- **Today.** Built and verified with a simulated provider in development; disabled by default. See [AI_SIMILARITY_CHECK.md](AI_SIMILARITY_CHECK.md).
- **Decision.**

### D-38 Claude-assisted features

- **Question.** May submissions, support conversations, applicant documents and students' published records be sent to Anthropic's API for the five assistive features, and how are students, applicants and staff told?
- **Still open.**
  - Data processing terms with Anthropic and the retention setting for the organisation's API account.
  - Notice to students and applicants (privacy statement wording) and whether any feature needs opt-in.
  - Whether feedback drafts may include the submission file, or only the brief, mark and notes.
  - Monthly cost ceiling and who owns the API key.
  - Which features to enable first; each can be judged separately.
- **Today.** Built and verified with a simulated provider; disabled by default; every result is reviewed by a person and nothing is written to records. See [AI_ASSIST.md](AI_ASSIST.md).
- **Decision.**

### D-39 Early-warning rules

- **Question.** Which signals should flag a student, at what thresholds, who sees the list, and what action is expected?
- **Today.** Advisory, rules-based, no AI: two or more missed assignments in 60 days, released coursework average below 50%, financial hold, support case waiting on the student, or not registered for an open period. Visible to `registry.view` within scope; viewing is audited. See [AI_ASSIST.md](AI_ASSIST.md).
- **Still open.** Thresholds, whether students are told they were flagged, retention of any follow-up notes, and whether advisers (not only registry staff) should see it.
- **Decision.**

### D-40 Automated reminders

- **Question.** When should reminders go out, may people opt out, and which channels are used?
- **Today.** Fixed timings: deadlines 48 h and 24 h before; missing-work alerts within 7 days after; offers 7 and 2 days before expiry; fees 7 days before due; support 3 days waiting on the student and 5 days without a staff update; staff digest on Mondays (UTC). Everything goes to the Inbox, and by email when delivery is configured. See [AUTOMATIONS.md](AUTOMATIONS.md). Since 2026-10-12 people can mute six optional groups in Settings ([NOTIFICATION_PREFERENCES.md](NOTIFICATION_PREFERENCES.md)); push to devices and opt-in SMS for urgent notices are built and off by default (D-45).
- **Still open.**
  - The timings above, and whether lecturers may change them per assignment.
  - Which messages are essential (receipts, holds, offer expiry) and which may be muted (deadline reminders, digest).
  - Whether fee and hold notices may be emailed, or should stay in the Inbox.
  - Whether a sponsor or parent with shared access also receives fee reminders (see D-35 and student sharing).
  - SMS, once a provider is chosen (D-06).
- **Decision.**

### D-41 Ask SVU in-app help guide

- **Question.** Who may use Ask SVU, what may it know, what is kept, and where may it link?
- **Today.** Built as phase 1 (see [ASK_SVU.md](ASK_SVU.md)): available to visitors and signed-in people whenever AI assistance is on; answers only from a curated list of portal pages (filtered by the asker's permissions) and published guidance; cannot see records or act. Visitors 10 questions an hour per connection, signed-in people 30 an hour. Questions and answers are not stored on the server; signed-in use and thumbs up/down are audited without content. No external links (the approved list is empty). Phase 2 (personal answers from a read-only summary of the person's own dates, fees and work) is built behind `SVU_ASK_SVU_PERSONAL`, off by default, pending this decision.
- **Still open.**
  - Whether visitors (prospective students) should have it, or only signed-in people.
  - Phase 2: may it read the person's own records (deadlines, holds, balances, application status) through read-only lookups, after a privacy review? Ties to D-38 disclosure.
  - Whether to keep question text (anonymised) to find missing guidance articles, and for how long.
  - The approved list of external sites (university website, library, payment pages) and who maintains it.
  - Hand-off: should "Open a request" carry the conversation into a support case (phase 3)?
- **Decision.**

### D-42 Self-service letters and the digital ID card

- **Question.** May students issue official letters themselves, in what wording, and will the digital card be accepted as ID?
- **Today.** Built ([STUDENT_LETTERS.md](STUDENT_LETTERS.md), [STUDENT_CARD.md](STUDENT_CARD.md)): confirmation of enrolment and proof of registration with verification codes; a digital card with a 15-minute signed QR and initials instead of a photo.
- **Still open.** Approved wording, letterhead and signature; whether a photo is added (source, consent, retention); whether the library, exam halls and security accept the digital card; other letter types.
- **Decision.**

### D-43 Course evaluations

- **Question.** Which questions, what minimum before results show, and who may read comments?
- **Today.** Built ([COURSE_EVALUATIONS.md](COURSE_EVALUATIONS.md)): five fixed ratings plus two comments, results hidden under 5 responses, visible to the course's lecturers and evaluation managers, comments unmoderated.
- **Still open.** Question set and versioning, threshold, whether heads of department see comments, moderation of abusive comments, whether participation is encouraged with reminders, exports for quality reports.
- **Decision.**

### D-44 Online fee payments

- **Question.** Which provider, which currencies and channels, and how Finance reconciles and refunds.
- **Today.** Built and off by default ([ONLINE_PAYMENTS.md](ONLINE_PAYMENTS.md)): Paynow adapter (not yet tested against Paynow), simulated provider for development; confirmed payments post through the normal payment path with method `online`.
- **Still open.** Provider contract and sandbox test; USD and ZWG handling; who bears transaction charges; daily reconciliation against the provider's settlement report; refunds; a Finance view of failed or mismatched intents.
- **Decision.**

### D-45 Text messages

- **Question.** Which provider (see D-06), which notices justify a text, the cost, and the consent wording.
- **Today.** Built and off by default ([SMS_NOTIFICATIONS.md](SMS_NOTIFICATIONS.md)): opt-in with a verified number, five urgent message types, at most five a day; Africa's Talking adapter (untested) and a development simulation.
- **Still open.** Provider and sender ID; budget; the message list; consent text; whether staff can text a student directly.
- **Decision.**

### D-46 Class attendance

- **Question.** What attendance is used for, and for how long it is kept.
- **Today.** Built ([ATTENDANCE.md](ATTENDANCE.md)): rotating QR or typed code; manual marks by the lecturer; low attendance (below 75% of at least four sessions in 60 days) appears in the early-warning list only.
- **Still open.** Whether attendance affects eligibility for assessments; the threshold; retention; exceptions (medical, religious, disability arrangements); register exports.
- **Decision.**

## Decided

| ID | Decision | Date | By |
| --- | --- | --- | --- |
| ADR-002 | PostgreSQL with SQL migrations | Phase 1 | IT/DBA |
| ADR-008 | Integrate a dedicated LMS; SVU stays the source of truth | 2026-10-04 | Project owner |
