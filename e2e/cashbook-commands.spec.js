import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createCashbookModule} from '../server/modules/cashbook.js';
test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Cashbook command checks require the isolated integration database.');
test('cashbook commands capture native evidence with audited replay and independent closure',async()=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {
    const identities=(await pool.query("select id,email from accounts where email in ('admin@southvalley.test','registrar@southvalley.test','tinashe@example.edu')")).rows;
    const actor=email=>({accountId:identities.find(row=>row.email===email).id,roles:[{code:'isolated_fixture',scope:{},permissions:['cashbook.policy.manage','cashbook.policy.approve','cashbook.manage','cashbook.approve']}]});
    // Internal-module fixtures are not real role appointments or public API authorization tests.
    const admin=actor('admin@southvalley.test'),reviewer=actor('registrar@southvalley.test'),capturer=actor('tinashe@example.edu');
    const module=createCashbookModule(pool,{dataEncryptionKey:Buffer.alloc(32,1)}),command=body=>({...body,reason:'Isolated command evidence',requestKey:randomUUID()});
    const policy=await module.createCashbookPolicy(command({title:'Isolated policy',owner:'Test owner',policyReference:'TEST-POLICY',retentionRule:'Retained test evidence'}),admin);
    await expect(module.changeCashbookPolicy(policy.id,command({revision:1,status:'published'}),admin)).rejects.toMatchObject({statusCode:403});
    await module.changeCashbookPolicy(policy.id,command({revision:1,status:'published'}),reviewer);
    const book=await module.createCashbook(command({policyId:policy.id,name:'Isolated cashbook',currency:'USD',startsOn:'2026-01-01'}),admin);
    const bank=await module.createCashbookAccount(book.id,command({name:'Bank',kind:'bank',openedOn:'2026-01-01',openingMinor:'1000',evidenceRef:'OPEN_BANK'}),admin);
    const cash=await module.createCashbookAccount(book.id,command({name:'Cash',kind:'cash',openedOn:'2026-01-01',openingMinor:'0',evidenceRef:'OPEN_CASH'}),admin);
    const payment=command({kind:'expenditure',occurredOn:'2026-01-05',amountMinor:'100',accountId:bank.id,evidenceRef:'EXPENSE'});
    const results=await Promise.all([module.recordCashbookMovement(book.id,payment,admin),module.recordCashbookMovement(book.id,payment,admin)]);expect(results[0]).toEqual(results[1]);
    await expect(module.recordCashbookMovement(book.id,{...payment,amountMinor:'101'},admin)).rejects.toMatchObject({statusCode:409});
    const period=await module.createCashbookPeriod(book.id,command({from:'2026-01-01',to:'2026-01-31'}),admin);
    const observations=amount=>[{accountId:bank.id,observedMinor:amount,evidenceRef:'BANK_STATEMENT'},{accountId:cash.id,observedMinor:'0',evidenceRef:'CASH_COUNT'}];
    await expect(module.captureCashbookPeriod(period.id,command({revision:1,observations:[]}),capturer)).rejects.toMatchObject({statusCode:400});
    let capture=await module.captureCashbookPeriod(period.id,command({revision:1,observations:observations('900')}),capturer);expect(capture.reconciles).toBe(true);
    await expect(module.closeCashbookPeriod(period.id,command({revision:capture.revision,evidenceHash:capture.evidenceHash}),capturer)).rejects.toMatchObject({statusCode:403});
    await expect(module.closeCashbookPeriod(period.id,command({revision:capture.revision,evidenceHash:capture.evidenceHash}),admin)).rejects.toMatchObject({statusCode:403});
    await module.recordCashbookMovement(book.id,command({kind:'bank_charge',occurredOn:'2026-01-06',amountMinor:'1',accountId:bank.id,evidenceRef:'CHARGE'}),admin);
    await expect(module.closeCashbookPeriod(period.id,command({revision:capture.revision,evidenceHash:capture.evidenceHash}),reviewer)).rejects.toMatchObject({statusCode:409});
    capture=await module.captureCashbookPeriod(period.id,command({revision:capture.revision,observations:observations('900')}),capturer);expect(capture.reconciles).toBe(false);
    await expect(module.closeCashbookPeriod(period.id,command({revision:capture.revision,evidenceHash:capture.evidenceHash}),reviewer)).rejects.toThrow('discrepancies');
    capture=await module.captureCashbookPeriod(period.id,command({revision:capture.revision,observations:observations('899')}),capturer);
    const closeInput=command({revision:capture.revision,evidenceHash:capture.evidenceHash}),closed=await module.closeCashbookPeriod(period.id,closeInput,reviewer);
    expect(await module.closeCashbookPeriod(period.id,closeInput,reviewer)).toEqual(closed);
    const next=await module.createCashbookPeriod(book.id,command({from:'2026-02-01',to:'2026-02-28'}),admin);
    await module.recordCashbookMovement(book.id,command({kind:'reversal',occurredOn:'2026-02-05',reversesId:results[0].id,evidenceRef:'VOID_APPROVAL'}),admin);
    const feb=await module.captureCashbookPeriod(next.id,command({revision:1,observations:observations('999')}),capturer);expect(feb.reconciles).toBe(true);
    const stored=(await pool.query('select snapshot from cashbook_periods where id=$1',[next.id])).rows[0].snapshot;
    expect(stored.rows.find(row=>row.id===bank.id).openingMinor).toBe('899');expect(stored.originalMovementCount).toBe(1);
    expect((await pool.query('select count(*)::int as count from cashbook_capture_history where period_id=$1',[period.id])).rows[0].count).toBe(3);
    await expect(pool.query('delete from cashbook_capture_history where period_id=$1',[period.id])).rejects.toThrow();
    const audits=(await pool.query("select reason,metadata from audit_events where subject_type='Cashbook' and subject_id=$1",[period.id])).rows;
    expect(audits.length).toBeGreaterThan(0);expect(JSON.stringify(audits)).not.toContain('BANK_STATEMENT');
    await module.changeCashbookPolicy(policy.id,command({revision:2,status:'retired'}),admin);
    await expect(module.createCashbookPeriod(book.id,command({from:'2026-03-01',to:'2026-03-31'}),admin)).rejects.toMatchObject({statusCode:409});
  } finally {await pool.end();}
});
