-- Historical evidence has incomplete dates/credits. Keep those unknowns explicit;
-- do not manufacture current registration approvals or teaching access grants.
create table legacy_academic_contexts (
 id text primary key,
 import_id text not null references legacy_imports(id),
 programme_version_id text references programme_versions(id),
 course_id text references courses(id),
 source_programme_code text,
 source_course_code text,
 source_intake text,
 study_year text,
 term text,
 academic_year text,
 starts_on date,
 ends_on date,
 check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create table legacy_academic_records (
 id text primary key,
 import_id text not null,
 source_table text not null,
 source_row integer not null,
 context_id text not null references legacy_academic_contexts(id),
 student_id text references students(id),
 student_programme_id text references student_programmes(id),
 staff_id text references staff_members(id),
 moderator_staff_id text references staff_members(id),
 parent_record_id text references legacy_academic_records(id),
 kind text not null,
 source_student_code text,
 source_staff_code text,
 source_moderator_code text,
 source_record_code text,
 published boolean,
 details jsonb not null,
 issues jsonb not null default '[]'::jsonb,
 unique(import_id,source_table,source_row),
 foreign key(import_id,source_table,source_row)
  references legacy_source_rows(import_id,source_table,source_row)
);
create index legacy_academic_student on legacy_academic_records(student_programme_id,kind);
create index legacy_academic_staff on legacy_academic_records(staff_id,context_id);
create index legacy_academic_context on legacy_academic_records(context_id,student_id);
create index legacy_academic_parent on legacy_academic_records(parent_record_id);

create view legacy_course_memberships as
 select r.student_id,r.student_programme_id,r.context_id,
 count(*)::int as evidence_count,
 array_agg(distinct r.kind order by r.kind) as evidence_kinds,
 bool_or(jsonb_array_length(r.issues)>0) as needs_reconciliation
 from legacy_academic_records r join legacy_academic_contexts c on c.id=r.context_id
 where r.student_id is not null and c.course_id is not null
 and r.kind in ('submission','assignment_mark','exam_result','progression')
 group by r.student_id,r.student_programme_id,r.context_id;
