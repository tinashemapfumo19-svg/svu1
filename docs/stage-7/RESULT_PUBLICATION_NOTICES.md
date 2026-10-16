# Result Publication Notices

Guide Stage 7: controlled publication and student notification. This implements the native queue boundary; it does not establish real email/provider delivery, approved institutional wording or production readiness.

## Publication Transaction

First publication still requires existing permission-specific authority, independent import/review custody, effective pinned policies, complete roster and current publication window. After inserting official results, it resolves recipients from the native official-row/enrolment/confirmed-registration/student-programme/student joins, scoped to this exact batch and period. Student-programme and enrolment student IDs must agree. Every original registration/course tuple, programme record and student number must match the authorized published source, with exactly one account binding per tuple. Missing, extra, duplicate or mismatched recipient custody returns409 without partial publication.

Multiple course/programme tuples for the same account produce one `results.published` notice. All notices, official rows, published status and the publication audit commit in the same transaction. An inactive/missing active template or any queue insert failure rolls everything back, including notices already inserted for earlier recipients. The existing period/batch lock and published-status retry gate ensure concurrent/repeated publication requests cannot create extra notices. A retry after a later approved amendment also returns the original publication without requeuing or reverting amended outcomes.

Publication audit metadata adds `queuedNotices`: distinct account notices committed to the native queue, not actual email delivery. It adds no recipient IDs, addresses or marks to that metadata.

## Privacy And Templates

The version1 message is static:

- Subject: `Your results are available`
- Body: `New results are available in your student portal. Sign in to view your official results.`

There are no marks, grades, GPA, names, student numbers, course/programme/intake/period labels, batch/source IDs, private links or access tokens in its payload. No personal variables or explicit recipient email are passed. Authentication and ownership remain necessary to view the actual results. Notification queue custody still stores the recipient account ID in its existing protected column.

Additive migration077 installs only this new template; the canonical loader/isolated development seed contains the identical version. No working database reseed or broad reference reload is needed. Publication opts into active-only email template selection, choosing the latest active version rather than a higher draft. Existing notification callers retain their prior default selection. Template availability errors do not suggest that reloading references would activate an intentionally inactive template. Operational `active` is not institutional wording/provider/owner approval; those remain production gates.

These notices are non-sensitive generic availability messages and cause no mail-catcher file or external dispatch. Queued, delivered and read are distinct states. Approved delivery, address changes/account suspension rules, provider retries/monitoring and real inbox acceptance remain separate integration work. Existing amendment notifications remain a different event and are not duplicated by publication retries.

## Verification

Recovery checkpoint passes all twelve selected desktop/mobile journeys, units and22smokes with unchanged366-file source fingerprint and independently verified teardown. The initial joined-query ambiguity remains failed provenance; only notification column qualification was repaired. Sole pending077 was then applied locally without reseeding. Exact checkpoint scope, logs, source digest and runtime checks are recorded in BUILD_VERIFICATION; actual delivery and owner approval remain open.

Six focused tests cover verified recipient deduplication, malformed/mismatched custody, static migration/loader wording, active-only payload selection, unavailable template refusal and unchanged legacy default. Native direct-result checks cover two courses/one account and concurrent publication yielding one generic queued notice. Two-student amendment checks cover no active template, ignored higher draft version, controlled failure on the second notification insert with zero committed publication/notice/audit rows, genuine concurrent publication producing two notices, and retry after amendment producing no extra release notices. LMS/mixed/deferred result paths must pass separately in the selected checkpoint recorded in [BUILD_VERIFICATION.md](../BUILD_VERIFICATION.md).
