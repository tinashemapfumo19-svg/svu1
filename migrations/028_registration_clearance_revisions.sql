-- Old clearances fail closed if their selection has changed since revision one.
alter table registration_checks add column registration_revision integer not null default 1;
