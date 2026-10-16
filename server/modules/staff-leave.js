import { createHash, randomUUID } from 'node:crypto';
import { insertAudit, isGlobalScope, requestError, todayIso, withTransaction } from '../support.js';

const text = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const code = (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(v);
function fields(input,allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw requestError(400,'Leave input contains unsupported fields.');
}
export function leaveDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$|^21\d{2}-\d{2}-\d{2}$|^2200-\d{2}-\d{2}$/.test(value)) throw requestError(400,'Use a leave date between 2000 and 2200.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw requestError(400,'Leave date does not exist.');
  return date;
}
export function validateLeaveCategory(input) {
  fields(input,['code','name','dayBasis','excludedDates','reason']);
  if (!code(input.code) || !text(input.name,100) || !['calendar','weekdays'].includes(input.dayBasis) || !text(input.reason,2000)) throw requestError(400,'Provide a category code, name, counting basis and reason.');
  const excluded = input.excludedDates ?? [];
  if (!Array.isArray(excluded) || excluded.length > 366 || new Set(excluded).size !== excluded.length) throw requestError(400,'Provide at most 366 unique excluded dates.');
  excluded.forEach(leaveDate);
  return {...input,name:input.name.trim(),excludedDates:[...excluded].sort()};
}
export function countLeaveDays(startsOn,endsOn,category) {
  const start = leaveDate(startsOn),end = leaveDate(endsOn);
  if (end < start || startsOn.slice(0,4) !== endsOn.slice(0,4)) throw requestError(400,'Leave must be ordered and within one calendar year. Split requests across years.');
  const excluded = new Set(category.excludedDates),basis = category.dayBasis;
  if (!['calendar','weekdays'].includes(basis)) throw requestError(400,'Leave counting policy was not found.');
  let days = 0;
  for (let date = start; date <= end; date = new Date(date.getTime()+86400000)) {
    if (!excluded.has(date.toISOString().slice(0,10)) && (basis === 'calendar' || ![0,6].includes(date.getUTCDay()))) days++;
  }
  if (!days) throw requestError(400,'This request contains no chargeable leave days.');
  return days;
}
export function validateLeaveRequest(input,today = todayIso()) {
  fields(input,['categoryCode','startsOn','endsOn','reason','replayKey']);
  leaveDate(input.startsOn); leaveDate(input.endsOn);
  if (!code(input.categoryCode) || !text(input.reason,2000) || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.replayKey ?? '') || input.startsOn < today) throw requestError(400,'Provide a category, future or current dates, reason and replay key.');
  if (input.endsOn < input.startsOn || input.startsOn.slice(0,4) !== input.endsOn.slice(0,4)) throw requestError(400,'Leave must be ordered and within one calendar year.');
  return {categoryCode:input.categoryCode,startsOn:input.startsOn,endsOn:input.endsOn,reason:input.reason.trim(),replayKey:input.replayKey};
}
export function leaveNextStatus(row,action,{self,supervisor,manager},today = todayIso()) {
  const pending = ['requested','recommended'].includes(row.status);
  if (action === 'cancel' && self && (pending || row.status === 'approved' && row.startsOn > today)) return 'cancelled';
  if (action === 'recommend' && supervisor && !self && row.status === 'requested') return 'recommended';
  if (action === 'deny' && !self && (supervisor && row.status === 'requested' || manager && pending)) return 'denied';
  if (action === 'approve' && manager && !self && row.status === 'recommended') return 'approved';
  if (action === 'reverse' && manager && !self && row.status === 'approved') return 'reversed';
  throw requestError(409,'This leave decision is not available for this record and authority.');
}
export function leaveManager(actor) {
  return actor.roles.some((role) => role.permissions?.includes('leave.manage') && (role.code === 'system_administrator' || isGlobalScope(role.scope)));
}
const requestSelect = `select r.id,r.staff_id as "staffId",m.employee_number as "employeeNumber",m.legal_name as "legalName",r.category_code as "categoryCode",c.name as "categoryName",
  to_char(r.starts_on,'YYYY-MM-DD') as "startsOn",to_char(r.ends_on,'YYYY-MM-DD') as "endsOn",r.days,r.reason,r.status,r.revision,
  r.requested_by as "requestedBy",r.recommended_by as "recommendedBy",r.approved_by as "approvedBy",r.created_at as "createdAt"
  from staff_leave_requests r join staff_members m on m.id=r.staff_id join staff_leave_categories c on c.code=r.category_code`;
