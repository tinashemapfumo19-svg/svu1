import { actorCanAccessScope, insertAudit, isGlobalScope, parseEffectiveDate, requestError, todayIso, withTransaction } from '../support.js';

export const financeMetricVersion = 'finance-control-totals-v1';
const approval = 'Development definition; finance owner approval pending';
const meanings = [
  ['accounts','Programme accounts','Distinct student programme records with recorded ledger activity','Not unique students; a transferred student can have separate programme accounts'],
  ['opening','Opening balance','Opening charges minus opening credits','Subset of charged and credited; never add again to balance'],
  ['charged','Charges','Sum charge entries','Not revenue recognition or accounting expenditure'],
  ['paid','Recorded payments','Sum payment entries','By ledger recording time, not received_on; excludes credits and unmatched statement lines'],
  ['credited','Credits','Sum credit entries','Includes approved adjustments and opening credits; not payments'],
  ['balance','Net balance','Charged minus paid minus credited','Can be negative; no currency conversion or netting across currencies'],
  ['outstanding','Outstanding charges','Charges less allocations recorded by the cutoff','Not net balance; excludes unallocated payments and credits'],
  ['due','Due charges','Outstanding charges with due_on on or before the selected date','Not a separate amount to add to outstanding'],
  ['unallocated','Unallocated credit','Payments and credits less allocations recorded by the cutoff','Not unmatched imported statement lines']
];
export const financeMetrics = Object.freeze(meanings.map(([id,label,formula,exclusions]) => Object.freeze({id,label,formula,exclusions,
  unit:id === 'accounts' ? 'programme accounts' : 'currency minor units',owner:'Finance office (proposed)',approval,
  filters:'Current finance.view programme/intake scope, optional programme/intake/currency, ledger recording cutoff at end of selected UTC day',
  refresh:'On request; one repeatable-read snapshot; historical cutoff does not reconstruct former scope or programme metadata'})));
