insert into permissions(code,description) values
('rooms.self','Manage own opt-in institutional room participation'),
('rooms.manage','Draft institutional rooms and appoint room moderators'),
('rooms.approve','Independently activate or close institutional rooms') on conflict do nothing;
insert into roles(code,name,risk) values
('room_steward','Institutional Room Steward','high'),
('room_approver','Institutional Room Approver','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code)
select role_code,'rooms.self' from role_permissions where permission_code='messages.self' and role_code in (
  'applicant','student','lecturer','system_administrator','admissions_officer','admissions_manager',
  'academic_registrar','finance_officer','examinations_officer','academic_approver','hr_officer',
  'exam_invigilator','exam_arrangements_officer','support_officer','support_manager','records_manager',
  'asset_officer','asset_approver','cashbook_officer','cashbook_approver'
) on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('system_administrator','rooms.manage'),('system_administrator','rooms.approve'),
('room_steward','rooms.self'),('room_steward','rooms.manage'),
('room_approver','rooms.self'),('room_approver','rooms.approve') on conflict do nothing;
