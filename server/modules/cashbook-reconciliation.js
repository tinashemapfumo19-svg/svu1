import { createHash } from 'node:crypto';
import { parseEffectiveDate, requestError, todayIso } from '../support.js';

const maximum=9223372036854775807n;
function fields(value,allowed) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw requestError(400,'Unsupported cashbook evidence fields.');
}
function identifier(value) {
  if (typeof value!=='string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw requestError(400,'Provide a bounded cashbook identifier.');
  return value;
}
function reference(value) {
  if (typeof value!=='string' || !value.trim() || value.length>300 || /[\x00\r\n]/.test(value)) throw requestError(400,'Provide a bounded cashbook evidence reference.');
  return value.trim();
}
function amount(value,signed=false) {
  if (typeof value!=='string' || !(signed ? /^(?:0|-?[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/).test(value) || value.length>20) throw requestError(400,'Cashbook amounts must be canonical decimal minor-unit strings.');
  const result=BigInt(value);
  if (result>maximum || result < -maximum) throw requestError(400,'Cashbook amount exceeds the supported integer range.');
  return result;
}
function date(value,today) {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw requestError(400,'Provide an exact cashbook date.');
  const result=parseEffectiveDate(value);
  if (result<'1900-01-01' || result>today) throw requestError(400,'Cashbook dates must be valid past dates.');
  return result;
}
export function cashbookPeriodsOverlap(left,right) {
  for (const period of [left,right]) {
    fields(period,['from','to']);
    const from=date(period.from,'9999-12-31'),to=date(period.to,'9999-12-31');
    if (from>to) throw requestError(400,'Cashbook period dates are reversed.');
  }
  return left.from<=right.to && right.from<=left.to;
}
function exact(value) {
  if (value>maximum || value < -maximum) throw requestError(409,'Cashbook reconciliation totals exceed supported exact storage bounds.');
  return value.toString();
}

// Pure evidence calculation only. Callers must separately authorize and snapshot retained records.
export function reconcileCashbookEvidence(input,today=todayIso()) {
  fields(input,['from','to','accounts','events','originalMovements']);
  const from=date(input.from,today),to=date(input.to,today);
  if (from>to) throw requestError(400,'Cashbook period dates are reversed.');
  if (!Array.isArray(input.accounts) || !input.accounts.length || input.accounts.length>100 || !Array.isArray(input.events) || input.events.length>10000) throw requestError(400,'Provide 1-100 accounts and at most 10,000 cashbook movements.');
  const originalMovements=input.originalMovements ?? [];
  if (!Array.isArray(originalMovements) || originalMovements.length>10000) throw requestError(400,'Provide bounded retained original-movement evidence.');
  const accounts=new Map(),events=new Map(),originals=new Map(),reversed=new Set();
  for (const row of input.accounts) {
    fields(row,['id','kind','currency','openingMinor','observedMinor','openingEvidenceRef','observationEvidenceRef']);
    const id=identifier(row.id);
    if (accounts.has(id) || !['bank','cash'].includes(row.kind) || typeof row.currency!=='string' || !/^[A-Z]{3}$/.test(row.currency)) throw requestError(400,'Cashbook accounts must be unique and have an explicit kind and currency.');
    const opening=amount(row.openingMinor,row.kind==='bank'),observed=amount(row.observedMinor,row.kind==='bank');
    accounts.set(id,{id,kind:row.kind,currency:row.currency,opening,observed,incoming:0n,outgoing:0n,openingEvidenceRef:reference(row.openingEvidenceRef),observationEvidenceRef:reference(row.observationEvidenceRef)});
  }
  function parseMovement(row,historical=false) {
    fields(row,['id','kind','occurredOn','amountMinor','accountId','fromAccountId','toAccountId','reversesId','evidenceRef',...(historical ? ['priorReversalId'] : [])]);
    const id=identifier(row.id),occurredOn=date(row.occurredOn,today);
    if (events.has(id) || originals.has(id) || (historical ? occurredOn>=from : occurredOn<from || occurredOn>to) || !['revenue','expenditure','bank_charge','transfer','reversal'].includes(row.kind)) throw requestError(400,'Cashbook movements must be unique, supported and in their declared evidence period.');
    if (historical && (row.kind==='reversal' || row.priorReversalId!==null)) throw requestError(400,'Retained originals must explicitly have no prior reversal.');
    const event={id,kind:row.kind,occurredOn,evidenceRef:reference(row.evidenceRef)};
    if (row.kind==='reversal') {
      if (['amountMinor','accountId','fromAccountId','toAccountId'].some(key=>row[key]!==undefined)) throw requestError(400,'A reversal takes its exact effects from the original movement.');
      event.reversesId=identifier(row.reversesId);
    } else {
      if (row.reversesId!==undefined) throw requestError(400,'Only a reversal may reference a reversed movement.');
      event.amount=amount(row.amountMinor);
      if (event.amount===0n) throw requestError(400,'A cashbook movement must be positive.');
      if (row.kind==='transfer') {
        if (row.accountId!==undefined) throw requestError(400,'A transfer needs separate source and destination accounts.');
        event.fromAccountId=identifier(row.fromAccountId);event.toAccountId=identifier(row.toAccountId);
        const source=accounts.get(event.fromAccountId),destination=accounts.get(event.toAccountId);
        if (!source || !destination || source.id===destination.id || source.currency!==destination.currency) throw requestError(400,'Transfers require two distinct accounts in the same currency.');
      } else {
        if (row.fromAccountId!==undefined || row.toAccountId!==undefined) throw requestError(400,'Revenue and expenditure affect one account.');
        event.accountId=identifier(row.accountId);
        const account=accounts.get(event.accountId);
        if (!account || row.kind==='bank_charge' && account.kind!=='bank') throw requestError(400,'Choose a valid account for the cashbook movement.');
      }
    }
    return event;
  }
  for (const row of input.events) {const event=parseMovement(row);events.set(event.id,event);}
  for (const row of originalMovements) {const event=parseMovement(row,true);originals.set(event.id,event);}
  const totals=new Map();
  for (const account of accounts.values()) if (!totals.has(account.currency)) totals.set(account.currency,{currency:account.currency,revenue:0n,expenditure:0n,bankCharges:0n,transferred:0n,opening:0n,expected:0n,observed:0n,variance:0n});
  function apply(event,direction) {
    if (event.kind==='transfer') {
      const source=accounts.get(event.fromAccountId),destination=accounts.get(event.toAccountId);
      source.outgoing+=direction*event.amount;destination.incoming+=direction*event.amount;
      totals.get(source.currency).transferred+=direction*event.amount;
    } else {
      const account=accounts.get(event.accountId),total=totals.get(account.currency);
      if (event.kind==='revenue') {account.incoming+=direction*event.amount;total.revenue+=direction*event.amount;}
      else {account.outgoing+=direction*event.amount;total.expenditure+=direction*event.amount;if(event.kind==='bank_charge')total.bankCharges+=direction*event.amount;}
    }
  }
  for (const event of events.values()) if (event.kind!=='reversal') apply(event,1n);
  for (const event of events.values()) if (event.kind==='reversal') {
    const original=events.get(event.reversesId) || originals.get(event.reversesId);
    if (!original || original.kind==='reversal' || event.occurredOn<original.occurredOn || reversed.has(original.id)) throw requestError(400,'Reversals require one unreversed original movement dated no later than the reversal.');
    reversed.add(original.id);apply(original,-1n);
  }
  if ([...originals.keys()].some(id=>!reversed.has(id))) throw requestError(400,'Every retained original must support a reversal in the selected period.');
  const rows=[...accounts.values()].sort((a,b)=>a.id.localeCompare(b.id,'en')).map(account=>{
    const expected=account.opening+account.incoming-account.outgoing,variance=account.observed-expected,total=totals.get(account.currency);
    for (const [key,value] of Object.entries({opening:account.opening,expected,observed:account.observed,variance}))total[key]+=value;
    return {id:account.id,kind:account.kind,currency:account.currency,openingMinor:exact(account.opening),incomingMinor:exact(account.incoming),outgoingMinor:exact(account.outgoing),expectedMinor:exact(expected),observedMinor:exact(account.observed),varianceMinor:exact(variance),reconciles:variance===0n,openingEvidenceRef:account.openingEvidenceRef,observationEvidenceRef:account.observationEvidenceRef};
  });
  const currencyTotals=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency,'en')).map(total=>({currency:total.currency,...Object.fromEntries(Object.entries(total).filter(([key])=>key!=='currency').map(([key,value])=>[`${key}Minor`,exact(value)])),reconciles:rows.filter(row=>row.currency===total.currency).every(row=>row.reconciles)}));
  const evidenceList=list=>[...list.values()].sort((a,b)=>a.id.localeCompare(b.id,'en')).map(event=>({...event,...(event.amount!==undefined ? {amount:event.amount.toString()} : {})}));
  const definitionVersion='cashbook-reconciliation-v2';
  const evidenceHash=createHash('sha256').update(JSON.stringify({definitionVersion,from,to,accounts:rows,events:evidenceList(events),originalMovements:evidenceList(originals)})).digest('hex');
  return {definitionVersion,from,to,rows,currencyTotals,movementCount:events.size,reversalCount:reversed.size,originalMovementCount:originals.size,reconciles:rows.every(row=>row.reconciles),evidenceHash};
}
