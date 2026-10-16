create table if not exists reference_lists (
  code text primary key,
  name text not null,
  owner text not null,
  sensitivity text not null default 'standard',
  lawful_purpose text,
  status text not null default 'active',
  value_pattern text,
  created_at timestamptz not null default now()
);

insert into reference_lists (code, name, owner, sensitivity, lawful_purpose, status, value_pattern) values
  ('country', 'Countries', 'Registry/admissions', 'standard', null, 'active', '^[A-Z]{2}$'),
  ('academic_level', 'Academic levels', 'Academic management', 'standard', null, 'active', null),
  ('study_mode', 'Study modes', 'Registry', 'standard', null, 'active', null),
  ('currency', 'Currencies', 'Finance', 'standard', null, 'active', '^[A-Z]{3}$'),
  ('disability', 'Disability categories', 'Registry/student support', 'restricted',
    'Collected only to arrange reasonable adjustments and support services; visible to authorised student-support staff.', 'active', null),
  ('religion', 'Religion', 'Registry', 'restricted',
    'Retained from the legacy system pending confirmation that a lawful purpose exists; must not be collected until approved.', 'under_review', null)
on conflict (code) do nothing;

alter table reference_values add column if not exists sort_order integer not null default 0;
alter table reference_values add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table reference_values add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reference_values_list_fk') then
    alter table reference_values
      add constraint reference_values_list_fk foreign key (list_code) references reference_lists(code);
  end if;
end $$;
