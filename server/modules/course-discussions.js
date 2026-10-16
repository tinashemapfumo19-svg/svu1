import { randomUUID } from 'node:crypto';
import { insertAudit, requestError, withTransaction } from '../support.js';

const text = (value,max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export function validateDiscussion(input,action) {
  const fields = {create:['title','body','requestKey'],reply:['body','requestKey'],lock:['locked','revision','reason'],moderate:['hidden','revision','reason'],report:['reason']}[action];
  if (!fields || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!fields.includes(k))) throw requestError(400,'Unsupported discussion fields.');
  if (['create','reply'].includes(action) && (!text(input.body,4000) || typeof input.requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey))) throw requestError(400,'Enter a message up to 4000 characters and a request key.');
  if (action === 'create' && !text(input.title,200)) throw requestError(400,'Enter a discussion title up to 200 characters.');
  if (['lock','moderate','report'].includes(action) && !text(input.reason,2000)) throw requestError(400,'Enter a reason up to 2000 characters.');
  if (['lock','moderate'].includes(action) && (!Number.isInteger(input.revision) || input.revision < 1 || typeof input[action === 'lock' ? 'locked' : 'hidden'] !== 'boolean')) throw requestError(400,'Provide the current revision and a valid moderation state.');
  return input;
}

export function discussionPage(input={}) {
  if (Object.keys(input).some(k=>!['before'].includes(k)) || input.before !== undefined && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\|[A-Za-z0-9_-]{1,100}$/.test(input.before)) throw requestError(400,'Invalid discussion page.');
  const [at,id] = (input.before || '').split('|');
  if (at && (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)) throw requestError(400,'Invalid discussion page.');
  return [at || null,id || null];
}
const cursor = row => `${new Date(row.createdAt).toISOString()}|${row.id}`;
export function createCourseDiscussionModule(pool,access) {
  async function thread(db,period,course,id) {
    const row=(await db.query('select id,title,locked,revision from course_discussion_threads where period_id=$1 and course_id=$2 and id=$3 for update',[period,course,id])).rows[0];
    if (!row) throw requestError(404,'Discussion was not found.');
    return row;
  }
  const audit = (db,actor,id,action,reason) => insertAudit(db,{actorId:actor.accountId,action:`course.discussion.${action}`,subjectType:'CourseDiscussion',subjectId:id,reason});
  return {
    async listCourseDiscussions(period,course,id,query,actor) {
      const [at,beforeId]=discussionPage(query);
      return withTransaction(pool,async db=>{
        const own=await access(db,period,course,actor);
        if (!id) {
          const rows=(await db.query(`select id,title,locked,revision,created_at as "createdAt" from course_discussion_threads
            where period_id=$1 and course_id=$2 and ($3::timestamptz is null or (created_at,id)<($3::timestamptz,$4::text)) order by created_at desc,id desc limit 21`,[period,course,at,beforeId])).rows;
          return {items:rows.slice(0,20),nextCursor:rows.length>20 ? cursor(rows[19]) : null,canManage:own.canManage};
        }
        const current=await thread(db,period,course,id);
        const rows=(await db.query(`select p.id,p.hidden,p.revision,p.created_at as "createdAt",
          case when p.hidden then null else p.body end as body,
          coalesce(pe.preferred_name,pe.legal_name,'Course participant') as "authorName",
          exists(select 1 from course_discussion_reports r where r.post_id=p.id and r.reporter_id=$5) as reported,
          case when $4::boolean then (select coalesce(jsonb_agg(jsonb_build_object('reason',r.reason,'createdAt',r.created_at)),'[]'::jsonb) from (select reason,created_at from course_discussion_reports where post_id=p.id order by created_at desc limit 20) r) else null end as reports
          from course_discussion_posts p join accounts a on a.id=p.author_id left join people pe on pe.id=a.person_id
          where p.thread_id=$1 and ($2::timestamptz is null or (p.created_at,p.id)<($2::timestamptz,$3::text))
          order by p.created_at desc,p.id desc limit 31`,[id,at,beforeId,own.canManage,actor.accountId])).rows;
        return {thread:current,items:rows.slice(0,30),nextCursor:rows.length>30 ? cursor(rows[29]) : null,canManage:own.canManage};
      });
    },
    async writeCourseDiscussion(period,course,id,postId,action,input,actor) {
      validateDiscussion(input,action);
      return withTransaction(pool,async db=>{
        await access(db,period,course,actor,['lock','moderate'].includes(action));
        if (['create','reply'].includes(action)) {
          await db.query('select pg_advisory_xact_lock(hashtext($1))',[`discussion:${actor.accountId}:${input.requestKey}`]);
          const old=(await db.query(`select p.id,p.thread_id as "threadId",p.body,p.operation,t.title,t.period_id as "periodId",t.course_id as "courseId"
            from course_discussion_posts p join course_discussion_threads t on t.id=p.thread_id where p.author_id=$1 and p.request_key=$2`,[actor.accountId,input.requestKey])).rows[0];
          if (old) {
            if (old.operation!==action || old.periodId!==period || old.courseId!==course || old.body!==input.body.trim() || action==='create' && old.title!==input.title.trim() || action==='reply' && old.threadId!==id) throw requestError(409,'This request key was used for different content.');
            return {id:old.threadId,postId:old.id};
          }
          const threadId=id || `ct_${randomUUID()}`;
          if (action==='create') await db.query('insert into course_discussion_threads(id,period_id,course_id,title,created_by) values($1,$2,$3,$4,$5)',[threadId,period,course,input.title.trim(),actor.accountId]);
          else if ((await thread(db,period,course,id)).locked) throw requestError(409,'This discussion is locked.');
          const messageId=`cp_${randomUUID()}`;
          await db.query('insert into course_discussion_posts(id,thread_id,author_id,body,request_key,operation) values($1,$2,$3,$4,$5,$6)',[messageId,threadId,actor.accountId,input.body.trim(),input.requestKey,action]);
          await audit(db,actor,threadId,action,'Course participant posted a message');
          return {id:threadId,postId:messageId};
        }
        const current=await thread(db,period,course,id);
        if (action==='lock') {
          if (current.revision!==input.revision) throw requestError(409,'This discussion changed. Refresh before moderating.');
          await db.query('update course_discussion_threads set locked=$2,revision=revision+1 where id=$1',[id,input.locked]);
        } else {
          const post=(await db.query('select id,revision from course_discussion_posts where thread_id=$1 and id=$2 for update',[id,postId])).rows[0];
          if (!post) throw requestError(404,'Message was not found.');
          if (action==='report') await db.query('insert into course_discussion_reports(post_id,reporter_id,reason) values($1,$2,$3) on conflict do nothing',[postId,actor.accountId,input.reason.trim()]);
          else {
            if (post.revision!==input.revision) throw requestError(409,'This message changed. Refresh before moderating.');
            await db.query('update course_discussion_posts set hidden=$2,revision=revision+1 where id=$1',[postId,input.hidden]);
          }
        }
        await audit(db,actor,postId || id,action,input.reason.trim());
        return {id};
      });
    }
  };
}
