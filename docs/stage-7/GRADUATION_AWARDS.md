# Stage 7 Graduation Audit and Awards

## Delivered Slice

Each curriculum (programme version) can have versioned completion rules: minimum credits, minimum elective credits, minimum cumulative GPA, the award title, and the GPA policy to use. A registrar drafts them and an independent approver publishes them. A graduation audit checks a student's official record against the published rules. When the audit is met, a registrar requests the award against the audit they reviewed, and a different approver confers it. Conferral completes the programme with retained history, notifies the student, and turns the transcript into a final transcript showing the award.

This covers the roadmap items "graduation audit against curriculum and institutional requirements" and "award approval record", and the completion record that `EXM-18` certificates depend on. It is a development pilot: the rule values and conferral authority need Senate approval (D-12 and D-30 in [OUTSTANDING_DECISIONS.md](../OUTSTANDING_DECISIONS.md)).

## Behaviour

- **Completion rules.**
  - Drafting needs `academic.policy.manage` and publishing needs `academic.policy.publish`, the same permissions as academic policies.
  - There is one draft and one published version per curriculum. Publishing a new version supersedes the old one.
  - The publisher must not be the drafter.
  - The GPA policy must be published, and the GPA minimum cannot exceed the scheme's maximum points.
  - The elective minimum cannot exceed the total.
- **Graduation audit**, from the official record only. Each check reports whether it is met and why.
  - **Courses.** A curriculum course is satisfied by a passing latest attempt (published results, including approved amendments). Approved recognized credit also satisfies a course, but only if the course was never attempted here, so credit cannot mask a failed or missing result.
  - **Credits.** Earned credits and elective credits count satisfied curriculum courses only.
  - **GPA.** The cumulative GPA covers every official attempt under the rules' GPA policy, with attempts numbered per course so its retake rule applies. The classification comes from that grading scheme.
  - **Checks:** the programme is active (`onboarded`), every core course is satisfied, the credit minimum is met, the elective minimum is met, and the GPA minimum is met.
  - The audit's evidence hash binds the rules version, the programme status revision, and the full audit.
- **Award request** (`registry.award.request`).
  - The request needs the evidence hash the requester reviewed, a real calendar date for conferral (impossible dates such as `2026-02-30` are refused), and a reason.
  - It is refused when rules are missing, the audit is not met, or the audit has changed.
  - There is at most one open request and one conferred award per programme, enforced by unique indexes.
  - The request stores the audit, award title, and classification.
- **Conferral** (`registry.award.approve`).
  - The approver must be someone other than the requester.
  - Approval re-runs the audit. The rules must still be the published version and the evidence unchanged; otherwise the request must be rejected and requested again.
  - On approval, the programme becomes `completed`, a history row linked to the request is added, and the student receives a `registry.award` email.
  - A completed programme no longer passes the audit's status check, so no second award can be requested.
  - Award requests cannot be deleted.
- **Transcripts.** Once an award is conferred, the transcript content gains an `award` section and the document is titled "Academic transcript (final)". Content without an award is unchanged, so earlier transcript hashes stay valid. Any issued transcript becomes outdated, because the programme status changed.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/programmes/{id}/award` | `registry.view`, `academic.view`, or an award permission (scoped) | Rules (published, draft, history), the audit with its evidence hash, requests, the award, and capabilities. |
| `POST /api/registry/programmes/{id}/award/rules` | `academic.policy.manage` | `rules` (`minCredits`, `minElectiveCredits`, `minCumulativeGpa`, `awardTitle`), `gpaRuleSetId`, `reason`. |
| `POST /api/registry/programmes/{id}/award/rules/{ruleId}/publish` | `academic.policy.publish` | `reason`. |
| `POST /api/registry/programmes/{id}/award/requests` | `registry.award.request` | `evidenceHash`, `conferredOn`, `reason`. |
| `POST /api/registry/programmes/{id}/award/requests/{requestId}/review` | `registry.award.approve` | `outcome` `approved`/`rejected`, `reason`. |
| `GET /api/registry/me/programmes/{id}/award` | `registry.self` (own) | The audit checks and courses, and the conferred award. |

Permissions:
- `academic_registrar` drafts rules and requests awards.
- `academic_approver` publishes rules and confers awards.
- `system_administrator` holds all of these, but still cannot approve its own drafts or requests.

## Interface

- **Staff (`#registry`).** The student detail has a **Graduation and award** panel with:
  - the published rules, plus draft and publish forms;
  - the audit checklist with met and not-met markers;
  - the curriculum course table with outcomes;
  - the request form (only when the audit is met), and request decisions.
- **Students (`#apply`).** A **Graduation progress** section shows the checklist and courses, or the conferred award.
- **Transcripts.** The final transcript shows an **Award** section.

## Verification

Migration `049_graduation_awards.sql`, and the `registry.award` notification template. Unit tests in `test/awards.test.js` cover rule bounds, course satisfaction (a failed retake versus credit for a never-attempted course), the latest-attempt GPA, eligibility and classification, status gating, hash determinism, and real calendar dates. The desktop and mobile journey is in `e2e/graduation-awards.spec.js`. It covers:

- a request refused before rules exist;
- UI drafting, with self-publication, a second draft, and invalid rules refused;
- independent publication;
- the audit for passing and failing students;
- requests refused when ineligible, unreviewed, for an impossible date, or without authority;
- a UI request, then duplicate and self-review refusals;
- UI conferral by the approver, then repeat review and post-conferral requests refused;
- completed status and history, the notification, and the transcript gaining the award;
- issue and verification of the final transcript;
- the audit trail;
- the student portal's award and final transcript;
- owner-only student access;
- no horizontal overflow.

## Remaining Work

- Senate approval of rule values and conferral authority (D-12 and D-30), including whether financial holds or disciplinary cases block conferral.
- Degree certificates (`EXM-18`) through the document service, with verification like transcripts.
- Ceremony and graduation lists, award revocation and reissue, and posthumous or aegrotat awards.
- Programme-level rules beyond the current ones: year-by-year minimums, maximum registration period, or required named electives.
