insert into permissions(code,description) values
('cashbook.view','Read institution-wide cashbooks and retained reconciliation evidence'),
('cashbook.manage','Record institutional cashbook accounts, movements and reconciliation captures'),
('cashbook.approve','Independently close institution-wide cashbook reconciliations'),
('cashbook.policy.manage','Define and retire institutional cashbook policies'),
('cashbook.policy.approve','Independently publish institutional cashbook policies') on conflict do nothing;
insert into roles(code,name,risk) values
('cashbook_officer','Institutional Cashbook Officer','high'),
('cashbook_approver','Institutional Cashbook Approver','high') on conflict do nothing;
insert into role_permissions(role_code,permission_code) values
('cashbook_officer','cashbook.view'),('cashbook_officer','cashbook.manage'),('cashbook_officer','cashbook.policy.manage'),
('cashbook_approver','cashbook.view'),('cashbook_approver','cashbook.approve'),('cashbook_approver','cashbook.policy.approve'),
('system_administrator','cashbook.view'),('system_administrator','cashbook.manage'),('system_administrator','cashbook.approve'),
('system_administrator','cashbook.policy.manage'),('system_administrator','cashbook.policy.approve'),
('cashbook_officer','leave.self'),('cashbook_approver','leave.self'),
('cashbook_officer','messages.self'),('cashbook_approver','messages.self') on conflict do nothing;
