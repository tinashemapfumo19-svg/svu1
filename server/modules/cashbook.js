import {createHmac,randomUUID} from 'node:crypto';
import {insertAudit,isGlobalScope,parseEffectiveDate,requestError,todayIso,withTransaction} from '../support.js';
import {assertActiveReference} from './student-finance.js';
import {reconcileCashbookEvidence} from './cashbook-reconciliation.js';

export function cashbookAuthority(actor,permission) {
  return actor.roles?.some(role=>role.permissions?.includes(permission) && isGlobalScope(role.scope)) || false;
}
function requireAuthority(actor,permission) {if(!cashbookAuthority(actor,permission))throw requestError(403,'Institution-wide cashbook authority is required.');}
function fields(input,allowed) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))throw requestError(400,'Unsupported cashbook command fields.');
}
function text(value,max=300) {if(typeof value!=='string' || !value.trim() || value.length>max || /[\x00\r\n]/.test(value))throw requestError(400,'Provide bounded cashbook evidence text.');return value.trim();}
function date(value) {if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw requestError(400,'Provide an exact cashbook date.');const parsed=parseEffectiveDate(value);if(parsed<'1900-01-01' || parsed>todayIso())throw requestError(400,'Provide a valid past cashbook date.');return parsed;}
function minor(value,signed=false) {if(typeof value!=='string' || !(signed ? /^(?:0|-?[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/).test(value) || value.length>20 || BigInt(value)>9223372036854775807n || BigInt(value)<-9223372036854775807n)throw requestError(400,'Provide canonical exact minor-unit strings.');return value;}
const canonical=value=>Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export function cashbookReadFilters(input,allowed) {
  fields(input,allowed);const result={};
  for(const key of allowed) {const value=input[key] ?? '0';if(typeof value!=='string' || !/^(?:0|[1-9]\d{0,5})$/.test(value) || Number(value)>100000)throw requestError(400,'Cashbook page offsets are invalid.');result[key]=Number(value);}
  return result;
}

export function createCashbookModule(pool,{dataEncryptionKey}={}) {
  async function command(action,id,input,actor,permission,work) {
    requireAuthority(actor,permission);
    if(typeof input.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))throw requestError(400,'Provide a cashbook command request key.');
    text(input.reason,2000);
    if(!Buffer.isBuffer(dataEncryptionKey) || dataEncryptionKey.length!==32)throw requestError(503,'Cashbook command key is unavailable.');
    const hash=createHmac('sha256',dataEncryptionKey).update(JSON.stringify(canonical({action,id,input}))).digest('hex');
    try {return await withTransaction(pool,async db=>{
      await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`cashbook-command:${actor.accountId}:${input.requestKey}`]);
      const prior=(await db.query('select input_hash,result from cashbook_command_receipts where actor_id=$1 and request_key=$2',[actor.accountId,input.requestKey])).rows[0];
      if(prior) {if(prior.input_hash!==hash)throw requestError(409,'Request key belongs to a different cashbook command.');return prior.result;}
      const result=await work(db);
      await insertAudit(db,{actorId:actor.accountId,action:`cashbook.${action}`,subjectType:'Cashbook',subjectId:result.id,reason:'Authorized cashbook command recorded',metadata:{revision:result.revision ?? null}});
      await db.query('insert into cashbook_command_receipts(actor_id,request_key,input_hash,result) values($1,$2,$3,$4)',[actor.accountId,input.requestKey,hash,JSON.stringify(result)]);
      return result;
    });}catch(error){if(['23503','23505','23514','P0001'].includes(error.code))throw requestError(409,'Cashbook command conflicts with retained records or policy. Reload and reconcile before retrying.');throw error;}
  }
  async function book(db,id) {
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`cashbook:${id}`]);
    const row=(await db.query("select b.*,to_char(b.starts_on,'YYYY-MM-DD') as \"startsOn\",p.status as policy_status from cashbooks b join cashbook_policies p on p.id=b.policy_id where b.id=$1 for share of p",[id])).rows[0];
    if(!row)throw requestError(404,'Cashbook was not found.');if(row.policy_status!=='published')throw requestError(409,'Cashbook policy is not published.');return row;
  }
  async function period(db,id,revision) {
    const found=(await db.query('select book_id from cashbook_periods where id=$1',[id])).rows[0];
    if(!found)throw requestError(404,'Cashbook period was not found.');const owner=await book(db,found.book_id);
    const row=(await db.query("select *,to_char(starts_on,'YYYY-MM-DD') as \"from\",to_char(ends_on,'YYYY-MM-DD') as \"to\" from cashbook_periods where id=$1 for update",[id])).rows[0];
    if(!Number.isInteger(revision) || revision<1)throw requestError(400,'Provide a positive cashbook revision.');
    if(row.revision!==revision || row.status!=='draft')throw requestError(409,'Cashbook period changed or is closed.');return {row,owner};
  }
  async function calculate(db,row,owner,observations) {
    if(!Array.isArray(observations) || observations.length>100)throw requestError(400,'Provide one closing observation per account.');
    const observed=new Map();
    for(const item of observations) {fields(item,['accountId','observedMinor','evidenceRef']);const id=text(item.accountId,100);if(observed.has(id))throw requestError(400,'Duplicate closing observation.');observed.set(id,{observedMinor:minor(item.observedMinor,true),evidenceRef:text(item.evidenceRef)});}
    const previous=(await db.query("select id,snapshot,evidence_hash,to_char(ends_on,'YYYY-MM-DD') as \"to\" from cashbook_periods where book_id=$1 and status='closed' order by ends_on desc limit 1",[owner.id])).rows[0];
    const next=previous ? new Date(Date.parse(`${previous.to}T00:00:00Z`)+86400000).toISOString().slice(0,10) : owner.startsOn;
    if(row.from!==next)throw requestError(409,'Periods must follow the latest closed period without a gap.');
    const sources=(await db.query("select *,opening_minor::text as opening,to_char(opened_on,'YYYY-MM-DD') as opened from cashbook_accounts where book_id=$1 and opened_on<=$2 order by id",[owner.id,row.to])).rows;
    if(sources.length!==observed.size)throw requestError(400,'Provide every account closing observation exactly once.');
    const accounts=sources.map(source=>{
      const observation=observed.get(source.id);if(!observation)throw requestError(400,'Missing account closing observation.');
      const prior=previous?.snapshot.rows.find(item=>item.id===source.id);
      if(previous && !prior && source.opened<=previous.to)throw requestError(409,'Previous account closing evidence requires reconciliation.');
      return {id:source.id,kind:source.kind,currency:owner.currency,openingMinor:prior?.observedMinor ?? source.opening,openingEvidenceRef:prior ? `Closed:${previous.id}:${previous.evidence_hash}` : source.opening_evidence_ref,observedMinor:observation.observedMinor,observationEvidenceRef:observation.evidenceRef};
    });
    const projection="select id,kind,to_char(occurred_on,'YYYY-MM-DD') as \"occurredOn\",amount_minor::text as \"amountMinor\",account_id as \"accountId\",from_account_id as \"fromAccountId\",to_account_id as \"toAccountId\",reverses_id as \"reversesId\",evidence_ref as \"evidenceRef\" from cashbook_movements";
    const normalize=item=>Object.fromEntries(Object.entries(item).filter(([,value])=>value!==null));
    const events=(await db.query(`${projection} where book_id=$1 and occurred_on between $2 and $3 order by occurred_on,id limit 10001`,[owner.id,row.from,row.to])).rows.map(normalize);
    const originalIds=events.filter(item=>item.kind==='reversal').map(item=>item.reversesId);
    const originals=(await db.query(`${projection} where book_id=$1 and id=any($2::text[]) and occurred_on<$3 order by id`,[owner.id,originalIds,row.from])).rows.map(item=>({...normalize(item),priorReversalId:null}));
    // Unique original-reversal constraints and the book lock bind these originals to this snapshot.
    return reconcileCashbookEvidence({from:row.from,to:row.to,accounts,events,originalMovements:originals});
  }
  return {
    async cashbookWorkspace(input,actor) {
      requireAuthority(actor,'cashbook.view');const {bookOffset,policyOffset}=cashbookReadFilters(input,['bookOffset','policyOffset']);
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const books=(await db.query("select b.id,b.name,b.currency,to_char(b.starts_on,'YYYY-MM-DD') as \"startsOn\",b.policy_id as \"policyId\",p.status as \"policyStatus\" from cashbooks b join cashbook_policies p on p.id=b.policy_id order by b.created_at desc,b.id limit 25 offset $1",[bookOffset])).rows;
        const policies=(await db.query('select id,title,owner,policy_reference as "policyReference",retention_rule as "retentionRule",status,revision,created_by as "createdBy",reviewed_by as "reviewedBy" from cashbook_policies order by created_at desc,id limit 25 offset $1',[policyOffset])).rows;
        const totals=(await db.query('select (select count(*)::int from cashbooks) as books,(select count(*)::int from cashbook_policies) as policies')).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:'cashbook.workspace.read',subjectType:'Cashbook',subjectId:'workspace',reason:'Cashbook workspace accessed',metadata:{bookOffset,policyOffset}});
        const currencies=(await db.query("select value_code as code,label from reference_values where list_code='currency' and status='active' order by value_code limit 200")).rows;
        return {books,policies,currencies,accountId:actor.accountId,bookOffset,policyOffset,bookTotal:totals.books,policyTotal:totals.policies,limit:25,capabilities:Object.fromEntries(['view','manage','approve','policy.manage','policy.approve'].map(key=>[key,cashbookAuthority(actor,`cashbook.${key}`)]))};
      });
    },
    async getCashbook(id,input,actor) {
      requireAuthority(actor,'cashbook.view');const {movementOffset,periodOffset}=cashbookReadFilters(input,['movementOffset','periodOffset']);
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const definition=(await db.query("select b.id,b.name,b.currency,b.policy_id as \"policyId\",to_char(b.starts_on,'YYYY-MM-DD') as \"startsOn\",p.status as \"policyStatus\" from cashbooks b join cashbook_policies p on p.id=b.policy_id where b.id=$1",[id])).rows[0];if(!definition)throw requestError(404,'Cashbook was not found.');
        const accounts=(await db.query("select id,name,kind,to_char(opened_on,'YYYY-MM-DD') as \"openedOn\",opening_minor::text as \"openingMinor\",opening_evidence_ref as \"openingEvidenceRef\" from cashbook_accounts where book_id=$1 order by opened_on,id limit 101",[id])).rows;if(accounts.length>100)throw requestError(409,'Cashbook account count requires reconciliation.');
        const movements=(await db.query("select id,kind,to_char(occurred_on,'YYYY-MM-DD') as \"occurredOn\",amount_minor::text as \"amountMinor\",account_id as \"accountId\",from_account_id as \"fromAccountId\",to_account_id as \"toAccountId\",reverses_id as \"reversesId\",evidence_ref as \"evidenceRef\",reason,created_by as \"createdBy\" from cashbook_movements where book_id=$1 order by occurred_on desc,recorded_at desc,id limit 25 offset $2",[id,movementOffset])).rows;
        const periods=(await db.query("select id,to_char(starts_on,'YYYY-MM-DD') as \"from\",to_char(ends_on,'YYYY-MM-DD') as \"to\",status,revision,evidence_hash as \"evidenceHash\",captured_at as \"capturedAt\",closed_at as \"closedAt\",closed_by as \"closedBy\" from cashbook_periods where book_id=$1 order by starts_on desc,id limit 25 offset $2",[id,periodOffset])).rows;
        const totals=(await db.query('select (select count(*)::int from cashbook_movements where book_id=$1) as movements,(select count(*)::int from cashbook_periods where book_id=$1) as periods',[id])).rows[0];
        await insertAudit(db,{actorId:actor.accountId,action:'cashbook.book.read',subjectType:'Cashbook',subjectId:id,reason:'Cashbook retained records accessed',metadata:{movementOffset,periodOffset}});
        return {...definition,accounts,movements,periods,movementOffset,periodOffset,movementTotal:totals.movements,periodTotal:totals.periods,limit:25};
      });
    },
    async getCashbookPeriod(id,input,actor) {
      requireAuthority(actor,'cashbook.view');const {captureOffset}=cashbookReadFilters(input,['captureOffset']);
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const row=(await db.query("select id,book_id as \"bookId\",to_char(starts_on,'YYYY-MM-DD') as \"from\",to_char(ends_on,'YYYY-MM-DD') as \"to\",status,revision,snapshot,evidence_hash as \"evidenceHash\",created_by as \"createdBy\",closed_by as \"closedBy\",captured_at as \"capturedAt\",closed_at as \"closedAt\" from cashbook_periods where id=$1",[id])).rows[0];if(!row)throw requestError(404,'Cashbook period was not found.');
        row.captures=(await db.query('select revision,actor_id as "actorId",captured_at as "capturedAt",snapshot from cashbook_capture_history where period_id=$1 order by revision desc limit 25 offset $2',[id,captureOffset])).rows;
        row.captureTotal=(await db.query('select count(*)::int as total from cashbook_capture_history where period_id=$1',[id])).rows[0].total;row.captureOffset=captureOffset;row.limit=25;
        const contributed=(await db.query('select 1 from cashbook_movements where book_id=$1 and occurred_on between $2 and $3 and created_by=$4 union all select 1 from cashbook_capture_history where period_id=$5 and actor_id=$4 limit 1',[row.bookId,row.from,row.to,actor.accountId,id])).rows.length;
        row.canClose=cashbookAuthority(actor,'cashbook.approve') && row.status==='draft' && row.createdBy!==actor.accountId && !contributed && Boolean(row.snapshot?.reconciles);
        await insertAudit(db,{actorId:actor.accountId,action:'cashbook.period.read',subjectType:'Cashbook',subjectId:id,reason:'Cashbook reconciliation evidence accessed',metadata:{revision:row.revision,captureOffset}});return row;
      });
    },
    async createCashbookPolicy(input,actor) {
      fields(input,['title','owner','policyReference','retentionRule','reason','requestKey']);
      const data=[text(input.title,200),text(input.owner,200),text(input.policyReference),text(input.retentionRule,2000)];
      return command('policy_created',null,input,actor,'cashbook.policy.manage',async db=>{const id=`cbpolicy_${randomUUID()}`;await db.query('insert into cashbook_policies(id,title,owner,policy_reference,retention_rule,created_by) values($1,$2,$3,$4,$5,$6)',[id,...data,actor.accountId]);return {id,revision:1};});
    },
    async changeCashbookPolicy(id,input,actor) {
      fields(input,['revision','status','reason','requestKey']);if(!['published','retired'].includes(input.status))throw requestError(400,'Choose publish or retire.');
      return command(`policy_${input.status}`,id,input,actor,input.status==='published' ? 'cashbook.policy.approve' : 'cashbook.policy.manage',async db=>{
        const row=(await db.query('select * from cashbook_policies where id=$1 for update',[id])).rows[0];if(!row)throw requestError(404,'Cashbook policy was not found.');
        if(!Number.isInteger(input.revision) || input.revision!==row.revision || row.status!==(input.status==='published' ? 'draft' : 'published'))throw requestError(409,'Cashbook policy changed.');
        if(input.status==='published' && row.created_by===actor.accountId)throw requestError(403,'Policy publication requires an independent approver.');
        await db.query('update cashbook_policies set status=$2,revision=revision+1,reviewed_by=$3 where id=$1',[id,input.status,input.status==='published' ? actor.accountId : row.reviewed_by]);return {id,revision:row.revision+1};
      });
    },
    async createCashbook(input,actor) {
      fields(input,['policyId','name','currency','startsOn','reason','requestKey']);const name=text(input.name,200),startsOn=date(input.startsOn),policyId=text(input.policyId,100);
      if(typeof input.currency!=='string' || !/^[A-Z]{3}$/.test(input.currency))throw requestError(400,'Choose a cashbook currency.');
      return command('book_created',null,input,actor,'cashbook.manage',async db=>{await assertActiveReference(db,'currency',input.currency);const id=`cashbook_${randomUUID()}`;await db.query('insert into cashbooks(id,policy_id,name,currency,starts_on,created_by) values($1,$2,$3,$4,$5,$6)',[id,policyId,name,input.currency,startsOn,actor.accountId]);return {id};});
    },
    async createCashbookAccount(bookId,input,actor) {
      fields(input,['name','kind','openedOn','openingMinor','evidenceRef','reason','requestKey']);if(!['bank','cash'].includes(input.kind))throw requestError(400,'Choose bank or cash.');const data=[text(input.name,200),input.kind,date(input.openedOn),minor(input.openingMinor,input.kind==='bank'),text(input.evidenceRef)];
      return command('account_created',bookId,input,actor,'cashbook.manage',async db=>{await book(db,bookId);if((await db.query('select count(*)::int as total from cashbook_accounts where book_id=$1',[bookId])).rows[0].total>=100)throw requestError(409,'A cashbook supports at most 100 accounts.');const id=`cbaccount_${randomUUID()}`;await db.query('insert into cashbook_accounts(id,book_id,name,kind,opened_on,opening_minor,opening_evidence_ref,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,bookId,...data,actor.accountId]);return {id};});
    },
    async createCashbookPeriod(bookId,input,actor) {
      fields(input,['from','to','reason','requestKey']);const from=date(input.from),to=date(input.to);if(from>to)throw requestError(400,'Cashbook period dates are reversed.');
      return command('period_created',bookId,input,actor,'cashbook.manage',async db=>{await book(db,bookId);const id=`cbperiod_${randomUUID()}`;await db.query('insert into cashbook_periods(id,book_id,starts_on,ends_on,created_by) values($1,$2,$3,$4,$5)',[id,bookId,from,to,actor.accountId]);return {id,revision:1};});
    },
    async recordCashbookMovement(bookId,input,actor) {
      fields(input,['kind','occurredOn','amountMinor','accountId','fromAccountId','toAccountId','reversesId','evidenceRef','reason','requestKey']);
      const occurredOn=date(input.occurredOn),evidenceRef=text(input.evidenceRef);
      if(!['revenue','expenditure','bank_charge','transfer','reversal'].includes(input.kind))throw requestError(400,'Choose a cashbook movement kind.');
      if(input.kind==='reversal') {
        if(['amountMinor','accountId','fromAccountId','toAccountId'].some(key=>input[key]!==undefined))throw requestError(400,'Reversals use exact retained original effects.');text(input.reversesId,100);
      } else {
        if(input.reversesId!==undefined || minor(input.amountMinor)==='0')throw requestError(400,'Provide a positive movement amount.');
        if(input.kind==='transfer') {if(input.accountId!==undefined || input.fromAccountId===input.toAccountId)throw requestError(400,'Transfer between distinct accounts.');text(input.fromAccountId,100);text(input.toAccountId,100);}
        else {if(input.fromAccountId!==undefined || input.toAccountId!==undefined)throw requestError(400,'Single-account movement fields required.');text(input.accountId,100);}
      }
      return command('movement_recorded',bookId,input,actor,'cashbook.manage',async db=>{
        await book(db,bookId);const id=`cbmovement_${randomUUID()}`;
        if(input.kind==='reversal') {const original=(await db.query('select id from cashbook_movements where book_id=$1 and id=$2',[bookId,input.reversesId])).rows[0];if(!original)throw requestError(404,'Original movement was not found.');if((await db.query('select 1 from cashbook_movements where book_id=$1 and reverses_id=$2',[bookId,input.reversesId])).rows.length)throw requestError(409,'Original movement was already reversed.');}
        await db.query('insert into cashbook_movements(id,book_id,kind,occurred_on,amount_minor,account_id,from_account_id,to_account_id,reverses_id,evidence_ref,reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,bookId,input.kind,occurredOn,input.amountMinor ?? null,input.accountId ?? null,input.fromAccountId ?? null,input.toAccountId ?? null,input.reversesId ?? null,evidenceRef,input.reason.trim(),actor.accountId]);return {id};
      });
    },
    async captureCashbookPeriod(id,input,actor) {
      fields(input,['revision','observations','reason','requestKey']);
      return command('period_captured',id,input,actor,'cashbook.manage',async db=>{const {row,owner}=await period(db,id,input.revision),snapshot=await calculate(db,row,owner,input.observations);await db.query('update cashbook_periods set revision=revision+1,snapshot=$2,evidence_hash=$3,captured_at=now() where id=$1',[id,JSON.stringify(snapshot),snapshot.evidenceHash]);await db.query('insert into cashbook_capture_history(period_id,revision,actor_id,snapshot) values($1,$2,$3,$4)',[id,row.revision+1,actor.accountId,JSON.stringify(snapshot)]);return {id,revision:row.revision+1,evidenceHash:snapshot.evidenceHash,reconciles:snapshot.reconciles};});
    },
    async closeCashbookPeriod(id,input,actor) {
      fields(input,['revision','evidenceHash','reason','requestKey']);
      return command('period_closed',id,input,actor,'cashbook.approve',async db=>{
        const {row,owner}=await period(db,id,input.revision);
        if(row.created_by===actor.accountId || (await db.query('select 1 from cashbook_movements where book_id=$1 and occurred_on between $2 and $3 and created_by=$4 limit 1',[owner.id,row.from,row.to,actor.accountId])).rows.length)throw requestError(403,'Closure requires an independent approver.');
        if((await db.query('select 1 from cashbook_capture_history where period_id=$1 and actor_id=$2 limit 1',[id,actor.accountId])).rows.length)throw requestError(403,'Observation capturers cannot approve closure.');
        if(!row.snapshot || row.evidence_hash!==input.evidenceHash)throw requestError(409,'Capture current cashbook evidence before closure.');
        const snapshot=await calculate(db,row,owner,row.snapshot.rows.map(item=>({accountId:item.id,observedMinor:item.observedMinor,evidenceRef:item.observationEvidenceRef})));
        if(snapshot.evidenceHash!==row.evidence_hash)throw requestError(409,'Cashbook evidence changed. Capture again before closure.');
        if(!snapshot.reconciles)throw requestError(409,'Resolve account discrepancies before closure. No variance exception policy is configured.');
        await db.query("update cashbook_periods set status='closed',revision=revision+1,closed_by=$2,closed_at=now() where id=$1",[id,actor.accountId]);return {id,revision:row.revision+1,evidenceHash:snapshot.evidenceHash};
      });
    }
  };
}
