// Transfer arrivals consume seats without manufacturing an admissions application.
export const transferredSeatsSql = `(select count(distinct arrival.student_id)::int from student_programmes arrival
  join students arrival_student on arrival_student.id = arrival.student_id
  where arrival.intake_id = i.id and arrival.origin_programme_id is not null
  and not exists (select 1 from applications admitted join workflow_instances admitted_workflow on admitted_workflow.id = admitted.workflow_instance_id
    where admitted.intake_id = i.id and admitted.applicant_account_id = arrival_student.account_id and admitted_workflow.state in ('Offer issued','Accepted')))`;
export const admissionsPlacesSql = `(select count(*)::int from applications a join workflow_instances w on w.id = a.workflow_instance_id
    where a.intake_id = i.id and w.state in ('Offer issued','Accepted'))`;
export const intakeSeatsSql = `select i.capacity,
  ${admissionsPlacesSql} + ${transferredSeatsSql} as used
  from intakes i where i.id = $1`;
