import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createCashbookModule} from '../server/modules/cashbook.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Cashbook atomicity checks require the isolated integration database.');

test('cashbook audit and receipt faults roll back every command before identical retries',async()=>{
  test.setTimeout(180000);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {
    const identities=(await pool.query("select id,email from accounts where email in ('admin@southvalley.test','registrar@southvalley.test','tinashe@example.edu')")).rows;
    const actor=email=>({accountId:identities.find(row=>row.email===email).id,roles:[{scope:{},permissions:['cashbook.policy.manage','cashbook.policy.approve','cashbook.manage','cashbook.approve']}]});
    // These internal actors test transaction guarantees, not public role provisioning.
    const owner=actor('admin@southvalley.test'),reviewer=actor('registrar@southvalley.test'),capturer=actor('tinashe@example.edu');
    const options={dataEncryptionKey:Buffer.alloc(32,7)},module=createCashbookModule(pool,options);
    const tables=['cashbook_policies','cashbooks','cashbook_accounts','cashbook_movements','cashbook_periods','cashbook_capture_history','cashbook_command_receipts'];
    const snapshot=async()=>JSON.stringify((await pool.query(`select jsonb_build_object(${tables.map(table=>`'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t)`).join(',')},'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from audit_events t where action like 'cashbook.%')) as state`)).rows[0].state);
    async function checked(method,args,body,person) {
      const input={...body,reason:'Isolated atomicity evidence',requestKey:randomUUID()};
      for(const target of ['audit_events','cashbook_command_receipts']) {
        const before=await snapshot();let injected=false;
        const failingPool={async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,params){if(sql.toLowerCase().includes(`insert into ${target}`)){injected=true;return client.query('select 1/0');}return client.query(sql,params);}};}};
        await expect(createCashbookModule(failingPool,options)[method](...args,input,person)).rejects.toThrow(/division by zero/);
        expect(injected,`${method}: ${target} failure point reached`).toBe(true);
        expect(await snapshot(),`${method}: no retained partial transaction`).toBe(before);
        expect((await pool.query('select count(*)::int as total from cashbook_command_receipts where actor_id=$1 and request_key=$2',[person.accountId,input.requestKey])).rows[0].total).toBe(0);
      }
      const result=await module[method](...args,input,person),committed=await snapshot();
      expect(await module[method](...args,input,person)).toEqual(result);
      expect(await snapshot(),`${method}: committed replay adds no records`).toBe(committed);
      const receipts=(await pool.query('select result from cashbook_command_receipts where actor_id=$1 and request_key=$2',[person.accountId,input.requestKey])).rows;
      expect(receipts).toHaveLength(1);expect(receipts[0].result).toEqual(result);
      return result;
    }
    const policy=await checked('createCashbookPolicy',[],{title:`Atomicity ${randomUUID()}`,owner:'Isolated owner',policyReference:'ATOMICITY',retentionRule:'Retained isolated records'},owner);
    await checked('changeCashbookPolicy',[policy.id],{revision:1,status:'published'},reviewer);
    const book=await checked('createCashbook',[],{policyId:policy.id,name:'Atomicity book',currency:'USD',startsOn:'2026-01-01'},owner);
    const bank=await checked('createCashbookAccount',[book.id],{name:'Bank',kind:'bank',openedOn:'2026-01-01',openingMinor:'1000',evidenceRef:'BANK_OPEN'},owner);
    const cash=await checked('createCashbookAccount',[book.id],{name:'Cash',kind:'cash',openedOn:'2026-01-01',openingMinor:'0',evidenceRef:'CASH_OPEN'},owner);
    await checked('recordCashbookMovement',[book.id],{kind:'revenue',occurredOn:'2026-01-05',amountMinor:'20',accountId:bank.id,evidenceRef:'REVENUE'},owner);
    const expense=await checked('recordCashbookMovement',[book.id],{kind:'expenditure',occurredOn:'2026-01-05',amountMinor:'100',accountId:bank.id,evidenceRef:'EXPENSE'},owner);
    await checked('recordCashbookMovement',[book.id],{kind:'bank_charge',occurredOn:'2026-01-05',amountMinor:'1',accountId:bank.id,evidenceRef:'CHARGE'},owner);
    await checked('recordCashbookMovement',[book.id],{kind:'transfer',occurredOn:'2026-01-05',amountMinor:'100',fromAccountId:bank.id,toAccountId:cash.id,evidenceRef:'TRANSFER'},owner);
    await checked('recordCashbookMovement',[book.id],{kind:'reversal',occurredOn:'2026-01-06',reversesId:expense.id,evidenceRef:'REVERSAL'},owner);
    const period=await checked('createCashbookPeriod',[book.id],{from:'2026-01-01',to:'2026-01-31'},owner);
    const capture=await checked('captureCashbookPeriod',[period.id],{revision:1,observations:[{accountId:bank.id,observedMinor:'919',evidenceRef:'BANK_STATEMENT'},{accountId:cash.id,observedMinor:'100',evidenceRef:'CASH_COUNT'}]},capturer);
    expect(capture.reconciles).toBe(true);
    await checked('closeCashbookPeriod',[period.id],{revision:capture.revision,evidenceHash:capture.evidenceHash},reviewer);
    await checked('changeCashbookPolicy',[policy.id],{revision:2,status:'retired'},owner);
  } finally {await pool.end();}
});
