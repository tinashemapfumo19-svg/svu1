import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCourseFile, validateCourseResource, validateCourseReview, createCourseWorkspaceModule } from '../server/modules/course-workspace.js';

const resource = changes => ({kind:'link',section:'Discussion Groups',title:'Course WhatsApp group',description:'Course discussion',url:'https://chat.whatsapp.com/example',status:'published',pinned:false,allowLate:false,position:0,sectionPosition:0,...changes});
test('assignment reviews validate bounded marks, explicit release and optimistic revision',()=>{
  const review={submissionId:'u1',revision:0,mark:0,maxMark:100,feedback:'Needs revision',release:false,reason:'First marking'};
  assert.equal(validateCourseReview(review).mark,0);
  assert.equal(validateCourseReview({...review,mark:null}).mark,null);
  for (const change of [{mark:-1},{mark:101},{mark:NaN},{maxMark:0},{mark:1.111},{revision:-1},{release:'true'},{reason:''},{unknown:true},{mark:null,feedback:''}]) assert.throws(()=>validateCourseReview({...review,...change}),{statusCode:400});
});
test('custom resources accept safe links and reject invalid or executable URLs',()=>{
  assert.equal(validateCourseResource(resource()).section,'Discussion Groups');
  for(const url of ['javascript:alert(1)','data:text/html,test','https://user:password@example.com','not-a-url']) assert.throws(()=>validateCourseResource(resource({url})),{statusCode:400});
  for(const change of [{title:''},{section:''},{kind:'html'},{status:'visible'},{position:-1},{pinned:'true'},{unexpected:true}]) assert.throws(()=>validateCourseResource(resource(change)),{statusCode:400});
});
test('classes and assignments require timezone-aware dates and their required fields',()=>{
  assert.throws(()=>validateCourseResource(resource({kind:'class'})),{statusCode:400});
  assert.throws(()=>validateCourseResource(resource({kind:'assignment'})),{statusCode:400});
  assert.throws(()=>validateCourseResource(resource({kind:'assignment',dueAt:'2026-12-01T10:00'})),{statusCode:400});
  assert.equal(validateCourseResource(resource({kind:'assignment',dueAt:'2026-12-01T10:00:00+02:00'})).dueAt,'2026-12-01T08:00:00.000Z');
});
test('uploads reject unsafe filenames, oversized bodies, mismatched signatures and invalid UTF-8',()=>{
  const pdf={fileName:'lesson.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')};
  assert.equal(decodeCourseFile(pdf).contentType,'application/pdf');
  const large=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(2*1024*1024,32)]);
  assert.equal(decodeCourseFile({...pdf,base64:large.toString('base64')}).sizeBytes,large.length);
  assert.equal(decodeCourseFile({fileName:'work.txt',base64:Buffer.from('My work').toString('base64')}).sizeBytes,7);
  for(const change of [{fileName:'../lesson.pdf'},{fileName:'lesson.html'},{base64:'!!!'},{base64:Buffer.from('not a PDF').toString('base64')},{base64:''},{base64:'A'.repeat(14000000)}]) assert.throws(()=>decodeCourseFile({...pdf,...change}),{statusCode:400});
  assert.throws(()=>decodeCourseFile({fileName:'work.txt',base64:Buffer.from([0xff]).toString('base64')}),{statusCode:400});
});
test('unauthorized course publishing fails before any bytes are written',async()=>{
  let writes=0;
  const pool={async query(sql){return {rows:sql.includes('select c.code') ? [{code:'CS101',title:'Computing'}] : [],rowCount:0};}};
  const module=createCourseWorkspaceModule(pool,{storage:{async put(){writes++;}}});
  await assert.rejects(module.saveCourseResource('p','c',null,resource({file:{fileName:'test.pdf',base64:'JVBERi0='}}),{accountId:'outsider',permissions:['teaching.self']}),{statusCode:404});
  assert.equal(writes,0);
});
