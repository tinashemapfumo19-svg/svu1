import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResultsModule,publishedStudentResultRows } from '../server/modules/results.js';
const row={programmeId:'sp1',registrationId:'r1',courseId:'c1',code:'C101',title:'Foundations',credits:15,mark:75,grade:'A'};
const policy={rule:{id:'rule',version:1,rules:{creditWeighted:true,retakePolicy:'latest',excludeGrades:[],includeFailed:true,rounding:{decimals:2,mode:'half_up'}}},scheme:{id:'scheme',version:1,bands:[{minMark:0,maxMark:39,grade:'F',points:0,passing:false},{minMark:40,maxMark:100,grade:'A',points:4,passing:true}],classifications:[{minGpa:2,label:'Pass'}]}};
function fixture(amendments=[]) {
  const queries=[],batch={id:'batch',sourceRef:'Published fixture',publishedAt:'2026-10-09T00:00:00Z',periodId:'period',policy,rows:[row,{...row,programmeId:'sp2',registrationId:'r2',mark:99}]};
  const client={release(){},async query(sql,values){queries.push({sql,values});if(sql.includes('from student_programmes sp'))return {rows:[{accountId:'owner',id:'sp1'}]};
    if(sql.includes('from result_batches')){assert.match(sql,/status = 'published'/);return {rows:[batch]};}
    if(sql.includes('from academic_results')){assert.match(sql,/student_programme_id=\$2/);assert.equal(values[1],'sp1');return {rows:amendments};}return {rows:[]};}};
  return {client,queries,pool:{async connect(){return client;}}};
}
test('released results are programme filtered and use the original published mark unless amended',async () => {
  const f=fixture(),published=await publishedStudentResultRows(f.client,'sp1');
  assert.equal(published.length,1);assert.deepEqual(published[0].rows,[row]);
  const amended=await publishedStudentResultRows(fixture([{registrationId:'r1',courseId:'c1',snapshot:{...row,mark:81}}]).client,'sp1');
  assert.equal(amended[0].rows[0].mark,81);assert.equal(amended[0].rows[0].publishedMark,75);assert.equal(amended[0].rows[0].amended,true);
});
test('student result responses retain their flat batch shape and existing GPA calculation',async () => {
  const f=fixture(),result=await createResultsModule(f.pool).listProgrammeResults('sp1',{accountId:'owner'},true);
  assert.equal(result.length,1);assert.equal(Array.isArray(result[0]),false);assert.equal(result[0].batchId,'batch');assert.deepEqual(result[0].results,[row]);assert.equal(result[0].gpa,4);
});
test('ordinary student ownership is checked before the released-results query',async () => {
  const f=fixture();await assert.rejects(createResultsModule(f.pool).listProgrammeResults('sp1',{accountId:'other'},true),{statusCode:404});
  assert.equal(f.queries.some(q => q.sql.includes('from result_batches')),false);
});
