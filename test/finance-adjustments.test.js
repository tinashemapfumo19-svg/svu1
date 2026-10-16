import test from "node:test";
import assert from "node:assert/strict";
import { adjustmentEffect, ledgerEvidenceHash, validateAdjustment, validateAdjustmentReview } from "../server/modules/finance-adjustments.js";
import { accountSummary } from "../server/modules/student-finance.js";

const hash = "b".repeat(64);
const base = (kind,extra) => ({kind,evidenceHash:hash,reason:"Bursary committee minute",evidenceRef:"SAMPLE-MINUTE",...extra});
const entries = [{id:1,entryType:"charge",currency:"USD",amountMinor:1000,dueOn:"2026-10-01",description:"Tuition",chargeCode:"TUITION"},{id:2,entryType:"payment",currency:"USD",amountMinor:300}];
const summary = (allocations = [{paymentEntryId:2,chargeEntryId:1,amountMinor:300}],exemption = null) => accountSummary(entries,allocations,"2026-10-03",exemption);

test("adjustment requests carry only the fields their type needs",() => {
  assert.deepEqual(validateAdjustment(base("waiver",{amountMinor:500,targetEntryId:1}),"2026-10-03"),{});
  assert.deepEqual(validateAdjustment(base("debit",{amountMinor:500,currency:"USD",description:"Late registration",dueOn:"2026-10-10"}),"2026-10-03"),{dueOn:"2026-10-10",description:"Late registration"});
  assert.deepEqual(validateAdjustment(base("hold_exemption",{expiresOn:"2026-11-01"}),"2026-10-03"),{expiresOn:"2026-11-01"});
  assert.deepEqual(validateAdjustment(base("refund",{amountMinor:100,currency:"USD"}),"2026-10-03"),{});
  for (const invalid of [base("discount",{amountMinor:1,targetEntryId:1}),base("waiver",{amountMinor:1}),base("waiver",{amountMinor:1,targetEntryId:1,currency:"USD"}),base("waiver",{amountMinor:0,targetEntryId:1}),
    base("debit",{amountMinor:1,currency:"USD"}),base("refund",{amountMinor:1}),base("hold_exemption",{expiresOn:"2026-10-02"}),base("hold_exemption",{expiresOn:"2027-06-01"}),
    base("hold_exemption",{expiresOn:"2026-11-01",amountMinor:1}),{...base("waiver",{amountMinor:1,targetEntryId:1}),reason:""},{...base("waiver",{amountMinor:1,targetEntryId:1}),evidenceHash:"stale"}]) {
    assert.throws(() => validateAdjustment(invalid,"2026-10-03"),{statusCode:400});
  }
  assert.doesNotThrow(() => validateAdjustmentReview({outcome:"revoked",reason:"Payment plan broken"}));
  assert.throws(() => validateAdjustmentReview({outcome:"approved",reason:""}),{statusCode:400});
});

test("credits cannot exceed a charge's outstanding amount and refunds cannot exceed credit",() => {
  assert.equal(adjustmentEffect({kind:"scholarship",amountMinor:700,targetEntryId:1},summary()).currency,"USD");
  assert.throws(() => adjustmentEffect({kind:"waiver",amountMinor:701,targetEntryId:1},summary()),{statusCode:409});
  assert.throws(() => adjustmentEffect({kind:"waiver",amountMinor:1,targetEntryId:2},summary()),{statusCode:404});
  assert.throws(() => adjustmentEffect({kind:"refund",amountMinor:1,currency:"USD"},summary()),{statusCode:409});
  assert.doesNotThrow(() => adjustmentEffect({kind:"refund",amountMinor:300,currency:"USD"},summary([])));
  assert.throws(() => adjustmentEffect({kind:"hold_exemption"},accountSummary(entries,[],"2026-09-01")),{statusCode:409});
});

test("ledger evidence changes with any allocation, and active exemptions lift the hold but keep reasons",() => {
  assert.notEqual(ledgerEvidenceHash(summary()),ledgerEvidenceHash(summary([])));
  const exempt = summary(undefined,{id:9,expiresOn:"2026-10-31",reason:"Sponsor letter"});
  assert.equal(exempt.hold.held,false); assert.equal(exempt.hold.reasons.length,1); assert.equal(exempt.hold.exemption.id,9);
  assert.equal(summary(undefined,{id:9,expiresOn:"2026-10-02"}).hold.held,true);
  const credited = accountSummary([...entries,{id:3,entryType:"credit",currency:"USD",amountMinor:700}],[{paymentEntryId:2,chargeEntryId:1,amountMinor:300},{paymentEntryId:3,chargeEntryId:1,amountMinor:700}],"2026-10-03");
  assert.deepEqual(credited.currencies[0],{currency:"USD",charged:1000,paid:300,credited:700,balance:0,due:0,credit:0});
  assert.equal(credited.hold.held,false);
});
