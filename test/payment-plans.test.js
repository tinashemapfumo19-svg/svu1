import test from "node:test";
import assert from "node:assert/strict";
import { accountSummary, planStanding } from "../server/modules/student-finance.js";
import { validateInstalments } from "../server/modules/payment-plans.js";

const charge = (id,amountMinor,dueOn,currency = "USD") => ({id,entryType:"charge",currency,amountMinor,dueOn,description:`Charge ${id}`});
const payment = (id,amountMinor,currency = "USD") => ({id,entryType:"payment",currency,amountMinor});
const plan = {id:1,currency:"USD",coveredEntryIds:[1,2],coveredAmount:90000,instalments:[{dueOn:"2026-01-31",amountMinor:30000},{dueOn:"2026-02-28",amountMinor:30000},{dueOn:"2026-03-31",amountMinor:30000}]};

test("plan standing compares what has been paid on covered charges with the instalments due so far",() => {
  const rows = [{...charge(1,60000,"2026-01-01"),outstanding:60000},{...charge(2,30000,"2026-01-01"),outstanding:30000}];
  assert.deepEqual(planStanding(plan,rows,"2026-01-15"),{status:"current",paid:0,requiredToDate:0,arrears:0,outstanding:90000,nextInstalment:{dueOn:"2026-01-31",amountMinor:30000}});
  assert.equal(planStanding(plan,rows,"2026-02-01").status,"in_arrears");
  const paidOne = [{...rows[0],outstanding:30000},rows[1]];
  assert.deepEqual([planStanding(plan,paidOne,"2026-02-01").status,planStanding(plan,paidOne,"2026-03-01").arrears],["current",30000]);
  assert.equal(planStanding(plan,rows.map((row) => ({...row,outstanding:0})),"2026-01-02").status,"completed");
});

test("a current plan lifts the hold only for its covered charges; arrears restore it",() => {
  const entries = [charge(1,60000,"2026-01-01"),charge(2,30000,"2026-01-01"),charge(3,5000,"2026-01-01"),payment(10,30000)];
  const allocations = [{paymentEntryId:10,chargeEntryId:1,amountMinor:30000}];
  const current = accountSummary(entries,allocations,"2026-02-10",null,[plan]);
  assert.deepEqual(current.hold.reasons.map((row) => row.entryId),[3]);
  assert.equal(current.plans[0].standing.status,"current");
  const behind = accountSummary(entries,allocations,"2026-03-10",null,[plan]);
  assert.deepEqual([behind.plans[0].standing.status,behind.hold.reasons.map((row) => row.entryId)],["in_arrears",[1,2,3]]);
  assert.deepEqual(accountSummary(entries.slice(0,2),[],"2026-02-10").hold.reasons.map((row) => row.entryId),[1,2]);
});

test("instalments are 2-12 dated rows within a year whose total matches the covered balance",() => {
  const today = "2026-01-10";
  assert.deepEqual(validateInstalments([{dueOn:"2026-01-31",amountMinor:500},{dueOn:"2026-02-28",amountMinor:500}],1000,today),[{dueOn:"2026-01-31",amountMinor:500},{dueOn:"2026-02-28",amountMinor:500}]);
  for (const bad of [[{dueOn:"2026-01-31",amountMinor:1000}],[{dueOn:"2026-02-28",amountMinor:500},{dueOn:"2026-01-31",amountMinor:500}],[{dueOn:"2026-01-05",amountMinor:500},{dueOn:"2026-02-28",amountMinor:500}],
    [{dueOn:"2026-01-31",amountMinor:500},{dueOn:"2027-02-28",amountMinor:500}],[{dueOn:"2026-01-31",amountMinor:400},{dueOn:"2026-02-28",amountMinor:500}],[{dueOn:"2026-02-30",amountMinor:500},{dueOn:"2026-03-31",amountMinor:500}]]) {
    assert.throws(() => validateInstalments(bad,1000,today),{statusCode:400});
  }
});
