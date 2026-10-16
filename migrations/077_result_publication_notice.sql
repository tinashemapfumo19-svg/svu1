insert into notification_templates (id,code,channel,subject,body,version,status) values
('nt_results_published_email_v1','results.published','email','Your results are available',
 'New results are available in your student portal. Sign in to view your official results.',1,'active')
on conflict do nothing;
