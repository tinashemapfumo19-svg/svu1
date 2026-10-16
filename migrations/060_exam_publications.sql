create table exam_publications (
  period_id text not null references exam_timetables(period_id),
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  staff_snapshot jsonb,
  prepared_by text references accounts(id),
  published_by text not null references accounts(id),
  published_at timestamptz not null,
  reason text not null,
  origin text not null check (origin in ('published','retained')),
  period_name text not null,
  programme_code text not null,
  intake_label text not null,
  primary key (period_id,revision)
);
create trigger exam_publications_append_only before update or delete on exam_publications
  for each row execute function ledger_append_only();
insert into exam_publications (period_id,revision,snapshot,staff_snapshot,prepared_by,published_by,published_at,reason,origin,period_name,programme_code,intake_label)
  select et.period_id,et.published_revision,et.published_snapshot,et.published_staff_snapshot,
    case when et.revision = et.published_revision then et.prepared_by else null end,et.published_by,et.published_at,coalesce(et.publication_reason,'Retained publication snapshot'),'retained',ap.name,p.code,i.label
  from exam_timetables et join registration_periods rp on rp.id = et.period_id join academic_periods ap on ap.id = rp.academic_period_id
    join intakes i on i.id = rp.intake_id join programmes p on p.id = i.programme_id
  where et.published_snapshot is not null and et.published_revision is not null and et.published_by is not null and et.published_at is not null;
