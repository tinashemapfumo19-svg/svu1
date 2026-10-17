create table legacy_academic_relations (
 record_id text not null references legacy_academic_records(id),
 related_record_id text not null references legacy_academic_records(id),
 relation text not null check(relation in ('mark_for_submission','progression_for_exam')),
 primary key(record_id,relation,related_record_id),
 check(record_id<>related_record_id)
);
