# Class Attendance

Lecturers take attendance on the course page; students check in with their phones.

## Lecturer

- **Take attendance** (session name, open for 10–60 minutes; the API allows 5–180). Only one open session per course.
- The live panel shows a QR code and a 6-character code that **change every 20 seconds**, a present/enrolled ring and
  the class list with **Mark present** for students without a phone. **Full screen for projector** enlarges the code.
- **Close attendance** ends it early; past sessions list present / enrolled. Manual marks are allowed after closing.

## Student

- Scan the QR (opens `#attend/<session>~<code>`; sign-in first if needed), or type the code on the course page.
- A check-in is accepted only for the current or previous code (≤ 40 seconds), only while the session is open, and only
  for students enrolled in that course. Each student is marked once per session.
- The course page shows the student's attendance rate.

## Early warning

The early-warning list gains **low attendance**: below 75% of at least four closed sessions in the last 60 days.

## Implementation

`server/modules/attendance.js`, migration `110_attendance.sql` (marks cannot be changed or deleted), client
`src/attendance.js`. Codes are HMAC-SHA-256 of `session:window` with a key derived from `SVU_DATA_KEY` (purpose
`attendance`). No location is collected.

| Endpoint | Who |
| --- | --- |
| `GET/POST /api/course-workspaces/:period/:course/attendance` | Lecturer (list, open) or student (own record) |
| `GET …/attendance/:session/live`, `POST …/close`, `POST …/marks {studentId}` | Allocated lecturer |
| `POST /api/attendance/check-in {token}` or `{code}` | Enrolled student |

## Outstanding (D-46)

- Whether attendance counts towards anything (eligibility, early warning only), the 75% threshold and retention.
- Proxy check-ins (sharing the live code by message) are limited by the 20-second rotation, not prevented.
- Lecturer export of registers.
