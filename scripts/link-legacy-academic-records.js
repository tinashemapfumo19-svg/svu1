import pg from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {loadConfig} from '../server/config.js';
import {decryptSecret} from '../server/security.js';
import {insertAudit} from '../server/support.js';
import {academicSourceTables,buildLegacyAcademicPlan} from '../server/modules/legacy-academic-plan.js';

const db=new pg.Client({connectionString:loadConfig().databaseUrl});
const apply=process.argv.includes('--apply');
try {
 await db.connect();await db.query('begin');
 await db.query("select pg_advisory_xact_lock(hashtext('svu:legacy-university-links'))");
 const imports=(await db.query('select id,source_sha256 from legacy_imports')).rows;
 if(imports.length!==1)throw Error('Exactly one reconciled source import is required.');
 const sourceImport=imports[0],key=readFileSync('data/legacy-cutover/archive-key.bin'),source={};
 const rows=(await db.query('select source_table,source_row,row_sha256,payload_encrypted from legacy_source_rows where import_id=$1 and source_table=any($2) order by source_table,source_row',
  [sourceImport.id,[...academicSourceTables,'svu_staff_members']])).rows;
 for(const row of rows){const decoded=decryptSecret(row.payload_encrypted,key);
  if(createHash('sha256').update(decoded).digest('hex')!==row.row_sha256)throw Error('Archived source checksum differs.');
  (source[row.source_table]??=[]).push({source_row:row.source_row,data:JSON.parse(decoded)});
 }
 const targets={
  programmes:(await db.query("select v.id,p.code from programmes p join programme_versions v on v.programme_id=p.id where v.version_label='Legacy catalogue'")).rows,
  courses:(await db.query('select id,code from courses where legacy_source_ref is not null')).rows,
  students:(await db.query('select id,student_number from students')).rows,
  studentProgrammes:(await db.query('select id,student_id,programme_version_id from student_programmes')).rows,
  staff:(await db.query('select id,legacy_source_ref from staff_members where legacy_source_ref is not null')).rows.map(s=>({...s,
   source_code:source.svu_staff_members.find(r=>s.legacy_source_ref===`svu_staff_members:${r.source_row}`)?.data.staff_id}))
 };
 const plan=buildLegacyAcademicPlan(sourceImport.id,source,targets);
 const report={sourceSha256:sourceImport.source_sha256,applied:false,contexts:plan.contexts.length,records:plan.records.length,
  byKind:{},matchedStudents:0,matchedStudentProgrammes:0,matchedStaff:0,parentLinks:0,assessmentRelations:plan.relations.length,issues:[]};
 for(const r of plan.records){report.byKind[r.kind]=(report.byKind[r.kind]||0)+1;
  if(r.student_id)report.matchedStudents++;if(r.student_programme_id)report.matchedStudentProgrammes++;
  if(r.staff_id)report.matchedStaff++;if(r.parent_record_id)report.parentLinks++;
  if(r.issues.length)report.issues.push({table:r.source_table,row:r.source_row,reasons:r.issues});
 }
 if(apply){
  await saveMany('legacy_academic_contexts',plan.contexts);
  // Parents precede children in the planner's dependency order.
  await saveMany('legacy_academic_records',plan.records);
  for(const relation of plan.relations)await db.query(`insert into legacy_academic_relations(record_id,related_record_id,relation)
   values($1,$2,$3) on conflict do nothing`,[relation.record_id,relation.related_record_id,relation.relation]);
  await db.query(`update legacy_source_rows s set target_type='legacy_academic_records',target_id=r.id,
   disposition='native_projection_with_original_retained' from legacy_academic_records r
   where (s.import_id,s.source_table,s.source_row)=(r.import_id,r.source_table,r.source_row) and r.import_id=$1`,[sourceImport.id]);
  const count=(await db.query('select count(*)::int as count from legacy_academic_records where import_id=$1',[sourceImport.id])).rows[0].count;
  if(count!==plan.records.length)throw Error('Academic source totals do not reconcile.');
  report.memberships=(await db.query(`select count(*)::int as contexts,count(distinct student_id)::int as students,
   count(distinct (student_id,c.course_id))::int as student_course_pairs from legacy_course_memberships m
   join legacy_academic_contexts c on c.id=m.context_id where c.import_id=$1`,[sourceImport.id])).rows[0];
  report.unlinkedStudentProgrammes=(await db.query('select count(*)::int as count from legacy_course_memberships where student_programme_id is null')).rows[0].count;
  await insertAudit(db,{actorId:'user_authorized_university_alignment',action:'legacy.academic_relationships.linked',
   subjectType:'LegacyImport',subjectId:sourceImport.id,reason:'Link source course memberships, lecturers, assessments, examinations and results with explicit source evidence',
   metadata:{records:report.records,contexts:report.contexts,memberships:report.memberships,issueRows:report.issues.length}});
  await db.query('commit');report.applied=true;
 }else await db.query('rollback');
 writeFileSync(`data/legacy-cutover/academic-records-${apply?'applied':'preview'}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,issues:undefined,issueRows:report.issues.length}));
}catch(e){await db.query('rollback').catch(()=>{});console.error(JSON.stringify({applied:false,error:e.code||e.message}));process.exitCode=1;}
finally{await db.end();}

async function saveMany(table,rows){
 for(let offset=0;offset<rows.length;offset+=400){
 const batch=rows.slice(offset,offset+400),keys=Object.keys(batch[0]),values=[];
 const placeholders=batch.map(row=>`(${keys.map(k=>{values.push(['details','issues'].includes(k)?JSON.stringify(row[k]):row[k]);return `$${values.length}`;}).join(',')})`);
 await db.query(`insert into ${table} (${keys.join(',')}) values ${placeholders.join(',')} on conflict(id) do nothing`,values);
 const stored=new Map((await db.query(`select * from ${table} where id=any($1)`,[batch.map(r=>r.id)])).rows.map(r=>[r.id,r]));
 for(const row of batch){const saved=stored.get(row.id);
 // pg dates are returned as Date values; compare their calendar representation.
 for(const k of keys){let actual=saved[k];if(actual instanceof Date)actual=`${actual.getFullYear()}-${String(actual.getMonth()+1).padStart(2,'0')}-${String(actual.getDate()).padStart(2,'0')}`;
  if(!isDeepStrictEqual(actual,row[k]))throw Error(`Stored ${table} differs from its source (${k}).`);
 }
 }
 }
}
