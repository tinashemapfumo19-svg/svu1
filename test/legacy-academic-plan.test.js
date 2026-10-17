import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLegacyAcademicPlan} from '../server/modules/legacy-academic-plan.js';

const targets={programmes:[{id:'v',code:'P'}],courses:[{id:'c',code:'C'}],students:[{id:'s',student_number:'S'}],
 studentProgrammes:[{id:'sp',student_id:'s',programme_version_id:'v'}],staff:[{id:'t',source_code:'T'}]};
const row=data=>({source_row:1,data});
const exam={programmecode:'p',coursecode:'c',student_id:'s',lecturer_id:'t',semester:'1',exam_year:'2019',exam_year_level:'2',intake:'January2018',published:'1',record_id:'10',exam_order_recid:'20',exam_mark:'69',grade:'B',points:'3.00'};
test('source exams keep exact marks, lecturer, cohort and parent without inventing current approvals',()=>{
 const source={svu_student_exam:[row(exam)],svu_order_exam:[row({...exam,student_id:undefined,record_id:'20'})]};
 const plan=buildLegacyAcademicPlan('i',source,targets),record=plan.records.find(r=>r.kind==='exam_result');
 assert.equal(record.student_programme_id,'sp');assert.equal(record.staff_id,'t');assert.equal(record.details.exam_mark,'69');
 assert.equal(record.published,true);assert.equal(record.parent_record_id,plan.records.find(r=>r.kind==='exam_order').id);
 assert.deepEqual(record.issues,[]);assert.equal(plan.contexts[0].academic_year,'2019');
 assert.equal(plan.contexts[0].starts_on,null);assert.deepEqual(plan,buildLegacyAcademicPlan('i',source,targets));
});
test('assignment membership inherits an exact parent cohort but never derives academic year from dates',()=>{
 const plan=buildLegacyAcademicPlan('i',{svu_assignments:[row({record_id:'a',programmecode:'P',subjectcode:'C',intake:'July2020',post_date:'2022-04-01',yearlevel:'2',term:'1'})],
  svu_student_assignment:[row({assignment_id:'a',programmecode:'P',coursecode:'C',student_id:'S',lecturer_id:'T',tracking_no:'x',yearlevel:'2',term:'1'})]},targets);
 const rec=plan.records.find(r=>r.kind==='submission'),c=plan.contexts.find(c=>c.id===rec.context_id);
 assert.equal(c.source_intake,'July2020');assert.equal(c.academic_year,null);assert.ok(rec.parent_record_id);
});
test('orphan and conflicting parents remain unresolved rather than joining unrelated courses or students',()=>{
 const source={svu_order_exam:[row({...exam,record_id:'20',coursecode:'Other'})],svu_student_exam:[row(exam)]};
 const plan=buildLegacyAcademicPlan('i',source,targets),rec=plan.records.find(r=>r.kind==='exam_result');
 // A parent with an unresolved course cannot establish the child's course identity.
 assert.equal(plan.records.find(r=>r.kind==='exam_order').issues.includes('course_missing_or_ambiguous'),true);
 assert.equal(rec.parent_record_id,null);assert.ok(rec.issues.includes('parent_context_conflict'));
 const ambiguous=buildLegacyAcademicPlan('i',{svu_student_exam:[row({...exam,student_id:'missing',lecturer_id:'unknown',exam_order_recid:'unknown'})]},targets).records[0];
 assert.equal(ambiguous.student_id,null);assert.equal(ambiguous.staff_id,null);assert.equal(ambiguous.parent_record_id,null);
 assert.ok(ambiguous.issues.includes('student_missing_or_ambiguous'));assert.ok(ambiguous.issues.includes('parent_missing_or_ambiguous'));
});
test('duplicate codes and mismatched student programmes never silently select a match',()=>{
 const plan=buildLegacyAcademicPlan('i',{svu_student_exam:[row(exam)]},{...targets,staff:[...targets.staff,{id:'other',source_code:'t'}],studentProgrammes:[{id:'other',student_id:'s',programme_version_id:'other'}]});
 const rec=plan.records[0];assert.equal(rec.staff_id,null);assert.equal(rec.student_programme_id,null);
 assert.ok(rec.issues.includes('staff_missing_or_ambiguous'));assert.ok(rec.issues.includes('student_programme_missing_or_ambiguous'));
});
test('progression and assignment marks link only to unique matching student evidence',()=>{
 const base={programmecode:'P',coursecode:'C',student_id:'S',lecturer_id:'T',yearlevel:'2',term:'1'};
 const source={svu_student_exam:[row(exam)],svu_student_exam_progression:[row({...exam,record_id:undefined,trans_id:'p'})],
  svu_student_assignment:[row({...base,tracking_no:'tracking'})],
  svu_recorded_assignments:[row({...base,record_id:'mark',assignment_tracking_no:'tracking'})]};
 const plan=buildLegacyAcademicPlan('i',source,targets);
 assert.equal(plan.relations.length,2);assert.deepEqual(plan.relations.map(r=>r.relation).sort(),['mark_for_submission','progression_for_exam']);
 const wrong=buildLegacyAcademicPlan('i',{...source,svu_recorded_assignments:[row({...base,student_id:'unknown',assignment_tracking_no:'tracking'})]},targets);
 assert.equal(wrong.relations.filter(r=>r.relation==='mark_for_submission').length,0);
 const duplicate=buildLegacyAcademicPlan('i',{...source,svu_student_exam:[row(exam),{source_row:2,data:{...exam,record_id:'second'}}]},targets);
 assert.equal(duplicate.relations.filter(r=>r.relation==='progression_for_exam').length,0);
});
