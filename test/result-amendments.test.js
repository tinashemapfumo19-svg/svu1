import test from "node:test";
import assert from "node:assert/strict";
import { amendedSnapshot, amendmentCategories, validateAmendment } from "../server/modules/result-amendments.js";

const scheme = {bands:[{minMark:0,maxMark:39,grade:"F",points:0,passing:false},{minMark:40,maxMark:69,grade:"C",points:2,passing:true},{minMark:70,maxMark:100,grade:"A",points:4,passing:true}]};
const input = (overrides = {}) => ({registrationId:"reg_1",courseId:"crs_1",revision:0,mark:72,category:"marking_error",reason:"Script page 4 was not marked",evidenceRef:"SAMPLE-SCRIPT-REVIEW",...overrides});

test("amendment requests need a category, evidence and a whole mark",() => {
  assert.doesNotThrow(() => validateAmendment(input()));
  assert.ok(amendmentCategories.includes("appeal"));
  for (const change of [{mark:72.5},{mark:101},{revision:-1},{category:"lecturer_preference"},{reason:""},{evidenceRef:""},{grade:"A"}]) assert.throws(() => validateAmendment(input(change)),{statusCode:400});
});

test("an amended result regrades under the original policy and keeps the rest of the snapshot",() => {
  const original = {registrationId:"reg_1",courseId:"crs_1",code:"C101",credits:15,mark:38,grade:"F",points:0,passing:false};
  assert.deepEqual(amendedSnapshot(original,72,scheme),{...original,mark:72,grade:"A",points:4,passing:true});
  assert.equal(amendedSnapshot(original,39,scheme).passing,false);
});
