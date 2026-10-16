import { createHash, randomUUID } from 'node:crypto';
import { insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from '../support.js';
import { assertActiveReference } from './student-finance.js';

export const assetConditions=['serviceable','damaged','repair','missing'];
export const assetStatuses=['available','allocated','disposal_pending','disposed'];
const text=(v,max) => typeof v==='string' && v.trim().length>0 && v.length<=max;
const money=(v) => Number.isSafeInteger(v) && v>=0 && v<=10000000000;
const optional=(v,max) => v===undefined || v===null || v==='' || text(v,max);
const tag=(v) => typeof v==='string' && /^[A-Z0-9][A-Z0-9_-]{2,49}$/.test(v);
function fields(input,keys) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((k) => !keys.includes(k))) throw requestError(400,'Asset input contains unsupported fields.');
}
function reason(input) {if (!text(input.reason,2000)) throw requestError(400,'Provide an asset action reason.');}
export function assetDate(value,minimum='1900-01-01',today=todayIso()) {
  if (typeof value!=='string' || !value) throw requestError(400,'Provide an asset date.');
  const date=parseEffectiveDate(value);
  if (date<minimum || date>today) throw requestError(400,`Choose an asset date between ${minimum} and ${today}.`);
  return date;
}
export function assetAuthority(actor,permission) {
  return actor.roles.some((role) => role.permissions?.includes(permission) && (role.code==='system_administrator' || isGlobalScope(role.scope)));
}
function requireAuthority(actor,permission) {if (!assetAuthority(actor,permission)) throw requestError(403,'This asset action requires institution-wide authority.');}
export function validateAssetDefinition(input,today=todayIso()) {
  fields(input,['assetTag','barcode','serialNumber','name','category','acquiredOn','acquisitionMethod','valueMinor','currency','departmentId','location','condition','reason','replayKey']);
  reason(input);
  if (!tag(input.assetTag) || !optional(input.barcode,100) || !optional(input.serialNumber,100) || !text(input.name,200) || !text(input.category,100)
    || !text(input.acquisitionMethod,100) || !money(input.valueMinor) || typeof input.currency!=='string' || !/^[A-Z]{3}$/.test(input.currency) || !text(input.departmentId,100) || !text(input.location,200) || !assetConditions.includes(input.condition)) throw requestError(400,'Provide valid asset identifiers, acquisition details, value, department, location and condition.');
  return {...input,acquiredOn:assetDate(input.acquiredOn,'1900-01-01',today),barcode:input.barcode?.trim() || null,serialNumber:input.serialNumber?.trim() || null};
}
export function validateAssetCopies(input,today=todayIso()) {
  fields(input,['revision','copies','acquiredOn','departmentId','location','condition','reason','replayKey']);reason(input);
  if (!Number.isInteger(input.revision) || !text(input.departmentId,100) || !text(input.location,200) || !assetConditions.includes(input.condition) || !Array.isArray(input.copies) || !input.copies.length || input.copies.length>50) throw requestError(400,'Provide a revision, location, condition, department and 1-50 uniquely tagged copies.');
  const used={assetTag:new Set(),barcode:new Set(),serialNumber:new Set()};
  const copies=input.copies.map((copy) => {
    fields(copy,['assetTag','barcode','serialNumber']);
    if (!tag(copy.assetTag) || !optional(copy.barcode,100) || !optional(copy.serialNumber,100)) throw requestError(400,'Each copy needs a new asset tag and valid optional identifiers.');
    const normalized={assetTag:copy.assetTag,barcode:copy.barcode?.trim() || null,serialNumber:copy.serialNumber?.trim() || null};
    for (const [k,v] of Object.entries(normalized)) if (v) {if (used[k].has(v)) throw requestError(400,'Copied asset identifiers must be unique.');used[k].add(v);}
    return normalized;
  });
  return {...input,acquiredOn:assetDate(input.acquiredOn,'1900-01-01',today),copies};
}
export function assertAssetAction(row,action) {
  if (row.status==='disposed' && action!=='copy') throw requestError(409,'Disposed assets are closed.');
  if (action==='allocate' && (row.status!=='available' || row.condition!=='serviceable')) throw requestError(409,'Only available serviceable assets can be allocated.');
  if (action==='return' && row.status!=='allocated') throw requestError(409,'Only allocated assets can be returned.');
  if (['edit','dispose'].includes(action) && row.status==='disposal_pending') throw requestError(409,'Resolve the pending disposal first.');
  if (action==='edit' && row.status!=='available') throw requestError(409,'Return the asset before editing its definition.');
  if (action==='review' && row.status!=='disposal_pending') throw requestError(409,'No disposal is pending.');
}
const canonical=(v) => Array.isArray(v) ? v.map(canonical) : v && typeof v==='object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k,canonical(v[k])])) : v;
const select=`select a.id,a.asset_tag as "assetTag",a.barcode,a.serial_number as "serialNumber",a.name,a.category,to_char(a.acquired_on,'YYYY-MM-DD') as "acquiredOn",
  a.acquisition_method as "acquisitionMethod",a.value_minor::text as "valueMinor",a.currency,a.department_id as "departmentId",u.name as "departmentName",a.location,a.condition,a.status,a.revision,
  to_char(a.last_activity_on,'YYYY-MM-DD') as "lastActivityOn",a.copied_from as "copiedFrom",a.created_by as "createdBy",c.staff_id as "custodianStaffId",m.legal_name as "custodianName",m.account_id as "custodianAccountId",m.status as "custodianStatus"
  from institution_assets a join organization_units u on u.id=a.department_id left join asset_custody c on c.asset_id=a.id and c.ended_on is null left join staff_members m on m.id=c.staff_id`;

