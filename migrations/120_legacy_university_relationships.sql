alter table curriculum_entries add column legacy_source_ref text unique;
alter table curriculum_entries alter column requirement_type drop not null;
alter table curriculum_entries add constraint curriculum_requirement_or_legacy
 check(requirement_type is not null or legacy_source_ref is not null);

create table legacy_teaching_links (
 source_ref text primary key,
 source_import_id text not null references legacy_imports(id),
 course_id text not null references courses(id),
 programme_version_id text not null references programme_versions(id),
 staff_id text references staff_members(id),
 source_staff_code text not null,
 source_active boolean not null,
 source_allocation_date text,
 reconciliation_status text not null check(reconciliation_status in ('period_mapping_required','staff_and_period_mapping_required'))
);
create index legacy_teaching_links_staff on legacy_teaching_links(staff_id);

alter table student_programmes add column legacy_recorded_study_year text;
alter table student_programmes add column legacy_study_year_updated_on text;
alter table staff_members add column legacy_department_code text;
alter table staff_members add column legacy_category text;
alter table staff_members add column legacy_grade text;
alter table staff_members add column legacy_supervisor_staff_id text references staff_members(id);
