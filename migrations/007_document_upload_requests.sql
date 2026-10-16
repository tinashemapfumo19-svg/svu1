alter table documents add column if not exists file_name text;
alter table documents add column if not exists content_type text;
alter table documents add column if not exists size_bytes bigint;
alter table documents add column if not exists upload_expires_at timestamptz;
alter table documents add column if not exists signature_verified boolean;
alter table documents add column if not exists scanned_at timestamptz;
alter table documents add column if not exists scanned_by text;

insert into permissions (code, description)
values ('document.scan.record', 'Record malware-scan and file-signature results for uploaded documents')
on conflict (code) do update
set description = excluded.description;

insert into role_permissions (role_code, permission_code)
values ('system_administrator', 'document.scan.record')
on conflict do nothing;
