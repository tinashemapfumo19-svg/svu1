# Self-service Letters

Students issue two letters themselves from Student Office → Documents, each with a public verification code.

| Letter | When available | Content |
| --- | --- | --- |
| Confirmation of enrolment | While the programme is onboarded or active | Name, student number, programme, faculty, intake, issue date, standard statement |
| Proof of registration | For any semester with a confirmed registration | The above plus the semester, its dates, registered courses with credits and the registration reference |

## How it works

- `server/modules/student-letters.js`, migration `107_student_letters.sql`. A letter is an immutable snapshot (content,
  SHA-256 fingerprint, 16-character code in the transcript code alphabet). A database trigger blocks edits and deletes;
  only `issued → revoked` is allowed.
- Letters state the record **as of their issue date**; later changes do not alter them. Up to 10 letters per programme a day.
- The letter opens as a printable page (Print or save as PDF) with a QR code to `#verify/<code>`.
- The Verify page accepts letter codes in the same box as transcripts (`GET /api/verify/transcripts/:code` falls back to
  letters) and shows the letter type, student, programme, record date, semester and courses.
- Registry staff with `registry.transcript.issue` can revoke a letter: `POST /api/registry/letters/:id/revoke {reason}`
  (API only for now).

| Endpoint | Who |
| --- | --- |
| `GET/POST /api/registry/me/programmes/:id/letters` | Student (own programme) |
| `GET /api/registry/me/letters/:id` | Student: content, QR (SVG) and verify URL |

## Outstanding

- A staff screen to find and revoke letters (API exists).
- Letterhead, signature image and wording approved by the Registrar (D-42).
- Other letter types (good standing, fees statement letter) once their wording is approved.
