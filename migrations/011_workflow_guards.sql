alter table workflow_definitions add column if not exists initial_state text;
alter table workflow_definitions add column if not exists terminal_states jsonb not null default '[]'::jsonb;

-- Version 1 was seeded without transitions, which let any state jump to any other. Give it the
-- linear path its states imply so instances still on v1 are guarded too.
update workflow_definitions
set initial_state = 'Submitted',
    terminal_states = '["Accepted", "Closed"]'::jsonb,
    transitions = '[
      {"from": "Submitted", "to": "Completeness review"},
      {"from": "Completeness review", "to": "Academic review"},
      {"from": "Academic review", "to": "Decision"},
      {"from": "Decision", "to": "Offer issued", "permission": "admissions.decide"},
      {"from": "Offer issued", "to": "Accepted"},
      {"from": "Submitted", "to": "Closed"},
      {"from": "Completeness review", "to": "Closed"},
      {"from": "Academic review", "to": "Closed"},
      {"from": "Decision", "to": "Closed", "permission": "admissions.decide"},
      {"from": "Offer issued", "to": "Closed"}
    ]'::jsonb
where id = 'wf_admissions_basic' and transitions = '[]'::jsonb;

insert into permissions (code, description)
values ('admissions.decide', 'Record admissions decisions (offer, rejection, deferral)')
on conflict (code) do update set description = excluded.description;

insert into role_permissions (role_code, permission_code) values
  ('system_administrator', 'admissions.decide'),
  ('admissions_manager', 'admissions.decide')
on conflict do nothing;

create index if not exists workflow_instances_subject_idx on workflow_instances(subject_type, subject_id);
