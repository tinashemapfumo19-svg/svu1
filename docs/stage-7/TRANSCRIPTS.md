# Stage 7 Transcripts and Verification

## Delivered Slice

Registrars can issue a progressive transcript for a student programme. It is an immutable snapshot of the official record, bound by a content hash and a random verification code. Anyone holding the document can check it publicly. Issuing again supersedes the previous transcript, and a transcript can be revoked with a reason. Every issued version is kept.

This covers `EXM-16` (progressive transcript) and `RPT-10` (public authenticity verification). It also closes the result-amendments gap where an issued document could not be marked out of date. It is a development pilot: the transcript layout, wording, and issuance policy need registry-owner approval, and output is a printable page rather than a document-service PDF.

## Behaviour

- **Content.** Built from the official record only:
  - published results from `academic_results`, including approved amendments, which are marked `*`;
  - approved recognized credit.

  For each term the transcript shows course, title, credits, mark, and grade, plus the term GPA under the policy the results were published with, and credits passed and attempted. Terms are in chronological order.
- **Summary.**
  - The cumulative GPA uses the latest term's policy. Attempts are numbered per course, so that policy's retake rule applies.
  - Credits passed count each passed course once.
  - Recognized credit is listed and counted as earned but never enters a GPA. It is omitted once the course has been passed at SVU.
- **Hash.** The content carries no dates of its own making, so the same record always produces the same hash. Any change to the record (an amendment, a newly published term, or a credit decision) changes it.
- **Issue** (`registry.transcript.issue`, scoped).
  - The issuer sends the hash of the record they reviewed. If the record has changed since, the request is refused (`409`), so nothing unseen is certified.
  - Refused when there are no published results and no recognized credit.
  - Each transcript gets a 16-character code from a 32-symbol alphabet without `0/O` or `1/I` (80 random bits), shown as `XXXX-XXXX-XXXX-XXXX`.
  - Issuing again marks the previous transcript `superseded` and links it to its replacement. At most one transcript per programme is current.
- **Immutability.**
  - A database trigger forbids deletes and any change to content, hash, code, or issue facts.
  - Status can only move forward from `issued`. Only the current transcript can be revoked.
  - A later amendment does not change an issued transcript. Staff and student views show it as outdated, and a new one must be issued.
- **Verification** (public, no account).
  - `GET /api/verify/transcripts/{code}` accepts the code in any case, with or without separators.
  - It returns the status (`issued`, `superseded`, or `revoked`), the issue, supersession, and revocation dates, the holder's name and student number, the programme, the summary, term-level GPA and credits, and the content hash.
  - It never returns course-level marks or internal identifiers.
  - Unknown or malformed codes return `404`.
- **Students** see every transcript issued for their programme, with its status and an outdated notice. They can open and print each one. Superseded and revoked documents carry a banner.

## API

| Endpoint | Permission | Behaviour |
| --- | --- | --- |
| `GET /api/registry/programmes/{id}/transcripts` | `results.view` (scoped) | Current record content and hash, issued transcripts with `outdated`, and capabilities. |
| `POST /api/registry/programmes/{id}/transcripts` | `registry.transcript.issue` | `expectedHash`, `reason`. |
| `POST /api/registry/programmes/{id}/transcripts/{transcriptId}/revoke` | `registry.transcript.issue` | `reason`. |
| `GET /api/registry/me/programmes/{id}/transcripts` | `registry.self` (own programme) | Issued transcripts with content. |
| `GET /api/verify/transcripts/{code}` | Public | Verification summary. |

`academic_registrar` and `system_administrator` hold `registry.transcript.issue`. Examinations officers can view but not issue.

## Interface

- **Staff (`#registry`).** The student detail has a **Transcripts** panel with:
  - a preview of the current record, watermarked as not an issued transcript;
  - an issue form (it becomes "Issue updated transcript" once one exists);
  - the issued history with view and revoke actions;
  - a notice when the current transcript no longer matches the record.
- **Students (`#apply`).** The portal lists their transcripts.
- **Public (`#verify` or `#verify/{code}`).** The verification page needs no sign-in.
- **Printing.** "Print or save as PDF" prints only the selected document, using a print stylesheet.

## Verification

Migration `047_transcripts.sql`. Unit tests in `test/transcripts.test.js` cover term ordering and per-term policies, cumulative retake handling, recognized-credit treatment, hash stability, and verification code format and normalisation. The desktop and mobile journey is in `e2e/transcripts.spec.js`. It covers:

- UI preview and issue;
- refusals for issuing without authority, a student calling the staff endpoint, another student's programme, an unreviewed or stale hash, and unknown fields;
- public verification with a typed code, no course detail, and unknown or malformed codes;
- an approved amendment leaving the issued transcript unchanged but outdated, then the UI reissue superseding it with a new code;
- UI revocation, repeat and superseded revocation refused, and the audit trail;
- the public page showing superseded, revoked, and unknown codes;
- the student portal listing, banners, the amended marker, and the cumulative GPA;
- no horizontal overflow on any page.

## Remaining Work

- Registry-owner approval of the layout, wording, and issuance policy, including whether outstanding fees or holds may block issue.
- A final transcript and award certificate (`EXM-17`, `EXM-18`) once graduation audit and award approval exist.
- Rendering through a document service (PDF, digital signature, and retention), in place of the printable page. Approved templates and reference numbers are delivered in [DOCUMENT_TEMPLATES.md](../stage-8/DOCUMENT_TEMPLATES.md).
- Transcripts spanning a programme transfer. Results stay on the origin programme record today, so each record has its own transcript.
- Rate limiting and audit of public verification lookups at the edge, once hosting is decided (ADR-007).
- Student-initiated requests and delivery to third parties.
