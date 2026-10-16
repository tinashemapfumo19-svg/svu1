insert into permissions (code, description)
values ('identity.manage', 'Manage account lifecycle and account sessions')
on conflict (code) do update
set description = excluded.description;

insert into role_permissions (role_code, permission_code)
values ('system_administrator', 'identity.manage')
on conflict do nothing;
