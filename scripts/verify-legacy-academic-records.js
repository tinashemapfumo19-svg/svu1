import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import pg from 'pg';
import {loadConfig} from '../server/config.js';
import {createRepository} from '../server/repository.js';
import {createRouter} from '../server/router.js';
import {legacyAcademicFor,legacyTeachingContexts} from '../server/modules/legacy-academics.js';
import {chromium} from '@playwright/test';

const config=loadConfig(),pool=new pg.Pool({connectionString:config.databaseUrl});
let server,browser;
try {
 const report=JSON.parse(readFileSync('data/legacy-cutover/academic-records-applied.json'));
 const totals=(await pool.query(`select count(*)::int as records,count(*) filter(where parent_record_id is not null)::int as parents,
 count(*) filter(where jsonb_array_length(issues)>0)::int as issues from legacy_academic_records`)).rows[0];
 assert.equal(totals.records,report.records);assert.equal(totals.parents,report.parentLinks);assert.equal(totals.issues,report.issues.length);
 const assessmentRelations=(await pool.query('select relation,count(*)::int as count from legacy_academic_relations group by relation order by relation')).rows;
 assert.equal(assessmentRelations.reduce((sum,r)=>sum+r.count,0),report.assessmentRelations);
 assert.equal((await pool.query(`select count(*)::int as n from legacy_academic_records r join legacy_source_rows s
  on (s.import_id,s.source_table,s.source_row)=(r.import_id,r.source_table,r.source_row)
  where s.target_id<>r.id or s.target_type<>'legacy_academic_records'`)).rows[0].n,0);
 const selected=(await pool.query(`select r.student_programme_id as id,s.account_id as "accountId"
  from legacy_academic_records r join students s on s.id=r.student_id
  where r.kind='exam_result' and r.published=true limit 1`)).rows[0];
 const permissions=['registry.view','registry.self','results.view','teaching.view','teaching.self'];
 const admin={accountId:'legacy-verification',permissions,roles:[{code:'system_administrator',scope:{},permissions}]};
 const student={accountId:selected.accountId,permissions:['registry.self'],roles:[{code:'student',scope:{},permissions:['registry.self']}]};
 const repo=createRepository(pool,{dataEncryptionKey:config.dataEncryptionKey,mfaPolicy:'enrolled'});
 const detail=await repo.getRegistryProgramme(selected.id,admin);assert.ok(detail.legacyAcademic.courses.length);assert.ok(detail.legacyAcademic.results.length);
 const mine=await repo.getOwnStudent(student),own=mine.programmes.find(p=>p.id===selected.id).legacyAcademic;
 assert.ok(own.courses.length);assert.ok(own.results.length);assert.ok(own.results.every(r=>r.published===true));
 const other=(await pool.query('select id from student_programmes where id<>$1 limit 1',[selected.id])).rows[0];
 await assert.rejects(repo.listProgrammeRegistrations(other.id,student,true),{statusCode:404});
 const restricted={...admin,authorizingPermission:'registry.view',roles:[{code:'scoped',scope:{programmeCodes:['UNRELATED'],intakeIds:[]},permissions}]};
 await assert.rejects(repo.getRegistryProgramme(selected.id,restricted),{statusCode:403});
 assert.equal((await repo.getRegistryProgramme(selected.id,{...admin,permissions:['registry.view'],authorizingPermission:'registry.view'})).legacyAcademic.results.length,0);
 assert.equal((await legacyAcademicFor(pool,selected.id,{own:true,includeResults:true})).results.filter(r=>r.published!==true).length,0);
 const contexts=await legacyTeachingContexts(pool,{...admin,authorizingPermission:'teaching.view'});
 const chosen=contexts.find(c=>c.students>0);assert.ok(chosen);
 const list=await repo.legacyClassList(chosen.contextId,chosen.staffId,admin);assert.equal(list.students.length,chosen.students);
 await assert.rejects(repo.legacyClassList(chosen.contextId,chosen.staffId,{...restricted,authorizingPermission:'teaching.view'}),{statusCode:404});
 const staff=(await pool.query('select account_id,status from staff_members where id=$1',[chosen.staffId])).rows[0];
 const lecturer={accountId:staff.account_id,permissions:['teaching.self'],roles:[{code:'lecturer',scope:{},permissions:['teaching.self']}]};
 if(staff.status==='active')assert.equal((await repo.legacyClassList(chosen.contextId,chosen.staffId,lecturer)).students.length,chosen.students);
 await assert.rejects(repo.legacyClassList(chosen.contextId,chosen.staffId,{...lecturer,accountId:'unrelated'}),{statusCode:404});
 // Exercise route permission and response wiring with transient test actors.
 const tokens={admin,student,lecturer,restricted};
 server=createServer(createRouter({rootDir:process.cwd(),config,logger:{info(){},error(){}},
  repository:{...repo,authenticateSession:async token=>tokens[token]||null}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,token)=>(await fetch(base+path,{headers:{authorization:`Bearer ${token}`}}));
 const path=`/api/teaching/legacy-contexts/${chosen.contextId}/staff/${chosen.staffId}/class-list`;
 assert.equal((await request(path,'admin')).status,200);
 assert.equal((await request(path,'student')).status,403);
 const registryResponse=await request(`/api/registry/programmes/${selected.id}`,'admin');assert.equal(registryResponse.status,200);
 assert.ok((await registryResponse.json()).data.legacyAcademic.courses.length);
 const studentResponse=await request('/api/registry/me','student');assert.equal(studentResponse.status,200);
 assert.ok((await studentResponse.json()).data.programmes.some(p=>p.legacyAcademic.courses.length));
 // Render the actual history components at desktop and mobile widths.
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.addScriptTag({path:'src/legacy-academics.js'});
 const html=await page.evaluate(({history,contexts,list})=>window.legacyAcademicUI.courses(history)+window.legacyAcademicUI.results(history)+window.legacyAcademicUI.teaching(contexts,{[`${list.contextId}:${list.staffId}`]:list}),{history:own,contexts:[chosen],list});
 const css=[...readFileSync('index.html','utf8').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>`<link rel="stylesheet" href="${base}/${m[1]}">`).join('');
 await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${css}</head><body><main class="ui-stack" style="padding:16px">${html}</main></body></html>`);
 assert.equal(await page.locator('[data-legacy-courses]').count(),1);assert.equal(await page.locator('[data-legacy-results]').count(),1);
 mkdirSync('data/legacy-academic-verification',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('details').evaluate(e=>e.open=true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`data/legacy-academic-verification/history-${width}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);
 const verification={passed:true,totals,assessmentRelations,memberships:report.memberships,checks:['Source projection totals and parent links','Student ownership','Published legacy results only for students','Result permissions','Programme scope','Historical class roster','Lecturer ownership','HTTP route permissions','Desktop and mobile history rendering']};
 writeFileSync('data/legacy-cutover/academic-records-verification.json',JSON.stringify(verification,null,2));console.log(JSON.stringify(verification));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
