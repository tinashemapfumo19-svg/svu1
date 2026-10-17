import {createHash} from 'node:crypto';

export const academicSourceTables = [
 'svu_assignments','svu_tutorials','svu_shelf','svu_order_exam',
 'svu_student_assignment','svu_recorded_assignments','svu_student_exam',
 'svu_student_exam_progression','svu_student_degree','svu_current_study_year_tracking',
 'svu_exam_schedule','academic_term','term_setup'
];
export const legacyKey = value => String(value ?? '').replaceAll('\0','').trim().toLowerCase();
const value = v => String(v ?? '').replaceAll('\0','').trim() || null;
const id = (type, parts) => `legacy_${type}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24)}`;
const uniqueIndex = (rows,key) => {
 const index=new Map();
 for(const row of rows) {const k=legacyKey(key(row));if(k)index.set(k,index.has(k)?null:row);}
 return index;
};
const fields = ['assignment_no','post_date','duedate','submitted','date_submited','resubmited','date_re_submited',
 'assignment_received_date','marking_status','recorded','mark_obtained','marked_out_of','mark_percentage',
 'weight_percentage','weighted_mark_perc','passmark','perc_conversion','grade','grade_class','points',
 'type','contributes_to_exam','recorded_on','updated_on','closed','status','exam_number','exam_date',
 'paper_number','exam_order_date','published_on','closed_on','supplimentary_exam','ca','theory','practical',
 'marked','pass_mark','perc_mark','perc_contribution','exam_mark','decision','under_moderation',
 'marked_on','moderated_on','exam_sitting','cumulative_points','gpa_points','progressive_grade',
 'progressive_grade_desc','progressive_class','Final_progression','decession','semester_decision',
 'progressive_ref','transcript_ref','certificate_serial','certificate_no','degree_points','degree_class',
 'degree_grade','degree_grade_desc','start_year','end_year','graduating_date','book_type','book_name','author',
 'year_published','uploaded_on','exam_scheduled_on','start_level','end_level','yearr','term_begins','term_ends'];

