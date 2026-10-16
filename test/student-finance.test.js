import test from "node:test";
import assert from "node:assert/strict";
import { accountSummary, allocateFifo, validateFeeSchedule, validatePayment } from "../server/modules/student-finance.js";
import { registrationEligibility } from "../server/modules/course-registration.js";

const schedule = () => ({programmeId:"prog",yearOfStudy:1,term:"S1",currency:"USD",effectiveFrom:"2026-01-01",dueDays:14,reason:"Approved 2026 fees",
  lines:[{chargeCode:"TUITION",description:"Tuition",amountMinor:120000},{chargeCode:"REGISTRATION",description:"Registration",amountMinor:5000}]});
const payment = () => ({currency:"USD",amountMinor:5000,method:"bank",externalRef:"BANK-1",receivedOn:"2026-10-01",reason:"Bank statement line"});

test("fee schedules need governed whole minor-unit lines with unique charge codes",() => {
  assert.equal(validateFeeSchedule(schedule()).lines.length,2);
  for (const change of [{currency:"usd"},{yearOfStudy:0},{term:"S4"},{dueDays:-1},{reason:""},{lines:[]},{effectiveFrom:"2026-02-30"},{discount:10}]) assert.throws(() => validateFeeSchedule({...schedule(),...change}),{statusCode:400});
  for (const line of [{chargeCode:"TUITION",description:"x",amountMinor:10.5},{chargeCode:"TUITION",description:"x",amountMinor:0},{chargeCode:"tuition",description:"x",amountMinor:1},{chargeCode:"TUITION",description:"",amountMinor:1}]) {
    assert.throws(() => validateFeeSchedule({...schedule(),lines:[line]}),{statusCode:400});
  }
  assert.throws(() => validateFeeSchedule({...schedule(),lines:[schedule().lines[0],schedule().lines[0]]}),{statusCode:400});
});

test("payments need a reference, positive whole amount and a received date that is not in the future",() => {
  assert.deepEqual(validatePayment(payment(),"2026-10-03"),{receivedOn:"2026-10-01",externalRef:"BANK-1"});
  for (const change of [{amountMinor:-5},{amountMinor:1.5},{method:"cheque"},{externalRef:" "},{receivedOn:"2026-10-04"},{reason:""},{studentNumber:"S1"}]) assert.throws(() => validatePayment({...payment(),...change},"2026-10-03"),{statusCode:400});
});

test("FIFO allocation settles the earliest-due charge first and keeps overpayment as credit",() => {
  const charges = [{id:2,dueOn:"2026-02-01",outstanding:300},{id:1,dueOn:"2026-01-01",outstanding:100}];
  assert.deepEqual(allocateFifo(charges,[{id:5,unallocated:250}]),[{paymentEntryId:5,chargeEntryId:1,amountMinor:100},{paymentEntryId:5,chargeEntryId:2,amountMinor:150}]);
  assert.deepEqual(allocateFifo(charges,[{id:5,unallocated:50},{id:6,unallocated:600}]).map((row) => [row.paymentEntryId,row.chargeEntryId,row.amountMinor]),[[5,1,50],[6,1,50],[6,2,300]]);
  assert.deepEqual(allocateFifo([],[{id:5,unallocated:50}]),[]);
});

test("account holds explain due outstanding charges only, per currency",() => {
  const entries = [
    {id:1,entryType:"charge",currency:"USD",amountMinor:1000,dueOn:"2026-10-01",description:"Tuition"},
    {id:2,entryType:"charge",currency:"USD",amountMinor:500,dueOn:"2026-12-01",description:"Library"},
    {id:3,entryType:"payment",currency:"USD",amountMinor:400},
    {id:4,entryType:"payment",currency:"ZAR",amountMinor:900}
  ];
  const summary = accountSummary(entries,[{paymentEntryId:3,chargeEntryId:1,amountMinor:400}],"2026-10-03");
  assert.deepEqual(summary.currencies,[{currency:"USD",charged:1500,paid:400,credited:0,balance:1100,due:600,credit:0},{currency:"ZAR",charged:0,paid:900,credited:0,balance:-900,due:0,credit:900}]);
  assert.equal(summary.hold.held,true);
  assert.deepEqual(summary.hold.reasons.map((row) => [row.entryId,row.amountMinor]),[[1,600]]);
  assert.match(summary.hold.reasons[0].message,/USD 6\.00 outstanding, due 2026-10-01/);
  assert.equal(accountSummary(entries,[{paymentEntryId:3,chargeEntryId:1,amountMinor:400}],"2026-09-30").hold.held,false);
});

test("a financial hold blocks registration even with a recorded financial clearance",() => {
  const base = {programme:{status:"onboarded",programmeVersionId:"v"},period:{programmeVersionId:"v",status:"open",calendarStatus:"published",windows:{registration:["2026-01-01","2026-12-31"]},creditLimit:30,startsOn:"2026-02-01",yearOfStudy:1},
    offerings:[{courseId:"c",code:"C1",credits:15,requirementType:"core",status:"active",effectiveFrom:"2024-01-01",delivery:"asynchronous",meetings:[]}],selectedCourses:["c"],revision:1,today:"2026-10-03",
    checks:["academic","financial"].map((checkType) => ({checkType,outcome:"eligible",registrationRevision:1,expiresOn:"2026-12-31",reason:"Cleared"}))};
  assert.equal(registrationEligibility(base).ready,true);
  const held = registrationEligibility({...base,financialHold:{held:true,reasons:[{message:"Tuition has USD 6.00 outstanding, due 2026-10-01."}]}});
  assert.deepEqual(held.blockers.map((row) => row.code),["FINANCIAL_HOLD"]);
});
