import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeferredSittingReady, validateDeferredEntries } from '../server/modules/deferred-assessment.js';
import { timetableIssues } from '../server/modules/exams.js';

const component = {code:'EXAM',maxMark:100};
const candidates = [{registrationId:'r1',markRevision:2}];
const marks = [{registrationId:'r1',componentCode:'EXAM',state:'deferred',revision:2}];
const entry = {registrationId:'r1',state:'mark',mark:73,revision:2};
test('deferred completion records every assigned candidate at the booked revision',() => {
  assert.deepEqual(validateDeferredEntries(component,candidates,marks,[entry]),[{...entry,componentCode:'EXAM'}]);
  for (const entries of [[],[entry,entry],[{...entry,registrationId:'other'}],[{...entry,mark:101}],[{...entry,mark:1.5}],[{...entry,state:'deferred'}],[{...entry,revision:1}]]) {
    assert.throws(() => validateDeferredEntries(component,candidates,marks,entries));
  }
  assert.throws(() => validateDeferredEntries(component,candidates,[{...marks[0],state:'mark'}],[entry]));
  assert.throws(() => validateDeferredEntries(undefined,candidates,marks,[entry]));
});
test('a deferred absence needs a reason and cannot include a mark',() => {
  const absent = {registrationId:'r1',state:'absent',reason:'Did not attend',revision:2};
  assert.equal(validateDeferredEntries(component,candidates,marks,[absent])[0].state,'absent');
  assert.throws(() => validateDeferredEntries(component,candidates,marks,[{...absent,reason:' '} ]));
  assert.throws(() => validateDeferredEntries(component,candidates,marks,[{...absent,mark:0}]));
});
test('completion requires the published sitting revision and an elapsed sitting',() => {
  const sitting = {id:'s1',planId:'p1',status:'scheduled',revision:2,startsAt:'2026-10-01T09:00:00Z',durationMinutes:60};
  const snapshot = {sittings:[{id:'s1',revision:2}]};
  const end = Date.parse('2026-10-01T10:00:00Z');
  assert.doesNotThrow(() => assertDeferredSittingReady(sitting,snapshot,end));
  assert.throws(() => assertDeferredSittingReady(sitting,snapshot,end-1));
  assert.throws(() => assertDeferredSittingReady(sitting,{sittings:[{id:'s1',revision:1}]},end));
  assert.throws(() => assertDeferredSittingReady(sitting,null,end));
  assert.throws(() => assertDeferredSittingReady({...sitting,status:'cancelled'},snapshot,end));
});
test('deferred sittings count only assigned candidates and disjoint subsets do not clash',() => {
  const a = {id:'s1',courseId:'c1',startsAt:'2026-10-01T09:00:00Z',durationMinutes:60,venue:'A',capacity:1,status:'scheduled'};
  const b = {...a,id:'s2',venue:'B'};
  const people = (...numbers) => numbers.map((studentNumber) => ({studentNumber}));
  const roster = {c1:people('S1','S2','S3')};
  assert.deepEqual(timetableIssues([a,b],roster,{s1:people('S1'),s2:people('S2')}),{clashes:[],capacity:[]});
  assert.equal(timetableIssues([a,b],roster,{s1:people('S1'),s2:people('S1')}).clashes.length,1);
});
