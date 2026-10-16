import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {reconcileCashbookEvidence} from '../server/modules/cashbook-reconciliation.js';

test.skip(!process.env.DATABASE_URL || !/^\/svu_rebuild_it_\d+$/.test(new URL(process.env.DATABASE_URL).pathname),'Cashbook storage checks require the isolated integration database.');
test('cashbook storage retains policy-gated movements and independently closed periods',async()=>{
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const suffix=randomUUID(),policy=`policy_${suffix}`,book=`book_${suffix}`,bank=`bank_${suffix}`,cash=`cash_${suffix}`,movement=`expense_${suffix}`,period=`period_${suffix}`;
  try {
    const identities=(await db.query("select id,email from accounts where email in ('admin@southvalley.test','registrar@southvalley.test','tinashe@example.edu')")).rows;
    const admin=identities.find(r=>r.email==='admin@southvalley.test').id,reviewer=identities.find(r=>r.email==='registrar@southvalley.test').id,closer=identities.find(r=>r.email==='tinashe@example.edu').id;
    // Actors here exercise database constraints, not role authorization or institutional approval.
    await db.query("insert into cashbook_policies(id,title,owner,policy_reference,retention_rule,created_by) values($1,'Isolated policy','Test owner','TEST-POLICY','Retained test evidence',$2)",[policy,admin]);
    const createBook=()=>db.query("insert into cashbooks(id,policy_id,name,currency,starts_on,created_by) values($1,$2,'Isolated book','USD','2026-01-01',$3)",[book,policy,admin]);
    await expect(createBook()).rejects.toThrow('published policy');
    await expect(db.query("update cashbook_policies set status='published',revision=2,reviewed_by=$2 where id=$1",[policy,admin])).rejects.toThrow();
    await db.query("update cashbook_policies set status='published',revision=2,reviewed_by=$2 where id=$1",[policy,reviewer]);await createBook();
    for(const [id,kind] of [[bank,'bank'],[cash,'cash']])await db.query("insert into cashbook_accounts(id,book_id,name,kind,opened_on,opening_minor,opening_evidence_ref,created_by) values($1,$2,$3,$3,'2026-01-01',1000,'OPENING',$4)",[id,book,kind,admin]);
    const createMovement=(id,amount=100,account=bank)=>db.query("insert into cashbook_movements(id,book_id,kind,occurred_on,amount_minor,account_id,evidence_ref,reason,created_by) values($1,$2,'expenditure','2026-01-10',$3,$4,'EXPENSE','Recorded evidence',$5)",[id,book,amount,account,admin]);
    await expect(createMovement(`null_${suffix}`,null)).rejects.toThrow();await createMovement(movement);
    await expect(db.query("insert into cashbook_movements(id,book_id,kind,occurred_on,amount_minor,account_id,evidence_ref,reason,created_by) values($1,$2,'bank_charge','2026-01-10',1,$3,'CHARGE','Test charge',$4)",[`charge_${suffix}`,book,cash,admin])).rejects.toThrow('bank account');
    const reverse=id=>db.query("insert into cashbook_movements(id,book_id,kind,occurred_on,reverses_id,evidence_ref,reason,created_by) values($1,$2,'reversal','2026-02-10',$3,'VOID','Correct earlier expense',$4)",[id,book,movement,admin]);
    const reversal=`reverse_${suffix}`;await reverse(reversal);await expect(reverse(`duplicate_${suffix}`)).rejects.toThrow();
    await expect(db.query("update cashbook_movements set amount_minor=2 where id=$1",[movement])).rejects.toThrow();
    await expect(db.query('delete from cashbook_movements where id=$1',[movement])).rejects.toThrow();
    await db.query("insert into cashbook_periods(id,book_id,starts_on,ends_on,created_by) values($1,$2,'2026-01-01','2026-01-31',$3)",[period,book,reviewer]);
    await expect(db.query("insert into cashbook_periods(id,book_id,starts_on,ends_on,created_by) values($1,$2,'2026-01-05','2026-01-10',$3)",[`overlap_${suffix}`,book,reviewer])).rejects.toThrow('overlaps');
    await expect(db.query("insert into cashbook_periods(id,book_id,starts_on,ends_on,created_by) values($1,$2,'2026-01-01','2026-02-01',$3)",[`enclose_${suffix}`,book,reviewer])).rejects.toThrow('overlaps');
    const calculation={from:'2026-01-01',to:'2026-01-31',accounts:[{id:bank,kind:'bank',currency:'USD',openingMinor:'1000',observedMinor:'900',openingEvidenceRef:'OPENING',observationEvidenceRef:'STATEMENT'},{id:cash,kind:'cash',currency:'USD',openingMinor:'1000',observedMinor:'1000',openingEvidenceRef:'OPENING',observationEvidenceRef:'PHYSICAL_COUNT'}],events:[{id:movement,kind:'expenditure',amountMinor:'100',accountId:bank,occurredOn:'2026-01-10',evidenceRef:'EXPENSE'}]};
    let snapshot=reconcileCashbookEvidence(calculation,'2026-10-10');
    const close=(actor,connection=db)=>connection.query("update cashbook_periods set status='closed',revision=2,snapshot=$2,evidence_hash=$3,captured_at=now(),closed_by=$4,closed_at=now() where id=$1",[period,JSON.stringify(snapshot),snapshot.evidenceHash,actor]);
    await expect(db.query("update cashbook_periods set status='closed',revision=2,snapshot=$2,evidence_hash=$3,captured_at=now(),closed_by=$4,closed_at=now() where id=$1",[period,JSON.stringify({...snapshot,rows:snapshot.rows.filter(row=>row.id===bank)}),snapshot.evidenceHash,closer])).rejects.toThrow('every account');
    await expect(db.query("update cashbook_periods set status='closed',revision=2,snapshot=$2,evidence_hash=$3,captured_at='2026-01-01',closed_by=$4,closed_at=now() where id=$1",[period,JSON.stringify(snapshot),snapshot.evidenceHash,closer])).rejects.toThrow('stale');
    const waiter=new pg.Client({connectionString:process.env.DATABASE_URL});await waiter.connect();
    const newExpense=`competing_${suffix}`;let pending;
    try {
      const pid=(await waiter.query('select pg_backend_pid() as pid')).rows[0].pid;
      await db.query('begin');await createMovement(newExpense);
      pending=close(closer,waiter).then(()=>({closed:true}),error=>({error}));
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++) {
        blocked=(await db.query("select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as blocked",[pid])).rows[0].blocked;
        if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);await db.query('commit');
      const outcome=await pending;expect(outcome.closed).toBeUndefined();expect(outcome.error.message).toContain('stale');
    } finally {await db.query('rollback');if(pending)await pending;await waiter.end();}
    calculation.events.push({...calculation.events[0],id:newExpense});calculation.accounts[0].observedMinor='800';snapshot=reconcileCashbookEvidence(calculation,'2026-10-10');
    await expect(close(reviewer)).rejects.toThrow('independent');await expect(close(admin)).rejects.toThrow('independent');await close(closer);
    await expect(createMovement(`backdated_${suffix}`)).rejects.toThrow('closed cashbook history');
    await expect(db.query('update cashbook_periods set revision=3 where id=$1',[period])).rejects.toThrow('immutable');
    await expect(db.query('delete from cashbook_periods where id=$1',[period])).rejects.toThrow('retained');
    await expect(db.query('update cashbook_accounts set opening_minor=2 where id=$1',[bank])).rejects.toThrow();
    await db.query("update cashbook_policies set status='retired',revision=3 where id=$1",[policy]);
    await expect(reverse(`retired_${suffix}`)).rejects.toThrow('published policy');
    await expect(db.query("update cashbook_policies set title='Changed',revision=4 where id=$1",[policy])).rejects.toThrow('immutable');
    expect((await db.query('select count(*)::int as count from cashbook_movements where book_id=$1',[book])).rows[0].count).toBe(3);
  } finally {await db.end();}
});
