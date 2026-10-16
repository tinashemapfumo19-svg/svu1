create table if not exists role_permissions (
  role_code text not null references roles(code),
  permission_code text not null references permissions(code),
  created_at timestamptz not null default now(),
  primary key (role_code, permission_code)
);

create index if not exists role_permissions_permission_idx on role_permissions(permission_code);
