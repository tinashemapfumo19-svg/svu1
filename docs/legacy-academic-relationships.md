# Legacy academic relationships

The academic import projects 9,534 source rows from the reconciled SQL archive into foreign-key-linked historical records. It adds 3,228 course/cohort membership contexts for 401 students (2,444 distinct student/course pairs), 8,347 assignment/exam parent links, and 160 assessment relationships. The original encrypted source rows remain intact.

Student course lists and registration history show course, intake, study year, term, academic year when present, and the lecturers recorded against the student's evidence. Student results show only source-published marks and progression records. Registry records apply programme scope and results permissions. Teaching views show historical classes and class lists, with lecturer ownership and scope checks.

The projection includes assignments, submissions, marks, tutorials, course resources, exam orders, exam results, progression, a recorded award, study-year tracking, exam schedule metadata, and the two source term definitions. It preserves source marks, grades, points and decisions; it does not recalculate them using a different grading scheme.

Historical membership is established from a student's assignment, mark, exam or progression record. It does not establish current registration clearance. Course membership is never inferred merely because a course belongs to a programme. Students without source membership evidence are not assigned every curriculum course.

Dates on assignments or lecturer allocations do not establish an academic year. Many assignment records supply an intake, study year and term but no academic year or term boundaries. These remain explicit unknowns. Consequently, historical records do not generate current confirmed registrations, active teaching approvals, GPA policies, credit values, published transcripts or calendar dates. Existing operational registration workflows remain available for new registrations.

Three imported academic rows refer to missing staff: `svu_assignments:1`, `svu_assignments:2`, and `svu_tutorials:1`. The earlier teaching-allocation import also retains the unresolved staff reference at `svu_subject_allocation:92`. Course and programme links remain available for these rows.

Apply migrations with `node scripts/migrate.js`. Preview with `node scripts/link-legacy-academic-records.js`; apply with `node scripts/link-legacy-academic-records.js --apply`. The importer verifies source checksums, runs atomically under an advisory lock, checks stored projections against their source, and can be rerun without duplicates. It refuses to overwrite a stored projection that differs from the source.

Run `node scripts/verify-legacy-academic-records.js` for database, ownership, scope, HTTP, and desktop/mobile rendering checks. Aggregate reports are written under `data/legacy-cutover/academic-records-*.json`; local screenshots are under `data/legacy-academic-verification/`.