const monetary = financeMetrics.filter((entry) => entry.id !== 'accounts').map((entry) => entry.id);
function safeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw requestError(409,'Finance report totals exceed supported exact integer precision.');
  return number;
}
export function financeReportFilters(input = {},today = todayIso()) {
  if (Object.keys(input).some((key) => !['asOf','currency','programmeCode','intakeId','format'].includes(key))) throw requestError(400,'Unsupported finance report filter.');
  if (input.asOf !== undefined && (typeof input.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf))) throw requestError(400,'Select a report date.');
  const asOf = input.asOf ? parseEffectiveDate(input.asOf) : today;
  if (asOf > today) throw requestError(400,'Finance reports cannot use a future recording cutoff.');
  const out = {asOf};
  for (const key of ['currency','programmeCode','intakeId']) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 160 || /[\x00\r\n]/.test(value)) throw requestError(400,'Use bounded finance report filters.');
    out[key] = value.trim();
  }
  if (out.currency && !/^[A-Z]{3}$/.test(out.currency)) throw requestError(400,'Select a three-letter currency code.');
  out.format = input.format ?? 'json';
  if (!['json','csv'].includes(out.format)) throw requestError(400,'Choose json or csv report output.');
  return out;
}
export function financeMajorUnits(minor) {
  const value = BigInt(safeInteger(minor)),absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2,'0')}`;
}
const quote = (value,text = true) => {
  const raw = String(value ?? ''),safe = text && (/^[\s]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw)) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"','""')}"`;
};
export function financeReportCsv(report) {
  const header = ['definition_version','definition_approval','generated_at','as_of_utc','filter_programme','filter_intake','filter_currency','row_type','programmeCode','intakeId','intakeLabel','currency',...financeMetrics.map((entry) => entry.id),'reconciles'];
  const prefix = [report.definitionVersion,approval,report.generatedAt,report.asOf,report.filters.programmeCode,report.filters.intakeId,report.filters.currency];
  const records = [...report.totals.map((row) => ({...row,rowType:'currency_total'})),...report.rows.map((row) => ({...row,rowType:'intake'}))];
  return [header.map((value) => quote(value)).join(','),...records.map((row) => [...prefix,row.rowType,row.programmeCode ?? '',row.intakeId ?? '',row.intakeLabel ?? '',row.currency].map((value) => quote(value)).concat(
    financeMetrics.map((entry) => quote(entry.id === 'accounts' ? row.accounts : financeMajorUnits(row[entry.id]),false)),quote(row.reconciles,false)).join(','))].join('\r\n')+'\r\n';
}
export function createFinanceReportingModule(pool) {
  function authority(actor) {if (!actor.permissions.includes('finance.view')) throw requestError(403,'Finance reporting authority is required.');}
  return {
    async financeMetricDictionary(actor) {authority(actor);return {definitionVersion:financeMetricVersion,metrics:financeMetrics};},
    async financeControlTotals(input,actor) {
      authority(actor);const filters = financeReportFilters(input);
      return withTransaction(pool,async (db) => {
        await db.query('set transaction isolation level repeatable read');
        const generatedAt = new Date((await db.query('select transaction_timestamp() as "generatedAt"')).rows[0].generatedAt).toISOString();
        const intakes = (await db.query('select i.id as "intakeId",i.label as "intakeLabel",p.code as "programmeCode" from intakes i join programmes p on p.id = i.programme_id order by p.code,i.id')).rows
          .filter((row) => actorCanAccessScope({...actor,authorizingPermission:'finance.view'},row));
        const selected = intakes.filter((row) => ['programmeCode','intakeId'].every((key) => !filters[key] || filters[key] === row[key]));
        if (filters.intakeId && !selected.length) throw requestError(404,'Finance reporting intake was not found.');
        const ids = selected.map((row) => row.intakeId);
        // Filter the account universe before aggregating. Use recording/allocation timestamps, not business dates.
        const source = ids.length ? (await db.query(`with open_amounts as (
          select e.*,sp.intake_id,e.amount_minor - coalesce((select sum(a.amount_minor) from ledger_allocations a
            where ((e.entry_type = 'charge' and a.charge_entry_id = e.id) or (e.entry_type <> 'charge' and a.payment_entry_id = e.id))
            and a.allocated_at < (($1::date + 1)::timestamp at time zone 'UTC')),0) as open_minor
          from ledger_entries e join student_programmes sp on sp.id = e.student_programme_id
          where sp.intake_id = any($2::text[]) and e.recorded_at < (($1::date + 1)::timestamp at time zone 'UTC') and ($3::text = '' or e.currency = $3))
          select o.intake_id as "intakeId",o.currency,count(distinct o.student_programme_id)::int as accounts,
            coalesce(sum(o.amount_minor) filter (where o.entry_type = 'charge'),0)::bigint as charged,
            coalesce(sum(o.amount_minor) filter (where o.entry_type = 'payment'),0)::bigint as paid,
            coalesce(sum(o.amount_minor) filter (where o.entry_type = 'credit'),0)::bigint as credited,
            coalesce(sum(o.open_minor) filter (where o.entry_type = 'charge'),0)::bigint as outstanding,
            coalesce(sum(o.open_minor) filter (where o.entry_type = 'charge' and o.due_on <= $1::date),0)::bigint as due,
            coalesce(sum(o.open_minor) filter (where o.entry_type <> 'charge'),0)::bigint as unallocated,
            coalesce(sum(o.amount_minor) filter (where o.opening_line_id is not null and o.entry_type = 'charge'),0)::bigint - coalesce(sum(o.amount_minor) filter (where o.opening_line_id is not null and o.entry_type = 'credit'),0)::bigint as opening
          from open_amounts o group by o.intake_id,o.currency order by o.intake_id,o.currency`,[filters.asOf,ids,filters.currency])).rows : [];
        const byId = new Map(selected.map((row) => [row.intakeId,row]));
        const rows = source.map((row) => {
          const numbers = Object.fromEntries(['accounts',...monetary.filter((key) => key !== 'balance')].map((key) => [key,safeInteger(row[key])]));
          const balance = safeInteger(BigInt(numbers.charged)-BigInt(numbers.paid)-BigInt(numbers.credited));
          return {...byId.get(row.intakeId),currency:row.currency,...numbers,balance,reconciles:BigInt(numbers.outstanding)-BigInt(numbers.unallocated) === BigInt(balance)};
        });
        const totals = [...new Set(rows.map((row) => row.currency))].map((currency) => {
          const own = rows.filter((row) => row.currency === currency);
          const sums = Object.fromEntries(financeMetrics.map((entry) => [entry.id,safeInteger(own.reduce((sum,row) => sum+BigInt(row[entry.id]),0n))]));
          return {currency,...sums,reconciles:own.every((row) => row.reconciles)};
        });
        const importRoles = actor.roles.filter((role) => (role.permissions || []).includes('finance.import'));
        const queue = importRoles.some((role) => role.code === 'system_administrator' || isGlobalScope(role.scope))
          ? (await db.query("select count(*)::int as lines,coalesce(sum(l.amount_minor),0)::bigint as amount,i.currency from payment_import_lines l join payment_imports i on i.id = l.import_id where l.status = 'unmatched' and ($1::text = '' or i.currency = $1) group by i.currency order by i.currency",[filters.currency])).rows.map((row) => ({currency:row.currency,lines:safeInteger(row.lines),amount:safeInteger(row.amount)})) : null;
        const {format,...selection} = filters;
        const report = {definitionVersion:financeMetricVersion,generatedAt,asOf:filters.asOf,cutoffTimezone:'UTC',filters:selection,metrics:financeMetrics,availableIntakes:intakes,rows,totals,unmatchedQueue:queue,unmatchedQueueAsOf:queue === null ? null : generatedAt};
        await insertAudit(db,{actorId:actor.accountId,action:format === 'csv' ? 'reports.finance.exported' : 'reports.finance.accessed',subjectType:'FinanceControlTotalsReport',subjectId:financeMetricVersion,
          reason:format === 'csv' ? 'Finance control totals CSV exported' : 'Finance control totals accessed',metadata:{definitionVersion:financeMetricVersion,generatedAt,filters:selection,rowCount:rows.length,reconciles:rows.every((row) => row.reconciles)}});
        return format === 'csv' ? {csv:financeReportCsv(report),fileName:`svu-finance-control-totals-${report.asOf}.csv`,definitionVersion:financeMetricVersion,generatedAt} : report;
      });
    }
  };
}
