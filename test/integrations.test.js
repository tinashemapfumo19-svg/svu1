import test from "node:test";
import assert from "node:assert/strict";
import { backoffDelayMs, developmentAdapter, presentPayload, validateConnection } from "../server/modules/integrations.js";

test("retries back off exponentially from 30 seconds and cap at one hour",() => {
  assert.deepEqual([1,2,3,4].map(backoffDelayMs),[30_000,60_000,120_000,240_000]);
  assert.equal(backoffDelayMs(20),3_600_000);
});

test("connections need an owner, purpose, classification, and bounded limits",() => {
  const base = {code:"student_portal_api",name:"Partner API",direction:"outbound",counterparty:"Partner",purpose:"Exchange",owner:"IT",classification:"internal",authMethod:"OAuth client"};
  assert.deepEqual(validateConnection({...base,agreementRef:"  DSA-12 ",timeoutMs:5000}),{...base,agreementRef:"DSA-12",timeoutMs:5000});
  for (const bad of [{code:"X"},{owner:" "},{direction:"sideways"},{classification:"secret"},{timeoutMs:50},{maxAttempts:0},{rateLimitPerMinute:1.5},{adapter:"smtp"}]) {
    assert.throws(() => validateConnection({...base,...bad}),{statusCode:400});
  }
  assert.deepEqual(validateConnection({agreementRef:"",rateLimitPerMinute:null},{partial:true}),{agreementRef:null,rateLimitPerMinute:null});
});

test("restricted payloads are shown as field names only",() => {
  assert.deepEqual(presentPayload("restricted",{amount:10,account:"x"}),{redacted:true,fields:["account","amount"]});
  assert.deepEqual(presentPayload("internal",{note:"hello"}),{note:"hello"});
});

test("the development adapter delivers, or fails on request",async () => {
  assert.deepEqual(await developmentAdapter({id:7,attempts:0,payload:{}}),{receipt:"dev-7-1"});
  await assert.rejects(developmentAdapter({id:7,attempts:1,payload:{simulate:"fail"}}),/Simulated provider rejection/);
});
