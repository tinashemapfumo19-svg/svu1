-- Publishing official academic rules needs a second person (maker-checker). The Academic Registrar
-- is the checker role for programme versions, grading schemes, and GPA rule sets.
insert into roles (code, name, risk)
values ('academic_registrar', 'Academic Registrar', 'high')
on conflict (code) do nothing;

insert into role_permissions (role_code, permission_code) values
  ('academic_registrar', 'master_data.publish'),
  ('academic_registrar', 'foundation.view')
on conflict do nothing;
