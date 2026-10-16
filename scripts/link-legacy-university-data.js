import pg from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadConfig} from '../server/config.js';
import {decryptSecret} from '../server/security.js';
import {insertAudit} from '../server/support.js';

const key=readFileSync('data/legacy-cutover/archive-key.bin');
const db=new pg.Client({connectionString:loadConfig().databaseUrl});
const norm=v=>String(v??'').trim().toLowerCase();
const text=v=>String(v??'').replaceAll('\0','').trim();
const report={curriculumLinks:0,programmesWithModules:0,teachingLinks:0,matchedTeachingStaff:0,staffProfiles:0,studyYearLinks:0,issues:[]};
try {
 await db.connect();await db.query('begin');await db.query("select pg_advisory_xact_lock(hashtext('svu:legacy-university-links'))");
 const source=(await db.query('select id,source_sha256 from legacy_imports')).rows;
 if(source.length!==1)throw Error('Select one reconciled legacy import before linking.');
 const importId=source[0].id;
 const selected=(await db.query(`select source_table,source_row,payload_encrypted from legacy_source_rows
  where import_id=$1 and source_table in ('svu_course_codes','svu_subject_allocation','svu_staff_members','svu_study_progression') order by source_table,source_row`,[importId])).rows;
 const rows=table=>selected.filter(r=>r.source_table===table).map(r=>({...r,data:JSON.parse(decryptSecret(r.payload_encrypted,key))}));
 const programmes=(await db.query(`select p.code,v.id from programmes p join programme_versions v on v.programme_id=p.id where v.version_label='Legacy catalogue'`)).rows;
 const versions=new Map(programmes.map(p=>[norm(p.code),p.id]));
 const courses=new Map((await db.query('select id,code from courses')).rows.map(c=>[norm(c.code),c.id]));
 const staffRows=(await db.query('select id,legacy_source_ref from staff_members where legacy_source_ref is not null')).rows;
 const staffByRef=new Map(staffRows.map(r=>[r.legacy_source_ref,r.id]));
 const staffByCode=new Map();
 for(const row of rows('svu_staff_members'))if(staffByRef.has(`svu_staff_members:${row.source_row}`))staffByCode.set(norm(row.data.staff_id),staffByRef.get(`svu_staff_members:${row.source_row}`));
 const moduleVersions=new Map(),linkedVersions=new Set();
 for(const row of rows('svu_course_codes')) {
  const r=row.data,course=courses.get(norm(r.coursecode)),version=versions.get(norm(r.programmecode)),year=Number(r.year_level),term={1:'S1',2:'S2',3:'S3'}[r.term];
  if(!course||!version||!Number.isInteger(year)||year<1||year>8||!term)throw Error('A source module mapping cannot be resolved without guessing.');
  const ref=`svu_course_codes:${row.source_row}`;
  const id='legacy_curriculum_'+createHash('sha256').update(ref).digest('hex').slice(0,24);
  await db.query(`insert into curriculum_entries(id,programme_version_id,course_id,year_of_study,term,requirement_type,legacy_source_ref)
   values($1,$2,$3,$4,$5,null,$6) on conflict(legacy_source_ref) do nothing`,[id,version,course,year,term,ref]);
  const saved=(await db.query('select programme_version_id,course_id,year_of_study,term from curriculum_entries where legacy_source_ref=$1',[ref])).rows[0];
  if(saved.programme_version_id!==version||saved.course_id!==course||saved.year_of_study!==year||saved.term!==term)throw Error('A previously linked curriculum differs from the source.');
  report.curriculumLinks++;linkedVersions.add(version);moduleVersions.set(norm(r.coursecode),version);
 }
 report.programmesWithModules=linkedVersions.size;
 for(const row of rows('svu_subject_allocation')) {
  const r=row.data,course=courses.get(norm(r.subject_code)),version=moduleVersions.get(norm(r.subject_code)),staff=staffByCode.get(norm(r.staff_id))||null;
  if(!course||!version)throw Error('Teaching assignment course/programme mapping is unavailable.');
  const ref=`svu_subject_allocation:${row.source_row}`;
  await db.query(`insert into legacy_teaching_links(source_ref,source_import_id,course_id,programme_version_id,staff_id,source_staff_code,source_active,source_allocation_date,reconciliation_status)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(source_ref) do nothing`,[ref,importId,course,version,staff,text(r.staff_id),r.active==='1',r.allocation_date,staff?'period_mapping_required':'staff_and_period_mapping_required']);
  const saved=(await db.query('select course_id,programme_version_id,staff_id,source_active from legacy_teaching_links where source_ref=$1',[ref])).rows[0];
  if(saved.course_id!==course||saved.programme_version_id!==version||saved.staff_id!==staff||saved.source_active!==(r.active==='1'))throw Error('A previous teaching link differs from the source.');
  await db.query("update legacy_source_rows set target_type='legacy_teaching_links',target_id=$1,disposition='native_projection_with_original_retained' where import_id=$2 and source_table='svu_subject_allocation' and source_row=$3",[ref,importId,row.source_row]);
  report.teachingLinks++;if(staff)report.matchedTeachingStaff++;else report.issues.push({table:row.source_table,row:row.source_row,reason:'Staff code not found; course/programme link retained.'});
 }
 for(const row of rows('svu_staff_members')) {
  const r=row.data,staff=staffByRef.get(`svu_staff_members:${row.source_row}`);if(!staff)continue;
  const supervisor=staffByCode.get(norm(r.supervisor_id));
  await db.query(`update staff_members set legacy_department_code=$2,legacy_category=$3,legacy_grade=$4,legacy_supervisor_staff_id=$5 where id=$1`,
   [staff,text(r.department)||null,text(r.staff_category)||null,text(r.staff_grade)||null,supervisor&&supervisor!==staff?supervisor:null]);
  report.staffProfiles++;
 }
 for(const row of rows('svu_study_progression')) {
  const r=row.data,programmes=(await db.query(`select sp.id from student_programmes sp join students s on s.id=sp.student_id where lower(btrim(s.student_number))=$1`,[norm(r.student_id)])).rows;
  if(programmes.length!==1){report.issues.push({table:row.source_table,row:row.source_row,reason:'No unique student programme for recorded study year.'});continue;}
  await db.query('update student_programmes set legacy_recorded_study_year=$2,legacy_study_year_updated_on=$3 where id=$1',[programmes[0].id,text(r.current_study_year),r.updated_on]);
  await db.query("update legacy_source_rows set target_type='student_programmes',target_id=$1,disposition='native_projection_with_original_retained' where import_id=$2 and source_table='svu_study_progression' and source_row=$3",[programmes[0].id,importId,row.source_row]);
  report.studyYearLinks++;
 }
 if(report.curriculumLinks!==182||report.teachingLinks!==161||report.matchedTeachingStaff!==160||report.staffProfiles!==115)throw Error('Source relationship totals do not reconcile.');
 await insertAudit(db,{actorId:'user_authorized_university_alignment',action:'legacy.university_relationships.linked',subjectType:'LegacyImport',subjectId:importId,
  reason:'User requested alignment of university programmes, courses and related source records with the new system',metadata:report});
 await db.query('commit');report.applied=true;
 writeFileSync('data/legacy-cutover/university-data-links.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error){await db.query('rollback').catch(()=>{});console.error(JSON.stringify({applied:false,code:error.code||'validation',reason:error.code?'Database operation refused; transaction rolled back.':error.message}));process.exitCode=1;}
finally{await db.end();}
