import test from "node:test";
import assert from "node:assert/strict";
import { computeSponsorTransfers } from "../server/modules/sponsorships.js";

const charge = (id,chargeCode,amountMinor,dueOn,currency = "USD") => ({id,chargeCode,amountMinor,dueOn,currency});
const sponsorship = {currency:"USD",coveragePercent:75,chargeCodes:[],capMinor:null,validFrom:"2026-01-01",validTo:"2026-12-31"};

test("sponsorships cover their percentage of charges in currency, code, and validity window",() => {
  const charges = [charge(1,"TUITION",120001,"2026-02-01"),charge(2,"REGISTRATION",5000,"2026-02-01"),charge(3,"TUITION",100000,"2025-12-31"),charge(4,"TUITION",100000,"2026-02-01","EUR")];
  assert.deepEqual(computeSponsorTransfers(sponsorship,charges,new Set()),[{chargeEntryId:1,amountMinor:90000,chargeCode:"TUITION"},{chargeEntryId:2,amountMinor:3750,chargeCode:"REGISTRATION"}]);
  assert.deepEqual(computeSponsorTransfers({...sponsorship,chargeCodes:["TUITION"]},charges,new Set()).map((row) => row.chargeEntryId),[1]);
  assert.deepEqual(computeSponsorTransfers(sponsorship,charges,new Set([1])).map((row) => row.chargeEntryId),[2]);
});

test("a cap limits the total across earlier and new transfers, oldest charges first",() => {
  const charges = [charge(2,"TUITION",100000,"2026-03-01"),charge(1,"TUITION",100000,"2026-02-01")];
  assert.deepEqual(computeSponsorTransfers({...sponsorship,coveragePercent:100,capMinor:150000},charges,new Set()),[{chargeEntryId:1,amountMinor:100000,chargeCode:"TUITION"},{chargeEntryId:2,amountMinor:50000,chargeCode:"TUITION"}]);
  assert.deepEqual(computeSponsorTransfers({...sponsorship,coveragePercent:100,capMinor:150000},charges,new Set(),150000),[]);
});