// Pure plan: exact, unique source codes only. Dates never imply an academic year.
export function buildLegacyAcademicPlan(importId, source, targets) {
 const programmes=uniqueIndex(targets.programmes,r=>r.code),courses=uniqueIndex(targets.courses,r=>r.code);
 const students=uniqueIndex(targets.students,r=>r.student_number),staff=uniqueIndex(targets.staff,r=>r.source_code);
 const contexts=new Map(),records=[],sourceIndexes=new Map();
 const definitions=[
  ['svu_assignments','assignment','record_id'],['svu_tutorials','tutorial','record_id'],
  ['svu_shelf','resource','trans_id'],['svu_order_exam','exam_order','record_id'],
  ['svu_student_assignment','submission','tracking_no'],['svu_recorded_assignments','assignment_mark','record_id'],
  ['svu_student_exam','exam_result','record_id'],['svu_student_exam_progression','progression','trans_id'],
  ['svu_student_degree','award','certificate_no'],['svu_current_study_year_tracking','study_year','trans_id'],
  ['svu_exam_schedule','exam_schedule','rec_id'],['academic_term','calendar','term_id'],['term_setup','calendar','term_id']
 ];
 for(const [table,kind,pk] of definitions) {
  for(const row of source[table] || []) {
   const r=row.data,issues=[],pcode=value(r.programmecode ?? r.programme_code),ccode=value(r.subjectcode ?? r.coursecode ?? r.course_code);
   const p=programmes.get(legacyKey(pcode)),c=courses.get(legacyKey(ccode));
   if(pcode && !p && pcode.toLowerCase()!=='all')issues.push('programme_missing_or_ambiguous');
   if(ccode && !c)issues.push('course_missing_or_ambiguous');
   const studentCode=value(r.student_id),s=students.get(legacyKey(studentCode));
   if(studentCode && !s)issues.push('student_missing_or_ambiguous');
   const candidates=targets.studentProgrammes.filter(sp=>sp.student_id===s?.id && (!p || sp.programme_version_id===p.id));
   const sp=s && p && candidates.length===1?candidates[0]:null;
   if(s && pcode && !sp)issues.push('student_programme_missing_or_ambiguous');
   const staffCode=value(r.lecturer_id ?? r.uploaded_by),moderatorCode=value(r.moderator_id);
   const lecturer=staff.get(legacyKey(staffCode)),moderator=staff.get(legacyKey(moderatorCode));
   if(staffCode && !lecturer)issues.push('staff_missing_or_ambiguous');
   if(moderatorCode && !moderator)issues.push('moderator_missing_or_ambiguous');
   // A record without a programme code may be linked only to a unique student programme.
   const studentProgramme=sp || (!pcode && s && candidates.length===1?candidates[0]:null);
   const context={import_id:importId,programme_version_id:p?.id || studentProgramme?.programme_version_id || null,
    course_id:c?.id || null,source_programme_code:pcode,source_course_code:ccode,
    source_intake:value(r.intake),study_year:value(r.yearlevel ?? r.exam_year_level ?? r.level_code),
    term:value(r.term ?? r.semester),academic_year:value(r.exam_year ?? (kind==='calendar'?r.yearr:null)),
    starts_on:kind==='calendar'?validDate(r.term_begins):null,ends_on:kind==='calendar'?validDate(r.term_ends):null};
   const contextId=id('context',Object.values(context).map(v=>typeof v==='string'?legacyKey(v):v));
   contexts.set(contextId,{id:contextId,...context});
   const publication=r.published ?? r.results_published;
   const rec={id:id('academic',[importId,table,row.source_row]),import_id:importId,source_table:table,source_row:row.source_row,
    context_id:contextId,student_id:s?.id||null,student_programme_id:studentProgramme?.id||null,
    staff_id:lecturer?.id||null,moderator_staff_id:moderator?.id||null,parent_record_id:null,kind,
    source_student_code:studentCode,source_staff_code:staffCode,source_moderator_code:moderatorCode,
    source_record_code:value(r[pk]),published:publication==null?null:publication==='1',
    details:Object.fromEntries(fields.filter(f=>r[f]!==undefined).map(f=>[f,r[f]])),issues};
   records.push(rec);
   if(!sourceIndexes.has(table))sourceIndexes.set(table,new Map());
   const index=sourceIndexes.get(table),key=legacyKey(r[pk]);
   if(key)index.set(key,index.has(key)?null:rec);
  }
 }
 // Check both the foreign key and its context before joining a source parent.
 for(const rec of records) {
  const r=(source[rec.source_table]||[]).find(row=>row.source_row===rec.source_row).data;
  const relation=rec.kind==='submission'||rec.kind==='assignment_mark'?['svu_assignments',r.assignment_id]
   :rec.kind==='exam_result'?['svu_order_exam',r.exam_order_recid]:null;
  if(!relation || !value(relation[1]))continue;
  const parent=sourceIndexes.get(relation[0])?.get(legacyKey(relation[1]));
  if(!parent){rec.issues.push('parent_missing_or_ambiguous');continue;}
  const a=contexts.get(rec.context_id),b=contexts.get(parent.context_id);
  if(['source_course_code','source_programme_code','course_id','programme_version_id','source_intake','term','study_year','academic_year'].some(k=>a[k]!=null&&b[k]!=null&&legacyKey(a[k])!==legacyKey(b[k]))) {
   rec.issues.push('parent_context_conflict');continue;
  }
  rec.parent_record_id=parent.id;
  // Fill only missing context fields from the exact parent; no date-based inference.
  const merged={...a};for(const key of ['source_intake','term','study_year','academic_year'])if(merged[key]==null)merged[key]=b[key];
  const {id:unused,...payload}=merged;
  const mergedId=id('context',Object.values(payload).map(v=>typeof v==='string'?legacyKey(v):v));
  contexts.set(mergedId,{id:mergedId,...payload});rec.context_id=mergedId;
 }
 const relations=[];
 const examIndex=uniqueIndex(records.filter(r=>r.kind==='exam_result'),r=>JSON.stringify([r.student_id,r.context_id]));
 const submissions=sourceIndexes.get('svu_student_assignment');
 for(const rec of records){
  const raw=(source[rec.source_table]||[]).find(row=>row.source_row===rec.source_row).data;
  const related=rec.kind==='assignment_mark'?submissions?.get(legacyKey(raw.assignment_tracking_no))
   :rec.kind==='progression'&&rec.student_id?examIndex.get(legacyKey(JSON.stringify([rec.student_id,rec.context_id]))):null;
  if(related && related.student_id===rec.student_id && related.context_id===rec.context_id){
   relations.push({record_id:rec.id,related_record_id:related.id,relation:rec.kind==='assignment_mark'?'mark_for_submission':'progression_for_exam'});
  }
 }
 const used=new Set(records.map(r=>r.context_id));
 return {contexts:[...contexts.values()].filter(c=>used.has(c.id)),records,relations};
}
function validDate(v) {
 const s=String(v||'').slice(0,10);
 return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!s.startsWith('0000')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;
}
