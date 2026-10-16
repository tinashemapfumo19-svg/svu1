import { assetAuthority, assetStatuses } from './assets.js';
import { insertAudit, parseEffectiveDate, requestError, todayIso, withTransaction } from '../support.js';

export function assetReportFilters(input={},today=todayIso()) {
  if (!input || Array.isArray(input) || Object.keys(input).some(k=>!['kind','q','status','departmentId','staffQ','from','to'].includes(k))) throw requestError(400,'Unsupported asset report filters.');
  const result={kind:input.kind ?? 'register'};
  if (!['register','allocations','stock_checks'].includes(result.kind)) throw requestError(400,'Choose an asset report.');
  for (const key of ['q','status','departmentId','staffQ','from','to']) {
    const value=input[key] ?? '';
    if (typeof value!=='string' || value.length>200 || /[\x00\r\n]/.test(value)) throw requestError(400,'Use bounded asset report filters.');
    result[key]=value.trim();
  }
  if (result.status && !assetStatuses.includes(result.status)) throw requestError(400,'Choose an asset status.');
  for (const key of ['from','to']) if (result[key]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) || parseEffectiveDate(result[key])>today || result[key]<'1900-01-01') throw requestError(400,'Choose a valid past report date.');
  }
  if ((result.from || result.to) && result.kind!=='stock_checks') throw requestError(400,'Date filters apply only to stock checks.');
  if (result.from && result.to && result.from>result.to) throw requestError(400,'Report dates are reversed.');
  return result;
}
const literal=v=>`%${v.replace(/[\\%_]/g,'\\$&')}%`;
const columns=['assetTag','name','category','status','condition','departmentName','location','currency','valueMinor','custodianName','employeeNumber','allocatedOn','checkedOn','outcome','observedCondition','observedLocation'];
const quote=value=>{
  const raw=String(value ?? '');
  const safe=/^[\s]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
};
export function assetReportCsv(report) {
  const header=['definitionVersion','generatedAt','kind',...columns];
  return [header.map(quote).join(','),...report.rows.map(row=>[report.definitionVersion,report.generatedAt,report.filters.kind,...columns.map(key=>row[key])].map(quote).join(','))].join('\r\n')+'\r\n';
}
export function createAssetReportingModule(pool) {
  return {
    async assetReport(input,actor) {
      if (!['assets.view','assets.manage','assets.approve'].some(p=>assetAuthority(actor,p))) throw requestError(403,'Asset reports require institution-wide asset authority.');
      const filters=assetReportFilters(input);
      return withTransaction(pool,async db=>{
        await db.query('set transaction isolation level repeatable read');
        const generatedAt=new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const checks=filters.kind==='stock_checks';
        const rows=(await db.query(`select a.asset_tag as "assetTag",a.name,a.category,a.status,a.condition,u.name as "departmentName",a.location,a.currency,a.value_minor::text as "valueMinor",
          s.legal_name as "custodianName",s.employee_number as "employeeNumber",to_char(c.allocated_on,'YYYY-MM-DD') as "allocatedOn",
          ${checks ? `to_char(k.checked_on,'YYYY-MM-DD') as "checkedOn",k.outcome,k.observed_condition as "observedCondition",k.observed_location as "observedLocation"` : `null as "checkedOn",null as outcome,null as "observedCondition",null as "observedLocation"`}
          from institution_assets a join organization_units u on u.id=a.department_id
          left join asset_custody c on c.asset_id=a.id and c.ended_on is null left join staff_members s on s.id=c.staff_id
          ${checks ? 'join asset_stock_checks k on k.asset_id=a.id' : ''}
          where (a.asset_tag ilike $1 or a.name ilike $1 or coalesce(a.barcode,'') ilike $1 or coalesce(a.serial_number,'') ilike $1)
          and ($2='' or a.status=$2) and ($3='' or a.department_id=$3)
          and ($4='' or s.legal_name ilike $5 or s.employee_number ilike $5)
          ${filters.kind==='allocations' ? 'and c.id is not null' : ''}
          ${checks ? "and ($6::date is null or k.checked_on >= $6::date) and ($7::date is null or k.checked_on <= $7::date)" : ''}
          order by a.asset_tag${checks ? ',k.checked_on,k.id' : ''} limit 5001`,
          [literal(filters.q),filters.status,filters.departmentId,filters.staffQ,literal(filters.staffQ),...(checks ? [filters.from || null,filters.to || null] : [])])).rows;
        if (rows.length>5000) throw requestError(409,'Asset report exceeds 5,000 rows. Narrow the filters before exporting.');
        const report={definitionVersion:'asset-register-reports-v1',generatedAt,filters,rows};
        await insertAudit(db,{actorId:actor.accountId,action:'assets.report.exported',subjectType:'AssetReport',subjectId:filters.kind,reason:'Native asset report exported',metadata:{definitionVersion:report.definitionVersion,filters,rowCount:rows.length}});
        return {definitionVersion:report.definitionVersion,generatedAt,rowCount:rows.length,filename:`assets-${filters.kind}.csv`,csv:assetReportCsv(report)};
      });
    }
  };
}