const currentEmployment = `select p.supervisor_staff_id from staff_employment_periods p where p.staff_id=m.id and p.effective_from<=current_date and (p.effective_to is null or p.effective_to>=current_date)`;
export function createStaffLeaveModule(pool) {
  async function ownStaff(db,actor,lock = false) {
    return (await db.query(`select id,status,to_char(engaged_on,'YYYY-MM-DD') as "engagedOn" from staff_members where account_id=$1 ${lock ? 'for update' : ''}`,[actor.accountId])).rows[0];
  }
  async function supervisorOf(db,staffId,actor) {
    return Boolean((await db.query(`select 1 from staff_members m join staff_members s on s.id=(${currentEmployment}) where m.id=$1 and s.account_id=$2 and s.status='active'`,[staffId,actor.accountId])).rowCount);
  }
  async function balance(db,staffId,categoryCode,year) {
    const granted = Number((await db.query('select coalesce(sum(days),0) as days from staff_leave_balance_entries where staff_id=$1 and category_code=$2 and leave_year=$3',[staffId,categoryCode,year])).rows[0].days);
    const sums = (await db.query(`select coalesce(sum(days) filter (where status in ('requested','recommended')),0) as reserved,coalesce(sum(days) filter (where status='approved'),0) as used
      from staff_leave_requests where staff_id=$1 and category_code=$2 and extract(year from starts_on)=$3`,[staffId,categoryCode,year])).rows[0];
    return {staffId,categoryCode,year,granted,reserved:Number(sums.reserved),used:Number(sums.used),available:granted-Number(sums.reserved)-Number(sums.used)};
  }
  async function detail(db,id,actor) {
    const row = (await db.query(`${requestSelect} where r.id=$1`,[id])).rows[0];
    if (!row) throw requestError(404,'Leave request was not found.');
    const self = row.requestedBy === actor.accountId,supervisor = await supervisorOf(db,row.staffId,actor),manager = leaveManager(actor);
    if (!self && !supervisor && !manager) throw requestError(404,'Leave request was not found.');
    row.history = (await db.query(`select from_status as "fromStatus",to_status as "toStatus",reason,actor_id as "actorId",recorded_at as "recordedAt" from staff_leave_history where request_id=$1 order by id`,[id])).rows;
    row.actions = ['cancel','recommend','deny','approve','reverse'].filter((action) => {
      if (['approve','reverse'].includes(action) && row.recommendedBy === actor.accountId) return false;
      try {leaveNextStatus(row,action,{self,supervisor,manager}); return true;} catch {return false;}
    });
    return row;
  }
  async function history(db,row,fromStatus,status,reason,actor) {
    await db.query('insert into staff_leave_history (request_id,from_status,to_status,reason,actor_id) values ($1,$2,$3,$4,$5)',[row.id,fromStatus,status,reason,actor.accountId]);
    await insertAudit(db,{actorId:actor.accountId,action:`staff.leave.${status}`,subjectType:'StaffLeaveRequest',subjectId:row.id,reason,metadata:{staffId:row.staffId,fromStatus,status}});
  }
  return {
    async leaveWorkspace(filters,actor) {
      const year = Number(filters.year || todayIso().slice(0,4));
      if (!Number.isInteger(year) || year<2000 || year>2200) throw requestError(400,'Choose a leave year between 2000 and 2200.');
      const limit = Number(filters.limit || 25),offset = Number(filters.offset || 0);
      if (!Number.isInteger(limit) || limit<1 || limit>100 || !Number.isInteger(offset) || offset<0 || offset>100000) throw requestError(400,'Leave pagination is invalid.');
      const manager = leaveManager(actor),own = await ownStaff(pool,actor);
      const categories = (await pool.query(`select code,name,day_basis as "dayBasis",excluded_dates as "excludedDates",active,revision from staff_leave_categories order by name`)).rows;
      const staffSearch = `%${String(filters.staffQ || '').slice(0,200)}%`;
      const where = `where extract(year from r.starts_on)=$1 and ($2::boolean or r.requested_by=$3 or exists (select 1 from staff_members s where s.id=(${currentEmployment}) and s.account_id=$3 and s.status='active')) and (m.legal_name ilike $4 or m.employee_number ilike $4)`;
      const args = [year,manager,actor.accountId,staffSearch];
      const total = (await pool.query(`select count(*)::int as total from staff_leave_requests r join staff_members m on m.id=r.staff_id ${where}`,args)).rows[0].total;
      const rows = (await pool.query(`${requestSelect} ${where} order by r.created_at desc,r.id limit $5 offset $6`,[...args,limit,offset])).rows;
      const items = [];
      for (const row of rows) items.push(await detail(pool,row.id,actor));
      const staff = manager ? (await pool.query(`select id,employee_number as "employeeNumber",legal_name as "legalName" from staff_members where status='active' and (legal_name ilike $1 or employee_number ilike $1) order by legal_name limit 100`,[staffSearch])).rows : [];
      const balances = [];
      if (own) for (const category of categories) balances.push(await balance(pool,own.id,category.code,year));
      return {items,total,limit,offset,year,categories,staff,ownStaff:own,balances,capabilities:{manage:manager,request:own?.status === 'active' && own.engagedOn<=todayIso()}};
    },
    async createLeaveCategory(input,actor) {
      if (!leaveManager(actor)) throw requestError(403,'Leave configuration requires institution-wide HR authority.');
      const data = validateLeaveCategory(input);
      return withTransaction(pool,async (db) => {
        const result = await db.query(`insert into staff_leave_categories (code,name,day_basis,excluded_dates,created_by) values ($1,$2,$3,$4,$5) on conflict do nothing returning code`,[data.code,data.name,data.dayBasis,JSON.stringify(data.excludedDates),actor.accountId]);
        if (!result.rowCount) throw requestError(409,'This leave category code already exists.');
        await insertAudit(db,{actorId:actor.accountId,action:'staff.leave.category.created',subjectType:'StaffLeaveCategory',subjectId:data.code,reason:data.reason,metadata:{dayBasis:data.dayBasis,excludedDates:data.excludedDates}});
        return {code:data.code};
      });
    },
    async setLeaveCategoryActive(categoryCode,input,actor) {
      if (!leaveManager(actor)) throw requestError(403,'Leave configuration requires institution-wide HR authority.');
      fields(input,['revision','active','reason']);
      if (!Number.isInteger(input.revision) || typeof input.active !== 'boolean' || !text(input.reason,2000)) throw requestError(400,'Provide revision, active state and reason.');
      return withTransaction(pool,async (db) => {
        const result = await db.query('update staff_leave_categories set active=$2,revision=revision+1 where code=$1 and revision=$3 returning code,revision,active',[categoryCode,input.active,input.revision]);
        if (!result.rowCount) throw requestError(409,'The category changed or was not found.');
        await insertAudit(db,{actorId:actor.accountId,action:'staff.leave.category.status',subjectType:'StaffLeaveCategory',subjectId:categoryCode,reason:input.reason,metadata:{active:input.active}});
        return result.rows[0];
      });
    },
    async adjustLeaveBalance(input,actor) {
      if (!leaveManager(actor)) throw requestError(403,'Leave balances require institution-wide HR authority.');
      fields(input,['staffId','categoryCode','year','days','reason']);
      if (!text(input.staffId,100) || !code(input.categoryCode) || !Number.isInteger(input.year) || input.year<2000 || input.year>2200 || !Number.isInteger(input.days) || !input.days || Math.abs(input.days)>366 || !text(input.reason,2000)) throw requestError(400,'Provide staff, category, year, nonzero whole days and reason.');
      return withTransaction(pool,async (db) => {
        const staff = (await db.query('select status,account_id as "accountId" from staff_members where id=$1 for update',[input.staffId])).rows[0];
        if (!staff || staff.status!=='active') throw requestError(409,'Select an active staff member.');
        if (staff.accountId===actor.accountId) throw requestError(403,'Another HR officer must adjust your own balance.');
        if (!(await db.query('select 1 from staff_leave_categories where code=$1 and active=true',[input.categoryCode])).rowCount) throw requestError(400,'Select an active leave category.');
        const before = await balance(db,input.staffId,input.categoryCode,input.year);
        if (before.available+input.days<0) throw requestError(409,'This adjustment would reduce the balance below reserved or approved leave.');
        const entry = (await db.query('insert into staff_leave_balance_entries (staff_id,category_code,leave_year,days,reason,actor_id) values ($1,$2,$3,$4,$5,$6) returning id::text',[input.staffId,input.categoryCode,input.year,input.days,input.reason.trim(),actor.accountId])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:'staff.leave.balance.adjusted',subjectType:'StaffLeaveBalanceEntry',subjectId:entry.id,reason:input.reason,metadata:{staffId:input.staffId,categoryCode:input.categoryCode,year:input.year,days:input.days}});
        return balance(db,input.staffId,input.categoryCode,input.year);
      });
    },
    async getLeaveBalance(staffId,categoryCode,year,actor) {
      if (!leaveManager(actor) && (await ownStaff(pool,actor))?.id!==staffId) throw requestError(404,'Leave balance was not found.');
      if (!code(categoryCode) || !Number.isInteger(year) || year<2000 || year>2200) throw requestError(400,'Choose a category and leave year.');
      const result = await balance(pool,staffId,categoryCode,year);
      result.entries = (await pool.query(`select id::text,days,reason,actor_id as "actorId",recorded_at as "recordedAt" from staff_leave_balance_entries where staff_id=$1 and category_code=$2 and leave_year=$3 order by id`,[staffId,categoryCode,year])).rows;
      return result;
    },
    async requestStaffLeave(input,actor) {
      const data = validateLeaveRequest(input),hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
      return withTransaction(pool,async (db) => {
        const own = await ownStaff(db,actor,true);
        if (!own || own.status!=='active' || own.engagedOn>todayIso()) throw requestError(403,'An active employment record is required to request leave.');
        const existing = (await db.query('select id,input_hash as hash from staff_leave_requests where staff_id=$1 and replay_key=$2',[own.id,data.replayKey])).rows[0];
        if (existing) {if (existing.hash!==hash) throw requestError(409,'This replay key belongs to a different request.');return detail(db,existing.id,actor);}
        const category = (await db.query('select day_basis as "dayBasis",excluded_dates as "excludedDates" from staff_leave_categories where code=$1 and active=true for share',[data.categoryCode])).rows[0];
        if (!category) throw requestError(400,'Select an active leave category.');
        const days = countLeaveDays(data.startsOn,data.endsOn,category),year = Number(data.startsOn.slice(0,4));
        if ((await balance(db,own.id,data.categoryCode,year)).available<days) throw requestError(409,'Insufficient available leave balance.');
        if ((await db.query(`select 1 from staff_leave_requests where staff_id=$1 and status in ('requested','recommended','approved') and starts_on<=$3 and ends_on>=$2`,[own.id,data.startsOn,data.endsOn])).rowCount) throw requestError(409,'This request overlaps existing reserved or approved leave.');
        const row = {id:`leave_${randomUUID()}`,staffId:own.id};
        await db.query('insert into staff_leave_requests (id,staff_id,category_code,starts_on,ends_on,days,reason,requested_by,replay_key,input_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,own.id,data.categoryCode,data.startsOn,data.endsOn,days,data.reason,actor.accountId,data.replayKey,hash]);
        await history(db,row,null,'requested',data.reason,actor);
        return detail(db,row.id,actor);
      });
    },
    async getStaffLeave(id,actor) {return detail(pool,id,actor);},
    async decideStaffLeave(id,action,input,actor) {
      fields(input,['revision','reason']);
      if (!Number.isInteger(input.revision) || !text(input.reason,2000)) throw requestError(400,'Provide the request revision and decision reason.');
      return withTransaction(pool,async (db) => {
        // Lock the staff row before the request: all balance and booking writers use this same order.
        const target = (await db.query('select staff_id from staff_leave_requests where id=$1',[id])).rows[0];
        if (!target) throw requestError(404,'Leave request was not found.');
        const staff = (await db.query('select status from staff_members where id=$1 for update',[target.staff_id])).rows[0];
        await db.query('select id from staff_leave_requests where id=$1 for update',[id]);
        const row = await detail(db,id,actor);
        if (row.revision!==input.revision) throw requestError(409,'Leave request changed. Reload before making a decision.');
        if (!row.actions.includes(action)) throw requestError(403,'You cannot make this leave decision. Independent approval is required.');
        if (['approve','recommend'].includes(action) && staff.status!=='active') throw requestError(409,'Leave cannot be approved for inactive staff.');
        const next = leaveNextStatus(row,action,{self:row.requestedBy===actor.accountId,supervisor:await supervisorOf(db,row.staffId,actor),manager:leaveManager(actor)});
        await db.query(`update staff_leave_requests set status=$2,revision=revision+1,recommended_by=case when $2='recommended' then $3 else recommended_by end,approved_by=case when $2='approved' then $3 else approved_by end where id=$1`,[id,next,actor.accountId]);
        await history(db,row,row.status,next,input.reason.trim(),actor);
        return detail(db,id,actor);
      });
    }
  };
}
