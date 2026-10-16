# Stage 3 Registry: Student Record and Onboarding

[Stage 8 operational registry/enrolment reporting](../stage-8/REGISTRY_REPORTING.md) adds governed aggregate counts without redefining student identity, onboarding or registration eligibility. Programme/period records are not institutional student headcounts.

## Delivered Slice

Stage 3 development has begun without waiving the outstanding Stage 2 production migration and owner-approval gates. This slice is suitable for a development pilot, not an authoritative production registry sign-off.

| Inventory | Coverage |
| --- | --- |
| REG-01, REG-02 | Accepted-offer conversion retains the institutional student number and creates a pending-onboarding programme record. |
| REG-03 | Resumable contact and emergency-contact form followed by a reasoned registrar approval. Full registration remains pending. |
| REG-04 | Existing admissions identity stays linked; student phone/address updates are versioned. Legal/preferred name, date of birth, and nationality change only through [independently reviewed identity corrections](IDENTITY_CORRECTIONS.md). National ID capture remains a pending privacy decision. |
| REG-05, REG-06 | Restricted religion, disability, and medical fields are rejected, pending privacy and lawful-purpose decisions. |
| REG-07 | Owner-only next-of-kin name, relationship, and international phone; required for onboarding approval. |
| REG-08 | Own student profile reads/updates with optimistic revision checks and retained snapshots. Email and identity changes remain separate governed work. |
| REG-09 | Pending-onboarding/onboarded plus independently approved suspension, interruption, withdrawal, and re-entry with append-only status history. Completion/awards remain pending. |
| REG-10 | Scoped number/name search, status/intake API filters, pagination, registrar detail view, and [reviewed duplicate detection, merge, and distinct confirmation](DUPLICATE_RESOLUTION.md); broader advanced queries pending. |
| REG-11, REG-13 | Programme version, faculty, department, intake, conversion date, and admissions study mode remain linked and visible. |
| REG-12 | Independent expiring/revocable credit-load and exact timetable-pair exceptions; reasoned suspension/re-entry lifecycle. Finance/deadline/prerequisite exceptions remain pending. |
| REG-14, REG-17 | Policy-backed independent progression approvals and receipt-backed effective programme study-year state, dated enrolment/history, and upcoming periods; institutional corrections and legacy reconciliation remain gated. |
| REG-15 | Published-result prerequisites, explained course/calendar eligibility, and separate revision-bound clearances; real finance integration remains pending. |
| REG-16 | Published-result and policy-backed independent repeat/retake approval foundation; institutional policy approval remains gated. |

## Behaviour

- `#apply` displays student onboarding after an accepted offer. Saving uses `revision`; stale revisions return `409` instead of overwriting another edit.
- Draft saves can omit next-of-kin, but approval requires a complete phone, address, and emergency contact. The UI asks for all fields.
- Countries must be active and effective in the governed country reference list. Relationships are `parent`, `spouse`, `sibling`, `guardian`, or `other`.
- `#registry` provides independent registrar sign-in, including MFA enrolment/verification/cancellation/recovery. Admissions also links to registry for mobile access.
- General staff search and detail do not expose next-of-kin values. They expose readiness, rather than private profile contents. Restricted fields cannot be supplied through the self-service API.
- Approval requires `identityConfirmed: true`, a reason, permission, and programme/intake scope. It atomically records status history, changes the programme to `onboarded`, completes the linked open onboarding task, and writes an audit event. Repeated approval returns `409` and creates no new history.
- Onboarding itself does not confirm courses, waive fees, resolve financial/academic eligibility, or open class enrolments. `onboarded` is not `registered`. The separate [course-registration slice](REGISTRATION.md) now provides period-based selection, explicit clearances, confirmation, and course enrolment records.
- Profile history snapshots remain private database records; audit metadata contains only the revision, not contact values. Original accepted-offer conversion is retained in programme status history, including backfilled records.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/me` | `registry.self` | Own student record, profile, programmes, and readiness; `404` if no converted record exists. |
| `PUT /api/registry/me` | `registry.self` | Save `revision`, `phone`, `address`, `nextOfKin`; unknown/restricted fields are rejected. |
| `GET /api/registry/students?q=&status=&intakeId=&limit=&offset=` | `registry.view` | Scope-filtered programme records and authorized total; limit 1-100, default 50. |
| `GET /api/registry/programmes/{id}` | `registry.view` | Scoped programme context, status history, and readiness without private next-of-kin. |
| `POST /api/registry/programmes/{id}/approve` | `registry.onboard` | Approve pending onboarding with identity confirmation and reason. |

`student` grants self-service; `academic_registrar` and `system_administrator` grant registry viewing and approval. Only roles granting the specific authorizing permission contribute their scope. An unrelated global auditor role cannot widen a scoped registrar's authority.

## Verification

Verified on 2026-10-02: the latest full isolated integration passed with 86 unit tests, 18 desktop/mobile Chromium browser tests, and all 22 smoke checks, including registration, results, academic decisions, governed exceptions, lifecycle, credit recognition, programme transfers, and effective study-year tracking. Database `svu_rebuild_it_1790972834122` was dropped and test servers stopped. Refreshed desktop/mobile academic and transfer layouts were inspected. Migrations 026-034 were applied locally without reseeding; study-year tracking needs no additional schema migration or receipt rewrite. The refreshed server is healthy at `http://127.0.0.1:4182/#registry`. See [study-year verification](STUDY_YEAR.md) and [transfer verification](PROGRAMME_TRANSFERS.md) for evidence and production gates.

Unit coverage validates draft completeness, phone/address/relationship data, revisions, and rejection of restricted fields. The desktop/mobile applicant-to-student browser journey extends through the student form and registrar approval, including unauthenticated/unauthorized access, wrong-scope registrar plus global auditor, stale updates, private-field exclusion, retained status history, and repeated approval. Separate registrar MFA browser checks cover enrolment, invalid codes, cancellation with token revocation, authenticator verification, recovery-code consumption, and reuse rejection.

Run `npm.cmd run test:integration` for isolated migrations, seed, units, browser journeys, and all smoke checks. The local database can be updated with `npm.cmd run migrate` without reseeding.

## Next Registry Work

1. Duplicate-account consolidation and un-merge (see [duplicate resolution](DUPLICATE_RESOLUTION.md)), evidence-document links and decision notifications for [identity corrections](IDENTITY_CORRECTIONS.md), programme attributes, and consent/privacy decisions.
2. Extend delivered [credit recognition](CREDIT_RECOGNITION.md) and [programme/intake/curriculum transfers](PROGRAMME_TRANSFERS.md) with approved institutional cases, many-to-many credit allocation, scheduled/backdated corrections, and governed capacity release. Independent one-to-one transfer/exemption awards support core/prerequisite/progression credit without invented GPA. Programme transfers create linked records with preserved history; their verification checkpoint is recorded separately. Institutional policy, automatic credit mapping, and production sign-off are not inferred from a transfer decision.
3. Ledger-backed financial holds now block registration ([student finance](../stage-4/STUDENT_FINANCE.md)); provider feeds, adjustments, and finance-approved hold policy remain.
4. Extend [governed registration exceptions](EXCEPTIONS.md) and [programme lifecycle](LIFECYCLE.md) with approved policy cases, deadline/prerequisite/progression exceptions, course withdrawal/access treatment, notifications, and completion/awards. Finance exceptions require their own authority and ledger integration.
5. Approved source migration, reconciliation, and registry owner sign-off before production authority is claimed.
