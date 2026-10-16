alter table report_editions drop constraint report_editions_report_kind_check;
alter table report_editions add constraint report_editions_report_kind_check check (report_kind in ('admissions','registry','finance','support','enquiries','communications','academic','continuation','examinations','assessment'));
alter table report_schedules drop constraint report_schedules_report_kind_check;
alter table report_schedules add constraint report_schedules_report_kind_check check (report_kind in ('admissions','registry','finance','support','enquiries','communications','academic','continuation','examinations','assessment'));
