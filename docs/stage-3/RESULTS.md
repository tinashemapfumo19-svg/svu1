# Verified Results Pilot

## Scope

Migration 029 adds reconciled final-course result batches, independent evidence-backed review, controlled publication, immutable enrolment/result snapshots, and owner-only student result/GPA views. This provides the results foundation needed by Stage 3; it does not complete the Stage 7 assessment-to-award lifecycle or authorize production results.

The pilot imports whole-number final marks, not assessment components. Lecturer submission, department/faculty moderation stages, missing-mark queues, supplementary/deferred sittings, approved amendments, transcripts, and awards remain separate work. Imported sample marks are synthetic and not institutional results.

## Workflow

1. Complete onboarding and course registration, then close the registration period. The confirmed course-enrolment roster is the source of permissible result identifiers and credit snapshots.
2. Publish a grading scheme and GPA rule set using the existing maker-checker master-data APIs. Both must be effective on the academic period's start date; worked examples are mandatory for GPA policy publication.
3. In `#registry`, select a student programme and use Results / Import results. Download roster produces an incomplete JSON skeleton with `null` marks, not passing defaults.
4. Obtain an approved source export with independent row-count/mark-total/checksum controls. Upload it with the pinned GPA policy and import reason. Every confirmed course enrolment in this intake/period must appear exactly once; missing, duplicate, foreign, fractional, and out-of-range marks fail closed.
5. A different account with scoped results-review authority records an evidence reference and a reasoned review or rejection. The importer cannot approve their own batch, including when they have administrator authority.
6. A different account from the importer, with publication authority, releases the reviewed batch during the academic calendar's current UTC `results_publication` window. Reviewer and publisher may be the same person; this is two-person control, not three-person approval.
7. Students see only published results belonging to their programme. Draft/reviewed/rejected batches, other students' marks, and staff review evidence are not returned by self-service. GPA/classification use the retained grading and GPA snapshots.

Approval and first publication now enforce [native source and review custody](../stage-7/RESULT_SOURCE_CUSTODY.md): recomputed counts/totals/checksum must match the import receipt, retained grade/course/student enrichments must reproduce under the effective pinned policy, and publication requires the actual independent review receipt. Rejection keeps its existing recovery path. The period/calendar/batch locks and result uniqueness constraints make concurrent publication retries return the original published batch with one publication audit event. Published results cannot be edited or rejected. Later grading-policy changes do not rewrite existing results or GPA; already-published retries do not rerun pre-publication source checks.

Rejected batches retain their source, checksum, marks, actor, reason, and evidence. A corrected export needs a new source reference; it never overwrites the rejected batch. Source replay is rejected, and only one non-rejected batch is allowed per period.

## Export Contract

The uploaded JSON contains:

| Field | Meaning |
| --- | --- |
| `sourceRef` | Unique nonblank source-export reference, maximum 200 characters. |
| `rows` | 1-5000 objects containing exactly `registrationId`, `courseId`, and integer `mark` from 0-100. |
| `expectedRowCount` | Independently supplied source record count. |
| `expectedMarkTotal` | Independently supplied sum of source marks. |
| `checksum` | SHA-256 of canonical result rows. |

`resultsChecksum` in `server/modules/results.js` canonicalizes each row to `{registrationId, courseId, mark}`, sorts by registration/course identifiers, and hashes UTF-8 `JSON.stringify` output. Row order does not affect the checksum. Checksums prove integrity against supplied controls, not source authenticity; independent review and approved source custody remain required. API imports also supply `gpaRuleSetId` and `reason`; the UI adds these form values without recalculating the source controls. API and UI uploads are limited to 2 MB.

Validate without importing:

```powershell
npm.cmd run results:validate -- approved-results.json
```

Generate a clearly labelled synthetic sample from a downloaded roster (stdout only; never a production export):

```powershell
node scripts/results-export.js results-roster.json --sample
```

The sample alternates marks 75/50 and supplies matching controls. No production data is imported by this command.

## Authority And API

`academic_registrar` can view/import results, but cannot review/publish by that role alone. `examinations_officer` can view/review/publish, not import. Administrators have all permissions but cannot approve their own import. Every operation checks programme/intake scope using only roles granting its authorizing permission. Finance and unrelated global auditor grants cannot widen results authority.

| Endpoint | Permission |
| --- | --- |
| `GET /api/registry/me/programmes/{id}/results` | `registry.self`, plus ownership. |
| `GET /api/registry/programmes/{id}/results` | `results.view`. |
| `POST /api/registry/programmes/{id}/results/{periodId}/batches` | `results.import`. |
| `POST /api/registry/programmes/{id}/results/{periodId}/batches/{batchId}/review` | `results.review`; `outcome` reviewed/rejected, `reason`, `evidenceRef`. |
| `POST /api/registry/programmes/{id}/results/{periodId}/batches/{batchId}/publish` | `results.publish`; `reason`. |

The staff endpoint returns scoped roster/batch context and caller-specific capabilities. It deliberately excludes private contact/next-of-kin data. Audit events retain control totals and decision evidence, not raw marks.

## Verification

The initial results baseline was verified on 2026-10-02 with 53 unit tests, all 12 desktop/mobile Chromium browser tests, and all 22 smoke checks. Subsequent academic/exception/lifecycle/recognition extensions passed the full suite with 76 unit tests, 16 browser tests, and 22 smoke checks; see [recognition evidence](CREDIT_RECOGNITION.md). Final focused recognition journeys also verified that transferred credit never invents published results or GPA. Temporary databases were dropped and test servers stopped. Migration 029 and subsequent migrations were applied locally without reseeding existing data. The current development server is healthy at `http://127.0.0.1:4182/#registry`.

Browser coverage includes downloadable blank rosters and sample generation, count/checksum and missing-roster rejection, source replay, retained rejected batches, draft/reviewed privacy, wrong scope and ownership, importer self-approval rejection, independent review/publication, concurrent exactly-once publication/audit, and student results/GPA after reload. Both focused desktop/mobile journeys also passed after the final table-heading/status spacing correction; their temporary database was removed. Student/reviewer screenshots were visually inspected and horizontal-overflow checks passed.

Playwright filters can be forwarded after `--` when checking a focused layout change against a fresh isolated database:

```powershell
node scripts/integration.js --browser -- --grep "applicant submits, staff reviews"
```

## Next Work

1. Obtain approved institutional policies for the delivered [results-backed prerequisite/progression/repeat pilot](ACADEMIC_PROGRESS.md); synthetic policies are not production authority.
2. Extend the delivered [credit/timetable exception foundation](EXCEPTIONS.md), [one-to-one credit recognition](CREDIT_RECOGNITION.md), and [programme/intake/curriculum transfers](PROGRAMME_TRANSFERS.md) with approved wider policies, institutional transfer cases, and many-to-many credit allocation. Staff results periods now enforce the pinned curriculum as well as intake; final verification is recorded in the transfer contract.
3. Add formal result amendments with retained originals and independent approval before supporting corrected published results.
4. Complete assessment provenance/moderation, student publication notifications, official documents, real finance integration, approved migration reconciliation, broader accessibility/browser QA, and owner sign-off.
