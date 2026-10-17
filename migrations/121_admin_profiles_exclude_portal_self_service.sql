-- Sysadmin and Master Administrator hold every staff permission, but not the self-service permissions
-- that only students and applicants hold (registry.self, admissions.apply, ...). The client treats
-- registry.self as "this person is a student", so granting it to admins sent them to an empty student
-- portal. Portal-only = held by student/applicant and by no specialist staff role.
create or replace function portal_only_permissions() returns table(permission_code text) language sql stable as $$
  select distinct rp.permission_code from role_permissions rp
  where rp.role_code in ('student', 'applicant')
    and not exists (
      select 1 from role_permissions other
      where other.permission_code = rp.permission_code
        and other.role_code not in ('student', 'applicant', 'system_administrator', 'master_administrator',
          'legacy_staff', 'legacy_reports', 'legacy_supervisor', 'legacy_management', 'legacy_super_user'))
$$;

create or replace function refresh_legacy_access_profiles() returns void language plpgsql as $$
declare pass integer;
begin
 delete from role_permissions where role_code in
 ('system_administrator','legacy_staff','legacy_reports','legacy_supervisor','legacy_management','legacy_super_user');
 insert into role_permissions(role_code,permission_code) values('legacy_staff','foundation.view');
 insert into role_permissions(role_code,permission_code)
 select 'legacy_reports',code from permissions where code like '%.view';
 -- Three passes allow profiles to inherit the already refreshed lower-level bundles.
 for pass in 1..3 loop
  insert into role_permissions(role_code,permission_code)
  select distinct m.profile_code,rp.permission_code from role_profile_members m
  join role_permissions rp on rp.role_code=m.member_code on conflict do nothing;
 end loop;
 insert into role_permissions(role_code,permission_code)
 select 'system_administrator',code from permissions where code not in (select permission_code from portal_only_permissions());
 delete from role_permissions where role_code = 'master_administrator'
   and permission_code in (select permission_code from portal_only_permissions());
end $$;

select refresh_legacy_access_profiles();
