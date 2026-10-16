-- Security baseline every environment needs, not just development. Earlier this only came from the
-- dev seed, so later migrations that grant permissions failed on an empty database.
insert into roles (code, name, risk) values
  ('applicant', 'Applicant', 'low'),
  ('student', 'Student', 'medium'),
  ('admissions_officer', 'Admissions Officer', 'medium'),
  ('admissions_manager', 'Admissions Manager', 'high'),
  ('system_administrator', 'System Administrator', 'critical'),
  ('auditor', 'Auditor', 'high')
on conflict (code) do nothing;

insert into permissions (code, description) values
  ('identity.invite', 'Invite people to create accounts'),
  ('identity.activate', 'Activate accounts'),
  ('access.assign_role', 'Assign roles to accounts'),
  ('audit.view', 'View audit events'),
  ('workflow.transition', 'Start and move workflow instances'),
  ('task.assign', 'Assign, hand off, and complete tasks'),
  ('document.create', 'Create and read document records'),
  ('notification.send', 'Preview, send, and read notifications'),
  ('master_data.publish', 'Create and publish master data'),
  ('foundation.view', 'View foundation status')
on conflict (code) do nothing;

insert into role_permissions (role_code, permission_code) values
  ('system_administrator', 'identity.invite'),
  ('system_administrator', 'identity.activate'),
  ('system_administrator', 'access.assign_role'),
  ('system_administrator', 'audit.view'),
  ('system_administrator', 'workflow.transition'),
  ('system_administrator', 'task.assign'),
  ('system_administrator', 'document.create'),
  ('system_administrator', 'notification.send'),
  ('system_administrator', 'master_data.publish'),
  ('system_administrator', 'foundation.view'),
  ('admissions_manager', 'identity.invite'),
  ('admissions_manager', 'access.assign_role'),
  ('admissions_manager', 'workflow.transition'),
  ('admissions_manager', 'task.assign'),
  ('admissions_manager', 'document.create'),
  ('admissions_manager', 'notification.send'),
  ('admissions_manager', 'foundation.view'),
  ('admissions_officer', 'workflow.transition'),
  ('admissions_officer', 'task.assign'),
  ('admissions_officer', 'document.create'),
  ('admissions_officer', 'notification.send'),
  ('admissions_officer', 'foundation.view'),
  ('auditor', 'audit.view'),
  ('auditor', 'foundation.view'),
  ('student', 'foundation.view'),
  ('applicant', 'foundation.view')
on conflict do nothing;
