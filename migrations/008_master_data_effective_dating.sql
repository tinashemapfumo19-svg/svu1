create table if not exists organization_unit_history (
  id text primary key,
  unit_id text not null references organization_units(id),
  name text not null,
  parent_id text references organization_units(id),
  status text not null,
  effective_from date not null,
  effective_to date,
  changed_by text not null,
  reason text,
  recorded_at timestamptz not null default now()
);

create index if not exists organization_unit_history_unit_idx on organization_unit_history(unit_id, effective_from);

update organization_units set effective_from = current_date where effective_from is null;

insert into organization_unit_history (id, unit_id, name, parent_id, status, effective_from, changed_by, reason)
select 'ouh_baseline_' || u.id, u.id, u.name, u.parent_id, u.status, u.effective_from, 'system_migration', 'Baseline history for existing unit'
from organization_units u
where not exists (select 1 from organization_unit_history h where h.unit_id = u.id);

alter table programme_versions add column if not exists created_at timestamptz not null default now();
alter table programme_versions add column if not exists created_by text;
alter table programme_versions add column if not exists published_at timestamptz;
alter table programme_versions add column if not exists published_by text;
alter table programme_versions add column if not exists retired_at timestamptz;
alter table programme_versions add column if not exists retired_by text;

create unique index if not exists programme_versions_label_idx on programme_versions(programme_id, version_label);
