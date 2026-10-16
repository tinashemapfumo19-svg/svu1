# Course Evaluations

Anonymous end-of-semester evaluations with a fixed question set.

## Who does what

- **Registry / quality office** (`evaluations.manage`, granted to system administrators and academic registrars):
  Staff → Teaching → **Course evaluations** opens evaluations for every course in a semester with opening and closing
  dates, notifies enrolled students (`course.evaluation_open`, mutable with "New course material"), shows response
  rates and overall scores, and can close one early.
- **Students** answer once on the course page: five 1–5 ratings and two optional comments.
- **Lecturers** see results on their course page **once at least 5 students have answered**: averages, a distribution
  bar per question, and comments.

## Questions (version 1)

1. The course was well organised. 2. The lecturer explained ideas clearly. 3. Materials and resources helped me learn.
4. Assessment and feedback were fair and timely. 5. Overall, I am satisfied with this course. Plus "What worked well?"
and "What should change?".

## Anonymity

Migration `111_course_evaluations.sql`. Responses (`course_evaluation_responses`) hold no student id and no timestamp;
a separate `course_evaluation_participants` row only prevents a second response. Responses cannot be changed. Results
are hidden below 5 responses.

| Endpoint | Who |
| --- | --- |
| `GET /api/evaluations` (semesters), `GET /api/evaluations?period=`, `POST /api/evaluations`, `POST /api/evaluations/:id/close` | `evaluations.manage` |
| `GET/POST /api/course-workspaces/:period/:course/evaluation` | Enrolled student (answer) or lecturer (results) |

## Outstanding (D-43)

- The approved question set, the minimum-response threshold, and who else may read comments (heads of department).
- Comments are shown as written; a moderation step for abusive comments is not built.
- Export for quality reports.
