import test from "node:test";
import assert from "node:assert/strict";
import { openingBalanceChecksum, validateOpeningBalances } from "../server/modules/finance-migration.js";

const balances = () => [{legacyRef:"L1",studentNumber:"S25000001",amountMinor:12000},{legacyRef:"L2",studentNumber:"S25000002",amountMinor:-3000,programmeId:"spr_x"}];
const input = (overrides = {}) => ({source:"legacy-ledger",sourceRef:"FY2025-CLOSE",currency:"USD",asOf:"2025-12-31",reason:"Finance-approved closing balances",
  expectedLineCount:2,expectedDebitMinor:12000,expectedCreditMinor:3000,checksum:openingBalanceChecksum(balances()),balances:balances(),...overrides});

test("opening balances reconcile count, debit, credit and checksum separately",() => {
  assert.deepEqual(validateOpeningBalances(input(),"2026-10-04").debit,12000);
  for (const change of [{expectedLineCount:3},{expectedDebitMinor:12001},{expectedCreditMinor:2999},{checksum:openingBalanceChecksum([...balances()].reverse())}]) {
    assert.throws(() => validateOpeningBalances(input(change),"2026-10-04"),{statusCode:409});
  }
});

test("opening balance lines need unique legacy references, real student numbers and non-zero amounts",() => {
  for (const row of [{legacyRef:"L1",studentNumber:"S25000001",amountMinor:0},{legacyRef:"L1",studentNumber:"25000001",amountMinor:1},{legacyRef:"",studentNumber:"S25000001",amountMinor:1},{legacyRef:"L1",studentNumber:"S25000001",amountMinor:1.5}]) {
    assert.throws(() => validateOpeningBalances(input({balances:[row]}),"2026-10-04"),{statusCode:400});
  }
  const duplicate = [balances()[0],{...balances()[0],studentNumber:"S25000003"}];
  assert.throws(() => validateOpeningBalances(input({balances:duplicate}),"2026-10-04"),{statusCode:400});
  for (const change of [{asOf:"2026-10-05"},{currency:"usd"},{dryRun:"yes"},{balances:[]}]) assert.throws(() => validateOpeningBalances(input(change),"2026-10-04"),{statusCode:400});
});
