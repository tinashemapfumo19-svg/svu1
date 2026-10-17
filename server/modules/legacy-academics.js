import {actorCanAccessScope} from '../support.js';

// The caller checks ownership and programme scope before loading source evidence.
export async function legacyAcademicFor(db,programmeId,{includeResults=false,own=false}={}) {
 const courses=(await db.query(`select c.id as "contextId",co.code,co.title,c.course_id as "courseId",
  c.source_intake as intake,c.study_year as "studyYear",c.term,c.academic_year as "academicYear",
  m.evidence_count as "evidenceCount",m.evidence_kinds as "evidenceKinds",m.needs_reconciliation as "needsReconciliation",
  coalesce((select jsonb_agg(x) from (select distinct s.id as "staffId",s.legal_name as name
   from legacy_academic_records r join staff_members s on s.id=r.staff_id
   where r.context_id=c.id and r.student_programme_id=m.student_programme_id) x),'[]'::jsonb) as lecturers
  from legacy_course_memberships m join legacy_academic_contexts c on c.id=m.context_id
  join courses co on co.id=c.course_id where m.student_programme_id=$1
  order by c.academic_year nulls first,c.source_intake,c.study_year,c.term,co.code`,[programmeId])).rows;
 const results=includeResults?(await db.query(`select r.id,r.kind,r.source_table as "sourceTable",r.source_row as "sourceRow",
  co.code,co.title,c.source_intake as intake,c.study_year as "studyYear",c.term,c.academic_year as "academicYear",
  r.published,r.details,r.issues,s.legal_name as "lecturerName",m.legal_name as "moderatorName"
  from legacy_academic_records r join legacy_academic_contexts c on c.id=r.context_id
  left join courses co on co.id=c.course_id left join staff_members s on s.id=r.staff_id
  left join staff_members m on m.id=r.moderator_staff_id
  where r.student_programme_id=$1 and r.kind in ('assignment_mark','exam_result','progression','award')
  and (not $2::boolean or r.published=true) order by c.academic_year,c.study_year,c.term,co.code,r.source_row`,[programmeId,own])).rows:[];
 return {courses,results};
}

export async function legacyTeachingContexts(db,actor,staffId=null) {
 const rows=(await db.query(`select c.id as "contextId",co.code,co.title,p.code as "programmeCode",
  c.source_intake as intake,c.study_year as "studyYear",c.term,c.academic_year as "academicYear",
  s.id as "staffId",s.legal_name as "staffName",count(distinct r.student_id)::int as students,
  count(*)::int as "evidenceCount",array_agg(distinct sp.intake_id) filter(where sp.intake_id is not null) as "scopeIntakes"
  from legacy_academic_records r join legacy_academic_contexts c on c.id=r.context_id
  join courses co on co.id=c.course_id join programme_versions v on v.id=c.programme_version_id
  join programmes p on p.id=v.programme_id join staff_members s on s.id=r.staff_id
  left join student_programmes sp on sp.id=r.student_programme_id
  where ($1::text is null or r.staff_id=$1)
  group by c.id,co.code,co.title,p.code,s.id order by p.code,c.source_intake,c.study_year,co.code`,[staffId])).rows;
 const visible=[];
 for(const row of rows){
  const scopes=(row.scopeIntakes||[]).map(intakeId=>({intakeId}));
  const permission=staffId?'teaching.self':'teaching.view';
  if(scopes.length ? scopes.every(scope=>actorCanAccessScope({...actor,authorizingPermission:permission},
   {programmeCode:row.programmeCode,intakeId:scope.intakeId})) : actorCanAccessScope({...actor,authorizingPermission:permission}, {programmeCode:row.programmeCode})){
    const {scopeIntakes,...context}=row;visible.push(context);
   }
 }
 return visible;
}
