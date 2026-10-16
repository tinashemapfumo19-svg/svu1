import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDiscussion, discussionPage, createCourseDiscussionModule } from '../server/modules/course-discussions.js';

test('discussion actions reject invalid content, revisions and additional authority fields',()=>{
  const value={title:'Course question',body:'Please explain',requestKey:'request-123'};
  assert.equal(validateDiscussion(value,'create'),value);
  for(const change of [{title:''},{body:' '},{body:'x'.repeat(4001)},{requestKey:'bad'},{authorId:'another'},{hidden:true}]) assert.throws(()=>validateDiscussion({...value,...change},'create'),{statusCode:400});
  for(const value of [null,[],true,'text']) assert.throws(()=>validateDiscussion(value,'reply'),{statusCode:400});
  assert.throws(()=>validateDiscussion({locked:true,revision:0,reason:'Lock'},'lock'),{statusCode:400});
  assert.throws(()=>validateDiscussion({hidden:'true',revision:1,reason:'Hide'},'moderate'),{statusCode:400});
  assert.throws(()=>validateDiscussion({reason:' '},'report'),{statusCode:400});
});
test('history cursors require a canonical timestamp and bounded identifier',()=>{
  assert.deepEqual(discussionPage(),[null,null]);
  assert.deepEqual(discussionPage({before:'2026-10-09T00:00:00.000Z|cp_123'}),['2026-10-09T00:00:00.000Z','cp_123']);
  for(const value of [{limit:'9999'},{before:'bad'},{before:'2026-02-31T00:00:00.000Z|cp_123'}]) assert.throws(()=>discussionPage(value),{statusCode:400});
});
test('enrolment checks precede discussion reads and mutations; moderation demands staff access',async()=>{
  const calls=[];
  const db={async query(sql){calls.push(sql);return {rows:[]};},release(){}};
  const pool={async connect(){return db;}};
  const access=async(db,p,c,a,staff)=>{calls.push(staff ? 'staff' : 'participant');throw Object.assign(new Error('Unavailable'),{statusCode:404});};
  const module=createCourseDiscussionModule(pool,access);
  await assert.rejects(module.listCourseDiscussions('p','c',null,{},{}),{statusCode:404});
  assert.deepEqual(calls,['begin','participant','rollback']);calls.length=0;
  await assert.rejects(module.writeCourseDiscussion('p','c','t','post','moderate',{hidden:true,revision:1,reason:'Abuse'},{}),{statusCode:404});
  assert.deepEqual(calls,['begin','staff','rollback']);
});
