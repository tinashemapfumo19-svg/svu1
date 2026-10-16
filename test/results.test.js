import test from "node:test";
import assert from "node:assert/strict";
import { assertResultPublicationWindow, reconcileResultRoster, resultsChecksum, validateResultsExport } from "../server/modules/results.js";

const rows = () => [{registrationId:"r1",courseId:"c1",mark:75},{registrationId:"r1",courseId:"c2",mark:50}];
const source = (items = rows()) => ({sourceRef:"SAMPLE-RESULTS",rows:items,expectedRowCount:items.length,expectedMarkTotal:items.reduce((sum,row) => sum + row.mark,0),checksum:resultsChecksum(items)});

test("results checksum is independent of row order and binds marks to enrolments", () => {
  assert.equal(resultsChecksum(rows()),resultsChecksum(rows().reverse()));
  const changed = rows(); changed[0].mark++;
  assert.notEqual(resultsChecksum(rows()),resultsChecksum(changed));
});
test("result exports require matching count, mark totals and SHA-256", () => {
  assert.equal(validateResultsExport(source()).markTotal,125);
  for (const change of [{expectedRowCount:1},{expectedMarkTotal:126},{checksum:"0".repeat(64)}]) assert.throws(() => validateResultsExport({...source(),...change}),{statusCode:400});
});
test("result exports reject duplicate, fractional, missing and out-of-range marks", () => {
  for (const items of [[...rows(),rows()[0]],[{...rows()[0],mark:100.1}],[{...rows()[0],mark:-1}],[{...rows()[0],mark:null}],[{...rows()[0],override:true}]]) assert.throws(() => validateResultsExport(source(items)),{statusCode:400});
});
test("result reconciliation requires the exact complete enrolled roster", () => {
  assert.doesNotThrow(() => reconcileResultRoster(rows(),rows().reverse()));
  for (const items of [[rows()[0]],[rows()[0],rows()[0]],[{...rows()[0],registrationId:"other"},rows()[1]]]) assert.throws(() => reconcileResultRoster(items,rows()),{statusCode:409});
});
test("result publication fails closed without a current governed calendar window", () => {
  const period = {status:"closed",calendarStatus:"published",windows:{results_publication:["2026-10-01","2026-10-31"]}};
  assert.doesNotThrow(() => assertResultPublicationWindow(period,"2026-10-02"));
  for (const change of [{status:"open"},{calendarStatus:"archived"},{windows:{}},{windows:{results_publication:["2026-11-01","2026-11-30"]}}]) assert.throws(() => assertResultPublicationWindow({...period,...change},"2026-10-02"),{statusCode:409});
});
