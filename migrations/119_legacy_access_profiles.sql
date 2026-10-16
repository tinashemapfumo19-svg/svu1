-- Staff level names/numbers come from the supplied svu_sla table.
-- Specialist roles remain permission bundles/history; people select consolidated profiles.
alter table roles add column is_assignable boolean not null default true;
alter table roles add column legacy_access_level integer;
insert into roles(code,name,risk) values
 ('legacy_staff','User','low'),
 ('legacy_reports','Reports Access Only','medium'),
 ('legacy_supervisor','Supervisor','high'),
 ('legacy_management','Management','high'),
 ('legacy_super_user','Super user','high') on conflict do nothing;
update roles set is_assignable=false;
update roles set is_assignable=true where code in
 ('system_administrator','legacy_super_user','legacy_management','legacy_supervisor','legacy_reports','legacy_staff','student','applicant');
alter table roles alter column is_assignable set default false;
update roles set name='Sysadmin',legacy_access_level=9 where code='system_administrator';
update roles set name='User',legacy_access_level=1 where code='legacy_staff';
update roles set legacy_access_level=2 where code='legacy_reports';
update roles set legacy_access_level=3 where code='legacy_supervisor';
update roles set legacy_access_level=4 where code='legacy_management';
update roles set legacy_access_level=8 where code='legacy_super_user';

create table role_profile_members (
 profile_code text not null references roles(code),
 member_code text not null references roles(code),
 primary key(profile_code,member_code),check(profile_code<>member_code)
);
insert into role_profile_members(profile_code,member_code) values
 ('legacy_staff','lecturer'),('legacy_staff','exam_invigilator'),
 ('legacy_supervisor','admissions_officer'),('legacy_supervisor','asset_officer'),
 ('legacy_supervisor','cashbook_officer'),('legacy_supervisor','examinations_officer'),
 ('legacy_supervisor','finance_officer'),('legacy_supervisor','fleet_officer'),
 ('legacy_supervisor','fleet_safety_officer'),('legacy_supervisor','hr_officer'),
 ('legacy_supervisor','records_manager'),('legacy_supervisor','room_steward'),
 ('legacy_supervisor','room_safety_reviewer'),('legacy_supervisor','support_officer'),
 ('legacy_supervisor','exam_arrangements_officer'),('legacy_supervisor','external_examiner'),
 ('legacy_management','academic_approver'),('legacy_management','academic_registrar'),
 ('legacy_management','admissions_manager'),('legacy_management','asset_approver'),
 ('legacy_management','cashbook_approver'),('legacy_management','fleet_approver'),
 ('legacy_management','room_approver'),('legacy_management','support_manager'),
 ('legacy_management','privacy_approver'),
 ('legacy_super_user','legacy_staff'),('legacy_super_user','legacy_reports'),
 ('legacy_super_user','legacy_supervisor'),('legacy_super_user','legacy_management'),
 ('legacy_super_user','privacy_officer'),('legacy_super_user','report_scheduler');

create function refresh_legacy_access_profiles() returns void language plpgsql as $$
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
 insert into role_permissions(role_code,permission_code) select 'system_administrator',code from permissions;
end $$;
select refresh_legacy_access_profiles();
