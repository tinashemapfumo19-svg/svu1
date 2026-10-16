import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const isolated = process.env.DATABASE_URL && /^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname);
test.skip(!isolated,'Course workspace fixtures require the isolated integration database.');
test.beforeAll(()=>{
  test.setTimeout(240000);
  execFileSync(process.execPath,['scripts/seed-walkthrough.js'],{env:process.env,timeout:240000,stdio:'pipe'});
});

test('lecturers publish flexible resources and students expand courses, upload and retain receipts',async({page,browser,request},info)=>{
  test.setTimeout(240000);
  const stamp=`${info.project.name}-${Date.now()}`;
  const api=async(method,path,data,token,status=200)=>{
    const response=await request.fetch(path,{method,data,headers:token ? {Authorization:`Bearer ${token}`} : {}});
    expect(response.status(),`${method} ${path}: ${await response.text()}`).toBe(status);
    return (await response.json()).data;
  };
  const login=(email,password)=>api('POST','/api/identity/sessions',{email,password},undefined,201);
  const admin=await login('admin@southvalley.test','Phase1-Admin-Password-2026!');
  const student=await login('active.student@southvalley.test','Active-Student-Demo-2026!');
  const me=await api('GET','/api/registry/me',undefined,student.token);
  const registrations=await api('GET',`/api/registry/me/programmes/${me.programmes[0].id}/registrations`,undefined,student.token);
  const period=registrations.find(r=>r.registration.status==='confirmed');
  const course=period.registration.confirmation.courses[0],course2=period.registration.confirmation.courses[1];
  const email=`course.lecturer.${stamp}@example.edu`,password='Kariba-Dam-Staff-2026!';
  const staff=await api('POST','/api/staff',{email,legalName:'Course Lecturer',preferredName:'Lecturer',category:'LECTURER',grade:'L1',departmentId:'dept_computing',engagedOn:'2026-01-01',roleCode:'lecturer',reason:'Course workspace test'},admin.token,201);
  const messages=await Promise.all((await readdir(process.env.SVU_DEV_OUTBOX)).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(join(process.env.SVU_DEV_OUTBOX,f),'utf8'))));
  const activation=messages.find(row=>row.recipientEmail===email).variables.activationToken;
  await api('POST','/api/identity/activations',{token:activation,password,legalName:'Course Lecturer',preferredName:'Lecturer'},undefined,200);
  const lecturer=await login(email,password);
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  let feedbackBefore=0;
  try {
    feedbackBefore=Number((await db.query(`select count(*) as count from notifications n join notification_templates t on t.id=n.template_id join accounts a on a.id=n.recipient_account_id where t.code='course.feedback' and a.email='active.student@southvalley.test'`)).rows[0].count);
    await db.query('delete from course_assignment_reviews where upload_id in (select u.id from course_assignment_uploads u join course_resources r on r.id=u.resource_id where r.period_id=$1 and r.course_id=$2)',[period.period.id,course.courseId]);
    await db.query('delete from course_assignment_uploads where resource_id in (select id from course_resources where period_id=$1 and course_id=$2)',[period.period.id,course.courseId]);
    await db.query('delete from course_resources where period_id=$1 and course_id=$2',[period.period.id,course.courseId]);
    const adminId=(await db.query('select id from accounts where email=$1',['admin@southvalley.test'])).rows[0].id;
    // The walkthrough period is closed; insert a current allocation only in the isolated fixture database.
    await db.query(`insert into teaching_allocations(period_id,course_id,staff_id,role,workload_units,effective_from,status,reason,proposed_by)
      values($1,$2,$3,'co_lecturer',1,current_date,'active','Course workspace fixture',$4)`,[period.period.id,course.courseId,staff.id,adminId]);
  } finally {await db.end();}
  const base=`/api/course-workspaces/${period.period.id}/${course.courseId}`;
  const discussionInput={title:`Course question ${stamp}`,body:'How do I approach the practical?',requestKey:`discussion-${stamp}`};
  const discussion=await api('POST',`${base}/discussions`,discussionInput,student.token);
  expect(await api('POST',`${base}/discussions`,discussionInput,student.token)).toEqual(discussion);
  await api('POST',`${base}/discussions`,{...discussionInput,body:'Changed content'},student.token,409);
  await api('GET',`/api/course-workspaces/${period.period.id}/${course2.courseId}/discussions/${discussion.id}`,undefined,lecturer.token,404);
  await api('POST',`${base}/discussions/${discussion.id}/lock`,{locked:true,revision:1,reason:'Unauthorized'},student.token,404);
  const reply=await api('POST',`${base}/discussions/${discussion.id}/reply`,{body:'Begin with the reading.',requestKey:`reply-${stamp}`},lecturer.token);
  await api('POST',`${base}/discussions/${discussion.id}/posts/${reply.postId}/report`,{reason:'Please review this response.'},student.token);
  expect((await api('GET',`${base}/discussions/${discussion.id}`,undefined,student.token)).items.find(p=>p.id===reply.postId).reports).toBeNull();
  expect((await api('GET',`${base}/discussions/${discussion.id}`,undefined,lecturer.token)).items.find(p=>p.id===reply.postId).reports).toHaveLength(1);
  await api('POST',`${base}/discussions/${discussion.id}/posts/${reply.postId}/moderate`,{hidden:true,revision:1,reason:'Review reported message'},lecturer.token);
  const hidden=(await api('GET',`${base}/discussions/${discussion.id}`,undefined,student.token)).items.find(p=>p.id===reply.postId);
  expect(hidden.body).toBeNull();expect(hidden.hidden).toBe(true);
  await api('POST',`${base}/discussions/${discussion.id}/posts/${reply.postId}/moderate`,{hidden:false,revision:1,reason:'Stale moderation'},lecturer.token,409);
  await api('POST',`${base}/discussions/${discussion.id}/posts/${reply.postId}/moderate`,{hidden:false,revision:2,reason:'Restore reviewed message'},lecturer.token);
  await api('POST',`${base}/discussions/${discussion.id}/lock`,{locked:true,revision:1,reason:'Pause replies'},lecturer.token);
  await api('POST',`${base}/discussions/${discussion.id}/reply`,{body:'Late reply',requestKey:`locked-${stamp}`},student.token,409);
  await api('POST',`${base}/discussions/${discussion.id}/lock`,{locked:false,revision:1,reason:'Stale unlock'},lecturer.token,409);
  await api('POST',`${base}/discussions/${discussion.id}/lock`,{locked:false,revision:2,reason:'Continue conversation'},lecturer.token);
  for(let n=0;n<31;n++)await api('POST',`${base}/discussions/${discussion.id}/reply`,{body:`History message ${n}`,requestKey:`history-${stamp}-${n}`},student.token);
  const recent=await api('GET',`${base}/discussions/${discussion.id}`,undefined,student.token);
  expect(recent.items).toHaveLength(30);expect(recent.nextCursor).toBeTruthy();
  const older=await api('GET',`${base}/discussions/${discussion.id}?before=${encodeURIComponent(recent.nextCursor)}`,undefined,student.token);
  expect(older.items).toHaveLength(3);expect(older.items.some(p=>recent.items.some(r=>r.id===p.id))).toBe(false);
  const value=changes=>({kind:'note',title:'Resource',section:'Announcements',description:'Course information',url:null,startsAt:null,dueAt:null,allowLate:false,pinned:false,position:0,sectionPosition:0,status:'published',...changes});
  const pdf={fileName:'week-1.pdf',base64:Buffer.from('%PDF-1.4\n% Course material\n%%EOF\n').toString('base64')};
  const material=await api('POST',`${base}/resources`,value({kind:'file',title:'Week 1 reading',section:'Learning Materials',file:pdf}),lecturer.token);
  await api('POST',`${base}/resources`,value({kind:'class',title:'Next online class',section:'Online Classes',url:'https://meet.example.com/course',startsAt:new Date(Date.now()+86400000).toISOString()}),lecturer.token);
  const assignment=await api('POST',`${base}/resources`,value({kind:'assignment',title:'Assignment 1',section:'Assignments',dueAt:new Date(Date.now()+86400000*7).toISOString()}),lecturer.token);
  const secret=await api('POST',`${base}/resources`,value({title:'Draft lecturer notes',status:'draft'}),lecturer.token);
  await api('POST',`${base}/resources`,value({title:'Forbidden student publishing'}),student.token,404);
  await api('GET',`/api/course-workspaces/${period.period.id}/${course2.courseId}`,undefined,lecturer.token,404);
  const initial=await api('GET',base,undefined,student.token);
  expect(initial.canManage).toBe(false);expect(initial.resources.some(r=>r.id===secret.id)).toBe(false);
  expect(JSON.stringify(initial)).not.toContain('storageKey');
  await api('GET',`${base}/resources/${secret.id}/download`,undefined,student.token,404);

  async function signIn(target,email,password){
    await target.goto('/#signin');await target.locator('[data-shell-signin] [name=email]').fill(email);await target.locator('[data-shell-signin] [name=password]').fill(password);await target.locator('[data-shell-signin] button[type=submit]').click();await expect(target.locator('[data-shell-signin]')).toHaveCount(0);
  }
  await signIn(page,email,password);await page.goto('/#learning');
  const teaching=page.locator(`[data-course-workspace][data-course="${course.courseId}"]`).first();
  await teaching.locator('..').locator('summary').first().click();
  await teaching.getByRole('button',{name:'Add resource',exact:true}).click();
  const form=teaching.locator('[data-course-editor]');
  await form.locator('[name=kind]').selectOption('link');await form.locator('[name=title]').fill('Course WhatsApp group');await form.locator('[name=section]').fill('Discussion Groups');await form.locator('[name=url]').fill('https://chat.whatsapp.com/course-group');await form.locator('[name=status]').selectOption('published');await form.locator('[name=pinned]').check();await form.getByRole('button',{name:'Save resource'}).click();
  await expect(teaching.locator('[data-course-notice]')).toHaveText('Resource saved.');
  await expect(teaching.getByRole('heading',{name:'Course WhatsApp group'})).toBeVisible();
  await teaching.getByRole('button',{name:'Add resource',exact:true}).click();
  await form.locator('[name=kind]').selectOption('note');await form.locator('[name=title]').fill('Practical instructions');await form.locator('[name=description]').fill('Bring your notebook.');await form.locator('[name=status]').selectOption('published');await form.getByRole('button',{name:'Save resource'}).click();
  await expect(teaching.getByRole('heading',{name:'Practical instructions'})).toBeVisible();
  await teaching.getByRole('button',{name:'Add resource',exact:true}).click();
  await form.locator('[name=title]').fill('Supplementary notes');await form.locator('[name=file]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Additional course notes')});await form.locator('[name=status]').selectOption('published');await form.getByRole('button',{name:'Save resource'}).click();
  await expect(teaching.getByRole('heading',{name:'Supplementary notes'})).toBeVisible();
  const staffDiscussion=teaching.locator('.course-discussions');
  await staffDiscussion.getByRole('button',{name:discussionInput.title,exact:true}).click();
  await staffDiscussion.getByRole('button',{name:'Older discussions or messages'}).click();
  const reportedPost=staffDiscussion.locator(`[data-discussion-post="${reply.postId}"]`);
  await expect(reportedPost).toContainText('Reported: Please review this response.');
  await reportedPost.getByText('Moderate message',{exact:true}).click();
  await reportedPost.locator('[name=reason]').fill('Lecturer UI review');await reportedPost.getByRole('button',{name:'Hide message'}).click();
  await expect(reportedPost).toContainText('Message hidden by lecturer.');
  await reportedPost.getByText('Moderate message',{exact:true}).click();
  await reportedPost.locator('[name=reason]').fill('Restore after UI review');await reportedPost.getByRole('button',{name:'Restore message'}).click();
  await expect(reportedPost).toContainText('Begin with the reading.');
  await staffDiscussion.locator('[data-discussion-action="lock"] [name=reason]').fill('Lecturer UI lock');await staffDiscussion.getByRole('button',{name:'Lock discussion',exact:true}).click();
  await expect(staffDiscussion.getByRole('button',{name:'Post reply'})).toHaveCount(0);
  await staffDiscussion.locator('[data-discussion-action="lock"] [name=reason]').fill('Lecturer UI unlock');await staffDiscussion.getByRole('button',{name:'Unlock discussion',exact:true}).click();
  await expect(staffDiscussion.getByRole('button',{name:'Post reply'})).toBeVisible();
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.screenshot({path:info.outputPath('lecturer-course.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  const studentContext=await browser.newContext({...info.project.use,baseURL:process.env.SVU_BASE_URL});const portal=await studentContext.newPage();
  try {
    await signIn(portal,'active.student@southvalley.test','Active-Student-Demo-2026!');await portal.goto('/#study/courses');
    const workspace=portal.locator(`[data-course-workspace][data-course="${course.courseId}"]`).first();
    const expand=workspace.locator('..');await expect(expand).toContainText('Assignment due');
    await expand.locator('summary').click();
    for(const heading of ['1. Learning Materials','2. Online Classes','3. Assignments','4. Announcements','5. Discussion Groups'])await expect(workspace.getByRole('heading',{name:heading,exact:true})).toBeVisible();
    await expect(workspace).not.toContainText('Draft lecturer notes');await expect(workspace.getByRole('button',{name:'Add resource',exact:true})).toHaveCount(0);
    await expect(workspace.getByRole('link',{name:'Open link'})).toHaveAttribute('href','https://chat.whatsapp.com/course-group');
    const download=portal.waitForEvent('download');await workspace.locator(`[data-course-download="${material.id}"]`).click();expect((await download).suggestedFilename()).toBe('week-1.pdf');
    const upload=workspace.locator(`[data-course-submit="${assignment.id}"]`);
    await upload.locator('[name=file]').setInputFiles({name:'assignment.txt',mimeType:'text/plain',buffer:Buffer.from('My assignment')});await upload.getByRole('button',{name:'Upload assignment'}).click();
    await expect(workspace.locator('.course-receipt').first()).toContainText('Attempt 1');
    await upload.locator('[name=file]').setInputFiles({name:'assignment-v2.txt',mimeType:'text/plain',buffer:Buffer.from('Revised assignment')});await upload.getByRole('button',{name:'Replace submission'}).click();await expect(workspace.locator('.course-receipt').first()).toContainText('Attempt 2');
    await workspace.getByText('Previous submissions (1)',{exact:true}).click();await expect(workspace.locator('.course-receipt').nth(1)).toContainText('assignment.txt');
    const studentUploads=(await api('GET',base,undefined,student.token)).submissions.filter(u=>u.resourceId===assignment.id);
    const latest=studentUploads[0];
    expect((await api('GET',base,undefined,lecturer.token)).submissions.filter(u=>u.resourceId===assignment.id)).toHaveLength(2);
    await api('POST',`${base}/resources/${assignment.id}/review`,{submissionId:latest.id,revision:0,mark:73,maxMark:100,feedback:'Unauthorized marking',release:true,reason:'Must fail'},student.token,404);
    await page.goto('/#learning');await page.reload();
    const marking=page.locator(`[data-course-workspace][data-course="${course.courseId}"]`).first();
    await marking.locator('..').locator('summary').first().click();
    const markingAssignment=marking.locator(`[data-resource="${assignment.id}"]`);
    await expect(markingAssignment).toContainText('Submitted: 1');
    await expect(markingAssignment).toContainText('Missing:');
    await markingAssignment.getByText('Submissions (1 students)',{exact:true}).click();
    await markingAssignment.locator(`[data-course-mark="${latest.id}"]`).click();
    const reviewForm=marking.locator('[data-course-review]');
    await reviewForm.locator('[name=mark]').fill('73');await reviewForm.locator('[name=maxMark]').fill('100');await reviewForm.locator('[name=feedback]').fill('Clear reasoning. Expand the conclusion.');await reviewForm.locator('[name=reason]').fill('Draft marking');await reviewForm.locator('[name=file]').setInputFiles({name:'marked-assignment.txt',mimeType:'text/plain',buffer:Buffer.from('Marked assignment: good reasoning')});await reviewForm.getByRole('button',{name:'Save review',exact:true}).click();
    await expect(marking.locator('[data-course-notice]')).toHaveText('Review saved privately.');
    const privateReview=(await api('GET',base,undefined,lecturer.token)).submissions.find(u=>u.id===latest.id).review;
    expect(privateReview.released).toBe(false);
    expect((await api('GET',base,undefined,student.token)).submissions.find(u=>u.id===latest.id).review).toBeNull();
    await api('GET',`${base}/resources/${assignment.id}/download?review=${privateReview.id}`,undefined,student.token,404);
    await api('POST',`${base}/resources/${assignment.id}/review`,{submissionId:latest.id,revision:0,mark:70,maxMark:100,feedback:'Stale review',release:true,reason:'Conflict'},lecturer.token,409);
    await markingAssignment.getByText('Submissions (1 students)',{exact:true}).click();await markingAssignment.locator(`[data-course-mark="${latest.id}"]`).click();
    await reviewForm.locator('[name=reason]').fill('Release approved feedback');await reviewForm.locator('[name=release]').check();await reviewForm.getByRole('button',{name:'Save review',exact:true}).click();await expect(marking.locator('[data-course-notice]')).toHaveText('Feedback released to the student.');
    const released=(await api('GET',base,undefined,student.token)).submissions.find(u=>u.id===latest.id).review;
    expect(released.revision).toBe(2);expect(released.mark).toBe(73);expect(JSON.stringify(released)).not.toContain('storageKey');
    await expand.locator('summary').first().click();await expand.locator('summary').first().click();
    await expect(workspace.locator('.course-feedback').first()).toContainText('Coursework mark: 73 / 100');
    await expect(workspace.locator('.course-feedback').first()).toContainText('Clear reasoning. Expand the conclusion.');
    const returnedDownload=portal.waitForEvent('download');await workspace.locator('.course-feedback').first().getByRole('button',{name:'marked-assignment.txt',exact:false}).click();expect((await returnedDownload).suggestedFilename()).toBe('marked-assignment.txt');
    const notificationDb=new pg.Client({connectionString:process.env.DATABASE_URL});await notificationDb.connect();
    try {
      const notifications=(await notificationDb.query(`select n.payload,t.code,a.email from notifications n join notification_templates t on t.id=n.template_id join accounts a on a.id=n.recipient_account_id where t.code in ('course.resource','course.feedback')`)).rows;
      expect(notifications.some(n=>n.code==='course.resource' && n.email==='active.student@southvalley.test')).toBe(true);
      expect(notifications.filter(n=>n.code==='course.feedback' && n.email==='active.student@southvalley.test')).toHaveLength(feedbackBefore+1);
      // The mark must not leak into the message text; the in-app link carries only ids, which may contain any digits.
      expect(notifications.filter(n=>n.code==='course.feedback').some(n=>`${n.payload.subject} ${n.payload.body}`.includes('73'))).toBe(false);
      expect(notifications.filter(n=>n.code==='course.feedback').every(n=>/^#study\/courses\//.test(n.payload.link))).toBe(true);
    }finally{await notificationDb.end();}
    await portal.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
    const discussions=workspace.locator('.course-discussions');
    await discussions.getByRole('button',{name:discussionInput.title,exact:true}).click();
    await expect(discussions.getByText('History message 30',{exact:true})).toBeVisible();
    await discussions.getByRole('button',{name:'Older discussions or messages'}).click();
    await expect(discussions.getByText('Begin with the reading.',{exact:true})).toBeVisible();
    const compose=discussions.locator('[data-discussion-compose]');
    await compose.locator('[name=body]').fill('Thanks, I have completed the reading.');await compose.getByRole('button',{name:'Post reply'}).click();
    await expect(discussions.getByText('Thanks, I have completed the reading.',{exact:true})).toBeVisible();
    await portal.screenshot({path:info.outputPath('student-discussion.png'),fullPage:true});
    await discussions.scrollIntoViewIfNeeded();await portal.screenshot({path:info.outputPath('student-discussion-viewport.png')});
    await portal.screenshot({path:info.outputPath('student-course.png'),fullPage:true});expect(await portal.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(portal.viewportSize().width);
    await expand.locator('summary').first().click();await expect(workspace).not.toBeVisible();await expand.locator('summary').first().click();await expect(workspace.locator('.course-receipt').first()).toContainText('Attempt 2');
    const other=portal.locator('[data-course-expand]').filter({has:portal.locator(`[data-course-workspace][data-course="${course2.courseId}"]`)}).first();await other.locator('summary').click();await expect(expand).not.toHaveAttribute('open','');
  }finally{await studentContext.close();}
  const current=(await api('GET',base,undefined,lecturer.token)).resources.find(r=>r.id===assignment.id);
  const {id:resourceId,updatedAt,file,...editable}=current;
  await api('POST',`${base}/resources/${assignment.id}`,value({...editable,dueAt:new Date(Date.now()-86400000).toISOString()}),lecturer.token);
  await api('POST',`${base}/resources/${assignment.id}/submit`,{file:pdf},student.token,409);
  await api('POST',`${base}/resources/${assignment.id}`,value({...editable,title:'Stale edit'}),lecturer.token,409);
  const verifyDb=new pg.Client({connectionString:process.env.DATABASE_URL});await verifyDb.connect();
  try {
    let withdrawal=(await verifyDb.query('select id from course_withdrawal_requests where registration_id=$1 and course_id=$2',[period.registration.id,course.courseId])).rows[0];
    if(!withdrawal)withdrawal=(await verifyDb.query(`insert into course_withdrawal_requests(registration_id,course_id,student_programme_id,reason,status,requested_by)
      select $1,$2,$3,'Isolated access fixture','approved',s.account_id from students s join course_enrolments ce on ce.student_id=s.id where ce.registration_id=$1 and ce.course_id=$2 returning id`,[period.registration.id,course.courseId,me.programmes[0].id])).rows[0];
    await verifyDb.query('update course_enrolments set withdrawn_at=now(),withdrawal_request_id=$3 where registration_id=$1 and course_id=$2',[period.registration.id,course.courseId,withdrawal.id]);
    await api('GET',base,undefined,student.token,404);
    await api('GET',`${base}/discussions/${discussion.id}`,undefined,student.token,404);
    await api('POST',`${base}/discussions/${discussion.id}/reply`,{body:'Withdrawn reply',requestKey:`withdrawn-${stamp}`},student.token,404);
    await api('GET',`${base}/resources/${material.id}/download`,undefined,student.token,404);
  }finally{
    await verifyDb.query('update course_enrolments set withdrawn_at=null,withdrawal_request_id=null where registration_id=$1 and course_id=$2',[period.registration.id,course.courseId]);
    await verifyDb.query("update course_withdrawal_requests set status='cancelled' where registration_id=$1 and course_id=$2 and reason='Isolated access fixture'",[period.registration.id,course.courseId]);
    await verifyDb.end();
  }
});
