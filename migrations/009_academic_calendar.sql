alter table academic_periods add column if not exists parent_id text references academic_periods(id);
alter table academic_periods add column if not exists created_by text;
alter table academic_periods add column if not exists created_at timestamptz not null default now();
alter table academic_periods add column if not exists updated_at timestamptz not null default now();

create index if not exists academic_periods_parent_idx on academic_periods(parent_id);

insert into academic_periods (id, code, name, period_type, starts_on, ends_on, lifecycle_status, windows, created_by)
values ('ay_2027', 'AY-2027', 'Academic Year 2027', 'academic_year', '2027-01-01', '2027-12-31', 'planning', '{}'::jsonb, 'system_migration')
on conflict (id) do nothing;

update academic_periods
set parent_id = 'ay_2027'
where id = 'period_2027_s1' and parent_id is null;
