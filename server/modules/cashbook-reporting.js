import {cashbookAuthority} from './cashbook.js';
import {insertAudit,parseEffectiveDate,requestError,todayIso,withTransaction} from '../support.js';

export function cashbookReportFilters(input={},today=todayIso()) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['kind','from','to','periodId'].includes(key)))throw requestError(400,'Unsupported cashbook report filters.');
  const filters={kind:input.kind ?? 'movements',from:input.from ?? '',to:input.to ?? '',periodId:input.periodId ?? ''};
  if(!['accounts','movements','reconciliation'].includes(filters.kind))throw requestError(400,'Choose a cashbook report.');
  for(const key of ['from','to','periodId'])if(typeof filters[key]!=='string' || filters[key].length>100 || /[\x00\r\n]/.test(filters[key]))throw requestError(400,'Invalid cashbook report filters.');
  for(const key of ['from','to'])if(filters[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || parseEffectiveDate(filters[key])>today || filters[key]<'1900-01-01'))throw requestError(400,'Choose valid past report dates.');
  if(filters.from && filters.to && filters.from>filters.to)throw requestError(400,'Report dates are reversed.');
  if(filters.kind!=='movements' && (filters.from || filters.to) || filters.kind!=='reconciliation' && filters.periodId || filters.kind==='reconciliation' && !filters.periodId.trim())throw requestError(400,'Report filters do not match the selected report.');
  return filters;
}
const columns=['accountId','accountName','accountKind','openedOn','openingMinor','openingEvidenceRef','movementId','movementKind','occurredOn','amountMinor','fromAccountId','fromAccountName','toAccountId','toAccountName','reversesId','originalMovementKind','originalOccurredOn','originalAmountMinor','originalAccountId','originalFromAccountId','originalToAccountId','evidenceRef','reason','periodId','from','to','status','revision','capturedAt','closedAt','closedBy','evidenceHash','snapshotDefinitionVersion','capturedSnapshotOnly','snapshotReconciles','incomingMinor','outgoingMinor','expectedMinor','observedMinor','varianceMinor','observationEvidenceRef'];
const quote=value=>{
  const raw=value instanceof Date ? value.toISOString() : String(value ?? '');
  const safe=/^\s*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
};
export function cashbookReportCsv(report) {
  const metadata=['definitionVersion','generatedAt','kind','filterFrom','filterTo','bookId','bookName','currency','policyId','policyStatus'];
  const values={...report,kind:report.filters.kind,filterFrom:report.filters.from,filterTo:report.filters.to};
  return [[...metadata,...columns].map(quote).join(','),...report.rows.map(row=>[...metadata.map(key=>values[key]),...columns.map(key=>row[key])].map(quote).join(','))].join('\r\n')+'\r\n';
}
export function createCashbookReportingModule(pool) {
  return {async cashbookReport(bookId,input,actor) {
    if(!cashbookAuthority(actor,'cashbook.view'))throw requestError(403,'Institution-wide cashbook authority is required.');
    const filters=cashbookReportFilters(input);
    return withTransaction(pool,async db=>{
      await db.query('set transaction isolation level repeatable read');
      const definition=(await db.query('select b.id as "bookId",b.name as "bookName",b.currency,b.policy_id as "policyId",p.status as "policyStatus" from cashbooks b join cashbook_policies p on p.id=b.policy_id where b.id=$1',[bookId])).rows[0];
      if(!definition)throw requestError(404,'Cashbook was not found.');
      const generatedAt=new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
      let rows;
      if(filters.kind==='accounts')rows=(await db.query("select id as \"accountId\",name as \"accountName\",kind as \"accountKind\",to_char(opened_on,'YYYY-MM-DD') as \"openedOn\",opening_minor::text as \"openingMinor\",opening_evidence_ref as \"openingEvidenceRef\" from cashbook_accounts where book_id=$1 order by opened_on,id limit 5001",[bookId])).rows;
      if(filters.kind==='movements')rows=(await db.query(`select m.id as "movementId",m.kind as "movementKind",to_char(m.occurred_on,'YYYY-MM-DD') as "occurredOn",m.amount_minor::text as "amountMinor",
        m.account_id as "accountId",a.name as "accountName",a.kind as "accountKind",m.from_account_id as "fromAccountId",f.name as "fromAccountName",m.to_account_id as "toAccountId",t.name as "toAccountName",m.reverses_id as "reversesId",o.kind as "originalMovementKind",to_char(o.occurred_on,'YYYY-MM-DD') as "originalOccurredOn",o.amount_minor::text as "originalAmountMinor",o.account_id as "originalAccountId",o.from_account_id as "originalFromAccountId",o.to_account_id as "originalToAccountId",m.evidence_ref as "evidenceRef",m.reason
        from cashbook_movements m left join cashbook_accounts a on a.book_id=m.book_id and a.id=m.account_id
        left join cashbook_accounts f on f.book_id=m.book_id and f.id=m.from_account_id left join cashbook_accounts t on t.book_id=m.book_id and t.id=m.to_account_id
        left join cashbook_movements o on o.book_id=m.book_id and o.id=m.reverses_id
        where m.book_id=$1 and ($2::date is null or m.occurred_on >= $2::date) and ($3::date is null or m.occurred_on <= $3::date)
        order by m.occurred_on,m.recorded_at,m.id limit 5001`,[bookId,filters.from || null,filters.to || null])).rows;
      if(filters.kind==='reconciliation') {
        const period=(await db.query("select id as \"periodId\",to_char(starts_on,'YYYY-MM-DD') as \"from\",to_char(ends_on,'YYYY-MM-DD') as \"to\",status,revision,captured_at as \"capturedAt\",closed_at as \"closedAt\",closed_by as \"closedBy\",evidence_hash as \"evidenceHash\",snapshot from cashbook_periods where id=$1 and book_id=$2",[filters.periodId,bookId])).rows[0];
        if(!period)throw requestError(404,'Cashbook period was not found.');
        if(!period.snapshot)throw requestError(409,'Capture the reconciliation before exporting its evidence.');
        const accounts=(await db.query('select id,name,kind from cashbook_accounts where book_id=$1',[bookId])).rows;
        const names=new Map(accounts.map(row=>[row.id,row]));
        const {snapshot,...facts}=period;
        rows=snapshot.rows.map(row=>({...facts,accountId:row.id,accountName:names.get(row.id)?.name,accountKind:row.kind,openingMinor:row.openingMinor,openingEvidenceRef:row.openingEvidenceRef,incomingMinor:row.incomingMinor,outgoingMinor:row.outgoingMinor,expectedMinor:row.expectedMinor,observedMinor:row.observedMinor,varianceMinor:row.varianceMinor,observationEvidenceRef:row.observationEvidenceRef,snapshotDefinitionVersion:snapshot.definitionVersion,capturedSnapshotOnly:true,snapshotReconciles:snapshot.reconciles}));
      }
      if(rows.length>5000)throw requestError(409,'Cashbook report exceeds 5,000 rows. Narrow the report before exporting.');
      const report={...definition,definitionVersion:'cashbook-reports-v1',generatedAt,filters,rows};
      const csv=cashbookReportCsv(report);
      await insertAudit(db,{actorId:actor.accountId,action:'cashbook.report.exported',subjectType:'Cashbook',subjectId:bookId,reason:'Native cashbook report exported',metadata:{definitionVersion:report.definitionVersion,kind:filters.kind,from:filters.from,to:filters.to,periodId:filters.periodId || null,rowCount:rows.length}});
      return {definitionVersion:report.definitionVersion,generatedAt,rowCount:rows.length,filename:`cashbook-${filters.kind}.csv`,csv};
    });
  }};
}
