-- Dedicated full-access role for explicitly assigned master administrators.
-- Existing system-administrator accounts keep their existing grants.
insert into roles(code,name,risk) values ('master_administrator','Master Administrator','critical')
on conflict(code) do nothing;

insert into role_permissions(role_code,permission_code)
select 'master_administrator',code from permissions
on conflict do nothing;

create function grant_new_master_permission() returns trigger language plpgsql as $$
begin
  insert into role_permissions(role_code,permission_code)
  values('master_administrator',new.code) on conflict do nothing;
  return new;
end $$;

create trigger permissions_master_administrator
after insert on permissions for each row execute function grant_new_master_permission();
