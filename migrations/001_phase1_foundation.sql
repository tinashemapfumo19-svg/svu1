create table if not exists people (
  id text primary key,
  preferred_name text not null,
  legal_name text not null,
  personas jsonb not null default '[]'::jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id text primary key,
  person_id text not null references people(id),
  email text not null unique,
  status text not null,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  code text primary key,
  name text not null,
  risk text not null,
  active boolean not null default true
);

create table if not exists permissions (
  code text primary key,
  description text
);

create table if not exists role_assignments (
  id text primary key,
  account_id text not null references accounts(id),
  role_code text not null references roles(code),
  scope jsonb not null default '{}'::jsonb,
  effective_from date not null,
  effective_to date,
  granted_by text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id text primary key,
  occurred_at timestamptz not null default now(),
  actor_id text not null,
  action text not null,
  subject_type text not null,
  subject_id text not null,
  source text not null,
  reason text,
  before_ref text,
  after_ref text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_events_actor_idx on audit_events(actor_id);
create index if not exists audit_events_subject_idx on audit_events(subject_type, subject_id);
create index if not exists audit_events_occurred_at_idx on audit_events(occurred_at desc);

create table if not exists organization_units (
  id text primary key,
  code text not null unique,
  name text not null,
  unit_type text not null,
  parent_id text references organization_units(id),
  status text not null,
  effective_from date,
  effective_to date
);

create table if not exists programmes (
  id text primary key,
  code text not null unique,
  name text not null,
  department_id text not null references organization_units(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists programme_versions (
  id text primary key,
  programme_id text not null references programmes(id),
  version_label text not null,
  requirements jsonb not null default '{}'::jsonb,
  status text not null,
  effective_from date,
  effective_to date
);

create table if not exists intakes (
  id text primary key,
  programme_id text not null references programmes(id),
  label text not null,
  capacity integer not null,
  application_opens_at timestamptz,
  application_closes_at timestamptz,
  status text not null
);

create table if not exists academic_periods (
  id text primary key,
  code text not null unique,
  name text not null,
  period_type text not null,
  starts_on date not null,
  ends_on date not null,
  lifecycle_status text not null,
  windows jsonb not null default '{}'::jsonb
);

create table if not exists reference_values (
  id text primary key,
  list_code text not null,
  value_code text not null,
  label text not null,
  status text not null,
  effective_from date,
  effective_to date,
  unique (list_code, value_code)
);

create table if not exists workflow_definitions (
  id text primary key,
  code text not null,
  version integer not null,
  states jsonb not null,
  transitions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  unique (code, version)
);

create table if not exists workflow_instances (
  id text primary key,
  definition_id text not null references workflow_definitions(id),
  subject_type text not null,
  subject_id text not null,
  state text not null,
  owner_account_id text references accounts(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  title text not null,
  queue text not null,
  assignee_account_id text references accounts(id),
  workflow_instance_id text references workflow_instances(id),
  priority text not null,
  due_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id text primary key,
  owner_type text not null,
  owner_id text not null,
  document_type text not null,
  classification text not null,
  storage_key text not null,
  checksum text,
  lifecycle text not null,
  malware_scan_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists notification_templates (
  id text primary key,
  code text not null,
  channel text not null,
  subject text,
  body text not null,
  version integer not null,
  status text not null,
  unique (code, channel, version)
);

create table if not exists notifications (
  id text primary key,
  recipient_account_id text references accounts(id),
  channel text not null,
  template_id text references notification_templates(id),
  payload jsonb not null default '{}'::jsonb,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists invitations (
  id text primary key,
  email text not null,
  role_code text not null references roles(code),
  scope jsonb not null default '{}'::jsonb,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists foundation_lanes (
  id text primary key,
  name text not null,
  status text not null,
  trace text not null,
  display_order integer not null
);

create table if not exists decisions (
  id text primary key,
  decision_id text not null unique,
  title text not null,
  recommendation text not null,
  status text not null,
  owner_needed text,
  blocks text,
  display_order integer not null
);

create table if not exists implementation_tickets (
  id text primary key,
  ticket_id text not null unique,
  title text not null,
  status text not null,
  priority text not null default 'P1',
  display_order integer not null
);

create table if not exists exit_gates (
  id text primary key,
  gate_id text not null unique,
  title text not null,
  status text not null,
  display_order integer not null
);
