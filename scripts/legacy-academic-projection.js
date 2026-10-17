// Move a verified relational projection between databases holding the SAME SQL
// archive. This never exports encrypted archive payloads, credentials or keys.
import pg from 'pg';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadConfig} from '../server/config.js';
import {insertAudit} from '../server/support.js';
import {academicSourceTables} from '../server/modules/legacy-academic-plan.js';

const [mode,path,expectedHash]=process.argv.slice(2);
if(!['export','apply'].includes(mode)||!path)throw Error('Usage: legacy-academic-projection.js export file | apply file sha256');
const db=new pg.Client({connectionString:loadConfig().databaseUrl});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const date=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:v;
const tables=['legacy_academic_contexts','legacy_academic_records','legacy_academic_relations'];
try{
 await db.connect();await db.query('begin isolation level repeatable read');
 await db.query("select pg_advisory_xact_lock(hashtext('svu:legacy-university-links'))");
 const imports=(await db.query('select id,source_sha256 from legacy_imports')).rows;
 if(imports.length!==1)throw Error('One matching legacy import is required.');
 const source=imports[0];
 const sourceRows=(await db.query(`select source_table,source_row,row_sha256 from legacy_source_rows
  where import_id=$1 and source_table=any($2) order by source_table,source_row`,[source.id,academicSourceTables])).rows;
 if(mode==='export'){
  const payload={version:1,source,sourceRows,tables:{}};
  for(const table of tables)payload.tables[table]=(await db.query(`select * from ${table} order by ${table==='legacy_academic_relations'?'record_id,relation,related_record_id':'id'}`)).rows
   .map(row=>Object.fromEntries(Object.entries(row).map(([key,v])=>[key,date(v)])));
  if(payload.tables.legacy_academic_records.length!==sourceRows.length)throw Error('Projection is incomplete.');
  await db.query('rollback');const bytes=Buffer.from(JSON.stringify(payload));writeFileSync(path,bytes,{mode:0o600});
  console.log(JSON.stringify({exported:true,records:sourceRows.length,sha256:sha(bytes)}));
 }else{
  const bytes=readFileSync(path);
  if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||sha(bytes)!==expectedHash)throw Error('Projection checksum differs.');
  const payload=JSON.parse(bytes);
  if(payload.version!==1||!isDeepStrictEqual(payload.source,source)||!isDeepStrictEqual(payload.sourceRows,sourceRows))throw Error('Source archive or row checksums differ.');
  const allowed={
   legacy_academic_contexts:['id','import_id','programme_version_id','course_id','source_programme_code','source_course_code','source_intake','study_year','term','academic_year','starts_on','ends_on'],
   legacy_academic_records:['id','import_id','source_table','source_row','context_id','student_id','student_programme_id','staff_id','moderator_staff_id','parent_record_id','kind','source_student_code','source_staff_code','source_moderator_code','source_record_code','published','details','issues'],
   legacy_academic_relations:['record_id','related_record_id','relation']
  };
  const records=payload.tables.legacy_academic_records;
  if(records.length!==sourceRows.length)throw Error('Projection is incomplete.');
  const sourceKeys=new Set(sourceRows.map(r=>`${r.source_table}:${r.source_row}`));
  for(const r of records)if(r.import_id!==source.id||!sourceKeys.delete(`${r.source_table}:${r.source_row}`))throw Error('Unexpected or duplicate source record.');
  for(const table of tables){
   const rows=payload.tables[table],keys=allowed[table];
   for(const row of rows)if(!isDeepStrictEqual(Object.keys(row).sort(),[...keys].sort()))throw Error('Unexpected projection fields.');
   // Self-referencing parents may be later in the exported ID order. Insert
   // parents first, then the children; source parent graphs have one level.
   const ordered=table==='legacy_academic_records'?[...rows.filter(r=>!r.parent_record_id),...rows.filter(r=>r.parent_record_id)]:rows;
   for(let offset=0;offset<ordered.length;offset+=300){
    const batch=ordered.slice(offset,offset+300),values=[];
    const placeholders=batch.map(row=>`(${keys.map(k=>{values.push(['details','issues'].includes(k)?JSON.stringify(row[k]):row[k]);return `$${values.length}`;}).join(',')})`);
    await db.query(`insert into ${table}(${keys.join(',')}) values ${placeholders.join(',')} on conflict do nothing`,values);
   }
   const actual=(await db.query(`select * from ${table}`)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,v])=>[key,date(v)])));
   const identity=r=>table==='legacy_academic_relations'?JSON.stringify([r.record_id,r.relation,r.related_record_id]):r.id;
   const saved=new Map(actual.map(r=>[identity(r),r]));
   for(const row of rows)if(!isDeepStrictEqual(saved.get(identity(row)),row))throw Error('Stored projection differs from its source.');
  }
  await db.query(`update legacy_source_rows s set target_type='legacy_academic_records',target_id=r.id,
   disposition='native_projection_with_original_retained' from legacy_academic_records r
   where (s.import_id,s.source_table,s.source_row)=(r.import_id,r.source_table,r.source_row) and r.import_id=$1`,[source.id]);
  const memberships=(await db.query(`select count(*)::int as contexts,count(distinct student_id)::int as students,
   count(distinct (student_id,c.course_id))::int as student_course_pairs from legacy_course_memberships m join legacy_academic_contexts c on c.id=m.context_id where c.import_id=$1`,[source.id])).rows[0];
  await insertAudit(db,{actorId:'user_authorized_deployment',action:'legacy.academic_projection.deployed',subjectType:'LegacyImport',subjectId:source.id,
   reason:'Deploy verified academic relationships to the database with identical source archive and row checksums',metadata:{sha256:expectedHash,records:records.length,memberships}});
  await db.query('commit');console.log(JSON.stringify({applied:true,records:records.length,relations:payload.tables.legacy_academic_relations.length,memberships}));
 }
}catch(e){await db.query('rollback').catch(()=>{});console.error(JSON.stringify({applied:false,error:e.code||e.message}));process.exitCode=1;}
finally{await db.end();}