export function createAssetsModule(pool) {
  async function base(db,id,lock=false) {
    if (lock) await db.query('select id from institution_assets where id=$1 for update',[id]);
    const row=(await db.query(`${select} where a.id=$1`,[id])).rows[0];
    if (!row) throw requestError(404,'Asset was not found.');return row;
  }
  async function detail(db,id,actor,historyOffset=0) {
    const row=await base(db,id);
    row.custody=(await db.query(`select c.id::text,c.staff_id as "staffId",m.legal_name as "staffName",to_char(c.allocated_on,'YYYY-MM-DD') as "allocatedOn",c.location,c.reason,to_char(c.ended_on,'YYYY-MM-DD') as "endedOn",c.end_kind as "endKind",c.end_condition as "endCondition",c.end_location as "endLocation",c.end_reason as "endReason" from asset_custody c join staff_members m on m.id=c.staff_id where asset_id=$1 order by c.id desc limit 25 offset $2`,[id,historyOffset])).rows;
    row.checks=(await db.query(`select id::text,to_char(checked_on,'YYYY-MM-DD') as "checkedOn",outcome,observed_condition as "observedCondition",observed_location as "observedLocation",expected_location as "expectedLocation",expected_staff_id as "expectedStaffId",reason,actor_id as "actorId" from asset_stock_checks where asset_id=$1 order by asset_stock_checks.id desc limit 25 offset $2`,[id,historyOffset])).rows;
    row.disposals=(await db.query(`select id,to_char(proposed_on,'YYYY-MM-DD') as "proposedOn",value_minor::text as "valueMinor",currency,method,reason,status,requested_by as "requestedBy",reviewed_by as "reviewedBy",to_char(reviewed_on,'YYYY-MM-DD') as "reviewedOn",review_reason as "reviewReason" from asset_disposals where asset_id=$1 order by created_at desc,id desc limit 25 offset $2`,[id,historyOffset])).rows;
    row.pendingDisposal=(await db.query(`select id,requested_by as "requestedBy" from asset_disposals where asset_id=$1 and status='requested'`,[id])).rows[0] || null;
    row.events=(await db.query(`select id::text,action,reason,actor_id as "actorId",recorded_at as "recordedAt" from asset_events where asset_id=$1 order by asset_events.id desc limit 25 offset $2`,[id,historyOffset])).rows;
    row.historyOffset=historyOffset;row.historyTotal=Number((await db.query('select count(*)::int as total from asset_events where asset_id=$1',[id])).rows[0].total);
    const manage=assetAuthority(actor,'assets.manage');
    row.actions=manage ? ['edit','allocate','return','check','dispose','copy'].filter((action) => {try {assertAssetAction(row,action);return true;}catch{return false;}}) : [];
    row.canReview=assetAuthority(actor,'assets.approve') && Boolean(row.pendingDisposal) && row.pendingDisposal.requestedBy!==actor.accountId && row.custodianAccountId!==actor.accountId;
    return row;
  }
  async function references(db,input) {
    if (!(await db.query("select 1 from organization_units where id=$1 and status='active' and unit_type='department'",[input.departmentId])).rowCount) throw requestError(400,'Select an active department.');
    await assertActiveReference(db,'currency',input.currency,'Select an active currency.');
  }
  async function event(db,id,action,reasonText,actor,before) {
    const after=await base(db,id);
    await db.query('insert into asset_events (asset_id,action,reason,actor_id,before_state,after_state) values ($1,$2,$3,$4,$5,$6)',[id,action,reasonText.trim(),actor.accountId,before ? JSON.stringify(before) : null,JSON.stringify(after)]);
    await insertAudit(db,{actorId:actor.accountId,action:`assets.${action}`,subjectType:'InstitutionAsset',subjectId:id,reason:reasonText,metadata:{revision:after.revision,status:after.status}});
  }
  async function insert(db,data,actor,copiedFrom=null) {
    const id=`asset_${randomUUID()}`;
    await db.query(`insert into institution_assets (id,asset_tag,barcode,serial_number,name,category,acquired_on,acquisition_method,value_minor,currency,department_id,location,condition,last_activity_on,copied_from,created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$7,$14,$15)`,[id,data.assetTag,data.barcode,data.serialNumber,data.name.trim(),data.category.trim(),data.acquiredOn,data.acquisitionMethod.trim(),data.valueMinor,data.currency,data.departmentId,data.location.trim(),data.condition,copiedFrom,actor.accountId]);
    await event(db,id,copiedFrom ? 'copied' : 'registered',data.reason,actor,null);return id;
  }
  async function command(action,id,input,actor,permission,work) {
    requireAuthority(actor,permission);
    if (typeof input.replayKey!=='string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.replayKey)) throw requestError(400,'Provide an asset command replay key.');
    const hash=createHash('sha256').update(JSON.stringify(canonical({action,id,input}))).digest('hex');
    try {return await withTransaction(pool,async (db) => {
      await db.query('select pg_advisory_xact_lock(hashtext($1))',[`asset-command:${actor.accountId}:${input.replayKey}`]);
      // Fleet commands take this lock before linked asset rows, including disposal checks.
      await db.query("select pg_advisory_xact_lock(hashtextextended('svu:fleet:operations',0))");
      const prior=(await db.query('select input_hash as hash,result from asset_command_receipts where actor_id=$1 and replay_key=$2',[actor.accountId,input.replayKey])).rows[0];
      if (prior && prior.hash!==hash) throw requestError(409,'This replay key belongs to a different asset command.');
      const result=prior?.result || await work(db);
      if (!prior) await db.query('insert into asset_command_receipts (actor_id,replay_key,input_hash,result) values ($1,$2,$3,$4)',[actor.accountId,input.replayKey,hash,JSON.stringify(result)]);
      const items=[];for (const assetId of result.ids) items.push(await detail(db,assetId,actor));
      return result.many ? {items} : items[0];
    });} catch(error) {
      if(error.code==='P0001' && error.message==='Resolve outstanding fleet bookings before asset disposal')throw requestError(409,error.message);
      if (error.code==='23505') throw requestError(409,'An asset identifier or active custody record already exists.');throw error;
    }
  }
  async function locked(db,id,input,action) {
    const row=await base(db,id,true);
    if (!Number.isInteger(input.revision) || input.revision<1) throw requestError(400,'Provide a positive asset revision.');
    if (row.revision!==input.revision) throw requestError(409,'Asset changed. Reload before recording this action.');
    assertAssetAction(row,action);return row;
  }
  return {
    async assetWorkspace(filters,actor) {
      if (!['assets.view','assets.manage','assets.approve'].some((p) => assetAuthority(actor,p))) throw requestError(403,'Viewing the asset register requires institution-wide asset authority.');
      const limit=Number(filters.limit || 25),offset=Number(filters.offset || 0);
      if (!Number.isInteger(limit) || limit<1 || limit>100 || !Number.isInteger(offset) || offset<0 || offset>100000 || filters.status && !assetStatuses.includes(filters.status)) throw requestError(400,'Asset register filters are invalid.');
      const staffQ=String(filters.staffQ || '').trim().slice(0,200);
      const args=[`%${String(filters.q || '').slice(0,200)}%`,filters.status || '',filters.departmentId || '',staffQ];
      const where=`where (a.asset_tag ilike $1 or a.name ilike $1 or coalesce(a.barcode,'') ilike $1 or coalesce(a.serial_number,'') ilike $1) and ($2='' or a.status=$2) and ($3='' or a.department_id=$3)
        and ($4='' or exists (select 1 from asset_custody cx join staff_members sx on sx.id=cx.staff_id where cx.asset_id=a.id and cx.ended_on is null and (sx.legal_name ilike '%' || $4 || '%' or sx.employee_number ilike '%' || $4 || '%')))`;
      return withTransaction(pool,async (db) => {
      await db.query('set transaction isolation level repeatable read read only');
      const total=Number((await db.query(`select count(*)::int as total from institution_assets a ${where}`,args)).rows[0].total);
      const items=(await db.query(`${select} ${where} order by a.asset_tag limit $5 offset $6`,[...args,limit,offset])).rows;
      const totals=(await db.query(`select a.currency,count(*)::int as count,sum(a.value_minor)::text as "valueMinor" from institution_assets a ${where} group by a.currency order by a.currency`,args)).rows;
      const departments=(await db.query("select id,name from organization_units where status='active' and unit_type='department' order by name")).rows;
      const currencies=(await db.query("select value_code as code,label from reference_values where list_code='currency' and status='active' order by value_code")).rows;
      const staff=(await db.query(`select id,employee_number as "employeeNumber",legal_name as "legalName" from staff_members where status='active' and engaged_on<=current_date and (legal_name ilike $1 or employee_number ilike $1) order by legal_name limit 100`,[`%${staffQ}%`])).rows;
      return {items,total,limit,offset,totals,departments,currencies,staff,capabilities:{manage:assetAuthority(actor,'assets.manage'),approve:assetAuthority(actor,'assets.approve')}};
      });
    },
    async getInstitutionAsset(id,filters,actor) {
      if (!['assets.view','assets.manage','assets.approve'].some((p) => assetAuthority(actor,p))) throw requestError(403,'Viewing assets requires institution-wide asset authority.');
      const offset=Number(filters.historyOffset || 0);
      if (!Number.isInteger(offset) || offset<0 || offset>100000) throw requestError(400,'Asset history offset is invalid.');
      return withTransaction(pool,async (db) => {await db.query('set transaction isolation level repeatable read read only');return detail(db,id,actor,offset);});
    },
    async registerInstitutionAsset(input,actor) {
      const data=validateAssetDefinition(input);
      return command('register',null,data,actor,'assets.manage',async (db) => {await references(db,data);return {ids:[await insert(db,data,actor)]};});
    },
    async editInstitutionAsset(id,input,actor) {
      fields(input,['revision','assetTag','barcode','serialNumber','name','category','acquiredOn','acquisitionMethod','valueMinor','currency','departmentId','location','condition','reason','replayKey']);
      const {revision,...definition}=input,data=validateAssetDefinition(definition);
      return command('edit',id,input,actor,'assets.manage',async (db) => {
        const before=await locked(db,id,{revision},'edit');await references(db,data);
        if (data.acquiredOn!==before.acquiredOn || data.currency!==before.currency || data.valueMinor!==Number(before.valueMinor)) throw requestError(409,'Acquisition date, currency and value are retained; record a new asset for a different acquisition.');
        await db.query('update institution_assets set asset_tag=$2,barcode=$3,serial_number=$4,name=$5,category=$6,acquisition_method=$7,department_id=$8,location=$9,condition=$10,last_activity_on=current_date,revision=revision+1 where id=$1',[id,data.assetTag,data.barcode,data.serialNumber,data.name.trim(),data.category.trim(),data.acquisitionMethod.trim(),data.departmentId,data.location.trim(),data.condition]);
        await event(db,id,'edited',input.reason,actor,before);return {ids:[id]};
      });
    },
    async copyInstitutionAssets(id,input,actor) {
      const data=validateAssetCopies(input);
      return command('copy',id,data,actor,'assets.manage',async (db) => {
        const source=await locked(db,id,data,'copy');
        const definition={...source,...data,valueMinor:Number(source.valueMinor)};
        await references(db,definition);
        const ids=[];for (const copy of data.copies) ids.push(await insert(db,{...definition,...copy},actor,id));
        return {ids,many:true};
      });
    },
    async recordAssetAction(id,action,input,actor) {
      const allowed={allocate:['staffId','allocatedOn','location'],return:['returnedOn','location','condition'],check:['checkedOn','outcome','observedLocation','observedCondition'],dispose:['proposedOn','valueMinor','method'],review:['outcome','reviewedOn']};
      if (!allowed[action]) throw requestError(400,'Unknown asset action.');
      fields(input,['revision','reason','replayKey',...allowed[action]]);reason(input);
      return command(action,id,input,actor,action==='review' ? 'assets.approve' : 'assets.manage',async (db) => {
        const before=await locked(db,id,input,action);
        const dateKey={allocate:'allocatedOn',return:'returnedOn',check:'checkedOn',dispose:'proposedOn',review:'reviewedOn'}[action];
        const date=assetDate(input[dateKey],before.lastActivityOn);
        let status=before.status,condition=before.condition,location=before.location;
        if (action==='allocate') {
          if (!text(input.staffId,100) || !text(input.location,200)) throw requestError(400,'Choose a staff custodian and allocation location.');
          const staff=(await db.query("select id from staff_members where id=$1 and status='active' and engaged_on<=$2 for share",[input.staffId,date])).rows[0];
          if (!staff) throw requestError(400,'Choose staff with an active employment record on the allocation date.');
          await db.query('insert into asset_custody (asset_id,staff_id,allocated_on,location,reason,actor_id) values ($1,$2,$3,$4,$5,$6)',[id,input.staffId,date,input.location.trim(),input.reason.trim(),actor.accountId]);status='allocated';location=input.location.trim();
        } else if (action==='return') {
          if (!assetConditions.includes(input.condition) || !text(input.location,200)) throw requestError(400,'Record the returned condition and location.');
          await db.query("update asset_custody set ended_on=$2,end_kind='returned',end_condition=$3,end_location=$4,end_reason=$5,end_actor=$6 where asset_id=$1 and ended_on is null",[id,date,input.condition,input.location.trim(),input.reason.trim(),actor.accountId]);status='available';condition=input.condition;location=input.location.trim();
        } else if (action==='check') {
          if (!['found','missing','damaged'].includes(input.outcome) || !assetConditions.includes(input.observedCondition) || !optional(input.observedLocation,200)
            || input.outcome==='missing' && input.observedCondition!=='missing' || input.outcome!=='missing' && (!text(input.observedLocation,200) || input.observedCondition==='missing') || input.outcome==='damaged' && input.observedCondition!=='damaged') throw requestError(400,'Record a consistent stock-check outcome, condition and observed location.');
          await db.query('insert into asset_stock_checks (asset_id,checked_on,outcome,observed_condition,observed_location,expected_location,expected_staff_id,reason,actor_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,date,input.outcome,input.observedCondition,input.observedLocation?.trim() || null,before.location,before.custodianStaffId,input.reason.trim(),actor.accountId]);condition=input.observedCondition;if (input.outcome!=='missing') location=input.observedLocation.trim();
        } else if (action==='dispose') {
          if (!money(input.valueMinor) || !text(input.method,100)) throw requestError(400,'Record disposal value and method.');
          await db.query('insert into asset_disposals (id,asset_id,proposed_on,value_minor,currency,method,reason,requested_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',[`disposal_${randomUUID()}`,id,date,input.valueMinor,before.currency,input.method.trim(),input.reason.trim(),actor.accountId]);status='disposal_pending';
        } else {
          if (!['approve','deny'].includes(input.outcome)) throw requestError(400,'Choose approve or deny.');
          const proposal=(await db.query("select id,requested_by as \"requestedBy\" from asset_disposals where asset_id=$1 and status='requested' for update",[id])).rows[0];
          if (!proposal) throw requestError(409,'The disposal has already been decided.');
          if (proposal.requestedBy===actor.accountId || before.custodianAccountId===actor.accountId) throw requestError(403,'Disposal requires an approver independent of the requester and current custodian.');
          await db.query('update asset_disposals set status=$2,reviewed_by=$3,reviewed_on=$4,review_reason=$5 where id=$1',[proposal.id,input.outcome==='approve' ? 'approved' : 'denied',actor.accountId,date,input.reason.trim()]);
          status=before.custodianStaffId ? 'allocated' : 'available';
          if (input.outcome==='approve') {
            await db.query("update asset_custody set ended_on=$2,end_kind='disposed',end_condition=$3,end_location=$4,end_reason=$5,end_actor=$6 where asset_id=$1 and ended_on is null",[id,date,before.condition,before.location,input.reason.trim(),actor.accountId]);status='disposed';
          }
        }
        await db.query('update institution_assets set status=$2,condition=$3,location=$4,last_activity_on=$5,revision=revision+1 where id=$1',[id,status,condition,location,date]);
        await event(db,id,action==='review' ? `disposal_${input.outcome==='approve' ? 'approved' : 'denied'}` : action,input.reason,actor,before);return {ids:[id]};
      });
    }
  };
}
